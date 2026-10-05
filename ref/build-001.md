# Build plan: Litra Stream Deck plugin (v1)

Derived from `ref/scope-001.md`, audited against `ref/litra` (JS) and published `litra@4.5.1`. Implements the agreed audit fixes while staying on the JS driver APIs.

## Goals

- Plugin UUID: `com.daczarne.litra`
- Source tree at repo root: `com.daczarne.litra.sdPlugin` (via `streamdeck create`, then hand-edit)
- Runtime dep: npm `litra` (do **not** vendor/copy from `ref/litra`)
- Target hardware: Litra Beam LX; Stream Deck (keys) + Stream Deck + (dials)
- v1 broadcast: every action applies to **all** connected Litra devices

## Action model (aligned)

Three actions only. Brightness and Temperature stay **separate** forever — never one combined “light” action.

| Action | UUID suffix | Controllers | Key (button) | Dial |
| --- | --- | --- | --- | --- |
| Power | `.power` | Keypad only | toggle / on / off (PI mode) | — |
| Brightness | `.brightness` | **Keypad + Encoder** | snap all devices to `presetPercentage` | step all devices by `stepPercentage` |
| Temperature | `.temperature` | **Keypad + Encoder** | snap all devices to `presetKelvin` | step all devices by `stepKelvin` |

Same UUID on a key *or* a dial slot — not four separate action UUIDs. Manifest: `Controllers: ["Keypad", "Encoder"]` for Brightness and Temperature; Encoder `layout: "$A1"`.

## JS `litra` API map (source of truth)

Use only these from `litra` (via `litra-manager`, never from action classes):

| Need | `litra` export |
| --- | --- |
| Enumerate | `findDevices()` |
| Power | `turnOn`, `turnOff`, `toggle`, `isOn` |
| Brightness write % | `setBrightnessPercentage(device, 0–100)` → internally `percentageWithinRange` then `setBrightnessInLumen` |
| Brightness write lm | `setBrightnessInLumen` (integer; device min/max) |
| Brightness read | **see workaround below** — do not trust stock `getBrightnessInLumen` on Beam LX |
| Brightness bounds | `getMinimumBrightnessInLumenForDevice`, `getMaximumBrightnessInLumenForDevice` |
| Temp write | `setTemperatureInKelvin` (must be in allow-list) |
| Temp read | `getTemperatureInKelvin` (`data[4]*256 + data[5]` — correct) |
| Temp bounds / allow-list | `getMinimumTemperatureInKelvinForDevice`, `getMaximumTemperatureInKelvinForDevice`, `getAllowedTemperaturesInKelvinForDevice` |

There is **no** `getBrightnessPercentage` in the package. Convert locally in `litra-manager` using the inverse of litra’s own mapping:

```text
# litra utils.percentageWithinRange (write path):
lumen = ceil((pct / 100) * (max - min) + min)

# our read path for dial / feedback:
pct = clamp(round(((lumen - min) / (max - min)) * 100), 0, 100)
```

### Brightness read workaround (Beam LX)

`ref/litra/src/driver.ts` `getBrightnessInLumen` returns only `data[5]`. Beam LX max is **400** lm; litra-rs correctly uses `data[4]*256 + data[5]`. Stock JS read truncates above 255 lm → dial/feedback wrong on target hardware.

**v1 approach (stay on JS package, minimal ownership):** in `litra-manager`, implement `getBrightnessInLumenSafe(device)` that:

1. Sends the same get-brightness report litra uses (`0x11, 0xff, 0x06, 0x31` for Beam LX / `0x04` for Glow/Beam — mirror `generateGetBrightnessInLumenBytes`).
2. Parses `device.hid.readSync()` as `data[4] * 256 + data[5]` (same as temperature + litra-rs).
3. Is the **only** brightness getter used by actions.

Still use litra for `setBrightnessPercentage` / bounds helpers / findDevices / power / temperature. Document upstream bug; optional later PR to `timrogers/litra`. Do not pull in litra-rs for this.

### HID handle lifetime

`findDevices()` opens a real `node-hid` `HID` per device. Plugin process is long-lived → `forEachDevice` must `try/finally` close via `(device.hid as HID.HID).close()` (litra’s `Device.hid` type omits `close`).

`litra` often `throw`s **strings**, not `Error` — catch with `catch (e)` and log `String(e)`.

## Core module: `src/litra-manager.ts`

Stateless broadcast seam (actions import **only** this module):

- `forEachDevice(fn)`: `findDevices()` every call; per device `try { fn(device) } catch { log; mark failure } finally { close }`. Zero devices ⇒ failure (caller `showAlert()`).
- Thin wrappers: `turnOnAll`, `turnOffAll`, `toggleAll`, `isOnAll` (aggregate: `length > 0 && every(isOn)`), `setBrightnessAllPercentage`, `adjustBrightnessAllByPercentageSteps(ticks, stepPercentage)`, `setTemperatureAllInKelvin`, `adjustTemperatureAllByKelvinSteps(ticks, stepKelvin)`, plus helpers for representative display values.
- Logging: `streamDeck.logger` only.

