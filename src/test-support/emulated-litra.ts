import type { Device as HidDeviceInfo } from "node-hid";

import { at } from "./at";

// What each model is, taken from litra-rs (github.com/timrogers/litra-rs, src/lib.rs at e05d931), not from litra, so
// that the tests check litra against another account of the protocol. The Beam also comes as product 0xb901. Whether its
// USB descriptor gives its serial number comes from `scripts/probes/serial-numbers.mjs`, run on the Beams and a Beam LX
// (#170), and so does the version of its Device Information feature. The Glow wasn't probed, and is taken to be a Beam.
const MODELS = {
  Glow: { productId: 0xc900, feature: 0x04, minLumen: 20, maxLumen: 250, serialInDescriptor: true, deviceInfo: 4 },
  Beam: { productId: 0xc901, feature: 0x04, minLumen: 30, maxLumen: 400, serialInDescriptor: true, deviceInfo: 4 },
  "Beam LX": {
    productId: 0xc903,
    feature: 0x06,
    minLumen: 30,
    maxLumen: 400,
    serialInDescriptor: false,
    deviceInfo: 5,
  },
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
 * What a report is about, by its feature and function, the same for a report written to a lamp and for its ACK or
 * reply. Undefined for any other report, such as a change notice, an error report, or a request to another feature.
 */
export function kindOf(report: number[]): ReportKind | undefined {
  if (!Object.values(MODELS).some(({ feature }) => feature === report[2])) {
    return undefined;
  }
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

// How long after a request above its cap a capped lamp goes back to its cap, undoing a lower brightness written in
// between. The probes saw it happen between 0.5 s and 1.25 s after the request.
export const CAP_REVERSAL_MS = 1000;

// An error report has 0xff where the feature goes, then the feature and function it refuses, then its code. The lamps
// have been seen sending 0x02 (invalid argument). The other codes are HID++ 2.0's, and unchecked on a lamp.
const ERROR = 0xff;
const INVALID_ARGUMENT = 0x02;
const INVALID_FEATURE_INDEX = 0x06;
const INVALID_FUNCTION_ID = 0x07;

// HID++ 2.0's Root feature, at index 0, whose function 0 gives a feature's index from its id, or 0 for one the lamp
// doesn't have. Function 2 of Device Information gives the lamp's serial number, in 12 ASCII characters. Both Beams and
// the Beam LX probed put Device Information at index 2 (#170).
const ROOT_INDEX = 0x00;
const ROOT_GET_FEATURE = 0;
const DEVICE_INFORMATION = 0x0003;
const DEVICE_INFORMATION_INDEX = 0x02;
const GET_SERIAL_NUMBER = 2;
const SERIAL_NUMBER_LENGTH = 12;
// Device Information has had a function that gives the serial number since its version 4.
const FIRST_VERSION_WITH_SERIAL_NUMBER = 4;

type EmulatedLitraOptions = {
  /** Another product id for the model, or a device that only looks like a Litra. */
  productId?: number | undefined;
  /** Another vendor, for a device that only looks like a Litra. */
  vendorId?: number | undefined;
  /** Another of the lamp's HID interfaces, which litra mustn't open. */
  usagePage?: number | undefined;
  /**
   * The serial number the lamp keeps, which it gives over HID++, and which its USB descriptor gives too unless it's a
   * Beam LX. A lamp already emulated, for the same lamp plugged in again: a new emulated lamp with its serial number,
   * which gets a new path, as the system gives a lamp each time it's plugged in.
   */
  serialNumber?: string | undefined;
  /**
   * Another version of the lamp's Device Information feature, such as one from before the serial number could be read
   * through it, or `"none"` for a lamp without the feature.
   */
  deviceInformation?: number | "none" | undefined;
  on?: boolean | undefined;
  brightnessInLumen?: number | undefined;
  temperatureInKelvin?: number | undefined;
  /** The brightness the lamp can't go above, like a Beam on a Stream Deck + XL's USB hub. None by default. */
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
 * It follows what `scripts/probes/` measured on the Beams: a query gets a reply with the value in bytes 4 and 5, and
 * every write gets an ACK, which carries no value, even a write that changes nothing (#96). A report it can't carry
 * out gets an error report. It also answers HID++ 2.0's Root feature, and gives its serial number through its Device
 * Information feature, which a Beam LX, whose USB descriptor gives none, is asked for (#170). A handle opened on it starts empty, since what the lamp sent to a handle is gone once that
 * handle closes.
 *
 * A capped lamp, like a Beam on a low-power supply, also behaves as measured: sent more than its cap, it takes the
 * brightness it was sent, then lowers it to its cap after {@link CAP_DELAY_MS} and sends a change notice. Sent more
 * than its cap while already at it, it refuses with an error report, followed by a change notice. Either way, it goes
 * back to its cap {@link CAP_REVERSAL_MS} after the request, without a notice, undoing a lower brightness written in
 * between, as three of the four lamp and port pairs measured did.
 */
export class EmulatedLitra {
  /** The lamp as node-hid lists it. */
  readonly info: HidDeviceInfo;
  readonly model: LitraModel;
  on: boolean;
  brightnessInLumen: number;
  temperatureInKelvin: number;
  readonly capInLumen: number | undefined;
  // The serial number the lamp keeps, which its USB descriptor may not give.
  private readonly ownSerialNumber: string;
  // The version of the lamp's Device Information feature, if it has one.
  private readonly deviceInformation: number | "none";
  /** Every report written to the lamp, in order. */
  readonly written: number[][] = [];
  // The lowering to the cap that a write above it has started, which a later brightness write replaces.
  private lowerToCap: ReturnType<typeof setTimeout> | undefined;
  // The return to the cap that a request above it has started, which a later request above it restarts.
  private backToCap: ReturnType<typeof setTimeout> | undefined;
  // The reports waiting on each open handle, to be read.
  private readonly inputs = new Set<number[][]>();
  private readonly failingCalls = new Set<FailingCall>();
  // The functions whose writes fail, by their id in byte 3.
  private readonly failingWrites = new Set<number>();

  /** A lamp of the given model, off, at its lowest brightness and temperature unless the options say otherwise. */
  constructor(model: LitraModel, options: EmulatedLitraOptions = {}) {
    const number = nextLamp++;
    this.model = model;
    this.ownSerialNumber = options.serialNumber ?? `EMU${String(number).padStart(4, "0")}`;
    this.deviceInformation = options.deviceInformation ?? MODELS[model].deviceInfo;
    this.info = {
      vendorId: options.vendorId ?? LOGITECH_VENDOR_ID,
      productId: options.productId ?? MODELS[model].productId,
      path: `emulated-litra-${number}`,
      serialNumber: MODELS[model].serialInDescriptor ? this.ownSerialNumber : "",
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
      .filter((report) => kindOf(report) === command)
      .map((report) => (command === "power" ? at(report, 4) : at(report, 4) * 256 + at(report, 5)));
  }

  /** How many times the lamp was asked about a command. */
  queries(command: Command): number {
    return this.written.filter((report) => kindOf(report) === `${command} query`).length;
  }

  /** The serial number the lamp keeps, which every emulated lamp has, even where its USB descriptor gives none. */
  get serialNumber(): string {
    return this.ownSerialNumber;
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
    if (reportFeature === ROOT_INDEX || reportFeature === DEVICE_INFORMATION_INDEX) {
      return this.identify(reportFeature, operation, value);
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

  /**
   * Answers a request to the Root or Device Information feature, by its function in the operation's high nibble: the
   * index of a feature, from its id in `featureId`, with its type and version, or the lamp's serial number. Only the
   * functions the plugin calls are emulated, and the others refused, as a lamp refuses a function its version doesn't
   * have, or a feature it doesn't have.
   */
  private identify(featureIndex: number, operation: number, featureId: number): number[][] {
    const fn = operation >> 4;
    const version = this.deviceInformation;
    if (featureIndex === ROOT_INDEX && fn === ROOT_GET_FEATURE) {
      const answer =
        featureId === DEVICE_INFORMATION && version !== "none" ? [DEVICE_INFORMATION_INDEX, 0, version] : [0];
      return [padded([REPORT_ID, DEVICE_INDEX, ROOT_INDEX, operation, ...answer])];
    }
    if (featureIndex === DEVICE_INFORMATION_INDEX) {
      if (version === "none") {
        return [padded([REPORT_ID, DEVICE_INDEX, ERROR, featureIndex, operation, INVALID_FEATURE_INDEX])];
      }
      if (fn === GET_SERIAL_NUMBER && version >= FIRST_VERSION_WITH_SERIAL_NUMBER) {
        const characters = [...this.ownSerialNumber.slice(0, SERIAL_NUMBER_LENGTH)].map((c) => c.charCodeAt(0));
        return [padded([REPORT_ID, DEVICE_INDEX, DEVICE_INFORMATION_INDEX, operation, ...characters])];
      }
    }
    return [padded([REPORT_ID, DEVICE_INDEX, ERROR, featureIndex, operation, INVALID_FUNCTION_ID])];
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
    clearTimeout(this.backToCap);
    this.backToCap = setTimeout(() => {
      this.backToCap = undefined;
      this.brightnessInLumen = cap;
    }, CAP_REVERSAL_MS);
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
