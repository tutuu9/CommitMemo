import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  resolve,
} from 'node:path';

export async function checkPackageInstall({
  npmCli,
  packageSpec,
  packageName,
  version,
  offline = true,
  registry,
}) {
  validateOptions({
    npmCli,
    packageSpec,
    packageName,
    version,
    offline,
    registry,
  });
  const temporaryBase = resolve(tmpdir());
  const temporary = await mkdtemp(join(temporaryBase, 'commitmemo-install-'));
  const environment = withoutRegistryTokens(process.env);

  try {
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
        '--ignore-scripts',
        '--no-audit',
        '--no-fund',
        ...(offline ? ['--offline'] : ['--offline=false', '--prefer-online']),
        ...(registry === undefined ? [] : ['--registry', registry]),
        packageSpec,
      ],
      consumer,
      !offline && !isAbsolute(packageSpec) ? process.env : environment,
    );

    const installed = join(consumer, 'node_modules', ...packageName.split('/'));
    const installedPackage = JSON.parse(
      await readFile(join(installed, 'package.json'), 'utf8'),
    );
    assert.equal(installedPackage.name, packageName);
    assert.equal(installedPackage.version, version);
    assert.equal(installedPackage.bin?.commitmemo, 'dist/cli.js');
    await access(join(installed, 'dist', 'cli.js'));

    const launcher = join(
      consumer,
      'node_modules',
      '.bin',
      process.platform === 'win32' ? 'commitmemo.cmd' : 'commitmemo',
    );
    assert.match(
      runLauncher(launcher, ['--help'], consumer, environment),
      /CommitMemo/,
    );
    assert.equal(
      runLauncher(launcher, ['--version'], consumer, environment).trim(),
      version,
    );
    await checkGitReport({ temporary, launcher, environment });
  } finally {
    const target = resolve(temporary);
    assert.equal(dirname(target), temporaryBase);
    assert.ok(basename(target).startsWith('commitmemo-install-'));
    await rm(target, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  }
}

function validateOptions({
  npmCli,
  packageSpec,
  packageName,
  version,
  offline,
  registry,
}) {
  assert.ok(
    typeof npmCli === 'string' && isAbsolute(npmCli),
    'npmCli must be an absolute npm CLI JavaScript path.',
  );
  assert.match(
    packageName,
    /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/,
  );
  assert.match(
    version,
    /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/,
  );
  assert.ok(
    typeof packageSpec === 'string' &&
      ((isAbsolute(packageSpec) && packageSpec.endsWith('.tgz')) ||
        packageSpec === `${packageName}@${version}`),
    'packageSpec must be an absolute .tgz path or the exact package name and version.',
  );
  assert.equal(typeof offline, 'boolean');
  if (registry !== undefined) {
    const url = new URL(registry);
    assert.ok(
      ['https:', 'http:'].includes(url.protocol),
      'Registry must use HTTP or HTTPS.',
    );
    assert.ok(
      !url.username && !url.password,
      'Pass registry credentials through the environment, not the URL.',
    );
  }
}

function execute(executable, args, cwd, env) {
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

function runLauncher(launcher, args, cwd, env) {
  if (process.platform !== 'win32') return execute(launcher, args, cwd, env);
  // Both working directories are fixed siblings of the installed launcher tree.
  // Relative paths avoid cmd.exe quoting user-controlled temporary-directory names.
  const command = [relative(cwd, launcher), ...args].join(' ');
  assert.match(command, /^[A-Za-z0-9_.\\/ :-]+$/);
  return execute('cmd.exe', ['/d', '/s', '/c', command], cwd, env);
}

function withoutRegistryTokens(environment) {
  return Object.fromEntries(
    Object.entries(environment).filter(
      ([name]) =>
        !['NODE_AUTH_TOKEN', 'NPM_TOKEN'].includes(name.toUpperCase()),
    ),
  );
}

async function checkGitReport({ temporary, launcher, environment }) {
  const repository = join(temporary, 'example-project');
  const templates = join(temporary, 'templates');
  await mkdir(repository);
  await mkdir(templates);
  const config = join(temporary, 'gitconfig');
  await writeFile(config, '');
  const env = Object.fromEntries(
    Object.entries(environment).filter(
      ([key]) => !key.toUpperCase().startsWith('GIT_'),
    ),
  );
  Object.assign(env, {
    GIT_CONFIG_GLOBAL: config,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TEMPLATE_DIR: templates,
    GIT_ALLOW_PROTOCOL: '',
    GIT_TERMINAL_PROMPT: '0',
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
  const report = runLauncher(
    launcher,
    ['--from', '2026-10-15', '--to', '2026-10-15', '--timezone', 'UTC'],
    repository,
    env,
  );
  assert.match(report, /Add example journal entry/);
  assert.match(report, /Commits: 1/);
}
