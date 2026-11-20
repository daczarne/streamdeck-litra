import { action } from "@elgato/streamdeck";
import { type Preset, PresetKeyAction } from "../controls/preset-key";
import { setLampsTemperature } from "../lamps/manager";
import { logger as pluginLogger } from "../logging";
import { globalSettings } from "../settings/global-settings";
import { parseSettings, temperatureSettingsSchema } from "../settings/schemas";

/** What a Set Temperature key sets its lamps to: its preset, in kelvin, which each lamp snaps to one it allows. */
const PRESET: Preset = {
  read: (settings, logger) => {
    const { presetKelvin, lamps, leftOutLamps } = parseSettings(settings, temperatureSettingsSchema, logger);
    return { preset: presetKelvin, lamps, leftOutLamps };
  },
  unit: " K",
  turnsLampsOn: (keyId) => globalSettings.turnsLampsOn("setTemperatureKeys", keyId),
  set: setLampsTemperature,
};

/**
 * The Set Temperature action, on keys alone: each key sets its lamps to its preset. The Temperature action is its dial.
 */
@action({ UUID: "com.daczarne.litra.set-temperature" })
export class SetTemperatureAction extends PresetKeyAction {
  /** Sets the temperature. */
  constructor() {
    super(pluginLogger.createScope("Set Temperature"), PRESET);
  }
}
