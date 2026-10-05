# Stream Deck plugin for Logitech Litra lights (v1 scope)

## Context

Goal: control a Logitech Litra Beam LX from Stream Deck. We evaluated two upstream libraries (both cloned read-only into `ref/`, git-ignored):
- `ref/litra-rs` — actively maintained Rust CLI/crate/MCP server, but every integration path (shell-out, persistent MCP-over-stdio process, or a full native Rust WebSocket plugin) adds either jank or ownership of glue/build infra.
- `ref/litra` — plain TypeScript library on `node-hid` (`findDevice()`, `turnOn()`, `setBrightnessPercentage()`, `setTemperatureInKelvin()`, etc. in `ref/litra/src/driver.ts`). Stale (no commits since the Dec 2025 release) but the HID protocol for hardware you already own won't change under you, and it drops straight into the Node.js Stream Deck SDK with zero bridging.

Decision: use `litra` (JS) as an npm dependency, in-process, no subprocess/IPC at all. Back-light (RGB) control on the Beam LX is explicitly **out of scope for v1** — the JS library never implemented it (only litra-rs has it); revisit later, either by patching it into the JS lib or bolting on a separate call path just for that feature.

Target hardware confirmed: Litra Beam LX; both a standard Stream Deck (keys only) and a Stream Deck + (dials/touch strip) — so actions need to work as both Keypad and Encoder controllers.

## Project layout

New plugin project at repo root (sibling to `ref/`): `com.daczarne.litra.sdPlugin` source tree, scaffolded via `streamdeck create` (per `ref/STREAMDECK_SDK_DOCS.md` Getting Started section) then hand-edited. Add `litra` (from npm, the published package backing `ref/litra`) as a runtime dependency — do not vendor/copy code out of `ref/litra`, just `npm install litra`.

## Core module: `src/litra-manager.ts`

Wraps the `litra` library so action classes never call `findDevices()`/HID functions directly. **v1 is "all or nothing": every action applies to every connected Litra device — no per-device selection UI, and no cached device list.**

Deliberately **stateless**, matching how the `litra-rs` CLI behaves (`litra on`/`litra off` just re-scan and act on whatever's connected, every invocation — no persisted device state to go stale):
- `forEachDevice(fn: (device: Device) => void)`: calls `litra`'s `findDevices()` fresh on every invocation (cheap in-process HID enumeration, not a subprocess spawn — nothing like the cost we were worried about with `litra-rs`'s CLI), then for each device: `try { fn(device) } catch { log and continue } finally { close the device's HID handle }`.
- No cache, no invalidation, no retry-on-failure logic needed — a device that's unplugged simply won't appear in the next `findDevices()` call, and a freshly replugged one will, with zero extra code.
- The one place we deliberately diverge from just copying CLI behavior: the CLI is a short-lived process, so the OS reclaims its opened HID handles on exit automatically. Our plugin process stays alive indefinitely, so `forEachDevice` explicitly closes each device's HID handle after use (`device.hid.close()`) to avoid leaking file descriptors across a long-running session. Note: `litra`'s `Device.hid` type only declares `write`/`readSync`, not `close` — at runtime it's a real `node-hid` `HID.HID` instance that does have `.close()`, so this needs a small local type cast/augmentation in `litra-manager.ts` rather than being callable as-typed.
- All broadcast operations (`turnOnAll()`, `setBrightnessAllPercentage()`, `setTemperatureAllInKelvin()`, `toggleAll()`, ...) are thin wrappers around `forEachDevice` calling the matching `litra` function.
- All device calls funnel through this module so logging lives in one place, using `streamDeck.logger` (per `ref/STREAMDECK_SDK_DOCS.md` Logging guide) — never `console`.
- Exposes a device-shaped API, not a re-export of the `litra` package's own exports — action classes only ever import from `litra-manager`, never from `litra` directly.

### Why this matters for a later pivot to owning the JS library

This module is the single seam between "the `litra` npm package" and "our plugin." If we later decide to fork/vendor `litra` ourselves (e.g. to add Beam LX back-light support, per the deferred item below), the change is contained entirely to `litra-manager.ts`'s import (swap `import { turnOn } from "litra"` for a local vendored path) plus whatever new methods we add (e.g. `setBackColor`) — no action class, manifest entry, or PI changes are needed for the pivot itself. Adding the back-light *feature* afterward is then just a new action following the same pattern as Brightness/Temperature. Starting with the npm package today doesn't lock us in; it just means day one has zero fork-maintenance burden, and we take on exactly as much ownership as we need, exactly when we need it.

## Actions

All three actions declare `Controllers: ["Keypad", "Encoder"]` where noted, so the *same* action can be dropped on a key (standard Stream Deck) or a dial slot (Stream Deck +) — matches "key sets a static value, dial changes it continuously."

All action UUIDs are prefixed by the plugin UUID `com.daczarne.litra`.

1. **Power** (`<uuid>.power`) — Keypad only.
   - Settings: `{ mode: "toggle" | "on" | "off" }` (PI dropdown, default `toggle`).
   - `onKeyDown`: call the broadcast `toggleAll()`/`turnOnAll()`/`turnOffAll()` per mode via litra-manager — applies to every connected device.
   - `onWillAppear`: call `isOn()` across all devices and `setState()` so the key reflects hardware state; with multiple devices, show "on" only if *all* are on **and at least one device is connected** — `devices.length > 0 && devices.every(isOn)`. (Plain `.every()` on an empty array is vacuously `true` in JS, which would show "On" with nothing plugged in — the explicit length check is required, not optional.)
   - Two manifest `States` (Off/On) with distinct icons.

