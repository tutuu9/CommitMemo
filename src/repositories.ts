import { readdir, realpath } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { ensureGitAvailable, runGit } from './git.js';
import type { DiscoveryResult, ProjectError, Repository } from './types.js';

interface WorkingTree {
  root: string;
  commonDirectory: string;
}

export async function discoverRepositories(
  cwd: string,
): Promise<DiscoveryResult> {
  await ensureGitAvailable();
  const errors: ProjectError[] = [];
  let directory: string;
  try {
    directory = await realpath(cwd);
  } catch {
    return {
      repositories: [],
      errors: [
        {
          project: basename(cwd) || 'Current directory',
          message: 'Cannot read the selected directory.',
        },
      ],
    };
  }

  try {
    const current = await inspectWorkingTree(directory);
    if (current) return { repositories: groupWorkingTrees([current]), errors };
  } catch (error) {
    return { repositories: [], errors: [projectError(directory, error)] };
  }

  const workingTrees: WorkingTree[] = [];
  try {
    const children = await readdir(directory, { withFileTypes: true });
    const candidates = children
      .filter(
        (entry) =>
          entry.isDirectory() &&
          !entry.isSymbolicLink() &&
          entry.name !== '.git',
      )
      .map((entry) => entry.name)
      .sort();
    for (const name of candidates) {
      const childPath = join(directory, name);
      try {
        const workingTree = await inspectWorkingTree(childPath);
        if (workingTree) workingTrees.push(workingTree);
      } catch (error) {
        errors.push(projectError(childPath, error));
      }
    }
  } catch {
    errors.push({
      project: basename(directory),
      message: 'Cannot list repositories in the selected directory.',
    });
  }
  return { repositories: groupWorkingTrees(workingTrees), errors };
}

async function inspectWorkingTree(
  path: string,
): Promise<WorkingTree | undefined> {
  const status = await runGit(
    path,
    [
      'rev-parse',
      '--is-inside-work-tree',
      '--is-bare-repository',
      '--is-inside-git-dir',
    ],
    { allowedExitCodes: [0, 128] },
  );
  if (status.exitCode !== 0) {
    if (status.stderr.includes('not a git repository')) return undefined;
    throw new Error(
      'Git could not inspect this project. Check repository access and ownership.',
    );
  }

  const [insideWorkingTree, bare, insideGitDirectory] = status.stdout
    .trim()
    .split(/\r?\n/);
  if (bare === 'true')
    throw new Error(
      'Bare repositories are not supported. Use a working-tree checkout.',
    );
  if (insideWorkingTree !== 'true') {
    if (insideGitDirectory === 'true') {
      throw new Error(
        'Run CommitMemo from a working tree, not a Git metadata directory.',
      );
    }
    return undefined;
  }

  const rootResult = await runGit(path, ['rev-parse', '--show-toplevel']);
  const commonResult = await runGit(path, [
    'rev-parse',
    '--path-format=absolute',
    '--git-common-dir',
  ]);
  try {
    const [root, commonDirectory] = await Promise.all([
      realpath(rootResult.stdout.trim()),
      realpath(commonResult.stdout.trim()),
    ]);
    return { root, commonDirectory };
  } catch {
    throw new Error('The working tree or its Git metadata is not accessible.');
  }
}

function groupWorkingTrees(workingTrees: WorkingTree[]): Repository[] {
  const projects = new Map<string, Set<string>>();
  for (const { root, commonDirectory } of workingTrees) {
    const id =
      process.platform === 'win32'
        ? commonDirectory.toLowerCase()
        : commonDirectory;
    const paths = projects.get(id) ?? new Set<string>();
    paths.add(root);
    projects.set(id, paths);
  }
  return [...projects.entries()]
    .map(([id, paths]) => {
      const sortedPaths = [...paths].sort();
      return { id, name: basename(sortedPaths[0] ?? id), paths: sortedPaths };
    })
    .sort(
      (left, right) =>
        compareText(left.name, right.name) || compareText(left.id, right.id),
    );
}

function projectError(path: string, error: unknown): ProjectError {
  return {
    project: basename(path),
    message:
      error instanceof Error ? error.message : 'Cannot inspect this project.',
  };
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
