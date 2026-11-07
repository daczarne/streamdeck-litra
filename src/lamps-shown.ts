import type { Lamp, LampState } from "./lamp";
import { byId } from "./lamp-order";
import { type LampSelection, selects } from "./lamp-selection";

/**
 * What the keys and dials show of the lamps' state (#198): whether a Power key is on, a step key's title, and a
 * Brightness or Temperature dial's main screen and lamp screens. It's worked out from the `Lamp`s alone, which hold the
 * lamps' state, so showing a lamp reads nothing. Every function takes the `Lamp`s of the lamps the plugin knows, and
 * shows the ones a selection takes in among those the last operation found and that the plugin holds a state of, in the
 * order of their ids. It holds no state of its own: the keys and dials read it through `src/actions/shown.ts`, which
 * hands it the lamps once a brightness change in progress has left them where it goes.
 */

/** A lamp's temperature as a dial shows it: in kelvin, and as its place between the lowest and the highest. */
export type TemperatureShown = {
  readonly kelvin: number;
  readonly percentage: number;
};

/**
 * A lamp the Deck shows: its `Lamp`, which names it and converts within its range, and the state it held when it was
 * picked to be shown, which it holds once an operation has reached it. A lamp screen draws from one `ShownLamp`, so
 * everything it shows comes from the same state, even when the lamp changes while it draws.
 */
export type ShownLamp = {
  readonly lamp: Lamp;
  readonly state: LampState;
};

/**
 * The lamps a selection takes in that are shown: connected as of the last operation, and reached since the start. The
 * lamp screens show every one, which a tap steps through in this order.
 */
export function shownLamps(lamps: Iterable<Lamp>, selection: LampSelection): ShownLamp[] {
  const shown: ShownLamp[] = [];
  for (const lamp of lamps) {
    const { state } = lamp;
    if (lamp.isConnected && state !== undefined && selects(selection, lamp.id)) {
      shown.push({ lamp, state });
    }
  }
  return shown.sort((a, b) => byId(a.lamp.id, b.lamp.id));
}

/** Whether a Power key shows on: only when the selection takes in a lamp, and every one is on. */
export function allLampsOn(lamps: Iterable<Lamp>, selection: LampSelection): boolean {
  const shown = shownLamps(lamps, selection);
  return shown.length > 0 && shown.every(({ state }) => state.on);
}

/** The brightness of each lamp, as a percentage of its range, which a dial or a step key shows the brightest of. */
export function brightnessPercentages(lamps: Iterable<Lamp>, selection: LampSelection): number[] {
  return shownLamps(lamps, selection).map(({ lamp, state }) => lamp.brightnessPercentage(state.lumen));
}

/** The temperature of the first lamp, which a dial or a step key shows, or undefined with none. */
export function temperatureShown(lamps: Iterable<Lamp>, selection: LampSelection): TemperatureShown | undefined {
  const first = shownLamps(lamps, selection)[0];
  return first === undefined
    ? undefined
    : { kelvin: first.state.kelvin, percentage: first.lamp.temperaturePercentage(first.state.kelvin) };
}
