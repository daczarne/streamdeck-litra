#!/usr/bin/env node
/**
 * Shows what each connected Litra reports after a brightness write, as raw HID reports. Written for #13, to find out
 * whether a lamp reports the brightness it was sent or the one it reached, and how soon.
 *
 * For every lamp, in the order findDevices returns them:
 *   1. Sets the target % the way the plugin does (write, then drain the ACK for 50 ms), then reads the brightness
 *      back at several delays after the write.
 *   2. Sets the target % again without draining, and reads straight away, to see whether the read gets the ACK.
 *   3. Sets the target %, lowers the lamp to its minimum after a delay, then reads it for a few seconds, to see whether
 *      a capped lamp goes back to its cap after a lower write. Repeated for several delays.
 *   4. On a capped lamp, does the same after writes that don't go above the cap: halfway to the cap, the cap itself,
 *      and the target % followed by the cap.
 * With more than one lamp, it then sets every lamp to the target at once and reads them all, so lamps that share a
 * power supply draw from it together. After each step it restores the lamp's brightness and power, and checks it.
 *
 * The results go to out/YYYYMMDD_HHMMSS.txt next to this script, named after the time the run started, so runs can be
 * compared later. The terminal only shows where the file is.
 *
 * Usage: node scripts/probes/brightness-readback.mjs [targetPercentage]   (default 90)
 */
import { setTimeout as sleep } from "node:timers/promises";

import litra from "litra";

import {
  describe,
  drainAll,
  elapsed,
  featureIndex,
  listen,
  log,
  lumenAndPercentage,
  outFile,
  printDrained,
  readBrightness,
  SETTLE_MS,
  startedAt,
} from "./reports.mjs";

/** @import { Lamp } from "./reports.mjs" */

const TARGET_PERCENTAGE = Number(process.argv[2] ?? 90);
const DELAYS_MS = [0, 100, 250, 500, 1000];
const LOWER_AFTER_MS = [50, 150, 300, 1000];
const WITHIN_CAP_LOWER_AFTER_MS = [150, 300];
const CAP_AFTER_MS = 250;
const WATCH_MS = 3000;
const WATCH_INTERVAL_MS = 250;

// A capped lamp goes back to its cap up to 1.25 s after a request above it, so a write meant to stay waits longer.
const REVERT_WINDOW_MS = 2000;

//* HID

/**
 * Sends the get-brightness query and returns the next report, whatever it is, or [] after 1 s.
 *
 * @param {Lamp} device
 * @returns {number[]}
 */
function query(device) {
  device.hid.write([0x11, 0xff, featureIndex(device), 0x31, ...Array(16).fill(0)]);
  return device.hid.readTimeout(1000);
}

/**
 * The lumens litra's setBrightnessPercentage sends for the target %.
 *
 * @param {Lamp} device
 * @returns {number}
 */
function targetLumen(device) {
  const min = litra.getMinimumBrightnessInLumenForDevice(device);
  const max = litra.getMaximumBrightnessInLumenForDevice(device);
  return Math.ceil((TARGET_PERCENTAGE / 100) * (max - min) + min);
}

/**
 * Makes each write at its time, lowers the lamp to its minimum at `lowerAfter`, then reads it every 250 ms for 3 s.
 * Times count from the first write, and every report is logged with the time it arrived.
 *
 * @param {Lamp} device
 * @param {Array<{ at: number, lumen: number }>} writes each write's time in ms and lumens
 * @param {number} lowerAfter in ms
 * @returns {void}
 */
