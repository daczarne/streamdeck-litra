import { createHash } from "node:crypto";

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

import { logger as pluginLogger } from "./logging";

type ClosableHid = {
  write: (values: number[] | Buffer) => number;
  readSync: () => number[];
  readTimeout: (timeout: number) => number[];
  close: () => void;
  getDeviceInfo: () => { path?: string | undefined };
};

export type BroadcastResult = {
  ok: boolean;
  deviceCount: number;
  failures: number;
  representativeBrightnessPercentage?: number | undefined;
  representativeBrightnessLumen?: number | undefined;
  /** Every lamp's brightness, in % of its range, for the lamps that could be read. */
  brightnessPercentages?: number[];
  representativeTemperatureKelvin?: number | undefined;
  representativeTemperaturePercentage?: number | undefined;
};

/** Which lamps an operation acts on: every lamp connected, or the ones with these ids (see {@link lampId}, #20). */
export type LampSelection = "all" | readonly string[];

/**
 * How a step moves several lamps (#145): `"together"` sends every lamp to one value, stepped from the one the dial
 * shows, which brings lamps set apart back in sync, and `"each"` steps every lamp from its own value, which keeps them
 * apart. A lamp at an end of its range, or at its cap, stays there while the others keep going, and comes back with
 * them, as {@link stepApart} plans it.
 */
export type Stepping = "together" | "each";

/**
 * Where a brightness change sends the lamps: one value for every lamp, in % of their range, or ticks of a step, taken
 * together from the brightest lamp's value, or by each lamp from its own.
 */
type BrightnessTarget = number | { stepping: Stepping; ticks: number; step: number };

/** A connected lamp, as a settings page lists it (#20). */
export type FoundLamp = {
  id: string;
  /** Its model and the last 4 characters of its serial number, such as "Beam - 7K98". */
  label: string;
  /** Its model, such as "Beam", which the plugin settings list apart from the end of its serial (#146). */
  model: string;
  /** The last 4 characters of its serial number, such as "7K98". */
  serialEnd: string;
};

/** What a lamp screen shows about one lamp (#48). */
export type LampStatus = {
  id: string;
  serialNumber: string;
  model: string;
  /** Its name on the Deck, as on the keys' settings pages, such as "Beam - 7K98" (see {@link FoundLamp}). */
  label: string;
  on: boolean;
  brightnessLumen: number;
  brightnessPercentage: number;
  temperatureKelvin: number;
};

const logger = pluginLogger.createScope("Lamps");
const DIAL_DEBOUNCE_MS = 60;

// litra names each model "Logitech Litra …", too long for the touch strip.
const MODEL_BY_DEVICE_TYPE: Record<DeviceType, string> = {
  [DeviceType.LitraGlow]: "Glow",
  [DeviceType.LitraBeam]: "Beam",
  [DeviceType.LitraBeamLX]: "Beam LX",
};

// A capped lamp applies its cap within about 100 ms of a write, and until then reports the brightness it was sent.
const BRIGHTNESS_SETTLE_MS = 250;

// A capped lamp can go back to its cap up to 1.25 s after a request above it, undoing a lower brightness written in
// between (#55). A later write stays, so a brightness change waits until this long after such a request.
const CAP_REVERSAL_WINDOW_MS = 1500;

// A lamp fades out when switched off, in about 750 ms at any brightness. A 300 ms blink brought it back before it had
// dimmed enough to notice, which with other lamps on hid it, while 600 ms shows even at full brightness, and each tap
// through the lamp screens waits less than for the whole fade (#171).
const IDENTIFY_BLINK_MS = 600;

// Reports a lamp sends unasked (ACKs, change notices, error reports) can arrive ahead of the reply to a query.
const MAX_SKIPPED_REPORTS = 10;

/**
 * The brightness each lamp on a low-power supply can reach, in lumens, by serial number, with the path the lamp had
 * when it was learned. Learned when a lamp reaches less than it was sent. A lamp only moves to another power supply by
 * being plugged in again, which gives it a new path, so a cap is forgotten once its lamp has another path (#55).
 */
const brightnessCaps = new Map<string, { path: string; lumen: number }>();

/**
 * Where a lamp kept apart would be if no end of its range or cap had stopped it, with the value it was left at: in % and
 * lumens for the brightness, in kelvin for the temperature (#145).
 */
type Position = { position: number; left: number };

/**
 * The positions of the lamps kept apart, by serial number, which their next step goes on from, so lamps stopped by an
 * end keep their difference. A position is only used while its lamp is still at the value it was left at, and every
 * other change to that value forgets it, so a lamp moved by anything else steps from where it is.
 */
const brightnessPositions = new Map<string, Position>();
const temperaturePositions = new Map<string, Position>();

/** Where a lamp kept apart steps from: the position it was left at, if it's still there, or else the value it's at. */
function positionOf(positions: Map<string, Position>, device: Device, value: number, fallback: number): number {
  const remembered = positions.get(device.serialNumber);
  return remembered !== undefined && remembered.left === value ? remembered.position : fallback;
}

/**
 * When a lamp may still go back to its cap, as a time from `Date.now()`: {@link CAP_REVERSAL_WINDOW_MS} after the
 * last write that went above a lamp's cap. Brightness changes wait until then.
 */
