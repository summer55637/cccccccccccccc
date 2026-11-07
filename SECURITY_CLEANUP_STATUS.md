# Security cleanup status

This document records the security-only changes on the `security/remove-exposed-credentials` branch.

## Branch safety

- The original `main` branch was not modified.
- `backup/pre-security-cleanup-2026-11-06` is an unchanged private snapshot of the original repository state at the time of backup.
- This backup branch intentionally still contains the original data. Keep the repository private and restrict collaborator access. Do not deploy or share this branch.
- `security/remove-exposed-credentials` is the working branch for cleanup.

## Completed on this branch

- Removed `local_accounts.json` from the latest branch tree.
- Added `.gitignore` rules for local account/session data, environment files, credential/token files, local databases, logs, dependencies, and generated build output.

## Latest read-only repository audit (2026-11-07)

The audit was performed against the four current branch heads without printing or copying any credential values into this report.

- `main` and `backup/pre-security-cleanup-2026-11-06` still point to the original commit `d82d9675f9b304e09b582c768bb30be148b53871`. Both current trees still contain `local_accounts.json`.
- The latest trees of `security/remove-exposed-credentials` and `offline/local-character-system` no longer contain `local_accounts.json`. The GitHub path-history query still reports its original commit `d82d9675f9b304e09b582c768bb30be148b53871`; deleting the file from a branch tip did not erase its historical Git object.
- `server.js` is byte-identical across all four current branch heads. The previously identified hard-coded pack-encryption key, token wrapping/logging, permissive CORS and token-derived WebSocket fallback therefore remain present and unresolved.
- A targeted scan of the 22 current offline production source files (`.js`, `.html`, `.css`) found no matches for private-key blocks, common GitHub/AWS token formats, JWT-shaped values, or long literal values assigned to common credential fields. This is a narrow source scan, not a full secret audit: it does not scan Git history, original asset packs, all other repository files, or deployment artifacts.
- The offline CI now includes this targeted credential scan in `offline/tests/offline-boundary.test.mjs`. A clean result only means the scanned offline source set passed these patterns; it does not clear the known historical or `server.js` findings.

A maintainer-facing rotation procedure is recorded in [docs/SECURITY_ROTATION_CHECKLIST.md](docs/SECURITY_ROTATION_CHECKLIST.md). It is a runbook only; no external credentials have been changed by this commit.\n\n## Important: not yet resolved

1. The earlier Git commit history still contains the removed account file. Removing a file from the latest tree does not erase it from Git history.
2. The original backup branch intentionally preserves the original state. It still contains the file and must remain private and restricted.
3. Credentials from the exposed account file must be treated as compromised. Rotate/revoke applicable passwords, session tokens, API tokens, and other credentials at the service that issued them. Do not paste replacement secrets into GitHub or chat.
4. Static inspection of `server.js` found a hard-coded pack encryption key, an endpoint that wraps it using caller-supplied tokens without validating those tokens, and logging of submitted tokens. Treat the hard-coded key and any associated tokens as exposed; rotate/replace them before any use.
5. The same server code also enables permissive CORS and accepts WebSocket authentication using a token-derived fallback identity. These require a separate security redesign before any server is exposed to the Internet.

## Before any public release

- Keep this repository private while cleanup is incomplete.
- Do not publish the backup branch.
- Rotate/revoke exposed credentials first.
- Decide whether to preserve the original backup as a separately encrypted offline archive before rewriting Git history. History rewriting must be planned across all branches/tags and any external clones.
- Run a full secret scan over every branch and tag after history cleanup.
- Review licensing and authorization separately before publishing game code or assets.

This is a static review and repository cleanup record, not a claim that the application has passed a runtime security audit.
