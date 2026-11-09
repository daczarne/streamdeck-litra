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

|                                 | Action               | Key                                        | Dial (Stream Deck +)                                                      |
|:-------------------------------:|:---------------------|:-------------------------------------------|:--------------------------------------------------------------------------|
|         ![Power][power]         | **Power**            | On, off or toggle                          | None                                                                      |
|      ![Brightness][bright]      | **Brightness**       | Jump to a preset %                         | Rotate to adjust, press toggles power, tap the strip to control each lamp |
|       ![Temperature][temp]      | **Temperature**      | Jump to a preset Kelvin                    | Rotate to adjust, press toggles power, tap the strip to control each lamp |
|         ![Scene][scene]         | **Scene**            | Turn groups of lamps on at presets, or off | None                                                                      |
|   ![Brightness Up][bright-up]   | **Brightness Up**    | Step up by the key's %                     | None                                                                      |
| ![Brightness Down][bright-down] | **Brightness Down**  | Step down by the key's %                   | None                                                                      |
|    ![Temperature Up][temp-up]   | **Temperature Up**   | Step up, cooler, by the key's Kelvin       | None                                                                      |
|  ![Temperature Down][temp-down] | **Temperature Down** | Step down, warmer, by the key's Kelvin     | None                                                                      |

- Each key acts on the lamps picked on its settings page: every lamp the plugin knows, unless others are picked. A dial's main screen acts on every lamp, and its lamp screens on one lamp at a time. [The user guide][user-guide] describes each action, and the settings they share.
- The plugin talks to the lamps in-process over USB HID, through the [`litra`][litra] Node library, with no CLI subprocess. [The architecture document][architecture] explains why, and how the plugin's parts fit together.
- The brightness is read from two bytes. The stock `litra` library only reads the low one, which truncates values above 255 lumens, where a Beam goes.

## Supported hardware

| Lamp          | Power, brightness and temperature     |
|---------------|---------------------------------------|
| Litra Beam    | Yes, checked on the lamp              |
| Litra Beam LX | Front light only, checked on the lamp |
| Litra Glow    | Not checked on a lamp                 |

The plugin is made and checked on Litra Beams, and was checked on a Beam LX's front light, which its tests cover on every change. The Glow takes the same commands, with its own range, so the plugin should control it too, but it hasn't been checked on one, and isn't planned: see "Supported lamps" in [the contributing guide][contributing]. If you try one, [an issue][issues] saying how it went helps.

The Beam LX back light (RGB and G HUB effect presets) isn't supported. What's known about it so far, from the original author's research, is in [#19].

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

