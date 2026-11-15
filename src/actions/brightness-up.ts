import { action } from "@elgato/streamdeck";
import { BRIGHTNESS, StepKeyAction } from "../controls/step-key";
import { logger as pluginLogger } from "../logging";

/** The Brightness Up key: steps its lamps' brightness up by the key's step. */
@action({ UUID: "com.daczarne.litra.brightness-up" })
export class BrightnessUpAction extends StepKeyAction {
  /** Steps the brightness up. */
  constructor() {
    super(pluginLogger.createScope("Brightness Up"), BRIGHTNESS, 1);
  }
}
