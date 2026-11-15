import { action } from "@elgato/streamdeck";
import { type Measure, MeasureAction, type Preset } from "../controls/measure";
import { temperatureShown, temperatureText } from "../controls/shown";
import { adjustLampsTemperature, setLampsTemperature } from "../lamps/manager";
import { logger as pluginLogger } from "../logging";
import { globalSettings } from "../settings/global-settings";
import { parseSettings, temperatureSettingsSchema } from "../settings/schema";

/** What a Temperature key sets its lamps to: its preset, in kelvin, which each lamp snaps to one it allows. */
const PRESET: Preset = {
  read: (settings, logger) => {
    const { presetKelvin, lamps, leftOutLamps } = parseSettings(settings, temperatureSettingsSchema, logger);
    return { preset: presetKelvin, lamps, leftOutLamps };
  },
  unit: " K",
  set: setLampsTemperature,
};

/**
 * What a Temperature dial steps, and shows on its main screen, in the slots of the $B1 layout: the first lamp's
 * temperature as text, or a dash with no lamp, and its place in the lamp's range as the bar under it.
 */
const TEMPERATURE: Measure = {
  name: "Temperature",
  readStep: (settings, logger) => parseSettings(settings, temperatureSettingsSchema, logger).stepKelvin,
  unit: " K",
  stepping: () => globalSettings.temperatureStepping,
  adjust: adjustLampsTemperature,
  mainScreen: async () => {
    const shown = await temperatureShown("connected");
    return {
      title: "Temperature",
      value: temperatureText(shown),
      indicator: shown?.percentage ?? 0,
    };
  },
};

/**
 * The Temperature action. On a key, it sets its lamps to the key's preset. On a dial, it steps the temperature as the
 * dial turns, toggles the lamps when pushed, and shows each lamp on its own screen when the strip is tapped (#20).
 */
@action({ UUID: "com.daczarne.litra.temperature" })
export class TemperatureAction extends MeasureAction {
  /** Steps and sets the temperature. */
  constructor() {
    super(pluginLogger.createScope("Temperature"), PRESET, TEMPERATURE);
  }
}
