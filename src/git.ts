import { spawn } from 'node:child_process';
import type {
  CommitRecord,
  HistoryFilter,
  Repository,
  RepositoryHistory,
} from './types.js';

const COMMAND_TIMEOUT_MS = 30_000;
const HISTORY_TIMEOUT_MS = 60_000;
const HISTORY_OUTPUT_LIMIT = 64 * 1024 * 1024;
const COMMIT_FIELD_LIMIT = 4 * 1024 * 1024;
const OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;

export interface GitResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

interface GitOptions {
  allowedExitCodes?: number[];
  input?: string;
  onStdout?: (chunk: string) => void;
  timeoutMs?: number;
  outputLimit?: number;
}

export async function ensureGitAvailable(): Promise<void> {
  let version: string;
  try {
    version = (await runGit(undefined, ['--version'])).stdout;
  } catch {
    throw new Error(
      'Git 2.45 or newer must be installed and available in PATH.',
    );
  }

  const match = /^git version (\d+)\.(\d+)/.exec(version);
  if (
    !match ||
    Number(match[1]) < 2 ||
    (Number(match[1]) === 2 && Number(match[2]) < 45)
  ) {
    throw new Error('Git 2.45 or newer is required. Please upgrade Git.');
  }
}

export async function readRepository(
  repository: Repository,
  filter: HistoryFilter,
): Promise<RepositoryHistory> {
  const primaryPath = repository.paths[0];
  if (!primaryPath)
    throw new Error('The selected project has no working tree.');

  const [authorEmails, revisions, originResult, shallowResult] =
    await Promise.all([
      readAuthorEmails(repository.paths, filter),
      readRevisions(repository.paths),
      runGit(primaryPath, ['config', '--get', 'remote.origin.url'], {
        allowedExitCodes: [0, 1],
      }),
      runGit(primaryPath, ['rev-parse', '--is-shallow-repository']),
    ]);
  const shallowValue = shallowResult.stdout.trim();
  if (shallowValue !== 'true' && shallowValue !== 'false') {
    throw new Error('Git returned an invalid repository status.');
  }

  const commits = revisions.length
    ? await readCommits(primaryPath, revisions, filter, authorEmails)
    : [];
  const origin = originResult.stdout.trim();
  return {
    commits,
    shallow: shallowValue === 'true',
    authorEmails,
    ...(origin ? { origin } : {}),
  };
}

export function runGit(
  cwd: string | undefined,
  args: string[],
  options: GitOptions = {},
): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['--no-pager', ...args], {
      ...(cwd ? { cwd } : {}),
      env: gitEnvironment(),
      shell: false,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let outputBytes = 0;
    let failure: Error | undefined;

    const stop = (message: string): void => {
      if (failure) return;
      failure = new Error(message);
      child.kill('SIGKILL');
    };
    const timer = setTimeout(
      () =>
        stop(
          'Git reading timed out. Try a smaller set of repositories or check repository health.',
        ),
      options.timeoutMs ?? COMMAND_TIMEOUT_MS,
    );
    timer.unref();

    const acceptOutput = (chunk: string): boolean => {
      if (failure) return false;
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes <= (options.outputLimit ?? 1024 * 1024)) return true;
      stop(
        'Git history exceeds the supported reading limit. This project was not included; no partial history was used.',
      );
      return false;
    };

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (!acceptOutput(chunk)) return;
      try {
        if (options.onStdout) options.onStdout(chunk);
        else stdout += chunk;
      } catch {
        stop(
          'Git returned invalid or oversized commit metadata. This project was not included.',
        );
      }
    });
    child.stderr.on('data', (chunk: string) => {
      if (acceptOutput(chunk)) stderr = (stderr + chunk).slice(0, 8192);
    });
    child.on('error', () => {
      clearTimeout(timer);
      reject(
        new Error(
          'Git could not start. Check Git installation and repository access.',
        ),
      );
    });
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (
        exitCode === null ||
        !(options.allowedExitCodes ?? [0]).includes(exitCode)
      ) {
        reject(
          new Error(
            'Git could not read this project. Check repository access and local object integrity.',
          ),
        );
      } else resolve({ stdout, stderr, exitCode });
    });
    child.stdin.on('error', () => {
      // A failed Git process can close stdin before consuming revision input.
    });
    child.stdin.end(options.input ?? '');
  });
}

function gitEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  const repositoryVariables = new Set([
    'GIT_DIR',
    'GIT_COMMON_DIR',
    'GIT_WORK_TREE',
    'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
    'GIT_NAMESPACE',
    'GIT_CEILING_DIRECTORIES',
    'GIT_DISCOVERY_ACROSS_FILESYSTEM',
    'GIT_CONFIG',
    'GIT_CONFIG_COUNT',
    'GIT_CONFIG_PARAMETERS',
    'GIT_SHALLOW_FILE',
    'GIT_REPLACE_REF_BASE',
  ]);
  for (const name of Object.keys(environment)) {
    const upperName = name.toUpperCase();
    if (
      repositoryVariables.has(upperName) ||
      /^GIT_(?:CONFIG_(?:KEY|VALUE)_\d+|TRACE.*|REDIRECT_.*)$/.test(upperName)
    ) {
      delete environment[name];
    }
  }
  return {
    ...environment,
    GIT_NO_LAZY_FETCH: '1',
    GIT_ALLOW_PROTOCOL: '',
    GIT_OPTIONAL_LOCKS: '0',
    GIT_TERMINAL_PROMPT: '0',
    GIT_NO_REPLACE_OBJECTS: '1',
    GIT_PAGER: 'cat',
    LC_ALL: 'C',
    LANG: 'C',
  };
}

