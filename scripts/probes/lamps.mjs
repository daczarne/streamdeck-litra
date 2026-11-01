/**
 * What the probes share: the file a run writes its results to, reading, naming and logging the HID reports the lamps
 * send, and the run itself, which takes each lamp in turn and puts it back as it was found. Importing it starts the
 * run's file, named after the time the run started.
 */
import { appendFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

import litra from "litra";

/**
 * A lamp as litra finds it, with the HID methods node-hid has at runtime, which litra's type leaves out.
 *
 * @typedef {import("litra").Device & { hid: { readTimeout(timeoutMs: number): number[], close(): void } }} Lamp
 */

// The lamp sends a change notice about 100 ms after a write, so a drain that should leave the buffer empty waits
// longer than that for silence.
export const SETTLE_MS = 300;

// A capped lamp goes back to its cap up to 1.25 s after a request above it, so a write meant to stay waits longer.
export const REVERT_WINDOW_MS = 2000;

// How long a watch reads a lamp after a write, and how often.
const WATCH_MS = 3000;
const WATCH_INTERVAL_MS = 250;

/**
 * What a lamp is at: its power, brightness and temperature.
 *
 * @typedef {{ on: boolean, lumen: number, kelvin: number }} State
 */

//* Output

/**
 * The time a run started, as the name of its file: YYYYMMDD_HHMMSS, in local time.
 *
 * @param {Date} date
 * @returns {string}
 */
function timestamp(date) {
  const pad = (/** @type {number} */ value) => String(value).padStart(2, "0");
  const day = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const time = `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  return `${day}_${time}`;
}

export const startedAt = new Date();
const outDir = fileURLToPath(new URL("out/", import.meta.url));
export const outFile = `${outDir}${timestamp(startedAt)}.txt`;
mkdirSync(outDir, { recursive: true });

/**
 * Appends a line to the run's file as soon as it's known, so a run that crashes keeps what it found.
 *
 * @param {string} line
 * @returns {void}
 */
export function log(line) {
  appendFileSync(outFile, `${line}\n`);
}

//* Reports

/**
 * Where the lamp's features sit among its HID features, which differs on the Beam LX.
 *
 * @param {Lamp} device
 * @returns {number}
 */
export function featureIndex(device) {
  return device.type === litra.DeviceType.LitraBeamLX ? 0x06 : 0x04;
}

/**
 * The first 8 bytes of a report in hex, which is where every report the probes read keeps its data. A byte the report
 * is too short to hold shows as `--`.
 *
 * @param {Array<number | undefined>} bytes
 * @returns {string}
 */
export function hex(bytes) {
  return bytes
    .slice(0, 8)
    .map((byte) => (byte === undefined ? "--" : byte.toString(16).padStart(2, "0")))
    .join(" ");
}

/**
 * The two bytes at `index` as one number, high byte first, as the lamps send a brightness or a temperature. Undefined
 * when the report is too short to hold them.
 *
 * @param {number[]} bytes
 * @param {number} index
 * @returns {number | undefined}
 */
export function word(bytes, index) {
  const high = bytes[index];
  const low = bytes[index + 1];
  return high === undefined || low === undefined ? undefined : high * 256 + low;
}

/**
 * A brightness in lumens, with its place in the lamp's range.
 *
 * @param {Lamp} device
 * @param {number} lumen
 * @returns {string}
 */
export function lumenAndPercentage(device, lumen) {
  const min = litra.getMinimumBrightnessInLumenForDevice(device);
  const max = litra.getMaximumBrightnessInLumenForDevice(device);
  const percentage = Math.max(0, Math.min(100, Math.round(((lumen - min) / (max - min)) * 100)));
  return `${lumen} lm (${percentage}%)`;
}

/**
 * The brightness a report holds at `index`, with its place in the lamp's range.
 *
 * @param {Lamp} device
 * @param {number[]} bytes
 * @param {number} index
 * @returns {string}
 */
function lumenIn(device, bytes, index) {
  const lumen = word(bytes, index);
  return lumen === undefined ? "(report too short)" : lumenAndPercentage(device, lumen);
}

/**
 * Names a report and decodes its value, by the function in its byte 3. Each kind keeps its value in different bytes,
 * and a function the probes haven't seen yet shows as `other`, with its byte.
 *
 * @param {Lamp} device
 * @param {number[]} bytes a report, or [] for none
 * @returns {string}
 */
export function describe(device, bytes) {
  if (bytes.length === 0) {
    return "(nothing)";
  }
  if (bytes[2] === 0xff) {
    return `${hex(bytes)}  error report: code 0x${hex([bytes[5]])} for function 0x${hex([bytes[4]])}`;
  }
  switch (bytes[3]) {
    case 0x01:
      return `${hex(bytes)}  power reply: ${bytes[4] === undefined ? "(report too short)" : bytes[4] === 1 ? "on" : "off"}`;
    case 0x1c:
      return `${hex(bytes)}  set-power ACK`;
    case 0x31:
      return `${hex(bytes)}  brightness reply: ${lumenIn(device, bytes, 4)}`;
    case 0x40:
      return `${hex(bytes)}  change notice: ${lumenIn(device, bytes, 5)}`;
    case 0x4c:
      return `${hex(bytes)}  set-brightness ACK`;
    case 0x81:
      return `${hex(bytes)}  temperature reply: ${word(bytes, 4) ?? "(report too short)"} K`;
    case 0x9c:
      return `${hex(bytes)}  set-temperature ACK`;
    default:
      return `${hex(bytes)}  other (function 0x${hex([bytes[3]])})`;
  }
}

//* HID

/**
 * Sends the get-brightness query and skips every other report until the reply arrives, passing them to `onSkipped`.
 *
 * @param {Lamp} device
 * @param {(bytes: number[]) => void} [onSkipped]
 * @returns {number} the brightness, in lumens
 */
export function readBrightness(device, onSkipped = () => {}) {
  device.hid.write([0x11, 0xff, featureIndex(device), 0x31, ...Array(16).fill(0)]);
  for (;;) {
    const bytes = device.hid.readTimeout(1000);
    if (bytes.length === 0) {
      throw new Error("no brightness reply within 1 s");
    }
    const lumen = word(bytes, 4);
    // A report too short to hold the brightness can't be the reply, whatever its header says.
    if (bytes[2] !== 0xff && bytes[3] === 0x31 && lumen !== undefined) {
      return lumen;
    }
    onSkipped(bytes);
  }
}

/**
 * The time since `start`, padded so the log's columns line up.
 *
 * @param {number} start a time from `performance.now()`
 * @returns {string}
 */
export function elapsed(start) {
  return `+${String(Math.round(performance.now() - start)).padStart(4)} ms:`;
}

/**
 * Logs every report the lamp sends until `untilMs` after `start`, with the time it arrived.
 *
 * @param {Lamp} device
 * @param {number} start a time from `performance.now()`
 * @param {number} untilMs
 * @returns {number} how many reports arrived
 */
export function listen(device, start, untilMs) {
  let count = 0;
  for (;;) {
    const remaining = untilMs - (performance.now() - start);
    if (remaining <= 0) {
      return count;
    }
    const bytes = device.hid.readTimeout(Math.ceil(remaining));
    if (bytes.length > 0) {
      count += 1;
      log(`     ${elapsed(start)} ${describe(device, bytes)}`);
    }
  }
}

/**
 * Reads every pending report until the lamp has been silent for `quietMs`.
 *
 * @param {Lamp} device
 * @param {number} [quietMs]
 * @returns {number[][]} the reports read
 */
export function drainAll(device, quietMs = 50) {
  const drained = [];
  for (;;) {
    const bytes = device.hid.readTimeout(quietMs);
    if (bytes.length === 0) {
      return drained;
    }
    drained.push(bytes);
  }
}

/**
 * Logs the reports a drain read, each after a label.
 *
 * @param {Lamp} device
 * @param {string} label
 * @param {number[][]} reports
 * @returns {void}
 */
export function printDrained(device, label, reports) {
  for (const bytes of reports) {
    log(`     ${label} ${describe(device, bytes)}`);
  }
}

/**
 * Reads the lamp every 250 ms for 3 s from `fromMs`, logging every report with the time it arrived, counted from
 * `start`.
 *
 * @param {Lamp} device
 * @param {number} start a time from `performance.now()`
 * @param {number} fromMs
 * @returns {number[]} every brightness read, in lumens
 */
export function watch(device, start, fromMs) {
  const reads = [];
  for (let tick = fromMs + WATCH_INTERVAL_MS; tick <= fromMs + WATCH_MS; tick += WATCH_INTERVAL_MS) {
    listen(device, start, tick);
    const lumen = readBrightness(device, (bytes) => log(`     ${elapsed(start)} ${describe(device, bytes)}`));
    log(`     ${elapsed(start)} reads ${lumenAndPercentage(device, lumen)}`);
    reads.push(lumen);
  }
  return reads;
}

//* State

/**
 * Reads the lamp's power, brightness and temperature, after draining what it sent before.
 *
 * @param {Lamp} device
 * @returns {State}
 */
export function readState(device) {
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
 * @param {State} state
 * @returns {string}
 */
export function describeState(device, { on, lumen, kelvin }) {
  return `${on ? "on" : "off"}, ${lumenAndPercentage(device, lumen)}, ${kelvin} K`;
}

/**
 * Puts the lamp back to a state, then reads it to check.
 *
 * @param {Lamp} device
 * @param {State} state
 * @returns {void}
 */
export function restore(device, state) {
  litra.turnOn(device);
  litra.setTemperatureInKelvin(device, state.kelvin);
  litra.setBrightnessInLumen(device, state.lumen);
  if (!state.on) {
    litra.turnOff(device);
  }
  const reached = readState(device);
  const same = reached.on === state.on && reached.lumen === state.lumen && reached.kelvin === state.kelvin;
  const check = same ? "ok" : `FAILED, the lamp is ${describeState(device, reached)}`;
  log(`  restored to ${describeState(device, state)}: ${check}`);
}

//* Run

/**
 * Opens the lamp with this serial number again, closing the other lamps that open with it.
 *
 * @param {string} serialNumber
 * @returns {Lamp}
 */
export function reopen(serialNumber) {
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
 * Starts the run, then probes each lamp in turn, in the order findDevices returns them, with the others closed, so no
 * other lamp's reports mix with its own. Each lamp is turned on before its probe, and put back afterwards to the
 * state it was found in, even when its probe fails.
 *
 * @param {string} name the probe's name, and anything else that heads the run's file, before the time it started
 * @param {(device: Lamp, before: State) => Lamp | void | Promise<Lamp | void>} probe given the lamp's handle and the
 *   state it was found in, and returns the handle it ends with, when it opened the lamp again
 * @returns {Promise<number>} how many lamps were found
 */
export async function forEachLamp(name, probe) {
  console.log(`Probing, writing to ${outFile}`);
  log(`${name}, ${startedAt.toISOString()}`);

  const devices = /** @type {Lamp[]} */ (litra.findDevices());
  if (devices.length === 0) {
    log("No Litra found.");
  }
  const serialNumbers = devices.map((device) => device.serialNumber);
  for (const device of devices) {
    device.hid.close();
  }

  for (const [index, serialNumber] of serialNumbers.entries()) {
    let handle;
    try {
      handle = reopen(serialNumber);
      log(`\nLamp ${index + 1}: ${litra.getNameForDevice(handle)}, serial ${serialNumber}`);
      const before = readState(handle);
      log(`  before: ${describeState(handle, before)}`);
      if (!before.on) {
        litra.turnOn(handle);
        drainAll(handle, SETTLE_MS);
      }
      try {
        handle = (await probe(handle, before)) ?? handle;
      } catch (error) {
        log(`  failed: ${String(error)}`);
      }
      restore(handle, before);
    } catch (error) {
      log(`  failed: ${String(error)}`);
    } finally {
      handle?.hid.close();
    }
  }
  return devices.length;
}
