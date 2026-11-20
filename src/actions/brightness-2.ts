import { action } from "@elgato/streamdeck";
import { MeasureAction } from "../controls/measure";
import { logger as pluginLogger } from "../logging";
import { globalSettings } from "../settings/global-settings";
import { BRIGHTNESS } from "./brightness";

/** A trial copy of the Brightness dial, on a custom copy of the $B1 layout whose title takes a color. */
@action({ UUID: "com.daczarne.litra.brightness-2" })
export class Brightness2Action extends MeasureAction {
  /** Steps the brightness, as the Brightness dial does, on the custom layout. */
  constructor() {
    super(pluginLogger.createScope("Brightness 2"), {
      ...BRIGHTNESS,
      layout: { path: "layouts/main.json", titleKey: "heading" },
      mainScreen: async () => ({
        ...(await BRIGHTNESS.mainScreen()),
        title: globalSettings.mainScreenTitles.brightness,
      }),
    });
  }
}