async function readAuthorEmails(
  paths: string[],
  filter: HistoryFilter,
): Promise<string[]> {
  if (filter.allAuthors) return [];
  if (filter.authorEmails.length)
    return [...new Set(filter.authorEmails)].sort();

  const emails = new Set<string>();
  for (const path of paths) {
    const result = await runGit(path, ['config', '--get', 'user.email'], {
      allowedExitCodes: [0, 1],
    });
    const email = result.stdout.trim();
    if (!email) {
      throw new Error(
        'No author email is configured. Set Git user.email, use --author-email, or select --all-authors.',
      );
    }
    emails.add(email);
  }
  return [...emails].sort();
}

async function readRevisions(paths: string[]): Promise<string[]> {
  const primaryPath = paths[0];
  if (!primaryPath) return [];
  const branches = await runGit(primaryPath, [
    'for-each-ref',
    '--format=%(objectname)',
    'refs/heads/',
  ]);
  const revisions = new Set(branches.stdout.split(/\r?\n/).filter(Boolean));
  for (const path of paths) {
    const head = await runGit(
      path,
      ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'],
      {
        allowedExitCodes: [0, 1],
      },
    );
    if (head.exitCode === 0) revisions.add(head.stdout.trim());
  }
  if ([...revisions].some((revision) => !OBJECT_ID.test(revision))) {
    throw new Error('Git returned an invalid branch or HEAD reference.');
  }
  return [...revisions].sort();
}

async function readCommits(
  path: string,
  revisions: string[],
  filter: HistoryFilter,
  authorEmails: string[],
): Promise<CommitRecord[]> {
  const commits = new Map<string, CommitRecord>();
  const emails = new Set(authorEmails);
  let pending = '';
  let fields: string[] = [];
  const consume = (chunk: string): void => {
    pending += chunk;
    let delimiter = pending.indexOf('\0');
    while (delimiter !== -1) {
      if (delimiter > COMMIT_FIELD_LIMIT)
        throw new Error('Oversized commit field.');
      fields.push(pending.slice(0, delimiter));
      pending = pending.slice(delimiter + 1);
      if (fields.length === 7) {
        const commit = parseCommit(fields);
        fields = [];
        if (
          commit.authoredAt >= filter.startMs &&
          commit.authoredAt < filter.endMs &&
          (filter.allAuthors || emails.has(commit.authorEmail))
        ) {
          commits.set(commit.sha, commit);
        }
      }
      delimiter = pending.indexOf('\0');
    }
    if (pending.length > COMMIT_FIELD_LIMIT)
      throw new Error('Oversized commit field.');
  };

  await runGit(
    path,
    [
      '-c',
      'i18n.logOutputEncoding=utf-8',
      'log',
      '--no-color',
      '--no-decorate',
      '--no-show-signature',
      '--no-notes',
      '-z',
      '--format=%H%x00%P%x00%an%x00%ae%x00%at%x00%s%x00%b',
      '--stdin',
      '--',
    ],
    {
      input: `${revisions.join('\n')}\n`,
      onStdout: consume,
      timeoutMs: HISTORY_TIMEOUT_MS,
      outputLimit: HISTORY_OUTPUT_LIMIT,
    },
  );
  if (pending || fields.length)
    throw new Error('Git returned incomplete commit metadata.');
  return [...commits.values()].sort(
    (left, right) =>
      right.authoredAt - left.authoredAt || compareText(left.sha, right.sha),
  );
}

function parseCommit(fields: string[]): CommitRecord {
  const [
    sha,
    rawParents,
    authorName,
    authorEmail,
    rawTimestamp,
    subject,
    body,
  ] = fields;
  if (
    sha === undefined ||
    rawParents === undefined ||
    authorName === undefined ||
    authorEmail === undefined ||
    rawTimestamp === undefined ||
    subject === undefined ||
    body === undefined
  ) {
    throw new Error('Incomplete commit fields.');
  }
  const parents = rawParents ? rawParents.split(' ') : [];
  const authoredAt = Number(rawTimestamp) * 1000;
  if (
    !OBJECT_ID.test(sha) ||
    parents.some((parent) => !OBJECT_ID.test(parent)) ||
    !/^-?\d+$/.test(rawTimestamp) ||
    !Number.isSafeInteger(authoredAt)
  ) {
    throw new Error('Invalid commit fields.');
  }
  return { sha, parents, authorName, authorEmail, authoredAt, subject, body };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
