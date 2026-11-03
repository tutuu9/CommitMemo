import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { checkPackageInstall } from './package-install-smoke.mjs';

const PACKAGE = '@tutuu9/commitmemo';
const VERSION = '0.1.1';
const REGISTRY = 'https://npm.pkg.github.com';
const METADATA_URL = `${REGISTRY}/@tutuu9%2fcommitmemo`;
const FILENAME = 'tutuu9-commitmemo-0.1.1.tgz';
const ORIGINAL_SHA256 =
  'a24fe8a992a0b8b049180d4515c0c6be71ad689154a2190afdc438add8be592c';
const FILES = [
  'LICENSE',
  'README.md',
  'package.json',
  ...[
    'cli',
    'git',
    'links',
    'options',
    'periods',
    'renderers',
    'report',
    'repositories',
    'types',
  ].map((name) => `dist/${name}.js`),
]
  .map((name) => `package/${name}`)
  .sort();
const npmCli = process.env.npm_execpath;

function execute(
  executable,
  args,
  { cwd, authenticated = false, binary = false } = {},
) {
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (
      name.toUpperCase() === 'NPM_TOKEN' ||
      (!authenticated && name.toUpperCase() === 'NODE_AUTH_TOKEN')
    )
      delete env[name];
  }
  try {
    return execFileSync(executable, args, {
      cwd,
      env,
      encoding: binary ? null : 'utf8',
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 120_000,
      maxBuffer: 2 * 1024 * 1024,
    });
  } catch {
    throw new Error(
      'A package preparation or registry command failed. No command output containing credentials was printed.',
    );
  }
}

const digest = (bytes, algorithm, encoding) =>
  createHash(algorithm).update(bytes).digest(encoding);

async function archiveBytes(path) {
  assert.ok(
    (await stat(path)).size <= 8 * 1024 * 1024,
    'Unexpectedly large release archive.',
  );
  return readFile(path);
}

function archiveFiles(path) {
  const names = execute('tar', ['-tzf', path]).trim().split(/\r?\n/u).sort();
  assert.deepEqual(
    names,
    FILES,
    'Archive contents differ from the original release allowlist.',
  );
  const entries = execute('tar', ['-tvzf', path]).trim().split(/\r?\n/u);
  assert.ok(
    entries.every((entry) => entry.startsWith('-')),
    'Archive entries must be regular files.',
  );
  return new Map(
    names.map((name) => [
      name,
      execute('tar', ['-xOzf', path, name], { binary: true }),
    ]),
  );
}

function scopedManifest(original) {
  assert.equal(
    original.name,
    'commitmemo',
    'Unexpected original package name.',
  );
  assert.equal(
    original.version,
    VERSION,
    'Unexpected original package version.',
  );
  return {
    ...original,
    name: PACKAGE,
    publishConfig: { ...original.publishConfig, registry: REGISTRY },
  };
}

async function verifyPrepared(directory) {
  const originalPath = join(directory, 'original.tgz');
  const original = await archiveBytes(originalPath);
  assert.equal(
    digest(original, 'sha256', 'hex'),
    ORIGINAL_SHA256,
    'Original archive SHA-256 does not match the released artifact.',
  );
  const candidatePath = join(directory, FILENAME);
  const candidate = await archiveBytes(candidatePath);
  const originalFiles = archiveFiles(originalPath);
  const candidateFiles = archiveFiles(candidatePath);
  for (const name of FILES) {
    if (name === 'package/package.json') {
      assert.deepEqual(
        JSON.parse(candidateFiles.get(name)),
        scopedManifest(JSON.parse(originalFiles.get(name))),
        'Only package name and publishConfig.registry may change.',
      );
    } else
      assert.ok(
        originalFiles.get(name).equals(candidateFiles.get(name)),
        `Release content changed: ${name}`,
      );
  }
  return {
    packageName: PACKAGE,
    version: VERSION,
    registry: REGISTRY,
    filename: FILENAME,
    originalSha256: ORIGINAL_SHA256,
    integrity: `sha512-${digest(candidate, 'sha512', 'base64')}`,
  };
}

async function smoke(options) {
  try {
    await checkPackageInstall({
      npmCli,
      packageName: PACKAGE,
      version: VERSION,
      ...options,
    });
  } catch {
    throw new Error('The scoped package installation smoke check failed.');
  }
}

