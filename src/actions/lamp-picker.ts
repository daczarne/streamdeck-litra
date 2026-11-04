import streamDeck from "@elgato/streamdeck";
import type { JsonValue } from "@elgato/utils";

import { globalSettings } from "../global-settings";
import { findLamps, identifyLamp } from "../litra-manager";
import { logger as pluginLogger } from "../logging";

const logger = pluginLogger.createScope("Lamp picker");

/**
 * Answers the plugin settings on every page (#146, `ui/plugin-settings.js`), whichever action's page they're on: the
 * connected lamps when Find lamps asks for them, which the plugin adds to the ones it knows (#194), a blink of one when
 * its Identify button is pressed, and a lamp renamed (#146) or forgotten (#194), which only the plugin saves. The keys'
 * lamp pickers (#20, `ui/lamp-picker.js`) ask for nothing: they list the lamps the plugin knows, from its global
 * settings.
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
    await globalSettings.addLamps(lamps);
    await streamDeck.ui.sendToPropertyInspector({ event: "lamps", lamps });
  } else if (payload.event === "identify" && typeof payload.id === "string") {
    logger.info("Identify pressed on a settings page");
    // The page has no alert to show: litra-manager logs a lamp it can't find or blink.
    await identifyLamp(payload.id, globalSettings.identifyBlinkMs);
  } else if (payload.event === "rename" && typeof payload.id === "string" && typeof payload.name === "string") {
    await globalSettings.renameLamp(payload.id, payload.name);
  } else if (payload.event === "forget" && typeof payload.id === "string") {
    logger.info("Forget pressed on a settings page");
    await globalSettings.forgetLamp(payload.id);
  }
}
