# Probes

- [brightness-readback.mjs](#brightness-readbackmjs)
  - [Running it](#running-it)
  - [Reading the results](#reading-the-results)
  - [Example](#example)
- [write-reports.mjs](#write-reportsmjs)
  - [Running it](#running-it-1)
  - [Example](#example-1)
- [brightness-ceiling.mjs](#brightness-ceilingmjs)
  - [Running it](#running-it-2)
  - [Example](#example-2)

These scripts talk to the lamps directly, to answer questions about how they behave that the tests can't: the emulated lamps the tests run on only do what we assume a real one does. The emulated lamp, in `src/test-support/emulated-litra.ts`, follows what these scripts measured, so a run that finds a lamp behaving otherwise updates it too. The scripts aren't part of the plugin or the build, and are run by hand with the lamps connected. CI checks their code, as it checks the other scripts': types, lint and doc comments.

## brightness-readback.mjs

For each connected Litra, sets a brightness, reads it back at several delays after the write, and prints every HID report the lamp sends in between. It was written for [#13], to find out whether a lamp reports the brightness it was sent or the one it reached.

It shows:

- The brightness each lamp actually reaches on its power supply, since a lamp on a low-power supply caps it.
- How long a lamp takes to apply that cap, and what it reports in the meantime.
- Which reports arrive without being asked for, and whether a read can pick up the ACK of the write before it.
- Whether a lower brightness, written after the lamp was asked for more than its cap, stays.
- Whether writes that stay within the cap can be undone the same way.

Run it again when changing how the plugin reads brightness, or with a lamp it hasn't been run on, such as the Beam LX.

### Running it

> [!WARNING]
> The script changes the lamps' brightness while it runs, and puts it back at the end. Don't use the Deck while it runs: the plugin opens the same lamps, and the reports it triggers would mix with the probe's.

From the repo root:

```shell
n auto
node scripts/probes/brightness-readback.mjs      # sets 90%
node scripts/probes/brightness-readback.mjs 50   # sets another %
```

For every lamp, in the order `findDevices` returns them, the script:

1. Sets the target the way the plugin does (the write, then a 50 ms read to drain its ACK), then reads the brightness 0, 100, 250, 500 and 1000 ms after the write.
2. Sets the target again without draining, and reads straight away.
3. Sets the target, lowers the lamp to its minimum 50, 150, 300 or 1000 ms later, then reads it every 250 ms for 3 s, once for each delay.
4. On a lamp that is capped, learns its cap, then checks writes that don't go above it the same way: halfway between the minimum and the cap, the cap itself, and the target followed by the cap 250 ms later. Each is lowered to the minimum 150 or 300 ms after its last write. A lamp that isn't capped skips this step.

With more than one lamp, it then reads every lamp again, sets them all to the target at once and reads them a second later, so lamps sharing a power supply draw from it together. After each step it puts the lamp back to its brightness and power state, and reads it to check: a line ending in `FAILED` means the lamp was left elsewhere. The reading at the start of the last step is a later check of the same kind, made after reopening the lamps.

A run takes under a minute per capped lamp, and about 20 seconds per lamp that isn't capped.

The results go to a file in `out/`, named after the time the run started (`YYYYMMDD_HHMMSS.txt`), and the terminal only shows its path. Each line is written as soon as it's known, so a run that fails partway keeps what it found. The files hold the lamps' serial numbers, so git ignores them. Nothing in a file says how the lamps were plugged in, so add a note at its top after the run.

### Reading the results

Each report is printed as its first 8 bytes in hex, followed by its name and value. A byte past the end of a short report shows as `--`, and a value it's too short to hold as `(report too short)`. The lamps have always sent full 20-byte reports, so neither should appear. Byte 2 is the feature (`04` on the Beam and the Glow, `06` on the Beam LX), and byte 3 says what the report is:

| Report              | Starts with      | Value in      | What it is                                                           |
|---------------------|------------------|---------------|----------------------------------------------------------------------|
| Power reply         | `11 ff 04 01`    | byte 4        | The answer to a power query: 1 for on, 0 for off                     |
| Brightness reply    | `11 ff 04 31`    | bytes 4–5     | The answer to a brightness query: the lamp's brightness, in lumens   |
| Temperature reply   | `11 ff 04 81`    | bytes 4–5     | The answer to a temperature query: the lamp's temperature, in kelvin |
| Change notice       | `11 ff 04 40`    | bytes 5–6     | Sent unasked when the brightness changes                             |
| Set-power ACK       | `11 ff 04 1c`    | none          | Sent after every power write                                         |
| Set-brightness ACK  | `11 ff 04 4c`    | none          | Sent after every brightness write                                    |
| Set-temperature ACK | `11 ff 04 9c`    | none          | Sent after every temperature write                                   |
| Error report        | `11 ff ff 04 4c` | byte 5 (code) | The lamp rejected the command named in bytes 3–4                     |

In HID++ 2.0, error code `02` means an invalid argument.

The % next to the lumens is the place in the range `litra` hard-codes for the lamp (30–400 lm for the Beam), computed the way the plugin computes it. A capped lamp therefore shows up as a lower %, not as 100%.

Each timed read in steps 1 and 2 prints the next report the lamp sends, whatever it is. A notice or an ACK that arrives first pushes the reply to a later read, which is the point: the plugin reads the same way. The readings the script relies on (`before`, the readings with every lamp at once, and the restore checks) skip ahead to the reply.

Steps 3 and 4 work differently. They listen to the lamp the whole time, and print every report with the time it arrived, counted from the first write of each try. Their `reads` lines are their own brightness queries. A lamp that keeps its minimum reads 30 lm until the end of the try. A lamp that goes back to its cap reads the cap from some point on, without a change notice to say when. Step 4 starts with the cap it learned: the writes in 4a and 4b stay within it, while 4c goes above it once and then writes it.

### Example

From a run on 2026-10-10, before step 3 existed, with lamp 1 plugged into the computer and lamp 2 into a Stream Deck + XL's USB hub (second USB-C port). It is abridged, and the serial numbers are masked:

```text
Lamp 1: Logitech Litra Beam, serial SERIAL-A
  power: on
  before: 30 lm (0%)
  1. set 90%, drain 50 ms like the plugin, then read
     drained:   11 ff 04 4c 00 00 00 00  set-brightness ACK
     +   3 ms: 11 ff 04 31 01 6b 00 00  brightness reply: 363 lm (90%)
     + 100 ms: 11 ff 04 31 01 6b 00 00  brightness reply: 363 lm (90%)
     + 250 ms: 11 ff 04 31 01 6b 00 00  brightness reply: 363 lm (90%)
     + 500 ms: 11 ff 04 31 01 6b 00 00  brightness reply: 363 lm (90%)
     +1001 ms: 11 ff 04 31 01 6b 00 00  brightness reply: 363 lm (90%)
     after restore: 11 ff 04 4c 00 00 00 00  set-brightness ACK
  restored to 30 lm (0%), on: ok
  ...

Lamp 2: Logitech Litra Beam, serial SERIAL-B
  power: on
  before: 30 lm (0%)
  1. set 90%, drain 50 ms like the plugin, then read
     drained:   11 ff 04 4c 00 00 00 00  set-brightness ACK
     +   3 ms: 11 ff 04 31 01 6b 00 00  brightness reply: 363 lm (90%)
     + 101 ms: 11 ff 04 40 01 00 f4 00  change notice: 244 lm (58%)
     + 250 ms: 11 ff 04 40 01 00 f4 00  change notice: 244 lm (58%)
     + 501 ms: 11 ff 04 31 00 f4 00 00  brightness reply: 244 lm (58%)
     +1000 ms: 11 ff 04 31 00 f4 00 00  brightness reply: 244 lm (58%)
     then:       11 ff 04 31 00 f4 00 00  brightness reply: 244 lm (58%)
     then:       11 ff 04 31 00 f4 00 00  brightness reply: 244 lm (58%)
     after restore: 11 ff 04 4c 00 00 00 00  set-brightness ACK
  restored to 30 lm (0%), on: ok
  2. set 90%, read without draining
     first read: 11 ff 04 4c 00 00 00 00  set-brightness ACK
     then:       11 ff 04 31 01 6b 00 00  brightness reply: 363 lm (90%)
     then:       11 ff 04 40 01 00 f4 00  change notice: 244 lm (58%)
     then:       11 ff 04 40 01 00 f4 00  change notice: 244 lm (58%)
     after restore: 11 ff 04 4c 00 00 00 00  set-brightness ACK
  restored to 30 lm (0%), on: ok

All lamps at once: set 90% on every lamp, then read each 1 s later
  lamp 1 (SERIAL-A): 363 lm (90%)
  lamp 2 (SERIAL-B): 244 lm (58%)
  ...
  restored to 244 lm (58%), on: ok
```

Reading it:

- Lamp 1, plugged into the computer, reaches 90%. It replies with the value it was sent and sends no change notice.
- Lamp 2, plugged into a hub, first replies with the value it was sent, 363 lm. About 100 ms after the write it applies its cap and sends a change notice with the brightness it reached, 244 lm (58%). From 250 ms on, every reply is the capped value.
- Without the drain, the first read gets the ACK of the write.
- Lamp 2 passed its restore check at 30 lm, but the last step found it at 244 lm when it started, and restored it to that. Step 3 was added to find out why a lower brightness doesn't stay.

What the runs on 2026-10-10 found about the cap on a Stream Deck + XL's hub, in lumens:

| Lamp   | First USB-C port | Second USB-C port |
|--------|------------------|-------------------|
| Lamp 1 | 324 (79%)        | 264 (63%)         |
| Lamp 2 | 284 (69%)        | 244 (58%)         |

The cap depends on both the port and the lamp (with its cable), and stays the same whether the other lamp is at its minimum or at 90%. Plugged into the computer, neither lamp is capped. The lamps also came in a different order from one `findDevices` call to the next.

Steps 3 and 4 found that a capped lamp can undo a write that comes soon after a request above its cap:

- Some time between 0.5 s and 1.25 s after a request above its cap, the lamp goes back to its cap, without sending a notice. A lower brightness written before that moment is lost, and one written after it stays.
- Three of the four lamp and port pairs did this every time. Lamp 1 on the first port, the pair with the highest cap (324 lm), never did, in two runs.
- Writes that don't go above the cap, including the cap itself, were never undone (step 4a and 4b).
- Writing the cap 250 ms after a request above it doesn't stop the lamp from going back to its cap (step 4c).
- A request above the cap while the lamp is already at its cap gets error `02` instead of an ACK, followed by change notices with the cap. The lamp can still go back to its cap afterwards.
- A lamp plugged into the computer kept every lower brightness.

## write-reports.mjs

For each connected Litra, makes each kind of write and prints every HID report the lamp sends in the second after it. It was written for [#96], to find out whether a lamp ACKs a power or a temperature write as it ACKs a brightness write, and whether a report sent before a handle closes reaches the next handle opened on the lamp. The plugin drains an ACK after every write (`drainAck` in `src/litra-manager.ts`), and opens new handles for every operation, so both decide whether that drain does anything.

Run it again when changing how the plugin writes to the lamps, or with a lamp it hasn't been run on, such as the Beam LX.

### Running it

> [!WARNING]
> The script turns the lamps off and on and changes their temperature and brightness while it runs, and puts them back at the end. Don't use the Deck while it runs: the plugin opens the same lamps, and the reports it triggers would mix with the probe's.

From the repo root:

```shell
n auto
node scripts/probes/write-reports.mjs
```

For every lamp, in the order `findDevices` returns them, with the other lamps closed, the script makes each write and listens for a second after it:

1. Turns the lamp off and on, each twice: once changing its power, once to the power it already has.
2. Sets the far end of its temperature range twice, the second time to the temperature it already has, then the temperature it had.
3. Sets its minimum brightness, then the brightness it had, which a capped lamp reached and so keeps. The ACK of a brightness write is known, so this step shows that the probe sees what it should.
4. Makes the writes that change the lamp again, each followed by closing the handle straight away, without reading, and opening the lamp again. It listens on the new handle.

It then puts the lamp back to its power, brightness and temperature, and reads it to check: a line ending in `FAILED` means the lamp was left elsewhere. A run takes about 20 seconds per lamp. The results go to a file in `out/`, as with `brightness-readback.mjs`. Add a note at its top saying how the lamps were plugged in.

Each report is printed as in `brightness-readback.mjs`, named after the table in [Reading the results](#reading-the-results), with the time it arrived, counted from the write. A write followed by no report within the second says so. Any other report shows as `other`, with its function byte.

### Example

From the runs on 2026-10-17, on two Beams: once with both on a USB hub, once with one on the hub and the other plugged into the computer. Both lamps sent the same in every run, so this shows one lamp, abridged:

```text
Lamp 1: Logitech Litra Beam, serial SERIAL-A
  before: on, 30 lm (0%), 2700 K
  1. power
     turn off, from on
     +   1 ms: 11 ff 04 1c 00 00 00 00  set-power ACK
     turn off, already off
     +   2 ms: 11 ff 04 1c 00 00 00 00  set-power ACK
     ...
  2. temperature
     set 6500 K, from 2700 K
     +   2 ms: 11 ff 04 9c 00 00 00 00  set-temperature ACK
     set 6500 K, already at it
     +   3 ms: 11 ff 04 9c 00 00 00 00  set-temperature ACK
     ...
  4. each write, then close the handle and open the lamp again
     turn off, from on, close, reopen
     +  14 ms: reopened
     +1006 ms: (nothing within 1000 ms)
     ...
  restored to on, 30 lm (0%), 2700 K: ok
```

Reading it:

- Every write gets an ACK within 1 to 4 ms, power and temperature as much as brightness, whatever the power supply. A write that changes nothing, such as turning on a lamp that's already on, gets one too.
- Nothing else follows a power or temperature write: no notice, like the change notice that follows a capped brightness write.
- After a write, a handle closed without reading leaves nothing for the next one: the lamp opened again received nothing, for every kind of write.

So the plugin's drain after a write (`drainAck`) returns within a few ms, and only matters for a read on the same handle afterwards. The emulated lamp sends an ACK after every write and nothing to a new handle, as measured.

## brightness-ceiling.mjs

For each connected Litra on a low-power supply, compares the cap it stops at when sent more than it can reach, as the plugin learns it, with the most it holds when stepped up to it 1 lm at a time. It was written for [#164], where a Beam reached 326 lm, then stopped at 324 lm on the next step up, so the plugin learned a cap below a brightness the lamp had just held.

Run it again when a lamp seems to stop below a brightness it reached before, or when changing how the plugin learns a cap.

### Running it

> [!WARNING]
> The script changes the lamps' brightness while it runs, and puts it back at the end. Don't use the Deck while it runs: the plugin opens the same lamps, and the reports it triggers would mix with the probe's.

From the repo root:

```shell
n auto
node scripts/probes/brightness-ceiling.mjs
```

For every lamp, in the order `findDevices` returns them, the script:

1. From the lamp's minimum, sends its maximum, and reads where it stops after 300 ms of silence, as the plugin learns a cap, then again once the lamp can no longer go back to its cap. A lamp that reaches its maximum isn't capped, and skips the other steps.
2. From 20 lm below that cap, steps up 1 lm at a time, reading each step, until the lamp reaches less than it was sent, then reads it again once it can no longer go back to its cap. It climbs twice, to see whether the lamp stops at the same place.
3. Sends its maximum, waits until the lamp can no longer go back to its cap, then sends the most it held in step 2, and reads it every 250 ms for 3 s, to see whether it holds it after being capped.
4. From the start of the climb, sends the most it held in step 2, and reads it every 250 ms for 3 s, to see whether it holds it when it wasn't just capped.

It then puts the lamp back to its brightness and power, and reads it to check, as `brightness-readback.mjs` does. A run takes about 30 seconds per capped lamp, and a few seconds per lamp that isn't capped. The results go to a file in `out/`, as with `brightness-readback.mjs`. Add a note at its top saying how the lamps were plugged in.

### Example

From a run on 2026-11-01, with two Beams on a Stream Deck + XL's USB hub, one on the USB-C port of a monitor's KVM, and a Beam LX plugged into the computer. It shows one lamp, abridged, with its serial number masked:

```text
Lamp 1: Logitech Litra Beam, serial SERIAL-A
  power: on
  before: 30 lm (0%)
  1. from the minimum, send the maximum, 400 lm (100%)
     stopped at 320 lm (78%)
     after the window: 320 lm (78%)
  2. climb 1 of 2, 1 lm at a time
     from 300 lm (73%)
     sent 301 lm, reached 301 lm (73%)
     ...
     sent 320 lm, reached 320 lm (78%)
     sent 321 lm, reached 320 lm (78%)
     stopped: held 320 lm (78%), then stopped at 320 lm (78%)
     after the window: 320 lm (78%)
  ...
  3. send the maximum, wait out the window, then send the most it held, 320 lm (78%)
     the maximum stopped at 320 lm (78%)
     after the window: 320 lm (78%)
     +   1 ms: set 320 lm (78%)
     +   2 ms: 11 ff 04 4c 00 00 00 00  set-brightness ACK
     + 253 ms: reads 320 lm (78%)
     ...
     +3003 ms: reads 320 lm (78%)
     held it
  4. from 300 lm (73%), send the most it held, 320 lm (78%)
     ...
     held it
     after restore: 11 ff 04 4c 00 00 00 00  set-brightness ACK
  restored to 30 lm (0%), on: ok
```

Reading it:

- On each of the three capped Beams, the most a lamp held when stepped up to it was the cap it stopped at when sent its maximum: 320, 244 and 340 lm. One lumen more stopped at that same cap, never below it, on both climbs. The Beam LX, plugged into the computer, reached its maximum.
- After being capped, each lamp held its cap, and kept it once it could no longer go back to it.
- The Beams on the hub had stopped at 324 lm in October, where the highest one now stopped at 320 lm. A cap moves by a few lumens over time, maybe as the lamp warms up or as the supply varies, which most likely explains [#164]: the step up didn't lower the lamp, it found a cap that had dropped since the step before. The plugin learns a cap each time a lamp falls short of what it was sent, so a cap that drops is learned again. The emulated lamp's cap is fixed, as the tests need.

[#13]: https://github.com/daczarne/streamdeck-litra/issues/13
[#96]: https://github.com/daczarne/streamdeck-litra/issues/96
[#164]: https://github.com/daczarne/streamdeck-litra/issues/164