### Brightness dial math (percent space — matches JS write API)

Per device inside one `forEachDevice` pass:

1. `lumen = getBrightnessInLumenSafe(device)`
2. `min` / `max` from litra bound helpers
3. `currentPct = lumenToPercentage(lumen, min, max)`
4. `nextPct = clamp(currentPct + ticks * stepPercentage, 0, 100)`
5. `setBrightnessPercentage(device, nextPct)`

Key press: `setBrightnessAllPercentage(presetPercentage)` only — no read.

### Temperature dial math (Kelvin + allow-list)

Per device:

1. `current = getTemperatureInKelvin(device)`
2. `raw = current + ticks * stepKelvin`
3. Snap to nearest value in `getAllowedTemperaturesInKelvinForDevice(device)` (do **not** only min/max clamp — `setTemperatureInKelvin` throws if not in the allow-list)
4. `setTemperatureInKelvin(device, snapped)`

PI defaults: `presetKelvin: 4000`, `stepKelvin: 100` (both multiples of 100). Validate in PI / before HID call.

### Dial debounce

Accumulate `ticks` for ~50–80ms per action instance, then one `forEachDevice` batch (open/read/write/close once per burst). Feel-test on Stream Deck +; widen only if laggy. Stay under ~10 UI updates/sec (`setFeedback` / `setTitle`).

## Manifest / UX details

- Power: two `States` (Off/On); set `DisableAutomaticStates: true` so hardware-driven `setState()` is not fighting auto-toggle on key press.
- Brightness / Temperature Encoder: `layout: "$A1"`; `setFeedback({ value: "NN%" | "NNNNK" })` from first successful device; key uses `setTitle()` similarly.
- Icons: plugin + action list + key states (Power Off/On) + encoder icons — follow SDK size rules in `ref/STREAMDECK_SDK_DOCS.md`.
- PI: `sdpi-components` — Power mode select; Brightness preset/step number; Temperature preset/step number (Kelvin, step multiple of 100).

## Packaging spike (gate before actions)

`litra` → `node-hid` native `.node`. Stream Deck’s bundler can drop or break it.

**Gate:** after scaffold + `npm install litra`:

1. Confirm `node-hid` loads inside the running plugin (not only bare Node).
2. One successful `findDevices()` / `isOn` round-trip on Beam LX.
3. Record the packaging approach that worked (typical: mark `node-hid` external + copy `.node` into `.sdPlugin`, or equivalent CLI/bundler config).

Do not implement all actions until this spike passes.

## Implementation sequence

1. `streamdeck create` → rename UUID/files to `com.daczarne.litra`; Node 20 or 24 per manifest.
2. `npm install litra`; configure native bundling; **HID spike**.
3. Implement `litra-manager.ts` (forEachDevice, close, safe brightness read, %↔lm helpers, broadcast wrappers).
4. Power action + PI + states + empty-device / alert behavior.
5. Brightness action (key + dial + feedback/title) + PI.
6. Temperature action (key + dial + allow-list snap + feedback/title) + PI.
7. Manual verification (below).
8. Optional: `streamdeck pack` when ready to distribute.

## Out of scope (unchanged)

- Beam LX RGB back light (JS lib has no API; litra-rs only)
- Per-device picker (v1 all-or-nothing)
- Any litra-rs / CLI / MCP integration

## Verification

1. `npm run build` / `npm run watch`; `streamdeck restart com.daczarne.litra`.
2. Power key: toggle/on/off all devices; `onWillAppear` Off when none connected; On only if `length > 0 && every(isOn)`; alert when none plugged in.
3. Brightness on a **key**: preset % on all devices. Brightness on a **dial**: smooth step by %; `$A1` shows %; works above ~64% / 255 lm on Beam LX (proves safe read).
4. Temperature on a **key**: preset K. Temperature on a **dial**: steps stay on allow-list (no thrown string / alert from invalid K).
5. Unplug/replug → next press works without plugin restart.
6. Fast dial spin: responsive; no FD leak over a long session.

## Fix log (vs scope-001)

| Issue | Resolution |
| --- | --- |
| Dial mixed lumen + `%` then `setBrightnessPercentage` | Stay in **percent** space; convert with litra’s min/max mapping |
| Temp clamp only | Snap to `getAllowedTemperaturesInKelvinForDevice` |
| `node-hid` packaging | Explicit spike gate before actions |
| Debounce vague | 50–80ms tick coalesce per action instance |
| Feedback units | `%` for brightness, Kelvin for temperature |
| Beam LX brightness read bug in JS litra | Local `getBrightnessInLumenSafe` in manager |
| Brightness vs Temperature | Separate actions; each Keypad + Encoder |
