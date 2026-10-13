# Logging

- [The logger](#the-logger)
- [Log files](#log-files)
- [The SDK's own log files](#the-sdks-own-log-files)

The plugin's logs are the only record of why a key or a dial showed an alert ([#41]). This document describes where they're written and how they're kept.

## The logger

Every module logs through `logger` from `src/logging.ts`, never through `streamDeck.logger`. It's a `Logger` from `@elgato/utils`, the class the SDK's own logger is built on (see [the SDK's logging][sdk-logging]), with a file target of the plugin's own. It logs at `info` and above.

The unit tests replace `src/logging.ts` with `src/test-support/fake-logging.ts`, whose calls they can inspect, so they write no files.

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
[sdk-logging]: elgato_sdk/logging.md
