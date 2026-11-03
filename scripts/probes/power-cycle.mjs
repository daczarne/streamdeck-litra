#!/usr/bin/env node
/**
 * Turns each connected Litra off and on, and reads its power, brightness and temperature after each step. Written for
 * #100, where a Beam LX blinked by the plugin, which only turns a lamp off and back on, came back at its minimum
 * brightness and temperature, while the Beams came back as they were.
 *
 * For every lamp, in the order findDevices returns them, from a lamp that's on:
 *   1. Sets the middle of its brightness and temperature ranges.
 *   2. Turns it on, though it's already on.
 *   3. Turns it off.
 *   4. Turns it on.
 *   5. Sets a quarter of each range, then turns it off and on: whether it comes back at its minimum, at what step 1
 *      set, or at what it was just set to.
 *   6. Turns it off, sets the middle of each range while it's off, then turns it on: whether a write made while it's
 *      off holds.
 *   7. Sets a new setting, turns it off, and turns it on again after a while, for several whiles, some shorter than the
 *      lamp's fade out, which takes about 750 ms, as the plugin's blink does: whether a lamp turned on before its fade
 *      ends comes back at the setting it had, or at an older one. The first while outlasts the fade, so the lamp starts
 *      from a known setting.
 *   8. Twice, leaves the lamp off past its fade, sets a new setting while it's off, and turns it on: the first time
 *      reading it every 50 ms from the moment it's on, to see when a lamp that goes back to another setting shows it;
 *      the second time sending the new setting again as soon as it's on, then reading it the same way, to see whether
 *      a write made straight away holds.
 * Each write is followed by a second of listening, which logs every report with the time it arrived. The lamp is then
 * put back as it was found, as every probe's is (see lamps.mjs), and the results go to the run's file.
 *
 * Usage: node scripts/probes/power-cycle.mjs
 */
import litra from "litra";

import {
  describeState,
  drainAll,
  elapsed,
  featureIndex,
  forEachLamp,
  listen,
  log,
  lumenAndPercentage,
  readBrightness,
  readState,
  SETTLE_MS,
  word,
} from "./lamps.mjs";

/** @import { Lamp } from "./lamps.mjs" */

// How long each write is listened to: longer than the change notice a capped lamp sends about 100 ms after a write.
const LISTEN_MS = 1000;

// How long step 7 leaves the lamp off each time, in order, each with the setting it sets first, as a place in the
// lamp's ranges. The plugin's blink lasts 400 ms by default, out of the 300 to 1500 it takes. Each setting differs
// from the others, and stays below the lowest cap measured on a hub, 244 lm, so the lamp reaches it.
const OFF_FOR = [
  { ms: 1500, fraction: 0.5 },
  { ms: 400, fraction: 0.25 },
  { ms: 100, fraction: 0.4 },
  { ms: 750, fraction: 0.1 },
  { ms: 1000, fraction: 0.3 },
];

// How long step 8 reads a lamp after turning it on, and how often.
const READ_MS = 1000;
const READ_INTERVAL_MS = 50;

/**
 * A brightness and a temperature to set a lamp to.
 *
 * @typedef {{ lumen: number, kelvin: number }} Setting
 */

//* HID

/**
 * The brightness and the allowed temperature at the same place in the lamp's two ranges.
 *
 * @param {Lamp} device
 * @param {number} fraction from 0, the minimum, to 1, the maximum
 * @returns {Setting}
 */
function settingAt(device, fraction) {
  const min = litra.getMinimumBrightnessInLumenForDevice(device);
  const max = litra.getMaximumBrightnessInLumenForDevice(device);
  const allowed = litra.getAllowedTemperaturesInKelvinForDevice(device);
  const kelvin = allowed[Math.round((allowed.length - 1) * fraction)];
  if (kelvin === undefined) {
    throw new Error("the lamp allows no temperature");
  }
  return { lumen: Math.round(min + (max - min) * fraction), kelvin };
}

/**
 * Sets a lamp's temperature, then its brightness.
 *
 * @param {Lamp} device
 * @param {Setting} setting
 * @returns {void}
 */
function set(device, { lumen, kelvin }) {
  litra.setTemperatureInKelvin(device, kelvin);
  litra.setBrightnessInLumen(device, lumen);
}

/**
 * Makes the writes, logs every report the lamp sends in the next second, then reads its state and logs it.
 *
 * @param {Lamp} device
 * @param {string} label
 * @param {(device: Lamp) => void} write
 * @returns {void}
 */
function writeAndRead(device, label, write) {
  drainAll(device, SETTLE_MS);
  log(`     ${label}`);
  const start = performance.now();
  write(device);
  if (listen(device, start, LISTEN_MS) === 0) {
    log(`     ${elapsed(start)} (nothing within ${LISTEN_MS} ms)`);
  }
  try {
    log(`     reads ${describeState(device, readState(device))}`);
  } catch (error) {
    log(`     read failed: ${String(error)}`);
  }
}

/**
 * Turns the lamp off, then on again `offMs` later, then logs every report it sends in the next second, and its state.
 *
 * @param {Lamp} device
 * @param {number} offMs
 * @returns {Promise<void>}
 */
