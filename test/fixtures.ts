import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative, resolve } from 'node:path';

export interface ProcessResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface CommitOptions {
  email?: string;
  name?: string;
  authoredAt?: string;
  committedAt?: string;
}

const CLI_PATH = resolve('dist/cli.js');
const DEFAULT_DATE = '2026-10-15T12:00:00Z';

export class GitFixture {
  readonly root: string;
  readonly env: NodeJS.ProcessEnv;

  constructor() {
    this.root = mkdtempSync(join(tmpdir(), 'commitmemo-test-'));
    const home = this.directory('home');
    const template = this.directory('empty-template');
    const config = join(home, 'gitconfig');
    writeFileSync(config, '');
    this.env = Object.fromEntries(
      Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')),
    );
    Object.assign(this.env, {
      HOME: home,
      USERPROFILE: home,
      XDG_CONFIG_HOME: join(home, '.config'),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_SYSTEM: config,
      GIT_CONFIG_GLOBAL: config,
      GIT_TEMPLATE_DIR: template,
      GIT_TERMINAL_PROMPT: '0',
      GIT_ALLOW_PROTOCOL: 'file',
      LC_ALL: 'C',
      TZ: 'UTC',
    });
  }

  directory(name: string): string {
    const path = join(this.root, name);
    mkdirSync(path, { recursive: true });
    return path;
  }

  repository(name: string, configureAuthor = true): string {
    const path = this.directory(name);
    this.git(path, ['init', '--initial-branch=main']);
    this.git(path, ['config', 'commit.gpgsign', 'false']);
    this.git(path, ['config', 'core.autocrlf', 'false']);
    if (configureAuthor) {
      this.git(path, ['config', 'user.name', 'Taylor Example']);
      this.git(path, ['config', 'user.email', 'dev@example.com']);
    }
    return path;
  }

  commit(path: string, subject: string, options: CommitOptions = {}): string {
    const authoredAt = options.authoredAt ?? DEFAULT_DATE;
    this.git(path, ['commit', '--allow-empty', '-m', subject], {
      GIT_AUTHOR_NAME: options.name ?? 'Taylor Example',
      GIT_AUTHOR_EMAIL: options.email ?? 'dev@example.com',
      GIT_COMMITTER_NAME: 'Taylor Example',
      GIT_COMMITTER_EMAIL: 'dev@example.com',
      GIT_AUTHOR_DATE: authoredAt,
      GIT_COMMITTER_DATE: options.committedAt ?? authoredAt,
    });
    return this.git(path, ['rev-parse', 'HEAD']);
  }

  git(path: string, args: string[], env: NodeJS.ProcessEnv = {}): string {
    const result = this.run('git', args, path, env);
    if (result.status !== 0)
      throw new Error(
        `Fixture Git failed: ${args.join(' ')}\n${result.stderr}`,
      );
    return result.stdout.trim();
  }

  cli(
    path: string,
    args: string[] = [],
    env: NodeJS.ProcessEnv = {},
  ): ProcessResult {
    return this.run(process.execPath, [CLI_PATH, ...args], path, env);
  }

  run(
    command: string,
    args: string[],
    cwd: string,
    env: NodeJS.ProcessEnv = {},
  ): ProcessResult {
    const result = spawnSync(command, args, {
      cwd,
      env: { ...this.env, ...env },
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (result.error) throw result.error;
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  dispose(): void {
    if (
      dirname(this.root) !== resolve(tmpdir()) ||
      !basename(this.root).startsWith('commitmemo-test-')
    ) {
      throw new Error(
        'Refusing to remove a directory outside the fixture root.',
      );
    }
    rmSync(this.root, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  }
}

export function directoryContents(root: string): Record<string, string> {
  const result: Record<string, string> = {};
  if (!existsSync(root)) return result;
  function visit(directory: string): void {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile())
        result[relative(root, path)] = createHash('sha256')
          .update(readFileSync(path))
          .digest('hex');
    }
  }
  visit(root);
  return result;
}
