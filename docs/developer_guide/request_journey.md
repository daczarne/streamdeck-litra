# The journey of a key press

- [The example](#the-example)
- [1. The press reaches the key's instance](#1-the-press-reaches-the-keys-instance)
- [2. Queueing and waiting](#2-queueing-and-waiting)
- [3. Finding and opening the lamps](#3-finding-and-opening-the-lamps)
- [4. Turning on, and the Beam LX's put-back](#4-turning-on-and-the-beam-lxs-put-back)
- [5. The write: sending 400 lm](#5-the-write-sending-400-lm)
- [6. Read-back and caps](#6-read-back-and-caps)
- [7. The Deck follows](#7-the-deck-follows)
- [Timing](#timing)
- [What the log shows](#what-the-log-shows)

This document follows one press of a key, from Stream Deck sending it to the plugin, to the lamps changing, to the Deck showing it. It starts where [start-up][start-up] ends: the actions are registered, each key and dial on screen has its instance, and the plugin holds each lamp's state.

## The example

A Brightness key whose preset is 100%, set to act on every lamp, with 3 Beams and 1 Beam LX plugged in, all known to the plugin. A Power key, a Brightness dial and a Brightness Up key are on the Deck too, to show how the other controls follow.

```text
Deck key ─► Stream Deck app ─► WebSocket ─► SDK ─► BrightnessAction.onKeyDown
  └► PresetKey.keyDown ─► setLampsBrightness("all", 100)
       └► wait for the brightness queue, and for any cap that may still come back
       └► openLamps: find the 4 lamps over HID, ask the LX for its serial, sort by id, reach each Lamp
       └► make sure each lamp is on (the LX gets its old setting put back)
       └► write 400 lm to all 4, one after another
       └► sleep 250 ms
       └► read each lamp's brightness back, and learn a cap where a lamp fell short
       └► close all 4 handles, return { ok, lampCount: 4, failures }
  └► the Brightness key shows ⚠ only if !ok
  └► announceLampsChanged ─► every other key and dial redraws from the Lamps' held state, without reading the lamps
```

## 1. The press reaches the key's instance

1. Stream Deck sends `keyDown`. Of the 8 `keyDown` listeners [start-up registered][start-up-register], the Brightness action's matches the `manifestId`, and calls `BrightnessAction.onKeyDown` ([action-instance.ts][action-instance-keydown]).
2. `take(ev)` finds the key's `PresetKey` by its id. It reads the settings again only if their JSON changed since the last time.
3. [`PresetKey.keyDown`][preset-key-down] works out the key's lamps with [`globalSettings.actionKeyLamps`][action-key-lamps]: `"all"` for a key that never saved a list, or `{ except: [] }` for one that checked all 4 and takes in lamps added later. Either way it covers all 4.
4. It logs `Key pressed: preset 100%, on every lamp`, and awaits `setLampsBrightness(lamps, 100)`.

## 2. Queueing and waiting

[`setLampsBrightness`][set-lamps-brightness] runs the change through [`oneBrightnessChangeAtATime`][one-at-a-time], a promise chain. A dial turn, scene or blink still running is waited for: a change holds the lamps open while they settle, and its read-back would take a later change's lower write for a cap. The `.finally(announceLampsChanged)` attached there is what tells the Deck at the end, whether the change worked or not.

[`waitForCapReversal`][wait-for-cap-reversal] then waits, when a lamp learned a cap less than 1.5 s ago (`BRIGHTNESS_CAP_REVERSAL_WINDOW_MS`), until that window is over: until then, the lamp can still jump back to its cap and undo a lower value written in between.

## 3. Finding and opening the lamps

[`openLamps`][open-lamps] calls [`openGroups`][open-groups]:

1. **Find.** [`LampConnection.findAll`][find-all] calls `litra`'s `findDevices`, which lists the HID devices with vendor `0x046d`, a Litra product id and usage page `0xff43`, and opens each one's path: 4 handles, in whatever order the system lists them.
2. **Identify.** The 3 Beams give their serial number in their USB descriptor. The Beam LX gives none, so [`identify`][identify] asks the lamp for it over HID++ ([`readSerialNumber`][read-serial-number]): Root's `getFeature(0x0003)` gives the index of Device Information, and its function 2 gives up to 12 ASCII characters. If that fails, the LX is logged, closed and left out, but counted as a failure (`unidentified`), since the selection could have covered it.
3. **Sort** by id, the hash of the serial number, so every operation goes through the lamps in the same order.
4. **Mark.** [`markFound`][mark-found] marks each known `Lamp` as connected or not, and tells the settings page shown when that changed.
5. **Keep** the lamps that are known and selected. Any other is closed.

For each lamp kept, [`Lamp.reach`][lamp-reach] marks it found and takes its range: 30 to 400 lm for both models. It reads the lamp only the first time it's reached, or at a new HID path (plugged in again, which also forgets a cap learned at the old path). Since start-up read every lamp, nothing is read here.

## 4. Turning on, and the Beam LX's put-back

In [`moveLampsBrightness`][move-lamps-brightness], each lamp goes through [`ensureOn`][ensure-on]. One whose held state is off is turned on by [`switchPower`][switch-power]:

- **Write** `[0x11, 0xff, idx, 0x1c, 0x01]`, padded to 20 bytes. `idx` is `0x04` on a Beam and `0x06` on a Beam LX.
- **Drain the ACK** ([`drainAck`][drain-ack]), so the next read gets its reply rather than the ACK.
- **Read back** whether it's on.
- **Put back** the setting it holds ([`putBackSetting`][put-back-setting]). A Beam turns on as it was, and nothing is written. A Beam LX turns on at the setting it saved about 500 ms after it was last switched off, so when its brightness or temperature differs from the held one, the held one is written back (#100).

Every read goes through [`readBack`][read-back]: when it fails, it's tried again after 10 ms, and when it fails again, the value asked for is held, with a warning in the log.

## 5. The write: sending 400 lm

Each lamp's target is `clamp(100)`, and [`sendBrightness`][send-brightness]:

- turns it into lumens: `lumenAt(100)` = `ceil(1.0 × (400 − 30) + 30)` = **400 lm** ([`percentageToLumen`][percentage-to-lumen]);
- lowers that to the lamp's cap, when it learned one at this path ([`Lamp.sendBrightness`][lamp-send-brightness]), such as a Beam on a Deck's USB hub;
- writes it through `litra`'s `setBrightnessInLumen`: `[0x11, 0xff, idx, 0x4c, 0x01, 0x90]` (400 is `0x0190`), then drains the ACK.

The 4 writes are synchronous `node-hid` calls, made one after another, so the lamps change at almost the same moment. Then comes `await setTimeout(250)` (`BRIGHTNESS_SETTLE_MS`), the operation's only real pause: a capped Beam takes about 100 ms to drop to its cap, and until then reports what it was sent.

## 6. Read-back and caps

For each lamp, [`readBackBrightness`][read-back-brightness]:

- reads the brightness with [`getBrightnessInLumenSafe`][brightness-safe]: it writes `[0x11, 0xff, idx, 0x31]`, skips up to 10 reports that aren't the reply, and returns `high × 256 + low` (`litra`'s own read takes the low byte alone, wrong above 255 lm);
- logs `set brightness: Beam - <id1> sent 400 lm, reached 400 lm (100%)`;
- learns a cap when the lamp reached less than it was sent ([`brightnessReached`][brightness-reached]): it keeps `{ path, lumen }`, logs `capped at N lm`, and opens the 1.5 s window of [2](#2-queueing-and-waiting);
- holds the lumens reached, and clears `brightnessAsked`, so lamps kept apart by an `each` step (#145) start together again.

[`outcome`][outcome] returns `{ ok, lampCount: 4, failures }`, and the `finally` closes the 4 handles.

## 7. The Deck follows

**The Brightness key** shows nothing new. Its title is its preset, and it doesn't follow the lamps. Back in `keyDown`, it calls `showAlert()` (the ⚠) only when `!result.ok`, such as when the LX couldn't be identified or a write failed. The other lamps are set even then.

**Every other control** hears it through [`announceLampsChanged`][announce]. Each listener runs on its own, once the operation has returned, and each action goes through its instances:

| Control | What it does | Source |
| --- | --- | --- |
| Power key | `areLampsOn`: state 1 if every one of its lamps is now on | [power.ts][power-lamps-changed] |
| Brightness dial, main screen | The brightest lamp's % as text, and a bar that fades where fewer lamps reach, such as `[100, 100, 100, 72]` when one is capped | [measure.ts][dial-lamps-changed], [brightness.ts] |
| A dial on a lamp screen | Redraws its lamp, or goes back to the main screen when the lamp wasn't found | [lamp-screens.ts][lamp-screen-refresh] |
| Temperature dial | Redraws: the temperature didn't change, but the power may have | [measure.ts][dial-lamps-changed] |
| Brightness and Temperature Up and Down keys | Their title, from the lamps' new values | [step-keys.ts][step-key-lamps-changed] |
| Brightness, Temperature and Scene keys | Nothing | `ActionInstance`'s default |

Each one reads through [src/actions/shown.ts], which first awaits `lampsSettled()` (the brightness queue, so the Deck never shows a change halfway), then works out what to show from the `Lamp`s' held state, in [src/lamps-shown.ts]. No lamp is read to redraw the Deck. `setState`, `setFeedback` and `setTitle` go back over the WebSocket, and Stream Deck draws them on the Deck.

## Timing

A press normally takes about 250 ms plus a few ms for each HID round trip: 4 writes, 4 reads, and the LX's two requests for its serial number. It takes longer when another brightness change is still running, right after a cap was learned (up to 1.5 s), or when a lamp was off and has to be turned on, and put back on an LX.

Almost all of the HID work is synchronous, so it holds the plugin's event loop, except the 250 ms settle and the wait for a cap's window.

## What the log shows

`com.daczarne.litra.sdPlugin/logs/litra.log`, in order:

1. at start-up: `Plugin started`, then a `start: … read, since it was first reached: …` line for each lamp;
2. at the press: `Key pressed: preset 100%, on every lamp`;
3. a `turned on` line, and on an LX a `put back` line, for each lamp that was off;
4. a `sent … lm, reached … lm` line for each lamp;
5. a `capped at … lm` line for each lamp that fell short.

[action-instance-keydown]: ../../src/actions/action-instance.ts#L130-L132
[action-key-lamps]: ../../src/global-settings.ts#L182-L187
[announce]: ../../src/litra-manager.ts#L109-L117
[brightness-reached]: ../../src/lamp.ts#L141-L148
[brightness-safe]: ../../src/lamp-connection.ts#L105-L116
[brightness.ts]: ../../src/actions/brightness.ts
[dial-lamps-changed]: ../../src/actions/measure.ts#L150-L152
[drain-ack]: ../../src/lamp-connection.ts#L287-L293
[ensure-on]: ../../src/litra-manager.ts#L560-L564
[find-all]: ../../src/lamp-connection.ts#L181-L183
[identify]: ../../src/lamp-connection.ts#L197-L201
[lamp-reach]: ../../src/lamp.ts#L282-L293
[lamp-screen-refresh]: ../../src/actions/lamp-screens.ts#L114-L128
[lamp-send-brightness]: ../../src/lamp.ts#L325-L329
[mark-found]: ../../src/litra-manager.ts#L349-L369
[move-lamps-brightness]: ../../src/litra-manager.ts#L708-L772
[one-at-a-time]: ../../src/litra-manager.ts#L614-L618
[open-groups]: ../../src/litra-manager.ts#L257-L332
[open-lamps]: ../../src/litra-manager.ts#L423-L472
[outcome]: ../../src/litra-manager.ts#L388-L391
[percentage-to-lumen]: ../../src/lamp.ts#L449-L451
[power-lamps-changed]: ../../src/actions/power.ts#L47-L53
[preset-key-down]: ../../src/actions/measure.ts#L96-L104
[put-back-setting]: ../../src/lamp.ts#L383-L404
[read-back]: ../../src/lamp.ts#L411-L427
[read-back-brightness]: ../../src/lamp.ts#L335-L343
[read-serial-number]: ../../src/lamp-connection.ts#L148-L163
[send-brightness]: ../../src/litra-manager.ts#L638-L663
[set-lamps-brightness]: ../../src/litra-manager.ts#L570-L578
[src/actions/shown.ts]: ../../src/actions/shown.ts
[src/lamps-shown.ts]: ../../src/lamps-shown.ts
[start-up]: start_up.md
[start-up-register]: start_up.md#4-the-body-of-plugints
[step-key-lamps-changed]: ../../src/actions/step-keys.ts#L121-L123
[switch-power]: ../../src/lamp.ts#L368-L377
[wait-for-cap-reversal]: ../../src/litra-manager.ts#L624-L631
