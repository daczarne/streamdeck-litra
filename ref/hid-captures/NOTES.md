# Litra Beam LX back-light research — status (paused)

**Status:** paused 2026-07-13  
**Hardware:** 2× Litra Beam LX (`046d:c903`), synced in G HUB when testing presets  
**Host:** macOS (SIP enabled), G HUB 39.x with DriverKit `com.logi.ghub.hidfilter`  
**Plugin v1:** front white light only (`com.daczarne.litra`) — back RGB explicitly deferred  

This folder (`ref/hid-captures/`) holds raw JSON captures, Frida hook scaffolding, and this note. Upstream clones stay in `ref/litra` / `ref/litra-rs` (gitignored).

---

## Executive summary

| Goal | Outcome |
|------|---------|
| Read which G HUB preset is active (Pulsar Point, Color Wave, …) | **Not available** via device GETs while G HUB is running |
| Set solid zone colors without G HUB | **Works** (`litra` CLI / `0x8081` zone + commit) |
| Set back on / brightness % | **Works** (`0x8040`, same as litra-rs) |
| Map Pulsar / Color Wave to HID++ effect IDs | **Incomplete** — catalog known; G HUB does not expose live effect via polled registers |
| Sniff G HUB HID writes on this Mac | **Blocked** — Hardened Runtime + SIP; agent uses DriverKit HID filter |

**Practical v2 scope when resumed:** back on/off, back brightness %, solid (and maybe per-zone) RGB via known SET path. Named G HUB animations are a separate, harder track (USB sniff with SIP off, or Linux usbmon).

---

## What we already ship (v1 — do not regress)

Front **Illumination** (`0x1990` @ feature index `0x06`): power, brightness (lumen/%), color temperature. Implemented in-plugin via npm `litra` + `src/litra-manager.ts` (safe brightness read, HID close, Node 20 packaging). Dial press toggles front power. Back light was out of scope for v1 by design (`ref/scope-001.md`).

---

## Protocol primer (HID++)

