# Start-up

- [Overview](#overview)
- [1. Before Stream Deck starts: the plugin folder](#1-before-stream-deck-starts-the-plugin-folder)
- [2. Stream Deck reads the manifest and starts the plugin](#2-stream-deck-reads-the-manifest-and-starts-the-plugin)
- [3. Loading the bundle: what runs on import](#3-loading-the-bundle-what-runs-on-import)
- [4. The body of plugin.ts](#4-the-body-of-plugints)
- [5. Connecting and registering with Stream Deck](#5-connecting-and-registering-with-stream-deck)
- [6. What Stream Deck sends back](#6-what-stream-deck-sends-back)
- [7. Ready: what the plugin holds](#7-ready-what-the-plugin-holds)
- [Sources](#sources)

This document follows the plugin from Stream Deck starting it to the moment it's ready for a key press: how Stream Deck finds and starts it, what runs as it loads, how the actions are registered, how it connects to Stream Deck, and what it reads before the keys and dials show the lamps. [The journey of a key press][request-journey] picks up from there.

It's read from the plugin's code and from `@elgato/streamdeck` 3.0.3. What Stream Deck itself does, outside the plugin and the SDK, is inferred from what the SDK expects of it.

## Overview

```text
Stream Deck starts ─► reads manifest.json ─► spawns Node 24 on bin/plugin.js, with -port -pluginUUID -registerEvent -info
  └► imports run: SDK services, node-hid's binary, the logger, globalSettings, the action classes (@action)
  └► plugin.ts: registerAction × 8, answerLampPickers, useLamps, syncGlobalSettings, connect
  └► WebSocket opens ─► { event: registerEvent, uuid } ─► queued getGlobalSettings goes out
  └► Stream Deck sends willAppear for each key and dial on screen ─► each gets its ActionInstance and draws
  └► didReceiveGlobalSettings ─► a Lamp for each known lamp ─► reachEveryLamp reads each lamp ─► every control redraws
```

## 1. Before Stream Deck starts: the plugin folder

`npm run build` runs Rollup ([rollup.config.mjs]), which bundles `src/plugin.ts` and everything it imports into one file, `com.daczarne.litra.sdPlugin/bin/plugin.js`, with two exceptions:

- `node-hid` stays external, since it ships a native binary. `copyNativeRuntime` copies the files of `node-hid` and `pkg-prebuilds` that run into the plugin folder's own `node_modules/`, so the bundle's `import … from "node-hid"` finds them next to it.
- `bin/package.json` holds `{"type":"module"}`, so Node loads the bundle as an ES module.

`npm run link` runs `streamdeck link`, which puts a symlink to the plugin folder in `~/Library/Application Support/com.elgato.StreamDeck/Plugins/`. Stream Deck runs whatever the folder holds, so a new build takes effect on the next restart of the plugin.

## 2. Stream Deck reads the manifest and starts the plugin

Stream Deck reads [manifest.json] from every folder in `Plugins/`. Everything it shows before the plugin runs comes from there, not from the plugin's code:

- the Litra category and the 8 actions, each with its `UUID`, icon, tooltip, settings page (`PropertyInspectorPath`), the controllers it can sit on (`Keypad`, `Encoder`), its states and, for a dial, its layout (`$B1`) and trigger descriptions;
- `CodePath` (`bin/plugin.js`), the file to run;
- `Nodejs.Version` (`24`), the runtime to run it with, which Stream Deck downloads into `~/Library/Application Support/com.elgato.StreamDeck/NodeJS/`.

Stream Deck then starts its own Node 24 on `bin/plugin.js`, with the plugin folder as the working directory, and passes 4 arguments, which the SDK reads from `process.argv` (`getRegistrationParameters`, in its `connection.js`):

| Argument | What it is |
| --- | --- |
| `-port` | The port of Stream Deck's WebSocket server on `127.0.0.1` |
| `-pluginUUID` | The id the plugin registers with, and sends as the `context` of its own requests, such as `getGlobalSettings` |
| `-registerEvent` | The name of the event the plugin sends to register |
| `-info` | JSON about Stream Deck, its version and language, the system, and the devices connected |

Everything that uses the working directory depends on it being the plugin folder: the SDK reads `manifest.json` from it, and both loggers write to its `logs/`.

## 3. Loading the bundle: what runs on import

Before the first line of `plugin.ts` runs, every module it imports is evaluated, in import order. Several of them do real work at that point:

- **The SDK's logger** (`logging/index.js`) creates its file target, `logs/com.daczarne.litra.<n>.log`, and installs a handler that logs an uncaught exception.
- **The SDK's `ActionService`** (`actions/service.js`) is created. Its constructor `prependListener`s 3 handlers on the connection, so they run before any of the plugin's:
  - `willAppear`: creates a `KeyAction` or `DialAction` for the key or dial (from `payload.controller`), puts it in the action store, and caches its settings;
  - `didReceiveSettings`: updates the settings cache;
  - `willDisappear`: removes both.
- **The SDK's `Connection`** (`connection.js`) is created, not yet connected. Its `connection` promise is pending, so anything sent before the WebSocket opens waits for it.
- **`litra`** imports `node-hid`, which loads its native binary from the plugin folder's `node_modules/`. A missing file there stops the plugin at this point.
- **[src/logging.ts]** creates the plugin's logger, which writes to `logs/litra.log`, rotated by size. The file is created on the first entry.
- **[src/litra-manager.ts]** sets up its module state: no known lamps yet, an already resolved `brightnessChanges` promise (the brightness queue), and empty listener lists.
- **[src/global-settings.ts]** creates the `globalSettings` instance, holding the settings' defaults and no lamps, which saves through `streamDeck.settings.setGlobalSettings`.
- **The action classes** are defined. `@action({ UUID })` (`actions/decorators.js`) replaces each class with a subclass that has a `manifestId` field set to the UUID, such as `com.daczarne.litra.brightness` for `BrightnessAction` ([brightness.ts]).

## 4. The body of plugin.ts

[src/plugin.ts] then runs, top to bottom, in one go, before any message from Stream Deck can be handled:

1. **Logging.** It sets the SDK's logger to `info`, and logs `Plugin started` to `litra.log`, which marks where each run starts.
2. **8 × `registerAction(new XAction())`.** For each action:
   - `new XAction()` runs the [`RoutingAction` constructor][action-instance-constructor], which subscribes once to `onLampsChanged` (litra-manager) and to `globalSettings.onChanged`. These two subscriptions are how every key and dial of the action follows a change later. `BrightnessAction` also passes its logger scope, its `PRESET` (what a key sets) and its `BRIGHTNESS` measure (what a dial steps and shows) to `MeasureAction`.
   - `registerAction` (`actions/service.js`) checks the `manifestId`. It throws when the id is missing, or when `manifest.json` doesn't list it, which stops the plugin as it starts.
   - It then routes the action's events. For each handler the action has (a `RoutingAction` has `onWillAppear`, `onWillDisappear`, `onDidReceiveSettings`, `onKeyDown`, `onDialDown`, `onDialRotate` and `onTouchTap`), it subscribes a listener to that event on the connection, which calls the handler only when the event's `manifestId` is the action's own.

   So 8 listeners hear every `keyDown`, and only the one whose `manifestId` matches calls its action. See [the SDK's actions][elgato-sdk-actions] for what that means for the actions.
3. **[`answerLampPickers`][lamp-picker].** It subscribes to `sendToPlugin`, the messages the settings pages send (Find lamps, Identify, rename, forget, which lamps are connected), and to `onConnectedChanged`, which tells the page shown when a lamp is plugged in or unplugged.
4. **`useLamps(globalSettings.lamps)`** hands litra-manager the map of known lamps, empty for now. It's the same `Map` object the global settings keep up to date, so litra-manager always sees the current lamps. `plugin.ts` makes the call, so that litra-manager doesn't depend on the global settings, and its tests can hand it lamps of their own.
5. **[`syncGlobalSettings`][sync-global-settings].**
   - It subscribes to `onDidReceiveGlobalSettings`, so a settings page's change is read again.
   - It calls `getGlobalSettings()`, which waits for a `didReceiveGlobalSettings` carrying its request's id, and sends the request through `connection.send`. That waits for the connection, so the request is queued until the WebSocket opens.
   - It returns a promise that resolves once that first read is done. `plugin.ts` waits for it only after the next step: awaited before `connect()`, it would never resolve.
6. **`streamDeck.connect()`**, whose failure is logged to `litra.log` rather than left to the SDK's own files.
7. **Finding and reading the lamps**, chained to the first read, so they run once the settings are read: when the plugin knows no lamps, as on a first start, it finds the connected ones and saves them, then it reads every lamp it knows that's connected. When the read fails, the failure is logged, and no lamp is found or read: knowing no lamps, the plugin would find the connected ones and save them over the ones saved.

## 5. Connecting and registering with Stream Deck

`Connection.connect` (`connection.js`):

1. opens a WebSocket to `ws://127.0.0.1:<port>`;
2. once it's open, sends `{ "event": <registerEvent>, "uuid": <pluginUUID> }`, which registers the plugin with Stream Deck;
3. resolves its `connection` promise, which releases what was waiting to be sent: the queued `getGlobalSettings`.

From then on, every message from Stream Deck is parsed as JSON and emitted by its `event` name (`willAppear`, `keyDown`, …) to the listeners subscribed in [3](#3-loading-the-bundle-what-runs-on-import) and [4](#4-the-body-of-plugints). Everything the plugin does to the Deck (`setTitle`, `setState`, `setFeedback`, `showAlert`, `setGlobalSettings`) is a message sent the other way.

## 6. What Stream Deck sends back

Two things arrive, and nothing in the plugin depends on which comes first.

**A `willAppear` for each key and dial on screen.** For each:

1. The SDK's prepended listener creates the `KeyAction` or `DialAction`, stores it, and caches its settings.
2. The routed listener of the matching action calls [`RoutingAction.onWillAppear`][action-instance-appear], which calls the action's `create` and stores the instance under the key's or dial's id. For the Brightness action, [`MeasureAction.create`][measure-create] gives a key a `PresetKey` and a dial a `MeasureDial`. Each instance reads its settings against their schema as it's built, so an invalid setting is warned about once.
3. `instance.appear()` draws the control. What it can show depends on whether the lamps were read yet:

| Control | What it shows as it appears |
| --- | --- |
| Brightness key (`PresetKey`) | Its preset as its title, whatever the lamps are at |
| Power key | `areLampsOn`: with no lamp reached yet, none is on, so state 0 |
| Brightness dial (`MeasureDial`) | Sets the `$B1` layout, then its main screen: with no lamp reached, `—` and an empty bar |
| Brightness Up key | Its title, from the lamps shown, none yet |

**The answer to `getGlobalSettings`.** It carries the request's id, so the `onDidReceiveGlobalSettings` listener ignores it (that one only reports a page's changes), and it resolves the promise `syncGlobalSettings` returned in [4](#4-the-body-of-plugints) instead. Then:

1. [`globalSettings.read`][global-settings-read] reads the settings against their schema, and builds a `Lamp` for each saved lamp, from its id, model and name, none reached yet. Then it calls its `onChanged` listeners, so every control's `globalSettingsChanged` runs.
2. The handler `plugin.ts` chained to the read runs. If the plugin knows no lamps, as on a first start, it finds the lamps connected with `findLamps`, and saves them with `addLamps`, which sends `setGlobalSettings` (#194).
3. [`reachEveryLamp`][reach-every-lamp] runs the operation `start` on every known lamp. It finds and opens them, asks a Beam LX for its serial number, and reaches each `Lamp`. This is the first time each one is reached, so it **reads** the lamp's power, brightness and temperature, and holds them. It then closes the lamps and announces that the lamps changed.
4. Every action's `onLampsChanged` listener runs, and every control redraws, now with the lamps' real state: the Power key shows on or off, the dial shows the brightest lamp's percentage, the step key its title.

## 7. Ready: what the plugin holds

Once that's done, the plugin waits for events, holding:

- a `RoutingAction` for each of the 8 action types, each with an `ActionInstance` for each of its keys and dials on screen;
- `globalSettings`, with the settings as read, and a `Lamp` for each lamp the plugin knows, each holding its lamp's state (power, lumens, kelvin), its range, whether it's connected, and its cap, once one is learned;
- no open lamp: every operation opens the lamps afresh and closes them before it returns.

## Sources

`@elgato/streamdeck` 3.0.3, in `node_modules/@elgato/streamdeck/dist/plugin/`:

- `index.js`: the `streamDeck` object, and `connect`.
- `connection.js`: the arguments, the WebSocket, registration, and how messages are sent and emitted.
- `actions/decorators.js`: `@action`.
- `actions/service.js`: the action store's listeners, `registerAction`, and the routing by `manifestId`.
- `settings.js`: `getGlobalSettings`, and why its answer doesn't reach `onDidReceiveGlobalSettings`.
- `manifest.js`: the manifest, read from the working directory.
- `logging/index.js`: the SDK's own log files.

[action-instance-appear]: ../../src/actions/action-instance.ts
[action-instance-constructor]: ../../src/actions/action-instance.ts
[brightness.ts]: ../../src/actions/brightness.ts
[elgato-sdk-actions]: ../elgato_sdk/actions.md
[global-settings-read]: ../../src/global-settings.ts
[lamp-picker]: ../../src/actions/lamp-picker.ts
[manifest.json]: ../../com.daczarne.litra.sdPlugin/manifest.json
[measure-create]: ../../src/actions/measure.ts
[reach-every-lamp]: ../../src/litra-manager.ts
[request-journey]: request_journey.md
[rollup.config.mjs]: ../../rollup.config.mjs
[src/global-settings.ts]: ../../src/global-settings.ts
[src/litra-manager.ts]: ../../src/litra-manager.ts
[src/logging.ts]: ../../src/logging.ts
[src/plugin.ts]: ../../src/plugin.ts
[sync-global-settings]: ../../src/global-settings.ts