let capReversalEndsAt = 0;

/**
 * The last brightness change, or blink, queued by {@link oneBrightnessChangeAtATime}, which the next one waits for.
 */
let brightnessChanges: Promise<unknown> = Promise.resolve();

const lampsChangedListeners: Array<() => void | Promise<void>> = [];

/**
 * Registers a listener called after every operation that writes to the lamps, whichever action asked for it, so that
 * everything the Deck shows about the lamps can follow (#57). A brightness change calls it once it has settled and left
 * the queue. Returns a function that removes the listener.
 */
export function onLampsChanged(listener: () => void | Promise<void>): () => void {
  lampsChangedListeners.push(listener);
  return () => {
    const index = lampsChangedListeners.indexOf(listener);
    if (index !== -1) {
      lampsChangedListeners.splice(index, 1);
    }
  };
}

/**
 * Calls every listener once the current operation has returned, and its handles are closed. A failed operation is
 * announced too, since it may have written to some lamps, and finding none is news as well.
 */
function announceLampsChanged(): void {
  for (const listener of [...lampsChangedListeners]) {
    Promise.resolve()
      .then(listener)
      .catch((error: unknown) => {
        logger.error("Lamps changed listener failed", error);
      });
  }
}

/** Announces that the lamps changed, and passes on the result of the operation that changed them. */
function announced<T>(result: T): T {
  announceLampsChanged();
  return result;
}

/**
 * A lamp as the logs name it: its model and the end of its serial number, enough to tell lamps apart without writing
 * the whole serial to a file that may be shared (#41).
 */
function lampLabel(device: Device): string {
  return `${MODEL_BY_DEVICE_TYPE[device.type]} ${serialTail(device.serialNumber)}`;
}

/**
 * A lamp's id: the first 16 hex characters of its serial number's SHA-256. It tells lamps apart wherever the plugin
 * names a lamp outside its own process, such as a key's settings, which travel with an exported profile, without
 * revealing the serial (#20).
 */
export function lampId(serialNumber: string): string {
  return createHash("sha256").update(serialNumber).digest("hex").slice(0, 16);
}

/**
 * A lamp as the Deck and the settings pages name it, such as "Beam - 7K98": its model and the last 4 characters of its
 * serial number, as the logs name it, with a hyphen rather than the logs' "…", which reads poorly there (#20).
 */
function displayLabel(device: Device): string {
  return `${MODEL_BY_DEVICE_TYPE[device.type]} - ${device.serialNumber.slice(-4)}`;
}

/** The last 4 characters of a serial number, marked as a tail. */
function serialTail(serialNumber: string): string {
  return `…${serialNumber.slice(-4)}`;
}

/** Logs a lamp's part in an operation failing. The other lamps carry on. */
function logLampFailure(operation: string, device: Device, error: unknown): void {
  logger.error(`${operation}: ${lampLabel(device)} failed: ${String(error)}`);
}

/** A lamp's HID handle with the methods node-hid has at runtime, which litra's type leaves out. */
function asHid(device: Device): ClosableHid {
  return device.hid as ClosableHid;
}

/**
 * Reads the ACK a write leaves on the handle, so that a read on the same handle afterwards gets its reply rather than
 * the ACK: litra's isOn and getTemperatureInKelvin take the first report that arrives. Every write gets an ACK within a
 * few ms, so the drain returns as soon as it arrives, and an ACK left on a handle is gone once the handle closes
 * (`scripts/probes/write-reports.mjs`, #96). No operation reads after a write on the same handle today: the drain is a
 * guard for one that does.
 */
function drainAck(device: Device): void {
  try {
    asHid(device).readTimeout(50);
  } catch {
    // nothing pending
  }
}

/**
 * litra's Device.hid type omits close(); runtime is node-hid HID.
 */
function closeDevice(device: Device): void {
  try {
    asHid(device).close();
  } catch (error) {
    logger.warn(`Closing ${lampLabel(device)} failed: ${String(error)}`);
  }
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
export function getBrightnessInLumenSafe(device: Device): number {
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

/** Where a lamp is plugged in: the path the system gave it, which changes each time it's plugged in. */
function plugPath(device: Device): string {
  return asHid(device).getDeviceInfo().path ?? "";
}

/** The cap learned for a lamp since it was last plugged in. One learned before that is forgotten. */
function learnedCap(operation: string, device: Device): number | undefined {
  const cap = brightnessCaps.get(device.serialNumber);
  if (cap === undefined) {
    return undefined;
  }
  if (cap.path !== plugPath(device)) {
    brightnessCaps.delete(device.serialNumber);
    logger.info(`${operation}: ${lampLabel(device)} was plugged in again, its cap of ${cap.lumen} lm is forgotten`);
    return undefined;
  }
  return cap.lumen;
}

/** The lumens to send a lamp: the ones asked for, or its cap if it has a lower one. */
function withinCap(operation: string, device: Device, lumen: number): number {
  const cap = learnedCap(operation, device);
  return cap === undefined ? lumen : Math.min(lumen, cap);
}

/** Where a value sits in a lamp's range, from 0 to 100, such as a brightness in lumens or a temperature in kelvin. */
export function percentageInRange(value: number, min: number, max: number): number {
  if (max <= min) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.round(((value - min) / (max - min)) * 100)));
}

