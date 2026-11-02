# Contributing to CommitMemo

Thanks for helping make CommitMemo useful and dependable. The project is a small,
local CLI for reviewing Git history. Changes should preserve that focus.

## Discuss a change

Use a bug report for incorrect behavior and a feature request for a new use case.
Before starting a substantial feature, agree on its scope in an issue. Include
concrete acceptance criteria: the input, expected result, and relevant edge cases.

Use fictional or anonymized repository names, paths, author emails, and commit
messages. Do not attach a private repository or an unreviewed personal report.
For vulnerabilities, follow [SECURITY.md](SECURITY.md) instead of a public issue.

## Set up

Install Node.js 24 or newer and Git 2.45 or newer, then run:

```sh
npm ci
npm run check
```

To build and inspect CLI help:

```sh
npm run build
node dist/cli.js --help
```

Read [AGENTS.md](AGENTS.md) for the source layout, individual checks, and testing
constraints. It applies to human and agent-assisted changes alike.

The development dependency override for `minimatch` keeps the lint toolchain on a
version patched for [GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).
Remove the override once the parent dependencies require a patched version.

## Make a pull request

1. Start a short branch from `main`, such as `feat/date-range`, `fix/merge-links`,
   or `docs/quick-start`.
2. Make focused changes and add behavior tests when they are needed to verify the
   change. Use temporary Git repositories with controlled dates and identities.
3. Use small [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/),
   for example `fix: preserve author dates when filtering history`.
4. Run `npm run check`. Keep generated files, local reports, and credentials out
   of the diff.
5. Open a PR describing the problem, resulting behavior, linked issue, and checks.
   Call out limitations or checks you could not run.

PRs are squash-merged after required CI checks pass. Use a Conventional Commit
title so the resulting commit clearly describes the change. A separate human
approval is not required for the sole maintainer's own PRs.

## Releases

Versions follow semantic versioning, starting with `0.1.0`, and use matching Git
tags such as `v0.1.0`. GitHub Releases contain the changelog and known limitations.
An npm release must use a verified package name owned by the publisher; a matching
GitHub username does not establish npm ownership.

Contributions are distributed under the repository's [MIT license](LICENSE).
