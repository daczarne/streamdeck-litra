import { Lamp, type ReachedLamp } from "../lamps/lamp";
import { lampsSettled, reachEveryLamp } from "../lamps/manager";
import { type LampSelection, selects } from "../lamps/selection";
import { globalSettings } from "../settings/global-settings";

/**
 * What the keys and dials show of the lamps (#198): whether a Power key is on, a step key's title, and a Brightness or
 * Temperature dial's main screen and lamp screens. It's worked out from the `Lamp`s of the lamps the plugin knows, which
 * the global settings hold, and which hold the lamps' state, so showing a lamp reads nothing. Each function waits for
 * the operations queued, if any, so it shows where they leave the lamps, not partway, and shows the lamps a selection
 * takes in among those the last operation found and reached, in the order of their ids.
 */

/** A lamp's temperature as a dial shows it: in kelvin, and as its place between the lowest and the highest. */
export type TemperatureShown = {
  readonly kelvin: number;
  readonly percentage: number;
};

/** Whether a Power key shows on: only when the selection takes in a lamp shown, and every one is on. */
export async function areLampsOn(lamps: LampSelection): Promise<boolean> {
  await lampsSettled();
  const shown = shownLamps(lamps);
  return shown.length > 0 && shown.every(({ state }) => state.on);
}

/** Each lamp's brightness, in % of its range, which a dial or a step key shows the brightest of. */
export async function readLampsBrightness(lamps: LampSelection): Promise<number[]> {
  await lampsSettled();
  return shownLamps(lamps).map((lamp) => lamp.brightnessPercentage(lamp.state.lumen));
}

/** The first lamp's temperature, which a dial or a step key shows, or undefined with none. */
export async function readLampsTemperature(lamps: LampSelection): Promise<TemperatureShown | undefined> {
  await lampsSettled();
  const first = shownLamps(lamps)[0];
  return first === undefined
    ? undefined
    : { kelvin: first.state.kelvin, percentage: first.temperaturePercentage(first.state.kelvin) };
}

/** Every lamp shown, which the lamp screens show, each as its `Lamp`, in the order a tap steps through them. */
export async function readShownLamps(): Promise<ReachedLamp[]> {
  await lampsSettled();
  return shownLamps("connected");
}

/**
 * Finds the lamps connected for a tap on a dial's strip, so it neither shows a lamp unplugged since the last operation
 * nor misses one plugged in since, then every lamp shown, which the lamp screens show.
 */
export async function findShownLamps(): Promise<ReachedLamp[]> {
  await reachEveryLamp("lamp screen");
  return shownLamps("connected");
}

/** The lamps a selection takes in that are shown: connected as of the last operation, and reached since the start. */
function shownLamps(selection: LampSelection): ReachedLamp[] {
  const shown: ReachedLamp[] = [];
  for (const lamp of globalSettings.lamps.values()) {
    if (lamp.isConnected && lamp.isReached() && selects(selection, lamp.id)) {
      shown.push(lamp);
    }
  }
  return shown.sort((a, b) => Lamp.byId(a.id, b.id));
}
