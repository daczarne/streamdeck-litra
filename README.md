# Litra for Stream Deck

A Stream Deck plugin that controls Logitech Litra lights over USB, without Logitech's software. It is a personal fork of a plugin by Seth Sheppard. It isn't published: it runs linked from this repository, so the Deck always runs whatever is built from the checked-out branch.

Not an official Logitech or Elgato product.

- [Actions](#actions)
- [Supported hardware](#supported-hardware)
- [Requirements](#requirements)
- [Setting up on a new computer](#setting-up-on-a-new-computer)
- [Working on the plugin](#working-on-the-plugin)
- [Packaging](#packaging)
- [Usage tips](#usage-tips)
- [Settings pages](#settings-pages)
- [Third-party code](#third-party-code)
- [Credits](#credits)

## Actions

|                       | Action          | Key                     | Dial (Stream Deck +)                  |
|:---------------------:|:----------------|:------------------------|:--------------------------------------|
| ![Power][power]       | **Power**       | On, off or toggle       | None                                  |
| ![Brightness][bright] | **Brightness**  | Jump to a preset %      | Rotate to adjust, press toggles power |
| ![Temperature][temp]  | **Temperature** | Jump to a preset Kelvin | Rotate to adjust, press toggles power |

- Every action applies to all connected lamps at once. There is no per-lamp picker yet.
- The plugin talks to the lamps in-process over USB HID, through the [`litra`][litra] Node library, with no CLI subprocess.
- The Beam LX front brightness is read from two bytes. The stock `litra` library only reads the low one, which truncates values above 255 lumens.

## Supported hardware

| Lamp          | Front power, brightness and temperature |
|---------------|-----------------------------------------|
| Litra Glow    | Yes                                     |
| Litra Beam    | Yes                                     |
| Litra Beam LX | Yes (front light only)                  |

The Beam LX back light (RGB and G HUB effect presets) isn't supported. The research notes are in [`ref/hid-captures/NOTES.md`][hid-notes].

Lamps connect over USB only: the underlying HID stack doesn't support Bluetooth. A lamp plugged into a hub with limited power may cap its brightness. On the Stream Deck + XL's hub (7.5 W), the Beam stops at about 70%, while plugged into the computer it reaches 100%.

## Requirements

- [Stream Deck][stream-deck] 7.1 or later, on macOS 12 or later, or Windows 10 or later.
- A Litra lamp connected over USB. On macOS, opening it needs no permission.
- Node.js and npm, to build, at the exact Node version in `.node-version`: `npm ci` refuses any other. With [n][n], `n auto` installs and switches to it. The plugin itself runs on the Node 24 that Stream Deck downloads, so the Node used to build doesn't have to match it.
- No Logitech software. If G HUB is installed, quit it if it fights the plugin for the HID device.

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

Since the plugin is linked, a change takes effect as soon as it's built and the plugin restarts. Switching branches switches what the Deck runs, after the next build.

```shell
npm run watch             # rebuild and restart the plugin on every change
npm run build             # build once
npx streamdeck restart com.daczarne.litra   # load the new build
npx tsc --noEmit -p .     # type-check only
npm test                  # run the unit tests
npm run check:ui          # settings pages: no remote resources, CSP on every page, vendored file matches its hash
npm run validate          # check:ui, build and streamdeck validate
npm run icons             # regenerate the icons in imgs/ from scripts/generate-icons.mjs
```

The plugin's logs are in `com.daczarne.litra.sdPlugin/logs/`.

## Packaging

The plugin isn't packaged or installed today. The tooling to do it stays, in case it's published one day:

```shell
npm run pack
```

This runs `check:ui`, builds, and writes `release/com.daczarne.litra.streamDeckPlugin`. A packaged plugin can't fall back on the repository's `node_modules` the way a linked one does, so it needs testing as an installed plugin before any release ([#21]).

## Usage tips

- Brightness and temperature keys are meant to show their preset value, as a bare number at the bottom of the key. The plugin sets it itself, since editing the title is disabled. On the Deck, no number appears yet ([#25]).
- Dials look like Stream Deck's own volume dials: the value, with a bar under it. The temperature bar runs from the lamp's warmest setting (empty) to its coolest (full). Rotating adjusts, pressing toggles the front light. Their titles don't show yet either ([#25]).
- With no lamp connected, actions show Stream Deck's alert indicator.

## Settings pages

The settings pages (Property Inspector), in `com.daczarne.litra.sdPlugin/ui/`, load nothing remote, and two layers keep it that way:

- **When building.** `npm run check:ui` (also run by `validate` and `pack`) fails if any `ui/*.html` loads a remote resource, lacks the Content-Security-Policy below or declares a different one, or has an inline script. It also fails if the vendored sdpi-components doesn't match its pinned hash (see [Third-party code](#third-party-code)).
- **When Stream Deck shows them.** Each page declares a Content-Security-Policy in a `<meta>`, so Stream Deck refuses whatever the policy doesn't allow, even if it slipped past the check.

The policy allows only what the pages need:

| Directive                      | Allows                                                                         |
|--------------------------------|--------------------------------------------------------------------------------|
| `default-src 'none'`           | Nothing that the directives below don't allow.                                 |
| `script-src 'self'`            | Scripts from the plugin folder. No inline scripts and no `eval`.               |
| `style-src 'unsafe-inline'`    | The `<style>` element that sdpi-components adds to every page.                 |
| `img-src data:`                | The icons that sdpi-components draws as `data:` SVGs, such as its check marks. |
| `connect-src ws://localhost:*` | The WebSocket to Stream Deck, on the port Stream Deck passes to the page.      |
| `base-uri 'none'`              | No `<base>` element, which would change where relative paths point.            |
| `form-action 'none'`           | No form submissions.                                                           |

Since inline scripts are blocked, the script that shows the key or the dial settings, shared by the brightness and temperature pages, lives in `ui/controller-toggle.js`. The policy is repeated in each page and in [`scripts/check-ui.mjs`][check-ui], so a change to it updates all of them and the table above.

## Third-party code

The settings pages use [sdpi-components][sdpi] (MIT), vendored at `com.daczarne.litra.sdPlugin/ui/vendor/sdpi-components.js` instead of loaded from `sdpi-components.dev`, so no remote code runs inside Stream Deck.

- **Version:** `v4.0.1`
- **Source:** [`dist/sdpi-components.js` at tag `v4.0.1`][sdpi-source] (commit `06185f1452`)
- **Pinned hash:** sha256 in [`scripts/check-ui.mjs`][check-ui], checked by `npm run check:ui`

To update it, download `dist/sdpi-components.js` from the new upstream tag (not from npm: the `sdpi-components` package there is unrelated to this project), review the diff, replace the vendored file, and update the version and commit here and the hash in `scripts/check-ui.mjs`.

## Credits

- [timrogers/litra][litra]: the HID protocol and Node library.
- [Elgato Stream Deck SDK][sdk].

[#21]: https://github.com/daczarne/streamdeck-litra/issues/21
[#25]: https://github.com/daczarne/streamdeck-litra/issues/25
[bright]: com.daczarne.litra.sdPlugin/imgs/actions/brightness/icon@2x.png
[check-ui]: scripts/check-ui.mjs
[hid-notes]: ref/hid-captures/NOTES.md
[litra]: https://github.com/timrogers/litra
[n]: https://github.com/tj/n
[power]: com.daczarne.litra.sdPlugin/imgs/actions/power/icon@2x.png
[sdk]: https://docs.elgato.com/streamdeck
[sdpi]: https://github.com/GeekyEggo/sdpi-components
[sdpi-source]: https://github.com/GeekyEggo/sdpi-components/blob/v4.0.1/dist/sdpi-components.js
[stream-deck]: https://www.elgato.com/streamdeck
[temp]: com.daczarne.litra.sdPlugin/imgs/actions/temperature/icon@2x.png
