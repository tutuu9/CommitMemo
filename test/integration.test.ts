import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import type { TestContext } from 'node:test';
import { directoryContents, GitFixture } from './fixtures.js';
import type { ProcessResult } from './fixtures.js';

const OCTOBER = [
  '--from',
  '2026-10-01',
  '--to',
  '2026-10-31',
  '--timezone',
  'UTC',
];

function fixture(t: TestContext): GitFixture {
  const value = new GitFixture();
  t.after(() => value.dispose());
  return value;
}

function succeeds(result: ProcessResult): string {
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  return result.stdout;
}

test('CLI help and version work outside a repository', (t) => {
  const f = fixture(t);
  assert.match(succeeds(f.cli(f.root, ['--help'])), /--all-authors/u);
  assert.match(succeeds(f.cli(f.root, ['--version'])), /^\d+\.\d+\.\d+\s*$/u);
});

test('discovers the containing repository from a Unicode subdirectory and selects my commits', (t) => {
  const f = fixture(t);
  const repo = f.repository('проєкт with spaces');
  f.commit(repo, 'MY_UNIQUE_CHANGE');
  f.commit(repo, 'ANOTHER_AUTHOR_CHANGE', {
    email: 'other@example.com',
    name: 'Jordan Example',
  });
  const subdirectory = join(repo, 'src', 'nested');
  mkdirSync(subdirectory, { recursive: true });

  const mine = succeeds(f.cli(subdirectory, OCTOBER));
  assert.match(mine, /MY_UNIQUE_CHANGE/u);
  assert.doesNotMatch(mine, /ANOTHER_AUTHOR_CHANGE/u);
  assert.doesNotMatch(mine, /dev@example\.com/u);
  assert.ok(
    !mine.includes(repo),
    'The report should not expose absolute paths.',
  );

  const all = succeeds(f.cli(subdirectory, [...OCTOBER, '--all-authors']));
  assert.match(all, /MY_UNIQUE_CHANGE/u);
  assert.match(all, /ANOTHER_AUTHOR_CHANGE/u);
  assert.match(all, /Jordan Example/u);

  const overridden = succeeds(
    f.cli(repo, [...OCTOBER, '--author-email', 'other@example.com']),
  );
  assert.match(overridden, /ANOTHER_AUTHOR_CHANGE/u);
  assert.doesNotMatch(overridden, /MY_UNIQUE_CHANGE/u);
  const both = succeeds(
    f.cli(repo, [
      ...OCTOBER,
      '--author-email',
      'other@example.com',
      '--author-email',
      'dev@example.com',
    ]),
  );
  assert.match(both, /MY_UNIQUE_CHANGE/u);
  assert.match(both, /ANOTHER_AUTHOR_CHANGE/u);
});

test('scans immediate child repositories without recursing or following symlinks', (t) => {
  const f = fixture(t);
  const workspace = f.directory('work');
  f.commit(f.repository('work/alpha'), 'ALPHA_DIRECT_CHILD');
  f.commit(f.repository('work/beta'), 'BETA_DIRECT_CHILD');
  f.commit(f.repository('work/group/deep'), 'DEEP_SHOULD_NOT_APPEAR');
  const outside = f.repository('outside');
  f.commit(outside, 'LINK_SHOULD_NOT_APPEAR');
  symlinkSync(
    outside,
    join(workspace, 'linked-project'),
    process.platform === 'win32' ? 'junction' : 'dir',
  );

  const output = succeeds(f.cli(workspace, OCTOBER));
  assert.match(output, /ALPHA_DIRECT_CHILD/u);
  assert.match(output, /BETA_DIRECT_CHILD/u);
  assert.doesNotMatch(output, /DEEP_SHOULD_NOT_APPEAR|LINK_SHOULD_NOT_APPEAR/u);
});

