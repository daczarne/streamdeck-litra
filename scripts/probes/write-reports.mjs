#!/usr/bin/env node
/**
 * Shows what each connected Litra sends after each kind of write, as raw HID reports. Written for #96, to find out
 * whether a lamp ACKs power and temperature writes as it ACKs a brightness write, and whether a report sent before a
 * handle closes reaches the next handle opened on the lamp.
 *
 * For every lamp, in the order findDevices returns them, each write is followed by a second of listening, which logs
 * every report with the time it arrived:
 *   1. Turns the lamp off and on, each twice: once changing its power, once to the power it already has.
 *   2. Sets another temperature twice, the second time to the one it already has, then the temperature it had.
 *   3. Sets the minimum brightness, then the brightness it had, which a capped lamp reached and so keeps.
 *   4. Makes each of those writes, closes the handle straight away without reading, opens the lamp again, and listens on
 *      the new handle.
 * Then it restores the lamp's power, brightness and temperature, and checks them.
 *
 * The results go to out/YYYYMMDD_HHMMSS.txt next to this script, named after the time the run started, so runs can be
 * compared later. The terminal only shows where the file is.
 *
 * Usage: node scripts/probes/write-reports.mjs
 */
import litra from "litra";

import {
  drainAll,
  elapsed,
  listen,
  log,
  lumenAndPercentage,
  outFile,
  readBrightness,
  SETTLE_MS,
  startedAt,
} from "./reports.mjs";

/** @import { Lamp } from "./reports.mjs" */

// How long each write is listened to: longer than the change notice a capped lamp sends about 100 ms after a write.
const LISTEN_MS = 1000;

/**
 * A write to make to a lamp, with how the log names it.
 *
 * @typedef {{ label: string, write: (device: Lamp) => void }} Write
 */

/**
 * What a lamp was at before the probe, which it's put back to.
 *
 * @typedef {{ on: boolean, lumen: number, kelvin: number }} Saved
 */

//* HID

/**
 * Reads the lamp's power, brightness and temperature, after draining what it sent before.
 *
 * @param {Lamp} device
 * @returns {Saved}
 */
function readState(device) {
  drainAll(device, SETTLE_MS);
  const on = litra.isOn(device);
  const kelvin = litra.getTemperatureInKelvin(device);
  const lumen = readBrightness(device);
  return { on, lumen, kelvin };
}

/**
 * Describes a state the way the log writes it.
 *
 * @param {Lamp} device
 * @param {Saved} state
 * @returns {string}
 */
function describeState(device, { on, lumen, kelvin }) {
  return `${on ? "on" : "off"}, ${lumenAndPercentage(device, lumen)}, ${kelvin} K`;
}

/**
 * Makes a write and logs every report the lamp sends in the next second, or that it sent none.
 *
 * @param {Lamp} device
 * @param {Write} write
 * @returns {void}
 */
function writeAndListen(device, { label, write }) {
  drainAll(device, SETTLE_MS);
  log(`     ${label}`);
  const start = performance.now();
  write(device);
  if (listen(device, start, LISTEN_MS) === 0) {
    log(`     ${elapsed(start)} (nothing within ${LISTEN_MS} ms)`);
  }
}

/**
 * Opens the lamp with this serial number again, closing the other lamps that open with it.
 *
 * @param {string} serialNumber
 * @returns {Lamp}
 */
function reopen(serialNumber) {
  let found;
  for (const device of /** @type {Lamp[]} */ (litra.findDevices())) {
    if (device.serialNumber === serialNumber && found === undefined) {
      found = device;
    } else {
      device.hid.close();
    }
  }
  if (found === undefined) {
    throw new Error(`lamp ${serialNumber} not found when reopening it`);
  }
  return found;
}

/**
 * Makes a write, closes the handle straight away, opens the lamp again, and logs every report the new handle gets in
 * the next second, counted from the write.
 *
 * @param {Lamp} device the lamp's open handle, which this closes
 * @param {Write} write
 * @returns {Lamp} the new handle
 */
function writeAndReopen(device, { label, write }) {
  drainAll(device, SETTLE_MS);
  log(`     ${label}, close, reopen`);
  const start = performance.now();
  write(device);
  device.hid.close();
  const reopened = reopen(device.serialNumber);
  log(`     ${elapsed(start)} reopened`);
  if (listen(reopened, start, LISTEN_MS) === 0) {
    log(`     ${elapsed(start)} (nothing within ${LISTEN_MS} ms)`);
  }
  return reopened;
}

//* Probes

/**
 * The writes the probe makes, in order, from a lamp that's on at its saved brightness and temperature.
 *
 * @param {Lamp} device
 * @param {Saved} saved
 * @returns {{ power: Write[], temperature: Write[], brightness: Write[] }}
 */
