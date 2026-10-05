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

### Move the plugin runtime to Node 24

Node 20 reached end-of-life in April 2026. Stream Deck 7.1+ accepts `"Nodejs": { "Version": "24" }` (we require 7.1; the Deck runs 7.6). Do this only **after** the audit fixes are done and the plugin is confirmed working on the real Deck with the real lamps, so there's a known-good point to return to.

- [ ] `manifest.json`: `Nodejs.Version` → `"24"`
- [ ] `tsconfig.json`: extend `@tsconfig/node24`; devDeps: `@tsconfig/node20` → `@tsconfig/node24`, `@types/node` `^20` → `^24`
- [ ] `.github/dependabot.yml`: update the `@types/node` ignore and its "Node 20 runtime" comment
- [ ] README: "Node.js **20**" build requirement → 24
- [ ] CI: `node-version: "20"` → `"24"` (could go with the workflows PR)
- [ ] Re-test on the Deck: every action on keys and dials, settings panels, unplug/replug

### Revisit `ref/` once we know the codebase

Audit finding 3 suggested deleting `ref/`. Kept for now: it isn't shipped or used by the build, and it holds the original author's design rationale (`scope-001.md`, `build-001.md`) and the paused Beam LX back-light research (`hid-captures/NOTES.md`, captures, inert Frida scaffolding) that a per-lamp picker or back-RGB feature would build on.

- [ ] Decide what to keep, move (e.g. into `docs/`) or delete once we're familiar with `src/`
- [ ] Fix remaining stale references: `ref/STREAMDECK_SDK_DOCS.md` (doesn't exist) and the gitignored local clones `ref/litra` / `ref/litra-rs` the docs point to
- [ ] Revisit the back-light notes if the second lamp is a Beam LX (the current Beam has no back light)