test('uses author dates even when committer dates lie outside the selected range', (t) => {
  const f = fixture(t);
  const repo = f.repository('dates');
  f.commit(repo, 'AUTHORED_IN_RANGE', {
    authoredAt: '2026-10-10T12:00:00Z',
    committedAt: '2026-06-10T12:00:00Z',
  });
  f.commit(repo, 'REBASED_FROM_PREVIOUS_MONTH', {
    authoredAt: '2026-09-30T23:59:59Z',
    committedAt: '2026-10-20T12:00:00Z',
  });
  f.commit(repo, 'AT_FIRST_BOUNDARY', { authoredAt: '2026-10-01T00:00:00Z' });
  f.commit(repo, 'AT_LAST_SECOND', { authoredAt: '2026-10-31T23:59:59Z' });
  f.commit(repo, 'AT_NEXT_BOUNDARY', { authoredAt: '2026-11-01T00:00:00Z' });

  const output = succeeds(f.cli(repo, OCTOBER));
  assert.match(output, /AUTHORED_IN_RANGE/u);
  assert.match(output, /AT_FIRST_BOUNDARY/u);
  assert.match(output, /AT_LAST_SECOND/u);
  assert.doesNotMatch(output, /REBASED_FROM_PREVIOUS_MONTH|AT_NEXT_BOUNDARY/u);
});

test('an inclusive calendar date covers the 25-hour autumn DST day in Warsaw', (t) => {
  const f = fixture(t);
  const repo = f.repository('dst');
  f.commit(repo, 'BEFORE_LOCAL_DAY', { authoredAt: '2026-10-24T21:59:59Z' });
  f.commit(repo, 'START_OF_LOCAL_DAY', { authoredAt: '2026-10-24T22:00:00Z' });
  f.commit(repo, 'END_OF_LOCAL_DAY', { authoredAt: '2026-10-25T22:59:59Z' });
  f.commit(repo, 'AFTER_LOCAL_DAY', { authoredAt: '2026-10-25T23:00:00Z' });

  const output = succeeds(
    f.cli(repo, [
      '--from',
      '2026-10-25',
      '--to',
      '2026-10-25',
      '--timezone',
      'Europe/Warsaw',
    ]),
  );
  assert.match(output, /Europe\/Warsaw/u);
  assert.match(output, /START_OF_LOCAL_DAY/u);
  assert.match(output, /END_OF_LOCAL_DAY/u);
  assert.doesNotMatch(output, /BEFORE_LOCAL_DAY|AFTER_LOCAL_DAY/u);
});

