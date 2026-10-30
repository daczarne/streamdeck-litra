import streamDeck from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import type { Stepping } from "../litra-manager";
import { logger as pluginLogger } from "../logging";
import { type GlobalSettings, globalSettings, parseSettings } from "./settings";

const logger = pluginLogger.createScope("Global settings");

// The global settings as last read, their defaults until the first read answers.
let current: GlobalSettings = parseSettings({}, globalSettings, logger);

/**
 * Follows the plugin's global settings, which the settings pages save (#144): reads them once Stream Deck is
 * connected, and again whenever a page changes them. They're kept rather than asked for on every tap, turn or press, so
 * none of them waits on Stream Deck.
 */
export function followGlobalSettings(): void {
  const apply = (settings: JsonObject): void => {
    current = parseSettings(settings, globalSettings, logger);
  };
  streamDeck.settings.onDidReceiveGlobalSettings((ev) => apply(ev.settings));
  streamDeck.settings
    .getGlobalSettings()
    .then(apply)
    .catch((error: unknown) => {
      logger.error("Reading the global settings failed", error);
    });
}

/** The global settings as last read, or their defaults until the first read answers. */
export function currentGlobalSettings(): GlobalSettings {
  return current;
}

/**
 * Whether a dial blinks each lamp as its lamp screen shows it (#144): the plugin's setting, or the opposite for a dial
 * that chose otherwise on its own page.
 */
export function blinksOnLampScreen(dialId: string): boolean {
  return current.blinkOnLampScreen !== current.blinkOnLampScreenExceptions.includes(dialId);
}

/** How long a blink that identifies a lamp keeps it switched, in ms (#171). */
export function identifyBlinkMs(): number {
  return current.identifyBlinkMs;
}

/** How a turn on a Brightness dial's main screen, or a Brightness step key's press, steps the lamps (#145). */
export function brightnessStepping(): Stepping {
  return current.keepBrightnessDifference ? "each" : "together";
}

/** How a turn on a Temperature dial's main screen, or a Temperature step key's press, steps the lamps (#145). */
export function temperatureStepping(): Stepping {
  return current.keepTemperatureDifference ? "each" : "together";
}
