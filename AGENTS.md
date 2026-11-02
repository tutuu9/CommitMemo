# Coding-agent instructions

This file is the source of truth for coding-agent guidance in CommitMemo.
Read it before changing the repository. `CLAUDE.md` points here instead of
maintaining a second set of rules.

## Project purpose

CommitMemo is a TypeScript/Node.js CLI that turns local Git history into a personal
work journal. It reads selected repositories and prints text or Markdown. It has
no server, database, account system, AI provider, or runtime network integration.

Keep code, comments, documentation, CLI text, and public repository material in
English. Follow the user's preferred language when discussing work with them.

## Structure

- `src/`: CLI arguments, repository discovery, Git history, periods, and reports.
- `src/types.ts`: shared internal data types.
- `test/`: automated tests and temporary Git-repository helpers.
- `scripts/`: package-level validation.
- `.github/`: CI and issue/PR templates.
- `dist/` and `.test-build/`: generated output; do not edit or commit.

## Setup and checks

Use Node.js 24 or newer and Git 2.45 or newer. Install dependencies with `npm ci`.

| Command                | Purpose                                       |
| ---------------------- | --------------------------------------------- |
| `npm run build`        | Compile the distributable CLI.                |
| `npm run typecheck`    | Check TypeScript without emitting files.      |
| `npm run lint`         | Run ESLint.                                   |
| `npm run format:check` | Check formatting without rewriting files.     |
| `npm run format`       | Apply formatting; inspect the resulting diff. |
| `npm test`             | Build and run the behavior tests.             |
| `npm run test:package` | Verify the packed CLI in isolation.           |
| `npm run check`        | Run all required checks.                      |

Run checks appropriate to the change during development. Before considering an
implementation ready to merge, run `npm run check` and report any checks that could
not be completed. Documentation-only changes still need a formatting check and
verification that commands and links match the implementation.

## Implementation rules

- Keep functions and modules focused. Prefer explicit data flow and small typed
  interfaces over service containers, abstract framework layers, or global state.
- Preserve strict TypeScript checks. Avoid `any` or unsafe assertions that conceal
  an unvalidated boundary.
- Invoke Git with an argument array and no shell interpolation. Treat paths,
  configuration, commit text, and remote URLs as untrusted input.
- Keep Git access, date selection, and rendering separable. Do not parse human
  terminal output when Git offers an explicit machine-readable format.
- Use author identity and author dates. Calendar ranges use a named time zone and
  must handle daylight-saving transitions.
- Read all local branches plus selected worktree `HEAD`; deduplicate identical
  full SHAs within a project. Do not infer equivalence between different SHAs.
- Show merge commits with a label. Do not turn commit counts into work hours,
  productivity scores, or invented accomplishments.
- Preserve the no-network behavior. Do not add fetch/pull, AI calls, telemetry,
  automatic report delivery, or a hosting-provider API without a deliberate scope
  change requested by the user.
- Ordinary reporting must not modify source repositories. Only an explicitly
  requested report output may be written, and existing files must not be replaced.
- Do not expose credentials from remote URLs or include machine-specific paths in
  public examples. Keep error messages actionable without dumping sensitive input.

## Testing expectations

Test observable behavior rather than implementation details. Git integration tests
must create disposable repositories with fictional identities and controlled
author/committer dates; they must not read a developer's real projects or depend on
global Git settings. Isolate Git configuration and clean up temporary files.

Cover relevant changes to author selection, period boundaries, branches, merges,
worktrees, discovery, links, partial failures, and output. Verify that a reporting
run preserves refs, the index, and working files. Package tests must execute the
built tarball without depending on source files or development dependencies.

## Public changes

Use a short task branch from `main` and small Conventional Commits. Explain the
behavior change and validation in the PR; use squash merging. Do not publish
packages, create releases, or send messages unless that action is part of the
user's requested task.

Keep README examples, CLI help, and tests consistent. Release notes live in GitHub
Releases, not a separate changelog. Never commit personal reports, credentials,
local settings, generated builds, or fixture repositories.
