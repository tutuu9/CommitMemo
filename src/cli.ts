#!/usr/bin/env node
import { mkdir, open, readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { HELP, parseOptions, UsageError } from './options.js';
import { createPeriod } from './periods.js';
import { collectReport } from './report.js';
import { renderMarkdown, renderText, safeText } from './renderers.js';

async function saveMarkdown(path: string, content: string): Promise<void> {
  try {
    const absolute = resolve(path);
    await mkdir(dirname(absolute), { recursive: true });
    const file = await open(absolute, 'wx', 0o600);
    try {
      await file.writeFile(content, 'utf8');
    } finally {
      await file.close();
    }
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EEXIST')
      throw new Error(
        'Output file already exists. Choose a new file; existing files are never overwritten.',
        { cause: error },
      );
    throw new Error(
      'Unable to save the Markdown report. Check the output directory and permissions.',
      { cause: error },
    );
  }
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  if (options.action === 'help') {
    process.stdout.write(HELP);
    return;
  }
  if (options.action === 'version') {
    const metadata = JSON.parse(
      await readFile(new URL('../package.json', import.meta.url), 'utf8'),
    ) as { version: string };
    process.stdout.write(`${metadata.version}\n`);
    return;
  }
  const period = createPeriod(options);
  const report = await collectReport(process.cwd(), options, period);
  const output =
    options.format === 'markdown' ? renderMarkdown(report) : renderText(report);
  process.stdout.write(output);
  for (const error of report.errors)
    process.stderr.write(
      `${safeText(error.project)}: ${safeText(error.message)}\n`,
    );
  if (options.output !== undefined)
    await saveMarkdown(options.output, renderMarkdown(report));
  if (report.errors.length) process.exitCode = 1;
}

process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') return;
  process.stderr.write('Unable to write the report to stdout.\n');
  process.exitCode = 1;
});

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'Unable to generate the report.';
  process.stderr.write(`CommitMemo: ${safeText(message)}\n`);
  process.exitCode = error instanceof UsageError ? 2 : 1;
});