async function offFor(device, offMs) {
  drainAll(device, SETTLE_MS);
  log(`     turn off, and on again ${offMs} ms later`);
  litra.turnOff(device);
  const off = performance.now();
  await new Promise((resolve) => setTimeout(resolve, offMs));
  litra.turnOn(device);
  log(`     ${elapsed(off)} turned on`);
  if (listen(device, off, offMs + LISTEN_MS) === 0) {
    log(`     ${elapsed(off)} (nothing within ${LISTEN_MS} ms of turning on)`);
  }
  try {
    log(`     reads ${describeState(device, readState(device))}`);
  } catch (error) {
    log(`     read failed: ${String(error)}`);
  }
}

/**
 * Sends the get-temperature query and skips every other report until the reply arrives, as `readBrightness` does for
 * the brightness, since litra's own read takes the first report, which may be an ACK.
 *
 * @param {Lamp} device
 * @returns {number} the temperature, in kelvin
 */
function readTemperature(device) {
  device.hid.write([0x11, 0xff, featureIndex(device), 0x81, ...Array(16).fill(0)]);
  for (;;) {
    const bytes = device.hid.readTimeout(1000);
    if (bytes.length === 0) {
      throw new Error("no temperature reply within 1 s");
    }
    const kelvin = word(bytes, 4);
    if (bytes[2] !== 0xff && bytes[3] === 0x81 && kelvin !== undefined) {
      return kelvin;
    }
  }
}

/**
 * Reads the lamp's temperature and brightness every 50 ms for a second from `start`, and logs each read, with the time
 * it was made, and each change from the read before.
 *
 * @param {Lamp} device
 * @param {number} start a time from `performance.now()`
 * @returns {Promise<void>}
 */
async function readEvery(device, start) {
  let last = "";
  for (let tick = 0; tick <= READ_MS; tick += READ_INTERVAL_MS) {
    const wait = tick - (performance.now() - start);
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    const read = `${lumenAndPercentage(device, readBrightness(device))}, ${readTemperature(device)} K`;
    if (read !== last) {
      log(`     ${elapsed(start)} reads ${read}`);
      last = read;
    }
  }
  log(`     ${elapsed(start)} reads the same until then`);
}

/**
 * Leaves the lamp off past its fade, sets a setting while it's off, turns it on, sends the setting again when asked
 * to, and reads it every 50 ms.
 *
 * @param {Lamp} device
 * @param {Setting} setting
 * @param {boolean} sendAgain
 * @returns {Promise<void>}
 */
async function turnOnFrom(device, setting, sendAgain) {
  litra.turnOff(device);
  await new Promise((resolve) => setTimeout(resolve, OFF_FOR[0]?.ms ?? 1500));
  set(device, setting);
  drainAll(device, SETTLE_MS);
  const then = sendAgain ? "turn on and set it again" : "turn on";
  log(`     set ${setting.lumen} lm, ${setting.kelvin} K while off, then ${then}`);
  const start = performance.now();
  litra.turnOn(device);
  if (sendAgain) {
    set(device, setting);
  }
  await readEvery(device, start);
}

//* Probes

/**
 * Steps 1 to 8 on one lamp, which is on.
 *
 * @param {Lamp} device
 * @returns {Promise<void>}
 */
async function probe(device) {
  const middle = settingAt(device, 0.5);
  const quarter = settingAt(device, 0.25);
  const named = (/** @type {Setting} */ { lumen, kelvin }) => `${lumen} lm, ${kelvin} K`;

  log("  1. the middle of each range");
  writeAndRead(device, `set ${named(middle)}`, (lamp) => set(lamp, middle));
  log("  2. turn on, already on");
  writeAndRead(device, "turn on", (lamp) => litra.turnOn(lamp));
  log("  3. turn off");
  writeAndRead(device, "turn off", (lamp) => litra.turnOff(lamp));
  log("  4. turn on, from off");
  writeAndRead(device, "turn on", (lamp) => litra.turnOn(lamp));
  log("  5. another setting, then off and on");
  writeAndRead(device, `set ${named(quarter)}`, (lamp) => set(lamp, quarter));
  writeAndRead(device, "turn off", (lamp) => litra.turnOff(lamp));
  writeAndRead(device, "turn on", (lamp) => litra.turnOn(lamp));
  log("  6. a setting written while off");
  writeAndRead(device, "turn off", (lamp) => litra.turnOff(lamp));
  writeAndRead(device, `set ${named(middle)}, while off`, (lamp) => set(lamp, middle));
  writeAndRead(device, "turn on", (lamp) => litra.turnOn(lamp));
  log("  7. off for a while, shorter than the fade or not");
  for (const { ms, fraction } of OFF_FOR) {
    const setting = settingAt(device, fraction);
    writeAndRead(device, `set ${named(setting)}`, (lamp) => set(lamp, setting));
    await offFor(device, ms);
  }
  log("  8. turn on, from a setting written while off");
  await turnOnFrom(device, settingAt(device, 0.5), false);
  await turnOnFrom(device, settingAt(device, 0.25), true);
}

//* Main

await forEachLamp("power-cycle", probe);
console.log("Done.");
