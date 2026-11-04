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

import { Lamp, type LampIdentity, lampId } from "./lamp";
import { bySerialNumber } from "./lamp-order";
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

/**
 * Which lamps an operation acts on, among the ones the plugin knows (see {@link useLamps}): every one connected, the
 * ones with these ids (see {@link Lamp.id}, #20), or every one connected but the ones with these ids, which takes in lamps
 * added later (#147).
 */
export type LampSelection = "all" | readonly string[] | { readonly except: readonly string[] };

/**
 * A group of a scene (#174): the lamps it acts on, and whether it turns them on, at a brightness, in % of their range,
 * and a temperature, or off, which leaves their brightness and temperature as they are.
 */
export type SceneGroup = {
  readonly lamps: LampSelection;
  readonly on: boolean;
  readonly percentage: number;
  readonly kelvin: number;
};

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

/**
 * The last brightness change, or blink, queued by {@link oneBrightnessChangeAtATime}, which the next one waits for.
 */
let brightnessChanges: Promise<unknown> = Promise.resolve();

const lampsChangedListeners: Array<() => void | Promise<void>> = [];

/**
 * The lamps the plugin knows, by id, the only ones an operation acts on (#194), as the global settings hold them, or
 * none until they're handed over. Only finding the lamps sees the others.
 */
let knownLamps: ReadonlyMap<string, Lamp> = new Map();

/**
 * Takes the lamps the plugin knows, as the global settings hold them (#198): the map itself, which they keep up to date,
 * so every operation from then on acts on them alone (#194), and asks each one's `Lamp` what it remembers.
 */
export function useLamps(lamps: ReadonlyMap<string, Lamp>): void {
  knownLamps = lamps;
}

/** What identifies a lamp found, as the global settings would keep it. */
function identityOf(device: Device): LampIdentity {
  const { serialNumber } = device;
  return { id: lampId(serialNumber), model: MODEL_BY_DEVICE_TYPE[device.type], serialEnd: serialNumber.slice(-4) };
}

/**
 * The `Lamp` of a lamp the plugin knows, which takes the lamp's whole serial number the first time it's reached. Every
 * operation acts on known lamps alone, so one it doesn't know is a bug.
 */
function lampOf(device: Device): Lamp {
  const lamp = knownLamps.get(lampId(device.serialNumber));
  if (lamp === undefined) {
    throw new Error(`${lampLabel(device)} isn't one of the plugin's lamps`);
  }
  if (lamp.serialNumber === undefined) {
    lamp.reachedAs(device.serialNumber);
  }
  return lamp;
}

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
 * A lamp as the logs name it, as its `Lamp` does, or by its model alone, followed by "…", while it has no serial number
 * to tell it by, such as a Beam LX that hasn't given it yet (#170).
 */
