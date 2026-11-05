import {
  closeDevice,
  type Device,
  findDevices,
  getAllowedTemperaturesInKelvinForDevice,
  getMaximumBrightnessInLumenForDevice,
  getMinimumBrightnessInLumenForDevice,
  handleOf,
  identityOf,
  type LampHandle,
  logLabelOf,
  plugPath,
  readSerialNumber,
} from "./device";

import { type Lamp, type LampState, percentageInRange, percentageToLumen } from "./lamp";
import { lampId, lampLabel } from "./lamp-identity";
import { bySerialNumber } from "./lamp-order";
import { logger as pluginLogger } from "./logging";

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

// A capped lamp applies its cap within about 100 ms of a write, and until then reports the brightness it was sent.
const BRIGHTNESS_SETTLE_MS = 250;

/**
 * The last brightness change, or blink, queued by {@link oneBrightnessChangeAtATime}, which the next one waits for.
 */
let brightnessChanges: Promise<unknown> = Promise.resolve();

const lampsChangedListeners: Array<() => void | Promise<void>> = [];
const connectedListeners: Array<(ids: string[]) => void | Promise<void>> = [];

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

/**
 * The `Lamp` of a lamp the plugin knows, which takes the lamp's whole serial number the first time it's reached. Every
 * operation acts on known lamps alone, so one it doesn't know is a bug.
 */
function lampOf(device: Device): Lamp {
  const lamp = knownLamps.get(lampId(device.serialNumber));
  if (lamp === undefined) {
    throw new Error(`${logLabelOf(device)} isn't one of the plugin's lamps`);
  }
  return lamp;
}

/** The lamps an operation has reached, with the handle each was lent, by the device the operation opened. */
const reached = new WeakMap<Device, { lamp: Lamp; handle: LampHandle }>();

/**
 * The `Lamp` of a lamp an operation opened, with the handle it acts on its lamp through, once it has reached the lamp,
 * which reads it the first time, and at another path (#198). An operation reaches each lamp once, however many times it
 * goes through it, and a lamp that can't be read when it's reached fails the operation's part for it.
 */
