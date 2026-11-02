import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { readRepository } from '../src/git.js';
import { discoverRepositories } from '../src/repositories.js';
import type { HistoryFilter, Repository } from '../src/types.js';

const AUTHOR_EMAIL = 'dev.work+memo@example.test';
const TODAY = '2026-11-01T12:00:00Z';
const TODAY_FILTER: HistoryFilter = {
  startMs: Date.parse('2026-11-01T00:00:00Z'),
  endMs: Date.parse('2026-11-02T00:00:00Z'),
  allAuthors: false,
  authorEmails: [],
};

test('reads author dates across non-monotonic history and matches exact author email', async () => {
  await withFixture(async (root) => {
    const path = await createRepository(root, 'project');
    const first = commit(path, 'First work', TODAY);
    commit(path, 'Old child', '2026-10-01T12:00:00Z');
    const rebased = commit(path, 'Authored today, committed later', TODAY, {
      committerDate: '2026-11-03T12:00:00Z',
    });
    commit(path, 'Another author', TODAY, {
      authorEmail: 'devXwork+memo@example.test',
    });
    commit(path, 'End boundary', '2026-11-02T00:00:00Z');
    const start = commit(path, 'Start boundary', '2026-11-01T00:00:00Z');

    const repository = await onlyRepository(path);
    const history = await readRepository(repository, TODAY_FILTER);
    assert.deepEqual(
      new Set(history.commits.map(({ sha }) => sha)),
      new Set([first, rebased, start]),
    );
    assert.deepEqual(history.authorEmails, [AUTHOR_EMAIL]);
    assert.equal(history.commits.at(-1)?.sha, start);
    const sameTime = history.commits.filter(
      ({ authoredAt }) => authoredAt === Date.parse(TODAY),
    );
    assert.deepEqual(
      sameTime.map(({ sha }) => sha),
      [first, rebased].sort(),
    );

    const everyone = await readRepository(repository, {
      ...TODAY_FILTER,
      allAuthors: true,
    });
    assert.equal(everyone.commits.length, 4);
    const override = await readRepository(repository, {
      ...TODAY_FILTER,
      authorEmails: ['devXwork+memo@example.test'],
    });
    assert.deepEqual(
      override.commits.map(({ subject }) => subject),
      ['Another author'],
    );
  });
});

test('collects local branches once and preserves merge parents and Unicode messages', async () => {
  await withFixture(async (root) => {
    const path = await createRepository(root, 'project');
    commit(path, 'Initial', TODAY);
    fixtureGit(path, ['checkout', '-b', 'feature']);
    commit(
      path,
      'Unicode: заметка café 🚀\n\nPR https://github.com/example/demo/pull/17',
      TODAY,
    );
    fixtureGit(path, ['checkout', 'main']);
    commit(path, 'Main work', TODAY);
    fixtureGit(
      path,
      ['merge', '--no-ff', 'feature', '-m', 'Merge pull request #17'],
      {
        GIT_AUTHOR_DATE: TODAY,
        GIT_COMMITTER_DATE: TODAY,
      },
    );
    fixtureGit(path, ['branch', 'same-tip']);

    const history = await readRepository(
      await onlyRepository(path),
      TODAY_FILTER,
    );
    assert.equal(history.commits.length, 4);
    assert.equal(new Set(history.commits.map(({ sha }) => sha)).size, 4);
    assert.equal(
      history.commits.find(
        ({ subject }) => subject === 'Merge pull request #17',
      )?.parents.length,
      2,
    );
    const unicode = history.commits.find(({ subject }) =>
      subject.includes('заметка'),
    );
    assert.equal(unicode?.subject, 'Unicode: заметка café 🚀');
    assert.match(
      unicode?.body ?? '',
      /https:\/\/github\.com\/example\/demo\/pull\/17/,
    );
  });
});

test('groups worktrees while preserving the detached HEAD of every selected worktree', async () => {
  await withFixture(async (root) => {
    const path = await createRepository(root, 'main-project');
    const shared = commit(path, 'Shared history', TODAY);
    const linkedPath = join(root, 'linked-project');
    fixtureGit(path, ['worktree', 'add', '--detach', linkedPath, 'HEAD']);
    const detached = commit(linkedPath, 'Detached work', TODAY);

    const discovery = await discoverRepositories(root);
    assert.equal(discovery.errors.length, 0);
    assert.equal(discovery.repositories.length, 1);
    const repository = discovery.repositories[0];
    assert.ok(repository);
    assert.equal(repository.paths.length, 2);
    const history = await readRepository(repository, TODAY_FILTER);
    assert.deepEqual(
      new Set(history.commits.map(({ sha }) => sha)),
      new Set([shared, detached]),
    );
  });
});

test('discovers the current root or immediate child checkouts without following links', async () => {
  await withFixture(async (root) => {
    const path = await createRepository(root, 'project with spaces');
    const subdirectory = join(path, 'nested', 'directory');
    await mkdir(subdirectory, { recursive: true });
    await createRepository(path, 'nested-repository');
    const fromSubdirectory = await discoverRepositories(subdirectory);
    assert.equal(fromSubdirectory.repositories.length, 1);
    assert.equal(fromSubdirectory.repositories[0]?.name, 'project with spaces');

    const container = join(root, 'container');
    await mkdir(container);
    await createRepository(container, 'too-deep');
    await symlink(
      path,
      join(root, 'linked-alias'),
      process.platform === 'win32' ? 'junction' : 'dir',
    );
    const immediate = await discoverRepositories(root);
    assert.equal(immediate.errors.length, 0);
    assert.equal(immediate.repositories.length, 1);
    assert.equal(immediate.repositories[0]?.paths.length, 1);
  });
});

