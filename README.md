# CommitMemo

Turn local Git history into a daily or weekly work journal.

CommitMemo is a small command-line tool for remembering what you committed across
your projects. Run it from a repository or a folder containing repositories, then
read the result in your terminal or save it as Markdown.

- Discover the current repository or repositories directly inside the current folder.
- List your commits by project, with an explicit option to include every author.
- Select today, yesterday, the current week, or a range of calendar dates.
- Include GitHub commit links and explicit pull request references when available.
- Work locally, without an account, AI provider, API key, or network request.

Git history is evidence of committed changes, not a complete record of your work.
CommitMemo does not infer accomplishments, measure productivity, or estimate hours.

## Requirements

- Node.js 24 or newer.
- Git 2.45 or newer, available on `PATH`.
- A local, non-bare Git repository with its available history.

Windows, Linux, and macOS are supported.

## Installation

Download `commitmemo-0.1.0.tgz` from the
[v0.1.0 GitHub Release](https://github.com/tutuu9/CommitMemo/releases/tag/v0.1.0),
then install the downloaded archive:

```sh
npm install --global ./commitmemo-0.1.0.tgz
commitmemo --help
```

The package is not published in the npm registry yet. Install the release archive,
or build the same package from source:

```sh
git clone https://github.com/tutuu9/CommitMemo.git
cd CommitMemo
npm ci
npm pack
npm install --global ./commitmemo-0.1.0.tgz
commitmemo --help
```

`npm pack` builds the CLI before creating the tarball. Registry installation
instructions will be added after npm publication is confirmed.

## Quick start

Run these commands from one of your Git repositories:

```sh
# Your commits today
commitmemo

# Your commits during the current calendar week
commitmemo --week

# Yesterday's commits from every author
commitmemo --yesterday --all-authors

# An inclusive range of calendar dates, rendered as Markdown
commitmemo --from 2026-10-05 --to 2026-10-11 --format markdown
```

To save a Markdown file while also showing the report in your terminal:

```sh
commitmemo --week --output reports/weekly.md
```

Missing parent directories are created. CommitMemo refuses to overwrite an
existing file. Without `--output`, it does not create a report file.

An example terminal report, using fictional data:

```text
CommitMemo

Period: 2026-10-05
Timezone: UTC
Authors: selected author emails
Projects: 1 | Commits: 2

alpha (2 commits)

- 2026-10-05 16:20 a1b2c3d4 fix: handle empty search results
- 2026-10-05 10:15 b2c3d4e5 feat: add search pagination

Based on local Git history and author dates. This is not a complete record of work.
```

## Finding projects

Inside a repository, including a nested working directory, CommitMemo reports on
that repository only. Otherwise, it checks the immediate child directories of the
current folder for repositories:

```text
work/
  alpha/       Git repository
  beta/        Git repository
  notes/       Ordinary folder; skipped
  archived/
    gamma/     Not discovered: more than one level down
```

Run from `work` for a combined report, or from `work/alpha` for just `alpha`.
Discovery does not recursively scan the disk and skips child-directory symlinks.
Linked Git worktrees are supported and grouped as one project when they share a
repository; bare repositories are not supported.

## Command options

| Option                              | Behavior                                                      |
| ----------------------------------- | ------------------------------------------------------------- |
| `--today`                           | Today's calendar date; the default period.                    |
| `--yesterday`                       | The previous calendar date.                                   |
| `--week`                            | The current calendar week, Monday through Sunday.             |
| `--from YYYY-MM-DD --to YYYY-MM-DD` | An inclusive range; both dates are required.                  |
| `--all-authors`                     | Include all authors instead of filtering to your identity.    |
| `--author-email EMAIL`              | Use an explicit author email; repeat for multiple identities. |
| `--timezone IANA`                   | Override the system time zone, for example `Europe/Warsaw`.   |
| `--format text\|markdown`           | Select the stdout format; the default is `text`.              |
| `--output PATH`                     | Also save Markdown to a new file at this path.                |
| `--help`                            | Show usage.                                                   |
| `--version`                         | Show the installed version.                                   |

Choose one period selector. Do not combine `--all-authors` with
`--author-email`.

For example, all values below are fictional:

```sh
commitmemo --week --author-email dev@example.com --author-email dev@work.example
commitmemo --today --timezone Europe/Warsaw
```

## What the report means

**Authors.** By default, each repository uses its effective Git `user.email`,
including repository-specific Git configuration. Filtering uses the commit's
author, not its committer. Explicit `--author-email` values replace this default.
If a project has no configured email, it is reported as an error rather than
silently including other authors. `--all-authors` does not require an identity.

**Dates.** Filtering uses the author date recorded in each commit. A normal rebase
therefore does not move old work into today's report just because the committer
date changed. Calendar boundaries use the system time zone unless overridden;
the report identifies its time zone. Daylight-saving changes are respected.

**History.** CommitMemo reads all local branches plus the selected worktree's
`HEAD`. A commit with the same full SHA appears once within a project, even when
several branches contain it. Merge commits remain visible and are marked as
merges. Different SHAs remain separate, including commits produced by rebasing,
cherry-picking, or squashing similar changes.

**Links.** A recognized `github.com` `origin` remote enables commit links. A
message such as `Merge pull request #42` can supply a PR link for that origin;
explicit `https://github.com/example-org/alpha/pull/42` links are also recognized,
including references to another repository. A bare `#42` is not assumed to be a
pull request. Links are derived locally and are not checked online: an unpushed
commit or a private repository may require access or have no reachable page.

**Limitations.** Uncommitted work, reviews, discussions, and work outside Git do
not appear. Only available local branch history is read; remote-tracking branches,
tags, and reflogs are not additional history sources. Shallow repositories produce
a warning because their history may be incomplete. GitHub Enterprise and other
hosting providers do not receive generated commit links in this version.

History reading has a 60-second timeout and a 64 MiB metadata limit per project.
Exceeding either limit fails that project explicitly; its history is never silently
truncated. Very large repositories may need a future optimized reading mode.

## Errors and partial reports

A failed project does not discard successfully read projects. The report identifies
failures and is marked incomplete; diagnostics go to stderr.

| Exit code | Meaning                                                                          |
| --------- | -------------------------------------------------------------------------------- |
| `0`       | Completed successfully, including an empty result.                               |
| `1`       | A project, Git operation, or output operation failed; the report may be partial. |
| `2`       | Invalid command-line arguments.                                                  |

No matching commits is a valid result, not evidence that no work happened.

## Local data and privacy

CommitMemo does not fetch, pull, switch branches, modify Git history, or send
reports to another service. An explicit `--output` writes only the requested report
and any missing parent directories.

Reports can still contain private project names and commit messages. Keep personal
reports outside version control and review them before sharing. This repository
ignores `reports/`; other repositories need their own ignore rule or an output
location outside the checkout. Examples, issue reports, and test fixtures must use
fictional or anonymized data.

## Development and contributing

```sh
npm ci
npm run check
```

The checks cover formatting, linting, types, behavior in temporary Git repositories,
and the packaged CLI. See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow and
[AGENTS.md](AGENTS.md) for coding-agent instructions.

Report vulnerabilities using the process in [SECURITY.md](SECURITY.md).
Changes are recorded in [GitHub Releases](https://github.com/tutuu9/CommitMemo/releases)
rather than a separate changelog file.

## License

[MIT](LICENSE) © 2026 TarasU.