/**
 * The lumens litra's setBrightnessPercentage sends for a percentage. Mirrors litra's percentageWithinRange, which
 * isn't exported.
 */
export function percentageToLumen(percentage: number, min: number, max: number): number {
  return Math.ceil((percentage / 100) * (max - min) + min);
}

/**
 * Moves a value by a number of steps along the grid min, min + step, min + 2 × step, …, clamped to min–max, so a dial
 * stops on the same values going up as going down (#14, #16). From a value off the grid, such as a lamp's cap or a
 * clamped end, the first step goes to the grid's next value in the direction of the turn.
 */
export function stepOnGrid(value: number, ticks: number, step: number, min: number, max: number): number {
  const clamp = (x: number): number => Math.max(min, Math.min(max, x));
  if (ticks === 0 || !(step > 0)) {
    return clamp(value);
  }
  return clamp(stepAlongGrid(value, ticks, step, min));
}

/**
 * Moves a value by a number of steps along the grid origin, origin + step, origin + 2 × step, …, which goes on past
 * either end. From a value off the grid, the first step goes to the grid's next value in the direction of the turn.
 */
function stepAlongGrid(value: number, ticks: number, step: number, origin: number): number {
  const position = (value - origin) / step;
  const index = ticks > 0 ? Math.floor(position) + ticks : Math.ceil(position) + ticks;
  return origin + index * step;
}

/** A lamp kept apart, as {@link stepApart} plans its steps. */
type ApartLamp = {
  /** Where the lamp would be if no end had stopped it. */
  position: number;
  /** What the lamp is at, in what it's sent. */
  value: number;
  /** What the lamp is sent for a position: the value within its range, and its cap. */
  reach: (position: number) => number;
  /** Where the lamp's grid starts: the bottom of its range. */
  origin: number;
  /** How far the lamp's range goes from its origin, which bounds the search for its ends. */
  span: number;
};

/**
 * How many steps a lamp's position is past its end in a direction: how far it can go back and still be held there. A
 * lamp can get there when a turn was planned before its cap was learned.
 */
function stepsPastEnd(lamp: ApartLamp, step: number, direction: 1 | -1): number {
  const end = lamp.reach(direction * Infinity);
  const bound = Math.ceil((Math.abs(lamp.position - lamp.origin) + lamp.span) / step);
  let steps = 0;
  while (steps < bound && lamp.reach(lamp.position - direction * (steps + 1) * step) === end) {
    steps += 1;
  }
  return lamp.reach(lamp.position) === end ? steps : 0;
}

/**
 * Plans the steps of lamps kept apart (#145), a tick at a time. Every lamp's position moves along the grid, and the
 * lamp goes as far towards it as it can, so one stopped by an end of its range or its cap stays there while the others
 * keep going, and comes back with them once they've retraced the way. A tick counts only while a lamp still moves, so
 * turning on once every lamp is at its end does nothing, rather than piling up steps to undo, and steps piled up while
 * a cap wasn't known yet are dropped before the next turn. Returns each lamp's new position.
 */
function stepApart<T extends ApartLamp>(lamps: T[], ticks: number, step: number): number[] {
  let state = lamps;
  const direction = Math.sign(ticks);
  if (step > 0 && state.length > 0) {
    // Lamps all past their ends in a direction come back together by the steps they all have past them, which keeps
    // their difference, and lets the next tick the other way move one of them.
    for (const end of [1, -1] as const) {
      const past = Math.min(...state.map((lamp) => stepsPastEnd(lamp, step, end)));
      if (past > 0) {
        state = state.map((lamp) => ({ ...lamp, position: lamp.position - end * past * step }));
      }
    }
    for (let tick = 0; tick < Math.abs(ticks); tick++) {
      let moved = false;
      const next = state.map((lamp) => {
        const position = stepAlongGrid(lamp.position, direction, step, lamp.origin);
        const value = lamp.reach(position);
        moved ||= (value - lamp.value) * direction > 0;
        return { ...lamp, position, value };
      });
      if (!moved) {
        break;
      }
      state = next;
    }
  }
  return state.map((lamp) => lamp.position);
}

/** The allowed temperature nearest to a value, or the value itself when none is allowed. */
export function snapKelvin(value: number, allowed: number[]): number {
  let best = value;
  let bestDelta = Infinity;
  for (const candidate of allowed) {
    const delta = Math.abs(value - candidate);
    if (delta < bestDelta) {
      best = candidate;
      bestDelta = delta;
    }
  }
  return best;
}

/** Where a temperature sits between the lowest and the highest allowed for a lamp, from 0 to 100. */
function temperaturePercentage(kelvin: number, allowed: number[]): number {
  const lowest = allowed[0];
  const highest = allowed.at(-1);
  if (lowest === undefined || highest === undefined) {
    return 0;
  }
  return percentageInRange(kelvin, lowest, highest);
}

