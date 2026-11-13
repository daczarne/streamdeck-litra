import { Lamp, type LampState } from "./lamp";
import { LampConnection, type LampHandle } from "./lamp-connection";
import { type LampSelection, selects } from "./lamp-selection";
import { logger as pluginLogger } from "./logging";

/**
 * How an operation went: whether every lamp it acted on did its part, how many lamps it acted on, the ones it couldn't
 * tell apart included, and how many failed. What the lamps are at, the keys and dials take from their `Lamp`s.
 */
export type OperationResult = {
  readonly ok: boolean;
  readonly lampCount: number;
  readonly failures: number;
};

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
 * Where a brightness or temperature change sends the lamps: one value for every lamp, in % of their range or in
 * kelvin, or ticks of a step, taken together from the value a dial shows, or by each lamp from its own.
 */
type Target = number | { stepping: Stepping; ticks: number; step: number };

/** What a lamp is sent: a percentage of its range, and, for a lamp kept apart, what its step asked (#145). */
type BrightnessSent = { readonly percentage: number; readonly asked?: number | undefined };

/** What a lamp is set to: a temperature, and, for a lamp kept apart, what its step asked (#145). */
type TemperatureSet = { readonly kelvin: number; readonly asked?: number | undefined };

/** A connected lamp, as a settings page lists it (#20). */
export type FoundLamp = {
  id: string;
  /** Its model and the end of its id, such as "Beam - c870". */
  label: string;
  /** Its model, such as "Beam", which the plugin settings list apart from the end of its id (#146). */
  model: string;
};

const logger = pluginLogger.createScope("Lamps");

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
 * The `Lamp` of a lamp found, by the id of the serial number it gave. Every operation acts on known lamps alone, so one
 * it doesn't know is a bug.
 */
function lampOf(connection: LampConnection): Lamp {
  const lamp = knownLamps.get(connection.id);
  if (lamp === undefined) {
    throw new Error(`${connection.label} isn't one of the plugin's lamps`);
  }
  return lamp;
}

/**
 * Registers a listener called after every operation that writes to the lamps, whichever action asked for it, so that
 * everything the Deck shows about the lamps can follow (#57). A brightness change calls it once it has settled and left
 * the queue. The actions register theirs once, for as long as the plugin runs.
 */
export function onLampsChanged(listener: () => void | Promise<void>): void {
  lampsChangedListeners.push(listener);
}

/**
 * Calls each listener once the current operation has returned, and its handles are closed, each on its own, so one
 * that fails is logged as `name`'s, and the others still run.
 */
function callListeners<A extends unknown[]>(
  listeners: ReadonlyArray<(...args: A) => void | Promise<void>>,
  name: string,
  ...args: A
): void {
  for (const listener of [...listeners]) {
    Promise.resolve()
      .then(() => listener(...args))
      .catch((error: unknown) => {
        logger.error(`${name} listener failed`, error);
      });
  }
}

/**
 * Calls every listener registered with {@link onLampsChanged}. A failed operation is announced too, since it may have
 * written to some lamps, and finding none is news as well.
 */
function announceLampsChanged(): void {
  callListeners(lampsChangedListeners, "Lamps changed");
}

/** Announces that the lamps changed, and passes on the result of the operation that changed them. */
function announced<T>(result: T): T {
  announceLampsChanged();
  return result;
}

/**
 * Gives a lamp found without a serial number, such as a Beam LX, the one it keeps itself, so that it has an id of its
 * own (#170). A lamp whose serial can't be read is logged and closed, and the operation leaves it out: without its
 * serial, it can't be told from another lamp. Returns whether the lamp has its serial.
 */
function isIdentified(operation: string, connection: LampConnection): boolean {
  try {
    connection.identify();
    return true;
  } catch (error) {
    logger.error(`${operation}: ${connection.label} failed: ${String(error)}`);
    connection.close();
    return false;
  }
}

