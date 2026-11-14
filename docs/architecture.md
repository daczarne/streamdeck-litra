# Architecture

- [From a press to the lamps](#from-a-press-to-the-lamps)
- [The plugin's state is the lamps' state](#the-plugins-state-is-the-lamps-state)
  - [Two trips for every value](#two-trips-for-every-value)
  - [When a lamp is read](#when-a-lamp-is-read)
  - [Whether a lamp is connected](#whether-a-lamp-is-connected)
- [The objects](#the-objects)
  - [Lamp](#lamp)
  - [LampConnection](#lampconnection)
  - [GlobalSettings](#globalsettings)
  - [Keys and dials](#keys-and-dials)
  - [litra-manager](#litra-manager)
- [Why litra, not litra-rs](#why-litra-not-litra-rs)
- [One module talks to the lamps](#one-module-talks-to-the-lamps)
- [The lamps the plugin knows](#the-lamps-the-plugin-knows)
- [Finding the lamps on every operation](#finding-the-lamps-on-every-operation)
- [What a lamp remembers](#what-a-lamp-remembers)
- [Reading what a lamp sends](#reading-what-a-lamp-sends)
- [Keeping the Deck in step](#keeping-the-deck-in-step)
- [The settings pages](#the-settings-pages)
- [Turning a dial](#turning-a-dial)

This document describes how the plugin's parts fit together, and why they're built the way they are. The code's comments say how each part works, and [the contributing guide][contributing] holds the design rules that hold across the plugin, such as managing the lamps as one group by default.

## From a press to the lamps

Stream Deck starts the plugin as a Node process (`src/plugin.ts`). The plugin registers the actions and connects to Stream Deck. A press, a turn or a tap reaches the action it belongs to, in `src/actions/`, which hands it to the object that stands for that key or dial (see [Keys and dials](#keys-and-dials)). The key or dial, which holds its settings as read against their schema (`src/actions/settings.ts`), logs what was asked for, and asks `src/litra-manager.ts` for it. `litra-manager` finds the lamps, picks the ones the key or dial acts on, and tells each one's `Lamp` what to change. The `Lamp` sends its lamp what it takes, through the lamp's connection (`src/lamp-connection.ts`), which writes HID++ reports through the [`litra`][litra] library and `node-hid`, and reads back what the lamp did (see [Two trips for every value](#two-trips-for-every-value)). Once the lamps are changed, `litra-manager` tells every key and dial, which redraws from the `Lamp`s, without reading the lamps.

The settings pages talk to the plugin too: the plugin settings ask it to find the lamps, which it adds to the lamps it knows, to blink one, and to rename or forget one, and which lamps are connected, which `src/actions/lamp-picker.ts` answers for every page (see [The settings pages](#the-settings-pages)).

A brightness change, from a key or a dial, turns every lamp on first, since a brightness only shows on a lit lamp, even one the plugin holds as on, so a lamp turned off another way follows the plugin again (see [The plugin's state is the lamps' state](#the-plugins-state-is-the-lamps-state)). A temperature change leaves the lamp's power as it is, so a lamp can be given the temperature it'll turn on at. A scene sets each group's power itself.

A Beam LX doesn't turn on at the setting it has, but at the one it saved a few hundred ms after it was last switched off ([#100]). Switched on sooner, as a blink does, it comes back at an older setting, and a temperature it was given while off is lost when it turns on. It reports the setting it went back to as soon as it's on, and keeps one written right then ([the probes][probes]). So every switch-on reads the lamp's brightness and temperature once it's on, as the second trip of the switch, and writes back whichever differs from what its `Lamp` holds. A Beam turns on as it was, and gets nothing written.

## The plugin's state is the lamps' state

The plugin is for managing the lamps through the plugin. A lamp's power, brightness and temperature are what its `Lamp` holds: what the lamp reported after the plugin last set them, and what the Deck shows. A change made another way, with the lamp's own buttons, Logitech's software or a CLI, isn't followed: the plugin's state goes stale by the user's choice, and comes back in step at the next change made through the plugin ([#198]). For example, a lamp the plugin set to 10% and brought to 20% with its own button stays at 10% in the plugin. Turning the dial a step up then turns the lamp on, as every brightness change does, which puts back the 10% the plugin holds, and sends it 20%.

The lamps can't tell the plugin of a change, so this is the only state the plugin can hold consistently. Reading every lamp before showing it, as the plugin once did, would follow some changes made another way, but only when something else made the plugin read, and at the cost of a read for every key and dial on every change. Until the plugin settings have a button to read every lamp again ([#214]), the next change made through the plugin is the way back in step after a failure.

### Two trips for every value

The plugin doesn't take a lamp's word that it did what it was sent. Every value it sets takes two trips to the lamp: the first tells it the value, and the second asks it what it set, and the `Lamp` holds what the lamp answered. This matters most for brightness: a lamp on a low-power supply stops below what it was sent, at its cap ([#55]). For example, a key sets a lamp to 100%, the lamp is capped at 58% and answers 58%, so its `Lamp` holds 58%, and the Deck shows 58%. A brightness is read back once the lamp has settled, since a capped lamp first goes towards what it was sent, then back to its cap.

When the second trip fails, such as on a USB error, the lamp having taken the write, the plugin reads again after a few milliseconds. When that read answers, the `Lamp` holds what it read. When it fails again, the `Lamp` holds the value it was asked to set, so the Deck shows what the user asked for rather than an old state or an unknown one. The lamp may then be elsewhere, until a later change made through the plugin.

### When a lamp is read

Besides the second trip of every value it sets, the plugin reads a lamp's power, brightness and temperature, and holds them, in four cases:

- When the plugin starts, once it has read the lamps it knows from the global settings, for every one of them that's connected, so the Deck starts out showing the lamps as they are.
- When Find lamps adds it to the lamps the plugin knows, for the same reason.
- When an operation reaches a lamp the plugin hasn't read since it started, such as one plugged in after.
- When an operation reaches a lamp at another path than the one it was last reached at. A lamp unplugged and plugged in again gets a new path on macOS, and may come back in another state, or on another power supply, so its cap is forgotten too (see [What a lamp remembers](#what-a-lamp-remembers)). Whether Windows gives it a new path isn't checked: if it kept the old one, a lamp plugged in again would keep its `Lamp`'s state and cap until the next change.

The read comes before the operation changes anything, so a step starts from what the lamp is at. Showing the lamps, on a key, a dial or a lamp screen, reads nothing.

### Whether a lamp is connected

A `Lamp` also holds whether the plugin found its lamp the last time it looked. Every operation finds the lamps (see [Finding the lamps on every operation](#finding-the-lamps-on-every-operation)), and marks every lamp the plugin knows as connected or not from what it found, as Find lamps does. An operation that can't find the lamps at all has found none, so it marks every lamp not connected. So a lamp found by any operation stops being marked as not found in the plugin settings, and one unplugged is marked at the next operation. A lamp unplugged since the last operation still counts as connected until then: the plugin doesn't watch for lamps coming and going.

A key or a dial shows the lamps it acts on that are connected. A Power key shows on only when there's one, and every one is on, and a dial or an Up or Down key shows a dash when there's none.

## The objects

Every piece of the plugin's state has one owner, an object that holds it and is the only one to change it. Before, the state had grown one issue at a time, each piece where it was first needed: what the plugin remembered about a lamp was in `litra-manager`'s maps, by serial number, the lamps it knew and their names in the global settings, and each action kept its keys' settings in maps of its own, so every feature had to find its way through all of them ([#198]).

### Lamp

A `Lamp` (`src/lamp.ts`) stands for one lamp the plugin knows, for as long as the global settings keep it, whether the lamp is plugged in or not. It's the plugin's record of the lamp, and what decides what the lamp is sent. It holds:

- Its identity: its id and its model, which the global settings keep, the name given to it, and the path it was last reached at. It holds nothing of the lamp's serial number (see [The lamps the plugin knows](#the-lamps-the-plugin-knows)).
- Its state: its power, brightness and temperature, as described in [The plugin's state is the lamps' state](#the-plugins-state-is-the-lamps-state), and whether it's connected. It holds no state until an operation first reaches the lamp: `isReached` tells, and narrows the `Lamp` to a `ReachedLamp`, whose state is there, so what draws or steps from it needn't check.
- What the plugin remembers about it (see [What a lamp remembers](#what-a-lamp-remembers)).

Its methods change its lamp and its state together: `setPower`, `setTemperature` and `blink` each send the lamp what it takes, read back what it did, and hold that, and so do `sendBrightness` and `readBackBrightness` between them. They're lent the lamp's connection by `litra-manager`, which opens it for the length of an operation (see [LampConnection](#lampconnection)), and the brightness's two trips are two methods, one that sends and one that reads back, so `litra-manager` can send every lamp its brightness before letting them all settle at once. A `Lamp` acts on its own lamp alone: what spans several lamps is `litra-manager`'s.

### LampConnection

A `LampConnection` (`src/lamp-connection.ts`) stands for one lamp plugged in, opened for one operation. `litra-manager` opens one for each lamp an operation finds, and closes it once the operation is done, after which it's good for nothing. A connection holds no state and decides nothing: it sends the lamp what it's told, as HID++ reports through `litra`, and returns what the lamp answers. It names the lamp by what the lamp gives: its model, and the id of its serial number, which a Beam LX gives only when it's asked (see [Finding the lamps on every operation](#finding-the-lamps-on-every-operation)). A connection to a lamp that hasn't given its serial has no id.

A lamp the plugin knows and a lamp plugged in are two things, with lives of their own. A `Lamp` outlives every connection: it's there while its lamp is unplugged, and stays the same `Lamp` each time the lamp is plugged in again, at a new path. A connection lasts one operation, and can be to a lamp the plugin doesn't know, such as one Find lamps is about to add, or can't tell apart yet, such as a Beam LX before it gives its serial. So for each operation, `litra-manager` matches the connections to the `Lamp`s, by id, and lends each `Lamp` its lamp's connection.

The `Lamp` makes the decisions, and the connection carries them out. `setPower`, for example, decides what to send, such as the setting a Beam LX loses when it's turned on, sends it through the connection, reads back through it, and holds what the lamp answered. A `Lamp` acts on a connection as a `LampHandle`, the reads and writes it needs, which a connection implements. So the tests of a `Lamp` give it a fake handle, and check what it decides without a lamp, while the tests of a connection run it on emulated lamps, and check what it sends and reads.

### GlobalSettings

`GlobalSettings` (`src/global-settings.ts`) holds the plugin's global settings, with a single instance. It reads them once the plugin is connected, and again whenever a page saves them, and turns the saved JSON into objects: `lamps`, the lamps the plugin knows, as `Lamp`s, by id, and the other settings, each read against its schema in `src/actions/settings.ts`. It's the only writer of the lamps the plugin knows, and turns them back into JSON to save them (see [The lamps the plugin knows](#the-lamps-the-plugin-knows)). The `Lamp`s are its only copy of the lamps: the JSON is kept only so a save can write the settings whole, and a save calls the listeners without reading back what it wrote, since the `Lamp`s were changed first.

A `Lamp` outlives a read of the global settings that still holds its lamp: a page's save, which only changes its name, if anything, keeps its state. A lamp forgotten drops its `Lamp`, and one found again gets a new one, read when an operation next reaches it.

### Keys and dials

Stream Deck owns the keys and dials: it registers one action per type, and only tells the plugin about the keys and dials on screen, through the events the SDK sends (see [the SDK notes on actions][actions]). So each action in `src/actions/` is a `RoutingAction` (`src/actions/action-instance.ts`), a `SingletonAction` as the SDK registers them, which hands every event to an object of its own for the key or dial it's about, an `ActionInstance`, by the key's or dial's id: a Power key, a Brightness key or dial, a Temperature key or dial, a Scene key, or an Up or Down key. The object is created when its key or dial appears, and dropped when it disappears. The SDK sends no event of a key or dial that isn't on screen, so none can come before its object or after it.

Each one holds its key or dial, as the SDK hands it, and its settings as a `config`, read against their schema from what Stream Deck last sent, so no handler reads them on its own. Stream Deck still owns the settings: the `config` is a copy, read again whenever an event carries settings that changed, so a setting that isn't valid is warned about once, not at every press. An object also holds what only matters while it's on screen, such as a press it still owes an alert for, a dial's queues of ticks and the lamp its lamp screen shows. The action also hands each of its objects the news that the lamps changed, or the global settings, which it subscribes to once (see [Keeping the Deck in step](#keeping-the-deck-in-step)). The lamps it acts on come from its `config` and the global settings: every lamp the plugin knows for a dial's main screen, the lamp on screen for a lamp screen, and for a key the lamps its page picked, or every lamp but the ones it left out, for a key that takes in lamps added later ([#147]).

### litra-manager

`litra-manager` (`src/litra-manager.ts`) is the orchestrator. It takes what a key or a dial asks for, opens a connection to each lamp plugged in, matches each one to its `Lamp`, and tells the `Lamp` what to change, lending it the connection for the operation. What spans several lamps is its job:

- Stepping lamps together, from the brightest one's brightness or the first one's temperature, or each from its own (see [Turning a dial](#turning-a-dial)).
- One operation at a time across every lamp, in the order they were asked for. An operation holds its lamps open until it's done, which for a brightness change is once it has read them back, and a lamp already open can't be opened again, so an operation that overlapped another would find no lamp, and take every one for unplugged. A brightness change or a scene also waits for the reversal of a capped lamp it sends a brightness to, so it can't be undone (see [What a lamp remembers](#what-a-lamp-remembers)), and a power or temperature change asked for meanwhile waits behind it, rather than running first and being undone by it.
- A scene's groups, set in one pass, each lamp taking the part of the first group that selects it ([#174]).
- Telling every key and dial once the lamps changed (see [Keeping the Deck in step](#keeping-the-deck-in-step)).

It logs what was found and what was left out, while each `Lamp` logs what its lamp did (see [the logging document][logging]).

What the Deck shows isn't its job. `src/lamps-shown.ts` works it out from the `Lamp`s alone: which lamps a selection takes in that the last operation found, whether they're all on, and their brightness and temperature. A lamp screen is handed each of those lamps as its `Lamp`, narrowed to a `ReachedLamp`: one an operation has reached, whose state the plugin holds (`Lamp.isReached`). It draws the lamp from its `Lamp` alone, so the plugin keeps no other record of a lamp. The keys and dials read `src/lamps-shown.ts` through `src/actions/shown.ts`, which first waits for the operations queued, if any (`lampsSettled`), so nothing shows a lamp partway through a change. A tap on a dial's strip is the only one that finds the lamps first, through `litra-manager`, so it never shows a lamp unplugged since the last operation. A redraw shows what the `Lamp`s hold, as every key does.

## Why litra, not litra-rs

Two libraries speak the lamps' protocol, both by Tim Rogers: `litra`, in TypeScript on `node-hid`, and [`litra-rs`][litra-rs], in Rust, with a CLI and an MCP server. `litra-rs` is the only one that drives the Beam LX's back light. But every way of using it from a Node plugin adds something to own:

- Running its CLI for every operation starts a process each time.
- Keeping it running as an MCP server over standard input and output means managing a second, long-running process.
- A plugin written in Rust, or bindings to the crate, means owning a native build for every platform.

`litra` runs inside the plugin's own process, as a library, with nothing to start or build. It gets few releases, its last, 4.5.1, in December 2025, but it's still looked after: its dependencies are kept up to date, and its author's other projects for the lamps build on it. The lamps' protocol doesn't change much either, and the plugin works around the gaps `litra` has (see [Reading what a lamp sends](#reading-what-a-lamp-sends)). The cost is `node-hid`'s native binary, which the build keeps out of the bundle and copies next to it (`copyNativeRuntime` in `rollup.config.mjs`).

## One module talks to the lamps

`src/lamp-connection.ts` is the only module that imports `litra`, and nothing outside it sees `litra`'s types. The rest of the plugin reaches a lamp plugged in through a `LampConnection` (see [LampConnection](#lampconnection)), whose methods are what a `Lamp` needs from its lamp, such as switching it on or reading its brightness, rather than `litra`'s own functions. So whatever lies under it can change without touching the rest of the plugin: a fork or a copy of `litra`, or more HID++ calls of the plugin's own, besides the ones it already makes to read a brightness and a Beam LX's serial number, such as the ones the Beam LX's back light needs ([#19]).

## The lamps the plugin knows

Which lamps the plugin acts on is decided in one place: the lamps it knows, kept in its global settings as `lamps`, by id, each with its model and the name given to it ([#194]), and held by `GlobalSettings` as `Lamp`s. Every key and dial leaves alone a lamp that's connected but not among them. A lamp joins them when the plugin finds it: on its own when the plugin starts knowing none, so a new user starts with every lamp connected, and otherwise only when Find lamps, in the plugin settings, asks it to. Plugging a lamp in changes nothing until then, so which lamps the plugin controls is always the user's decision.

The plugin is the only one that writes `lamps`: a page shows them, and asks the plugin to find lamps, and to rename or forget one. Each setting has one owner, which writes it, while the others only read it, so no two writers can undo each other's change. The other global settings are the plugin settings page's to write, and each key's and dial's settings its own page's. Stream Deck takes the global settings whole on every write, so `GlobalSettings` writes them from the latest ones it was sent or saved, which keeps what a page saved.

A lamp is known by its id alone: the first 16 hex characters of its serial number's SHA-256. The serial is the lamp's, and the plugin reads it from the lamp on every operation, from its USB descriptor or, for a Beam LX, over HID++ (see [Finding the lamps on every operation](#finding-the-lamps-on-every-operation)), then finds the lamp among the ones it knows by the id it hashes to. The serial is used for nothing else, and kept nowhere: not in a `Lamp`, nor in the global settings, a key's settings, the pages or the logs. A key's settings, which travel with an exported profile, name a lamp by its id too ([#20]). What the Deck, the pages and the logs show of a lamp is the last 4 characters of its id, such as "Beam - c870", enough to tell a few lamps apart. It matches nothing printed on the lamp, so the plugin settings' Identify, which blinks the lamp, tells which lamp a row is.

Every operation leaves out the connected lamps that aren't among them, so a selection of every lamp, or of every lamp but some, means every lamp known. Only finding the lamps for Find lamps sees the others. Until the global settings are read, the plugin knows no lamps, and acts on none.

## Finding the lamps on every operation

`litra-manager` keeps no list of the lamps connected. Every operation finds them again, opens each one the plugin knows that it acts on, lends its connection to its `Lamp` for the operation, and closes them, so a lamp that was unplugged is simply not found, and one plugged in again is, without any code for either. Finding the lamps is a call inside the plugin's process, not a new process, so doing it on every operation costs little. It also tells which lamps are connected (see [Whether a lamp is connected](#whether-a-lamp-is-connected)).

An operation can be given the lamps to act on, by their ids, which a key's settings can hold, and an exported profile carry, without revealing the serial ([#20]). A lamp screen gives its lamp the same way. Or it can be given the lamps to leave out, which is how a key takes in lamps added later: every lamp found but those ([#147]). A scene is given one selection for each of its groups, and each lamp found takes the part of the first group that selects it ([#174]). It then closes the others unused, and logs a selected lamp it doesn't find, or that every lamp found is left out.

`litra` finds the lamps in an order that changes from one call to the next, so every operation goes through them in the order of their ids, as the settings pages list the lamps. That order is `Lamp.byId`, which the lamp screens step through the lamps in too, one tap after the other, so a tap never shows the lamps in another order than the plugin settings. The first lamp, whose temperature the dials show and step from, is then always the same one: the one a dial's first tap shows, and the first in the plugin settings. A tap finds the lamps too, so it never shows a lamp unplugged since the last operation.

A Beam LX's USB descriptor declares a serial number but gives none, so `litra` finds it with an empty one. The plugin then asks the lamp for the serial number it keeps itself, through HID++'s Device Information feature, whose index it gets from the Root feature rather than hard-coding it ([#170]). A Beam gives the same serial both ways, so only a lamp found without one is asked. It costs about 4 ms on every operation, so the serial isn't remembered: remembering it by the lamp's path would need a path that belongs to the lamp, which on Windows isn't checked. A lamp whose serial can't be read is logged and left out, since it couldn't be told from another. It still counts as a failed lamp for an operation on every lamp, or on every lamp but some, which it could be one of, so a key shows an alert, as it does for a Beam that fails ([#100]). An operation on given lamps, such as a lamp screen's, can't tell whether it was one of them, and leaves it out unnoticed: it fails on its own when none of its lamps is found.

Closing the handles matters because the plugin runs for as long as Stream Deck does: a handle left open would leak for the whole session. `litra`'s type for a lamp's handle leaves out `close`, which `node-hid`'s handle has, so a `LampConnection` reaches it through a type of its own.

A lamp that fails is logged, and the operation goes on with the others. Finding no lamp counts as a failure too, so a press with nothing plugged in shows an alert, rather than doing nothing, and so does a turn on a lamp screen whose lamp was unplugged. So does an operation left with no lamp to act on: one given no lamp, one whose lamps aren't connected, one that leaves out every lamp connected, one that finds none of the lamps the plugin knows, and one for which finding the lamps fails. Each is logged with its reason (see [the logging document][logging]). A lamp the plugin knows that an operation takes in, but doesn't find, counts as a failed lamp too, however the key selects it, by its id, as one of every lamp, or in any group of a scene: the operation acts on the lamps it found, and the key shows its alert, rather than failing silently for the lamp it couldn't reach. A lamp the plugin no longer knows, such as one forgotten that a key still lists, doesn't count. Neither does a lamp a dial's main screen doesn't find: it has no lamps of its own to pick, so it acts on every lamp connected (`"connected"`), and so does reaching every lamp, as the plugin starts and on a tap on a dial's strip.

## What a lamp remembers

Besides its state, a `Lamp` remembers three things, all forgotten when the plugin restarts: two because of a lamp on a low-power supply ([#55]), and one for lamps kept apart ([#145]):

- The brightness its lamp can reach, its cap, learned each time the lamp falls short of what it was sent. A cap moves by a few lumens over time ([#164], [probes]): one that drops is learned again on the next change that reaches it, while one that rises stays as learned, a lumen or two below what the lamp could reach, since the lamp is never sent more. A lamp only moves to another power supply by being plugged in again, which on macOS gives it a new path, so a cap is forgotten once its lamp has another one (see [When a lamp is read](#when-a-lamp-is-read)).
- When a capped lamp may still go back to its cap after being asked for more, which can undo a lower brightness written in between: `litra-manager` has the next change that sends the lamp a brightness wait until then. A change to other lamps doesn't wait, since the lamp going back to its cap undoes nothing it sends.
- The brightness and the temperature it was last asked for, which can be past an end of its range or its cap, for lamps kept apart ([#145]). Its next step from its own value goes on from there, so a lamp held at its cap or at 0% while the others went on comes back with them, and they keep the difference they had. A tick goes on stepping what every lamp is asked for until one of them moves, so a turn planned before a lamp's cap is learned, which can take every lamp past its end, still moves one of them on the first tick back. A turn stops at the first tick that moves no lamp, so turning on once every lamp is at its end piles nothing up. Any other change to a lamp's brightness or temperature asks for the value it sets, which replaces it.

## Reading what a lamp sends

A lamp answers a query with a reply, and a write with an ACK. A lamp on a low-power supply also sends a change notice when it lowers its brightness to its cap. `litra` takes the first report that arrives as its reply, and reads a brightness from one byte, which holds 255 lm at most, where a Beam goes to 400. So a `LampConnection` reads the brightness itself (`getBrightnessInLumenSafe` in `src/lamp-connection.ts`), from two bytes, skipping up to 10 reports that aren't the reply, such as change notices and ACKs, after which the read fails, so a lamp that keeps sending something else can't hold an operation. Asking a Beam LX for its serial number skips them the same way, and waits at most 500 ms for each report, so a lamp that doesn't answer is left out rather than holding the operation.

After every write, it reads the write's ACK (`drainAck`), so that a read on the same handle afterwards gets its reply, such as the second trip of every value. The lamps were measured to ACK every write within a few ms, and an ACK is gone once its handle closes ([#96]), so the drain costs little and only guards a read that follows a write on the same handle. What was measured, and how, is in [the probes][probes].

## Keeping the Deck in step

After every operation that writes to the lamps, failed ones included, `litra-manager` calls the listeners registered with `onLampsChanged` ([#57]). So it does after one that reaches every lamp, as the plugin starts, when Find lamps adds lamps, and on a tap on a dial's strip, since it can read a lamp, or find one unplugged or plugged in again, and after a blink that fails, which may find its lamp unplugged, or leave it switched the other way. Every action listens, once, and hands the news to each of its keys and dials, which redraws if it shows the lamps: the Power keys, the Up and Down keys, and the Brightness and Temperature dials, which redraw their main screen, or the lamp their lamp screen shows. So whichever key or dial changed the lamps, everything on the Deck follows, from the `Lamp`s, which no redraw reads from the lamps. A lamp screen whose lamp is no longer connected goes back to its dial's main screen.

The global settings are followed the same way: each time `GlobalSettings` reads them, once the plugin is connected and whenever a page changes them, and each time it saves the lamps, it calls the listeners registered with its `onChanged`. The dials redraw the lamp their lamp screen shows, so a change to what its cells show ([#177]), or to their text styles ([#153]), redraws every lamp screen on the Deck at once, and the keys redraw too, since the global settings choose their lamps ([#147]).

An action shows an alert on the key or dial that failed. On a key, the redraw that follows leaves the alert visible when it sets the title, and hides it when it sets the state: the Power key shows its alert after its state for that reason ([#132], see [the SDK notes on keys][keys]).

## The settings pages

The settings pages run in Stream Deck's browser, apart from the plugin, and share none of its objects. What passes between them is the same as it was before the objects ([#198]):

- The global settings, as Stream Deck keeps them: JSON, which the pages read and save, and which `GlobalSettings` turns into objects and back. So the lamps the plugin knows, with their names, reach a page as the global settings' `lamps`, and a key's lamp picker lists them without asking the plugin.
- Each key's and dial's settings, which its own page saves, and its object reads as its `config`.
- The messages a page sends the plugin, through Stream Deck, which `src/actions/lamp-picker.ts` answers for every page: find the lamps, blink one, rename one and forget one. An answer reaches only the page shown (see [the SDK notes on the settings pages][property-inspector]).

The only thing added is which lamps are connected, which the global settings don't keep, since it's the plugin's to know and changes while it runs. The plugin settings ask for it as they open, with a `connected` message, and the plugin sends the same message to the page shown whenever an operation changes it (`onConnectedChanged`), so the table marks a lamp "Not found" from what the plugin last found, not only from the page's last Find lamps.

## Turning a dial

A dial sends a tick at a time, and a quick turn sends many. The dial gathers ticks for a moment (`createDialDebouncer`, in `src/actions/debouncer.ts`), so a turn moves the lamps once, by the step the dial has when they're applied. A dial gathers its ticks apart for each lamp it turns, its main screen counting as one, so ticks turned on a lamp screen reach that lamp even when the strip is tapped before they're applied ([#20]). The Up and Down keys gather their presses the same way, each key with its own queue. A step stops on the multiples of the step counted from the bottom of the range ([#14], [#16]), so a dial and a key go through the same values up and down.

By default, `litra-manager` steps the value the dial shows, the brightest lamp's brightness or the first lamp's temperature, in the order the plugin settings list the lamps, as their `Lamp`s hold them, and sends every lamp there. When the global settings keep the lamps apart, it steps each lamp from the value it was last asked for, along the same multiples, as a turn on that lamp's screen would, so a tick on the main screen is a tick on every lamp's screen (see [What a lamp remembers](#what-a-lamp-remembers)) ([#145]). The settings are read once a turn's ticks are applied, so ticks gathered before a change follow the new setting.

[#14]: https://github.com/daczarne/streamdeck-litra/issues/14
[#16]: https://github.com/daczarne/streamdeck-litra/issues/16
[#19]: https://github.com/daczarne/streamdeck-litra/issues/19
[#20]: https://github.com/daczarne/streamdeck-litra/issues/20
[#55]: https://github.com/daczarne/streamdeck-litra/issues/55
[#57]: https://github.com/daczarne/streamdeck-litra/issues/57
[#96]: https://github.com/daczarne/streamdeck-litra/issues/96
[#100]: https://github.com/daczarne/streamdeck-litra/issues/100
[#132]: https://github.com/daczarne/streamdeck-litra/issues/132
[#145]: https://github.com/daczarne/streamdeck-litra/issues/145
[#147]: https://github.com/daczarne/streamdeck-litra/issues/147
[#153]: https://github.com/daczarne/streamdeck-litra/issues/153
[#164]: https://github.com/daczarne/streamdeck-litra/issues/164
[#170]: https://github.com/daczarne/streamdeck-litra/issues/170
[#174]: https://github.com/daczarne/streamdeck-litra/issues/174
[#177]: https://github.com/daczarne/streamdeck-litra/issues/177
[#194]: https://github.com/daczarne/streamdeck-litra/issues/194
[#198]: https://github.com/daczarne/streamdeck-litra/issues/198
[#214]: https://github.com/daczarne/streamdeck-litra/issues/214
[actions]: elgato_sdk/actions.md
[contributing]: contributing.md
[keys]: elgato_sdk/keys.md
[litra]: https://github.com/timrogers/litra
[litra-rs]: https://github.com/timrogers/litra-rs
[logging]: logging.md
[probes]: ../scripts/probes/README.md
[property-inspector]: elgato_sdk/property_inspector.md