/**
 * Opens the lamps an operation acts on, named in the logs: every connected lamp, or the selected ones, closing the
 * others. A selected lamp that isn't connected is logged, and so is a selection of none. Returns none when no lamp is
 * selected or connected, none of the selected ones is, or finding them fails.
 */
function openDevices(operation: string, lamps: LampSelection): Device[] {
  if (lamps !== "all" && lamps.length === 0) {
    logger.warn(`${operation}: no lamp selected`);
    return [];
  }
  let devices: Device[];
  try {
    devices = findDevices();
  } catch (error) {
    logger.error(`${operation}: finding the lamps failed: ${String(error)}`);
    return [];
  }
  if (devices.length === 0) {
    logger.warn(`${operation}: no lamps found`);
    return devices;
  }
  if (lamps === "all") {
    return devices;
  }
  const selected = devices.filter((device) => lamps.includes(lampId(device.serialNumber)));
  for (const device of devices) {
    if (!selected.includes(device)) {
      closeDevice(device);
    }
  }
  for (const id of lamps) {
    if (!selected.some((device) => lampId(device.serialNumber) === id)) {
      logger.warn(`${operation}: lamp ${id} not connected`);
    }
  }
  return selected;
}

/**
 * Open the selected devices, run fn per device, always close handles. Zero devices = failure. The operation names the
 * call in the logs, and fn logs what it did to each lamp.
 */
export function forEachDevice(operation: string, fn: (device: Device) => void, lamps: LampSelection): BroadcastResult {
  const devices = openDevices(operation, lamps);
  if (devices.length === 0) {
    return { ok: false, deviceCount: 0, failures: 1 };
  }

  let failures = 0;
  for (const device of devices) {
    try {
      fn(device);
    } catch (error) {
      failures += 1;
      logLampFailure(operation, device, error);
    } finally {
      closeDevice(device);
    }
  }

  return {
    ok: failures === 0,
    deviceCount: devices.length,
    failures,
  };
}

/** Turns the selected lamps on. */
export function turnLampsOn(lamps: LampSelection): BroadcastResult {
  const operation = "turn on";
  return announced(
    forEachDevice(
      operation,
      (device) => {
        turnOn(device);
        drainAck(device);
        logger.info(`${operation}: ${lampLabel(device)} turned on`);
      },
      lamps,
    ),
  );
}

/** Turns the selected lamps off. */
export function turnLampsOff(lamps: LampSelection): BroadcastResult {
  const operation = "turn off";
  return announced(
    forEachDevice(
      operation,
      (device) => {
        turnOff(device);
        drainAck(device);
        logger.info(`${operation}: ${lampLabel(device)} turned off`);
      },
      lamps,
    ),
  );
}

/**
 * Turns the selected lamps off if every one is on, and on otherwise, so lamps out of sync end up in sync (#23). That's
 * the opposite of what {@link areLampsOn} reports, which the Power key shows. A lamp that can't be read counts as off,
 * as in {@link areLampsOn}, and is still sent the command.
 */
export function toggleLamps(lamps: LampSelection): BroadcastResult {
  const operation = "toggle";
  const devices = openDevices(operation, lamps);
  if (devices.length === 0) {
    return announced({ ok: false, deviceCount: 0, failures: 1 });
  }

  // A lamp that fails both stages is counted once.
  const failed = new Set<Device>();
  const attempt = <T>(device: Device, fn: () => T, fallback: T): T => {
    try {
      return fn();
    } catch (error) {
      failed.add(device);
      logLampFailure(operation, device, error);
      return fallback;
    }
  };

  try {
    const allOn = devices.map((device) => attempt(device, () => isOn(device), false)).every(Boolean);
    for (const device of devices) {
      attempt(
        device,
        () => {
          if (allOn) {
            turnOff(device);
          } else {
            turnOn(device);
          }
          drainAck(device);
          logger.info(`${operation}: ${lampLabel(device)} turned ${allOn ? "off" : "on"}`);
        },
        undefined,
      );
    }
    return announced({ ok: failed.size === 0, deviceCount: devices.length, failures: failed.size });
  } finally {
    for (const device of devices) {
      closeDevice(device);
    }
  }
}

/**
 * On only if at least one selected device and every one reports on. Waits for the brightness change in progress, if
 * any, which holds the lamps open until it has read them back.
 */
export async function areLampsOn(lamps: LampSelection): Promise<{ ok: boolean; allOn: boolean; deviceCount: number }> {
  await brightnessChanges;
  const operation = "read power";
  const devices = openDevices(operation, lamps);
  if (devices.length === 0) {
    return { ok: false, allOn: false, deviceCount: 0 };
  }

  let allOn = true;
  let failures = 0;
  for (const device of devices) {
    try {
      const on = isOn(device);
      logger.debug(`${operation}: ${lampLabel(device)} is ${on ? "on" : "off"}`);
      if (!on) {
        allOn = false;
      }
    } catch (error) {
      failures += 1;
      allOn = false;
      logLampFailure(operation, device, error);
    } finally {
      closeDevice(device);
    }
  }

  return { ok: failures === 0, allOn, deviceCount: devices.length };
}

