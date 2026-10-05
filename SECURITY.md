# Security policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security problems.

Use [GitHub private vulnerability reporting](https://github.com/daczarne/streamdeck-litra/security/advisories/new) on this repository. Include:

- A short description of the issue
- Steps to reproduce (or a PoC)
- Affected versions / commit if known
- Your assessment of impact

You should hear back within a few days. There is no bug bounty for this project.

## Scope

**In scope**

- The Stream Deck plugin source and packaged `.streamDeckPlugin` artifacts from this repo
- Accidental exposure of credentials or secrets in this repository
- Dependency vulnerabilities that affect build or runtime of this plugin

**Out of scope**

- Logitech / Elgato / third-party products and firmware
- Issues that only appear when Logitech G HUB or other software holds exclusive HID access
- Social engineering, physical access, or compromised developer machines

## Secrets policy

This repository must not contain secrets. Treat the following as secrets and **never** commit them:

- API keys, access tokens, PATs, OAuth client secrets
- Passwords, private keys, certificates, `.pem` / `.p12` material
- `.env` files, credential JSON, cloud/provider config with keys
- Session cookies or webhook signing secrets

### Rules

1. **No secrets in git** — not in source, docs, examples, commits, or release assets.
2. **No secrets in the plugin package** — Stream Deck plugins run on the user’s machine; still do not embed provider credentials. Persist any future auth material only via Stream Deck global settings (encrypted on-device), never in `manifest.json` or bundled files.
3. **Push protection** — GitHub secret scanning with push protection is enabled. Do not bypass alerts; rotate any credential that was nearly or actually committed.
4. **History is forever** — deleting a file in a later commit does not remove it from history. If a secret lands in git, **rotate it immediately**, then scrub history if needed.
5. **Local machine data stays local** — do not commit personal inventories, host paths with sensitive context, or unrelated tooling snapshots.
6. **Dependencies** — keep lockfiles committed; address Dependabot / `npm audit` findings in a timely way for high/critical issues.

### If a secret is exposed

1. Revoke / rotate the credential at the provider (do this first).
2. Remove it from the working tree and stop using the leaked value.
3. Open a private report (or notify maintainers) with what leaked and when.
4. Optionally rewrite history (`git filter-repo` / BFG) and force-push if the secret remains reachable in old commits — assume anyone who cloned already has it until rotation is done.

## Supported versions

| Version                 | Supported        |
|-------------------------|------------------|
| Latest release (`v1.x`) | Yes              |
| Older tags / forks      | Best effort only |