[The architecture document][architecture] describes how the plugin's parts fit together, and why they're built that way. [The developer guide][developer-guide] follows the plugin as it starts, and a key press from the Deck to the lamps and back. [The contributing guide][contributing] describes how changes are made.

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
npm run check:ui          # settings pages: no remote resources, CSP on every page, vendored file matches its hash
npm run validate          # check:ui, build and streamdeck validate
npm run icons             # regenerate the icons in imgs/ from scripts/generate-icons.mjs
```

In VS Code, the `Build and restart` task builds once and restarts the plugin. It's the default build task, so **Tasks: Run Build Task** (⇧⌘B) starts it.

The plugin's logs are in `com.daczarne.litra.sdPlugin/logs/`: `litra.log` holds the newest lines, and [the logging document][logging] describes how the files are kept.

## Packaging

A release attaches the file this writes:

```shell
npm run pack
```

It runs `check:ui`, builds, and writes `release/com.daczarne.litra.streamDeckPlugin`, which holds the plugin folder, without what `com.daczarne.litra.sdPlugin/.sdignore` leaves out. The build puts in it only the files of `node-hid` that run on macOS and Windows (`scripts/package-files.mjs` lists them), the plugin's license, and the licenses of the code it ships, in `bin/THIRD_PARTY_LICENSES.txt`, since the minified bundle drops them. An installed plugin can't fall back on the repository's `node_modules` the way a linked one does, so a dependency missing from the package only shows once it's installed ([#21]).

How a release is made, from the version to publishing it, is in [`docs/releases.md`][releases].

## Icons

The plugin's images are drawn by code, from the glyphs of [`streamdeck-icons`][streamdeck-icons], a dependency pinned to a commit. That repository also holds the palette, and the Litra icon pack, which adds these icons and variants of them to Stream Deck's Icon Library. `scripts/generate-icons.mjs` decides which glyph goes where, and renders each to the PNG sizes Stream Deck needs, while the lamp screens draw the thermometer and the sun at runtime, in their cell's text color. The key images are drawn at the icon pack's sizes, leaving room for a title, while the dials' icons on the touch strip fill their canvas.

To take a change to the glyphs, update the commit the dependency is pinned to, run `npm run icons`, and commit the regenerated images with it. CI regenerates them too, and fails when the committed images aren't what the script draws.

## Settings pages

The settings pages (Property Inspector), in `com.daczarne.litra.sdPlugin/ui/`, load nothing remote, and two layers keep it that way:

- **When building.** `npm run check:ui` (also run by `validate` and `pack`) fails if any `ui/*.html` loads a remote resource, lacks the Content-Security-Policy below or declares a different one, or has an inline script. It also fails if the vendored sdpi-components doesn't match its pinned hash (see [Third-party code](#third-party-code)).
- **When Stream Deck shows them.** Each page declares a Content-Security-Policy in a `<meta>`, so Stream Deck refuses whatever the policy doesn't allow, even if it slipped past the check.

The browser tests (`npm run test:browser`, also run in CI) check that the policy works. They load each page in a headless Chrome, as Stream Deck would, and confirm that it refuses remote scripts, styles, images and connections, and inline scripts. They also check the controls each page shows, the settings it sends, what each number field shows and saves, and the lamp picker, against a fake that answers for the plugin. They run in Chrome rather than in Stream Deck itself, so [`docs/manual_testing/settings_pages.md`][manual-test] lists the checks that only the Deck can prove.

The policy allows only what the pages need:

| Directive                      | Allows                                                                              |
|--------------------------------|-------------------------------------------------------------------------------------|
| `default-src 'none'`           | Nothing that the directives below don't allow.                                      |
| `script-src 'self'`            | Scripts from the plugin folder. No inline scripts and no `eval`.                    |
| `style-src 'unsafe-inline'`    | The `<style>` elements of the pages and the one sdpi-components adds to every page. |
| `img-src data:`                | The icons that sdpi-components draws as `data:` SVGs, such as its check marks.      |
| `connect-src ws://localhost:*` | The WebSocket to Stream Deck, on the port Stream Deck passes to the page.           |
| `base-uri 'none'`              | No `<base>` element, which would change where relative paths point.                 |
| `form-action 'none'`           | No form submissions.                                                                |

Since inline scripts are blocked, the pages' scripts live in `ui/`: `controller-toggle.js` shows the key or the dial settings on the Brightness and Temperature pages, `number-field.js` draws the number fields, with − and + on either side, that set a brightness, a temperature, a step or the blink's length, `power-switch.js` draws the Scene key's Power switches, `lamp-picker.js` lists the lamps on the keys' pages and saves the ones checked, `scene-groups.js` draws and saves a Scene key's groups, and `plugin-settings.js` shows the plugin settings on every page. The policy is repeated in each page and in [`scripts/check-ui.mjs`][check-ui], so a change to it updates all of them and the table above.

## Third-party code

The settings pages use [sdpi-components][sdpi] (MIT), vendored at `com.daczarne.litra.sdPlugin/ui/vendor/sdpi-components.js` instead of loaded from `sdpi-components.dev`, so no remote code runs inside Stream Deck.

- **Version:** `v4.0.1`
- **Source:** [`dist/sdpi-components.js` at tag `v4.0.1`][sdpi-source] (commit `06185f1452`)
- **Pinned hash:** sha256 in [`scripts/check-ui.mjs`][check-ui], checked by `npm run check:ui`

To update it, download `dist/sdpi-components.js` from the new upstream tag (not from npm: the `sdpi-components` package there is unrelated to this project), review the diff, replace the vendored file, and update the version and commit here and the hash in `scripts/check-ui.mjs`.

## Credits

- Seth Sheppard: the original plugin this repository forked, its design, and the Beam LX back-light research it was based on.
- [timrogers/litra][litra]: the HID protocol and Node library.
- [Elgato Stream Deck SDK][sdk].

The plugin is MIT licensed: see [`LICENSE`][license].

[#19]: https://github.com/daczarne/streamdeck-litra/issues/19
[#21]: https://github.com/daczarne/streamdeck-litra/issues/21
[architecture]: docs/architecture.md
[bright]: com.daczarne.litra.sdPlugin/imgs/actions/brightness/icon@2x.png
[bright-down]: com.daczarne.litra.sdPlugin/imgs/actions/brightness-down/icon@2x.png
[bright-up]: com.daczarne.litra.sdPlugin/imgs/actions/brightness-up/icon@2x.png
[check-ui]: scripts/check-ui.mjs
[contributing]: docs/contributing.md
[developer-guide]: docs/developer_guide/start_up.md
[issues]: https://github.com/daczarne/streamdeck-litra/issues
[latest-release]: https://github.com/daczarne/streamdeck-litra/releases/latest
[license]: LICENSE
[releases]: docs/releases.md
[streamdeck-icons]: https://github.com/daczarne/streamdeck-icons
[litra]: https://github.com/timrogers/litra
[logging]: docs/logging.md
[manual-test]: docs/manual_testing/settings_pages.md
[n]: https://github.com/tj/n
[power]: com.daczarne.litra.sdPlugin/imgs/actions/power/icon@2x.png
[scene]: com.daczarne.litra.sdPlugin/imgs/actions/scene/icon@2x.png
[sdk]: https://docs.elgato.com/streamdeck
[sdpi]: https://github.com/GeekyEggo/sdpi-components
[sdpi-source]: https://github.com/GeekyEggo/sdpi-components/blob/v4.0.1/dist/sdpi-components.js
[stream-deck]: https://www.elgato.com/streamdeck
[temp]: com.daczarne.litra.sdPlugin/imgs/actions/temperature/icon@2x.png
[temp-down]: com.daczarne.litra.sdPlugin/imgs/actions/temperature-down/icon@2x.png
[temp-up]: com.daczarne.litra.sdPlugin/imgs/actions/temperature-up/icon@2x.png
[troubleshooting]: docs/user_guide/user_guide.md#when-something-doesnt-work
[user-guide]: docs/user_guide/user_guide.md