/** Ensure the device is powered on before a brightness change is visible. */
function ensureOn(operation: string, device: Device): void {
  if (!isOn(device)) {
    turnOn(device);
    drainAck(device);
    logger.info(`${operation}: ${lampLabel(device)} turned on`);
  }
}

/** Where a brightness in lumens sits in a lamp's range, from 0 to 100. */
function brightnessPercentage(device: Device, lumen: number): number {
  return percentageInRange(
    lumen,
    getMinimumBrightnessInLumenForDevice(device),
    getMaximumBrightnessInLumenForDevice(device),
  );
}

/** The lumens litra sends a lamp for a percentage of its range. */
function brightnessLumen(device: Device, percentage: number): number {
  return percentageToLumen(
    percentage,
    getMinimumBrightnessInLumenForDevice(device),
    getMaximumBrightnessInLumenForDevice(device),
  );
}

/**
 * Sets the selected lamps to the percentage, and reports the brightest once they've settled, as
 * {@link moveLampsBrightness} does. A lamp at its cap stays there, so the report can be lower than the percentage.
 */
export function setLampsBrightness(
  lamps: LampSelection,
  percentage: number,
  settleMs = BRIGHTNESS_SETTLE_MS,
): Promise<BroadcastResult> {
  return oneBrightnessChangeAtATime(() => moveLampsBrightness("set brightness", lamps, percentage, settleMs)).finally(
    announceLampsChanged,
  );
}

/**
 * Steps the selected lamps' brightness along the multiples of the step, as {@link moveLampsBrightness} does: together,
 * to one target stepped from the brightest of them, or each from its own brightness, as {@link stepApart} plans it
 * (#145).
 */
export function adjustLampsBrightness(
  lamps: LampSelection,
  ticks: number,
  stepPercentage: number,
  stepping: Stepping = "together",
  settleMs = BRIGHTNESS_SETTLE_MS,
): Promise<BroadcastResult> {
  return oneBrightnessChangeAtATime(() =>
    moveLampsBrightness("adjust brightness", lamps, { stepping, ticks, step: stepPercentage }, settleMs),
  ).finally(announceLampsChanged);
}

/**
 * Turns the selected lamps on and sets each to a scene in one pass: the temperature, snapped to one the lamp allows,
 * then the percentage, as {@link setLampsBrightness} sets it, caps included. Reports the brightest once they've
 * settled, as {@link moveLampsBrightness} does, and announces the change once.
 */
export function setLampsScene(
  lamps: LampSelection,
  percentage: number,
  kelvin: number,
  settleMs = BRIGHTNESS_SETTLE_MS,
): Promise<BroadcastResult> {
  return oneBrightnessChangeAtATime(() =>
    moveLampsBrightness("set scene", lamps, percentage, settleMs, kelvin),
  ).finally(announceLampsChanged);
}

/**
 * Runs brightness changes one at a time, in the order they were asked for. A change holds the lamps open while they
 * settle, and its read-back would take a later change's lower write for a cap. {@link identifyLamp} goes through it
 * too, since it holds a lamp open during its blink.
 */
function oneBrightnessChangeAtATime(change: () => Promise<BroadcastResult>): Promise<BroadcastResult> {
  const result = brightnessChanges.then(change);
  brightnessChanges = result.catch(() => undefined);
  return result;
}

/**
 * Runs an operation's stages on each lamp: a lamp that fails one stage is logged, left out of the next ones and counted
 * once in `failed`.
 */
function inStages(operation: string): { failed: Set<Device>; attempt: (device: Device, fn: () => void) => void } {
  const failed = new Set<Device>();
  const attempt = (device: Device, fn: () => void): void => {
    if (failed.has(device)) {
      return;
    }
    try {
      fn();
    } catch (error) {
      failed.add(device);
      logLampFailure(operation, device, error);
    }
  };
  return { failed, attempt };
}

/**
 * Moves the selected lamps to their target and reports the brightest once they've settled. The target is a percentage,
 * or a step from the brightest selected lamp's percentage or from each lamp's own, which are then read first. A
 * temperature, when given, is set on each lamp before its brightness. Each lamp is sent the target or its cap, whichever is lower, and a lamp that reaches less
 * than it was sent has its cap learned. Right after a lamp's cap is learned, the next change waits until the lamp can
 * no longer go back to its cap (see {@link capReversalEndsAt}). The lamps stay open from the first read to the last,
 * so calls mustn't overlap: they go through {@link oneBrightnessChangeAtATime}.
 */
