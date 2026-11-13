import { createHash } from "node:crypto";
import type { LampHandle, LampRange } from "./lamp-connection";
import { logger as pluginLogger } from "./logging";

const logger = pluginLogger.createScope("Lamps");

/** How long a lamp that didn't answer what it set is given before it's asked again, in ms (#198). */
export const READ_AGAIN_MS = 10;

/**
 * How long a lamp may go back to its brightness cap after a write that went above it, in ms. Until then, a lower
 * brightness written in between can be undone, so the next brightness change waits.
 */
export const BRIGHTNESS_CAP_REVERSAL_WINDOW_MS = 1500;

/** A lamp's power, its brightness in lumens and its temperature in kelvin, as the plugin holds them (#198). */
export type LampState = {
  readonly on: boolean;
  readonly lumen: number;
  readonly kelvin: number;
};

/** A lamp an operation has reached since the plugin started, so its `Lamp` holds its state (see `Lamp.isReached`). */
export type ReachedLamp = Lamp & { readonly state: LampState };

/**
 * Waits, holding the thread, since the writes it follows are synchronous. Only a read that just failed waits, and only
 * for {@link READ_AGAIN_MS}.
 */
function pause(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * One lamp the plugin knows, plugged in or not, and what the plugin holds of it (#198): who it is, its id and model, as
 * the global settings keep them (#194), and the name given to it (#146), its state, as the plugin last set it and the
 * lamp reported it, the brightness it can reach on a low-power supply, its brightness cap (#55), when it may still go
 * back to that cap, and what it was last asked for when it's kept apart from the others (#145). It never holds the
 * lamp's serial number, only its id. It decides what its lamp is sent, and sends it through the lamp's connection, which
 * an operation lends it as a `LampHandle`, and acts on its own lamp alone. It forgets all but who it is when the plugin
 * restarts.
 */
export class Lamp {
  /** The lamp's id, from its serial number (see {@link Lamp.idOf}), by which the plugin knows it everywhere. */
  readonly id: string;
  /** The lamp's model, such as "Beam". */
  readonly model: string;
  private lampName: string | undefined;
  // The brightness cap learned, with the path the lamp had then: a lamp only moves to another power supply by being
  // plugged in again, which gives it a new path, so a cap learned at another path is forgotten.
  private brightnessCap: { path: string; lumen: number } | undefined;
  private brightnessCapReversalEnd = 0;
  // What a step of lamps kept apart last asked of the lamp (#145).
  private brightnessAskedFor: number | undefined;
  private temperatureAskedFor: number | undefined;
  // What the plugin holds of the lamp: its state, once read, the path it was last reached at, its range, and whether
  // the last operation that looked found it.
  private heldState: LampState | undefined;
  private reachedPath: string | undefined;
  private lampRange: LampRange | undefined;
  private found = false;

  /**
   * A lamp, by what the global settings keep of it, which no operation has reached yet, with no name until it's given
   * one.
   */
  constructor({ id, model }: Pick<Lamp, "id" | "model">) {
    this.id = id;
    this.model = model;
  }

  /**
   * A lamp's id, from its serial number: the first 16 hex characters of its SHA-256. The plugin reads the serial from
   * the lamp on every operation, and finds the lamp's `Lamp` by this id, the only thing it keeps of the serial. It names
   * the lamp wherever the plugin does, such as a key's settings, which travel with an exported profile, without
   * revealing the serial (#20).
   */
  static idOf(serialNumber: string): string {
    return createHash("sha256").update(serialNumber).digest("hex").slice(0, 16);
  }

  /**
   * The end of a lamp's id that the Deck, the pages and the logs show: its last 4 characters, enough to tell a few
   * lamps apart. It matches nothing printed on the lamp, which the plugin settings' Identify tells apart instead.
   */
  static idEndOf(id: string): string {
    return id.slice(-4);
  }

  /**
   * A lamp as the Deck, the settings pages and the logs name it, such as "Beam - c870": its model and the end of its id
   * (#20, #41). It names a lamp found that has no `Lamp` yet as well.
   */
  static labelOf({ model, id }: Pick<Lamp, "model" | "id">): string {
    return `${model} - ${Lamp.idEndOf(id)}`;
  }

  /**
   * Orders two lamps by their ids, the order the plugin goes through the lamps in: every operation, the lamp screens,
   * one tap after the other, and the settings pages, which sort the lamps they list the same way, in their own scripts.
   * An id is the same on every start, so the lamps always come in the same order, and the first one, whose temperature
   * the dials show and step from, is always the same lamp.
   */
  static byId(a: string, b: string): number {
    return a < b ? -1 : a > b ? 1 : 0;
  }

  /** The name given to the lamp in the plugin settings, or undefined when it has none (#146). */
  get name(): string | undefined {
    return this.lampName;
  }

  /** Names the lamp, or takes its name away with undefined. The global settings are its only writer. */
  set name(name: string | undefined) {
    this.lampName = name;
  }

  /** The lamp as the Deck, the settings pages and the logs name it, such as "Beam - c870" (see {@link Lamp.labelOf}). */
  get label(): string {
    return Lamp.labelOf(this);
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
        `${operation}: ${this.label} was plugged in again, its cap of ${this.brightnessCap.lumen} lm is forgotten`,
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
    logger.info(`${operation}: ${this.label} capped at ${reached} lm`);
  }

  /**
   * When the lamp may no longer go back to its brightness cap, as a time from `Date.now()`, or 0 if it never was
   * capped.
   */
  get brightnessCapReversalEndsAt(): number {
    return this.brightnessCapReversalEnd;
  }

  /**
   * The brightness, in %, a step of lamps kept apart last asked of the lamp (#145), which can be past an end of its
   * range or its cap, where it stopped. Its next step goes on from there, so it keeps its difference with the others.
   * Undefined until such a step, and once any other change sets the lamp's brightness.
   */
  get brightnessAsked(): number | undefined {
    return this.brightnessAskedFor;
  }

  /** Takes what a step of lamps kept apart asked of the lamp, or undefined when another change set its brightness. */
  set brightnessAsked(percentage: number | undefined) {
    this.brightnessAskedFor = percentage;
  }

  /**
   * The temperature, in kelvin, a step of lamps kept apart last asked of the lamp (#145), which can be past an end of
   * its range. Its next step goes on from there. Undefined until such a step, and once any other change sets the lamp's
   * temperature.
   */
  get temperatureAsked(): number | undefined {
    return this.temperatureAskedFor;
  }

  /** Takes what a step of lamps kept apart asked of the lamp, or undefined when another change set its temperature. */
  set temperatureAsked(kelvin: number | undefined) {
    this.temperatureAskedFor = kelvin;
  }

  /**
   * The lamp's power, brightness and temperature, as the plugin last set them and the lamp reported them (#198), or
   * undefined until the lamp is first reached.
   */
  get state(): LampState | undefined {
    return this.heldState;
  }

  /** Whether an operation has reached the lamp since the plugin started, so the plugin holds its state. */
  isReached(): this is ReachedLamp {
    return this.heldState !== undefined;
  }

  /** The lamp's range, once an operation has reached it. */
  get range(): LampRange | undefined {
    return this.lampRange;
  }

  /** Whether the last operation that looked for the lamp found it (#198). */
  get isConnected(): boolean {
    return this.found;
  }

  /** Where a brightness in lumens sits in the lamp's range, from 0 to 100, or 0 before the lamp is reached. */
  brightnessPercentage(lumen: number): number {
    return this.lampRange === undefined
      ? 0
      : Lamp.percentageInRange(lumen, this.lampRange.minLumen, this.lampRange.maxLumen);
  }

  /** The lumens the lamp is sent for a percentage of its range, as litra's setBrightnessPercentage sends them. */
  lumenAt(percentage: number): number {
    const { minLumen, maxLumen } = this.reachedRange();
    return Lamp.percentageToLumen(percentage, minLumen, maxLumen);
  }

  /** The lowest temperature the lamp allows, in kelvin, where its steps are counted from. */
  get lowestKelvin(): number {
    return this.temperatureLimits().lowest;
  }

  /** The highest temperature the lamp allows, in kelvin. */
  get highestKelvin(): number {
    return this.temperatureLimits().highest;
  }

  /**
   * The temperature the lamp allows nearest to `kelvin`, the one it lists first on a tie. Throws when it allows none.
   */
  snapKelvin(kelvin: number): number {
    let nearest: number | undefined;
    let nearestDelta = Infinity;
    for (const allowed of this.reachedRange().allowedKelvin) {
      const delta = Math.abs(kelvin - allowed);
      if (delta < nearestDelta) {
        nearest = allowed;
        nearestDelta = delta;
      }
    }
    if (nearest === undefined) {
      throw new Error(`${this.label} reports no allowed temperatures`);
    }
    return nearest;
  }

  /** Where a temperature sits between the lowest and the highest the lamp allows, from 0 to 100. */
  temperaturePercentage(kelvin: number): number {
    const { lowest, highest } = this.temperatureLimits();
    return Lamp.percentageInRange(kelvin, lowest, highest);
  }

  /** The lamp's range, which an operation learns when it reaches the lamp, so it's known before any change. */
  private reachedRange(): LampRange {
    if (this.lampRange === undefined) {
      throw new Error(`${this.label} has no range before it's reached`);
    }
    return this.lampRange;
  }

  /** The lowest and the highest temperature the lamp allows. Throws when it reports none. */
  private temperatureLimits(): { lowest: number; highest: number } {
    const { allowedKelvin } = this.reachedRange();
    const lowest = allowedKelvin[0];
    const highest = allowedKelvin.at(-1);
    if (lowest === undefined || highest === undefined) {
      throw new Error(`${this.label} reports no allowed temperatures`);
    }
    return { lowest, highest };
  }

  /**
   * Takes the lamp an operation found, and opened through `handle`, before the operation changes anything (#198): it's
   * connected, and it learns its range. It's read, and holds what it reads, the first time it's
   * reached, and again when it's reached at another path, since a lamp plugged in again may come back in another state,
   * or on another power supply, which forgets its cap.
   */
  reach(operation: string, handle: LampHandle): void {
    this.found = true;
    this.lampRange = handle.range;
    if (this.heldState === undefined) {
      this.reachedPath = handle.path;
      this.read(operation, handle, "it was first reached");
    } else if (handle.path !== this.reachedPath) {
      this.reachedPath = handle.path;
      this.brightnessCapAt(operation, handle.path);
      this.read(operation, handle, "it was plugged in again");
    }
  }

  /** Takes whether an operation that looked for the lamp found it (#198). */
  setFound(found: boolean): void {
    this.found = found;
  }

  /** Reads the lamp's power, brightness and temperature, holds them, and logs them with why it read them. */
  read(operation: string, handle: LampHandle, reason: string): void {
    this.lampRange = handle.range;
    const state = { on: handle.isOn(), lumen: handle.readBrightness(), kelvin: handle.readTemperature() };
    this.heldState = state;
    logger.info(
      `${operation}: ${this.label} read, since ${reason}: ${state.on ? "on" : "off"} at ${state.lumen} lm ` +
        `(${this.brightnessPercentage(state.lumen)}%) and ${state.kelvin} K`,
    );
  }

  /**
   * Turns the lamp on or off, and holds the power it then reports. A lamp turned on also reports its brightness and
   * temperature, and gets back the ones it holds, if it came back at others: a Beam LX turns on at the setting it saved
   * a few hundred ms after it was last switched off, and loses a temperature given while it was off (#100).
   */
  setPower(operation: string, handle: LampHandle, on: boolean): void {
    this.switchPower(operation, handle, on);
    logger.info(`${operation}: ${this.label} turned ${on ? "on" : "off"}`);
  }

  /**
   * Sends the lamp a brightness, or its cap if it has a lower one, without waiting for it to settle, and returns the
   * lumens sent. {@link readBackBrightness} takes what it reached, once it has settled.
   */
  sendBrightness(operation: string, handle: LampHandle, lumen: number): number {
    const sent = this.withinBrightnessCap(operation, handle.path, lumen);
    handle.writeBrightness(sent);
    return sent;
  }

  /**
   * Reads the brightness the lamp reached for the lumens sent at `sentAt`, a time from `Date.now()`, holds it, and
   * learns its cap if it fell short. Returns the lumens reached.
   */
  readBackBrightness(operation: string, handle: LampHandle, sent: number, sentAt: number): number {
    const reached = this.readBack(operation, "brightness", () => handle.readBrightness(), sent);
    logger.info(
      `${operation}: ${this.label} sent ${sent} lm, reached ${reached} lm (${this.brightnessPercentage(reached)}%)`,
    );
    this.brightnessReached(operation, handle.path, sent, reached, sentAt);
    this.heldState = { ...this.held(), lumen: reached };
    return reached;
  }

  /**
   * Sets the lamp to the temperature it allows nearest to `kelvin`, and holds the one it then reports, which it returns.
   * `asked` is what a step of lamps kept apart asked of the lamp (#145), which its next such step goes on from. Any
   * other change leaves it out, which forgets it.
   */
  setTemperature(operation: string, handle: LampHandle, kelvin: number, asked?: number): number {
    const allowed = this.snapKelvin(kelvin);
    handle.writeTemperature(allowed);
    const reached = this.readBack(operation, "temperature", () => handle.readTemperature(), allowed);
    logger.debug(`${operation}: ${this.label} at ${reached} K`);
    this.heldState = { ...this.held(), kelvin: reached };
    this.temperatureAsked = asked;
    logger.info(`${operation}: ${this.label} set to ${allowed} K`);
    return reached;
  }

  /**
   * Blinks the lamp, so the user can tell which one it is (#48): switches it the other way from the power it holds,
   * and back `blinkMs` later (#171).
   */
  async blink(operation: string, handle: LampHandle, blinkMs: number): Promise<void> {
    const { on } = this.held();
    this.switchPower(operation, handle, !on);
    await new Promise((resolve) => setTimeout(resolve, blinkMs));
    this.switchPower(operation, handle, on);
    logger.info(`${operation}: ${this.label} blinked`);
  }

  /** Switches the lamp, holds the power it then reports, and puts back the setting a lamp turned on lost. */
  private switchPower(operation: string, handle: LampHandle, on: boolean): void {
    const held = this.held();
    handle.switchPower(on);
    const reached = this.readBack(operation, "power", () => handle.isOn(), on);
    logger.debug(`${operation}: ${this.label} is ${reached ? "on" : "off"}`);
    this.heldState = { ...held, on: reached };
    if (on) {
      this.putBackSetting(operation, handle, held);
    }
  }

  /**
   * Gives a lamp just turned on back the brightness and temperature it holds, if it reports others. A Beam turns on as
   * it was, and gets nothing written.
   */
  private putBackSetting(operation: string, handle: LampHandle, held: LampState): void {
    const lumen = this.readBack(operation, "brightness", () => handle.readBrightness(), held.lumen);
    const kelvin = this.readBack(operation, "temperature", () => handle.readTemperature(), held.kelvin);
    if (lumen === held.lumen && kelvin === held.kelvin) {
      return;
    }
    if (kelvin !== held.kelvin) {
      handle.writeTemperature(held.kelvin);
    }
    if (lumen !== held.lumen) {
      handle.writeBrightness(held.lumen);
    }
    logger.info(
      `${operation}: ${this.label} turned on at ${lumen} lm and ${kelvin} K, put back to ${held.lumen} lm and ` +
        `${held.kelvin} K`,
    );
    this.heldState = {
      ...this.held(),
      lumen: this.readBack(operation, "brightness", () => handle.readBrightness(), held.lumen),
      kelvin: this.readBack(operation, "temperature", () => handle.readTemperature(), held.kelvin),
    };
  }

  /**
   * The second trip of a value the lamp was set to (#198): what the lamp reports. One that doesn't answer is asked
   * again after {@link READ_AGAIN_MS}, and when it still doesn't, the value asked for is what the plugin holds. Both
   * are logged.
   */
  private readBack<T>(operation: string, what: string, read: () => T, asked: T): T {
    try {
      return read();
    } catch (error) {
      logger.warn(`${operation}: ${this.label} didn't report its ${what}, so it's read again: ${String(error)}`);
    }
    pause(READ_AGAIN_MS);
    try {
      return read();
    } catch (error) {
      logger.warn(
        `${operation}: ${this.label} didn't report its ${what} again, so it holds the ${what} asked for, ` +
          `${String(asked)}: ${String(error)}`,
      );
      return asked;
    }
  }

  /** The state the plugin holds, which an operation reads by reaching the lamp before it changes it. */
  private held(): LampState {
    if (this.heldState === undefined) {
      throw new Error(`${this.label} was changed before it was reached`);
    }
    return this.heldState;
  }

  /** Where a value sits in a range, from 0 to 100, such as a brightness in lumens or a temperature in kelvin. */
  private static percentageInRange(value: number, min: number, max: number): number {
    if (max <= min) {
      return 0;
    }
    return Math.max(0, Math.min(100, Math.round(((value - min) / (max - min)) * 100)));
  }

  /**
   * The lumens litra's setBrightnessPercentage sends for a percentage. Mirrors litra's percentageWithinRange, which
   * isn't exported.
   */
  private static percentageToLumen(percentage: number, min: number, max: number): number {
    return Math.ceil((percentage / 100) * (max - min) + min);
  }
}
