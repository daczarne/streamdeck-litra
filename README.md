<p align="center">
  <img src="com.daczarne.litra.sdPlugin/imgs/plugin/marketplace@2x.png" alt="Litra for Stream Deck" width="168" />
</p>

<h1 align="center">Litra for Stream Deck</h1>

<p align="center">
  <strong>Warm key-light control</strong> for Logitech Litra — from an Elgato Stream Deck,<br />
  including dials on Stream Deck+.
</p>

<p align="center">
  <a href="https://github.com/daczarne/streamdeck-litra/releases/latest"><img src="https://img.shields.io/github/v/release/daczarne/streamdeck-litra?style=for-the-badge&color=FFB347&labelColor=1A1A1A" alt="Latest release" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-7EC8FF?style=for-the-badge&labelColor=1A1A1A" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/Stream%20Deck-7.1%2B-F5C542?style=for-the-badge&labelColor=1A1A1A" alt="Stream Deck 7.1+" />
  <img src="https://img.shields.io/badge/macOS%20%7C%20Windows-USB-E8E8E8?style=for-the-badge&labelColor=1A1A1A" alt="macOS and Windows over USB" />
</p>

<p align="center"><em>Not an official Logitech or Elgato product.</em></p>

---

## Actions

<p align="center">
  <img src="com.daczarne.litra.sdPlugin/imgs/actions/power/key-on@2x.png" width="88" alt="Power on" />
  &nbsp;&nbsp;
  <img src="com.daczarne.litra.sdPlugin/imgs/actions/power/key-off@2x.png" width="88" alt="Power off" />
  &nbsp;&nbsp;
  <img src="com.daczarne.litra.sdPlugin/imgs/actions/brightness/key@2x.png" width="88" alt="Brightness" />
  &nbsp;&nbsp;
  <img src="com.daczarne.litra.sdPlugin/imgs/actions/temperature/key@2x.png" width="88" alt="Temperature" />
</p>

<p align="center">
  <sub>Power · Brightness · Temperature</sub>
</p>

|                                                                                                  | Action          | Key                     | Dial (Stream Deck+)                       |
|:------------------------------------------------------------------------------------------------:|:----------------|:------------------------|:------------------------------------------|
|    <img src="com.daczarne.litra.sdPlugin/imgs/actions/power/icon@2x.png" width="28" alt="" />    | **Power**       | On / off / toggle       | —                                         |
| <img src="com.daczarne.litra.sdPlugin/imgs/actions/brightness/icon@2x.png" width="28" alt="" />  | **Brightness**  | Jump to a preset %      | Rotate to adjust; **press toggles power** |
| <img src="com.daczarne.litra.sdPlugin/imgs/actions/temperature/icon@2x.png" width="28" alt="" /> | **Temperature** | Jump to a preset Kelvin | Rotate to adjust; **press toggles power** |

- Works with **all connected Litra devices** at once (no per-light picker yet)
- Beam LX front brightness uses a corrected lumen read (stock JS only used the low byte)
- macOS and Windows (USB; Bluetooth control is not supported by the underlying stack)

End users only need Stream Deck software and a USB-connected Litra — nothing else to install (no Node, no `litra` CLI, no Homebrew). The plugin ships with its USB HID stack baked in.

Under the hood (for developers): it uses the [`litra`](https://github.com/timrogers/litra) Node library **in-process** over USB HID — no CLI subprocess.

## Supported hardware

| Light         | Front power / brightness / temperature |
|---------------|----------------------------------------|
| Litra Glow    | Yes                                    |
| Litra Beam    | Yes                                    |
| Litra Beam LX | Yes (front key light)                  |

**Not included (yet):** Beam LX rear RGB / G HUB effect presets. Research notes are in [`ref/hid-captures/NOTES.md`](ref/hid-captures/NOTES.md).

## Requirements

**To use the plugin (install from Releases)**

- [Stream Deck](https://www.elgato.com/streamdeck) software **7.1+**
- A Litra connected over **USB**
- macOS 12+ or Windows 10+

You do **not** need Node.js, npm, Homebrew, or the `litra` CLI.

Quit **Logitech G HUB** if HID access fights the plugin (especially on macOS).

**To build from source** (contributors only)

- Node.js **20**
- npm

## Install (prebuilt)

1. Download the latest `.streamDeckPlugin` from [Releases](https://github.com/daczarne/streamdeck-litra/releases).
2. Double-click the file (or open it with Stream Deck).
3. Drag **Power**, **Brightness**, or **Temperature** onto your layout.

That’s the full end-user install — the package already includes `litra` / `node-hid`.

If you linked a local/dev copy earlier, unlink it first:

```bash
streamdeck unlink com.daczarne.litra
```

## Build from source

```bash
git clone https://github.com/daczarne/streamdeck-litra.git
cd streamdeck-litra
npm install
npm run build
```

### Link for development

```bash
npm run link   # streamdeck link ./com.daczarne.litra.sdPlugin
npm run watch  # rebuild + restart on change
```

### Package a distributable

```bash
npm run pack
```

Writes `release/com.daczarne.litra.streamDeckPlugin`.

Validate without packing:

```bash
npm run validate
```

## Usage tips

- **Brightness / temperature keys** show the configured preset as the title.
- **Dials** use Stream Deck’s built-in `$A1` layout; rotate adjusts, press toggles front power.
- With **no lights connected**, actions show Stream Deck’s alert indicator.
- Multiple lights are always controlled together in v1.

## Credits

- [timrogers/litra](https://github.com/timrogers/litra) — HID protocol / Node library
- [Elgato Stream Deck SDK](https://docs.elgato.com/streamdeck)

## Security

See [SECURITY.md](SECURITY.md) for how to report vulnerabilities and this project’s secrets policy.

## License

[MIT](LICENSE)
