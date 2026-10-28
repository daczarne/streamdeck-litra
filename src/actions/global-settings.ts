import streamDeck from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import { logger as pluginLogger } from "../logging";
import { type LampScreens, lampScreens as sharedLampScreens } from "./lamp-screens";
import { globalSettings, parseSettings } from "./settings";

const logger = pluginLogger.createScope("Global settings");

/**
 * Follows the plugin's global settings, which the dials' settings pages save (#144): reads them once Stream Deck is
 * connected, and again whenever a page changes them, and hands the blink to the lamp screens. They're kept rather than
 * asked for on every tap, so a tap never waits on Stream Deck. Until the first read answers, the lamp screens keep the
 * blink's default, off.
 */
export function followGlobalSettings(lampScreens: LampScreens = sharedLampScreens): void {
  const apply = (settings: JsonObject): void => {
    const { blinkOnLampScreen } = parseSettings(settings, globalSettings, logger);
    lampScreens.setBlinkOnShow(blinkOnLampScreen);
  };
  streamDeck.settings.onDidReceiveGlobalSettings((ev) => apply(ev.settings));
  streamDeck.settings
    .getGlobalSettings()
    .then(apply)
    .catch((error: unknown) => {
      logger.error("Reading the global settings failed", error);
    });
}
