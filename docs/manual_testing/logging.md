# Testing logging

- [When to run these checks](#when-to-run-these-checks)
- [Setup](#setup)
- [Checks](#checks)

The unit tests check against a temporary folder how the log files are written and rotated, and against emulated lamps what each situation logs (see [the logging document][logging]). The checks below cover what they take for granted: that the plugin, as Stream Deck starts it, writes its log to the plugin folder, that a restart carries the file on instead of starting a new one, and that the lines read as a story of what happened on the Deck.

## When to run these checks

- After a change to `src/logging.ts`, or to what the plugin logs.
- After an upgrade of `@elgato/streamdeck` or `@elgato/utils`.
- After a Stream Deck update.

## Setup

Plug in two Beams and place a Power key, a Brightness key and a Brightness dial on the Deck. Build the branch and restart the plugin:

```shell
npm run build
npx streamdeck restart com.daczarne.litra
```

In VS Code, the `Build and restart` task runs both.

To read the end of the log:

```shell
tail -n 5 com.daczarne.litra.sdPlugin/logs/litra.log
```

## Checks

1. **A run is marked where it starts.** After the restart, the log ends with a `Plugin started` line, with the time of the restart in UTC.
2. **A restart carries the log on.** Restart the plugin again. The log ends with two `Plugin started` lines, one per restart, and `logs/` holds no new `litra.1.log`.
3. **A press is followed by what each lamp did.** Press the Brightness key. The log gains an `INFO` line from `Brightness` with the key's preset, then one `INFO` line from `Lamps` per Beam with the lumens sent and reached. A Beam on the Deck's hub also gets a line with its cap, the first time it reaches it since the plugin started or the lamp was plugged in again.
4. **Lamps are named without their whole serial number.** In the lines of check 3, each Beam reads as `Beam …` followed by 4 characters, and the two Beams' differ.
5. **Reads stay out of the log.** Turn the Brightness dial a few steps. The log gains one `INFO` line from `Brightness` per burst of turning, with its ticks, and the lines of the change, but no `Lamps: read` lines.
6. **Failures reach the plugin's log.** Unplug both Beams and press the Brightness key. The key shows an alert, and the log gains an `INFO` line from `Brightness` with the key's preset, then `WARN` lines saying no lamps were found. `logs/` holds no new `com.daczarne.litra.0.log`, since the messages went to the plugin's log, not the SDK's. The Power key logs its press the same way, but its alert can't be relied on to show (see [Stream Deck keys][keys]).

[keys]: ../elgato_sdk/keys.md
[logging]: ../logging.md
