import type { Device as HidDeviceInfo } from "node-hid";

import type { EmulatedLitra } from "./emulated-litra";

/**
 * Stands in for `node-hid` in the integration tests, which mock it with
 * `vi.mock("node-hid", () => import("../test-support/fake-node-hid"))`, so that the real litra runs against emulated
 * lamps instead of the ones plugged into the machine. Only the parts of node-hid that litra and the plugin use are here.
 */

// The lamps plugged in, in the order node-hid lists them.
let connected: EmulatedLitra[] = [];

/** Makes these the lamps plugged in, replacing the ones before. */
export function connect(...lamps: EmulatedLitra[]): void {
  connected = lamps;
}

/** The HID devices plugged in, as node-hid lists them. */
export function devices(): HidDeviceInfo[] {
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
  }

  /** Writes a report to the lamp, and returns how many bytes were written. */
  write(values: number[] | Buffer): number {
    this.ensureOpen();
    const report = Array.from(values);
    this.lamp.receive(report);
    return report.length;
  }

  /**
   * Reads the next report the lamp sent. Where node-hid would wait for one forever, this throws, so that a test fails
   * instead of hanging.
   */
  readSync(): number[] {
    this.ensureOpen();
    const report = this.input.shift();
    if (report === undefined) {
      throw new Error("readSync would wait forever: the lamp has sent nothing to read");
    }
    return report;
  }

  /** Reads the next report the lamp sent, or none when there's nothing to read. No time passes. */
  readTimeout(_timeout: number): number[] {
    this.ensureOpen();
    return this.input.shift() ?? [];
  }

  /** Closes the handle. Closing it again does nothing. */
  close(): void {
    if (!this.closed) {
      this.closed = true;
      this.lamp.close(this.input);
    }
  }

  /** Fails, like node-hid, when the handle is used after it was closed. */
  private ensureOpen(): void {
    if (this.closed) {
      throw new Error("Cannot use a closed device");
    }
  }
}

// litra imports node-hid's default export, which is the module as CommonJS exports it.
export default { devices, HID };
