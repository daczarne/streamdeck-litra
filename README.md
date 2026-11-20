# Litra for Stream Deck

A Stream Deck plugin that controls Logitech Litra lights over USB, without Logitech's software. It is a fork of an abandoned plugin by Seth Sheppard. It isn't on Elgato's Marketplace: it's installed from a file attached to this repository's releases, or run linked from a clone of it.

Not an official Logitech or Elgato product.

- [Actions](#actions)
- [Supported hardware](#supported-hardware)
- [Requirements](#requirements)
- [Installing](#installing)
- [Setting up on a new computer](#setting-up-on-a-new-computer)
- [Working on the plugin](#working-on-the-plugin)
- [Packaging](#packaging)
- [Icons](#icons)
- [Settings pages](#settings-pages)
- [Third-party code](#third-party-code)
- [Credits](#credits)

## Actions

|                                                                           | Action               | Type | Description                                                               |
|:-------------------------------------------------------------------------:|:---------------------|:-----|:--------------------------------------------------------------------------|
|                 ![Power][power-dark]![Power][power-light]                 | **Power**            | Key  | On, off or toggle                                                         |
|                 ![Scene][scene-dark]![Scene][scene-light]                 | **Scene**            | Key  | Turn groups of lamps on at presets, or off                                |
|       ![Set Brightness][bright-dark]![Set Brightness][bright-light]       | **Set Brightness**   | Key  | Jump to a preset %                                                        |
|     ![Brightness Up][bright-up-dark]![Brightness Up][bright-up-light]     | **Brightness Up**    | Key  | Step up by the key's %                                                    |
| ![Brightness Down][bright-down-dark]![Brightness Down][bright-down-light] | **Brightness Down**  | Key  | Step down by the key's %                                                  |
|           ![Brightness][bright-dark]![Brightness][bright-light]           | **Brightness**       | Dial | Rotate to adjust, press toggles power, tap the strip to control each lamp |
|        ![Set Temperature][temp-dark]![Set Temperature][temp-light]        | **Set Temperature**  | Key  | Jump to a preset Kelvin                                                   |
|      ![Temperature Up][temp-up-dark]![Temperature Up][temp-up-light]      | **Temperature Up**   | Key  | Step up, cooler, by the key's Kelvin                                      |
|  ![Temperature Down][temp-down-dark]![Temperature Down][temp-down-light]  | **Temperature Down** | Key  | Step down, warmer, by the key's Kelvin                                    |
|            ![Temperature][temp-dark]![Temperature][temp-light]            | **Temperature**      | Dial | Rotate to adjust, press toggles power, tap the strip to control each lamp |

Dials are on the Stream Deck + and the Stream Deck + XL.

- Each key acts on the lamps picked on its settings page: every lamp the plugin knows, unless others are picked. A dial's main screen acts on every lamp connected, and its lamp screens on one lamp at a time. [The user guide][user-guide] describes each action, and the settings they share.
- The plugin talks to the lamps in-process over USB HID, through the [`litra`][litra] Node library, with no CLI subprocess. [The architecture document][architecture] explains why, and how the plugin's parts fit together.
- The brightness is read from two bytes. The stock `litra` library only reads the low one, which truncates values above 255 lumens, where a Beam goes.

## Supported hardware

| Model   | Power | Brightness | Temperature | Backlight |
|---------|:-----:|:----------:|:-----------:|:---------:|
| Beam    |  ✅   |     ✅     |     ✅      |     —     |
| Beam LX |  ✅   |     ✅     |     ✅      |    ❌     |
| Glow    |  ❔   |     ❔     |     ❔      |     —     |

✅ Supported, and checked on the lamp. ❔ Should work, but not checked on a lamp. ❌ Not supported. — The lamp has none.

The plugin is made and checked on Litra Beams, and was checked on a Beam LX's front light, which its tests cover on every change. The Glow takes the same commands, with its own range, so the plugin should control it too, but it hasn't been checked on one, and isn't planned: see "Supported lamps" in [the contributing guide][contributing]. If you try one, [an issue][issues] saying how it went helps.

The Beam LX backlight (RGB and G HUB effect presets) isn't supported. What's known about it so far, from the original author's research, is in [#19].

Lamps connect over USB only: the underlying HID stack doesn't support Bluetooth. A lamp plugged into a hub with limited power may cap its brightness. On a Stream Deck + XL's hub (7.5 W), a Beam stops between about 60% and 80%, depending on the port and the lamp, while plugged into the computer it reaches 100%. A Beam LX runs on a power supply of its own, which it needs plugged in, and reaches 100%. The plugin learns each lamp's cap each time the lamp falls short of what it was sent, so it follows a cap that drops by a few lumens over time, and never asks it for more until the lamp is plugged in again, which is how it moves to another power supply. Right after it learns one, the next brightness change waits about a second, since until then the lamp can undo it.

## Requirements

- [Stream Deck][stream-deck] 7.1 or later, on macOS 12 or later, or Windows 10 or later. The plugin is made and checked on macOS. It should work on Windows, where [`litra`][litra], the library it talks to the lamps through, is tested, but the plugin itself isn't checked there.
- A Litra lamp connected over USB. On macOS, opening it needs no permission.
- No Logitech software. If G HUB is installed, quit it if it fights the plugin for the HID device.
- Only to build it from the repository: Node.js at the exact version in `.node-version`, with the npm that ships with it. `devEngines` in `package.json` pins both, and npm refuses any other. With [n][n], `n auto` installs that Node, with its npm, and switches to it. The plugin itself runs on the Node 24 that Stream Deck downloads, so the Node used to build doesn't have to match it.

## Installing

1. Download `com.daczarne.litra.streamDeckPlugin` from [the latest release][latest-release].
2. Open it: Stream Deck installs the plugin, and its actions appear under the **Litra** category.

A newer release installs the same way, over the one installed. To remove the plugin, uninstall it from the **Plugins** tab of Stream Deck's preferences.

The plugin is developed and checked linked from the repository (see [Setting up on a new computer](#setting-up-on-a-new-computer)), not installed from a release. If an installed plugin doesn't work, an issue with its log helps: [the user guide][troubleshooting] says where the logs are.

## Setting up on a new computer

1. Install Stream Deck, connect the Deck, and plug the lamps in over USB.
2. Clone the repository, switch to the Node version in `.node-version`, and install the dependencies from the lockfile, without running install scripts:

    ```shell
    git clone https://github.com/daczarne/streamdeck-litra.git
    cd streamdeck-litra
    n auto
    npm ci --ignore-scripts
    ```

3. Build the plugin. This bundles `src/` into `com.daczarne.litra.sdPlugin/bin/` and copies `node-hid` next to it:

    ```shell
    npm run build
    ```

4. Turn on Stream Deck's developer mode, link the plugin folder into Stream Deck, and restart the plugin:

    ```shell
    npx streamdeck dev
    npm run link
    npx streamdeck restart com.daczarne.litra
    ```

5. In Stream Deck, the actions appear under the **Litra** category. Drag them onto keys or dials, or restore a Stream Deck backup that already has them: the layout lives in Stream Deck's profiles, not in this repository.

Developer mode stays on afterwards.

## Working on the plugin

[The contributing guide][contributing] describes how changes are made. The developer guide, in `docs/developer_guide/`, holds the rest:

- [The architecture document][architecture]: how the plugin's parts fit together, and why they're built that way.
- [Start-up][start-up] and [a request's journey][request-journey]: the plugin as it starts, and a key press from the Deck to the lamps and back.
- [The testing guide][testing]: how the tests are written.
- [The logging document][logging]: what the plugin logs, and how the files are kept.
- [The style guide][style-guide]: the conventions the linters don't enforce.
- [The release process][releases]: how a release is made, from the version to publishing it.
- [The manual checks][manual-testing]: what only the Deck and the lamps can prove, one document per area.

Since the plugin is linked, a change takes effect as soon as it's built and the plugin restarts. A change to `manifest.json` takes effect once Stream Deck itself is quit and reopened: restarting the plugin isn't enough. Switching branches switches what the Deck runs, after the next build.

```shell
npm run watch             # rebuild and restart the plugin on every change
npm run build             # build once
npx streamdeck restart com.daczarne.litra   # load the new build
npm run typecheck         # type-check the sources, the tests, and the build and check scripts
npm run lint              # Biome: lint rules, formatting and import order, without changing anything
npm run format            # Biome: apply the formatting and the import order
npm test                  # run the unit tests and the integration tests
npm run coverage          # the same tests, with a coverage report in the terminal and in coverage/
npm run test:browser      # run the browser tests of the settings pages, which need Google Chrome
npm run check:docs        # every function, class, method and constructor has a doc comment
npm run check:ui          # settings pages: no remote resources or inline styles, CSP and stylesheet on every page, vendored file matches its hash
npm run validate          # check:ui, build and streamdeck validate
npm run icons             # regenerate the icons in imgs/ and docs/images/ from scripts/generate-icons.mjs
```

In VS Code, the `Build and restart` task builds once and restarts the plugin. It's the default build task, so **Tasks: Run Build Task** (⇧⌘B) starts it.

The plugin's logs are in `com.daczarne.litra.sdPlugin/logs/`: `litra.log` holds the newest lines, and [the logging document][logging] describes how the files are kept.

## Packaging

A release attaches the file this writes:

```shell
npm run pack
```

It runs `check:ui`, builds, and writes `release/com.daczarne.litra.streamDeckPlugin`, which holds the plugin folder, without what `com.daczarne.litra.sdPlugin/.sdignore` leaves out. The build puts in it only the files of `node-hid` that run on macOS and Windows (`scripts/package-files.mjs` lists them), the plugin's license, and the licenses of the code it ships, in `bin/THIRD_PARTY_LICENSES.txt`, since the minified bundle drops them. An installed plugin can't fall back on the repository's `node_modules` the way a linked one does, so a dependency missing from the package only shows once it's installed ([#21]).

How a release is made, from the version to publishing it, is in [`docs/developer_guide/releases.md`][releases].

## Icons

The plugin's images are drawn by code, from the glyphs of [`streamdeck-icons`][streamdeck-icons], a dependency pinned to a commit. That repository also holds the palette, and the Litra icon pack, which adds these icons and variants of them to Stream Deck's Icon Library. `scripts/generate-icons.mjs` decides which glyph goes where, and renders each to the PNG sizes Stream Deck needs, while the lamp screens draw the thermometer and the sun at runtime, in their cell's text color. The key images are drawn at the icon pack's sizes, leaving room for a title, while the dials' icons on the touch strip fill their canvas. The script also draws the icons of this README's actions table, in `docs/images/actions/`, outside the plugin folder: each action's glyph as its keys and dials show it, once for GitHub's dark theme and once for its light one, which the table picks between with `#gh-dark-mode-only` and `#gh-light-mode-only`, so no theme shows a white icon on a white page.

To take a change to the glyphs, update the commit the dependency is pinned to, run `npm run icons`, and commit the regenerated images with it. CI regenerates them too, and fails when the committed images aren't what the script draws.

## Settings pages

The settings pages (Property Inspector), in `com.daczarne.litra.sdPlugin/ui/`, load nothing remote, and two layers keep it that way:

- **When building.** `npm run check:ui` (also run by `validate` and `pack`) fails if any `ui/*.html` loads a remote resource, lacks the Content-Security-Policy below or declares a different one, has an inline script or an inline style, or doesn't link the pages' stylesheet, `ui/settings.css`. It also fails if the vendored sdpi-components doesn't match its pinned hash (see [Third-party code](#third-party-code)).
- **When Stream Deck shows them.** Each page declares a Content-Security-Policy in a `<meta>`, so Stream Deck refuses whatever the policy doesn't allow, even if it slipped past the check.

The browser tests (`npm run test:browser`, also run in CI) check that the policy works. They load each page in a headless Chrome, as Stream Deck would, and confirm that it refuses remote scripts, styles, images and connections, and inline scripts and styles, and that each page takes every style from `ui/settings.css`, but for the one sdpi-components adds. They also check the controls each page shows, the settings it sends, what each number field shows and saves, and the lamp picker, against a fake that answers for the plugin. They run in Chrome rather than in Stream Deck itself, so [`docs/developer_guide/manual_testing/settings_pages.md`][manual-test] lists the checks that only the Deck can prove.

The policy allows only what the pages need:

| Directive                      | Allows                                                                                                                                                               |
|--------------------------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `default-src 'none'`           | Nothing that the directives below don't allow.                                                                                                                       |
| `script-src 'self'`            | Scripts from the plugin folder. No inline scripts and no `eval`.                                                                                                     |
| `style-src 'self' 'sha256-…'`  | Stylesheets from the plugin folder, and the one `<style>` element sdpi-components adds to every page, by the hash of its text. No other inline style, nor attribute. |
| `img-src data:`                | The icons that sdpi-components draws as `data:` SVGs, such as its check marks.                                                                                       |
| `connect-src ws://localhost:*` | The WebSocket to Stream Deck, on the port Stream Deck passes to the page.                                                                                            |
| `base-uri 'none'`              | No `<base>` element, which would change where relative paths point.                                                                                                  |
| `form-action 'none'`           | No form submissions.                                                                                                                                                 |

Since inline scripts are blocked, the pages' scripts live in `ui/`: `number-field.js` draws the number fields, with − and + on either side, that set a brightness, a temperature, a step or the blink's length, `power-switch.js` draws the Scene key's Power switches, `lamp-picker.js` lists the lamps on the keys' pages and saves the ones checked, `scene-groups.js` draws and saves a Scene key's groups, `title-field.js` empties a dial's own title with its ×, and `plugin-settings.js` shows the plugin settings on every page. Since inline styles are blocked too, every style of the pages is in `ui/settings.css` ([#247]), which each page links, a section for each part of the pages. sdpi-components' own style is the one inline style allowed: its text is fixed by the vendored file's pinned hash, and `scripts/check-ui.mjs` computes the policy's hash of it from that file. The policy is repeated in each page and in [`scripts/check-ui.mjs`][check-ui], so a change to it updates all of them and the table above.

## Third-party code

The settings pages use [sdpi-components][sdpi] (MIT), vendored at `com.daczarne.litra.sdPlugin/ui/vendor/sdpi-components.js` instead of loaded from `sdpi-components.dev`, so no remote code runs inside Stream Deck.

- **Version:** `v4.0.1`
- **Source:** [`dist/sdpi-components.js` at tag `v4.0.1`][sdpi-source] (commit `06185f1452`)
- **Pinned hash:** sha256 in [`scripts/check-ui.mjs`][check-ui], checked by `npm run check:ui`

To update it, download `dist/sdpi-components.js` from the new upstream tag (not from npm: the `sdpi-components` package there is unrelated to this project), review the diff, replace the vendored file, and update the version and commit here and the hash in `scripts/check-ui.mjs`. When the style sdpi-components adds to every page changes, `npm run check:ui` gives the policy with its new hash, which goes in every page.

## Credits

- Seth Sheppard: the original plugin this repository forked, its design, and the Beam LX backlight research it was based on.
- [timrogers/litra][litra]: the HID protocol and Node library.
- [Elgato Stream Deck SDK][sdk].

The plugin is MIT licensed: see [`LICENSE`][license].

[#19]: https://github.com/daczarne/streamdeck-litra/issues/19
[#21]: https://github.com/daczarne/streamdeck-litra/issues/21
[#247]: https://github.com/daczarne/streamdeck-litra/issues/247
[architecture]: docs/developer_guide/architecture.md
[bright-dark]: docs/images/actions/dark/brightness.png#gh-dark-mode-only
[bright-down-dark]: docs/images/actions/dark/brightness-down.png#gh-dark-mode-only
[bright-down-light]: docs/images/actions/light/brightness-down.png#gh-light-mode-only
[bright-light]: docs/images/actions/light/brightness.png#gh-light-mode-only
[bright-up-dark]: docs/images/actions/dark/brightness-up.png#gh-dark-mode-only
[bright-up-light]: docs/images/actions/light/brightness-up.png#gh-light-mode-only
[check-ui]: scripts/check-ui.mjs
[contributing]: docs/contributing.md
[issues]: https://github.com/daczarne/streamdeck-litra/issues
[latest-release]: https://github.com/daczarne/streamdeck-litra/releases/latest
[license]: LICENSE
[litra]: https://github.com/timrogers/litra
[logging]: docs/developer_guide/logging.md
[manual-test]: docs/developer_guide/manual_testing/settings_pages.md
[manual-testing]: docs/developer_guide/manual_testing/
[n]: https://github.com/tj/n
[power-dark]: docs/images/actions/dark/power.png#gh-dark-mode-only
[power-light]: docs/images/actions/light/power.png#gh-light-mode-only
[releases]: docs/developer_guide/releases.md
[request-journey]: docs/developer_guide/request_journey.md
[scene-dark]: docs/images/actions/dark/scene.png#gh-dark-mode-only
[scene-light]: docs/images/actions/light/scene.png#gh-light-mode-only
[sdk]: https://docs.elgato.com/streamdeck
[sdpi]: https://github.com/GeekyEggo/sdpi-components
[sdpi-source]: https://github.com/GeekyEggo/sdpi-components/blob/v4.0.1/dist/sdpi-components.js
[start-up]: docs/developer_guide/start_up.md
[stream-deck]: https://www.elgato.com/streamdeck
[streamdeck-icons]: https://github.com/daczarne/streamdeck-icons
[style-guide]: docs/developer_guide/style_guide.md
[temp-dark]: docs/images/actions/dark/temperature.png#gh-dark-mode-only
[temp-down-dark]: docs/images/actions/dark/temperature-down.png#gh-dark-mode-only
[temp-down-light]: docs/images/actions/light/temperature-down.png#gh-light-mode-only
[temp-light]: docs/images/actions/light/temperature.png#gh-light-mode-only
[temp-up-dark]: docs/images/actions/dark/temperature-up.png#gh-dark-mode-only
[temp-up-light]: docs/images/actions/light/temperature-up.png#gh-light-mode-only
[testing]: docs/developer_guide/testing.md
[troubleshooting]: docs/user_guide/README.md#when-something-doesnt-work
[user-guide]: docs/user_guide/README.md