function writeThenLower(device, writes, lowerAfter) {
  const minimum = litra.getMinimumBrightnessInLumenForDevice(device);
  const start = performance.now();
  for (const { at, lumen } of writes) {
    listen(device, start, at);
    litra.setBrightnessInLumen(device, lumen);
    log(`     ${elapsed(start)} set ${lumenAndPercentage(device, lumen)}`);
  }
  listen(device, start, lowerAfter);
  litra.setBrightnessInLumen(device, minimum);
  log(`     ${elapsed(start)} set ${lumenAndPercentage(device, minimum)}`);
  for (let tick = lowerAfter + WATCH_INTERVAL_MS; tick <= lowerAfter + WATCH_MS; tick += WATCH_INTERVAL_MS) {
    listen(device, start, tick);
    const lumen = readBrightness(device, (bytes) => log(`     ${elapsed(start)} ${describe(device, bytes)}`));
    log(`     ${elapsed(start)} reads ${lumenAndPercentage(device, lumen)}`);
  }
  listen(device, start, lowerAfter + WATCH_MS + SETTLE_MS);
}

/**
 * Puts the lamp back to its brightness and power, then reads it to check.
 *
 * @param {Lamp} device
 * @param {number} lumen
 * @param {boolean} wasOn
 * @returns {void}
 */
function restore(device, lumen, wasOn) {
  litra.setBrightnessInLumen(device, lumen);
  printDrained(device, "after restore:", drainAll(device, SETTLE_MS));
  if (!wasOn) {
    litra.turnOff(device);
    drainAll(device, SETTLE_MS);
  }
  const reached = readBrightness(device);
  const check = reached === lumen ? "ok" : `FAILED, the lamp is at ${lumenAndPercentage(device, reached)}`;
  log(`  restored to ${lumenAndPercentage(device, lumen)}, ${wasOn ? "on" : "off"}: ${check}`);
}

//* Probes

/**
 * Steps 1 to 4 on one lamp, which it leaves at the brightness and power it had.
 *
 * @param {Lamp} device
 * @param {number} index the lamp's place in the list, from 0
 * @returns {Promise<void>}
 */
async function probe(device, index) {
  log(`\nLamp ${index + 1}: ${litra.getNameForDevice(device)}, serial ${device.serialNumber}`);

  drainAll(device, SETTLE_MS);
  const wasOn = litra.isOn(device);
  const beforeLumen = readBrightness(device);
  log(`  power: ${wasOn ? "on" : "off"}`);
  log(`  before: ${lumenAndPercentage(device, beforeLumen)}`);
  if (!wasOn) {
    litra.turnOn(device);
    drainAll(device, SETTLE_MS);
  }

  log(`  1. set ${TARGET_PERCENTAGE}%, drain 50 ms like the plugin, then read`);
  const start = performance.now();
  litra.setBrightnessPercentage(device, TARGET_PERCENTAGE);
  log(`     drained:   ${describe(device, device.hid.readTimeout(50))}`);
  for (const delay of DELAYS_MS) {
    await sleep(Math.max(0, delay - (performance.now() - start)));
    log(`     ${elapsed(start)} ${describe(device, query(device))}`);
  }
  printDrained(device, "then:      ", drainAll(device, SETTLE_MS));
  restore(device, beforeLumen, true);

  log(`  2. set ${TARGET_PERCENTAGE}%, read without draining`);
  litra.setBrightnessPercentage(device, TARGET_PERCENTAGE);
  log(`     first read: ${describe(device, query(device))}`);
  printDrained(device, "then:      ", drainAll(device, SETTLE_MS));
  restore(device, beforeLumen, true);

  log(`  3. set ${TARGET_PERCENTAGE}%, lower to the minimum after a delay, then read every 250 ms for 3 s`);
  for (const lowerAfter of LOWER_AFTER_MS) {
    log(`     lowering after ${lowerAfter} ms, starting at ${lumenAndPercentage(device, readBrightness(device))}`);
    writeThenLower(device, [{ at: 0, lumen: targetLumen(device) }], lowerAfter);
  }

  probeWithinCap(device);
  restore(device, beforeLumen, wasOn);
}

/**
 * Step 4: whether writes that don't go above the cap can be undone too, and whether writing the cap right after a
 * request above it stops the lamp from going back to its cap later. Only lamps that are capped take part.
 *
 * @param {Lamp} device
 * @returns {void}
 */
