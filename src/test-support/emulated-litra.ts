import type { Device as HidDeviceInfo } from "node-hid";

import { at } from "./at";

// What each model is, taken from litra-rs (github.com/timrogers/litra-rs, src/lib.rs at e05d931), not from litra, so
// that the tests check litra against another account of the protocol. The Beam also comes as product 0xb901.
const MODELS = {
  Glow: { productId: 0xc900, feature: 0x04, minLumen: 20, maxLumen: 250 },
  Beam: { productId: 0xc901, feature: 0x04, minLumen: 30, maxLumen: 400 },
  "Beam LX": { productId: 0xc903, feature: 0x06, minLumen: 30, maxLumen: 400 },
} as const;

export type LitraModel = keyof typeof MODELS;

/** What a lamp can be told or asked about. */
export type Command = "power" | "brightness" | "temperature";

/**
 * The calls on a lamp's HID handles that can be made to fail. `everything` fails every write and read, as on a lamp
 * unplugged while it's open, and leaves closing alone.
 */
export type FailingCall = "everything" | "readSync" | "readTimeout" | "close";

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
const WRITE_BY_COMMAND: Record<Command, number> = {
  power: POWER_SET,
  brightness: BRIGHTNESS_SET,
  temperature: TEMPERATURE_SET,
};
const QUERY_BY_COMMAND: Record<Command, number> = {
  power: POWER_QUERY,
  brightness: BRIGHTNESS_QUERY,
  temperature: TEMPERATURE_QUERY,
};
/** What a report to or from a lamp is about, by its function: a command written, or asked about. */
export type ReportKind = Command | `${Command} query`;

/**
 * What a report is about, by its function, the same for a report written to a lamp and for its ACK or reply. Undefined
 * for any other report, such as a change notice or an error report.
 */
export function kindOf(report: number[]): ReportKind | undefined {
  const operation = report[3];
  const commands = Object.keys(WRITE_BY_COMMAND) as Command[];
  const written = commands.find((command) => WRITE_BY_COMMAND[command] === operation);
  if (written !== undefined) {
    return written;
  }
  const asked = commands.find((command) => QUERY_BY_COMMAND[command] === operation);
  return asked === undefined ? undefined : `${asked} query`;
}

// Sent unasked when a capped lamp lowers its brightness to its cap, with the brightness in bytes 5 and 6.
const BRIGHTNESS_CHANGED = 0x40;

// How long a capped lamp keeps the brightness it was sent before it lowers it to its cap, as the probes measured.
export const CAP_DELAY_MS = 100;

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
  /** The brightness the lamp can't go above, like a Beam on the Stream Deck + XL's USB hub. None by default. */
  capInLumen?: number | undefined;
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
 * write gets an ACK, which carries no value. A report it can't carry out gets an error report.
 *
 * A capped lamp, like a Beam on a low-power supply, also behaves as measured: sent more than its cap, it takes the
 * brightness it was sent, then lowers it to its cap after {@link CAP_DELAY_MS} and sends a change notice. Sent more
 * than its cap while already at it, it refuses with an error report, followed by a change notice. Some lamps also go
 * back to their cap up to about a second after a request above it, undoing a lower brightness written in between: that
 * isn't emulated.
 */
export class EmulatedLitra {
  /** The lamp as node-hid lists it. */
  readonly info: HidDeviceInfo;
  readonly model: LitraModel;
  on: boolean;
  brightnessInLumen: number;
  temperatureInKelvin: number;
  readonly capInLumen: number | undefined;
  /** Every report written to the lamp, in order. */
  readonly written: number[][] = [];
  // The lowering to the cap that a write above it has started, which a later brightness write replaces.
  private lowerToCap: ReturnType<typeof setTimeout> | undefined;
  // The reports waiting on each open handle, to be read.
  private readonly inputs = new Set<number[][]>();
  private readonly failingCalls = new Set<FailingCall>();
  // The functions whose writes fail, by their id in byte 3.
  private readonly failingWrites = new Set<number>();

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
    this.capInLumen = options.capInLumen;
  }

  /** Makes a call on the lamp's handles fail from now on, as an HID error does. */
  fail(call: FailingCall): void {
    this.failingCalls.add(call);
  }

  /** Makes writing a command to the lamp fail from now on, while the lamp still answers queries and other writes. */
  failWrites(command: Command): void {
    this.failingWrites.add(WRITE_BY_COMMAND[command]);
  }

  /** Whether a call on one of the lamp's handles fails, for the fake node-hid. A write fails by what it writes. */
  fails(call: "write" | "readSync" | "readTimeout" | "close", report: number[] = []): boolean {
    if (call === "write") {
      return this.failingCalls.has("everything") || this.failingWrites.has(at(report, 3));
    }
    return this.failingCalls.has(call) || (call !== "close" && this.failingCalls.has("everything"));
  }

  /** The values written for a command, in order: 1 or 0 for the power, lumens for the brightness, kelvin for the temperature. */
  writes(command: Command): number[] {
    return this.written
      .filter((report) => at(report, 3) === WRITE_BY_COMMAND[command])
      .map((report) => (command === "power" ? at(report, 4) : at(report, 4) * 256 + at(report, 5)));
  }

  /** How many times the lamp was asked about a command. */
  queries(command: Command): number {
    return this.written.filter((report) => at(report, 3) === QUERY_BY_COMMAND[command]).length;
  }

  /** The lamp's serial number, which every emulated lamp has. */
  get serialNumber(): string {
    return this.info.serialNumber ?? "";
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
    for (const answer of this.carryOut(report)) {
      this.send(answer);
    }
  }

  /** Carries out a report, and returns what the lamp answers, in the order it sends them. */
  private carryOut(report: number[]): number[][] {
    const { feature, minLumen, maxLumen } = MODELS[this.model];
    const [reportId, deviceIndex, reportFeature = 0, operation = 0, high = 0, low = 0] = report;
    const value = high * 256 + low;
    const reply = (...parameters: number[]): number[][] => [
      padded([REPORT_ID, DEVICE_INDEX, feature, operation, ...parameters]),
    ];
    const refuse = (code: number): number[][] => [
      padded([REPORT_ID, DEVICE_INDEX, ERROR, reportFeature, operation, code]),
    ];

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
        return this.setBrightness(value);
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

  /** Takes a brightness within the lamp's range, and returns what it answers, as a capped lamp does if it's capped. */
  private setBrightness(lumen: number): number[][] {
    const { feature } = MODELS[this.model];
    const cap = this.capInLumen;
    clearTimeout(this.lowerToCap);
    this.lowerToCap = undefined;
    if (cap === undefined || lumen <= cap) {
      this.brightnessInLumen = lumen;
      return [padded([REPORT_ID, DEVICE_INDEX, feature, BRIGHTNESS_SET])];
    }
    const notice = padded([REPORT_ID, DEVICE_INDEX, feature, BRIGHTNESS_CHANGED, 0x01, ...bigEndian(cap)]);
    if (this.brightnessInLumen === cap) {
      return [padded([REPORT_ID, DEVICE_INDEX, ERROR, feature, BRIGHTNESS_SET, INVALID_ARGUMENT]), notice];
    }
    this.brightnessInLumen = lumen;
    this.lowerToCap = setTimeout(() => {
      this.lowerToCap = undefined;
      this.brightnessInLumen = cap;
      this.send(notice);
    }, CAP_DELAY_MS);
    return [padded([REPORT_ID, DEVICE_INDEX, feature, BRIGHTNESS_SET])];
  }
}