async function moveLampsBrightness(
  operation: string,
  lamps: LampSelection,
  target: BrightnessTarget,
  settleMs: number,
  kelvin?: number,
): Promise<BroadcastResult> {
  const reversalMs = capReversalEndsAt - Date.now();
  if (reversalMs > 0) {
    logger.debug(`${operation}: waiting ${reversalMs} ms, until no lamp can go back to its cap`);
    await new Promise((resolve) => setTimeout(resolve, reversalMs));
  }

  const devices = openDevices(operation, lamps);
  if (devices.length === 0) {
    return { ok: false, deviceCount: 0, failures: 1 };
  }

  const { failed, attempt } = inStages(operation);

  try {
    // Each lamp's brightness in lumens before the change, read only when the target steps from it.
    const before = new Map<Device, number>();
    for (const device of devices) {
      attempt(device, () => {
        ensureOn(operation, device);
        if (kelvin !== undefined) {
          setSnappedTemperature(operation, device, kelvin);
        }
        if (typeof target !== "number") {
          before.set(device, getBrightnessInLumenSafe(device));
        }
      });
    }

    // The percentage to send each lamp. A lamp that couldn't be read gets none when the target steps, and when none
    // could, nothing is sent. Lamps kept apart also get their new positions.
    const targets = new Map<Device, number>();
    const positions = new Map<Device, number>();
    const clamp = (percentage: number): number => Math.max(0, Math.min(100, percentage));
    if (typeof target === "number") {
      for (const device of devices) {
        targets.set(device, clamp(target));
      }
    } else if (target.stepping === "together") {
      const levels = [...before].map(([device, lumen]) => brightnessPercentage(device, lumen));
      if (levels.length > 0) {
        const stepped = stepOnGrid(Math.max(...levels), target.ticks, target.step, 0, 100);
        for (const device of devices) {
          targets.set(device, stepped);
        }
      }
    } else {
      const apart = [...before].map(([device, lumen]) => ({
        device,
        position: positionOf(brightnessPositions, device, lumen, brightnessPercentage(device, lumen)),
        value: lumen,
        reach: (position: number) => withinCap(operation, device, brightnessLumen(device, clamp(position))),
        origin: 0,
        span: 100,
      }));
      const stepped = stepApart(apart, target.ticks, target.step);
      apart.forEach(({ device }, index) => {
        const position = stepped[index] ?? 0;
        positions.set(device, position);
        targets.set(device, clamp(position));
      });
    }

    const sent = new Map<Device, number>();
    const sentAt = Date.now();
    if (targets.size > 0) {
      for (const [device, pct] of targets) {
        attempt(device, () => {
          const lumen = withinCap(operation, device, brightnessLumen(device, pct));
          setBrightnessInLumen(device, lumen);
          drainAck(device);
          sent.set(device, lumen);
        });
      }
      await new Promise((resolve) => setTimeout(resolve, settleMs));
    }

    let representative: number | undefined;
    let representativeLumen: number | undefined;
    const percentages: number[] = [];
    for (const [device, lumen] of sent) {
      attempt(device, () => {
        const reached = getBrightnessInLumenSafe(device);
        const pct = brightnessPercentage(device, reached);
        logger.info(`${operation}: ${lampLabel(device)} sent ${lumen} lm, reached ${reached} lm (${pct}%)`);
        if (reached < lumen) {
          brightnessCaps.set(device.serialNumber, { path: plugPath(device), lumen: reached });
          capReversalEndsAt = Math.max(capReversalEndsAt, sentAt + CAP_REVERSAL_WINDOW_MS);
          logger.info(`${operation}: ${lampLabel(device)} capped at ${reached} lm`);
        }
        // A lamp kept apart is left at its position, which any other change forgets.
        const position = positions.get(device);
        if (position === undefined) {
          brightnessPositions.delete(device.serialNumber);
        } else {
          brightnessPositions.set(device.serialNumber, { position, left: reached });
        }
        percentages.push(pct);
        if (representative === undefined || pct > representative) {
          representative = pct;
          representativeLumen = reached;
        }
      });
    }

    return {
      ok: failed.size === 0,
      deviceCount: devices.length,
      failures: failed.size,
      representativeBrightnessPercentage: representative,
      representativeBrightnessLumen: representativeLumen,
      brightnessPercentages: percentages,
    };
  } finally {
    for (const device of devices) {
      closeDevice(device);
    }
  }
}

/**
 * Reads the selected lamps and reports the brightest, and each one's percentage. Waits for the brightness change in
 * progress, if any, which holds the lamps open until it has read them back.
 */
export async function readLampsBrightness(lamps: LampSelection): Promise<BroadcastResult> {
  await brightnessChanges;
  let representative: number | undefined;
  let representativeLumen: number | undefined;
  const percentages: number[] = [];
  const operation = "read brightness";
  const result = forEachDevice(
    operation,
    (device) => {
      const lumen = getBrightnessInLumenSafe(device);
      const pct = brightnessPercentage(device, lumen);
      logger.debug(`${operation}: ${lampLabel(device)} at ${lumen} lm (${pct}%)`);
      percentages.push(pct);
      if (representative === undefined || pct > representative) {
        representative = pct;
        representativeLumen = lumen;
      }
    },
    lamps,
  );
  return {
    ...result,
    representativeBrightnessPercentage: representative,
    representativeBrightnessLumen: representativeLumen,
    brightnessPercentages: percentages,
  };
}

/**
 * Reads every lamp for the lamp screens, sorted by serial number, since findDevices lists them in no fixed order. A
 * lamp that can't be read is left out. Waits for the brightness change in progress, if any, which holds the lamps open
 * until it has read them back.
 */
