/**
 * What the probes share: the file a run writes its results to, and reading, naming and logging the HID reports the
 * lamps send. Importing it starts the run's file, named after the time the run started.
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