test('reports bare repositories as unsupported and keeps an empty checkout valid', async () => {
  await withFixture(async (root) => {
    const empty = await createRepository(root, 'empty');
    const bare = join(root, 'bare.git');
    fixtureGit(root, ['init', '--bare', '--quiet', bare]);
    const discovery = await discoverRepositories(root);
    assert.equal(discovery.repositories.length, 1);
    assert.equal(discovery.errors.length, 1);
    assert.equal(discovery.errors[0]?.project, 'bare.git');
    assert.match(discovery.errors[0]?.message ?? '', /Bare repositories/);
    assert.equal(discovery.errors[0]?.message.includes(root), false);
    assert.deepEqual(
      (await readRepository(await onlyRepository(empty), TODAY_FILTER)).commits,
      [],
    );
    const directBare = await discoverRepositories(bare);
    assert.equal(directBare.repositories.length, 0);
    assert.equal(directBare.errors.length, 1);
  });
});

test('does not widen the author filter when user.email is missing', async () => {
  await withFixture(async (root) => {
    const path = await createRepository(root, 'project');
    commit(path, 'Work', TODAY);
    fixtureGit(path, ['config', '--unset', 'user.email']);
    const repository = await onlyRepository(path);
    await assert.rejects(
      readRepository(repository, TODAY_FILTER),
      /No author email.*--author-email.*--all-authors/,
    );
    const everyone = await readRepository(repository, {
      ...TODAY_FILTER,
      allAuthors: true,
    });
    assert.equal(everyone.commits.length, 1);
  });
});

test('ignores inherited repository bindings and leaves Git references unchanged', async () => {
  await withFixture(async (root) => {
    const first = await createRepository(root, 'first');
    const second = await createRepository(root, 'second');
    const expected = commit(first, 'Selected project', TODAY);
    commit(second, 'Wrong project', TODAY);
    const before = fixtureGit(first, ['show-ref']);
    const restore = changeEnvironment({
      GIT_DIR: join(second, '.git'),
      GIT_WORK_TREE: second,
      GIT_INDEX_FILE: join(second, '.git', 'index'),
    });
    try {
      const history = await readRepository(
        await onlyRepository(first),
        TODAY_FILTER,
      );
      assert.deepEqual(
        history.commits.map(({ sha }) => sha),
        [expected],
      );
    } finally {
      restore();
    }
    assert.equal(fixtureGit(first, ['show-ref']), before);
  });
});

async function onlyRepository(path: string): Promise<Repository> {
  const discovery = await discoverRepositories(path);
  assert.deepEqual(discovery.errors, []);
  assert.equal(discovery.repositories.length, 1);
  const repository = discovery.repositories[0];
  assert.ok(repository);
  return repository;
}

async function createRepository(parent: string, name: string): Promise<string> {
  const path = join(parent, name);
  await mkdir(path);
  fixtureGit(path, ['init', '--quiet', '--initial-branch=main']);
  fixtureGit(path, ['config', 'user.name', 'Example Developer']);
  fixtureGit(path, ['config', 'user.email', AUTHOR_EMAIL]);
  fixtureGit(path, ['config', 'commit.gpgsign', 'false']);
  return path;
}

function commit(
  path: string,
  message: string,
  authorDate: string,
  options: { authorEmail?: string; committerDate?: string } = {},
): string {
  fixtureGit(path, ['commit', '--allow-empty', '--quiet', '-m', message], {
    GIT_AUTHOR_NAME: 'Example Developer',
    GIT_AUTHOR_EMAIL: options.authorEmail ?? AUTHOR_EMAIL,
    GIT_AUTHOR_DATE: authorDate,
    GIT_COMMITTER_DATE: options.committerDate ?? authorDate,
  });
  return fixtureGit(path, ['rev-parse', 'HEAD']).trim();
}

function fixtureGit(
  cwd: string,
  args: string[],
  extraEnvironment: NodeJS.ProcessEnv = {},
): string {
  const environment = { ...process.env };
  for (const name of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_COMMON_DIR',
  ])
    delete environment[name];
  const result = spawnSync('git', args, {
    cwd,
    env: { ...environment, ...extraEnvironment },
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  return result.stdout;
}

async function withFixture(
  callback: (root: string) => Promise<void>,
): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), 'commitmemo-git-'));
  const config = join(root, 'empty-config');
  await writeFile(config, '');
  const restore = changeEnvironment({
    GIT_CONFIG_GLOBAL: config,
    GIT_CONFIG_SYSTEM: config,
  });
  try {
    await callback(root);
  } finally {
    restore();
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(basename(root).startsWith('commitmemo-git-'));
    await rm(root, { recursive: true, force: true });
  }
}

function changeEnvironment(values: Record<string, string>): () => void {
  const previous = new Map(
    Object.keys(values).map((name) => [name, process.env[name]]),
  );
  Object.assign(process.env, values);
  return () => {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}
