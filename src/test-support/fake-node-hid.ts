import type { Device as HidDeviceInfo } from "node-hid";

import type { EmulatedLitra } from "./emulated-litra";

/**
 * Stands in for `node-hid` in the tests that run the real litra, which load it through `emulated-lamps.ts`, so that
 * litra runs against emulated lamps instead of the ones plugged into the machine. Only the parts of node-hid that
 * litra and the plugin use are here.
 */

/** A call made on a lamp's handle. */
export type HidCall = "open" | "write" | "readSync" | "readTimeout" | "close";

/** A call that went through, with the report written or read, if any. */
export type HidEvent = { lamp: EmulatedLitra; call: HidCall; report?: number[] };

// The lamps plugged in, in the order node-hid lists them.
let connected: EmulatedLitra[] = [];
// Every call that went through, on every lamp, in order.
const events: HidEvent[] = [];
// What finding the lamps throws, when it's set to fail.
let devicesError: Error | undefined;

/** Makes these the lamps plugged in, replacing the ones before. */
export function connect(...lamps: EmulatedLitra[]): void {
  connected = lamps;
}

/** Makes finding the lamps fail from now on, as it does when the system can't list its HID devices. */
export function failFindingLamps(error: Error): void {
  devicesError = error;
}

/** Every call made on a lamp's handle that went through, on every lamp, in the order they were made. */
export function hidEvents(): readonly HidEvent[] {
  return events;
}

/** The HID devices plugged in, as node-hid lists them. */
export function devices(): HidDeviceInfo[] {
  if (devicesError !== undefined) {
    throw devicesError;
  }
  return connected.map((lamp) => lamp.info);
}

/** A handle on a lamp, opened by its path, through which reports are written to it and read from it. */
export class HID {
  private readonly lamp: EmulatedLitra;
  private readonly input: number[][];
  private closed = false;

  /** Opens the lamp at the path, which has to be plugged in. */
  constructor(path: string) {
    const lamp = connected.find((candidate) => candidate.info.path === path);
    if (lamp === undefined) {
      throw new Error(`cannot open device with path ${path}`);
    }
    this.lamp = lamp;
    this.input = lamp.open();
    events.push({ lamp, call: "open" });
  }

  /** Writes a report to the lamp, and returns how many bytes were written. */
  write(values: number[] | Buffer): number {
    const report = Array.from(values);
    this.ensureUsable("write", report);
    events.push({ lamp: this.lamp, call: "write", report });
    this.lamp.receive(report);
    return report.length;
  }

  /**
   * Reads the next report the lamp sent. Where node-hid would wait for one forever, this throws, so that a test fails
   * instead of hanging.
   */
  readSync(): number[] {
    this.ensureUsable("readSync");
    const report = this.input.shift();
    if (report === undefined) {
      throw new Error("readSync would wait forever: the lamp has sent nothing to read");
    }
    events.push({ lamp: this.lamp, call: "readSync", report });
    return report;
  }

  /** Reads the next report the lamp sent, or none when there's nothing to read. No time passes. */
  readTimeout(_timeout: number): number[] {
    this.ensureUsable("readTimeout");
    const report = this.input.shift() ?? [];
    events.push({ lamp: this.lamp, call: "readTimeout", report });
    return report;
  }

  /** Closes the handle. Closing it again does nothing. A close set to fail still releases the handle, then throws. */
  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.lamp.close(this.input);
    if (this.lamp.fails("close")) {
      throw new Error("Cannot close hid device");
    }
    events.push({ lamp: this.lamp, call: "close" });
  }

  /**
   * Fails, like node-hid, when the handle is used after it was closed, on a lamp that was unplugged, or for a call the
   * lamp is set to fail.
   */
  private ensureUsable(call: "write" | "readSync" | "readTimeout", report?: number[]): void {
    if (this.closed) {
      throw new Error("Cannot use a closed device");
    }
    if (!connected.includes(this.lamp) || this.lamp.fails(call, report)) {
      throw new Error(call === "write" ? "Cannot write to hid device" : "Cannot read from hid device");
    }
  }
}

// litra imports node-hid's default export, which is the module as CommonJS exports it.
export default { devices, HID };