/**
 * Moves a value by a number of steps along the grid min, min + step, min + 2 × step, …, clamped to min–max, so a dial
 * stops on the same values going up as going down (#14, #16). From a value off the grid, such as a lamp's cap or a
 * clamped end, the first step goes to the grid's next value in the direction of the turn. `ticks` is never 0, and
 * `step` is positive, as the dials and the step keys send them.
 */
export function stepOnGrid(value: number, ticks: number, step: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, stepAlongGrid(value, ticks, step, min)));
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
  /** What the lamp was last asked for, which can be past an end of its range or its cap, where it stopped (#145). */
  asked: number;
  /** What the lamp is at, in what it's sent. */
  value: number;
  /** What the lamp is sent for what it's asked for: the value within its range, and its cap. */
  reach: (asked: number) => number;
  /** Where the lamp's grid starts: the bottom of its range. */
  origin: number;
  /** How far the lamp's range goes from its origin. */
  span: number;
};

/**
 * Plans the steps of lamps kept apart (#145), a tick at a time. A tick moves what every lamp is asked for along its
 * grid, step after step, until one of the lamps moves, and each lamp goes as far towards it as it can. So one stopped by
 * an end of its range or its cap stays there while the others keep going, and comes back with them once they've retraced
 * the way. Steps that move no lamp cost no tick, such as the ones every lamp was asked for past a cap it hadn't learned
 * yet. A turn stops at the first tick that moves no lamp across their whole ranges, so turning on once every lamp is at
 * its end does nothing, rather than piling up steps to undo. Returns the lamps, each with what it's asked for next.
 */
function stepApart<T extends ApartLamp>(lamps: readonly T[], ticks: number, step: number): T[] {
  const direction = Math.sign(ticks);
  // Enough steps to take any lamp from what it was asked for across its whole range, so a tick that moves no lamp ends.
  const bound = Math.max(...lamps.map((lamp) => Math.ceil((Math.abs(lamp.asked - lamp.origin) + lamp.span) / step)));
  let state = [...lamps];
  for (let tick = 0; tick < Math.abs(ticks); tick++) {
    let next = state;
    let moved = false;
    for (let steps = 0; !moved && steps < bound; steps++) {
      next = next.map((lamp) => {
        const asked = stepAlongGrid(lamp.asked, direction, step, lamp.origin);
        const value = lamp.reach(asked);
        moved ||= (value - lamp.value) * direction > 0;
        return { ...lamp, asked, value };
      });
    }
    if (!moved) {
      break;
    }
    state = next;
  }
  return state;
}

/** The lamps found, each opened, in the order of their ids, and how many more couldn't be told apart. */
type Found = { readonly connections: LampConnection[]; readonly unidentified: number };

/**
 * Finds and opens every connected lamp, the ones the plugin doesn't know included. A lamp found without a serial
 * number, such as a Beam LX, is asked for the one it keeps (#170), and one whose serial can't be read is logged, closed
 * and left out, since it can't be told from another, but counted. The lamps come in the order of their ids, since
 * litra finds them in an order that changes from one call to the next: so every operation goes through them in the
 * same order, as the lamp screens and the settings pages list them, and the first lamp, whose temperature the dials
 * show and step from, is always the same one. Marks each lamp the plugin knows as connected or not from what it found
 * (#198). Finds none when finding them fails, which is logged, and so is finding none.
 */
function findConnections(operation: string): Found {
  let found: LampConnection[] = [];
  try {
    found = LampConnection.findAll();
    if (found.length === 0) {
      logger.warn(`${operation}: no lamps found`);
    }
  } catch (error) {
    logger.error(`${operation}: finding the lamps failed: ${String(error)}`);
  }
  const identified = found
    .filter((connection) => isIdentified(operation, connection))
    .sort((a, b) => Lamp.byId(a.id, b.id));
  // When finding them failed, none is connected as far as the plugin can tell.
  markFound(
    operation,
    identified.map(({ id }) => id),
  );
  return { connections: identified, unidentified: found.length - identified.length };
}

