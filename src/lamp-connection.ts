/**
 * The only module that imports `litra` (#198). It finds the lamps connected, and opens each one as a `LampConnection`,
 * which gives what the plugin needs from a lamp over HID: `litra`'s commands, and the reads the plugin makes itself
 * where `litra` falls short, such as a brightness above 255 lm and a Beam LX's serial number. Nothing outside it sees
 * `litra`'s types, so whatever lies under it can change without touching the rest of the plugin.
 */

import {
  type Device,
  DeviceType,
  findDevices,
  getAllowedTemperaturesInKelvinForDevice,
  getMaximumBrightnessInLumenForDevice,
  getMinimumBrightnessInLumenForDevice,
  getTemperatureInKelvin,
  isOn,
  setBrightnessInLumen,
  setTemperatureInKelvin,
  turnOff,
  turnOn,
} from "litra";

import { Lamp } from "./lamp";
import { logger as pluginLogger } from "./logging";

/** What a lamp can be set to: its brightness, from its dimmest to its brightest, in lumens, and its temperatures. */
export type LampRange = {
  readonly minLumen: number;
  readonly maxLumen: number;
  readonly allowedKelvin: readonly number[];
};

/**
 * A lamp opened for one operation, as a `Lamp` acts on it (#198): what it reads from the lamp and writes to it, with
 * the path it's plugged in at, and its range. A `LampConnection` is one, and a `Lamp`'s tests give it a fake one.
 */
export type LampHandle = {
  readonly path: string;
  readonly range: LampRange;
  isOn(): boolean;
  switchPower(on: boolean): void;
  readBrightness(): number;
  writeBrightness(lumen: number): void;
  readTemperature(): number;
  writeTemperature(kelvin: number): void;
};

/** The methods of a lamp's HID handle that node-hid has at runtime, and litra's type leaves out. */
type ClosableHid = {
  write: (values: number[] | Buffer) => number;
  readSync: () => number[];
  readTimeout: (timeout: number) => number[];
  close: () => void;
  getDeviceInfo: () => { path?: string | undefined };
};

const logger = pluginLogger.createScope("Lamps");

// litra names each model "Logitech Litra …", too long for the touch strip.
const MODEL_BY_DEVICE_TYPE: Record<DeviceType, string> = {
  [DeviceType.LitraGlow]: "Glow",
  [DeviceType.LitraBeam]: "Beam",
  [DeviceType.LitraBeamLX]: "Beam LX",
};

// Reports a lamp sends unasked (ACKs, change notices, error reports) can arrive ahead of the reply to a query.
const MAX_SKIPPED_REPORTS = 10;

// HID++ 2.0's Root feature, at index 0 on every lamp, gives the index of any other feature from its id. A lamp puts its
// features at indexes of its own, so the plugin asks rather than hard-coding them.
const ROOT_FEATURE_INDEX = 0x00;
const ROOT_GET_FEATURE = 0;
// Device Information, whose function 2 gives the serial number the lamp keeps itself, in up to 12 ASCII characters,
// which on a Beam is the one its USB descriptor gives (`scripts/probes/serial-numbers.mjs`, #170).
const DEVICE_INFORMATION_FEATURE = 0x0003;
const GET_SERIAL_NUMBER = 2;
const SERIAL_NUMBER_LENGTH = 12;
// The software id the plugin's own HID++ requests carry, as litra's queries do, which the lamp sends back in its reply.
const SOFTWARE_ID = 0x1;
// An error report has 0xff where the feature goes, then the feature and function it refuses, then its code.
const ERROR_REPORT = 0xff;
// A lamp answers a request within a few ms, so a lamp that hasn't answered by then won't.
const REPLY_TIMEOUT_MS = 500;

/** A lamp's HID handle with the methods node-hid has at runtime, which litra's type leaves out. */
function asHid(device: Device): ClosableHid {
  return device.hid as ClosableHid;
}

/** Pads a report with zeros to the length a lamp expects. */
function padRight(values: number[], length: number): number[] {
  if (values.length >= length) {
    return values;
  }
  return [...values, ...Array(length - values.length).fill(0)];
}

