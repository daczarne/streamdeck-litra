import { brightnessGlyph } from "@daczarne/streamdeck-icons";
import { action } from "@elgato/streamdeck";
import { type Measure, MeasureAction, type Preset } from "../controls/measure";
import { brightnessShown, brightnessText } from "../controls/shown";
import { adjustLampsBrightness, setLampsBrightness } from "../lamps/manager";
import { logger as pluginLogger } from "../logging";
import { globalSettings } from "../settings/global-settings";
import { brightnessSettingsSchema, parseSettings } from "../settings/schemas";

/** What a Set Brightness key sets its lamps to: its preset, in % of their range. */
export const PRESET: Preset = {
  read: (settings, logger) => {
    const { presetPercentage, lamps, leftOutLamps } = parseSettings(settings, brightnessSettingsSchema, logger);
    return { preset: presetPercentage, lamps, leftOutLamps };
  },
  unit: "%",
  turnsLampsOn: () => globalSettings.turnsLampsOn("setBrightnessKeys"),
  set: setLampsBrightness,
};

/**
 * What a Set Brightness dial steps, and shows on its main screen, in the slots of the $B1 layout: the brightest
 * lamp's % as text, and again as the bar under it, banded by how many lamps reach each part of it, or a dash with no
 * lamp.
 */
export const BRIGHTNESS: Measure = {
  adjusts: "Brightness",
  readStep: (settings, logger) => parseSettings(settings, brightnessSettingsSchema, logger).stepPercentage,
  unit: "%",
  stepping: () => globalSettings.brightnessStepping,
  turnsLampsOn: (screen) =>
    globalSettings.turnsLampsOn(screen === "main" ? "setBrightnessDials" : "setBrightnessLampScreens"),
  adjust: adjustLampsBrightness,
  glyph: brightnessGlyph,
  mainScreen: async () => {
    const levels = await brightnessShown("connected");
    return {
      title: "Set Brightness",
      value: brightnessText(levels),
      levels,
    };
  },
};

/**
 * The Set Brightness action. On a key, it sets its lamps to the key's preset. On a dial, it steps the brightness as
 * the dial turns, toggles the lamps when pushed, and shows each lamp on its own screen when the strip is tapped (#20).
 */
@action({ UUID: "com.daczarne.litra.brightness" })
export class BrightnessAction extends MeasureAction {
  /** Steps and sets the brightness. */
  constructor() {
    super(pluginLogger.createScope("Set Brightness"), PRESET, BRIGHTNESS);
  }
}
