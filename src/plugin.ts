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

// Without a connection the plugin can do nothing, so it ends, as an unhandled rejection would, but logged first. The
// log is written synchronously, so exiting right after doesn't lose the line.
streamDeck.connect().catch((error: unknown) => {
  logger.error("Can't connect to Stream Deck", error);
  process.exit(1);
});