export async function readLampStatuses(): Promise<{ ok: boolean; lamps: LampStatus[] }> {
  await brightnessChanges;
  const lamps: LampStatus[] = [];
  const operation = "read lamp status";
  const result = forEachDevice(
    operation,
    (device) => {
      const on = isOn(device);
      const temperatureKelvin = getTemperatureInKelvin(device);
      const brightnessLumen = getBrightnessInLumenSafe(device);
      const percentage = brightnessPercentage(device, brightnessLumen);
      logger.debug(
        `${operation}: ${lampLabel(device)} is ${on ? "on" : "off"}, at ${brightnessLumen} lm (${percentage}%) ` +
          `and ${temperatureKelvin} K`,
      );
      lamps.push({
        id: lampId(device.serialNumber),
        serialNumber: device.serialNumber,
        model: MODEL_BY_DEVICE_TYPE[device.type],
        label: displayLabel(device),
        on,
        brightnessLumen,
        brightnessPercentage: percentage,
        temperatureKelvin,
      });
    },
    "all",
  );
  lamps.sort((a, b) => bySerialNumber(a.serialNumber, b.serialNumber));
  return { ok: result.ok, lamps };
}

/**
 * Lists the connected lamps for the settings pages, sorted by serial number as the lamp screens are (#20), with what the
 * keys' lamp pickers and the plugin settings show of each (#146). Finding a
 * lamp tells its model and serial, so none is read, and none of the brightness changes has to be waited for. Lists none
 * when finding them fails.
 */
export function findLamps(): FoundLamp[] {
  const devices = openDevices("find lamps", "all");
  try {
    return [...devices]
      .sort((a, b) => bySerialNumber(a.serialNumber, b.serialNumber))
      .map((device) => ({
        id: lampId(device.serialNumber),
        label: displayLabel(device),
        model: MODEL_BY_DEVICE_TYPE[device.type],
        serialEnd: device.serialNumber.slice(-4),
      }));
  } finally {
    for (const device of devices) {
      closeDevice(device);
    }
  }
}