/**
 * Stock litra getBrightnessInLumen only returns data[5], which truncates the Beam and
 * the Beam LX above 255 lm. Mirror litra-rs / temperature parsing: data[4]*256 + data[5].
 *
 * It also takes the first report that arrives, which can be an ACK or a change notice instead of the reply, so this
 * skips every report that isn't the reply.
 */
function getBrightnessInLumenSafe(device: Device): number {
  const featureIndex = device.type === DeviceType.LitraBeamLX ? 0x06 : 0x04;
  device.hid.write(padRight([0x11, 0xff, featureIndex, 0x31], 20));
  for (let skipped = 0; skipped <= MAX_SKIPPED_REPORTS; skipped += 1) {
    const [, , feature, operation, high, low] = device.hid.readSync();
    // A report too short to hold the brightness can't be the reply, whatever its header says.
    if (feature === featureIndex && operation === 0x31 && high !== undefined && low !== undefined) {
      return high * 256 + low;
    }
  }
  throw new Error(`No brightness reply after ${MAX_SKIPPED_REPORTS} other reports`);
}

/**
 * Sends a HID++ request to a lamp, and returns the parameters of its reply, skipping the reports that aren't it, as
 * {@link getBrightnessInLumenSafe} does. Fails on the lamp's error report, or when no reply comes.
 */
function request(device: Device, featureIndex: number, fn: number, parameters: number[] = []): number[] {
  const hid = asHid(device);
  const operation = (fn << 4) | SOFTWARE_ID;
  hid.write(padRight([0x11, 0xff, featureIndex, operation, ...parameters], 20));
  for (let skipped = 0; skipped <= MAX_SKIPPED_REPORTS; skipped += 1) {
    const report = hid.readTimeout(REPLY_TIMEOUT_MS);
    if (report.length === 0) {
      throw new Error(`No reply to function ${fn} of feature index ${featureIndex}`);
    }
    const [, , feature, replyOperation, ...reply] = report;
    if (feature === featureIndex && replyOperation === operation) {
      return reply;
    }
    if (feature === ERROR_REPORT && replyOperation === featureIndex && reply[0] === operation) {
      throw new Error(`Error ${reply[1]} for function ${fn} of feature index ${featureIndex}`);
    }
  }
  throw new Error(
    `No reply to function ${fn} of feature index ${featureIndex} after ${MAX_SKIPPED_REPORTS} other reports`,
  );
}

/**
 * Asks a lamp for the serial number it keeps itself, through its Device Information feature (#170). A Beam LX needs
 * it: its USB descriptor declares a serial number, but gives none.
 */
function readSerialNumber(device: Device): string {
  const [index = 0] = request(device, ROOT_FEATURE_INDEX, ROOT_GET_FEATURE, [
    DEVICE_INFORMATION_FEATURE >> 8,
    DEVICE_INFORMATION_FEATURE & 0xff,
  ]);
  // Root answers index 0, its own, for a feature the lamp doesn't have.
  if (index === ROOT_FEATURE_INDEX) {
    throw new Error("No Device Information feature to read a serial number from");
  }
  const characters = request(device, index, GET_SERIAL_NUMBER).slice(0, SERIAL_NUMBER_LENGTH);
  const serialNumber = String.fromCharCode(...characters).replace(/\0+$/, "");
  if (serialNumber === "") {
    throw new Error("Empty serial number");
  }
  return serialNumber;
}

/**
 * A lamp plugged in, opened for one operation (#198): found by {@link LampConnection.findAll}, used, and closed once
 * the operation is done, after which it's good for nothing. It names the lamp by what it gives: its model, and the
 * serial number of its USB descriptor, or the one the lamp keeps itself (see {@link LampConnection.identify}). Each
 * write's ACK is drained, so a read that follows on the same connection gets its reply.
 */
export class LampConnection implements LampHandle {
  /** The model, as the plugin names it, such as "Beam". */
  readonly model: string;