function writesFor(device, saved) {
  const allowed = litra.getAllowedTemperaturesInKelvinForDevice(device);
  // The far end of the range from the saved temperature, so the change shows on the lamp.
  const other =
    saved.kelvin - (allowed[0] ?? saved.kelvin) > (allowed.at(-1) ?? saved.kelvin) - saved.kelvin
      ? (allowed[0] ?? saved.kelvin)
      : (allowed.at(-1) ?? saved.kelvin);
  const minimum = litra.getMinimumBrightnessInLumenForDevice(device);
  return {
    power: [
      { label: "turn off, from on", write: (lamp) => litra.turnOff(lamp) },
      { label: "turn off, already off", write: (lamp) => litra.turnOff(lamp) },
      { label: "turn on, from off", write: (lamp) => litra.turnOn(lamp) },
      { label: "turn on, already on", write: (lamp) => litra.turnOn(lamp) },
    ],
    temperature: [
      { label: `set ${other} K, from ${saved.kelvin} K`, write: (lamp) => litra.setTemperatureInKelvin(lamp, other) },
      { label: `set ${other} K, already at it`, write: (lamp) => litra.setTemperatureInKelvin(lamp, other) },
      {
        label: `set ${saved.kelvin} K, back`,
        write: (lamp) => litra.setTemperatureInKelvin(lamp, saved.kelvin),
      },
    ],
    brightness: [
      {
        label: `set ${lumenAndPercentage(device, minimum)}, the minimum`,
        write: (lamp) => litra.setBrightnessInLumen(lamp, minimum),
      },
      {
        label: `set ${lumenAndPercentage(device, saved.lumen)}, back`,
        write: (lamp) => litra.setBrightnessInLumen(lamp, saved.lumen),
      },
    ],
  };
}

/**
 * Steps 1 to 4 on one lamp, which it leaves at the power, brightness and temperature it had.
 *
 * @param {Lamp} device
 * @param {number} index the lamp's place in the list, from 0
 * @returns {Lamp} the handle it ends with, which step 4 replaces
 */
function probe(device, index) {
  log(`\nLamp ${index + 1}: ${litra.getNameForDevice(device)}, serial ${device.serialNumber}`);
  const saved = readState(device);
  log(`  before: ${describeState(device, saved)}`);
  if (!saved.on) {
    litra.turnOn(device);
  }
  const writes = writesFor(device, saved);

  log("  1. power");
  for (const write of writes.power) {
    writeAndListen(device, write);
  }
  log("  2. temperature");
  for (const write of writes.temperature) {
    writeAndListen(device, write);
  }
  log("  3. brightness");
  for (const write of writes.brightness) {
    writeAndListen(device, write);
  }

  log("  4. each write, then close the handle and open the lamp again");
  let handle = device;
  // Only the writes that change the lamp, each followed by the one that changes it back.
  for (const write of [
    writes.power[0],
    writes.power[2],
    writes.temperature[0],
    writes.temperature[2],
    ...writes.brightness,
  ]) {
    if (write !== undefined) {
      handle = writeAndReopen(handle, write);
    }
  }

  restore(handle, saved);
  return handle;
}

/**
 * Puts the lamp back to what it was at, then reads it to check.
 *
 * @param {Lamp} device
 * @param {Saved} saved
 * @returns {void}
 */
function restore(device, saved) {
  litra.turnOn(device);
  litra.setTemperatureInKelvin(device, saved.kelvin);
  litra.setBrightnessInLumen(device, saved.lumen);
  if (!saved.on) {
    litra.turnOff(device);
  }
  const reached = readState(device);
  const same = reached.on === saved.on && reached.lumen === saved.lumen && reached.kelvin === saved.kelvin;
  const check = same ? "ok" : `FAILED, the lamp is ${describeState(device, reached)}`;
  log(`  restored to ${describeState(device, saved)}: ${check}`);
}

//* Main

console.log(`Probing, writing to ${outFile}`);
log(`write-reports, ${startedAt.toISOString()}`);

const devices = /** @type {Lamp[]} */ (litra.findDevices());
if (devices.length === 0) {
  log("No Litra found.");
}
// Each lamp in turn, with the others closed, so a reopen opens only the lamp it's for and the others are left as found.
const serialNumbers = devices.map((device) => device.serialNumber);
for (const device of devices) {
  device.hid.close();
}
for (const [index, serialNumber] of serialNumbers.entries()) {
  let handle;
  try {
    handle = reopen(serialNumber);
    handle = probe(handle, index);
  } catch (error) {
    log(`  failed: ${String(error)}`);
  } finally {
    handle?.hid.close();
  }
}

console.log("Done.");
