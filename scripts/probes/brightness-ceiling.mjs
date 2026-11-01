#!/usr/bin/env node
/**
 * Finds out whether a capped Litra can hold more when stepped up to it than the cap it stops at when sent more. Written
 * for #164, where a Beam reached 326 lm, then stopped at 324 lm when sent more, so the plugin learned a cap of 324 lm.
 *
 * For every lamp, in the order findDevices returns them:
 *   1. From its minimum, sends its maximum, and reads the brightness it stops at, as the plugin learns a cap. A lamp
 *      that reaches its maximum isn't capped, and skips the other steps.
 *   2. Steps up 1 lm at a time, from a little below that cap, until the lamp reaches less than it was sent, and reads
 *      where it stopped. Done twice, to see whether the lamp stops at the same place.
 *   3. Sends its maximum again, waits until it can no longer go back to its cap, then sends the most it held in step 2,
 *      and reads it for a few seconds, to see whether it holds it after being capped.
 *   4. From a little below the cap, sends the most it held in step 2, and reads it for a few seconds, to see whether it
 *      holds it when it wasn't just capped.
 * Then it restores the lamp's brightness and power, and checks it.
 *
 * The results go to out/YYYYMMDD_HHMMSS.txt next to this script, as with brightness-readback.mjs. The terminal only
 * shows where the file is.
 *
 * Usage: node scripts/probes/brightness-ceiling.mjs
 */
import litra from "litra";

import {
  drainAll,
  elapsed,
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

// How far below the cap each climb starts, and how many climbs there are.
const CLIMB_FROM_BELOW_LM = 20;
const CLIMBS = 2;
const WATCH_MS = 3000;
const WATCH_INTERVAL_MS = 250;

// A capped lamp goes back to its cap up to 1.25 s after a request above it, so a write meant to stay waits longer.
const REVERT_WINDOW_MS = 2000;

//* HID

/**
 * Sends a brightness, waits for the lamp to settle, and reads what it reached.
 *
 * @param {Lamp} device
 * @param {number} lumen
 * @returns {number} the brightness reached, in lumens
 */
function setAndRead(device, lumen) {
  litra.setBrightnessInLumen(device, lumen);
  drainAll(device, SETTLE_MS);
  return readBrightness(device);
}

/**
 * Sends a brightness, then reads the lamp every 250 ms for 3 s, logging every report with the time it arrived.
 *
 * @param {Lamp} device
 * @param {number} lumen
 * @returns {number[]} every brightness read
 */
function setAndWatch(device, lumen) {
  const start = performance.now();
  litra.setBrightnessInLumen(device, lumen);
  log(`     ${elapsed(start)} set ${lumenAndPercentage(device, lumen)}`);
  const reads = [];
  for (let tick = WATCH_INTERVAL_MS; tick <= WATCH_MS; tick += WATCH_INTERVAL_MS) {
    listen(device, start, tick);
    const reached = readBrightness(device, () => {});
    reads.push(reached);
    log(`     ${elapsed(start)} reads ${lumenAndPercentage(device, reached)}`);
  }
  return reads;
}

/**
 * Waits until the lamp can no longer go back to its cap, logging what it sends meanwhile, then reads it.
 *
 * @param {Lamp} device
 * @returns {number} the brightness, in lumens
 */
function afterRevertWindow(device) {
  listen(device, performance.now(), REVERT_WINDOW_MS);
  return readBrightness(device);
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
 * Steps up 1 lm at a time from `from` until the lamp reaches less than it was sent, or its maximum.
 *
 * @param {Lamp} device
 * @param {number} from in lumens
 * @returns {number} the most the lamp held, in lumens
 */
function climb(device, from) {
  const maximum = litra.getMaximumBrightnessInLumenForDevice(device);
  log(`     from ${lumenAndPercentage(device, setAndRead(device, from))}`);
  let held = from;
  for (let sent = from + 1; sent <= maximum; sent += 1) {
    const reached = setAndRead(device, sent);
    log(`     sent ${sent} lm, reached ${lumenAndPercentage(device, reached)}`);
    if (reached < sent) {
      log(
        `     stopped: held ${lumenAndPercentage(device, held)}, then stopped at ${lumenAndPercentage(device, reached)}`,
      );
      log(`     after the window: ${lumenAndPercentage(device, afterRevertWindow(device))}`);
      return held;
    }
    held = reached;
  }
  log(`     reached the maximum without stopping`);
  return held;
}

/**
 * Steps 1 to 4 on one lamp, which it leaves at the brightness and power it had.
 *
 * @param {Lamp} device
 * @param {number} index the lamp's place in the list, from 0
 * @returns {void}
 */
function probe(device, index) {
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

  try {
    const minimum = litra.getMinimumBrightnessInLumenForDevice(device);
    const maximum = litra.getMaximumBrightnessInLumenForDevice(device);

    log(`  1. from the minimum, send the maximum, ${lumenAndPercentage(device, maximum)}`);
    setAndRead(device, minimum);
    const cap = setAndRead(device, maximum);
    log(`     stopped at ${lumenAndPercentage(device, cap)}`);
    log(`     after the window: ${lumenAndPercentage(device, afterRevertWindow(device))}`);
    if (cap >= maximum) {
      log("     not capped, skipped");
      return;
    }

    const from = Math.max(minimum, cap - CLIMB_FROM_BELOW_LM);
    let highest = cap;
    for (let run = 1; run <= CLIMBS; run += 1) {
      log(`  2. climb ${run} of ${CLIMBS}, 1 lm at a time`);
      highest = Math.max(highest, climb(device, from));
    }

    log(
      `  3. send the maximum, wait out the window, then send the most it held, ${lumenAndPercentage(device, highest)}`,
    );
    log(`     the maximum stopped at ${lumenAndPercentage(device, setAndRead(device, maximum))}`);
    log(`     after the window: ${lumenAndPercentage(device, afterRevertWindow(device))}`);
    const afterCap = setAndWatch(device, highest);
    log(`     ${afterCap.every((reached) => reached === highest) ? "held it" : "didn't hold it"}`);

    log(`  4. from ${lumenAndPercentage(device, from)}, send the most it held, ${lumenAndPercentage(device, highest)}`);
    setAndRead(device, from);
    const fromBelow = setAndWatch(device, highest);
    log(`     ${fromBelow.every((reached) => reached === highest) ? "held it" : "didn't hold it"}`);
  } finally {
    restore(device, beforeLumen, wasOn);
  }
}

//* Main

console.log(`Probing, writing to ${outFile}`);
log(`brightness-ceiling, ${startedAt.toISOString()}`);

const devices = /** @type {Lamp[]} */ (litra.findDevices());
if (devices.length === 0) {
  log("No Litra found.");
}
for (const [index, device] of devices.entries()) {
  try {
    probe(device, index);
  } catch (error) {
    log(`  failed: ${String(error)}`);
  } finally {
    device.hid.close();
  }
}

console.log("Done.");