/**
 * Opens the lamps an operation acts on, named in the logs, for each of its groups: every connected lamp the plugin
 * knows, the selected ones, or every one but the left out ones, each lamp with the first group that selects it, so a
 * lamp two groups select takes the first one's part. It closes the other lamps found, the ones the plugin doesn't know
 * included. A selection of none is logged only when every group selects none, since a group may lose its lamps to
 * another, and then no lamp is looked for.
 *
 * A lamp whose serial number can't be read is counted when a group takes in every lamp, or every lamp but some, which
 * it could be one of: a Beam that fails counts as a failed lamp, and a Beam LX that can't even be told apart is one too
 * (#100). A group of given lamps can't tell whether it was one of them, and fails on its own when none of them is
 * found.
 */
function openGroups<G extends { readonly lamps: LampSelection }>(
  operation: string,
  groups: readonly G[],
): { connections: Map<LampConnection, G>; unidentified: number } {
  const opened = new Map<LampConnection, G>();
  if (groups.every(({ lamps }) => Array.isArray(lamps) && lamps.length === 0)) {
    logger.warn(`${operation}: no lamp selected`);
    return { connections: opened, unidentified: 0 };
  }
  const found = findConnections(operation);
  const takesInAny = groups.some(({ lamps }) => !Array.isArray(lamps));
  const unidentified = takesInAny ? found.unidentified : 0;
  if (found.connections.length === 0) {
    return { connections: opened, unidentified };
  }
  const connected: string[] = [];
  for (const connection of found.connections) {
    const { id } = connection;
    const known = knownLamps.has(id);
    const group = known ? groups.find(({ lamps }) => selects(lamps, id)) : undefined;
    if (known) {
      connected.push(id);
    }
    if (group === undefined) {
      connection.close();
    } else {
      opened.set(connection, group);
    }
  }
  if (connected.length === 0) {
    logger.warn(`${operation}: none of the lamps connected is one of the plugin's lamps`);
    return { connections: opened, unidentified };
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
      if (!knownLamps.has(id)) {
        logger.warn(`${operation}: lamp ${id} isn't one of the plugin's lamps`);
      } else if (!connected.includes(id)) {
        logger.warn(`${operation}: lamp ${id} not connected`);
      }
    }
  }
  return { connections: opened, unidentified };
}

/**
 * The state a lamp's `Lamp` holds, which reaching it reads the first time, so an operation has it once it reached
 * it.
 */
