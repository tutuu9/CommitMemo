import { UsageError, type Options } from './options.js';
import type { Period } from './types.js';

function selectTimezone(timezone?: string): string {
  if (timezone !== undefined) {
    try {
      if (!timezone || /^[+-]/u.test(timezone))
        throw new Error('Invalid timezone');
      const canonical = new Intl.DateTimeFormat('en', {
        timeZone: timezone,
      }).resolvedOptions().timeZone;
      process.env.TZ = canonical;
    } catch {
      throw new UsageError(
        '--timezone must be a valid IANA timezone, such as Europe/Warsaw or UTC.',
      );
    }
  }
  return new Intl.DateTimeFormat('en').resolvedOptions().timeZone;
}

export function calendarDate(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDate(input: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(input))
    throw new UsageError('Dates must use YYYY-MM-DD.');
  const [year, month, day] = input.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  if (year < 1 || calendarDate(date) !== input)
    throw new UsageError('The date range contains an invalid calendar date.');
  return date;
}

function addDays(date: Date, days: number): Date {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  result.setHours(0, 0, 0, 0);
  return result;
}

export function createPeriod(options: Options, now = new Date()): Period {
  const timezone = selectTimezone(options.timezone);
  let start = new Date(now);
  start.setHours(0, 0, 0, 0);
  let end: Date;
  if (options.period === 'range') {
    start = parseDate(options.from!);
    const last = parseDate(options.to!);
    if (last < start)
      throw new UsageError('--to must not be earlier than --from.');
    end = addDays(last, 1);
  } else if (options.period === 'week') {
    start = addDays(start, -((start.getDay() + 6) % 7));
    end = addDays(start, 7);
  } else {
    if (options.period === 'yesterday') start = addDays(start, -1);
    end = addDays(start, 1);
  }
  const last = new Date(end.getTime() - 1);
  const firstLabel = calendarDate(start);
  const label =
    firstLabel === calendarDate(last)
      ? firstLabel
      : `${firstLabel} to ${calendarDate(last)}`;
  return { start, end, label, timezone };
}
