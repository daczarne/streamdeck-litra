# Testing logging

- [When to run these checks](#when-to-run-these-checks)
- [Setup](#setup)
- [Checks](#checks)

The unit tests check against a temporary folder how the log files are written and rotated (see [the logging document][logging]). The checks below cover what they take for granted: that the plugin, as Stream Deck starts it, writes its log to the plugin folder, and that a restart carries the file on instead of starting a new one.

## When to run these checks

- After a change to `src/logging.ts`.
- After an upgrade of `@elgato/streamdeck` or `@elgato/utils`.
- After a Stream Deck update.

## Setup

Plug in both Beams and place a Power key on the Deck. Build the branch and restart the plugin:

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
3. **The plugin's messages reach the log.** Unplug both Beams and press the Power key. The key shows an alert, and the log ends with a `WARN` line saying no lamps were found. `logs/` holds no new `com.daczarne.litra.0.log`, since the message went to the plugin's log, not the SDK's.

[logging]: ../logging.md
