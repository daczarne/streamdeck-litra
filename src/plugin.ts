import streamDeck from "@elgato/streamdeck";

import { BrightnessAction } from "./actions/brightness";
import { PowerAction } from "./actions/power";
import { TemperatureAction } from "./actions/temperature";
import { logger } from "./logging";

// The SDK's own logger, which only records what the SDK reports itself, in files of its own.
streamDeck.logger.setLevel("info");

// The plugin's log carries on across restarts, so each run is marked where it starts.
logger.info("Plugin started");

streamDeck.actions.registerAction(new PowerAction());
streamDeck.actions.registerAction(new BrightnessAction());
streamDeck.actions.registerAction(new TemperatureAction());

streamDeck.connect();
