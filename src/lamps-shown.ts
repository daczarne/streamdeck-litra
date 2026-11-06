import type { Lamp, LampState } from "./lamp";
import { byId } from "./lamp-order";
import { type LampSelection, selects } from "./lamp-selection";

/**
 * What the Deck shows of the lamps, worked out from their `Lamp`s alone (#198): the plugin's state is the lamps' state,
 * so showing a lamp reads nothing. Every function takes the `Lamp`s of the lamps the plugin knows, and shows the ones a
 * selection takes in among those the last operation found and that the plugin holds a state of, in the order of their
 * ids. It holds no state of its own, so the keys and dials read through `src/actions/shown.ts`, which hands
 * it the lamps once a brightness change in progress has left them where it goes.
 */

/** A lamp's temperature as a dial shows it: in kelvin, and as its place between the lowest and the highest. */
export type TemperatureShown = { readonly kelvin: number; readonly percentage: number };

/** What a lamp screen shows about one lamp (#48). */
export type LampStatus = {
  id: string;
  model: string;
  /** Its name on the Deck, as on the keys' settings pages, such as "Beam - c870". */
  label: string;
  on: boolean;
  brightnessLumen: number;
  brightnessPercentage: number;
  temperatureKelvin: number;
};

/** A lamp the plugin holds a state of. */
type HeldLamp = { lamp: Lamp; state: LampState };

/** The lamps a selection takes in that are shown: connected as of the last operation, and reached since the start. */
function heldLamps(lamps: Iterable<Lamp>, selection: LampSelection): HeldLamp[] {
  const held: HeldLamp[] = [];
  for (const lamp of lamps) {
    const { state } = lamp;
    if (lamp.isConnected && state !== undefined && selects(selection, lamp.id)) {
      held.push({ lamp, state });
    }
  }
  return held.sort((a, b) => byId(a.lamp.id, b.lamp.id));
}

/** Whether a Power key shows on: only when the selection takes in a lamp, and every one is on. */
export function allLampsOn(lamps: Iterable<Lamp>, selection: LampSelection): boolean {
  const held = heldLamps(lamps, selection);
  return held.length > 0 && held.every(({ state }) => state.on);
}

/** The brightness of each lamp, as a percentage of its range, which a dial or a step key shows the brightest of. */
export function brightnessPercentages(lamps: Iterable<Lamp>, selection: LampSelection): number[] {
  return heldLamps(lamps, selection).map(({ lamp, state }) => lamp.brightnessPercentage(state.lumen));
}

/** The temperature of the first lamp, which a dial or a step key shows, or undefined with none. */
export function temperatureShown(lamps: Iterable<Lamp>, selection: LampSelection): TemperatureShown | undefined {
  const first = heldLamps(lamps, selection)[0];
  return first === undefined
    ? undefined
    : { kelvin: first.state.kelvin, percentage: first.lamp.temperaturePercentage(first.state.kelvin) };
}

/** What the lamp screens show of every lamp, which a tap steps through in this order. */
export function lampStatuses(lamps: Iterable<Lamp>): LampStatus[] {
  return heldLamps(lamps, "all").map(({ lamp, state }) => ({
    id: lamp.id,
    model: lamp.model,
    label: lamp.label,
    on: state.on,
    brightnessLumen: state.lumen,
    brightnessPercentage: lamp.brightnessPercentage(state.lumen),
    temperatureKelvin: state.kelvin,
  }));
}