/** Orders two serial numbers, as the lamp screens and the settings pages list the lamps. */
function bySerialNumber(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Blinks one lamp, by its id, so the user can tell which one it is (#48): switches it off and back on, or on and back
 * off when it's off. A blink writes no brightness, so it shows at any brightness and leaves learned caps alone, and the
 * lamp ends as it started. Fails when the lamp isn't connected.
 */
export function identifyLamp(id: string, blinkMs = IDENTIFY_BLINK_MS): Promise<BroadcastResult> {
  return oneBrightnessChangeAtATime(async () => {
    const operation = "identify";
    const devices = openDevices(operation, [id]);
    try {
      const device = devices[0];
      if (device === undefined) {
        return { ok: false, deviceCount: 0, failures: 1 };
      }
      const setPower = (on: boolean): void => {
        if (on) {
          turnOn(device);
        } else {
          turnOff(device);
        }
        drainAck(device);
      };
      try {
        const wasOn = isOn(device);
        setPower(!wasOn);
        await new Promise((resolve) => setTimeout(resolve, blinkMs));
        setPower(wasOn);
        logger.info(`${operation}: ${lampLabel(device)} blinked`);
        return { ok: true, deviceCount: 1, failures: 0 };
      } catch (error) {
        logLampFailure(operation, device, error);
        return { ok: false, deviceCount: 1, failures: 1 };
      }
    } finally {
      for (const device of devices) {
        closeDevice(device);
      }
    }
  });
}

/** Sets a lamp to the temperature it allows nearest to `kelvin`, and returns that temperature. */
function setSnappedTemperature(operation: string, device: Device, kelvin: number): number {
  const snapped = snapKelvin(kelvin, getAllowedTemperaturesInKelvinForDevice(device));
  setTemperatureInKelvin(device, snapped);
  drainAck(device);
  temperaturePositions.delete(device.serialNumber);
  logger.info(`${operation}: ${lampLabel(device)} set to ${snapped} K`);
  return snapped;
}

/** Sets the selected lamps to the allowed temperature nearest to `kelvin`, and reports the first one's. */
export function setLampsTemperature(lamps: LampSelection, kelvin: number): BroadcastResult {
  let representative: number | undefined;
  let representativePercentage: number | undefined;
  const operation = "set temperature";
  const result = forEachDevice(
    operation,
    (device) => {
      const allowed = getAllowedTemperaturesInKelvinForDevice(device);
      const snapped = setSnappedTemperature(operation, device, kelvin);
      if (representative === undefined) {
        representative = snapped;
        representativePercentage = temperaturePercentage(snapped, allowed);
      }
    },
    lamps,
  );
  return announced({
    ...result,
    representativeTemperatureKelvin: representative,
    representativeTemperaturePercentage: representativePercentage,
  });
}

/**
 * Steps the selected lamps' temperature along the grid lowest + k × step: together, to one target stepped from the
 * first one's temperature (the one the dial shows), or each from its own, as {@link stepApart} plans it (#145). Reports
 * the first lamp's. When the first lamp can't be read, the next one becomes the starting point of the lamps stepped
 * together.
 */
export function adjustLampsTemperature(
  lamps: LampSelection,
  ticks: number,
  stepKelvin: number,
  stepping: Stepping = "together",
): BroadcastResult {
  const operation = "adjust temperature";
  if (stepping === "each") {
    return announced(adjustTemperaturesApart(operation, lamps, ticks, stepKelvin));
  }
  let target: number | undefined;
  let representative: number | undefined;
  let representativePercentage: number | undefined;
  const result = forEachDevice(
    operation,
    (device) => {
      const { allowed, lowest, highest } = temperatureRange(device);
      target ??= stepOnGrid(getTemperatureInKelvin(device), ticks, stepKelvin, lowest, highest);
      const snapped = setSnappedTemperature(operation, device, target);
      if (representative === undefined) {
        representative = snapped;
        representativePercentage = temperaturePercentage(snapped, allowed);
      }
    },
    lamps,
  );
  return announced({
    ...result,
    representativeTemperatureKelvin: representative,
    representativeTemperaturePercentage: representativePercentage,
  });
}

/** The temperatures a lamp allows, and the lowest and highest of them. Throws when it reports none. */
function temperatureRange(device: Device): { allowed: number[]; lowest: number; highest: number } {
  const allowed = getAllowedTemperaturesInKelvinForDevice(device);
  const lowest = allowed[0];
  const highest = allowed.at(-1);
  if (lowest === undefined || highest === undefined) {
    throw new Error("Lamp reports no allowed temperatures");
  }
  return { allowed, lowest, highest };
}

/**
 * Steps each selected lamp's temperature from its own, as {@link stepApart} plans it, and leaves each at its position.
 * Reads every lamp before it sets any, since a tick counts only while a lamp still moves.
 */
function adjustTemperaturesApart(
  operation: string,
  lamps: LampSelection,
  ticks: number,
  stepKelvin: number,
): BroadcastResult {
  const devices = openDevices(operation, lamps);
  if (devices.length === 0) {
    return { ok: false, deviceCount: 0, failures: 1 };
  }
  const { failed, attempt } = inStages(operation);
  try {
    const apart: Array<ApartLamp & { device: Device; allowed: number[] }> = [];
    for (const device of devices) {
      attempt(device, () => {
        const { allowed, lowest, highest } = temperatureRange(device);
        const kelvin = getTemperatureInKelvin(device);
        apart.push({
          device,
          allowed,
          position: positionOf(temperaturePositions, device, kelvin, kelvin),
          value: kelvin,
          reach: (position) => snapKelvin(Math.max(lowest, Math.min(highest, position)), allowed),
          origin: lowest,
          span: highest - lowest,
        });
      });
    }

    const stepped = stepApart(apart, ticks, stepKelvin);
    let representative: number | undefined;
    let representativePercentage: number | undefined;
    apart.forEach((lamp, index) => {
      attempt(lamp.device, () => {
        const position = stepped[index] ?? lamp.position;
        const snapped = lamp.reach(position);
        setTemperatureInKelvin(lamp.device, snapped);
        drainAck(lamp.device);
        temperaturePositions.set(lamp.device.serialNumber, { position, left: snapped });
        logger.info(`${operation}: ${lampLabel(lamp.device)} set to ${snapped} K`);
        if (representative === undefined) {
          representative = snapped;
          representativePercentage = temperaturePercentage(snapped, lamp.allowed);
        }
      });
    });

    return {
      ok: failed.size === 0,
      deviceCount: devices.length,
      failures: failed.size,
      representativeTemperatureKelvin: representative,
      representativeTemperaturePercentage: representativePercentage,
    };
  } finally {
    for (const device of devices) {
      closeDevice(device);
    }
  }
}

/**
 * Reads the first selected lamp that answers, whose temperature the dial shows. Waits for the brightness change in
 * progress, if any, which holds the lamps open until it has read them back.
 */
export async function readLampsTemperature(lamps: LampSelection): Promise<BroadcastResult> {
  await brightnessChanges;
  let representative: number | undefined;
  let representativePercentage: number | undefined;
  const operation = "read temperature";
  const result = forEachDevice(
    operation,
    (device) => {
      if (representative !== undefined) {
        return;
      }
      representative = getTemperatureInKelvin(device);
      logger.debug(`${operation}: ${lampLabel(device)} at ${representative} K`);
      representativePercentage = temperaturePercentage(representative, getAllowedTemperaturesInKelvinForDevice(device));
    },
    lamps,
  );
  return {
    ...result,
    representativeTemperatureKelvin: representative,
    representativeTemperaturePercentage: representativePercentage,
  };
}

/**
 * Coalesce dial ticks for a short window, then flush once. A flush waits for the previous one to finish, since both
 * would use the lamps, and takes every tick received until it starts.
 */
export function createDialDebouncer(
  flush: (ticks: number) => void | Promise<void>,
  delayMs = DIAL_DEBOUNCE_MS,
): (ticks: number) => void {
  let pending = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();

  const run = async (): Promise<void> => {
    const batch = pending;
    pending = 0;
    // A flush that was still running when this one was due has already taken these ticks.
    if (batch === 0) {
      return;
    }
    await flush(batch);
  };

  return (ticks: number) => {
    pending += ticks;
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      running = running.then(run).catch((error: unknown) => {
        logger.error("Dial flush failed", error);
      });
    }, delayMs);
  };
}
