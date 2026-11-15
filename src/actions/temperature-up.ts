import { action } from "@elgato/streamdeck";
import { StepKeyAction, TEMPERATURE } from "../controls/step-key";
import { logger as pluginLogger } from "../logging";

/** The Temperature Up key: steps its lamps' temperature up, cooler, by the key's step. */
@action({ UUID: "com.daczarne.litra.temperature-up" })
export class TemperatureUpAction extends StepKeyAction {
  /** Steps the temperature up. */
  constructor() {
    super(pluginLogger.createScope("Temperature Up"), TEMPERATURE, 1);
  }
}