async function prepare(originalPath, directory) {
  const original = await archiveBytes(originalPath);
  assert.equal(
    digest(original, 'sha256', 'hex'),
    ORIGINAL_SHA256,
    'Original archive SHA-256 does not match the released artifact.',
  );
  await mkdir(directory);
  const copiedOriginal = join(directory, 'original.tgz');
  await writeFile(copiedOriginal, original, { flag: 'wx' });
  const originalFiles = archiveFiles(copiedOriginal);
  execute('tar', ['-xzf', copiedOriginal, '-C', directory]);
  const manifest = scopedManifest(
    JSON.parse(originalFiles.get('package/package.json')),
  );
  await writeFile(
    join(directory, 'package', 'package.json'),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  const [packed] = JSON.parse(
    execute(
      process.execPath,
      [
        npmCli,
        'pack',
        '--ignore-scripts',
        '--json',
        '--pack-destination',
        directory,
      ],
      { cwd: join(directory, 'package') },
    ),
  );
  assert.equal(
    packed.filename,
    FILENAME,
    'Unexpected scoped archive filename.',
  );
  const metadata = await verifyPrepared(directory);
  assert.equal(
    packed.integrity,
    metadata.integrity,
    'npm pack integrity differs from the archive.',
  );
  await smoke({ packageSpec: join(directory, packed.filename), offline: true });
  await writeFile(
    join(directory, 'prepared.json'),
    `${JSON.stringify(metadata, null, 2)}\n`,
    { flag: 'wx' },
  );
  console.log(`Prepared ${PACKAGE}@${VERSION}: ${metadata.filename}`);
}

async function registryVersion(token) {
  let response;
  try {
    response = await globalThis.fetch(METADATA_URL, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Cache-Control': 'no-cache',
      },
      redirect: 'error',
      signal: globalThis.AbortSignal.timeout(15_000),
    });
  } catch {
    throw new Error(
      'Registry metadata request failed; package presence is unknown.',
    );
  }
  if (response.status === 404) {
    await response.body?.cancel();
    return undefined;
  }
  if (response.status !== 200) {
    await response.body?.cancel();
    throw new Error(
      `Registry metadata request returned HTTP ${response.status}; publication stopped.`,
    );
  }
  let metadata;
  try {
    const chunks = [];
    let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      if (size > 2 * 1024 * 1024) throw new Error('Metadata too large.');
      chunks.push(chunk);
    }
    metadata = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new Error(
      'Registry metadata is unreadable or oversized; publication stopped.',
    );
  }
  if (
    metadata?.name !== PACKAGE ||
    !metadata.versions ||
    typeof metadata.versions !== 'object' ||
    Array.isArray(metadata.versions)
  ) {
    throw new Error(
      'Registry returned an invalid package document; publication stopped.',
    );
  }
  if (!Object.hasOwn(metadata.versions, VERSION)) return undefined;
  const version = metadata.versions[VERSION];
  if (
    version?.name !== PACKAGE ||
    version.version !== VERSION ||
    typeof version.dist?.integrity !== 'string'
  ) {
    throw new Error(
      'Registry returned invalid version metadata; publication stopped.',
    );
  }
  return version;
}

function verifyRegistryIntegrity(version, integrity) {
  assert.ok(
    version.dist.integrity === integrity,
    'The registry version has different integrity. Existing versions are never replaced.',
  );
}

async function publish(directory) {
  const prepared = await verifyPrepared(directory);
  assert.deepEqual(
    JSON.parse(await readFile(join(directory, 'prepared.json'), 'utf8')),
    prepared,
    'Prepared metadata does not match the verified archives.',
  );
  const token = process.env.NODE_AUTH_TOKEN;
  assert.ok(
    token,
    'NODE_AUTH_TOKEN is required for GitHub registry operations.',
  );
  const existing = await registryVersion(token);
  if (existing) {
    verifyRegistryIntegrity(existing, prepared.integrity);
    console.log(
      'The exact verified version already exists; publication skipped.',
    );
  } else {
    const candidate = join(directory, prepared.filename);
    assert.equal(
      `sha512-${digest(await archiveBytes(candidate), 'sha512', 'base64')}`,
      prepared.integrity,
      'Prepared archive changed before publication.',
    );
    execute(
      process.execPath,
      [
        npmCli,
        'publish',
        candidate,
        '--ignore-scripts',
        '--registry',
        REGISTRY,
        '--tag',
        'latest',
      ],
      { cwd: directory, authenticated: true },
    );
    let published;
    for (let attempt = 0; attempt < 6; attempt++) {
      published = await registryVersion(token);
      if (published) break;
      if (attempt < 5) await delay(2000);
    }
    assert.ok(
      published,
      'Publication completed but version metadata is not visible yet. Rerun publish to verify safely.',
    );
    verifyRegistryIntegrity(published, prepared.integrity);
  }
  await smoke({
    packageSpec: `${PACKAGE}@${VERSION}`,
    offline: false,
    registry: REGISTRY,
  });
  console.log(`Verified registry installation of ${PACKAGE}@${VERSION}.`);
}

async function main() {
  assert.ok(
    npmCli,
    'Run this script using npm run github-package:once -- prepare or publish.',
  );
  const [action, first, second, ...extra] = process.argv.slice(2);
  if (action === 'prepare' && first && second && !extra.length)
    await prepare(resolve(first), resolve(second));
  else if (action === 'publish' && first && !second)
    await publish(resolve(first));
  else
    throw new Error(
      'Usage: prepare ORIGINAL_TGZ NEW_OUTPUT_DIR | publish OUTPUT_DIR',
    );
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
