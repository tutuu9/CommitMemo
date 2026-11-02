import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('..', import.meta.url));
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run this check using npm run test:package.');
const temporary = await mkdtemp(join(tmpdir(), 'commitmemo-package-'));

function execute(executable, args, cwd, env = process.env) {
  return execFileSync(executable, args, {
    cwd,
    env,
    encoding: 'utf8',
    windowsHide: true,
    windowsVerbatimArguments:
      process.platform === 'win32' && executable === 'cmd.exe',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 120_000,
  });
}

try {
  const packed = execute(
    process.execPath,
    [npmCli, 'pack', '--json', '--pack-destination', temporary],
    project,
  );
  const [metadata] = JSON.parse(packed);
  assert.ok(metadata.files.some((entry) => entry.path === 'dist/cli.js'));
  for (const entry of metadata.files) {
    assert.ok(
      ['package.json', 'README.md', 'LICENSE'].includes(entry.path) ||
        /^dist\/[a-zA-Z0-9/-]+\.js$/.test(entry.path),
      `Unexpected package file: ${entry.path}`,
    );
  }

  const consumer = join(temporary, 'consumer');
  await mkdir(consumer);
  await writeFile(
    join(consumer, 'package.json'),
    '{"name":"commitmemo-smoke-consumer","private":true}',
  );
  execute(
    process.execPath,
    [
      npmCli,
      'install',
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      join(temporary, metadata.filename),
    ],
    consumer,
  );

  const executable = join(
    consumer,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'commitmemo.cmd' : 'commitmemo',
  );
  const help =
    process.platform === 'win32'
      ? execute(
          'cmd.exe',
          ['/d', '/s', '/c', 'node_modules\\.bin\\commitmemo.cmd --help'],
          consumer,
        )
      : execute(executable, ['--help'], consumer);
  assert.match(help, /CommitMemo/);
  const installedCli = join(
    consumer,
    'node_modules',
    'commitmemo',
    'dist',
    'cli.js',
  );
  const ownPackage = JSON.parse(
    await readFile(join(project, 'package.json'), 'utf8'),
  );
  assert.equal(
    execute(process.execPath, [installedCli, '--version'], consumer).trim(),
    ownPackage.version,
  );

  const repository = join(temporary, 'example-project');
  const templates = join(temporary, 'templates');
  await mkdir(repository);
  await mkdir(templates);
  const config = join(temporary, 'gitconfig');
  await writeFile(config, '');
  const env = Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !key.toUpperCase().startsWith('GIT_'),
    ),
  );
  Object.assign(env, {
    GIT_CONFIG_GLOBAL: config,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TEMPLATE_DIR: templates,
    GIT_AUTHOR_NAME: 'Example Developer',
    GIT_COMMITTER_NAME: 'Example Developer',
    GIT_AUTHOR_EMAIL: 'dev@example.com',
    GIT_COMMITTER_EMAIL: 'dev@example.com',
    GIT_AUTHOR_DATE: '2026-10-15T12:00:00Z',
    GIT_COMMITTER_DATE: '2026-10-15T12:00:00Z',
  });
  execute('git', ['init', '--initial-branch=main'], repository, env);
  execute('git', ['config', 'user.email', 'dev@example.com'], repository, env);
  execute(
    'git',
    [
      '-c',
      'commit.gpgsign=false',
      'commit',
      '--allow-empty',
      '-m',
      'Add example journal entry',
    ],
    repository,
    env,
  );
  const report = execute(
    process.execPath,
    [
      installedCli,
      '--from',
      '2026-10-15',
      '--to',
      '2026-10-15',
      '--timezone',
      'UTC',
    ],
    repository,
    env,
  );
  assert.match(report, /Add example journal entry/);
  assert.match(report, /Commits: 1/);
  console.log(
    'Package smoke check passed: allowlisted files, offline install, CLI launcher, version, and real Git report.',
  );
} finally {
  const target = resolve(temporary);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.ok(basename(target).startsWith('commitmemo-package-'));
  await rm(target, { recursive: true, force: true });
}
