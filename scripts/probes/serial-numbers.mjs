#!/usr/bin/env node
/**
 * Asks each connected Litra for the serial number it keeps itself, over HID++, and compares it with the one its USB
 * descriptor gives, which litra finds it with. Written for #170, to find out whether a Beam LX, whose descriptor gives
 * none, has a serial number the plugin can tell it apart by.
 *
 * For every lamp, in the order findDevices returns them:
 *   1. Asks the Root feature for the index and version of Device Information (feature 0x0003).
 *   2. Reads Device Information's function 0: how many firmware entities the lamp has, its unit id, its model ids, and
 *      whether it has a serial number to give.
 *   3. Reads function 1 for each firmware entity: its type, name and version.
 *   4. Reads function 2: the serial number, compared with the descriptor's.
 * It only reads, so unlike the other probes it leaves the lamps as they are, and doesn't go through `forEachLamp`.
 *
 * Usage: node scripts/probes/serial-numbers.mjs
 */
import litra from "litra";

import { hex, log, outFile, startedAt } from "./lamps.mjs";

/** @import { Lamp } from "./lamps.mjs" */

const ROOT_INDEX = 0x00;
const DEVICE_INFORMATION = 0x0003;
// The software id in the low nibble of byte 3, which the lamp sends back in its reply, as litra's queries carry it.
const SOFTWARE_ID = 0x1;
const ERROR = 0xff;
// The lamps answer within a few ms.
const REPLY_TIMEOUT_MS = 500;
const MAX_SKIPPED_REPORTS = 10;

/**
 * Sends a HID++ request, and returns its reply, skipping the reports that aren't it.
 *
 * @param {Lamp} device
 * @param {number} featureIndex
 * @param {number} fn
 * @param {number[]} [parameters]
 * @returns {number[]} the whole reply
 */
function request(device, featureIndex, fn, parameters = []) {
  const operation = (fn << 4) | SOFTWARE_ID;
  const report = [0x11, 0xff, featureIndex, operation, ...parameters];
  device.hid.write([...report, ...Array(20 - report.length).fill(0)]);
  for (let skipped = 0; skipped <= MAX_SKIPPED_REPORTS; skipped += 1) {
    const reply = device.hid.readTimeout(REPLY_TIMEOUT_MS);
    if (reply.length === 0) {
      throw new Error(`no reply to function ${fn} of feature index ${featureIndex}`);
    }
    if (reply[2] === featureIndex && reply[3] === operation) {
      return reply;
    }
    if (reply[2] === ERROR && reply[3] === featureIndex && reply[4] === operation) {
      throw new Error(`error ${reply[5]} for function ${fn} of feature index ${featureIndex}`);
    }
  }
  throw new Error(`no reply to function ${fn} of feature index ${featureIndex} among ${MAX_SKIPPED_REPORTS} reports`);
}

/**
 * Bytes as ASCII, without the zeros that pad them.
 *
 * @param {number[]} bytes
 * @returns {string}
 */
function ascii(bytes) {
  return String.fromCharCode(...bytes).replace(/\0+$/, "");
}

/**
 * Reads what Device Information tells about a lamp, and logs it.
 *
 * @param {Lamp} device
 * @returns {void}
 */
function probe(device) {
  const root = request(device, ROOT_INDEX, 0, [DEVICE_INFORMATION >> 8, DEVICE_INFORMATION & 0xff]);
  const index = root[4] ?? 0;
  log(`  Device Information: index ${index}, version ${root[6]}`);
  if (index === ROOT_INDEX) {
    log("  no Device Information feature");
    return;
  }

  const info = request(device, index, 0);
  const entities = info[4] ?? 0;
  const capabilities = info[18] ?? 0;
  log(`  device info: ${hex(info.slice(4, 12))} ${hex(info.slice(12, 20))}`);
  log(`    entities ${entities}, unit id ${hex(info.slice(5, 9))}, transport ${hex(info.slice(9, 11))}`);
  log(`    model ids ${hex(info.slice(11, 17))}, serial number to give: ${capabilities & 1 ? "yes" : "no"}`);

  for (let entity = 0; entity < entities; entity += 1) {
    const firmware = request(device, index, 1, [entity]);
    const version = `${firmware[8]?.toString(16)}.${firmware[9]?.toString(16)}`;
    const name = ascii(firmware.slice(5, 8)).trim() || "(none)";
    log(`  firmware ${entity}: type ${firmware[4]}, ${name} ${version}, build ${hex(firmware.slice(10, 12))}`);
  }

  const serialNumber = ascii(request(device, index, 2).slice(4, 16));
  const descriptor = device.serialNumber;
  const compared = descriptor === "" ? "the descriptor gives none" : descriptor === serialNumber ? "same" : "DIFFERENT";
  log(`  serial number: ${serialNumber} (USB descriptor: ${descriptor || '""'}, ${compared})`);
}

console.log(`Probing, writing to ${outFile}`);
log(`serial-numbers.mjs, ${startedAt.toISOString()}`);

const devices = /** @type {Lamp[]} */ (litra.findDevices());
if (devices.length === 0) {
  log("No Litra found.");
}
for (const [number, device] of devices.entries()) {
  log(`\nLamp ${number + 1}: ${litra.getNameForDevice(device)}`);
  try {
    probe(device);
  } catch (error) {
    log(`  failed: ${String(error)}`);
  } finally {
    device.hid.close();
  }
}
