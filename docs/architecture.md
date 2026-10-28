# Architecture

- [From a press to the lamps](#from-a-press-to-the-lamps)
- [Why litra, not litra-rs](#why-litra-not-litra-rs)
- [One module talks to the lamps](#one-module-talks-to-the-lamps)
- [Every lamp, found afresh every time](#every-lamp-found-afresh-every-time)
  - [What it does remember](#what-it-does-remember)
- [Reading what a lamp sends](#reading-what-a-lamp-sends)
- [Keeping the Deck in step](#keeping-the-deck-in-step)
- [Turning a dial](#turning-a-dial)

This document describes how the plugin's parts fit together, and why they're built the way they are. The code's comments say how each part works, and [the contributing guide][contributing] holds the design rules that hold across the plugin, such as managing the lamps as one group by default.

## From a press to the lamps

Stream Deck starts the plugin as a Node process (`src/plugin.ts`). The plugin registers the actions and connects to Stream Deck. A press, a turn or a tap reaches the action it belongs to, in `src/actions/`. The action reads its settings against their schema (`src/actions/settings.ts`), logs what was asked for, and calls `src/litra-manager.ts`. That module finds the lamps through the [`litra`][litra] library, which writes HID++ reports to each lamp through `node-hid`, and reads back their replies. Once the lamps are changed, `litra-manager` tells every action, which redraws its keys and dials from what the lamps report. A key's settings page talks to the plugin too: its lamp picker asks for the connected lamps, and for a blink of one, which `src/actions/lamp-picker.ts` answers for every page. The dials' pages save the blink of the lamp screens to the plugin's global settings, which every dial shares, rather than to the dial's own, and `src/actions/global-settings.ts` reads them once the plugin is connected and follows them as a page changes them ([#144]).

## Why litra, not litra-rs

Two libraries speak the lamps' protocol, both by Tim Rogers: `litra`, in TypeScript on `node-hid`, and [`litra-rs`][litra-rs], in Rust, with a CLI and an MCP server. `litra-rs` is the only one that drives the Beam LX's back light. But every way of using it from a Node plugin adds something to own:

- Running its CLI for every operation starts a process each time.
- Keeping it running as an MCP server over standard input and output means managing a second, long-running process.
- A plugin written in Rust, or bindings to the crate, means owning a native build for every platform.

`litra` runs inside the plugin's own process, as a library, with nothing to start or build. It gets few releases, its last, 4.5.1, in December 2025, but it's still looked after: its dependencies are kept up to date, and its author's other projects for the lamps build on it. The lamps' protocol doesn't change much either, and the plugin works around the gaps `litra` has (see [Reading what a lamp sends](#reading-what-a-lamp-sends)). The cost is `node-hid`'s native binary, which the build keeps out of the bundle and copies next to it (`copyNativeRuntime` in `rollup.config.mjs`).

## One module talks to the lamps

`src/litra-manager.ts` is the only module that imports `litra`. The actions import from it, and it offers what the actions need, such as turning every lamp on or stepping their brightness, rather than `litra`'s own functions. So whatever lies under it can change without touching the actions: a fork or a copy of `litra`, or HID++ calls of the plugin's own, which the Beam LX's back light needs ([#19]). It also makes it the one place that logs what each lamp did (see [the logging document][logging]).

## Every lamp, found afresh every time

`litra-manager` keeps no list of lamps. Every operation finds the connected lamps again, opens each, applies the operation to every one, and closes them, so a lamp that was unplugged is simply not found, and one plugged in again is, without any code for either. An operation can also be given the lamps to act on, by their ids: the start of each serial number's SHA-256, which a key's settings can hold, and an exported profile carry, without revealing the serial ([#20]). A lamp screen gives its lamp the same way. It then closes the others unused, and logs a selected lamp it doesn't find. Finding the lamps is a call inside the plugin's process, not a new process, so doing it on every operation costs little.

Closing the handles matters because the plugin runs for as long as Stream Deck does: a handle left open would leak for the whole session. `litra`'s type for a lamp's handle leaves out `close`, which `node-hid`'s handle has, so the module reaches it through a type of its own.

A lamp that fails is logged, and the operation goes on with the others. Finding no lamp counts as a failure too, so a press with nothing plugged in shows an alert, rather than doing nothing, and so does a turn on a lamp screen whose lamp was unplugged.

### What it does remember

Four things outlive an operation. The first three are there because a lamp on a low-power supply needs them ([#55]):

- The brightness each lamp can reach, its cap, learned the first time it falls short of what it was sent, and kept by its serial number with the path it was plugged in at. A lamp only moves to another power supply by being plugged in again, which on macOS gives it a new path, so a cap is forgotten once its lamp has another one. Whether Windows gives it a new path too isn't checked: if it kept the old one, a cap would outlive a move until the plugin restarts.
- When a capped lamp may still go back to its cap after being asked for more, which can undo a lower brightness written in between: the next brightness change waits until then.
- The queue of brightness changes, so that one starts only once the one before has been read back.
- Where each lamp kept apart would be if an end of its range or its cap hadn't stopped it, with the brightness or temperature it was left at ([#145]). Its next step goes on from there, so a lamp held at its cap or at 0% while the others went on comes back with them, and they keep the difference they had. A step counts only while a lamp still moves, so turning on once every lamp is at its end piles nothing up. A turn planned before a lamp's cap is learned can still take it past its end, so before each turn, lamps that are all past their ends come back together by the steps they all have past them, and the next step the other way moves one of them. A position is forgotten once its lamp is set any other way, and ignored once the lamp is no longer where it was left, such as after a change with its own buttons. A restart forgets them all, as it does the caps.

## Reading what a lamp sends

A lamp answers a query with a reply, and a write with an ACK. A lamp on a low-power supply also sends a change notice when it lowers its brightness to its cap. `litra` takes the first report that arrives as its reply, and reads a brightness from one byte, which holds 255 lm at most, where a Beam goes to 400. So the plugin reads the brightness itself (`getBrightnessInLumenSafe`), from two bytes, skipping every report that isn't the reply.

After every write, it reads the write's ACK (`drainAck`), so that a read on the same handle afterwards would get its reply. The lamps were measured to ACK every write within a few ms, and an ACK is gone once its handle closes ([#96]), so the drain costs little and only guards a read that follows a write on the same handle. What was measured, and how, is in [the probes][probes].

## Keeping the Deck in step

After every operation that writes to the lamps, failed ones included, `litra-manager` calls the listeners registered with `onLampsChanged` ([#57]). Every action that shows the lamps listens: the Power keys, the step keys, the Brightness and Temperature dials, and the lamp screens. So whichever key or dial changed the lamps, everything on the Deck follows, from one read per action, or per set of lamps for the keys, which each show their own. A change made with a lamp's own buttons isn't noticed, and shows at the next change made through the plugin.

An action shows an alert on the key or dial that failed. On a key, the redraw that follows leaves the alert visible when it sets the title, and hides it when it sets the state: the Power key shows its alert after its state for that reason ([#132], see [the SDK notes on keys][keys]).

## Turning a dial

A dial sends a tick at a time, and a quick turn sends many. The dial gathers ticks for a moment (`createDialDebouncer`), so a turn moves the lamps once, by the step the dial has when they're applied. A dial gathers its ticks apart for each lamp it turns, its main screen counting as one, so ticks turned on a lamp screen reach that lamp even when the strip is tapped before they're applied ([#20]). The step keys gather their presses the same way. A step stops on the multiples of the step counted from the bottom of the range ([#14], [#16]), so a dial and a key go through the same values up and down. By default, `litra-manager` steps the value the dial shows, the brightest lamp's brightness or the first lamp's temperature, and sends every lamp there. When the global settings keep the lamps apart, it steps each lamp from its own value along the same multiples, as a turn on that lamp's screen would, so a tick on the main screen is a tick on every lamp's screen, and remembers where a lamp stopped by an end would be (see [What it does remember](#what-it-does-remember)) ([#145]). The settings are read once a turn's ticks are applied, so ticks gathered before a change follow the new setting.

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
[contributing]: contributing.md
[keys]: elgato_sdk/keys.md
[litra]: https://github.com/timrogers/litra
[litra-rs]: https://github.com/timrogers/litra-rs
[logging]: logging.md
[probes]: ../scripts/probes/README.md
