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
 * The lamp is then put back as it was found, as every probe's is (see lamps.mjs), and the results go to the run's file.
 *
 * Usage: node scripts/probes/write-reports.mjs
 */
import litra from "litra";

import { drainAll, elapsed, forEachLamp, listen, log, lumenAndPercentage, reopen, SETTLE_MS } from "./lamps.mjs";

/** @import { Lamp, State } from "./lamps.mjs" */

// How long each write is listened to: longer than the change notice a capped lamp sends about 100 ms after a write.
const LISTEN_MS = 1000;

/**
 * A write to make to a lamp, with how the log names it.
 *
 * @typedef {{ label: string, write: (device: Lamp) => void }} Write
 */

//* HID

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
 * @param {State} saved
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
 * Steps 1 to 4 on one lamp, which is on.
 *
 * @param {Lamp} device
 * @param {State} before what the lamp was at
 * @returns {Lamp} the handle it ends with, which step 4 replaces
 */
function probe(device, before) {
  const writes = writesFor(device, before);

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

  return handle;
}

//* Main

await forEachLamp("write-reports", probe);
console.log("Done.");
