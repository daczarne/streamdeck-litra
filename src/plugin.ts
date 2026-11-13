import streamDeck from "@elgato/streamdeck";

import { BrightnessAction } from "./actions/brightness";
import { answerLampPickers } from "./actions/lamp-picker";
import { PowerAction } from "./actions/power";
import { SceneAction } from "./actions/scene";
import {
  BrightnessDownAction,
  BrightnessUpAction,
  TemperatureDownAction,
  TemperatureUpAction,
} from "./actions/step-keys";
import { TemperatureAction } from "./actions/temperature";
import { globalSettings, syncGlobalSettings } from "./global-settings";
import { findLamps, reachEveryLamp, useLamps } from "./litra-manager";
import { logger } from "./logging";

// The SDK's own logger, which only records what the SDK reports itself, in files of its own.
streamDeck.logger.setLevel("info");

// The plugin's log carries on across restarts, so each run is marked where it starts.
logger.info("Plugin started");

streamDeck.actions.registerAction(new PowerAction());
streamDeck.actions.registerAction(new BrightnessAction());
streamDeck.actions.registerAction(new TemperatureAction());
streamDeck.actions.registerAction(new SceneAction());
streamDeck.actions.registerAction(new BrightnessUpAction());
streamDeck.actions.registerAction(new BrightnessDownAction());
streamDeck.actions.registerAction(new TemperatureUpAction());
streamDeck.actions.registerAction(new TemperatureDownAction());
answerLampPickers();

// litra-manager acts on the lamps the global settings hold, handed to it rather than imported, so it doesn't depend on
// the global settings, and its tests hand it lamps of their own. It's the same map, which every read keeps up to date.
useLamps(globalSettings.lamps);

// Waited for only once connect() is called, since Stream Deck answers the first read only once the plugin is connected.
const settingsRead = syncGlobalSettings();

// Logged here rather than left to the SDK, which logs an unhandled rejection to its own files, not to litra.log.
streamDeck.connect().catch((error: unknown) => {
  logger.error("Can't connect to Stream Deck", error);
});

// The lamps are found and read only once the settings are: before, the plugin knows no lamps, so it would find the
// connected ones and save them over the ones saved (#194).
settingsRead.then(
  async () => {
    // On a first start, the plugin knows no lamps, and takes every one connected (#194).
    if (globalSettings.lamps.size === 0) {
      logger.info("No lamps known: finding the lamps connected");
      await globalSettings.addLamps(findLamps());
    }
    // Reads every lamp the plugin knows that's connected, so the Deck starts out showing them as they are (#198).
    await reachEveryLamp("start");
  },
  (error: unknown) => {
    logger.error("Reading the global settings failed", error);
  },
);
