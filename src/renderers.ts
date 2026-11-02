import { stripVTControlCharacters } from 'node:util';
import type { Report, ReportCommit } from './types.js';

export function safeText(text: string): string {
  return stripVTControlCharacters(text)
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
}

function markdown(text: string): string {
  return safeText(text)
    .replace(/&/gu, '&amp;')
    .replace(/</gu, '&lt;')
    .replace(/>/gu, '&gt;')
    .replace(/[\\`*_{}[\]()#+.!|~-]/gu, '\\$&');
}

function timestamp(milliseconds: number, timezone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(milliseconds));
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')} ${value('hour')}:${value('minute')}`;
}

function commitLine(
  commit: ReportCommit,
  report: Report,
  isMarkdown: boolean,
): string {
  const escape = isMarkdown ? markdown : safeText;
  const sha = commit.sha.slice(0, 8);
  const reference =
    isMarkdown && commit.commitUrl ? `[${sha}](${commit.commitUrl})` : sha;
  const merge = commit.parents.length > 1 ? ' [merge]' : '';
  const author = report.allAuthors ? ` — ${escape(commit.authorName)}` : '';
  let line = `- ${timestamp(commit.authoredAt, report.period.timezone)} ${reference}${merge} ${escape(commit.subject)}${author}`;
  if (!isMarkdown && commit.commitUrl) line += ` (${commit.commitUrl})`;
  for (const pr of commit.pullRequests)
    line += isMarkdown
      ? ` · [PR #${pr.number}](${pr.url})`
      : ` · PR #${pr.number}: ${pr.url}`;
  return line;
}

function render(report: Report, isMarkdown: boolean): string {
  const escape = isMarkdown ? markdown : safeText;
  const total = report.projects.reduce(
    (sum, project) => sum + project.commits.length,
    0,
  );
  const lines = [
    `${isMarkdown ? '# ' : ''}CommitMemo${report.errors.length ? ' — incomplete report' : ''}`,
    '',
    `Period: ${report.period.label}`,
    `Timezone: ${report.period.timezone}`,
    `Authors: ${report.allAuthors ? 'all authors' : 'selected author emails'}`,
    `Projects: ${report.projects.length} | Commits: ${total}`,
    '',
  ];
  for (const project of report.projects) {
    lines.push(
      `${isMarkdown ? '## ' : ''}${escape(project.name)} (${project.commits.length} commits)`,
      '',
    );
    if (project.shallow)
      lines.push('Note: shallow repository; older history may be missing.', '');
    if (!project.commits.length) lines.push('No matching commits.', '');
    else
      lines.push(
        ...project.commits.map((commit) =>
          commitLine(commit, report, isMarkdown),
        ),
        '',
      );
  }
  if (report.errors.length) {
    lines.push(`${isMarkdown ? '## ' : ''}Unavailable projects`, '');
    for (const error of report.errors)
      lines.push(`- ${escape(error.project)}: ${escape(error.message)}`);
    lines.push('');
  }
  lines.push(
    'Based on local Git history and author dates. This is not a complete record of work.',
    '',
  );
  return lines.join('\n');
}

export const renderText = (report: Report): string => render(report, false);
export const renderMarkdown = (report: Report): string => render(report, true);
