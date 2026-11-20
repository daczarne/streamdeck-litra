import { brightnessGlyph } from "@daczarne/streamdeck-icons";
import { action } from "@elgato/streamdeck";
import { type Measure, MeasureAction } from "../controls/measure";
import { brightnessShown, brightnessText } from "../controls/shown";
import { adjustLampsBrightness } from "../lamps/manager";
import { logger as pluginLogger } from "../logging";
import { globalSettings } from "../settings/global-settings";
import { brightnessDialSettingsSchema, parseSettings } from "../settings/schemas";

/**
 * What a Brightness dial steps, and shows on its main screen, in the slots of the $B1 layout: the brightest
 * lamp's % as text, and again as the bar under it, banded by how many lamps reach each part of it, or a dash with no
 * lamp.
 */
const BRIGHTNESS: Measure = {
  adjusts: "Brightness",
  readStep: (settings, logger) => parseSettings(settings, brightnessDialSettingsSchema, logger).stepPercentage,
  unit: "%",
  stepping: () => globalSettings.brightnessStepping,
  turnsLampsOn: (screen) =>
    globalSettings.turnsLampsOn(screen === "main" ? "setBrightnessDials" : "setBrightnessLampScreens"),
  adjust: adjustLampsBrightness,
  glyph: brightnessGlyph,
  mainScreen: async () => {
    const levels = await brightnessShown("connected");
    return {
      title: "Brightness",
      value: brightnessText(levels),
      levels,
    };
  },
};

/**
 * The Brightness action, on dials alone: it steps the brightness as the dial turns, toggles the lamps when pushed, and shows
 * each lamp on its own screen when the strip is tapped (#20). The Set Brightness action is its key.
 */
@action({ UUID: "com.daczarne.litra.brightness" })
export class BrightnessAction extends MeasureAction {
  /** Steps the brightness. */
  constructor() {
    super(pluginLogger.createScope("Brightness"), BRIGHTNESS);
  }
}
