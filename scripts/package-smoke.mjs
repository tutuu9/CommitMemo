import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkPackageInstall } from './package-install-smoke.mjs';

const project = fileURLToPath(new URL('..', import.meta.url));
const npmCli = process.env.npm_execpath;
assert.ok(npmCli, 'Run this check using npm run test:package.');
const temporary = await mkdtemp(join(tmpdir(), 'commitmemo-package-'));

function execute(executable, args, cwd) {
  return execFileSync(executable, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
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

  const ownPackage = JSON.parse(
    await readFile(join(project, 'package.json'), 'utf8'),
  );
  await checkPackageInstall({
    npmCli,
    packageSpec: join(temporary, metadata.filename),
    packageName: ownPackage.name,
    version: ownPackage.version,
  });
  console.log(
    'Package smoke check passed: allowlisted files, offline install, CLI launcher, version, and real Git report.',
  );
} finally {
  const target = resolve(temporary);
  assert.equal(dirname(target), resolve(tmpdir()));
  assert.ok(basename(target).startsWith('commitmemo-package-'));
  await rm(target, {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50,
  });
}