- Usage page `0xFF43`, long reports: Report ID `0x11`, device index `0xFF`, 20-byte payload.
- Byte 3 = `(functionId << 4) | softwareId`. Official apps often use softwareId `0xC`; litra-rs uses `0xB`. Both work for many calls.
- Feature **index** (byte 2) is device-specific; resolve via Root `0x0000` / Feature Set `0x0001`.
- Errors: response with feature index `0xFF` (extra `FF` in stream).
- Refs: [cajus/litra-testbed](https://github.com/cajus/litra-testbed), OpenRGB `LogitechProtocolCommon`, libratbag `hidpp20` `0x8071`, litra-rs `set_back_*`.

### Feature map (this Beam LX — 13 features)

| Idx | Feature ID | Name / role |
|----:|------------|-------------|
| 0 | `0x0000` | Root |
| 1 | `0x0001` | Feature Set |
| 2 | `0x0003` | Firmware info |
| 3 | `0x0005` | Device name/type |
| 4 | `0x0011` | (unexplored) |
| 5 | `0x1602` | (unexplored) |
| 6 | `0x1990` | Illumination — **front white** (v1) |
| 7 | `0x1eb0` | hidden/internal |
| 8 | `0x1803` | hidden/internal |
| 9 | `0x1807` | hidden/internal |
| 10 | `0x8040` | Brightness Control — **back on / %** |
| 11 | `0x8071` | RGB Effects — **firmware effect catalog** |
| 12 | `0x8081` | Per-Key Lighting v2 — **7 zone RGB** |

Capture: `hidpp-feature-map-2026-07-13T16-50-50-728Z.json`.

---

## Back power / brightness — `0x8040` @ idx `0x0A`

Aligned with litra-rs / ha-litra:

| Fn | Role | Notes |
|---:|------|-------|
| 0 | Status blob | e.g. `00 64 64 1f 00 01` while on @ 100% |
| 1 | Get brightness % | payload often `[0, pct]` |
| 2 | Set brightness % | `00 <pct>` |
| 3 | Get on | `01` / `00` |
| 4 | Set on | `01` / `00` |

**Verified:** `litra back-on`, `back-brightness --percentage 100`, and matching raw HID. Reliable with or without G HUB for these GETs.

---

## Zone RGB — `0x8081` @ idx `0x0C`

| Fn | Role |
|---:|------|
| 0 | Info / mode byte (`fe` often seen) |
| 1 | Zone color: `zone(1–7), R, G, B, FF, …` (litra-rs SET; RGB channels must be ≥ 1) |
| 7 | Commit after zone writes: `00 00 01` (**required**) |

**Verified without G HUB:**

- `litra back-color --value FF0000` / `00FF00` — user confirmed **solid red**, and **one red + one green** when targeting each `--device-path`.
- Sync in G HUB is separate; our SETs can address devices independently via path.

**Not reliable:**

- Treating `fn1` as a pure GET. Same function is the SET path; probing with incomplete params can **zero** colors or desync the HID read queue.
- Zone “reads” returning `ff ff ff` even when UI showed fixed `#FF0000` under G HUB — do not trust as live framebuffer.
- Rapid / wrong `0x8071` SETs sometimes left a device **back off** or returned empty ACKs / wedged reads (`Cannot write to hid device`). Prefer `litra` CLI for known-good color SETs; unplug/replug if HID wedges.

---

## RGB effects catalog — `0x8071` @ idx `0x0B`

Device reports **2 clusters × 3 effects** (OpenRGB / libratbag layout).

Info dump: `GET_INFO` with `[0xFF, 0xFF]` → cluster count `2`.  
Per cluster: `[cluster, 0xFF]` → metadata; `[cluster, effectIdx]` → effect id / caps / period.

### Cluster 0 (location `1`)

| Effect idx | Effect ID | Meaning |
|-----------:|-----------|---------|
| 0 | `0x0001` | Fixed / ON |
| 1 | `0x000A` | Breathing (OpenRGB) |
| 2 | `0x0015` | Unknown |

### Cluster 1 (location `0xFF`)

| Effect idx | Effect ID | Meaning |
|-----------:|-----------|---------|
| 0 | `0x0013` | Unknown |
| 1 | `0x0016` | Unknown (Color Wave candidate — unproven) |
| 2 | `0x0018` | Unknown (Pulsar candidate — unproven) |

Capture: `rgb-effects-catalog-2026-07-13T16-51-39-170Z.json`.

`SET_LED_EFFECT` is fn1 (OpenRGB `LOGITECH_FP8071_SET_LED_EFFECT`). SW control is fn5 with OpenRGB pattern `[1, 3, control]` (control `5` = SW). Taking SW control can interfere with firmware / G HUB animations.

**Visual mapping:** incomplete. User reported “bounding” during an earlier multi-step cycle (likely breathing). Later A/B breathing-only test was inconclusive; one device was knocked **off** after effect SET. **Do not treat `0x0015`/`0x0016`/`0x0018` as named presets until remapped carefully with G HUB fully quit and one change at a time.**

Cluster `effect_index` (byte after cluster id in `[c, 0xFF]` response) stayed `0` for Pulsar Point, Color Wave, and fixed color while G HUB ran — **not a usable live “current preset” signal under G HUB**.

---

## Preset capture campaign (with G HUB)

User switched presets; we dumped status / zones / later `0x8071`:

| Preset | Capture file(s) | Diff vs others |
|--------|-----------------|----------------|
| Pulsar Point | `pulsar-point-*.json`, `pulsar-point-8071-*.json` | Same interesting GETs as Color Wave / fixed |
| Color Wave | `color-wave-*.json` | No effect fingerprint change |
| Fixed `#FF0000` | `fixed-ff0000-*.json` | Zones still read white; only on/bri differed when a lamp was off |

**Conclusion:** named presets are **not** distinguishable on the GET surface we know. G HUB almost certainly renders synced animations in software (possibly via the HID filter dext) without updating `0x8071` cluster selection or `0x8081` zone registers in a way we can poll.

---

## Dual-device poll monitor (flip test)

- Script window ~90s, both HID++ interfaces, ~4 Hz poll of on/bri/status/clusters/zoneInfo/control + read drains.
- User confirmed they **flipped** presets during the window.
- Result: **`changeCount: 0`** on both devices (`ghub-monitor-2026-07-13T17-02-05-351Z-summary.json`).
- Empty “events” in that log are false positives (zero-length reads), not HID++ notifications.

**Implication for sync:** lights stay visually synced, but our GETs never moved — G HUB is driving both (or mirroring) **above** the registers we poll. We still don’t know if the write fan-out is 1× or 2× on the wire without a USB sniff.

---

## Why we can’t sniff G HUB writes on this Mac (yet)

1. **`lghub_agent` Hardened Runtime** (`codesign` flags `runtime`) — even `sudo frida -p <agent>` fails: *unable to access process from the current user account*.
2. Agent entitlement: `com.apple.developer.driverkit.userclient-access` → **`com.logi.ghub.hidfilter`** (activated DriverKit HID filter). Traffic may not be plain userspace `IOHIDDeviceSetReport`.
3. **SIP enabled** — Wireshark USB (`XHC20`) needs SIP disabled from Recovery (reboot in + reboot out; cannot toggle from a normal session).
4. Scaffolding left in place for later:
   - `hook-lghub-hid.js` — Frida hooks for IOHID / `write`
   - `capture-ghub-hid.sh` — attach helper (will keep failing until SIP/hardened constraints change)
   - `.venv-frida/` — local frida-tools venv (**gitignored**)

### Resume options for sniffing

| Approach | Cost |
|----------|------|
| Recovery → `csrutil disable` → Wireshark USB → re-enable SIP | Two Recovery reboots; best on-Mac path |
| Linux box/VM + usbmon + USB passthrough | No SIP; cleanest HID capture |
| Skip sniff; implement SET-only back actions | Product path for v2 |

---

## Tooling that worked

- **Raw `node-hid`** probes (this repo’s Node deps).
- **`litra` CLI** (`/opt/homebrew/bin/litra`) — best known-good for `back-on`, `back-brightness`, `back-color` (and `--device-path` / `--zone`).
- **OpenRGB / libratbag / litra-rs / ha-litra / litra-testbed** — protocol documentation, not runtime deps of the plugin.

---

## Capture index

| File | What |
|------|------|
| `pulsar-point-2026-07-13T16-46-38-395Z.json` | Early GET dump, Pulsar |
| `color-wave-2026-07-13T16-47-51-433Z.json` | Early GET dump, Color Wave |
| `fixed-ff0000-2026-07-13T16-48-38-371Z.json` | Early GET dump, fixed red |
| `write-ff0000-then-read-*.json` | Zone SET then GET (still white under G HUB) |
| `hidpp-feature-map-*.json` | Full feature table + probes |
| `effect-slot-scan-*.json` | `0x8071` / `0x8081` param scan |
| `rgb-effects-catalog-*.json` | Cluster/effect ID catalog |
| `pulsar-point-8071-*.json` | Pulsar with cluster state (effect_index still 0) |
| `ghub-monitor-*-summary.json` | Dual poll during flips — **0 changes** (raw `.jsonl` discarded; gitignored) |
| `hook-lghub-hid.js` / `capture-ghub-hid.sh` | Frida attach (blocked on this Mac) |

Raw Frida/monitor `.jsonl` streams and `.venv-frida/` are gitignored — recreate the venv with `python3 -m venv .venv-frida && .venv-frida/bin/pip install frida-tools` if needed.

---

## Recommended next steps (when unpaused)

### Product (v2 back light) — preferred first slice

1. Extend `litra-manager` with raw HID++ (or thin wrappers) for:
   - back on / off / toggle  
   - back brightness %  
   - set all zones + commit (single color); optional `--zone` later  
2. New Stream Deck actions + PI, same broadcast/stateless pattern as front light.  
3. Do **not** promise G HUB preset names until sniffing or careful effect mapping lands.  
4. Document: quit G HUB (or expect fights) when using plugin back RGB; hidfilter/agent may reclaim.

### Research — only if named presets matter

1. **Wireshark USB** after SIP disable, or **Linux usbmon**, while flipping Fixed → Pulsar → Color Wave with sync on/off.  
2. Map captured writes to `0x8071` SET vs `0x8081` zone streams; check whether sync = 2× identical writes.  
3. With G HUB **fully** quit (agent + UI; updater alone is OK), one-effect-at-a-time SET on a single device; user confirms visual; record ID → name. Avoid rapid multi-effect scripts (device wedge risk).  
4. Re-test zone GET only with a dedicated non-destructive method if one is found; until then assume **SET-only** for color.

### Explicit non-goals while paused

- Shipping Pulsar Point / Color Wave as first-class actions.  
- Relying on Frida against hardened `lghub_agent` without SIP changes.  
- Treating `0x0c 1b` probes as safe color reads.

---

## Open questions

1. Exact wire mapping of G HUB “Pulsar Point” / “Color Wave” / “Fixed” (effect SET vs streamed zone frames).  
2. Whether synced lights get one USB conversation or two.  
3. Safe GET for current zone RGB (if any).  
4. Stable `0x8071` SET sequence that selects firmware effects without turning back off or wedging HID.  
5. Behavior when plugin and G HUB both run (ownership / flicker).

---

## Related repo docs

- [`README.md`](../README.md) — public install / build / pack
- `ref/scope-001.md` — v1 scope; back RGB deferred
- `ref/build-001.md` — v1 implementation plan
- Plugin: `src/litra-manager.ts`, actions under `src/actions/`
