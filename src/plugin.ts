import streamDeck from "@elgato/streamdeck";

import { BrightnessAction } from "./actions/brightness";
import { PowerAction } from "./actions/power";
import { TemperatureAction } from "./actions/temperature";

streamDeck.logger.setLevel("info");

streamDeck.actions.registerAction(new PowerAction());
streamDeck.actions.registerAction(new BrightnessAction());
streamDeck.actions.registerAction(new TemperatureAction());

streamDeck.connect();
