import { type LampIdentity, lampId, lampLabel, lampLogLabel } from "./lamp-identity";
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
 * One lamp, and what the plugin remembers about it between operations (#198): who it is, as the global settings keep
 * it, its whole serial number once an operation has reached it, the brightness it can reach on a low-power supply, its
 * brightness cap (#55), when it may still go back to that cap, and where it would be if it's kept apart from the others
 * and an end stopped it (#145). It sends its lamp nothing: the operations do, and tell it what they learn. It forgets
 * all but who it is when the plugin restarts.
 */
export class Lamp {
  /** The lamp's id, from its serial number, as the settings and the pages name it. */
  readonly id: string;
  /** The lamp's model, such as "Beam". */
  readonly model: string;
  /** The last 4 characters of the lamp's serial number, which the global settings keep. */
  readonly serialEnd: string;
  private lampName: string | undefined;
  private wholeSerialNumber: string | undefined;
  // The brightness cap learned, with the path the lamp had then: a lamp only moves to another power supply by being
  // plugged in again, which gives it a new path, so a cap learned at another path is forgotten.
  private brightnessCap: { path: string; lumen: number } | undefined;
  private brightnessCapReversalEnd = 0;
  private brightnessPosition: Position | undefined;
  private temperaturePosition: Position | undefined;

  /** A lamp, as the global settings keep it, which no operation has reached yet. */
  constructor({ id, model, serialEnd, name }: LampIdentity) {
    this.id = id;
    this.model = model;
    this.serialEnd = serialEnd;
    this.lampName = name;
  }

  /** The name given to the lamp in the plugin settings, or undefined when it has none (#146). */
  get name(): string | undefined {
    return this.lampName;
  }

  /** Names the lamp, or takes its name away with undefined. The global settings are its only caller. */
  rename(name: string | undefined): void {
    this.lampName = name;
  }

  /** The lamp's whole serial number, once an operation has reached it, which the global settings don't keep. */
  get serialNumber(): string | undefined {
    return this.wholeSerialNumber;
  }

  /**
   * Takes the whole serial number of the lamp an operation reached. Throws when it isn't this lamp's, which would be a
   * bug: the operations find a lamp's `Lamp` by the id of its serial number.
   */
  reachedAs(serialNumber: string): void {
    if (lampId(serialNumber) !== this.id) {
      throw new Error(`Serial number …${serialNumber.slice(-4)} isn't lamp ${this.id}'s`);
    }
    this.wholeSerialNumber = serialNumber;
  }

  /**
   * The lamp as the logs name it, such as "Beam …7K98": enough to tell lamps apart without writing the whole serial to
   * a file that may be shared (#41).
   */
  get logLabel(): string {
    return lampLogLabel(this);
  }

  /**
   * The lamp as the Deck and the settings pages name it, such as "Beam - 7K98", with a hyphen rather than the logs'
   * "…", which reads poorly there (#20).
   */
  get label(): string {
    return lampLabel(this);
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