function lampLabel(device: Device): string {
  return device.serialNumber === "" ? `${MODEL_BY_DEVICE_TYPE[device.type]} …` : new Lamp(identityOf(device)).logLabel;
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
 * (`scripts/probes/write-reports.mjs`, #96). {@link turnOnAsItWas} reads its lamp right after turning it on, on the
 * same handle.
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
 * Gives a lamp found without a serial number, such as a Beam LX, the one it keeps itself, so that it has an id of its
 * own (#170). A lamp whose serial can't be read is logged and closed, and the operation leaves it out: without its
 * serial, it can't be told from another lamp. Returns whether the lamp has its serial.
 */
function hasSerialNumber(operation: string, device: Device): boolean {
  if (device.serialNumber !== "") {
    return true;
  }
  try {
    device.serialNumber = readSerialNumber(device);
    return true;
  } catch (error) {
    logLampFailure(operation, device, error);
    closeDevice(device);
    return false;
  }
}

/** Where a lamp is plugged in: the path the system gave it, which changes each time it's plugged in. */
function plugPath(device: Device): string {
  return asHid(device).getDeviceInfo().path ?? "";
}

/** The lumens to send a lamp: the ones asked for, or its cap if it has a lower one. */
function withinCap(operation: string, device: Device, lumen: number): number {
  return lampOf(device).withinBrightnessCap(operation, plugPath(device), lumen);
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

/** Whether a selection takes in the lamp with this id. */
function selects(lamps: LampSelection, id: string): boolean {
  if (lamps === "all") {
    return true;
  }
  return "except" in lamps ? !lamps.except.includes(id) : lamps.includes(id);
}

/**
 * The lamps an operation opened, and how many lamps it couldn't tell apart that its selection could take in, which it
 * counts as failed lamps (see {@link openGroups}).
 */
type Opened<T> = { devices: T; unidentified: number };

/**
 * Opens the lamps an operation acts on, named in the logs: every connected lamp the plugin knows, the selected ones, or
 * every one but the left out ones, closing the others. A selected lamp that isn't known or connected is logged, and so
 * is a selection of none, or every lamp left out. Opens none when no lamp is selected or connected, none of the
 * selected ones is, every one is left out, or finding them fails.
 */
function openDevices(operation: string, lamps: LampSelection): Opened<Device[]> {
  const { devices, unidentified } = openGroups(operation, [{ lamps }]);
  return { devices: [...devices.keys()], unidentified };
}

/** Opens every connected lamp, the ones the plugin doesn't know included, to find them. */
function openEveryDevice(operation: string): Device[] {
  return [...openGroups(operation, [{ lamps: "all" }], { onlyKnown: false }).devices.keys()];
}

/**
 * Opens the lamps of several groups, as {@link openDevices} opens one group's, each with the first group that selects
 * it, so a lamp two groups select takes the first one's part. A selection of none is logged only when every group
 * selects none, since a group may lose its lamps to another. A connected lamp the plugin doesn't know is closed unused,
 * unless `onlyKnown` is false.
 *
 * A lamp whose serial number can't be read is left out, since it can't be told from another (#170), but counted, when
 * a group takes in every lamp, or every lamp but some, which it could be one of: a Beam that fails counts as a failed
 * lamp, and a Beam LX that can't even be told apart is one too (#100). A group of given lamps can't tell whether it
 * was one of them, and fails on its own when none of them is found.
 */
function openGroups<G extends { readonly lamps: LampSelection }>(
  operation: string,
  groups: readonly G[],
  { onlyKnown = true }: { onlyKnown?: boolean } = {},
): Opened<Map<Device, G>> {
  const opened = new Map<Device, G>();
  if (groups.every(({ lamps }) => Array.isArray(lamps) && lamps.length === 0)) {
    logger.warn(`${operation}: no lamp selected`);
    return { devices: opened, unidentified: 0 };
  }
  let found: Device[];
  try {
    found = findDevices();
  } catch (error) {
    logger.error(`${operation}: finding the lamps failed: ${String(error)}`);
    return { devices: opened, unidentified: 0 };
  }
  if (found.length === 0) {
    logger.warn(`${operation}: no lamps found`);
    return { devices: opened, unidentified: 0 };
  }
  // In the order of their serial numbers, since litra finds them in an order that changes from one call to the next.
  // So every operation goes through the lamps in the same order, as the lamp screens and the settings pages list them,
  // and the first lamp, whose temperature the dials show and step from, is always the same one.
  const devices = found
    .filter((device) => hasSerialNumber(operation, device))
    .sort((a, b) => bySerialNumber(a.serialNumber, b.serialNumber));
  // Each lamp left out is logged already.
  const takesInAny = onlyKnown && groups.some(({ lamps }) => !Array.isArray(lamps));
  const unidentified = takesInAny ? found.length - devices.length : 0;
  if (devices.length === 0) {
    return { devices: opened, unidentified };
  }
  const known = (id: string): boolean => !onlyKnown || knownLamps.has(id);
  const connected: string[] = [];
  for (const device of devices) {
    const id = lampId(device.serialNumber);
    const group = known(id) ? groups.find(({ lamps }) => selects(lamps, id)) : undefined;
    if (known(id)) {
      connected.push(id);
    }
    if (group === undefined) {
      closeDevice(device);
    } else {
      opened.set(device, group);
    }
  }
  if (connected.length === 0) {
    logger.warn(`${operation}: none of the lamps connected is one of the plugin's lamps`);
    return { devices: opened, unidentified };
  }
  for (const { lamps } of groups) {
    if (lamps === "all") {
      continue;
    }
    if ("except" in lamps) {
      if (opened.size === 0) {
        logger.warn(`${operation}: every lamp connected is left out`);
      }
      continue;
    }
    for (const id of lamps) {
      if (!known(id)) {
        logger.warn(`${operation}: lamp ${id} isn't one of the plugin's lamps`);
      } else if (!connected.includes(id)) {
        logger.warn(`${operation}: lamp ${id} not connected`);
      }
    }
  }
  return { devices: opened, unidentified };
}

/**
 * What an operation did, from the lamps it acted on and how many of them failed, counting the lamps it couldn't tell
 * apart as failed lamps (see {@link openGroups}).
 */
function outcome(deviceCount: number, failures: number, unidentified: number): BroadcastResult {
  const failed = failures + unidentified;
  return { ok: failed === 0, deviceCount: deviceCount + unidentified, failures: failed };
}

/**
 * Open the selected devices, run fn per device, always close handles. Zero devices = failure. The operation names the
 * call in the logs, and fn logs what it did to each lamp.
 */
export function forEachDevice(operation: string, fn: (device: Device) => void, lamps: LampSelection): BroadcastResult {
  const { devices, unidentified } = openDevices(operation, lamps);
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

  return outcome(devices.length, failures, unidentified);
}

/** Turns the selected lamps on. */
export function turnLampsOn(lamps: LampSelection): BroadcastResult {
  const operation = "turn on";
  return announced(
    forEachDevice(
      operation,
      (device) => {
        turnOnAsItWas(operation, device);
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
  const { devices, unidentified } = openDevices(operation, lamps);
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
    // A lamp that couldn't be told apart couldn't be read either, so it counts as off.
    const allOn =
      devices.map((device) => attempt(device, () => isOn(device), false)).every(Boolean) && unidentified === 0;
    for (const device of devices) {
      attempt(
        device,
        () => {
          if (allOn) {
            turnOff(device);
            drainAck(device);
          } else {
            turnOnAsItWas(operation, device);
          }
          logger.info(`${operation}: ${lampLabel(device)} turned ${allOn ? "off" : "on"}`);
        },
        undefined,
      );
    }
    return announced(outcome(devices.length, failed.size, unidentified));
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
  const { devices, unidentified } = openDevices(operation, lamps);
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

  // A lamp that couldn't be told apart couldn't be read either, so it counts as off.
  const { ok, deviceCount } = outcome(devices.length, failures, unidentified);
  return { ok, allOn: allOn && unidentified === 0, deviceCount };
}

/** Ensure the device is powered on before a brightness change is visible. */
function ensureOn(operation: string, device: Device): void {
  if (!isOn(device)) {
    turnOnAsItWas(operation, device);
    logger.info(`${operation}: ${lampLabel(device)} turned on`);
  }
}

/**
 * Turns a lamp on, and puts back the brightness and temperature it had before when it turns on at others. A Beam LX
 * turns on at the setting it saves a few hundred ms after it's switched off: switched back on sooner, as a blink does,
 * it comes back at an older one, and a temperature it was given while off is lost (#100). It reads the setting it was
 * given while off, and the one it goes back to as soon as it's on (`scripts/probes/power-cycle.mjs`), so reading it on
 * both sides of the switch tells. A Beam keeps its setting, and gets nothing written. A lamp that can't be read is
 * still turned on, unchecked.
 */
function turnOnAsItWas(operation: string, device: Device): void {
  let lumen: number;
  let kelvin: number;
  try {
    lumen = getBrightnessInLumenSafe(device);
    kelvin = getTemperatureInKelvin(device);
  } catch (error) {
    turnOn(device);
    drainAck(device);
    logger.warn(`${operation}: ${lampLabel(device)} turned on unchecked, since it can't be read: ${String(error)}`);
    return;
  }
  turnOn(device);
  drainAck(device);
  const lumenOn = getBrightnessInLumenSafe(device);
  const kelvinOn = getTemperatureInKelvin(device);
  if (lumenOn === lumen && kelvinOn === kelvin) {
    return;
  }
  if (kelvinOn !== kelvin) {
    setTemperatureInKelvin(device, kelvin);
    drainAck(device);
  }
  if (lumenOn !== lumen) {
    setBrightnessInLumen(device, lumen);
    drainAck(device);
  }
  logger.info(
    `${operation}: ${lampLabel(device)} turned on at ${lumenOn} lm and ${kelvinOn} K, put back to ${lumen} lm and ${kelvin} K`,
  );
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
 * Sets each lamp to its group's part of a scene in one pass (#174), as {@link setScene} does, and announces the change
 * once, so everything the Deck shows follows the whole scene at once. A lamp two groups select takes the first one's
 * part.
 */
export function setLampsScene(
  groups: readonly SceneGroup[],
  settleMs = BRIGHTNESS_SETTLE_MS,
): Promise<BroadcastResult> {
  return oneBrightnessChangeAtATime(() => setScene(groups, settleMs)).finally(announceLampsChanged);
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
 * Waits, right after a lamp's cap was learned, until no lamp can go back to its cap (see
 * {@link Lamp.brightnessCapReversalEndsAt}), so a change that asks for less isn't undone.
 */
async function waitForCapReversal(operation: string): Promise<void> {
  const endsAt = Math.max(0, ...[...knownLamps.values()].map((lamp) => lamp.brightnessCapReversalEndsAt));
  const reversalMs = endsAt - Date.now();
  if (reversalMs > 0) {
    logger.debug(`${operation}: waiting ${reversalMs} ms, until no lamp can go back to its cap`);
    await new Promise((resolve) => setTimeout(resolve, reversalMs));
  }
}

/**
 * Sends each lamp its percentage, or its cap, whichever is lower, lets them settle, and reads them back. A lamp that
 * reaches less than it was sent has its cap learned. A lamp given a position is left at it, which any other change
 * forgets. Reports the brightest, and every lamp's percentage. Sends nothing, and doesn't wait, when no lamp has a
 * percentage.
 */
async function sendBrightness(
  operation: string,
  targets: Map<Device, number>,
  positions: Map<Device, number>,
  attempt: (device: Device, fn: () => void) => void,
  settleMs: number,
): Promise<
  Pick<
    BroadcastResult,
    "representativeBrightnessPercentage" | "representativeBrightnessLumen" | "brightnessPercentages"
  >
> {
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
      const lamp = lampOf(device);
      lamp.brightnessReached(operation, plugPath(device), lumen, reached, sentAt);
      // A lamp kept apart is left at its position, which any other change forgets.
      lamp.leaveBrightness(positions.get(device), reached);
      percentages.push(pct);
      if (representative === undefined || pct > representative) {
        representative = pct;
        representativeLumen = reached;
      }
    });
  }

  return {
    representativeBrightnessPercentage: representative,
    representativeBrightnessLumen: representativeLumen,
    brightnessPercentages: percentages,
  };
}

/**
 * Sets each lamp to its group's part of a scene: a group that's off turns its lamps off, and a group that's on turns
 * its lamps on, sets their temperature, snapped to one each lamp allows, then their brightness, as
 * {@link sendBrightness} sends it, caps included. Reports the brightest once they've settled. Like
 * {@link moveLampsBrightness}, it waits for a lamp that can still go back to its cap, and holds the lamps open until
 * it has read them back, so it goes through {@link oneBrightnessChangeAtATime}.
 */
async function setScene(groups: readonly SceneGroup[], settleMs: number): Promise<BroadcastResult> {
  const operation = "set scene";
  await waitForCapReversal(operation);

  const { devices, unidentified } = openGroups(operation, groups);
  if (devices.size === 0) {
    return { ok: false, deviceCount: 0, failures: 1 };
  }

  const { failed, attempt } = inStages(operation);

  try {
    const targets = new Map<Device, number>();
    for (const [device, group] of devices) {
      attempt(device, () => {
        if (!group.on) {
          turnOff(device);
          drainAck(device);
          logger.info(`${operation}: ${lampLabel(device)} turned off`);
          return;
        }
        ensureOn(operation, device);
        setSnappedTemperature(operation, device, group.kelvin);
        targets.set(device, Math.max(0, Math.min(100, group.percentage)));
      });
    }
    const brightness = await sendBrightness(operation, targets, new Map(), attempt, settleMs);
    return { ...outcome(devices.size, failed.size, unidentified), ...brightness };
  } finally {
    for (const device of devices.keys()) {
      closeDevice(device);
    }
  }
}

/**
 * Moves the selected lamps to their target and reports the brightest once they've settled. The target is a percentage,
 * or a step from the brightest selected lamp's percentage or from each lamp's own, which are then read first. Each
 * lamp is sent the target as {@link sendBrightness} sends it, caps included. Right after a lamp's cap is learned, the
 * next change waits until the lamp can no longer go back to its cap. The lamps stay open from the first read to the
 * last, so calls mustn't overlap: they go through {@link oneBrightnessChangeAtATime}.
 */
async function moveLampsBrightness(
  operation: string,
  lamps: LampSelection,
  target: BrightnessTarget,
  settleMs: number,
): Promise<BroadcastResult> {
  await waitForCapReversal(operation);

  const { devices, unidentified } = openDevices(operation, lamps);
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
        position: lampOf(device).brightnessPositionAt(lumen, brightnessPercentage(device, lumen)),
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

    const brightness = await sendBrightness(operation, targets, positions, attempt, settleMs);
    return { ...outcome(devices.length, failed.size, unidentified), ...brightness };
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
 * Reads every lamp the plugin knows for the lamp screens, in the order of their serial numbers, as every operation goes
 * through them. A lamp that can't be read is left out. Waits for the brightness change in progress, if any, which holds the lamps open
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
      const lamp = lampOf(device);
      lamps.push({
        id: lamp.id,
        serialNumber: device.serialNumber,
        model: lamp.model,
        label: lamp.label,
        on,
        brightnessLumen,
        brightnessPercentage: percentage,
        temperatureKelvin,
      });
    },
    "all",
  );
  return { ok: result.ok, lamps };
}

/**
 * Lists the connected lamps, the ones the plugin doesn't know included, which it adds to the ones it knows (#194),
 * in the order of their serial numbers, as the lamp screens list them (#20), with what the keys' lamp pickers and the plugin settings show
 * of each (#146). Finding a lamp tells its model and serial, or the lamp is asked for its serial alone (#170), so none
 * of the brightness changes has to be waited for. Lists none when finding them fails.
 */
export function findLamps(): FoundLamp[] {
  const devices = openEveryDevice("find lamps");
  try {
    return devices.map((device) => {
      const identity = identityOf(device);
      return { ...identity, label: new Lamp(identity).label };
    });
  } finally {
    for (const device of devices) {
      closeDevice(device);
    }
  }
}

/**
 * Blinks one lamp, by its id, so the user can tell which one it is (#48): switches it off and back on, or on and back
 * off when it's off, `blinkMs` later (#171). A blink writes no brightness, so it shows at any brightness and leaves
 * learned caps alone, and the lamp ends as it started. Fails when the lamp isn't connected.
 */
export function identifyLamp(id: string, blinkMs: number): Promise<BroadcastResult> {
  return oneBrightnessChangeAtATime(async () => {
    const operation = "identify";
    const { devices } = openDevices(operation, [id]);
    try {
      const device = devices[0];
      if (device === undefined) {
        return { ok: false, deviceCount: 0, failures: 1 };
      }
      const setPower = (on: boolean): void => {
        if (on) {
          turnOnAsItWas(operation, device);
        } else {
          turnOff(device);
          drainAck(device);
        }
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
  lampOf(device).leaveTemperature(undefined, snapped);
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
  const { devices, unidentified } = openDevices(operation, lamps);
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
          position: lampOf(device).temperaturePositionAt(kelvin, kelvin),
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
        lampOf(lamp.device).leaveTemperature(position, snapped);
        logger.info(`${operation}: ${lampLabel(lamp.device)} set to ${snapped} K`);
        if (representative === undefined) {
          representative = snapped;
          representativePercentage = temperaturePercentage(snapped, lamp.allowed);
        }
      });
    });

    return {
      ...outcome(devices.length, failed.size, unidentified),
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