  /** Opens a lamp `litra` found. The plugin opens them with {@link LampConnection.findAll}. */
  constructor(private readonly device: Device) {
    this.model = MODEL_BY_DEVICE_TYPE[device.type];
  }

  /** Opens every lamp plugged in, in the order `litra` finds them, which changes from one call to the next. */
  static findAll(): LampConnection[] {
    return findDevices().map((device) => new LampConnection(device));
  }

  /**
   * Whether the lamp has a serial number to tell it by: the one its USB descriptor gives, or the one it was asked for.
   * A Beam LX gives none until it's asked (#170).
   */
  get isIdentified(): boolean {
    return this.device.serialNumber !== "";
  }

  /**
   * Asks a lamp found without a serial number, such as a Beam LX, for the one it keeps itself, so that it has an id
   * (#170). Does nothing for a lamp that has one, and fails when the lamp can't give it.
   */
  identify(): void {
    if (!this.isIdentified) {
      this.device.serialNumber = readSerialNumber(this.device);
    }
  }

  /** The lamp's id (see {@link Lamp.idOf}), which only a lamp identified has. */
  get id(): string {
    if (!this.isIdentified) {
      throw new Error(`${this.label} has no serial number to tell it by`);
    }
    return Lamp.idOf(this.device.serialNumber);
  }

  /** The lamp as a `Lamp` names it, or by its model alone while it isn't identified. */
  get label(): string {
    return this.isIdentified ? Lamp.labelOf({ model: this.model, id: this.id }) : this.model;
  }

  /** Where the lamp is plugged in: the path the system gave it, which changes each time it's plugged in. */
  get path(): string {
    return this.hid.getDeviceInfo().path ?? "";
  }

  /** What the lamp can be set to, as `litra` gives it for its model. */
  get range(): LampRange {
    return {
      minLumen: getMinimumBrightnessInLumenForDevice(this.device),
      maxLumen: getMaximumBrightnessInLumenForDevice(this.device),
      allowedKelvin: getAllowedTemperaturesInKelvinForDevice(this.device),
    };
  }

  /** Whether the lamp is on. */
  isOn(): boolean {
    return isOn(this.device);
  }

  /** Turns the lamp on or off. */
  switchPower(on: boolean): void {
    if (on) {
      turnOn(this.device);
    } else {
      turnOff(this.device);
    }
    this.drainAck();
  }

  /** The lamp's brightness, in lumens, read from both of its bytes (see {@link getBrightnessInLumenSafe}). */
  readBrightness(): number {
    return getBrightnessInLumenSafe(this.device);
  }

  /** Sets the lamp's brightness, in lumens. */
  writeBrightness(lumen: number): void {
    setBrightnessInLumen(this.device, lumen);
    this.drainAck();
  }

  /** The lamp's temperature, in kelvin. */
  readTemperature(): number {
    return getTemperatureInKelvin(this.device);
  }

  /** Sets the lamp's temperature, in kelvin. */
  writeTemperature(kelvin: number): void {
    setTemperatureInKelvin(this.device, kelvin);
    this.drainAck();
  }

  /** Closes the lamp, and logs a close that fails. */
  close(): void {
    try {
      this.hid.close();
    } catch (error) {
      logger.warn(`Closing ${this.label} failed: ${String(error)}`);
    }
  }

  /** The lamp's HID handle with the methods node-hid has at runtime, which litra's type leaves out. */
  private get hid(): ClosableHid {
    return asHid(this.device);
  }

  /**
   * Reads the ACK a write leaves on the handle, so that a read on the same handle afterwards gets its reply rather
   * than the ACK: litra's isOn and getTemperatureInKelvin take the first report that arrives. Every write gets an ACK
   * within a few ms, so the drain returns as soon as it arrives, and an ACK left on a handle is gone once the handle
   * closes (`scripts/probes/write-reports.mjs`, #96). A lamp just turned on is read right after, on the same handle.
   */
  private drainAck(): void {
    try {
      this.hid.readTimeout(50);
    } catch {
      // nothing pending
    }
  }
}
