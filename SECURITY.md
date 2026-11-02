# Security

## Supported versions

Security fixes target `main` and the latest published release, currently `0.1.0`.
Older versions do not have a separate maintenance commitment.

## Report a vulnerability

Private vulnerability reporting is enabled for this repository. Use GitHub's
[Report a vulnerability](https://github.com/tutuu9/CommitMemo/security/advisories/new)
form to contact the maintainer privately. Do not disclose vulnerability details
or sensitive data in a public issue. There is no published security email address.

Include the affected version, operating system, Node.js and Git versions, impact,
and a minimal reproduction using a disposable repository. Do not include private
history, real credentials, personal reports, or unnecessary identifying details.

## Local data

CommitMemo reads Git metadata and can write an explicitly requested Markdown
report. It does not make network requests or send reports to another service.
Generated reports can contain private project names and commit messages; review
them before sharing and keep personal output outside version control.

Please report unexpected repository modifications, command execution from input,
credential disclosure, or unsafe output handling through the private process above.