function reach(operation: string, device: Device): { lamp: Lamp; handle: LampHandle } {
  let lent = reached.get(device);
  if (lent === undefined) {
    const lamp = lampOf(device);
    const handle = handleOf(device);
    lamp.reach(operation, handle);
    lent = { lamp, handle };
    reached.set(device, lent);
  }
  return lent;
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

/** Logs a lamp's part in an operation failing. The other lamps carry on. */
function logLampFailure(operation: string, device: Device, error: unknown): void {
  logger.error(`${operation}: ${logLabelOf(device)} failed: ${String(error)}`);
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

/** The lumens to send a lamp: the ones asked for, or its cap if it has a lower one. */
function withinCap(operation: string, device: Device, lumen: number): number {
  return lampOf(device).withinBrightnessCap(operation, plugPath(device), lumen);
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
function temperaturePercentage(kelvin: number, allowed: readonly number[]): number {
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
    // It found none, so none is connected as far as the plugin can tell (#198).
    markFound(operation, []);
    return { devices: opened, unidentified: 0 };
  }
  if (found.length === 0) {
    logger.warn(`${operation}: no lamps found`);
    markFound(operation, []);
    return { devices: opened, unidentified: 0 };
  }
  // In the order of their serial numbers, since litra finds them in an order that changes from one call to the next.
  // So every operation goes through the lamps in the same order, as the lamp screens and the settings pages list them,
  // and the first lamp, whose temperature the dials show and step from, is always the same one.
  const devices = found
    .filter((device) => hasSerialNumber(operation, device))
    .sort((a, b) => bySerialNumber(a.serialNumber, b.serialNumber));
  // Each lamp left out is logged already.
  markFound(
    operation,
    devices.map(({ serialNumber }) => lampId(serialNumber)),
  );
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
 * The state a lamp's `Lamp` holds, which reaching it reads the first time, so an operation has it once it reached
 * it.
 */
function stateOf(lamp: Lamp): LampState {
  const { state } = lamp;
  if (state === undefined) {
    throw new Error(`${lamp.logLabel} has no state before it's reached`);
  }
  return state;
}

/** A lamp the plugin holds a state of, with its serial number, which reaching it learned. */
type HeldLamp = { lamp: Lamp; state: LampState; serialNumber: string };

/**
 * The lamps a selection takes in, among the ones the plugin knows that the last operation found and that it holds a
 * state of, in the order of their serial numbers (#198). It's what the keys and dials show, and it reads nothing: the
 * plugin's state is the lamps' state.
 */
function heldLamps(lamps: LampSelection): HeldLamp[] {
  const held: HeldLamp[] = [];
  for (const lamp of knownLamps.values()) {
    const { state, serialNumber } = lamp;
    if (lamp.isConnected && state !== undefined && serialNumber !== undefined && selects(lamps, lamp.id)) {
      held.push({ lamp, state, serialNumber });
    }
  }
  return held.sort((a, b) => bySerialNumber(a.serialNumber, b.serialNumber));
}

/**
 * Marks each lamp the plugin knows as connected when its id is among the ones found, and as not connected otherwise
 * (#198), from what an operation found, before it reads or changes any of them, and logs each lamp that changes.
 */
function markFound(operation: string, foundIds: readonly string[]): void {
  let changed = false;
  for (const lamp of knownLamps.values()) {
    const found = foundIds.includes(lamp.id);
    if (lamp.isConnected !== found) {
      changed = true;
      logger.info(`${operation}: ${lamp.logLabel} ${found ? "found" : "no longer found"}`);
    }
    lamp.setFound(found);
  }
  if (changed) {
    const ids = connectedLamps();
    for (const listener of [...connectedListeners]) {
      Promise.resolve()
        .then(() => listener(ids))
        .catch((error: unknown) => {
          logger.error("Connected lamps listener failed", error);
        });
    }
  }
}

/** The ids of the lamps the plugin knows that the last operation found (#198), as the settings pages mark them. */
export function connectedLamps(): string[] {
  return [...knownLamps.values()].filter((lamp) => lamp.isConnected).map(({ id }) => id);
}

/**
 * Registers a listener called with the ids of the lamps connected whenever an operation finds that one of the lamps the
 * plugin knows was plugged in or unplugged (#198), so the settings pages can mark it.
 */
export function onConnectedChanged(listener: (ids: string[]) => void | Promise<void>): void {
  connectedListeners.push(listener);
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

/**
 * Reaches every lamp the plugin knows that's connected, which reads each one, as the plugin starts (#198), so that it
 * holds the lamps as they are before any key or dial changes them. Tells every key and dial once they're read.
 */
export function reachEveryLamp(): BroadcastResult {
  const operation = "start";
  return announced(
    forEachDevice(
      operation,
      (device) => {
        reach(operation, device);
      },
      "all",
    ),
  );
}

/** Turns the selected lamps on. */
export function turnLampsOn(lamps: LampSelection): BroadcastResult {
  const operation = "turn on";
  return announced(
    forEachDevice(
      operation,
      (device) => {
        const { lamp, handle } = reach(operation, device);
        lamp.setPower(operation, handle, true);
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
        const { lamp, handle } = reach(operation, device);
        lamp.setPower(operation, handle, false);
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
      devices.map((device) => attempt(device, () => stateOf(reach(operation, device).lamp).on, false)).every(Boolean) &&
      unidentified === 0;
    for (const device of devices) {
      attempt(
        device,
        () => {
          const { lamp, handle } = reach(operation, device);
          lamp.setPower(operation, handle, !allOn);
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
  const held = heldLamps(lamps);
  return {
    ok: held.length > 0,
    allOn: held.length > 0 && held.every(({ state }) => state.on),
    deviceCount: held.length,
  };
}

/** Ensure the device is powered on before a brightness change is visible. */
function ensureOn(operation: string, device: Device): void {
  const { lamp, handle } = reach(operation, device);
  if (!stateOf(lamp).on) {
    lamp.setPower(operation, handle, true);
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
        const { lamp, handle } = reach(operation, device);
        sent.set(device, lamp.sendBrightness(operation, handle, brightnessLumen(device, pct)));
      });
    }
    await new Promise((resolve) => setTimeout(resolve, settleMs));
  }

  let representative: number | undefined;
  let representativeLumen: number | undefined;
  const percentages: number[] = [];
  for (const [device, lumen] of sent) {
    attempt(device, () => {
      const { lamp, handle } = reach(operation, device);
      const lumenReached = lamp.readBackBrightness(operation, handle, lumen, sentAt);
      const pct = brightnessPercentage(device, lumenReached);
      // A lamp kept apart is left at its position, which any other change forgets.
      lamp.leaveBrightness(positions.get(device), lumenReached);
      percentages.push(pct);
      if (representative === undefined || pct > representative) {
        representative = pct;
        representativeLumen = lumenReached;
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
          const { lamp, handle } = reach(operation, device);
          lamp.setPower(operation, handle, false);
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
          before.set(device, stateOf(reach(operation, device).lamp).lumen);
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
  const held = heldLamps(lamps);
  const levels = held.map(({ lamp, state }) => ({ lumen: state.lumen, pct: lamp.brightnessPercentage(state.lumen) }));
  const brightest = levels.reduce<(typeof levels)[number] | undefined>(
    (best, level) => (best === undefined || level.pct > best.pct ? level : best),
    undefined,
  );
  return {
    ok: held.length > 0,
    deviceCount: held.length,
    failures: held.length > 0 ? 0 : 1,
    representativeBrightnessPercentage: brightest?.pct,
    representativeBrightnessLumen: brightest?.lumen,
    brightnessPercentages: levels.map(({ pct }) => pct),
  };
}

/**
 * Reads every lamp the plugin knows for the lamp screens, in the order of their serial numbers, as every operation goes
 * through them. A lamp that can't be read is left out. Waits for the brightness change in progress, if any, which holds the lamps open
 * until it has read them back.
 */
export async function readLampStatuses(): Promise<{ ok: boolean; lamps: LampStatus[] }> {
  await brightnessChanges;
  const operation = "read lamp status";
  const result = forEachDevice(
    operation,
    (device) => {
      reach(operation, device);
    },
    "all",
  );
  const lamps = heldLamps("all").map(({ lamp, state, serialNumber }) => ({
    id: lamp.id,
    serialNumber,
    model: lamp.model,
    label: lamp.label,
    on: state.on,
    brightnessLumen: state.lumen,
    brightnessPercentage: lamp.brightnessPercentage(state.lumen),
    temperatureKelvin: state.kelvin,
  }));
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
      return { ...identity, label: lampLabel(identity) };
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
      try {
        const { lamp, handle } = reach(operation, device);
        await lamp.blink(operation, handle, blinkMs);
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
  const { lamp, handle } = reach(operation, device);
  const kelvinReached = lamp.setTemperature(operation, handle, snapped);
  lamp.leaveTemperature(undefined, kelvinReached);
  return kelvinReached;
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
      target ??= stepOnGrid(stateOf(reach(operation, device).lamp).kelvin, ticks, stepKelvin, lowest, highest);
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
        const kelvin = stateOf(reach(operation, device).lamp).kelvin;
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
        const reached = reach(operation, lamp.device);
        const kelvinReached = reached.lamp.setTemperature(operation, reached.handle, lamp.reach(position));
        reached.lamp.leaveTemperature(position, kelvinReached);
        if (representative === undefined) {
          representative = kelvinReached;
          representativePercentage = temperaturePercentage(kelvinReached, lamp.allowed);
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
  const held = heldLamps(lamps);
  const first = held[0];
  return {
    ok: first !== undefined,
    deviceCount: held.length,
    failures: first === undefined ? 1 : 0,
    representativeTemperatureKelvin: first?.state.kelvin,
    representativeTemperaturePercentage:
      first === undefined
        ? undefined
        : temperaturePercentage(first.state.kelvin, first.lamp.range?.allowedKelvin ?? []),
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
