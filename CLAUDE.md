# CLAUDE.md

- [Project](#project)
- [Read before changing things](#read-before-changing-things)
- [Layout](#layout)
- [Commands](#commands)
- [Runtime and toolchain](#runtime-and-toolchain)
- [Supply chain](#supply-chain)
- [Testing on the hardware](#testing-on-the-hardware)
- [Workflow](#workflow)
- [Style](#style)

## Project

A Stream Deck plugin that controls Logitech Litra lights (Glow, Beam, Beam LX front light) over USB HID, without Logitech's software. It is a fork of a repository its original author abandoned, so the code and the notes in `ref/` describe decisions nobody here made: read them before changing behavior that looks odd.

The plugin is made and checked on macOS, with a Stream Deck + XL running Stream Deck 7.6 and two Litra Beams. The Beam is the plugin's target: tests, fakes and defaults use its real values. Other models come one at a time, the Beam LX next, and no work goes into the Glow (see "Supported lamps" in `docs/contributing.md`). The plugin needs neither Logi Options+ nor G HUB, and is checked without them installed.

The plugin isn't published. It runs linked from the repo, never installed, so the Deck runs whatever is built from the checked-out branch. That is intended: a change takes effect on the next build and restart. `npm run pack` and the Packaging section of `README.md` stay, in case the plugin is published one day ([#21]).

## Read before changing things

- `docs/contributing.md`: how work is done here. Changes go through pull requests, features come with their tests, and dependencies are pinned. It also says which unused code stays. This file only adds what is specific to Claude.
- `docs/style_guide.md`: the conventions the linters don't enforce (see [Style](#style)).
- `docs/elgato_sdk/`: what the Stream Deck SDK offers and what it doesn't (the interactions a dial receives, its layouts, how Stream Deck loads the settings pages, its logger, what a key shows), checked against the installed version. Read it before designing how an action behaves on the Deck, and add to it when a change finds out something new about the SDK.
- `docs/logging.md`: what the plugin logs, at which level and with what in each message, where the logs are written and how the files are rotated. A change that logs something new adds it to the contract there.
- `docs/manual_testing/`: the checks that only the Deck can prove, one document per area. Before asking for a test on the Deck, point to the matching document. When a feature needs new manual checks, add them there.
- `ref/`: the original author's notes. Read them before changing behavior that looks odd.

## Layout

- `src/plugin.ts` registers the actions.
- `src/litra-manager.ts` is the only module that talks to the `litra` library. Actions import from it, never from `litra` directly. It re-scans the lamps on every call, applies each operation to every connected lamp, and always closes the HID handles. After every operation that writes to the lamps, it calls the listeners registered with `onLampsChanged`, which is how the Power keys and the lamp screens follow changes made by any action. It logs what each lamp did, while the actions log what was pressed or turned (see `docs/logging.md`).
- `src/logging.ts` holds the logger every module logs through, instead of `streamDeck.logger`, and the file target that writes it to `logs/litra.log`, rotated by size rather than on every start (see `docs/logging.md`).
- `src/actions/` holds the Power, Brightness and Temperature actions, the lamp screens (`lamp-screens.ts`) that the Brightness and Temperature dials share, and the actions' settings (`settings.ts`): each setting's default and valid values, against which every action reads what Stream Deck sends.
- Unit tests sit next to the file they test (`litra-manager.test.ts`), and run with Vitest. They replace `litra`, `@elgato/streamdeck` and `src/logging.ts` with `vi.mock`, so they need no lamps and create no `logs/` folder. `src/test-support/` holds the shared fakes, such as a lamp whose HID handle records every call, and `at`, which the tests use to read an array element, and which fails the test when the element is missing, instead of using `!`.
- `src/integration/` holds the integration tests, which run the real `litra` against emulated lamps, under `npm test` with the unit tests: `litra.test.ts` checks its protocol, and `actions.test.ts` drives the actions through the real `litra-manager`. `src/test-support/emulated-litra.ts` is a lamp that keeps its power, brightness and temperature and answers HID reports as the Beams were measured to (`scripts/probes/README.md`), cap included, and `fake-node-hid.ts` puts emulated lamps in `node-hid`'s place. The action tests start `plugin.ts` afresh for every test, and `fake-deck.ts` places keys and dials for its actions and sends them what the user does, waiting with Vitest's fake timers for everything each interaction sets off. They mock their fakes with `vi.doMock` after `vi.resetModules()`, because a module mocked with `vi.mock` outlives the reset, and the plugin would keep the first test's fakes. `vitest.config.mjs` points `litra` at its ESM build, the one the plugin bundles, and has Vitest load it, since otherwise `vi.mock` can't reach its import of `node-hid`. Each integration test file checks that it got the fake `node-hid` before any test runs: without it, the tests would write to the lamps plugged in.
- `browser-tests/` holds the browser tests, which load each settings page from the plugin folder in a headless Chrome. They check the controls each page shows, the settings it sends, and that its Content-Security-Policy refuses anything remote. `browser-tests/support/` drives Chrome over a pipe rather than a debugging port, and fakes Stream Deck's WebSocket. Chrome is found at `CHROME_PATH`, or where macOS or Linux usually install it. The tests run apart from the unit tests, with their own Vitest config, so `npm test` still needs nothing installed.
- `com.daczarne.litra.sdPlugin/` is the plugin folder: `manifest.json`, the settings pages in `ui/` (with the vendored `sdpi-components` in `ui/vendor/`), the icons in `imgs/`, and the custom dial layouts in `layouts/`. `bin/` and `node_modules/` inside it are build output.
- `scripts/check-ui.mjs` guards the settings pages (see [Supply chain](#supply-chain)). `scripts/check-docs.mjs` checks that every function, class, method and constructor has a doc comment (see the "Doc comments" section of `docs/style_guide.md`). `scripts/generate-icons.mjs` renders the plugin's icons from the glyphs of `@daczarne/streamdeck-icons` (`daczarne/streamdeck-icons`), which also holds the palette and the Litra icon pack. A change to a glyph is made there, then taken here by updating the commit the dependency is pinned to and regenerating the icons. `scripts/probes/` holds scripts that ask the lamps directly how they behave, run by hand, with a README on how to run them and read their output.
- `ref/` holds the original author's design notes and the paused Beam LX back-light research. It isn't shipped or built ([#12]).
- `docs/` holds the documents listed in [Read before changing things](#read-before-changing-things).

## Commands

```shell
n auto                    # switch to the Node version in .node-version
npm ci --ignore-scripts   # install from the lockfile, without install scripts
npm run build             # bundle src/ into the plugin folder and copy node-hid next to it
npm run check:docs        # every function, class, method and constructor has a doc comment
npm run check:ui          # ui/*.html: no remote resources, CSP on every page; vendored file matches its hash
npm run validate          # check:ui, build, streamdeck validate
npm run pack              # check:ui, build, write release/com.daczarne.litra.streamDeckPlugin
npm run icons             # regenerate the icons in imgs/ from scripts/generate-icons.mjs
npm run link              # link the plugin folder into Stream Deck
npm run watch             # rebuild and restart the plugin on change
npm run typecheck         # type-check the sources, the tests, and the build and check scripts
npm run lint              # Biome: lint rules, formatting and import order, without changing anything
npm run format            # Biome: apply the formatting and the import order
npm test                  # run the unit tests and the integration tests
npm run coverage          # the same tests, with a coverage report in the terminal and in coverage/
npm run test:browser      # run the browser tests, which need Chrome
```

## Runtime and toolchain

- The plugin runs on Node 24, set by `Nodejs.Version` in `manifest.json`. Stream Deck downloads that runtime into `~/Library/Application Support/com.elgato.StreamDeck/NodeJS/`, whose `manifest.json` lists the exact version (24.13.1 when this was written). `tsconfig.json` extends `@tsconfig/node24`, and `@types/node` follows that runtime's minor version (24.13), not the Node used to build.
- The Node used to build is pinned in `.node-version` (24.15.0), and `n auto` switches to it. `package.json` declares the same version in `engines`, and `engine-strict=true` in `.npmrc` makes `npm ci` refuse any other Node. CI reads `.node-version` too.
- The repo pins TypeScript 6.0, which no longer loads `@types/*` automatically, hence `"types": ["node"]` in `tsconfig.json`. `.vscode/settings.json` points the editor at the repo's TypeScript, so the editor and the build check types with the same version.
- `tsconfig.json` adds stricter checks to `strict`, such as `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` and `verbatimModuleSyntax`, for the sources and the tests. `tsconfig.scripts.json` extends it to check, as JavaScript, `rollup.config.mjs`, the Vitest configs and every script, `generate-icons.mjs` included, which takes the glyphs' types from the declarations `@daczarne/streamdeck-icons` ships. `npm run typecheck` runs both configs.
- Biome lints and formats the TypeScript and JavaScript, from `biome.json` (2.5 replaced its `recommended` field with `preset`). Its config has to stay at the repository root: from anywhere else, its type-aware rules report nothing, without a warning. `noFloatingPromises` and `noMisusedPromises` catch unhandled promises, though not an async callback whose promise is ignored, such as one passed to `setTimeout`. The plugin's callback APIs are typed to accept a promise instead (`void | Promise<void>`).
- `node-hid` ships native binaries, so Rollup keeps it external and `copyNativeRuntime` in `rollup.config.mjs` copies it and its runtime dependencies into the plugin folder. A dependency missing from that list breaks the installed plugin but not a linked one, because a linked plugin also finds the repo's top-level `node_modules`. Since the plugin only runs linked, that list is untested ([#21]).

## Supply chain

Supply-chain risk is a hard requirement here:

- No remote code. The settings pages load `sdpi-components` from `ui/vendor/`, pinned by hash in `scripts/check-ui.mjs`. The "Third-party code" section of `README.md` describes how to update it. Never install `sdpi-components` from npm: that package belongs to an unrelated maintainer.
- Each settings page declares a Content-Security-Policy, which `scripts/check-ui.mjs` also holds and checks. It allows scripts only from the plugin folder and connections only to Stream Deck's WebSocket on `localhost`, so inline scripts are blocked: page logic goes in a `.js` file in `ui/`, like `controller-toggle.js`. The "Settings pages" section of `README.md` explains each directive. A change to the policy updates every page, the check and that section.
- Install with `--ignore-scripts`, pin versions, and prefer local copies with recorded hashes. Flag any new dependency, remote resource or broad OS permission, and offer a narrower alternative.
- npm packages and GitHub Actions are pinned to exact versions, and `@daczarne/streamdeck-icons` to a commit. Each upgrade is its own change: see the "Dependencies" section of `docs/contributing.md`.

## Testing on the hardware

- Build, enable developer mode (`npx streamdeck dev`), `npm run link`, then `npx streamdeck restart com.daczarne.litra`. The actions appear under the Litra category. Developer mode stays on. After that, the `Build and restart` VS Code task (the default build task) runs the build and the restart in one go. A change to `manifest.json` takes effect only once Stream Deck itself is quit and reopened, so mention it whenever a branch changes the manifest.
- Plugin logs are in `com.daczarne.litra.sdPlugin/logs/`, newest in `litra.log`. The SDK's own `com.daczarne.litra.<n>.log` files there hold what the SDK reports itself, such as an uncaught exception. Stream Deck's own log, `~/Library/Logs/ElgatoStreamDeck/StreamDeck.log`, records what it refuses from the plugin, such as a layout it can't load.
- `docs/manual_testing/` holds the checks to run by hand. For example, `settings_pages.md` covers what the browser tests take for granted about Stream Deck, how to open the pages in DevTools to check it, and the debugging port that has to be closed afterwards.
- On the Stream Deck + XL's USB hub (7.5 W), each Beam caps its brightness below 100%, at a level that depends on both the port and the lamp: from 58% to 79% for the two Beams it was measured on (see the example in `scripts/probes/README.md`). The cap doesn't change with what the other lamp draws. Plugged into the Mac, a Beam reaches 100%.
- Claude can't see the Deck. The user checks what the keys and the touch strip show, and can share a photo of them, which is enough to judge a layout. Each dial gets 200 × 100 px of the touch strip, and text under about 16 px is hard to read on it ([#8]).
- Opening a Litra over HID needs no macOS permission.

## Workflow

`docs/contributing.md` describes branches, pull requests and tests. On top of it:

- Create branches with `git switch -c`.
- Commit messages explain the why and end with the `Co-Authored-By` trailer for Claude. Commit only when asked.
- `.github/workflows/main.yaml` runs the type check, Biome, the doc comments check, the unit and integration tests, the browser tests, `npm run validate`, Markdown lint and CSpell on every pull request and on `main`. Locally, the same checks run in two parts, both as Claude commands and as VS Code tasks: `/lint` and the `Lint` task run the linters (everything but the tests), `/test` and the `Test` task run the unit and integration tests and then the browser tests, and `/ci` and the `CI` task run both. `Test` is VS Code's default test task, so **Tasks: Run Test Task** starts it.
- Write the pull request title and description with the `pr-description` skill.
- Draft issues with the `github-issues` skill, and post them only when asked.

## Style

`docs/style_guide.md`, `.editorconfig`, `biome.json`, the Markdown lint configuration and CSpell (with the dictionaries in `.cspell/`) are the authority on style.

[#8]: https://github.com/daczarne/streamdeck-litra/issues/8
[#12]: https://github.com/daczarne/streamdeck-litra/issues/12
[#21]: https://github.com/daczarne/streamdeck-litra/issues/21
