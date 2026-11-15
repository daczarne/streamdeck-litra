import { action } from "@elgato/streamdeck";
import { BRIGHTNESS, StepKeyAction } from "../controls/step-key";
import { logger as pluginLogger } from "../logging";

/** The Brightness Down key: steps its lamps' brightness down by the key's step. */
@action({ UUID: "com.daczarne.litra.brightness-down" })
export class BrightnessDownAction extends StepKeyAction {
  /** Steps the brightness down. */
  constructor() {
    super(pluginLogger.createScope("Brightness Down"), BRIGHTNESS, -1);
  }
}
