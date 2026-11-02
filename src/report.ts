import { ensureGitAvailable, readRepository } from './git.js';
import { discoverRepositories } from './repositories.js';
import { githubRepository, pullRequestLinks } from './links.js';
import type { Options } from './options.js';
import type { Period, Report } from './types.js';

export async function collectReport(
  cwd: string,
  options: Options,
  period: Period,
): Promise<Report> {
  await ensureGitAvailable();
  const discovered = await discoverRepositories(cwd);
  if (!discovered.repositories.length && !discovered.errors.length)
    throw new Error(
      'No Git repositories found. Run inside a repository or its immediate parent directory.',
    );
  const report: Report = {
    period,
    allAuthors: options.allAuthors,
    projects: [],
    errors: [...discovered.errors],
  };
  for (const repository of discovered.repositories) {
    try {
      const history = await readRepository(repository, {
        startMs: period.start.getTime(),
        endMs: period.end.getTime(),
        allAuthors: options.allAuthors,
        authorEmails: options.authorEmails,
      });
      const base = githubRepository(history.origin);
      report.projects.push({
        name: repository.name,
        shallow: history.shallow,
        commits: history.commits.map((commit) => ({
          ...commit,
          ...(base ? { commitUrl: `${base}/commit/${commit.sha}` } : {}),
          pullRequests: pullRequestLinks(
            `${commit.subject}\n${commit.body}`,
            base,
          ),
        })),
      });
    } catch (error) {
      report.errors.push({
        project: repository.name,
        message:
          error instanceof Error
            ? error.message
            : 'Unable to read this repository.',
      });
    }
  }
  return report;
}
