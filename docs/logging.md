# Logging

- [The logger](#the-logger)
- [What gets logged](#what-gets-logged)
  - [Levels](#levels)
  - [Messages](#messages)
  - [The contract](#the-contract)
- [Log files](#log-files)
- [The SDK's own log files](#the-sdks-own-log-files)

The plugin's logs are the only record of why a key or a dial showed an alert ([#41]). This document describes what they record, where they're written and how they're kept.

## The logger

Every module logs through `logger` from `src/logging.ts`, never through `streamDeck.logger`. It's a `Logger` from `@elgato/utils`, the class the SDK's own logger is built on (see [the SDK's logging][sdk-logging]), with a file target of the plugin's own. It logs at `info` and above.

The unit tests of the modules that log replace `src/logging.ts` with `src/test-support/fake-logging.ts`, whose calls they can inspect, so they write no files. The tests of `src/logging.ts` itself write to a temporary folder.

## What gets logged

The log tells, in order, what was pressed or turned on the Deck, what each lamp did, and what failed. Each message is written where its context is. The actions log what the user did, since only they know which key or dial it was and with which settings. `src/litra-manager.ts` logs what each lamp did, from inside its loop over the lamps, since only it knows the lamp and the value.

### Levels

- `error`: something failed. The lamps couldn't be listed, a lamp's part in an operation failed, or the plugin hit a bug.
- `warn`: something expected was missing or wrong, such as a lamp, a handle that wouldn't close, or an action's setting that isn't valid.
- `info`: what the user did, and every change made to a lamp.
- `debug`: what was read from the lamps. The plugin reads them after every change, to keep every key and dial up to date, so logging the reads at `info` would about triple the log and add nothing to finding the cause of an alert. To see them, set the level in `src/logging.ts` to `debug`, rebuild and restart.

### Messages

- Each line names its source as a scope: `Lamps` for `src/litra-manager.ts`, `Global settings` for `src/actions/global-settings.ts`, and the action's name for the others (`Power`, `Brightness`, `Temperature`, `Scene`, `Brightness Up`, `Brightness Down`, `Temperature Up`, `Temperature Down`, `Lamp screens`, `Lamp picker`).
- A message from `Lamps` starts with the operation (`turn on`, `set brightness`, `read power`, …), so searching for `set brightness:` finds every step of a brightness change.
- A lamp is named by its model and the last 4 characters of its serial number, after `…`. That's enough to tell lamps apart, without writing whole serial numbers to a file that may end up in an issue. The examples below write those characters as `<serialNumber1>` for one lamp and `<serialNumber2>` for the other. A lamp an operation was asked for but didn't find is named by its id, since that's all the plugin knows of it.
- An error from a lamp is written as its message alone, since its stack only points inside `node-hid`. An error that means a bug in the plugin is written with its stack.

A press of a Brightness key with one lamp at its cap and the other failing reads:

```text
2026-10-13T15:04:05.123Z INFO  Brightness: Key pressed: preset 100%
2026-10-13T15:04:05.130Z ERROR Lamps: set brightness: Beam …<serialNumber1> failed: Error: could not read from HID device
2026-10-13T15:04:05.395Z INFO  Lamps: set brightness: Beam …<serialNumber2> sent 400 lm, reached 250 lm (59%)
2026-10-13T15:04:05.395Z INFO  Lamps: set brightness: Beam …<serialNumber2> capped at 250 lm
```

A run that presses a 100% key with both lamps plugged into a hub, again once lamp 1 is plugged into the computer, and again once it's plugged back into a hub, reads:

```text
2026-10-16T21:07:22.384Z INFO  Plugin started
2026-10-16T21:07:25.269Z INFO  Brightness: Key pressed: preset 100%
2026-10-16T21:07:25.287Z INFO  Lamps: set brightness: Beam …<serialNumber1> turned on
2026-10-16T21:07:25.291Z INFO  Lamps: set brightness: Beam …<serialNumber2> turned on
2026-10-16T21:07:25.549Z INFO  Lamps: set brightness: Beam …<serialNumber1> sent 400 lm, reached 324 lm (79%)
2026-10-16T21:07:25.550Z INFO  Lamps: set brightness: Beam …<serialNumber1> capped at 324 lm
2026-10-16T21:07:25.552Z INFO  Lamps: set brightness: Beam …<serialNumber2> sent 400 lm, reached 244 lm (58%)
2026-10-16T21:07:25.553Z INFO  Lamps: set brightness: Beam …<serialNumber2> capped at 244 lm
2026-10-16T21:07:45.328Z INFO  Brightness: Key pressed: preset 100%
2026-10-16T21:07:45.347Z INFO  Lamps: set brightness: Beam …<serialNumber1> turned on
2026-10-16T21:07:45.350Z INFO  Lamps: set brightness: Beam …<serialNumber1> was plugged in again, its cap of 324 lm is forgotten
2026-10-16T21:07:45.606Z INFO  Lamps: set brightness: Beam …<serialNumber2> sent 244 lm, reached 244 lm (58%)
2026-10-16T21:07:45.609Z INFO  Lamps: set brightness: Beam …<serialNumber1> sent 400 lm, reached 400 lm (100%)
2026-10-16T21:08:02.633Z INFO  Brightness: Key pressed: preset 100%
2026-10-16T21:08:02.651Z INFO  Lamps: set brightness: Beam …<serialNumber1> turned on
2026-10-16T21:08:02.909Z INFO  Lamps: set brightness: Beam …<serialNumber2> sent 244 lm, reached 244 lm (58%)
2026-10-16T21:08:02.911Z INFO  Lamps: set brightness: Beam …<serialNumber1> sent 400 lm, reached 320 lm (78%)
2026-10-16T21:08:02.912Z INFO  Lamps: set brightness: Beam …<serialNumber1> capped at 320 lm
```

A lamp plugged in again starts off, so it's turned on first. Back on a hub, lamp 1 has no cap to forget, since it never fell short on the computer.

### The contract

| Situation                                                                                   | Level   | Logged by                        | Includes                                                                                                                                                                                                     |
|---------------------------------------------------------------------------------------------|---------|----------------------------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| The plugin starts                                                                           | `info`  | `src/plugin.ts`                  | Nothing more                                                                                                                                                                                                 |
| The plugin can't connect to Stream Deck                                                     | `error` | `src/plugin.ts`                  | The error with its stack                                                                                                                                                                                     |
| A key press, a dial push, a dial turn, a tap or hold on a strip                             | `info`  | The action                       | What it asks for: the key's mode, presets, or presses and step, the ticks and the dial's step, whether the dial is on a lamp screen, the lamps a key acts on, and whether each lamp steps from its own value |
| A settings page asks for the lamps, or presses Identify                                     | `info`  | `src/actions/lamp-picker.ts`     | What it asked for                                                                                                                                                                                            |
| A change made to a lamp                                                                     | `info`  | `src/litra-manager.ts`           | The operation, the lamp, the value sent and, for brightness, reached                                                                                                                                         |
| A lamp's brightness cap is learned                                                          | `info`  | `src/litra-manager.ts`           | The operation, the lamp, the cap                                                                                                                                                                             |
| A lamp's cap is forgotten, since it was plugged in again                                    | `info`  | `src/litra-manager.ts`           | The operation, the lamp, the old cap                                                                                                                                                                         |
| A brightness change waits for a lamp that can still go back to its cap                      | `debug` | `src/litra-manager.ts`           | The operation, how long it waits                                                                                                                                                                             |
| A value read from a lamp                                                                    | `debug` | `src/litra-manager.ts`           | The operation, the lamp, the value                                                                                                                                                                           |
| No lamps found                                                                              | `warn`  | `src/litra-manager.ts`           | The operation                                                                                                                                                                                                |
| An operation is given no lamp                                                               | `warn`  | `src/litra-manager.ts`           | The operation                                                                                                                                                                                                |
| A lamp an operation was asked to act on isn't connected                                     | `warn`  | `src/litra-manager.ts`           | The operation, the lamp's id                                                                                                                                                                                 |
| Every lamp found is left out, by a key that takes in lamps plugged in later ([#147])        | `warn`  | `src/litra-manager.ts`           | The operation                                                                                                                                                                                                |
| A lamp's handle fails to close                                                              | `warn`  | `src/litra-manager.ts`           | The lamp, the error                                                                                                                                                                                          |
| An action's setting isn't valid, so its default is used                                     | `warn`  | The action                       | The setting, its value, the default                                                                                                                                                                          |
| A global setting isn't valid, so its default is used                                        | `warn`  | `src/actions/global-settings.ts` | The setting, or the lamp screens' cell and item and the option ([#177]), its value, the default                                                                                                              |
| Listing the lamps fails                                                                     | `error` | `src/litra-manager.ts`           | The operation, the error                                                                                                                                                                                     |
| A lamp's part in an operation fails                                                         | `error` | `src/litra-manager.ts`           | The operation, the lamp, the error                                                                                                                                                                           |
| A lamps-changed listener, a dial flush, a lamp screen or an answer to a settings page fails | `error` | Where the error is caught        | What failed, the error with its stack                                                                                                                                                                        |
| Reading the global settings fails                                                           | `error` | `src/actions/global-settings.ts` | The error with its stack                                                                                                                                                                                     |
| A global settings listener fails                                                            | `error` | `src/actions/global-settings.ts` | What failed, the error with its stack                                                                                                                                                                        |
| Draining the reply a command leaves fails                                                   | nothing |                                  | By design: the command itself went through                                                                                                                                                                   |

The unit tests check each row's level and what its message includes, never its wording, so a message can be reworded without breaking a test. The plugin's start is the exception, checked by hand (see [the manual checks][manual-checks]). A new situation gets a row here and a test with it.

## Log files

The plugin writes its log to `com.daczarne.litra.sdPlugin/logs/litra.log`, and carries the file on across restarts. Each run starts with a `Plugin started` line. Each line reads `<time> <LEVEL> <message>`, with the time in UTC:

```text
2026-10-13T15:04:05.123Z INFO  Plugin started
```

The files are rotated by size, like Python's `RotatingFileHandler`:

- When the next line would take `litra.log` past 1 MB (about 7,000 to 10,000 lines), it becomes `litra.1.log`, every older file moves up one, and a new `litra.log` begins.
- Four older files are kept, up to `litra.4.log`, so the log takes 5 MB at most. The oldest file is deleted when the next one takes its place.
- `litra.log` always holds the newest lines, and `litra.4.log` the oldest.

A restart doesn't rotate the files, so a run that showed a bug stays in the log however many times the plugin is restarted to chase it. Only the size limit decides how far back the log goes.

A line that can't be written, because the disk is full or the folder can't be written to, is dropped, so logging never stops a lamp operation.

## The SDK's own log files

The same folder can hold `com.daczarne.litra.<n>.log` files. They belong to the SDK's own logger, which records only what the SDK reports itself, and starts a new file every time the plugin starts and logs something. Most runs leave none. The one to read is an uncaught exception, which the SDK logs there with its stack: when the plugin stops responding, or `litra.log` stops short, look there too. [The SDK's logging][sdk-logging] lists what it logs.

[#41]: https://github.com/daczarne/streamdeck-litra/issues/41
[#147]: https://github.com/daczarne/streamdeck-litra/issues/147
[#177]: https://github.com/daczarne/streamdeck-litra/issues/177
[manual-checks]: manual_testing/logging.md
[sdk-logging]: elgato_sdk/logging.md
