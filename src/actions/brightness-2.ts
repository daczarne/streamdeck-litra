import { action } from "@elgato/streamdeck";
import { MeasureAction } from "../controls/measure";
import { logger as pluginLogger } from "../logging";
import { globalSettings } from "../settings/global-settings";
import { BRIGHTNESS, PRESET } from "./brightness";

/** A trial copy of the Set Brightness dial, on a custom copy of the $B1 layout whose title takes a color. */
@action({ UUID: "com.daczarne.litra.brightness-2" })
export class Brightness2Action extends MeasureAction {
  /** Steps and sets the brightness, as Set Brightness does, on the custom layout. */
  constructor() {
    super(pluginLogger.createScope("Set Brightness 2"), PRESET, {
      ...BRIGHTNESS,
      layout: { path: "layouts/main.json", titleKey: "heading" },
      mainScreen: async () => ({
        ...(await BRIGHTNESS.mainScreen()),
        title: globalSettings.mainScreenTitles.brightness,
      }),
    });
  }
}
