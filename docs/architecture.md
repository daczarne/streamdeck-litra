# Architecture

- [From a press to the lamps](#from-a-press-to-the-lamps)
- [Why litra, not litra-rs](#why-litra-not-litra-rs)
- [One module talks to the lamps](#one-module-talks-to-the-lamps)
- [The lamps the plugin knows](#the-lamps-the-plugin-knows)
- [Every lamp, found afresh every time](#every-lamp-found-afresh-every-time)
  - [What it does remember](#what-it-does-remember)
- [Reading what a lamp sends](#reading-what-a-lamp-sends)
- [Keeping the Deck in step](#keeping-the-deck-in-step)
- [Turning a dial](#turning-a-dial)

This document describes how the plugin's parts fit together, and why they're built the way they are. The code's comments say how each part works, and [the contributing guide][contributing] holds the design rules that hold across the plugin, such as managing the lamps as one group by default.

## From a press to the lamps

Stream Deck starts the plugin as a Node process (`src/plugin.ts`). The plugin registers the actions and connects to Stream Deck. A press, a turn or a tap reaches the action it belongs to, in `src/actions/`. The action reads its settings against their schema (`src/actions/settings.ts`), logs what was asked for, and calls `src/litra-manager.ts`. That module finds the lamps through the [`litra`][litra] library, which writes HID++ reports to each lamp through `node-hid`, and reads back their replies. Once the lamps are changed, `litra-manager` tells every action, which redraws its keys and dials from what the lamps report. The settings pages talk to the plugin too: the plugin settings ask it for the connected lamps, which it adds to the lamps it knows, for a blink of one, and to rename or forget one, which `src/actions/lamp-picker.ts` answers for every page. A key's lamp picker asks for nothing: it lists the lamps the plugin knows, from the global settings. The dials' pages save the blink of the lamp screens to the plugin's global settings, which every dial shares, rather than to the dial's own, and `src/actions/global-settings.ts` reads them once the plugin is connected and follows them as a page changes them ([#144]).

A brightness change, from a key or a dial, turns a lamp that's off on first, since a brightness only shows on a lit lamp. A temperature change leaves the lamp's power as it is, so a lamp can be given the temperature it'll turn on at. A scene sets each group's power itself.

## Why litra, not litra-rs

Two libraries speak the lamps' protocol, both by Tim Rogers: `litra`, in TypeScript on `node-hid`, and [`litra-rs`][litra-rs], in Rust, with a CLI and an MCP server. `litra-rs` is the only one that drives the Beam LX's back light. But every way of using it from a Node plugin adds something to own:

- Running its CLI for every operation starts a process each time.
- Keeping it running as an MCP server over standard input and output means managing a second, long-running process.
- A plugin written in Rust, or bindings to the crate, means owning a native build for every platform.

`litra` runs inside the plugin's own process, as a library, with nothing to start or build. It gets few releases, its last, 4.5.1, in December 2025, but it's still looked after: its dependencies are kept up to date, and its author's other projects for the lamps build on it. The lamps' protocol doesn't change much either, and the plugin works around the gaps `litra` has (see [Reading what a lamp sends](#reading-what-a-lamp-sends)). The cost is `node-hid`'s native binary, which the build keeps out of the bundle and copies next to it (`copyNativeRuntime` in `rollup.config.mjs`).

## One module talks to the lamps

`src/litra-manager.ts` is the only module that imports `litra`. The actions import from it, and it offers what the actions need, such as turning every lamp on or stepping their brightness, rather than `litra`'s own functions. So whatever lies under it can change without touching the actions: a fork or a copy of `litra`, or HID++ calls of the plugin's own, which the Beam LX's back light needs ([#19]). It also makes it the one place that logs what each lamp did (see [the logging document][logging]).

## The lamps the plugin knows

Which lamps the plugin acts on is decided in one place: the lamps it knows, kept in its global settings as `lamps`, by id, each with its model, the end of its serial number, and the name given to it ([#194]). Every key and dial leaves alone a lamp that's connected but not among them. A lamp joins them when the plugin finds it: on its own when the plugin starts knowing none, so a new user starts with every lamp connected, and otherwise only when Find lamps, in the plugin settings, asks it to. Plugging a lamp in changes nothing until then, so which lamps the plugin controls is always the user's decision. Before, every page built its own list, from the lamps it found and the ones its key had saved, so the pages could disagree about which lamps there were.

The plugin is the only one that writes `lamps`: a page shows them, and asks the plugin to find lamps, and to rename or forget one. Each setting has one owner, which writes it, while the others only read it, so no two writers can undo each other's change. The other global settings are the plugin settings page's to write, and each key's and dial's settings its own page's. Stream Deck takes the global settings whole on every write, so `src/actions/global-settings.ts` writes them from the latest ones it was sent, which keeps what a page saved.

`global-settings` tells `litra-manager` the ids of the lamps known each time it reads them (`setKnownLamps`), and every operation leaves out the connected lamps that aren't among them. A selection of every lamp, or of every lamp but some, therefore means every lamp known. Only finding the lamps sees the others. Until the global settings are read, the plugin knows no lamps, and acts on none.

## Every lamp, found afresh every time

`litra-manager` keeps no list of the lamps connected. Every operation finds them again, opens each one the plugin knows, applies the operation to every one, and closes them, so a lamp that was unplugged is simply not found, and one plugged in again is, without any code for either. An operation can also be given the lamps to act on, by their ids: the start of each serial number's SHA-256, which a key's settings can hold, and an exported profile carry, without revealing the serial ([#20]). A lamp screen gives its lamp the same way. Or it can be given the lamps to leave out, which is how a key takes in lamps added later: every lamp found but those ([#147]). A scene is given one selection for each of its groups, and each lamp found takes the part of the first group that selects it ([#174]). It then closes the others unused, and logs a selected lamp it doesn't find, or that every lamp found is left out. Finding the lamps is a call inside the plugin's process, not a new process, so doing it on every operation costs little. `litra` finds them in an order that changes from one call to the next, so every operation goes through them in the order of their serial numbers: by their last 4 characters, as the settings pages list the lamps, since that's all the global settings keep of them, then by the whole serial number when two lamps share them. The first lamp, whose temperature the dials show and step from, is then always the same one: the one a dial's first tap shows, and the first in the plugin settings.

A Beam LX's USB descriptor declares a serial number but gives none, so `litra` finds it with an empty one. The plugin then asks the lamp for the serial number it keeps itself, through HID++'s Device Information feature, whose index it gets from the Root feature rather than hard-coding it ([#170]). A Beam gives the same serial both ways, so only a lamp found without one is asked. It costs about 4 ms on every operation, so the serial isn't remembered: remembering it by the lamp's path would need a path that belongs to the lamp, which on Windows isn't checked. A lamp whose serial can't be read is logged and left out, since it couldn't be told from another.

Closing the handles matters because the plugin runs for as long as Stream Deck does: a handle left open would leak for the whole session. `litra`'s type for a lamp's handle leaves out `close`, which `node-hid`'s handle has, so the module reaches it through a type of its own.

A lamp that fails is logged, and the operation goes on with the others. Finding no lamp counts as a failure too, so a press with nothing plugged in shows an alert, rather than doing nothing, and so does a turn on a lamp screen whose lamp was unplugged.

### What it does remember

Besides the lamps the plugin knows, four things outlive an operation. The first three are there because a lamp on a low-power supply needs them ([#55]):

- The brightness each lamp can reach, its cap, learned each time it falls short of what it was sent, and kept by its serial number with the path it was plugged in at. A cap moves by a few lumens over time ([#164], [probes]): one that drops is learned again on the next change that reaches it, while one that rises stays as learned, a lumen or two below what the lamp could reach, since the lamp is never sent more. A lamp only moves to another power supply by being plugged in again, which on macOS gives it a new path, so a cap is forgotten once its lamp has another one. Whether Windows gives it a new path too isn't checked: if it kept the old one, a cap would outlive a move until the plugin restarts.
- When a capped lamp may still go back to its cap after being asked for more, which can undo a lower brightness written in between: the next brightness change waits until then.
- The queue of brightness changes, so that one starts only once the one before has been read back.
- Where each lamp kept apart would be if an end of its range or its cap hadn't stopped it, with the brightness or temperature it was left at ([#145]). Its next step goes on from there, so a lamp held at its cap or at 0% while the others went on comes back with them, and they keep the difference they had. A step counts only while a lamp still moves, so turning on once every lamp is at its end piles nothing up. A turn planned before a lamp's cap is learned can still take it past its end, so before each turn, lamps that are all past their ends come back together by the steps they all have past them, and the next step the other way moves one of them. A position is forgotten once its lamp is set any other way, and ignored once the lamp is no longer where it was left, such as after a change with its own buttons. A restart forgets them all, as it does the caps.

## Reading what a lamp sends

A lamp answers a query with a reply, and a write with an ACK. A lamp on a low-power supply also sends a change notice when it lowers its brightness to its cap. `litra` takes the first report that arrives as its reply, and reads a brightness from one byte, which holds 255 lm at most, where a Beam goes to 400. So the plugin reads the brightness itself (`getBrightnessInLumenSafe`), from two bytes, skipping up to 10 reports that aren't the reply, such as change notices and ACKs, after which the read fails, so a lamp that keeps sending something else can't hold an operation.

After every write, it reads the write's ACK (`drainAck`), so that a read on the same handle afterwards would get its reply. The lamps were measured to ACK every write within a few ms, and an ACK is gone once its handle closes ([#96]), so the drain costs little and only guards a read that follows a write on the same handle. What was measured, and how, is in [the probes][probes].

## Keeping the Deck in step

After every operation that writes to the lamps, failed ones included, `litra-manager` calls the listeners registered with `onLampsChanged` ([#57]). Every action that shows the lamps listens: the Power keys, the step keys, the Brightness and Temperature dials, and the lamp screens. So whichever key or dial changed the lamps, everything on the Deck follows, from one read per action, or per set of lamps for the keys, which each show their own. A change made with a lamp's own buttons isn't noticed, and shows at the next change made through the plugin.

The global settings are followed the same way: each time `src/actions/global-settings.ts` reads them, once the plugin is connected and whenever a page changes them, it calls the listeners registered with `onGlobalSettingsChanged`. The lamp screens listen, so a change to what their cells show ([#177]), or to their text styles ([#153]), redraws every lamp screen on the Deck at once.

An action shows an alert on the key or dial that failed. On a key, the redraw that follows leaves the alert visible when it sets the title, and hides it when it sets the state: the Power key shows its alert after its state for that reason ([#132], see [the SDK notes on keys][keys]).

## Turning a dial

A dial sends a tick at a time, and a quick turn sends many. The dial gathers ticks for a moment (`createDialDebouncer`), so a turn moves the lamps once, by the step the dial has when they're applied. A dial gathers its ticks apart for each lamp it turns, its main screen counting as one, so ticks turned on a lamp screen reach that lamp even when the strip is tapped before they're applied ([#20]). The step keys gather their presses the same way. A step stops on the multiples of the step counted from the bottom of the range ([#14], [#16]), so a dial and a key go through the same values up and down. By default, `litra-manager` steps the value the dial shows, the brightest lamp's brightness or the first lamp's temperature, in the order the plugin settings list the lamps, and sends every lamp there. When the global settings keep the lamps apart, it steps each lamp from its own value along the same multiples, as a turn on that lamp's screen would, so a tick on the main screen is a tick on every lamp's screen, and remembers where a lamp stopped by an end would be (see [What it does remember](#what-it-does-remember)) ([#145]). The settings are read once a turn's ticks are applied, so ticks gathered before a change follow the new setting.

[#14]: https://github.com/daczarne/streamdeck-litra/issues/14
[#16]: https://github.com/daczarne/streamdeck-litra/issues/16
[#19]: https://github.com/daczarne/streamdeck-litra/issues/19
[#20]: https://github.com/daczarne/streamdeck-litra/issues/20
[#55]: https://github.com/daczarne/streamdeck-litra/issues/55
[#57]: https://github.com/daczarne/streamdeck-litra/issues/57
[#96]: https://github.com/daczarne/streamdeck-litra/issues/96
[#132]: https://github.com/daczarne/streamdeck-litra/issues/132
[#144]: https://github.com/daczarne/streamdeck-litra/issues/144
[#145]: https://github.com/daczarne/streamdeck-litra/issues/145
[#147]: https://github.com/daczarne/streamdeck-litra/issues/147
[#153]: https://github.com/daczarne/streamdeck-litra/issues/153
[#164]: https://github.com/daczarne/streamdeck-litra/issues/164
[#170]: https://github.com/daczarne/streamdeck-litra/issues/170
[#174]: https://github.com/daczarne/streamdeck-litra/issues/174
[#177]: https://github.com/daczarne/streamdeck-litra/issues/177
[#194]: https://github.com/daczarne/streamdeck-litra/issues/194
[contributing]: contributing.md
[keys]: elgato_sdk/keys.md
[litra]: https://github.com/timrogers/litra
[litra-rs]: https://github.com/timrogers/litra-rs
[logging]: logging.md
[probes]: ../scripts/probes/README.md
