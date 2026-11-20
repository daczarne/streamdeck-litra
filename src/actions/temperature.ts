import { temperatureGlyph } from "@daczarne/streamdeck-icons";
import { action } from "@elgato/streamdeck";
import { type Measure, MeasureAction } from "../controls/measure";
import { temperatureShown, temperatureText } from "../controls/shown";
import { adjustLampsTemperature } from "../lamps/manager";
import { logger as pluginLogger } from "../logging";
import { globalSettings } from "../settings/global-settings";
import { parseSettings, temperatureDialSettingsSchema } from "../settings/schemas";

/**
 * What a Temperature dial steps, and shows on its main screen, in the slots of the $B1 layout: the highest
 * temperature as text, and its place in the lamps' range as the bar under it, banded by how many lamps reach each part
 * of it, as the Brightness dial's (#229), or a dash with no lamp.
 */
const TEMPERATURE: Measure = {
  adjusts: "Temperature",
  readStep: (settings, logger) => parseSettings(settings, temperatureDialSettingsSchema, logger).stepKelvin,
  unit: " K",
  stepping: () => globalSettings.temperatureStepping,
  turnsLampsOn: (screen) =>
    globalSettings.turnsLampsOn(screen === "main" ? "setTemperatureDials" : "setTemperatureLampScreens"),
  adjust: adjustLampsTemperature,
  glyph: temperatureGlyph,
  mainScreen: async () => {
    const shown = await temperatureShown("connected");
    return {
      title: "Temperature",
      value: temperatureText(shown),
      levels: shown.map(({ percentage }) => percentage),
    };
  },
};

/**
 * The Temperature action, on dials alone: it steps the temperature as the dial turns, toggles the lamps when pushed, and shows
 * each lamp on its own screen when the strip is tapped (#20). The Set Temperature action is its key.
 */
@action({ UUID: "com.daczarne.litra.temperature" })
export class TemperatureAction extends MeasureAction {
  /** Steps the temperature. */
  constructor() {
    super(pluginLogger.createScope("Temperature"), TEMPERATURE);
  }
}
