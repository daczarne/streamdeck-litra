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
- [Usage tips](#usage-tips)
- [Settings pages](#settings-pages)
- [Third-party code](#third-party-code)
- [Credits](#credits)

## Actions

|                                 | Action               | Key                                        | Dial (Stream Deck +)                                                      |
|:-------------------------------:|:---------------------|:-------------------------------------------|:--------------------------------------------------------------------------|
|         ![Power][power]         | **Power**            | On, off or toggle                          | None                                                                      |
|      ![Brightness][bright]      | **Brightness**       | Jump to a preset %                         | Rotate to adjust, press toggles power, tap the strip to control each lamp |
|       ![Temperature][temp]      | **Temperature**      | Jump to a preset Kelvin                    | Rotate to adjust, press toggles power, tap the strip to control each lamp |
|         ![Scene][scene]         | **Scene**            | Turn the lamps on at a preset % and Kelvin | None                                                                      |
|   ![Brightness Up][bright-up]   | **Brightness Up**    | Step up by the key's %                     | None                                                                      |
| ![Brightness Down][bright-down] | **Brightness Down**  | Step down by the key's %                   | None                                                                      |
|    ![Temperature Up][temp-up]   | **Temperature Up**   | Step up, cooler, by the key's Kelvin       | None                                                                      |
|  ![Temperature Down][temp-down] | **Temperature Down** | Step down, warmer, by the key's Kelvin     | None                                                                      |

- Each key acts on the lamps picked on its settings page: every connected lamp, unless others are picked. A dial's main screen acts on every lamp, and its lamp screens on one lamp at a time (see [Usage tips](#usage-tips)).
- The plugin talks to the lamps in-process over USB HID, through the [`litra`][litra] Node library, with no CLI subprocess. [The architecture document][architecture] explains why, and how the plugin's parts fit together.
- The brightness is read from two bytes. The stock `litra` library only reads the low one, which truncates values above 255 lumens, where a Beam goes.

## Supported hardware

| Lamp          | Front power, brightness and temperature |
|---------------|-----------------------------------------|
| Litra Beam    | Yes, checked on the lamp                |
| Litra Beam LX | Not checked on a lamp                   |
| Litra Glow    | Not checked on a lamp                   |

The plugin is made and checked on Litra Beams. The Beam LX and the Glow take the same commands, with their own ranges, so the plugin should control their front light too, but it hasn't been checked on either. The Beam LX is the next to be checked. The Glow isn't planned: see "Supported lamps" in [the contributing guide][contributing]. If you try either, [an issue][issues] saying how it went helps.

The Beam LX back light (RGB and G HUB effect presets) isn't supported. What's known about it so far, from the original author's research, is in [#19].

Lamps connect over USB only: the underlying HID stack doesn't support Bluetooth. A lamp plugged into a hub with limited power may cap its brightness. On a Stream Deck + XL's hub (7.5 W), a Beam stops between about 60% and 80%, depending on the port and the lamp, while plugged into the computer it reaches 100%. The plugin learns each lamp's cap the first time the lamp falls short of what it was sent, and never asks it for more until the lamp is plugged in again, which is how it moves to another power supply. Right after it learns one, the next brightness change waits about a second, since until then the lamp can undo it.

## Requirements

- [Stream Deck][stream-deck] 7.1 or later, on macOS 12 or later, or Windows 10 or later. The plugin is made and checked on macOS. It should work on Windows, where [`litra`][litra], the library it talks to the lamps through, is tested, but the plugin itself isn't checked there.
- A Litra lamp connected over USB. On macOS, opening it needs no permission.
- No Logitech software. If G HUB is installed, quit it if it fights the plugin for the HID device.
- Only to build it from the repository: Node.js and npm, at the exact Node version in `.node-version`: `npm ci` refuses any other. With [n][n], `n auto` installs and switches to it. The plugin itself runs on the Node 24 that Stream Deck downloads, so the Node used to build doesn't have to match it.

## Installing

1. Download `com.daczarne.litra.streamDeckPlugin` from [the latest release][latest-release].
2. Open it: Stream Deck installs the plugin, and its actions appear under the **Litra** category.

A newer release installs the same way, over the one installed. To remove the plugin, uninstall it from the **Plugins** tab of Stream Deck's preferences.

The plugin is developed and checked linked from the repository (see [Setting up on a new computer](#setting-up-on-a-new-computer)), not installed from a release. If an installed plugin doesn't work, [an issue][issues] with its log helps. The logs are in the plugin's folder, newest in `litra.log`:

- On macOS: `~/Library/Application Support/com.elgato.StreamDeck/Plugins/com.daczarne.litra.sdPlugin/logs/`
- On Windows: `%APPDATA%\Elgato\StreamDeck\Plugins\com.daczarne.litra.sdPlugin\logs\`

They hold your lamps' serial numbers, so remove those before posting.

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

[The architecture document][architecture] describes how the plugin's parts fit together, and why they're built that way. [The contributing guide][contributing] describes how changes are made.

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

The version is the `Version` in `manifest.json`, the only place it's written. Elgato's format has four numbers, `{major}.{minor}.{patch}.{build}`, and the last one stays 0. Releases follow [semantic versioning][semver], where a breaking change is one that breaks keys already set up, such as a renamed action or a setting whose meaning changes.

A pull request that raises the version makes a release once it's merged. CI's last job runs on every push to `main`, after every check has passed. When the manifest's version has no release yet, drafts included, it packs the plugin, records the package's provenance in an attestation, and drafts a release tagged `v{major}.{minor}.{patch}`. The draft holds the package and notes from `.github/release-notes.md`, with the package's SHA-256, followed by the pull requests merged since the last release. Publishing it, once its notes are read, is manual.

## Icons

The plugin's images are drawn by code, from the glyphs of [`streamdeck-icons`][streamdeck-icons], a development dependency pinned to a commit. That repository also holds the palette, and the Litra icon pack, which adds these icons and variants of them to Stream Deck's Icon Library. `scripts/generate-icons.mjs` decides which glyph goes where, and renders each to the PNG sizes Stream Deck needs. The key images are drawn at the icon pack's sizes, leaving room for a title, while the dials' icons on the touch strip fill their canvas.

To take a change to the glyphs, update the commit the dependency is pinned to, run `npm run icons`, and commit the regenerated images with it. CI regenerates them too, and fails when the committed images aren't what the script draws.

## Usage tips

- A Power key shows on only when every one of its lamps is on. Every Power key, dial and lamp screen follows changes made by any key or dial. Changes made with a lamp's own buttons show at the next change made through the plugin.
- Brightness and temperature keys show their preset value, as a bare number at the bottom of the key, set by the plugin. A title typed in the key's settings replaces it, and the **Show Title** box under the **T** menu hides it.
- A Scene key turns its lamps on, then sets its temperature and brightness in one press, so one key goes to a setup and another comes back. It shows only its image: a title typed in its settings shows at the bottom.
- Brightness and Temperature Up and Down keys step their lamps by the step in their settings, as one tick of a dial, for decks without dials. They show what their lamps are at, as the dials do: the brightest lamp's %, or the temperature in Kelvin, and a dash when no lamp answers. A title typed in the key's settings replaces it.
- A key's settings page lists the connected lamps as their model and the last 4 characters of their serial number, such as "Beam - 7K98", each with an Identify button that blinks it. The key acts on the lamps checked there. All, the default, also takes in lamps plugged in later, while lamps checked one by one stay those lamps. A lamp that isn't plugged in stays listed as not found, so it can be unchecked.
- Dials look like Stream Deck's own volume dials: the value, with a bar under it. The keys, and the dials' pictures in the Stream Deck app, show the same line icon as the strip, smaller, at the size of the Icon Library's Litra icons. The temperature bar runs from the lamp's warmest setting (empty) to its coolest (full). The brightness bar is white up to the dimmest lamp's level, and a lighter grey from there to the brightest lamp's, the part only some lamps reach. Their title says what they control ("Brightness", "Temperature"), and can be replaced or hidden like a key's. Rotating adjusts, pressing toggles the front light.
- Tapping a dial's part of the strip shows one screen per lamp: its label, the model and the last 4 characters of its serial number, as a key's settings page lists it, with its place among the lamps ("1 of 2"), then its temperature and whether it's on, and its brightness in % and lumens. "Off" shows in bold dark grey. Each tap shows the next lamp, in the order of their serial numbers, and the dial's own screen after the last. The dial stays on a lamp screen until it's tapped past the last lamp. On a lamp screen, the dial controls that lamp alone: turning it changes the lamp's brightness or temperature, and pressing it turns the lamp on or off. Holding the strip blinks the lamp once, to show which one it is. A turn on the dial's own screen sets every lamp to the same value again.
- A dial turns, and an Up or Down key steps, by the step in its settings, and stops on the multiples of that step counted from the bottom of the range (0% or 2700 K), the same values going up as going down. From a value between two of them, such as a lamp's cap or a key's preset, the first step goes to the next one in the direction of the turn. When the step doesn't divide the range, the last step to 100% or 6500 K is shorter.
- With no lamp connected, actions show Stream Deck's alert indicator. A Power key shows it once it has redrawn its state, which would cover the alert otherwise (see [Stream Deck keys][keys]).

## Settings pages

The settings pages (Property Inspector), in `com.daczarne.litra.sdPlugin/ui/`, load nothing remote, and two layers keep it that way:

- **When building.** `npm run check:ui` (also run by `validate` and `pack`) fails if any `ui/*.html` loads a remote resource, lacks the Content-Security-Policy below or declares a different one, or has an inline script. It also fails if the vendored sdpi-components doesn't match its pinned hash (see [Third-party code](#third-party-code)).
- **When Stream Deck shows them.** Each page declares a Content-Security-Policy in a `<meta>`, so Stream Deck refuses whatever the policy doesn't allow, even if it slipped past the check.

The browser tests (`npm run test:browser`, also run in CI) check that the policy works. They load each page in a headless Chrome, as Stream Deck would, and confirm that it refuses remote scripts, styles, images and connections, and inline scripts. They also check the controls each page shows, the settings it sends, the value shown next to each slider, and the lamp picker, against a fake that answers for the plugin. They run in Chrome rather than in Stream Deck itself, so [`docs/manual_testing/settings_pages.md`][manual-test] lists the checks that only the Deck can prove.

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

Since inline scripts are blocked, the pages' scripts live in `ui/`: `controller-toggle.js` shows the key or the dial settings on the Brightness and Temperature pages, `range-value.js` shows each slider's value, and `lamp-picker.js` lists the lamps on the keys' pages and saves the ones checked. The policy is repeated in each page and in [`scripts/check-ui.mjs`][check-ui], so a change to it updates all of them and the table above.

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
[issues]: https://github.com/daczarne/streamdeck-litra/issues
[keys]: docs/elgato_sdk/keys.md
[latest-release]: https://github.com/daczarne/streamdeck-litra/releases/latest
[license]: LICENSE
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
[semver]: https://semver.org
[stream-deck]: https://www.elgato.com/streamdeck
[temp]: com.daczarne.litra.sdPlugin/imgs/actions/temperature/icon@2x.png
[temp-down]: com.daczarne.litra.sdPlugin/imgs/actions/temperature-down/icon@2x.png
[temp-up]: com.daczarne.litra.sdPlugin/imgs/actions/temperature-up/icon@2x.png
