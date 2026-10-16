import type { Device as HidDeviceInfo } from "node-hid";

// What each model is, taken from litra-rs (github.com/timrogers/litra-rs, src/lib.rs at e05d931), not from litra, so
// that the tests check litra against another account of the protocol. The Beam also comes as product 0xb901.
const MODELS = {
  Glow: { productId: 0xc900, feature: 0x04, minLumen: 20, maxLumen: 250 },
  Beam: { productId: 0xc901, feature: 0x04, minLumen: 30, maxLumen: 400 },
  "Beam LX": { productId: 0xc903, feature: 0x06, minLumen: 30, maxLumen: 400 },
} as const;

export type LitraModel = keyof typeof MODELS;

const LOGITECH_VENDOR_ID = 0x046d;
const LITRA_USAGE_PAGE = 0xff43;
const MIN_KELVIN = 2700;
const MAX_KELVIN = 6500;

// Every report, either way, is 20 bytes: a report id, a device index, the feature, the function, and its parameters.
const REPORT_LENGTH = 20;
const REPORT_ID = 0x11;
const DEVICE_INDEX = 0xff;

const POWER_QUERY = 0x01;
const POWER_SET = 0x1c;
const BRIGHTNESS_QUERY = 0x31;
const BRIGHTNESS_SET = 0x4c;
const TEMPERATURE_QUERY = 0x81;
const TEMPERATURE_SET = 0x9c;

// An error report has 0xff where the feature goes, then the feature and function it refuses, then its code. The lamps
// have been seen sending 0x02 (invalid argument). The other codes are HID++ 2.0's, and unchecked on a lamp.
const ERROR = 0xff;
const INVALID_ARGUMENT = 0x02;
const INVALID_FEATURE_INDEX = 0x06;
const INVALID_FUNCTION_ID = 0x07;

type EmulatedLitraOptions = {
  /** Another product id for the model, or a device that only looks like a Litra. */
  productId?: number | undefined;
  /** Another vendor, for a device that only looks like a Litra. */
  vendorId?: number | undefined;
  /** Another of the lamp's HID interfaces, which litra mustn't open. */
  usagePage?: number | undefined;
  serialNumber?: string | undefined;
  on?: boolean | undefined;
  brightnessInLumen?: number | undefined;
  temperatureInKelvin?: number | undefined;
};

// Serial numbers and paths are unique per machine, so every emulated lamp gets its own.
let nextLamp = 1;

/** A report of the given bytes, padded with zeros to a report's length. */
function padded(bytes: number[]): number[] {
  return [...bytes, ...Array<number>(REPORT_LENGTH - bytes.length).fill(0)];
}

/** A 16-bit value as its two bytes, the most significant first, as the lamps send and expect it. */
function bigEndian(value: number): [number, number] {
  return [value >> 8, value & 0xff];
}

/**
 * A Litra lamp without hardware, for the fake node-hid in `fake-node-hid.ts`: it keeps its power, brightness and
 * temperature, carries out the reports written to it, and answers them on every handle open on it, as a lamp does.
 *
 * It follows what `scripts/probes/` measured on the Beams: a query gets a reply with the value in bytes 4 and 5, and a
 * write gets an ACK, which carries no value. A report it can't carry out gets an error report. Brightness caps aren't
 * emulated yet.
 */
export class EmulatedLitra {
  /** The lamp as node-hid lists it. */
  readonly info: HidDeviceInfo;
  readonly model: LitraModel;
  on: boolean;
  brightnessInLumen: number;
  temperatureInKelvin: number;
  /** Every report written to the lamp, in order. */
  readonly written: number[][] = [];
  // The reports waiting on each open handle, to be read.
  private readonly inputs = new Set<number[][]>();

  /** A lamp of the given model, off, at its lowest brightness and temperature unless the options say otherwise. */
  constructor(model: LitraModel, options: EmulatedLitraOptions = {}) {
    const number = nextLamp++;
    this.model = model;
    this.info = {
      vendorId: options.vendorId ?? LOGITECH_VENDOR_ID,
      productId: options.productId ?? MODELS[model].productId,
      path: `emulated-litra-${number}`,
      serialNumber: options.serialNumber ?? `EMU${String(number).padStart(4, "0")}`,
      release: 0,
      interface: 0,
      usagePage: options.usagePage ?? LITRA_USAGE_PAGE,
    };
    this.on = options.on ?? false;
    this.brightnessInLumen = options.brightnessInLumen ?? MODELS[model].minLumen;
    this.temperatureInKelvin = options.temperatureInKelvin ?? MIN_KELVIN;
  }

  /** How many handles are open on the lamp. */
  get openHandles(): number {
    return this.inputs.size;
  }

  /** Opens a handle on the lamp: returns the queue its reports arrive in, which starts empty. */
  open(): number[][] {
    const input: number[][] = [];
    this.inputs.add(input);
    return input;
  }

  /** Closes the handle that reads from the queue. */
  close(input: number[][]): void {
    this.inputs.delete(input);
  }

  /** Sends a report to every open handle, like one the lamp sends unasked. With no handle open, it's lost. */
  send(report: number[]): void {
    for (const input of this.inputs) {
      input.push([...report]);
    }
  }

  /** Takes a report written to the lamp: carries it out, and sends its reply, its ACK or an error report. */
  receive(report: number[]): void {
    this.written.push([...report]);
    this.send(this.carryOut(report));
  }

  /** Carries out a report, and returns what the lamp answers. */
  private carryOut(report: number[]): number[] {
    const { feature, minLumen, maxLumen } = MODELS[this.model];
    const [reportId, deviceIndex, reportFeature = 0, operation = 0, high = 0, low = 0] = report;
    const value = high * 256 + low;
    const reply = (...parameters: number[]): number[] =>
      padded([REPORT_ID, DEVICE_INDEX, feature, operation, ...parameters]);
    const refuse = (code: number): number[] => padded([REPORT_ID, DEVICE_INDEX, ERROR, reportFeature, operation, code]);

    if (report.length !== REPORT_LENGTH || reportId !== REPORT_ID || deviceIndex !== DEVICE_INDEX) {
      return refuse(INVALID_ARGUMENT);
    }
    if (reportFeature !== feature) {
      return refuse(INVALID_FEATURE_INDEX);
    }
    switch (operation) {
      case POWER_QUERY:
        return reply(this.on ? 1 : 0);
      case POWER_SET:
        if (high !== 0 && high !== 1) {
          return refuse(INVALID_ARGUMENT);
        }
        this.on = high === 1;
        return reply();
      case BRIGHTNESS_QUERY:
        return reply(...bigEndian(this.brightnessInLumen));
      case BRIGHTNESS_SET:
        if (value < minLumen || value > maxLumen) {
          return refuse(INVALID_ARGUMENT);
        }
        this.brightnessInLumen = value;
        return reply();
      case TEMPERATURE_QUERY:
        return reply(...bigEndian(this.temperatureInKelvin));
      case TEMPERATURE_SET:
        // Whether a lamp takes a temperature that isn't a multiple of 100 is unknown: litra never sends one.
        if (value < MIN_KELVIN || value > MAX_KELVIN) {
          return refuse(INVALID_ARGUMENT);
        }
        this.temperatureInKelvin = value;
        return reply();
      default:
        return refuse(INVALID_FUNCTION_ID);
    }
  }
}
