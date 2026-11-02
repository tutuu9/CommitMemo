import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseOptions } from '../src/options.js';
import { createPeriod } from '../src/periods.js';
import { githubRepository, pullRequestLinks } from '../src/links.js';
import { renderMarkdown, renderText } from '../src/renderers.js';
import type { Report } from '../src/types.js';

test('CLI defaults and explicit author selection', () => {
  assert.equal(parseOptions([]).period, 'today');
  assert.equal(parseOptions([]).format, 'text');
  assert.deepEqual(
    parseOptions([
      '--author-email',
      'dev@example.com',
      '--author-email',
      'other@example.com',
    ]).authorEmails,
    ['dev@example.com', 'other@example.com'],
  );
  for (const args of [
    ['--today', '--week'],
    ['--from', '2026-10-01'],
    ['--all-authors', '--author-email', 'dev@example.com'],
    ['--format', 'html'],
    ['--unknown'],
    ['somewhere'],
  ])
    assert.throws(() => parseOptions(args));
});

test('calendar periods include whole dates and start weeks on Monday', () => {
  const now = new Date('2026-11-01T14:00:00Z');
  const week = createPeriod(parseOptions(['--week', '--timezone', 'UTC']), now);
  assert.equal(week.start.toISOString(), '2026-10-26T00:00:00.000Z');
  assert.equal(week.end.toISOString(), '2026-11-02T00:00:00.000Z');
  const yesterday = createPeriod(
    parseOptions(['--yesterday', '--timezone', 'UTC']),
    new Date('2027-01-01T12:00:00Z'),
  );
  assert.equal(yesterday.start.toISOString(), '2026-12-31T00:00:00.000Z');
  const range = createPeriod(
    parseOptions([
      '--from',
      '2024-02-29',
      '--to',
      '2024-02-29',
      '--timezone',
      'UTC',
    ]),
    now,
  );
  assert.equal(range.end.toISOString(), '2024-03-01T00:00:00.000Z');
  for (const dates of [
    ['2026-02-30', '2026-03-01'],
    ['2026-10-02', '2026-10-01'],
  ]) {
    assert.throws(() =>
      createPeriod(
        parseOptions([
          '--from',
          dates[0]!,
          '--to',
          dates[1]!,
          '--timezone',
          'UTC',
        ]),
        now,
      ),
    );
  }
  assert.throws(() =>
    createPeriod(parseOptions(['--timezone', 'Not/AZone']), now),
  );
});

test('calendar days respect daylight saving changes', () => {
  const previous = process.env.TZ;
  try {
    for (const [day, hours] of [
      ['2026-03-29', 23],
      ['2026-10-25', 25],
    ] as const) {
      const period = createPeriod(
        parseOptions([
          '--from',
          day,
          '--to',
          day,
          '--timezone',
          'Europe/Warsaw',
        ]),
      );
      assert.equal(
        (period.end.getTime() - period.start.getTime()) / 3_600_000,
        hours,
      );
    }
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
});

test('GitHub links normalize remotes and never expose credentials', () => {
  for (const remote of [
    'git@github.com:example/project.git',
    'ssh://git@github.com/example/project.git',
    'https://secret:token@github.com/example/project.git',
  ]) {
    assert.equal(
      githubRepository(remote),
      'https://github.com/example/project',
    );
  }
  for (const remote of [
    undefined,
    'https://github.com.evil.test/example/project',
    '/local/project',
    'git@work:example/project.git',
  ]) {
    assert.equal(githubRepository(remote), undefined);
  }
});

test('midnight DST transitions do not leak the next calendar day', () => {
  const period = createPeriod(
    parseOptions([
      '--from',
      '2018-11-04',
      '--to',
      '2018-11-04',
      '--timezone',
      'America/Sao_Paulo',
    ]),
  );
  assert.equal(period.start.toISOString(), '2018-11-04T03:00:00.000Z');
  assert.equal(period.end.toISOString(), '2018-11-05T02:00:00.000Z');
  assert.equal(period.label, '2018-11-04');
  const skipped = createPeriod(
    parseOptions([
      '--from',
      '2011-12-29',
      '--to',
      '2011-12-29',
      '--timezone',
      'Pacific/Apia',
    ]),
  );
  assert.equal(skipped.label, '2011-12-29');
});

test('only explicit PR references become PR links', () => {
  const base = 'https://github.com/example/project';
  assert.deepEqual(pullRequestLinks('Fix #12 (#13)', base), []);
  assert.deepEqual(
    pullRequestLinks('Merge pull request #42 from example/topic', base),
    [{ number: 42, url: `${base}/pull/42` }],
  );
  assert.deepEqual(
    pullRequestLinks(
      'See https://github.com/another/project/pull/7 and https://github.com/another/project/pull/7',
      base,
    ),
    [{ number: 7, url: 'https://github.com/another/project/pull/7' }],
  );
  assert.deepEqual(pullRequestLinks('Merge pull request #42', undefined), []);
});

test('both renderers retain evidence and sanitize untrusted subjects', () => {
  const report: Report = {
    period: createPeriod(
      parseOptions([
        '--from',
        '2026-10-01',
        '--to',
        '2026-10-01',
        '--timezone',
        'UTC',
      ]),
    ),
    allAuthors: true,
    projects: [
      {
        name: '<example>',
        shallow: true,
        commits: [
          {
            sha: 'a'.repeat(40),
            parents: ['b', 'c'],
            authorName: 'Example Developer',
            authorEmail: 'private@example.com',
            authoredAt: Date.parse('2026-10-01T12:30:00Z'),
            subject:
              '\u001b[31mFix [title](javascript:alert) <script>\u001b[0m',
            body: '',
            pullRequests: [],
          },
        ],
      },
    ],
    errors: [],
  };
  const plain = renderText(report);
  const markdown = renderMarkdown(report);
  for (const output of [plain, markdown]) {
    assert.match(output, /merge/i);
    assert.match(output, /Example Developer/);
    assert.match(output, /shallow/i);
    assert.doesNotMatch(output, /private@example.com/);
    assert.equal(output.includes('\u001b'), false);
  }
  assert.doesNotMatch(markdown, /<script>|\[title\]\(javascript:/);
});
