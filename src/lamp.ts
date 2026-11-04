import { createHash } from "node:crypto";

import { logger as pluginLogger } from "./logging";

const logger = pluginLogger.createScope("Lamps");

/**
 * How long a lamp may go back to its brightness cap after a write that went above it, in ms. Until then, a lower
 * brightness written in between can be undone, so the next brightness change waits.
 */
export const BRIGHTNESS_CAP_REVERSAL_WINDOW_MS = 1500;

/**
 * Where a lamp kept apart would be if no end of its range or cap had stopped it, with the value it was left at (#145):
 * in % and lumens for the brightness, in kelvin for the temperature.
 */
type Position = { position: number; left: number };

/**
 * A lamp's id: the first 16 hex characters of its serial number's SHA-256. It tells lamps apart wherever the plugin
 * names a lamp outside its own process, such as a key's settings, which travel with an exported profile, without
 * revealing the serial (#20).
 */
export function lampId(serialNumber: string): string {
  return createHash("sha256").update(serialNumber).digest("hex").slice(0, 16);
}

/**
 * One lamp the plugin has reached, and what the plugin remembers about it between operations (#198): the brightness it
 * can reach on a low-power supply, its brightness cap (#55), when it may still go back to that cap, and where it would
 * be if it's kept apart from the others and an end stopped it (#145). It sends its lamp nothing: the operations do, and
 * tell it what they learn. It forgets everything when the plugin restarts.
 */
export class Lamp {
  /** The lamp's id, from its serial number, as the settings and the pages name it. */
  readonly id: string;
  // The brightness cap learned, with the path the lamp had then: a lamp only moves to another power supply by being
  // plugged in again, which gives it a new path, so a cap learned at another path is forgotten.
  private brightnessCap: { path: string; lumen: number } | undefined;
  private brightnessCapReversalEnd = 0;
  private brightnessPosition: Position | undefined;
  private temperaturePosition: Position | undefined;

  /** A lamp, by its whole serial number and its model, such as "Beam". */
  constructor(
    readonly serialNumber: string,
    readonly model: string,
  ) {
    this.id = lampId(serialNumber);
  }

  /** The last 4 characters of the lamp's serial number, which the global settings keep. */
  get serialEnd(): string {
    return this.serialNumber.slice(-4);
  }

  /**
   * The lamp as the logs name it, such as "Beam …7K98": enough to tell lamps apart without writing the whole serial to
   * a file that may be shared (#41).
   */
  get logLabel(): string {
    return `${this.model} …${this.serialEnd}`;
  }

  /**
   * The lamp as the Deck and the settings pages name it, such as "Beam - 7K98", with a hyphen rather than the logs'
   * "…", which reads poorly there (#20).
   */
  get label(): string {
    return `${this.model} - ${this.serialEnd}`;
  }

  /**
   * The brightness cap learned since the lamp was plugged in at `path`, in lumens. One learned at another path is
   * forgotten, and logged as part of `operation`.
   */
  brightnessCapAt(operation: string, path: string): number | undefined {
    if (this.brightnessCap === undefined) {
      return undefined;
    }
    if (this.brightnessCap.path !== path) {
      logger.info(
        `${operation}: ${this.logLabel} was plugged in again, its cap of ${this.brightnessCap.lumen} lm is forgotten`,
      );
      this.brightnessCap = undefined;
      return undefined;
    }
    return this.brightnessCap.lumen;
  }

  /** The lumens to send the lamp, plugged in at `path`, for `lumen`: those, or its cap if it has a lower one. */
  withinBrightnessCap(operation: string, path: string, lumen: number): number {
    const cap = this.brightnessCapAt(operation, path);
    return cap === undefined ? lumen : Math.min(lumen, cap);
  }

  /**
   * Takes what the lamp reached for a brightness sent at `sentAt`, a time from `Date.now()`. A lamp that reached less
   * than it was sent is capped there, which is logged, and may go back to its cap for a while after the write.
   */
  brightnessReached(operation: string, path: string, sent: number, reached: number, sentAt: number): void {
    if (reached >= sent) {
      return;
    }
    this.brightnessCap = { path, lumen: reached };
    this.brightnessCapReversalEnd = Math.max(this.brightnessCapReversalEnd, sentAt + BRIGHTNESS_CAP_REVERSAL_WINDOW_MS);
    logger.info(`${operation}: ${this.logLabel} capped at ${reached} lm`);
  }

  /**
   * When the lamp may no longer go back to its brightness cap, as a time from `Date.now()`, or 0 if it never was
   * capped.
   */
  get brightnessCapReversalEndsAt(): number {
    return this.brightnessCapReversalEnd;
  }

  /**
   * Where the lamp steps its brightness from when it's kept apart: the position it was left at, in %, while it's still
   * at the lumens it was left at, or else `fallback`.
   */
  brightnessPositionAt(lumen: number, fallback: number): number {
    return Lamp.positionAt(this.brightnessPosition, lumen, fallback);
  }

  /** Leaves the lamp at a brightness position, in %, at `lumen`, or forgets its position when there's none. */
  leaveBrightness(position: number | undefined, lumen: number): void {
    this.brightnessPosition = position === undefined ? undefined : { position, left: lumen };
  }

  /**
   * Where the lamp steps its temperature from when it's kept apart: the position it was left at, in kelvin, while it's
   * still at the temperature it was left at, or else `fallback`.
   */
  temperaturePositionAt(kelvin: number, fallback: number): number {
    return Lamp.positionAt(this.temperaturePosition, kelvin, fallback);
  }

  /** Leaves the lamp at a temperature position at `kelvin`, or forgets its position when there's none. */
  leaveTemperature(position: number | undefined, kelvin: number): void {
    this.temperaturePosition = position === undefined ? undefined : { position, left: kelvin };
  }

  /** A position, while its lamp is still at the value it was left at, or else `fallback`. */
  private static positionAt(remembered: Position | undefined, value: number, fallback: number): number {
    return remembered !== undefined && remembered.left === value ? remembered.position : fallback;
  }
}
