import { action } from "@elgato/streamdeck";
import { type Preset, PresetKeyAction } from "../controls/preset-key";
import { setLampsBrightness } from "../lamps/manager";
import { logger as pluginLogger } from "../logging";
import { globalSettings } from "../settings/global-settings";
import { brightnessSettingsSchema, parseSettings } from "../settings/schemas";

/** What a Set Brightness key sets its lamps to: its preset, in % of their range. */
const PRESET: Preset = {
  read: (settings, logger) => {
    const { presetPercentage, lamps, leftOutLamps } = parseSettings(settings, brightnessSettingsSchema, logger);
    return { preset: presetPercentage, lamps, leftOutLamps };
  },
  unit: "%",
  turnsLampsOn: () => globalSettings.turnsLampsOn("setBrightnessKeys"),
  set: setLampsBrightness,
};

/**
 * The Set Brightness action, on keys alone: each key sets its lamps to its preset. The Brightness action is its dial.
 */
@action({ UUID: "com.daczarne.litra.set-brightness" })
export class SetBrightnessAction extends PresetKeyAction {
  /** Sets the brightness. */
  constructor() {
    super(pluginLogger.createScope("Set Brightness"), PRESET);
  }
}
