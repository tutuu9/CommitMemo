import { parseArgs } from 'node:util';

export class UsageError extends Error {}

export interface Options {
  action: 'report' | 'help' | 'version';
  period: 'today' | 'yesterday' | 'week' | 'range';
  from?: string;
  to?: string;
  timezone?: string;
  output?: string;
  format: 'text' | 'markdown';
  allAuthors: boolean;
  authorEmails: string[];
}

export function parseOptions(args: string[]): Options {
  let parsed;
  try {
    parsed = parseArgs({
      args,
      strict: true,
      allowPositionals: false,
      tokens: true,
      options: {
        today: { type: 'boolean' },
        yesterday: { type: 'boolean' },
        week: { type: 'boolean' },
        from: { type: 'string' },
        to: { type: 'string' },
        timezone: { type: 'string' },
        output: { type: 'string', short: 'o' },
        format: { type: 'string', default: 'text' },
        'all-authors': { type: 'boolean' },
        'author-email': { type: 'string', multiple: true },
        help: { type: 'boolean', short: 'h' },
        version: { type: 'boolean', short: 'v' },
      },
    });
  } catch {
    throw new UsageError(
      'Invalid or unknown arguments. Run commitmemo --help for usage.',
    );
  }
  const { values, tokens } = parsed;
  const seen = new Set<string>();
  for (const token of tokens) {
    if (token.kind !== 'option' || token.name === 'author-email') continue;
    if (seen.has(token.name))
      throw new UsageError(`Option --${token.name} may only be supplied once.`);
    seen.add(token.name);
  }
  const options: Options = {
    action: values.help ? 'help' : values.version ? 'version' : 'report',
    period: 'today',
    format: 'text',
    allAuthors: values['all-authors'] ?? false,
    authorEmails: [...new Set(values['author-email'] ?? [])],
  };
  if (options.action !== 'report') return options;
  const periods = [
    values.today,
    values.yesterday,
    values.week,
    values.from !== undefined || values.to !== undefined,
  ].filter(Boolean);
  if (periods.length > 1)
    throw new UsageError(
      'Choose one period: --today, --yesterday, --week, or --from with --to.',
    );
  if ((values.from === undefined) !== (values.to === undefined))
    throw new UsageError('Use --from and --to together.');
  if (values.format !== 'text' && values.format !== 'markdown')
    throw new UsageError('--format must be text or markdown.');
  if (options.allAuthors && options.authorEmails.length)
    throw new UsageError(
      '--all-authors cannot be combined with --author-email.',
    );
  if (
    options.authorEmails.some(
      (email) => email.trim() !== email || !email || /[\s\p{Cc}]/u.test(email),
    )
  )
    throw new UsageError(
      '--author-email must contain a nonempty email without whitespace.',
    );
  if (values.output !== undefined && !values.output.trim())
    throw new UsageError('--output requires a nonempty file path.');
  options.period = values.week
    ? 'week'
    : values.yesterday
      ? 'yesterday'
      : values.from !== undefined
        ? 'range'
        : 'today';
  options.format = values.format;
  if (values.from !== undefined) options.from = values.from;
  if (values.to !== undefined) options.to = values.to;
  if (values.timezone !== undefined) options.timezone = values.timezone;
  if (values.output !== undefined) options.output = values.output;
  return options;
}

export const HELP = `CommitMemo — a work journal from your local Git history

Usage: commitmemo [options]

Run inside a repository, or in a directory containing repositories.
Only direct child directories are scanned. No network access or Git changes.

Periods (choose one; defaults to today):
  --today                 Today's commits
  --yesterday             Yesterday's commits
  --week                  Current calendar week, starting Monday
  --from YYYY-MM-DD        First date, inclusive (requires --to)
  --to YYYY-MM-DD          Last date, inclusive (requires --from)

Options:
  --all-authors            Include every author (default: your Git email)
  --author-email EMAIL    Exact author email; repeat for multiple identities
  --timezone ZONE         IANA timezone (default: system timezone)
  --format text|markdown  Format for stdout (default: text)
  -o, --output FILE       Also save Markdown; existing files are never replaced
  -h, --help              Show this help
  -v, --version           Show the version

Author dates determine the period. All local branches and selected HEADs
are included, with merge commits marked and identical SHAs counted once.
`;