test('includes unmerged branches, deduplicates shared commits and labels merges', (t) => {
  const f = fixture(t);
  const repo = f.repository('branches');
  f.commit(repo, 'SHARED_BASE_COMMIT');
  f.git(repo, ['switch', '-c', 'feature']);
  f.commit(repo, 'FEATURE_BRANCH_CHANGE');
  f.git(repo, ['switch', 'main']);
  f.git(
    repo,
    [
      'merge',
      '--no-ff',
      'feature',
      '-m',
      'Merge pull request #42 from example/feature',
    ],
    {
      GIT_AUTHOR_DATE: '2026-10-20T10:00:00Z',
      GIT_COMMITTER_DATE: '2026-10-20T10:00:00Z',
    },
  );
  f.git(repo, ['switch', '-c', 'unmerged']);
  f.commit(repo, 'UNMERGED_WORK');
  f.git(repo, ['switch', 'main']);
  f.git(repo, [
    'remote',
    'add',
    'origin',
    'git@github.com:example/branches.git',
  ]);

  const output = succeeds(f.cli(repo, OCTOBER));
  assert.equal(output.match(/SHARED_BASE_COMMIT/gu)?.length, 1);
  assert.match(output, /FEATURE_BRANCH_CHANGE/u);
  assert.match(output, /UNMERGED_WORK/u);
  assert.match(output, /\[merge\].*Merge pull request #42/u);
  assert.match(output, /https:\/\/github\.com\/example\/branches\/pull\/42/u);
});

test('groups worktrees but retains a detached HEAD from every selected worktree', (t) => {
  const f = fixture(t);
  const workspace = f.directory('work');
  const repo = f.repository('work/main-copy');
  f.commit(repo, 'WORKTREE_SHARED_BASE');
  const second = join(workspace, 'detached-copy');
  f.git(repo, ['worktree', 'add', '--detach', second, 'HEAD']);
  f.commit(second, 'ONLY_DETACHED_WORKTREE_HEAD');

  const output = succeeds(f.cli(workspace, OCTOBER));
  assert.equal(output.match(/WORKTREE_SHARED_BASE/gu)?.length, 1);
  assert.equal(output.match(/ONLY_DETACHED_WORKTREE_HEAD/gu)?.length, 1);
  assert.match(output, /Projects: 1\b/u);
});

test('builds safe GitHub links and distinguishes explicit PR references from issue numbers', (t) => {
  const f = fixture(t);
  const repo = f.repository('links');
  const sha = f.commit(repo, 'ISSUE_REFERENCE_ONLY (#73)');
  f.commit(
    repo,
    'EXPLICIT_PR_REFERENCE\n\nSee https://github.com/example/other/pull/18',
  );
  f.git(repo, [
    'remote',
    'add',
    'origin',
    'https://username:fictional-token@github.com/example/links.git',
  ]);

  const output = succeeds(f.cli(repo, [...OCTOBER, '--format', 'markdown']));
  assert.match(output, /^# CommitMemo/u);
  assert.ok(output.includes(`https://github.com/example/links/commit/${sha}`));
  assert.match(output, /https:\/\/github\.com\/example\/other\/pull\/18/u);
  assert.doesNotMatch(output, /\/pull\/73\b|fictional-token|username:/u);
  assert.ok(
    output.includes('ISSUE\\_REFERENCE\\_ONLY'),
    'Markdown metacharacters should be escaped.',
  );
});

test('a repository with no remote still produces a useful report', (t) => {
  const f = fixture(t);
  const repo = f.repository('local-only');
  const sha = f.commit(repo, 'LOCAL_ONLY_COMMIT');
  const output = succeeds(f.cli(repo, OCTOBER));
  assert.ok(output.includes(sha.slice(0, 8)));
  assert.match(output, /LOCAL_ONLY_COMMIT/u);
  assert.doesNotMatch(output, /https:\/\//u);
});

test('empty repositories and periods without matches are successful', (t) => {
  const f = fixture(t);
  const repo = f.repository('empty');
  assert.match(succeeds(f.cli(repo, OCTOBER)), /No matching commits/u);
  f.commit(repo, 'OUTSIDE_SELECTED_PERIOD', {
    authoredAt: '2026-09-01T00:00:00Z',
  });
  const output = succeeds(f.cli(repo, OCTOBER));
  assert.match(output, /No matching commits/u);
  assert.doesNotMatch(output, /OUTSIDE_SELECTED_PERIOD/u);
});

test('unknown author fails without widening the selection and reports partial results', (t) => {
  const f = fixture(t);
  const workspace = f.directory('work');
  f.commit(f.repository('work/good'), 'SUCCESSFUL_PROJECT');
  const bad = f.repository('work/unknown-author', false);
  f.commit(bad, 'UNKNOWN_AUTHOR_COMMIT');

  const partial = f.cli(workspace, OCTOBER);
  assert.equal(partial.status, 1);
  assert.match(partial.stdout, /incomplete report/u);
  assert.match(partial.stdout, /SUCCESSFUL_PROJECT/u);
  assert.doesNotMatch(partial.stdout, /UNKNOWN_AUTHOR_COMMIT/u);
  assert.match(partial.stderr, /--author-email/u);

  const all = succeeds(f.cli(bad, [...OCTOBER, '--all-authors']));
  assert.match(all, /UNKNOWN_AUTHOR_COMMIT/u);
  const explicit = succeeds(
    f.cli(bad, [...OCTOBER, '--author-email', 'dev@example.com']),
  );
  assert.match(explicit, /UNKNOWN_AUTHOR_COMMIT/u);
});

test('reports missing repositories, unsupported bare repositories and invalid arguments', (t) => {
  const f = fixture(t);
  const empty = f.directory('no-projects');
  const missing = f.cli(empty, OCTOBER);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /No Git repositories/u);

  const bare = f.directory('bare.git');
  f.git(bare, ['init', '--bare']);
  const unsupported = f.cli(bare, OCTOBER);
  assert.equal(unsupported.status, 1);
  assert.match(`${unsupported.stdout}\n${unsupported.stderr}`, /bare/iu);

  for (const args of [
    ['--today', '--week'],
    ['--from', '2026-10-01'],
    ['--from', '2026-02-30', '--to', '2026-03-01'],
    ['--from', '2026-10-31', '--to', '2026-10-01'],
    ['--all-authors', '--author-email', 'dev@example.com'],
    ['--timezone', 'Not/A_Timezone'],
    ['--format', 'json'],
    ['--unknown-option'],
  ]) {
    const result = f.cli(empty, args);
    assert.equal(result.status, 2, `${args.join(' ')}: ${result.stderr}`);
    assert.equal(result.stdout, '');
    assert.notEqual(result.stderr, '');
  }
});

test('reporting preserves refs, index and working files; explicit output never overwrites a file', (t) => {
  const f = fixture(t);
  const repo = f.repository('preserved');
  writeFileSync(join(repo, 'tracked.txt'), 'initial\n');
  f.git(repo, ['add', 'tracked.txt']);
  f.commit(repo, 'PRESERVATION_CHECK');
  writeFileSync(join(repo, 'tracked.txt'), 'staged\n');
  f.git(repo, ['add', 'tracked.txt']);
  writeFileSync(join(repo, 'tracked.txt'), 'unstaged\n');
  writeFileSync(join(repo, 'untracked.txt'), 'do not alter\n');
  const before = directoryContents(repo);

  const report = join(f.root, 'reports', 'week.md');
  assert.match(
    succeeds(f.cli(repo, [...OCTOBER, '--output', report])),
    /PRESERVATION_CHECK/u,
  );
  assert.deepEqual(directoryContents(repo), before);
  const saved = readFileSync(report, 'utf8');
  assert.match(saved, /^# CommitMemo/u);
  assert.match(saved, /PRESERVATION\\_CHECK/u);

  const duplicate = f.cli(repo, [...OCTOBER, '--output', report]);
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stderr, /already exists/iu);
  assert.equal(readFileSync(report, 'utf8'), saved);
  assert.deepEqual(directoryContents(repo), before);
});

test('missing promisor objects produce an error without fetching or modifying the repository', (t) => {
  const f = fixture(t);
  const source = f.repository('source');
  const sha = f.commit(source, 'MISSING_OBJECT_FROM_REMOTE');
  const clone = join(f.root, 'partial');
  f.git(f.root, ['clone', '--no-hardlinks', source, clone]);
  f.git(clone, ['config', 'user.email', 'dev@example.com']);
  f.git(clone, ['config', 'core.repositoryformatversion', '1']);
  f.git(clone, ['config', 'extensions.partialClone', 'origin']);
  f.git(clone, ['config', 'remote.origin.promisor', 'true']);
  const object = join(clone, '.git', 'objects', sha.slice(0, 2), sha.slice(2));
  assert.ok(
    existsSync(object),
    'The fixture must start with the loose commit object.',
  );
  rmSync(object);
  const before = directoryContents(clone);

  const result = f.cli(clone, OCTOBER);
  assert.equal(result.status, 1, result.stdout);
  assert.doesNotMatch(result.stdout, /MISSING_OBJECT_FROM_REMOTE/u);
  assert.notEqual(result.stderr, '');
  assert.deepEqual(directoryContents(clone), before);
});

test('a closed stdout pipe does not interrupt explicit Markdown output', async (t) => {
  const f = fixture(t);
  const repo = f.repository('closed-pipe');
  const messageFile = join(f.root, 'large-commit-message.txt');
  writeFileSync(
    messageFile,
    `PIPE_OUTPUT_SENTINEL ${'x'.repeat(256 * 1024)}\n`,
  );
  f.git(repo, ['commit', '--allow-empty', '-F', messageFile], {
    GIT_AUTHOR_DATE: '2026-10-15T12:00:00Z',
    GIT_COMMITTER_DATE: '2026-10-15T12:00:00Z',
  });
  const expected = succeeds(f.cli(repo, [...OCTOBER, '--format', 'markdown']));
  const report = join(f.root, 'saved-after-closed-pipe.md');
  const child = spawn(
    process.execPath,
    [resolve('dist/cli.js'), ...OCTOBER, '--output', report],
    {
      cwd: repo,
      env: f.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      timeout: 30_000,
    },
  );
  let stderr = '';
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    stderr += chunk;
  });
  child.stdout.destroy();
  const status = await new Promise<number | null>((resolveStatus, reject) => {
    child.on('error', reject);
    child.on('close', resolveStatus);
  });

  assert.equal(status, 0, stderr);
  assert.equal(stderr, '');
  assert.equal(readFileSync(report, 'utf8'), expected);
});
