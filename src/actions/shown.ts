import { globalSettings } from "../global-settings";
import type { LampSelection } from "../lamp-selection";
import {
  allLampsOn,
  brightnessPercentages,
  type LampStatus,
  lampStatuses,
  type TemperatureShown,
  temperatureShown,
} from "../lamps-shown";
import { lampsSettled, reachLampsForLampScreen } from "../litra-manager";

/**
 * What the keys and dials show of the lamps they act on, from the `Lamp`s the global settings hold, without reading the
 * lamps (#198). Each waits for the brightness change in progress, if any, so it shows where the change leaves the
 * lamps, not partway (see `src/lamps-shown.ts`).
 */

/** Whether every lamp a selection takes in is on, which a Power key shows, and none is off when there's none. */
export async function areLampsOn(lamps: LampSelection): Promise<boolean> {
  await lampsSettled();
  return allLampsOn(globalSettings.lamps.values(), lamps);
}

/** Each lamp's brightness, in % of its range, which a dial or a step key shows the brightest of. */
export async function readLampsBrightness(lamps: LampSelection): Promise<number[]> {
  await lampsSettled();
  return brightnessPercentages(globalSettings.lamps.values(), lamps);
}

/** The first lamp's temperature, which a dial or a step key shows, or undefined with none. */
export async function readLampsTemperature(lamps: LampSelection): Promise<TemperatureShown | undefined> {
  await lampsSettled();
  return temperatureShown(globalSettings.lamps.values(), lamps);
}

/** What the lamp screens show of every lamp, in the order a tap steps through them. */
export async function readLampStatuses(): Promise<LampStatus[]> {
  await lampsSettled();
  return lampStatuses(globalSettings.lamps.values());
}

/**
 * Finds the lamps connected for a tap on a dial's strip, so it neither shows a lamp unplugged since the last operation
 * nor misses one plugged in since, then what the lamp screens show of each.
 */
export async function findLampStatuses(): Promise<LampStatus[]> {
  await reachLampsForLampScreen();
  return lampStatuses(globalSettings.lamps.values());
}
