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
