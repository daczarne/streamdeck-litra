# Stream Deck SDK logging

- [The logger](#the-logger)
- [Its log files](#its-log-files)
- [What the SDK logs itself](#what-the-sdk-logs-itself)
- [Sources](#sources)

The SDK gives every plugin a logger, `streamDeck.logger`, which writes to files in the plugin folder. This document describes how it works and why the plugin logs through its own file target instead ([#41]): the SDK starts a new file every time the plugin starts, and offers no way to change that. What the plugin logs, and where, is in [the logging document][logging].

## The logger

`streamDeck.logger` is an instance of `Logger` from `@elgato/utils`, Elgato's utilities package, which the SDK depends on. The class can be used on its own, with any targets (`LogTarget` is a single `write(entry)` method).

- **Levels.** `error`, `warn`, `info`, `debug` and `trace`. `streamDeck.logger` starts at `info`, or at `debug` when the plugin runs under a debugger. Its minimum level is `debug` (`trace` under a debugger): `setLevel` with a more verbose level than the minimum sets `info` instead, without an error.
- **Scopes.** `createScope("Name")` returns a logger that prefixes every message with the scope and a colon (`Name: message`) and follows the parent's level. Scopes nest as `Parent->Child`.
- **Format.** `stringFormatter()` writes `<time> <LEVEL> <scope>: <message>`: the time in UTC (ISO 8601), the level padded to 5 characters, and the arguments joined by spaces. An `Error` argument is written as its stack, on lines of its own, and an object as JSON.

## Its log files

The targets are set when the SDK is imported, and no API adds or replaces one: `streamDeck.logger` always writes to the SDK's `FileTarget` (and to the console under a debugger).

- The files are `logs/<plugin UUID>.<n>.log` in the working directory, which is the plugin folder: `com.daczarne.litra.0.log` is the current one.
- **Every start begins a new file.** The constructor, which runs on import, shifts the existing files up one (`.0` becomes `.1`, and so on), deletes those past the tenth, and creates the `logs/` folder if it's missing. `.0` is created on the first write, so a run that logs nothing leaves the older files where they were.
- Within a run, a file is rotated the same way once it reaches 50 MB, counted in characters rather than bytes, without the newlines.
- The folder, file name, size and count are fixed in the SDK, and none can be changed from the plugin.

With a restart on every build, ten restarts while chasing a bug push out the run that showed it. The plugin's own `RotatingFileTarget`, in `src/logging.ts`, carries one file on across restarts instead, and rotates by size only.

Importing the SDK creates `logs/`, so the unit tests replace `@elgato/streamdeck` with a fake.

## What the SDK logs itself

Little, at the levels the plugin runs at:

- A message from Stream Deck it can't parse (`error`), or of a kind it doesn't know (`warn`).
- Translations it can't load (`error`).
- An uncaught exception, or an unhandled promise rejection, which Node raises as one (`error`, with the stack). The SDK listens for it with `process.once`, so the first one is logged and the plugin carries on, while a second one ends the plugin as Node would without a listener.
- Every message to and from Stream Deck, at `trace`, which only a debugger enables.

## Sources

Checked against `@elgato/streamdeck` 3.0.1 and `@elgato/utils` 0.6.0, both installed in `node_modules/`:

- The logger the SDK creates, its targets and the uncaught exception listener: `@elgato/streamdeck/dist/plugin/logging/index.js`.
- The SDK's own log calls: `@elgato/streamdeck/dist/plugin/connection.js` and `@elgato/streamdeck/dist/plugin/i18n.js`.
- `Logger`, `stringFormatter` and `LogTarget`: `@elgato/utils/dist/logging/`.
- `FileTarget`: `@elgato/utils/dist/logging/node/file-target.js`.

[#41]: https://github.com/daczarne/streamdeck-litra/issues/41
[logging]: ../logging.md
