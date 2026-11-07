import { Lamp, type LampState } from "../lamp";
import type { LampHandle, LampRange } from "../lamp-connection";
import type { ShownLamp } from "../lamps-shown";

/**
 * `Lamp`s as an operation leaves them, for the tests of what the Deck shows, which need no lamp: each is reached
 * through a handle that only answers the state it's given. The tests that build them mock `src/logging.ts`, since a
 * `Lamp` logs what it reads.
 */

/** A Beam's range: 30 to 400 lm, and 2700 K to 6500 K in steps of 100 K. */
export const BEAM_RANGE: LampRange = {
  minLumen: 30,
  maxLumen: 400,
  allowedKelvin: Array.from({ length: 39 }, (_, step) => 2700 + step * 100),
};

/** A lamp opened for an operation, in a Beam's range, which only answers what it's at, as reaching a lamp reads it. */
export function handleAt(state: LampState): LampHandle {
  return {
    path: "path-1",
    range: BEAM_RANGE,
    isOn: () => state.on,
    switchPower: () => {},
    readBrightness: () => state.lumen,
    writeBrightness: () => {},
    readTemperature: () => state.kelvin,
    writeTemperature: () => {},
  };
}

/** A lamp the plugin knows, by its id and model, as the last operation found it at a state. */
export function reachedLamp(id: string, state: LampState, model = "Beam"): Lamp {
  const lamp = new Lamp({ id, model });
  lamp.reach("test", handleAt(state));
  return lamp;
}

/** A lamp the Deck shows, by its id and model, at a state, with the name given to it, if any. */
export function shownLamp(id: string, state: LampState, { model = "Beam", name }: ShownOptions = {}): ShownLamp {
  const lamp = reachedLamp(id, state, model);
  lamp.name = name;
  const held = lamp.state;
  if (held === undefined) {
    throw new Error(`${lamp.label} holds no state once reached`);
  }
  return { lamp, state: held };
}

/** What a lamp shown is besides its id and state: its model, a Beam unless given, and its name, none unless given. */
type ShownOptions = {
  model?: string;
  name?: string | undefined;
};