function probeWithinCap(device) {
  log(`  4. writes within the cap, each lowered to the minimum after a delay, then read every 250 ms for 3 s`);
  const sent = targetLumen(device);
  const start = performance.now();
  litra.setBrightnessInLumen(device, sent);
  listen(device, start, SETTLE_MS);
  const cap = readBrightness(device);
  // Wait for the lamp to go back to its cap, if it's going to, before the writes that are checked.
  listen(device, start, REVERT_WINDOW_MS);
  if (cap >= sent) {
    log(`     not capped: reached ${lumenAndPercentage(device, cap)}, skipped`);
    return;
  }
  log(`     cap: ${lumenAndPercentage(device, cap)}`);

  const minimum = litra.getMinimumBrightnessInLumenForDevice(device);
  const halfway = Math.round((minimum + cap) / 2);
  const variants = [
    { label: `a. set ${lumenAndPercentage(device, halfway)}, halfway to the cap`, writes: [{ at: 0, lumen: halfway }] },
    { label: "b. set the cap", writes: [{ at: 0, lumen: cap }] },
    {
      label: `c. set ${TARGET_PERCENTAGE}%, then the cap ${CAP_AFTER_MS} ms later`,
      writes: [
        { at: 0, lumen: sent },
        { at: CAP_AFTER_MS, lumen: cap },
      ],
    },
  ];
  for (const { label, writes } of variants) {
    log(`     ${label}`);
    const lastWrite = Math.max(...writes.map((write) => write.at));
    for (const delay of WITHIN_CAP_LOWER_AFTER_MS) {
      litra.setBrightnessInLumen(device, minimum);
      drainAll(device, SETTLE_MS);
      const lowerAfter = lastWrite + delay;
      log(`     lowering after ${lowerAfter} ms, starting at ${lumenAndPercentage(device, readBrightness(device))}`);
      writeThenLower(device, writes, lowerAfter);
    }
  }
}

/**
 * Sets every lamp to the target at once, reads what each reached, then restores them.
 *
 * @param {Lamp[]} devices
 * @returns {Promise<void>}
 */
async function probeTogether(devices) {
  log(`\nAll lamps at once: set ${TARGET_PERCENTAGE}% on every lamp, then read each 1 s later`);
  const saved = devices.map((device, index) => {
    drainAll(device, SETTLE_MS);
    const wasOn = litra.isOn(device);
    const beforeLumen = readBrightness(device);
    // Read again after reopening the lamp, so a lamp that moved after its last restore shows up here.
    log(`  lamp ${index + 1} (${device.serialNumber}) before: ${lumenAndPercentage(device, beforeLumen)}`);
    if (!wasOn) {
      litra.turnOn(device);
      drainAll(device, SETTLE_MS);
    }
    return { device, wasOn, beforeLumen };
  });

  for (const device of devices) {
    litra.setBrightnessPercentage(device, TARGET_PERCENTAGE);
    drainAll(device);
  }
  await sleep(1000);
  for (const [index, device] of devices.entries()) {
    const reached = lumenAndPercentage(device, readBrightness(device));
    log(`  lamp ${index + 1} (${device.serialNumber}): ${reached}`);
  }

  for (const { device, beforeLumen, wasOn } of saved) {
    restore(device, beforeLumen, wasOn);
  }
}

//* Main

console.log(`Probing, writing to ${outFile}`);
log(`brightness-readback, ${startedAt.toISOString()}, target ${TARGET_PERCENTAGE}%`);

const devices = /** @type {Lamp[]} */ (litra.findDevices());
if (devices.length === 0) {
  log("No Litra found.");
}
for (const [index, device] of devices.entries()) {
  try {
    await probe(device, index);
  } catch (error) {
    log(`  failed: ${String(error)}`);
  } finally {
    device.hid.close();
  }
}

if (devices.length > 1) {
  const together = /** @type {Lamp[]} */ (litra.findDevices());
  try {
    await probeTogether(together);
  } catch (error) {
    log(`  failed: ${String(error)}`);
  } finally {
    for (const device of together) {
      device.hid.close();
    }
  }
}

console.log("Done.");
