# Sessions

Working to-do list until we move to GitHub issues.

## To-do

### Content-Security-Policy for the settings pages

Follow-up to audit finding 2 (vendored sdpi-components). Defence in depth: block any remote script or connection even if one is re-added by accident.

- [ ] Move the shared key-vs-dial snippet from `ui/brightness.html` and `ui/temperature.html` into a local `ui/controller-toggle.js`, so scripts don't need `'unsafe-inline'`
- [ ] Add `<meta http-equiv="Content-Security-Policy">` to all three pages: only local scripts, `connect-src ws://localhost:*` (Stream Deck's Property Inspector socket), `style-src 'unsafe-inline'` likely needed for Lit
- [ ] Test in Stream Deck with Wi-Fi off. Risk: pages load from `file://`, where Chromium's handling of `'self'` is unreliable; ship only if every panel still renders, saves settings and switches key/dial controls

### Pin GitHub Actions in `.github/workflows/build-release.yml`

Same supply-chain risk as finding 2, one level up.

- [ ] Pin every third-party action to a full commit SHA (with the version as a comment): `actions/checkout@v4`, `actions/setup-node@v4`, `actions/upload-artifact@v4`, `actions/download-artifact@v4`, `softprops/action-gh-release@v2`
- [ ] Rename the stale `com.ssheppdev.litra.streamDeckPlugin` artifact name/path to `com.daczarne.litra.streamDeckPlugin`
- [ ] Consider having Dependabot track `github-actions` so pinned SHAs get update PRs

### Revisit `ref/` once we know the codebase

Audit finding 3 suggested deleting `ref/`. Kept for now: it isn't shipped or used by the build, and it holds the original author's design rationale (`scope-001.md`, `build-001.md`) and the paused Beam LX back-light research (`hid-captures/NOTES.md`, captures, inert Frida scaffolding) that a per-lamp picker or back-RGB feature would build on.

- [ ] Decide what to keep, move (e.g. into `docs/`) or delete once we're familiar with `src/`
- [ ] Fix remaining stale references: `ref/STREAMDECK_SDK_DOCS.md` (doesn't exist) and the gitignored local clones `ref/litra` / `ref/litra-rs` the docs point to
- [ ] Revisit the back-light notes if the second lamp is a Beam LX (the current Beam has no back light)
