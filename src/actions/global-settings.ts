import streamDeck from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import type { LampSelection, Stepping } from "../litra-manager";
import { logger as pluginLogger } from "../logging";
import {
  type CheckedLamps,
  type GlobalSettings,
  globalSettings,
  LAMP_SCREEN_CELLS,
  type LampScreenCell,
  type LampScreenItem,
  type LampScreenItemOptions,
  lampScreenItemOptions,
  parseSettings,
  type TextStyleName,
} from "./settings";

/** A text's look on the lamp screens: its color, and its font's size and weight (#153). */
export type TextStyle = { color: string; font: { size: number; weight: number } };

/** The font weights the settings offer, as a layout's text takes them. */
export const FONT_WEIGHTS = { normal: 400, bold: 700 };

/** What a cell of the lamp screens shows, and how (#177). */
export type LampScreenCellContent = {
  [Item in LampScreenItem]: { item: Item; options: LampScreenItemOptions[Item] };
}[LampScreenItem];

const logger = pluginLogger.createScope("Global settings");

// The global settings as last read, their defaults until the first read answers, and the lamp screens' cells read from
// them, once per read, so an option that isn't valid is warned about once.
let current: GlobalSettings = parseSettings({}, globalSettings, logger);
let cells: Record<LampScreenCell, LampScreenCellContent> = readCells(current);

const changedListeners: Array<() => void | Promise<void>> = [];

/**
 * Registers a listener called whenever the global settings are read, so that what the Deck shows from them can follow
 * a settings page's changes, such as the lamp screens' cells (#177).
 */
export function onGlobalSettingsChanged(listener: () => void | Promise<void>): void {
  changedListeners.push(listener);
}

/**
 * Follows the plugin's global settings, which the settings pages save (#144): reads them once Stream Deck is
 * connected, and again whenever a page changes them. They're kept rather than asked for on every tap, turn or press, so
 * none of them waits on Stream Deck.
 */
export function followGlobalSettings(): void {
  const apply = (settings: JsonObject): void => {
    current = parseSettings(settings, globalSettings, logger);
    cells = readCells(current);
    for (const listener of changedListeners) {
      Promise.resolve()
        .then(listener)
        .catch((error: unknown) => {
          logger.error("Global settings listener failed", error);
        });
    }
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

/** Whether a key adds lamps plugged in later (#147): the plugin's setting, or the opposite for a key that chose otherwise. */
export function addsNewLamps(keyId: string): boolean {
  return current.addNewLamps !== current.addNewLampsExceptions.includes(keyId);
}

/**
 * The lamps a key acts on (#147), from the lamps its page checked and left out: every lamp for a key saved before it
 * could pick them, every lamp but the left out ones for a key that adds new lamps, or the checked ones.
 */
export function keyLamps(
  keyId: string,
  saved: { lamps: CheckedLamps; leftOutLamps: readonly string[] },
): LampSelection {
  if (saved.lamps === "all") {
    return "all";
  }
  return addsNewLamps(keyId) ? { except: saved.leftOutLamps } : saved.lamps;
}

/** How long a blink that identifies a lamp keeps it switched, in ms (#171). */
export function identifyBlinkMs(): number {
  return current.identifyBlinkMs;
}

/** What each cell of the lamp screens shows, and how (#177). */
export function lampScreenCells(): Record<LampScreenCell, LampScreenCellContent> {
  return cells;
}

/** The lamp screens' text styles, by name (#153). */
export type TextStyles = Record<TextStyleName, TextStyle>;

/**
 * The lamp screens' text styles (#153): Primary, for every text by default, Secondary, for the power's "OFF" by
 * default, Accent and Alert.
 */
export function textStyles(): TextStyles {
  const style = (color: string, weight: keyof typeof FONT_WEIGHTS, size: number): TextStyle => ({
    color,
    font: { size, weight: FONT_WEIGHTS[weight] },
  });
  return {
    primary: style(current.lampScreenPrimaryColor, current.lampScreenPrimaryWeight, current.lampScreenPrimarySize),
    secondary: style(
      current.lampScreenSecondaryColor,
      current.lampScreenSecondaryWeight,
      current.lampScreenSecondarySize,
    ),
    accent: style(current.lampScreenAccentColor, current.lampScreenAccentWeight, current.lampScreenAccentSize),
    alert: style(current.lampScreenAlertColor, current.lampScreenAlertWeight, current.lampScreenAlertSize),
  };
}

/** The name given to a lamp in the plugin settings (#146), or undefined for a lamp with none. */
export function lampName(lampId: string): string | undefined {
  return current.lampNames[lampId];
}

/**
 * Reads each cell's item, and its options for that item against their schema, which take their defaults when they're
 * missing, and with a warning that names the cell when they aren't valid.
 */
function readCells(settings: GlobalSettings): Record<LampScreenCell, LampScreenCellContent> {
  const items: Record<LampScreenCell, LampScreenItem> = {
    topLeft: settings.lampScreenTopLeft,
    topRight: settings.lampScreenTopRight,
    middleLeft: settings.lampScreenMiddleLeft,
    middleRight: settings.lampScreenMiddleRight,
    bottomLeft: settings.lampScreenBottomLeft,
    bottomRight: settings.lampScreenBottomRight,
  };
  const read = (cell: LampScreenCell): LampScreenCellContent => {
    const item = items[cell];
    const saved = objectAt(objectAt(settings.lampScreenOptions, cell), item);
    // The schema matches the item, which TypeScript can't follow through the lookup.
    return {
      item,
      options: parseSettings(saved, lampScreenItemOptions[item], {
        warn: (...data) => logger.warn(`Lamp screens' ${cell} cell, ${item}:`, ...data),
      }),
    } as LampScreenCellContent;
  };
  return Object.fromEntries(LAMP_SCREEN_CELLS.map((cell) => [cell, read(cell)])) as Record<
    LampScreenCell,
    LampScreenCellContent
  >;
}

/** The object at a key of another, or an empty one when there's none. */
function objectAt(object: JsonObject, key: string): JsonObject {
  const value = object[key];
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

/** How a turn on a Brightness dial's main screen, or a Brightness step key's press, steps the lamps (#145). */
export function brightnessStepping(): Stepping {
  return current.keepBrightnessDifference ? "each" : "together";
}

/** How a turn on a Temperature dial's main screen, or a Temperature step key's press, steps the lamps (#145). */
export function temperatureStepping(): Stepping {
  return current.keepTemperatureDifference ? "each" : "together";
}
