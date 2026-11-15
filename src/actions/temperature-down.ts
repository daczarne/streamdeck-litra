import { action } from "@elgato/streamdeck";
import { StepKeyAction, TEMPERATURE } from "../controls/step-key";
import { logger as pluginLogger } from "../logging";

/** The Temperature Down key: steps its lamps' temperature down, warmer, by the key's step. */
@action({ UUID: "com.daczarne.litra.temperature-down" })
export class TemperatureDownAction extends StepKeyAction {
  /** Steps the temperature down. */
  constructor() {
    super(pluginLogger.createScope("Temperature Down"), TEMPERATURE, -1);
  }
}
