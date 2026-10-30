import streamDeck from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { findLamps, identifyLamp } from "../litra-manager";
import { logger as pluginLogger } from "../logging";
import { identifyBlinkMs } from "./global-settings";

const logger = pluginLogger.createScope("Lamp picker");

/**
 * Answers the lamp picker on the keys' settings pages (#20, `ui/lamp-picker.js`) and the plugin settings on every page
 * (#146, `ui/plugin-settings.js`), whichever action's page they're on: the connected lamps when a page asks for them,
 * and a blink of one when its Identify button is pressed.
 */
export function answerLampPickers(): void {
  streamDeck.ui.onSendToPlugin((ev) => {
    answer(ev.payload).catch((error: unknown) => {
      logger.error("Answering a settings page failed", error);
    });
  });
}

/** Answers one message from a settings page. Messages the picker doesn't send are ignored. */
export async function answer(payload: JsonValue): Promise<void> {
  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    return;
  }
  if (payload.event === "lamps") {
    logger.info("Settings page asked for the lamps");
    const lamps = findLamps();
    await streamDeck.ui.sendToPropertyInspector({ event: "lamps", lamps });
  } else if (payload.event === "identify" && typeof payload.id === "string") {
    logger.info("Identify pressed on a settings page");
    // The page has no alert to show: litra-manager logs a lamp it can't find or blink.
    await identifyLamp(payload.id, identifyBlinkMs());
  }
}