function stateOf(lamp: Lamp): LampState {
  if (!lamp.isReached()) {
    throw new Error(`${lamp.label} has no state before it's reached`);
  }
  return lamp.state;
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
      logger.info(`${operation}: ${lamp.label} ${found ? "found" : "no longer found"}`);
    }
    lamp.setFound(found);
  }
  if (changed) {
    callListeners(connectedListeners, "Connected lamps", connectedLamps());
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
function outcome(lampCount: number, failures: number, unidentified: number): OperationResult {
  const failed = failures + unidentified;
  return { ok: failed === 0, lampCount: lampCount + unidentified, failures: failed };
}

/** What an operation that opened no lamp did: it failed. */
const NO_LAMP: OperationResult = { ok: false, lampCount: 0, failures: 1 };

/** A lamp an operation opened and reached: its `Lamp`, the handle it acts on its lamp through, and its group. */
type OpenedLamp<G> = { readonly lamp: Lamp; readonly handle: LampHandle; readonly group: G };

/** The lamps an operation opened, as {@link openLamps} gives them. */
type OpenedLamps<G> = {
  /** The lamps it reached, in the order of their ids, each with its group. */
  readonly lamps: readonly OpenedLamp<G>[];
  /** How many lamps the operation's selection could take in that it couldn't tell apart (see {@link openGroups}). */
  readonly unidentified: number;
  /** How many lamps failed so far, the ones that couldn't be reached included. */
  readonly failures: number;
  /** Runs a step on a lamp, unless it failed already, and counts and logs it once when it fails. */
  attempt(lamp: Lamp, step: () => void): void;
  /** Counts and logs a lamp's failure, once. */
  fail(lamp: Lamp, error: unknown): void;
  /** What the operation did. */
  outcome(): OperationResult;
  /** Closes every lamp the operation opened, which it always does once it's done. */
  close(): void;
};

/**
 * Opens the lamps of an operation's groups, as {@link openGroups} does, and reaches each one, lending its `Lamp` a
 * handle, which reads the lamp the first time, and at another path (#198). A lamp that can't be reached counts as
 * failed, and is left out of the lamps the operation goes through. Gives undefined when it opens no lamp, which fails
 * the operation. The operation closes them once it's done.
 */
function openLamps<G extends { readonly lamps: LampSelection }>(
  operation: string,
  groups: readonly G[],
): OpenedLamps<G> | undefined {
  const { connections, unidentified } = openGroups(operation, groups);
  if (connections.size === 0) {
    return undefined;
  }
  const failed = new Set<Lamp>();
  const fail = (lamp: Lamp, error: unknown): void => {
    if (!failed.has(lamp)) {
      failed.add(lamp);
      logger.error(`${operation}: ${lamp.label} failed: ${String(error)}`);
    }
  };
  const lamps: OpenedLamp<G>[] = [];
  for (const [connection, group] of connections) {
    const lamp = lampOf(connection);
    try {
      lamp.reach(operation, connection);
      lamps.push({ lamp, handle: connection, group });
    } catch (error) {
      fail(lamp, error);
    }
  }
  return {
    lamps,
    unidentified,
    get failures() {
      return failed.size;
    },
    attempt(lamp, step) {
      if (failed.has(lamp)) {
        return;
      }
      try {
        step();
      } catch (error) {
        fail(lamp, error);
      }
    },
    fail,
    outcome: () => outcome(connections.size, failed.size, unidentified),
    close() {
      for (const connection of connections.keys()) {
        connection.close();
      }
    },
  };
}

/**
 * Opens the selected lamps, reaches them, runs `step` on each, and closes them. A lamp whose step fails is logged, and
 * the others go on. Opening none fails. The operation names the call in the logs, and the `Lamp`s log what they did.
 */
export function forEachLamp(
  operation: string,
  step: (reached: OpenedLamp<{ lamps: LampSelection }>) => void,
  lamps: LampSelection,
): OperationResult {
  const opened = openLamps(operation, [{ lamps }]);
  if (opened === undefined) {
    return NO_LAMP;
  }
  try {
    for (const reached of opened.lamps) {
      opened.attempt(reached.lamp, () => step(reached));
    }
    return opened.outcome();
  } finally {
    opened.close();
  }
}

/**
 * Reaches every lamp the plugin knows that's connected, which marks each one connected or not, and reads one reached
 * for the first time or plugged in again (#198), so the plugin holds the lamps as they are: as it starts, when Find
 * lamps adds lamps, and on a tap on a dial's strip, which then never shows a lamp unplugged since the last operation
 * (#48). Waits for the brightness change in progress, if any, which holds the lamps open until it has read them back.
 * Tells every key and dial once it's done, since a lamp read, or found unplugged or plugged in, changes what they
 * show.
 */
export async function reachEveryLamp(operation: string): Promise<OperationResult> {
  await lampsSettled();
  return announced(forEachLamp(operation, () => {}, "all"));
}

/**
 * Waits for the brightness change in progress, if any, so that what the keys and dials show of the lamps is where it
 * leaves them, not partway (see `src/actions/shown.ts`).
 */
export async function lampsSettled(): Promise<void> {
  await brightnessChanges;
}

/** Turns the selected lamps on. */
export function turnLampsOn(lamps: LampSelection): OperationResult {
  const operation = "turn on";
  return announced(forEachLamp(operation, ({ lamp, handle }) => lamp.setPower(operation, handle, true), lamps));
}

/** Turns the selected lamps off. */
export function turnLampsOff(lamps: LampSelection): OperationResult {
  const operation = "turn off";
  return announced(forEachLamp(operation, ({ lamp, handle }) => lamp.setPower(operation, handle, false), lamps));
}

/**
 * Turns the selected lamps off if every one is on, as the plugin holds them, and on otherwise, so lamps out of sync end
 * up in sync (#23). That's the opposite of what {@link areLampsOn} reports, which the Power key shows. A lamp that
 * couldn't be reached, or told apart, counts as off.
 */
export function toggleLamps(lamps: LampSelection): OperationResult {
  const operation = "toggle";
  const opened = openLamps(operation, [{ lamps }]);
  if (opened === undefined) {
    return announced(NO_LAMP);
  }
  try {
    const allOn =
      opened.lamps.every(({ lamp }) => stateOf(lamp).on) && opened.failures === 0 && opened.unidentified === 0;
    for (const { lamp, handle } of opened.lamps) {
      opened.attempt(lamp, () => lamp.setPower(operation, handle, !allOn));
    }
    return announced(opened.outcome());
  } finally {
    opened.close();
  }
}

/**
 * Sets the selected lamps to the percentage, as {@link moveLampsBrightness} does. A lamp at its cap stays there, which
 * its `Lamp` holds.
 */
export function setLampsBrightness(
  lamps: LampSelection,
  percentage: number,
  settleMs = BRIGHTNESS_SETTLE_MS,
): Promise<OperationResult> {
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
): Promise<OperationResult> {
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
): Promise<OperationResult> {
  return oneBrightnessChangeAtATime(() => setScene(groups, settleMs)).finally(announceLampsChanged);
}

/**
 * Runs brightness changes one at a time, in the order they were asked for. A change holds the lamps open while they
 * settle, and its read-back would take a later change's lower write for a cap. {@link identifyLamp} goes through it
 * too, since it holds a lamp open during its blink.
 */
function oneBrightnessChangeAtATime(change: () => Promise<OperationResult>): Promise<OperationResult> {
  const result = brightnessChanges.then(change);
  brightnessChanges = result.catch(() => undefined);
  return result;
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
 * Sends each lamp its percentage, as its `Lamp` sends it, caps included, lets them settle, and reads them back. A lamp
 * that reaches less than it was sent has its cap learned. Sends nothing, and doesn't wait, when no lamp has a
 * percentage.
 */
async function sendBrightness(
  operation: string,
  targets: ReadonlyMap<OpenedLamp<unknown>, BrightnessSent>,
  attempt: (lamp: Lamp, step: () => void) => void,
  settleMs: number,
): Promise<void> {
  const sent = new Map<OpenedLamp<unknown>, number>();
  const sentAt = Date.now();
  if (targets.size > 0) {
    for (const [reached, { percentage, asked }] of targets) {
      const { lamp, handle } = reached;
      attempt(lamp, () => {
        sent.set(reached, lamp.sendBrightness(operation, handle, percentage, asked));
      });
    }
    await new Promise((resolve) => setTimeout(resolve, settleMs));
  }
  for (const [{ lamp, handle }, lumen] of sent) {
    attempt(lamp, () => lamp.readBackBrightness(operation, handle, lumen, sentAt));
  }
}

/**
 * Sets each lamp to its group's part of a scene: a group that's off turns its lamps off, and a group that's on turns
 * its lamps on, sets their temperature, snapped to one each lamp allows, then their brightness, as
 * {@link sendBrightness} sends it, caps included. Like {@link moveLampsBrightness}, it waits for a lamp that can still
 * go back to its cap, and holds the lamps open until it has read them back, so it goes through
 * {@link oneBrightnessChangeAtATime}.
 */
async function setScene(groups: readonly SceneGroup[], settleMs: number): Promise<OperationResult> {
  const operation = "set scene";
  await waitForCapReversal(operation);

  const opened = openLamps(operation, groups);
  if (opened === undefined) {
    return NO_LAMP;
  }
  try {
    const targets = new Map<OpenedLamp<unknown>, BrightnessSent>();
    for (const reached of opened.lamps) {
      const { lamp, handle, group } = reached;
      opened.attempt(lamp, () => {
        if (!group.on) {
          lamp.setPower(operation, handle, false);
          return;
        }
        lamp.setPower(operation, handle, true);
        lamp.setTemperature(operation, handle, group.kelvin);
        targets.set(reached, { percentage: group.percentage });
      });
    }
    await sendBrightness(operation, targets, opened.attempt, settleMs);
    return opened.outcome();
  } finally {
    opened.close();
  }
}

/**
 * Moves the selected lamps to their target, and lets them settle. The target is a percentage, or a step from the
 * brightest selected lamp's percentage or from each lamp's own, as the plugin holds them. Each lamp is sent the target
 * as {@link sendBrightness} sends it, caps included. Right after a lamp's cap is learned, the next change waits until
 * the lamp can no longer go back to its cap. The lamps stay open from the first step to the last, so calls mustn't
 * overlap: they go through {@link oneBrightnessChangeAtATime}.
 */
async function moveLampsBrightness(
  operation: string,
  lamps: LampSelection,
  target: Target,
  settleMs: number,
): Promise<OperationResult> {
  await waitForCapReversal(operation);

  const opened = openLamps(operation, [{ lamps }]);
  if (opened === undefined) {
    return NO_LAMP;
  }
  try {
    // The lamps, each told to turn on, even one the plugin holds as on, so one turned off another way follows the
    // plugin again, then ready for their brightness, each with its brightness in lumens before the change.
    const before = new Map<OpenedLamp<unknown>, number>();
    for (const reached of opened.lamps) {
      const { lamp, handle } = reached;
      opened.attempt(lamp, () => {
        lamp.setPower(operation, handle, true);
        before.set(reached, stateOf(lamp).lumen);
      });
    }

    // The percentage to send each lamp. Lamps kept apart also get what they're asked for.
    const targets = new Map<OpenedLamp<unknown>, BrightnessSent>();
    if (typeof target === "number") {
      for (const reached of before.keys()) {
        targets.set(reached, { percentage: target });
      }
    } else if (target.stepping === "together") {
      const levels = [...before].map(([{ lamp }, lumen]) => lamp.brightnessPercentage(lumen));
      if (levels.length > 0) {
        const stepped = stepOnGrid(Math.max(...levels), target.ticks, target.step, 0, 100);
        for (const reached of before.keys()) {
          targets.set(reached, { percentage: stepped });
        }
      }
    } else {
      const apart = [...before].map(([reached, lumen]) => {
        const { lamp, handle } = reached;
        return {
          reached,
          asked: lamp.brightnessAsked ?? lamp.brightnessPercentage(lumen),
          value: lumen,
          reach: (percentage: number) => lamp.lumenToSend(operation, handle.path, percentage),
          origin: 0,
          span: 100,
        };
      });
      for (const { reached, asked } of stepApart(apart, target.ticks, target.step)) {
        targets.set(reached, { percentage: asked, asked });
      }
    }

    await sendBrightness(operation, targets, opened.attempt, settleMs);
    return opened.outcome();
  } finally {
    opened.close();
  }
}

/**
 * Lists the connected lamps, the ones the plugin doesn't know included, in the order of their ids, as the lamp screens
 * list them (#20), each with what the keys' lamp pickers and the plugin settings show of it (#146). The plugin adds
 * them to the lamps it knows when it starts knowing none, and when Find lamps asks (#194). Lists none when finding them
 * fails.
 *
 * It doesn't wait for a brightness change in progress: finding a lamp only reads its model and serial number, from its
 * USB descriptor, or by asking a Beam LX for its serial (#170), and nothing that a change sets.
 */
export function findLamps(): FoundLamp[] {
  const { connections } = findConnections("find lamps");
  try {
    return connections.map(({ id, model, label }) => ({ id, model, label }));
  } finally {
    for (const connection of connections) {
      connection.close();
    }
  }
}

/**
 * Blinks one lamp, by its id, so the user can tell which one it is (#48): switches it the other way from the power the
 * plugin holds, and back `blinkMs` later (#171). A blink writes no brightness, so it shows at any brightness and leaves
 * learned caps alone, and the lamp ends as it started. Fails when the lamp isn't connected. Only a blink that failed
 * tells the keys and dials, since it may have left the lamp switched the other way, or found it unplugged: one that
 * didn't changes nothing they show.
 */
export async function identifyLamp(id: string, blinkMs: number): Promise<OperationResult> {
  const result = await oneBrightnessChangeAtATime(async () => {
    const operation = "identify";
    const opened = openLamps(operation, [{ lamps: [id] }]);
    if (opened === undefined) {
      return NO_LAMP;
    }
    try {
      const reached = opened.lamps[0];
      if (reached !== undefined) {
        try {
          await reached.lamp.blink(operation, reached.handle, blinkMs);
        } catch (error) {
          opened.fail(reached.lamp, error);
        }
      }
      return opened.outcome();
    } finally {
      opened.close();
    }
  });
  return result.ok ? result : announced(result);
}

/** Sets the selected lamps to the allowed temperature nearest to `kelvin`. */
export function setLampsTemperature(lamps: LampSelection, kelvin: number): OperationResult {
  return announced(moveLampsTemperature("set temperature", lamps, kelvin));
}

/**
 * Steps the selected lamps' temperature along the grid lowest + k × step: together, to one target stepped from the
 * first one's temperature (the one the dial shows), or each from its own, as {@link stepApart} plans it (#145).
 */
export function adjustLampsTemperature(
  lamps: LampSelection,
  ticks: number,
  stepKelvin: number,
  stepping: Stepping = "together",
): OperationResult {
  return announced(moveLampsTemperature("adjust temperature", lamps, { stepping, ticks, step: stepKelvin }));
}

/**
 * Moves the selected lamps to their target, each to the temperature it allows nearest to it. The target is a
 * temperature, or a step from the first selected lamp's temperature or from each lamp's own, as the plugin holds them.
 * Plans every lamp before it sets any, as {@link moveLampsBrightness} does, since a step of lamps kept apart counts a
 * tick only while a lamp still moves. When the first lamp can't be reached, the next one is where the lamps stepped
 * together start from.
 */
function moveLampsTemperature(operation: string, lamps: LampSelection, target: Target): OperationResult {
  const opened = openLamps(operation, [{ lamps }]);
  if (opened === undefined) {
    return NO_LAMP;
  }
  try {
    // The lamps to move, each with its temperature before the change and its range.
    const before = new Map<OpenedLamp<unknown>, { kelvin: number; lowest: number; highest: number }>();
    for (const reached of opened.lamps) {
      const { lamp } = reached;
      opened.attempt(lamp, () => {
        before.set(reached, { kelvin: stateOf(lamp).kelvin, lowest: lamp.lowestKelvin, highest: lamp.highestKelvin });
      });
    }

    // The temperature to set each lamp to. Lamps kept apart also get what they're asked for.
    const targets = new Map<OpenedLamp<unknown>, TemperatureSet>();
    if (typeof target === "number") {
      for (const reached of before.keys()) {
        targets.set(reached, { kelvin: target });
      }
    } else if (target.stepping === "together") {
      const [first] = before.values();
      if (first !== undefined) {
        const stepped = stepOnGrid(first.kelvin, target.ticks, target.step, first.lowest, first.highest);
        for (const reached of before.keys()) {
          targets.set(reached, { kelvin: stepped });
        }
      }
    } else {
      const apart = [...before].map(([reached, { kelvin, lowest, highest }]) => ({
        reached,
        asked: reached.lamp.temperatureAsked ?? kelvin,
        value: kelvin,
        reach: (asked: number) => reached.lamp.snapKelvin(asked),
        origin: lowest,
        span: highest - lowest,
      }));
      for (const { reached, asked } of stepApart(apart, target.ticks, target.step)) {
        targets.set(reached, { kelvin: asked, asked });
      }
    }

    for (const [{ lamp, handle }, { kelvin, asked }] of targets) {
      opened.attempt(lamp, () => lamp.setTemperature(operation, handle, kelvin, asked));
    }
    return opened.outcome();
  } finally {
    opened.close();
  }
}