2. **Brightness** (`<uuid>.brightness`) — Keypad + Encoder (separate action from Temperature; same UUID usable as a key *or* a dial).
   - Settings: `{ presetPercentage: number, stepPercentage: number }` (defaults e.g. 100, 5).
   - `onKeyDown` (key placement): `setBrightnessAllPercentage(presetPercentage)` — the "static" behavior, applied to every device.
   - `onDialRotate` (dial placement): work entirely in **percent** space to match litra’s write API. Per device, in one `forEachDevice` pass: read lumen via a manager helper that parses `data[4]*256+data[5]` (do **not** use stock `getBrightnessInLumen` — it only returns `data[5]` and breaks Beam LX above 255 lm), convert to % with the inverse of litra’s `percentageWithinRange` using that device’s min/max lumen helpers, compute `clamp(currentPct + ticks * stepPercentage, 0, 100)`, then `setBrightnessPercentage`. Debounce ticks (~50–80ms) into one batch. No cached "last known" brightness.
   - `onWillAppear`/after each change: `setFeedback()` (built-in `$A1`) with representative **%** from the first device; `setTitle()` for the key-only case.

3. **Color Temperature** (`<uuid>.temperature`) — Keypad + Encoder (separate action from Brightness; same UUID usable as a key *or* a dial).
   - Settings: `{ presetKelvin: number, stepKelvin: number }` (defaults e.g. 4000, 100 — must stay a multiple of 100 per `getAllowedTemperaturesInKelvinForDevice`).
   - `onKeyDown`: `setTemperatureAllInKelvin(presetKelvin)`, applied to every device.
   - `onDialRotate`: read `getTemperatureInKelvin()` per device fresh, compute `current + ticks * stepKelvin`, then **snap to the nearest value in** `getAllowedTemperaturesInKelvinForDevice` (min/max clamp alone is insufficient — litra throws if the value is not on the allow-list), then `setTemperatureInKelvin`. Same debounce pattern as Brightness.
   - Same `setFeedback()`/`setTitle()` pattern as Brightness, displaying Kelvin.

Property inspectors: simple `sdpi-components` forms (number/slider fields for presets/steps, dropdown for power mode) per `ref/STREAMDECK_SDK_DOCS.md` Property Inspectors guide.

## Error handling

`forEachDevice` iterates all devices independently: one device's HID write throwing is caught, logged via `streamDeck.logger.error`, and does not stop the loop from reaching the remaining devices. `forEachDevice` treats **zero devices found** as a failure too, not a silent no-op — a key press that can't reach any hardware must still surface `action.showAlert()`, otherwise pressing a button with nothing plugged in gives no feedback at all. If *any* device in the broadcast failed (including "none found"), the action calls `action.showAlert()` once to surface it. No polling/interval-based reconnect and no retry logic needed at all — statelessness means "reconnect" isn't a special case, the next action press just sees the current device list.

## Out of scope for v1 (explicitly deferred)

- Beam LX RGB back light control (needs litra-rs; JS lib doesn't support it).
- Per-device selection/targeting UI — v1 is intentionally all-or-nothing across every connected Litra device; a picker can be added later without changing `litra-manager`'s broadcast methods (it would just filter which devices they loop over).
- Any use of `litra-rs`, its CLI, or its MCP server.

### Back-light research pause (2026-07-13)

Exploratory HID++ work for Beam LX back RGB / G HUB presets is **paused**. Findings, feature map, capture index, macOS sniff blockers (Hardened Runtime + `com.logi.ghub.hidfilter` + SIP), and a recommended v2 SET-only slice live in **`ref/hid-captures/NOTES.md`**. Do not assume named presets (Pulsar Point, Color Wave) are readable from the device while G HUB is running.

## Verification

1. `npm run build` in the plugin project, `streamdeck restart <uuid>` (or `npm run watch` during development, per `ref/STREAMDECK_SDK_DOCS.md` Getting Started/Your First Changes).
2. Manually assign each action to a key on the standard Stream Deck and to a dial slot on the Stream Deck +.
3. Confirm: key press toggles power (all devices) and reflects true aggregate state on `onWillAppear`; key press on Brightness/Temperature snaps every connected device to the preset; dial rotation smoothly adjusts brightness/temperature on all devices with the touch display updating; unplugging and replugging a device, then triggering an action, "just works" on the next press with no plugin restart (since `forEachDevice` re-scans every time). If only one Litra device is available for testing, confirm the broadcast path still behaves correctly for a single-item array (no special-casing needed).
4. With nothing plugged in, confirm the Power key shows **Off** (not On) and pressing any action shows `showAlert()` rather than doing nothing silently.
5. Feel-test dial rotation specifically for responsiveness (spin it fast) — the open/read/write/close-per-device-per-debounced-batch design should feel smooth, but this is the one spot the stateless approach could show latency under rapid input; if it feels laggy, that's the signal to revisit (e.g. widen the debounce window or reconsider a short-lived per-gesture handle) rather than something to pre-optimize now.
