# CLAUDE.md

- [Project](#project)
- [Layout](#layout)
- [Commands](#commands)
- [Runtime and toolchain](#runtime-and-toolchain)
- [Supply chain](#supply-chain)
- [Testing on the hardware](#testing-on-the-hardware)
- [Workflow](#workflow)
- [Style](#style)

## Project

A Stream Deck plugin that controls Logitech Litra lights (Glow, Beam, Beam LX front light) over USB HID, without Logitech's software. It is a fork of a repository its original author abandoned, so the code and the notes in `ref/` describe decisions nobody here made: read them before changing behavior that looks odd.

Daniel's setup: macOS on a Mac Studio, a Stream Deck + XL running Stream Deck 7.6, and two Litra Beams. The Beam is the plugin's main target: tests, fakes and defaults use its real values. Support for the Beam LX comes next, and the Glow is an afterthought. Logi Options+ and G HUB are not installed and won't be.

The plugin is for Daniel's own use and isn't published. It runs linked from the repo, never installed, so the Deck runs whatever is built from the checked-out branch. That is intended: a change takes effect on the next build and restart. `npm run pack` and the Packaging section of `README.md` stay, in case the plugin is published one day ([#21]).

## Layout

- `src/plugin.ts` registers the actions.
- `src/litra-manager.ts` is the only module that talks to the `litra` library. Actions import from it, never from `litra` directly. It re-scans the lamps on every call, applies each operation to every connected lamp, and always closes the HID handles.
- `src/actions/` holds the Power, Brightness and Temperature actions.
- Unit tests sit next to the file they test (`litra-manager.test.ts`), and run with Vitest. They replace `litra` and `@elgato/streamdeck` with `vi.mock`, so they need no lamps and create no `logs/` folder. `src/test-support/` holds the shared fakes, such as a lamp whose HID handle records every call. A bug the tests find gets an `it.fails` test stating the intended behavior, linked to its own issue ([#27]).
- `com.daczarne.litra.sdPlugin/` is the plugin folder: `manifest.json`, the settings pages in `ui/` (with the vendored `sdpi-components` in `ui/vendor/`), and the icons in `imgs/`. `bin/` and `node_modules/` inside it are build output.
- `scripts/check-ui.mjs` guards the settings pages (see [Supply chain](#supply-chain)). `scripts/generate-icons.mjs` generates the icons.
- `ref/` holds the original author's design notes and the paused Beam LX back-light research. It isn't shipped or built ([#12]).

## Commands

```shell
n auto                    # switch to the Node version in .node-version
npm ci --ignore-scripts   # install from the lockfile, without install scripts
npm run build             # bundle src/ into the plugin folder and copy node-hid next to it
npm run check:ui          # no remote resources in ui/*.html, vendored file matches its hash
npm run validate          # check:ui, build, streamdeck validate
npm run pack              # check:ui, build, write release/com.daczarne.litra.streamDeckPlugin
npm run link              # link the plugin folder into Stream Deck
npm run watch             # rebuild and restart the plugin on change
npx tsc --noEmit -p .     # type-check only
npm test                  # run the unit tests
```

## Runtime and toolchain

- The plugin runs on Node 24, set by `Nodejs.Version` in `manifest.json`. Stream Deck downloads that runtime into `~/Library/Application Support/com.elgato.StreamDeck/NodeJS/`, whose `manifest.json` lists the exact version (24.13.1 when this was written). `tsconfig.json` extends `@tsconfig/node24`, and `@types/node` follows that runtime's minor version (24.13), not the Node used to build.
- The Node used to build is pinned in `.node-version` (24.15.0), and `n auto` switches to it. `package.json` declares the same version in `engines`, and `engine-strict=true` in `.npmrc` makes `npm ci` refuse any other Node. CI reads `.node-version` too.
- The repo pins TypeScript 6.0, which no longer loads `@types/*` automatically, hence `"types": ["node"]` in `tsconfig.json`. `.vscode/settings.json` points the editor at the repo's TypeScript, so the editor and the build check types with the same version.
- `node-hid` ships native binaries, so Rollup keeps it external and `copyNativeRuntime` in `rollup.config.mjs` copies it and its runtime dependencies into the plugin folder. A dependency missing from that list breaks the installed plugin but not a linked one, because a linked plugin also finds the repo's top-level `node_modules`. Since the plugin only runs linked, that list is untested ([#21]).

## Supply chain

Daniel treats supply-chain risk as a hard requirement:

- No remote code. The settings pages load `sdpi-components` from `ui/vendor/`, pinned by hash in `scripts/check-ui.mjs`. The "Third-party code" section of `README.md` describes how to update it. Never install `sdpi-components` from npm: that package belongs to an unrelated maintainer.
- Install with `--ignore-scripts`, pin versions, and prefer local copies with recorded hashes. Flag any new dependency, remote resource or broad OS permission, and offer a narrower alternative.
- `package.json` declares exact versions only, never ranges. The project `.npmrc` sets `save-exact=true`, so `npm install <package>` records an exact version, and `ignore-scripts=true`, so no install runs install scripts even without the flag. Every upgrade is its own deliberate change: `npm install <package>@<version>`, then a review of the lockfile diff. Exact versions don't pin transitive dependencies, only the lockfile does, so it stays committed and installs use `npm ci`.
- GitHub Actions are pinned to full commit SHAs, with the version as a trailing comment, checked against the release tag ([#30]). Like npm upgrades, their updates are made by hand. Dependabot was removed ([#40]) because it proposed upgrades that no tests could check. It may come back once the tests from [#27] exist.

## Testing on the hardware

- Build, enable developer mode (`npx streamdeck dev`), `npm run link`, then `npx streamdeck restart com.daczarne.litra`. The actions appear under the Litra category. Developer mode stays on.
- Plugin logs are in `com.daczarne.litra.sdPlugin/logs/`.
- Test the settings pages with Wi-Fi off, to prove they load nothing remote.
- On the Stream Deck + XL's USB hub (7.5 W), the Beam caps its brightness at about 70%. Plugged into the Mac, it reaches 100%.
- Opening a Litra needs no macOS permission. Opening a mouse or keyboard over HID needs Input Monitoring, which Daniel only grants temporarily ([#3]).

## Workflow

- Work happens on a branch, created with `git switch -c`. Branch names are flat kebab-case, without `/`.
- Commit messages explain the why and end with the `Co-Authored-By` trailer for Claude. Commit only when Daniel asks. Pushing and merging are Daniel's.
- `.github/workflows/main.yaml` runs the type check, the unit tests, `npm run validate`, Markdown lint and CSpell on every pull request and on `main`. Locally, the same checks run in two parts, both as Claude commands and as VS Code tasks: `/lint` and the `Lint` task run the linters (everything but the unit tests), `/test` and the `Test` task run the unit tests, and `/ci` and the `CI` task run both. `Test` is VS Code's default test task, so **Tasks: Run Test Task** starts it.
- Pull requests are squash-merged, so their title and description become the commit on `main`. Write them with the `pr-description` skill.
- Work that doesn't belong in the current branch becomes a GitHub issue, drafted with the `github-issues` skill and posted only when Daniel asks.

## Style

`docs/style_guide.md`, `.editorconfig`, the Markdown lint configuration and CSpell (with the dictionaries in `.cspell/`) are the authority on style.

[#3]: https://github.com/daczarne/streamdeck-litra/issues/3
[#12]: https://github.com/daczarne/streamdeck-litra/issues/12
[#21]: https://github.com/daczarne/streamdeck-litra/issues/21
[#27]: https://github.com/daczarne/streamdeck-litra/issues/27
[#30]: https://github.com/daczarne/streamdeck-litra/issues/30
[#40]: https://github.com/daczarne/streamdeck-litra/pull/40
