import streamDeck from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import { type FoundLamp, findLamps, type LampSelection, type Stepping, setKnownLamps } from "../litra-manager";
import { logger as pluginLogger } from "../logging";
import {
  type CheckedLamps,
  type GlobalSettings,
  globalSettings,
  type KnownLamp,
  LAMP_SCREEN_CELLS,
  type LampScreenCell,
  type LampScreenItem,
  type LampScreenItemOptions,
  lampScreenItemOptions,
  MAX_LAMP_NAME_LENGTH,
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

// The global settings as last read, as Stream Deck sent them and as read against their schema, their defaults until the
// first read answers, and the lamp screens' cells read from them, once per read, so an option that isn't valid is warned
// about once. The plugin writes the lamps back into the settings as sent, which keeps the others as a page saved them.
let sent: JsonObject = {};
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
 * Takes the global settings as the ones in use: reads them, tells litra-manager of the lamps the plugin knows, and calls
 * the listeners.
 */
function apply(settings: JsonObject): void {
  sent = settings;
  current = parseSettings(settings, globalSettings, logger);
  cells = readCells(current);
  setKnownLamps(Object.keys(current.lamps));
  for (const listener of changedListeners) {
    Promise.resolve()
      .then(listener)
      .catch((error: unknown) => {
        logger.error("Global settings listener failed", error);
      });
  }
}

/**
 * Follows the plugin's global settings, which the settings pages save (#144): reads them once Stream Deck is
 * connected, and again whenever a page changes them. They're kept rather than asked for on every tap, turn or press, so
 * none of them waits on Stream Deck. When the plugin knows no lamps yet, it finds the connected ones first, so a new
 * user starts with every lamp (#194).
 */
export function followGlobalSettings(): void {
  streamDeck.settings.onDidReceiveGlobalSettings((ev) => apply(ev.settings));
  streamDeck.settings
    .getGlobalSettings()
    .then(async (settings) => {
      apply(settings);
      if (Object.keys(current.lamps).length === 0) {
        logger.info("No lamps known: finding the lamps connected");
        await addLamps(findLamps());
      }
    })
    .catch((error: unknown) => {
      logger.error("Reading the global settings failed", error);
    });
}

/**
 * Adds the lamps found that the plugin doesn't know to the ones it knows (#194), and saves them. The plugin is the only
 * one that writes them, so a page can't overwrite a change made here, nor this one a page's: the global settings are
 * written whole, from the latest ones Stream Deck sent. Saves nothing when every lamp found is known already.
 */
export async function addLamps(found: readonly FoundLamp[]): Promise<void> {
  const added = found.filter(({ id }) => current.lamps[id] === undefined);
  if (added.length === 0) {
    return;
  }
  const lamps: Record<string, KnownLamp> = { ...current.lamps };
  for (const { id, model, serialEnd } of added) {
    lamps[id] = { model, serialEnd };
  }
  logger.info(`Lamps added: ${added.map(({ label }) => label).join(", ")}`);
  await saveLamps(lamps);
}

/**
 * Names a lamp the plugin knows (#146), or takes its name away when `name` is blank. The name is trimmed, and cut to
 * {@link MAX_LAMP_NAME_LENGTH} characters. Saves nothing for a lamp it doesn't know, or a name it already has.
 */
export async function renameLamp(id: string, name: string): Promise<void> {
  const lamp = current.lamps[id];
  if (lamp === undefined) {
    logger.warn(`Rename: lamp ${id} isn't one of the plugin's lamps`);
    return;
  }
  const trimmed = name.trim().slice(0, MAX_LAMP_NAME_LENGTH);
  if ((lamp.name ?? "") === trimmed) {
    return;
  }
  const { name: _old, ...unnamed } = lamp;
  // The name field sends every key typed, so a line for each would bury the others.
  logger.debug(trimmed === "" ? `Lamp ${labelOf(lamp)}'s name taken away` : `Lamp ${labelOf(lamp)} named "${trimmed}"`);
  await saveLamps({ ...current.lamps, [id]: trimmed === "" ? unnamed : { ...unnamed, name: trimmed } });
}

/**
 * Forgets a lamp (#194): the plugin no longer acts on it, and its name is gone, until a find adds it again. The keys keep
 * what they saved for it. Saves nothing for a lamp it doesn't know.
 */
export async function forgetLamp(id: string): Promise<void> {
  const lamp = current.lamps[id];
  if (lamp === undefined) {
    logger.warn(`Forget: lamp ${id} isn't one of the plugin's lamps`);
    return;
  }
  const lamps = Object.fromEntries(Object.entries(current.lamps).filter(([other]) => other !== id));
  logger.info(`Lamp forgotten: ${labelOf(lamp)}`);
  await saveLamps(lamps);
}

/** A lamp as the pages show it when it has no name, such as "Beam - 7K98". */
function labelOf(lamp: KnownLamp): string {
  return `${lamp.model} - ${lamp.serialEnd}`;
}

/**
 * Saves the lamps the plugin knows, in the global settings as Stream Deck last sent them, and takes them at once, so an
 * operation that follows acts on them, and another change starts from them. They're taken even when saving them fails,
 * which is logged, until the plugin restarts.
 */
async function saveLamps(lamps: Readonly<Record<string, KnownLamp>>): Promise<void> {
  const settings = { ...sent, lamps };
  apply(settings);
  try {
    await streamDeck.settings.setGlobalSettings(settings);
  } catch (error) {
    logger.error("Saving the lamps failed", error);
  }
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

/** Whether a key takes in lamps added later (#147): the plugin's setting, or the opposite for a key that chose otherwise. */
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

/** The name given to a lamp in the plugin settings (#146), or undefined for a lamp with none, or one it doesn't know. */
export function lampName(lampId: string): string | undefined {
  return current.lamps[lampId]?.name;
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
