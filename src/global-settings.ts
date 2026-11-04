import streamDeck from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import {
  type CheckedLamps,
  globalSettings as globalSettingsSchema,
  type KnownLamp,
  LAMP_SCREEN_CELLS,
  type LampScreenCell,
  type LampScreenItem,
  type LampScreenItemOptions,
  lampScreenItemOptions,
  MAX_LAMP_NAME_LENGTH,
  type GlobalSettings as ParsedGlobalSettings,
  parseSettings,
  type TextStyleName,
} from "./actions/settings";
import { Lamp } from "./lamp";
import type { LampIdentity } from "./lamp-identity";
import { findLamps, type LampSelection, type Stepping, useLamps } from "./litra-manager";
import { logger as pluginLogger } from "./logging";

/** A text's look on the lamp screens: its color, and its font's size and weight (#153). */
export type TextStyle = { color: string; font: { size: number; weight: number } };

/** The lamp screens' text styles, by name (#153). */
export type TextStyles = Record<TextStyleName, TextStyle>;

/** The font weights the settings offer, as a layout's text takes them. */
export const FONT_WEIGHTS = { normal: 400, bold: 700 };

/** What a cell of the lamp screens shows, and how (#177). */
export type LampScreenCellContent = {
  [Item in LampScreenItem]: { item: Item; options: LampScreenItemOptions[Item] };
}[LampScreenItem];

const logger = pluginLogger.createScope("Global settings");

/**
 * The plugin's global settings, which every key and dial shares, and Stream Deck keeps (#144), with a single instance
 * (#198). It reads them as Stream Deck sends them, against their schema, and holds the lamps the plugin knows as
 * `Lamp`s, by id (#194). It's their only writer: a page asks the plugin to find the lamps, and to rename or forget one,
 * and every other setting is a page's to write. Stream Deck takes the global settings whole on every save, so it saves
 * the lamps into the settings as Stream Deck last sent them, which keeps what a page saved.
 */
export class GlobalSettings {
  // The global settings as Stream Deck last sent them, which a save of the lamps writes back.
  private sent: JsonObject = {};
  // As read against their schema, their defaults until the first read, and the lamp screens' cells read from them, once
  // per read, so an option that isn't valid is warned about once.
  private parsed: ParsedGlobalSettings = parseSettings({}, globalSettingsSchema, logger);
  private cells: Record<LampScreenCell, LampScreenCellContent> = readCells(this.parsed);
  private readonly knownLamps = new Map<string, Lamp>();
  private readonly listeners: Array<() => void | Promise<void>> = [];

  /** Global settings that save through `save`, which sends them to Stream Deck whole. */
  constructor(private readonly save: (settings: JsonObject) => Promise<void>) {}

  /**
   * Takes the global settings as Stream Deck sent them, and calls the listeners. A lamp still among them keeps its
   * `Lamp`, and what it remembers, with the name they give it. One no longer among them, forgotten, drops it, and one
   * new among them gets a new one.
   */
  read(settings: JsonObject): void {
    this.sent = settings;
    this.parsed = parseSettings(settings, globalSettingsSchema, logger);
    this.cells = readCells(this.parsed);
    for (const id of [...this.knownLamps.keys()]) {
      if (this.parsed.lamps[id] === undefined) {
        this.knownLamps.delete(id);
      }
    }
    for (const [id, saved] of Object.entries(this.parsed.lamps)) {
      const lamp = this.knownLamps.get(id);
      if (lamp === undefined) {
        this.knownLamps.set(id, new Lamp({ id, ...saved }));
      } else if (lamp.name !== saved.name) {
        lamp.rename(saved.name);
      }
    }
    for (const listener of this.listeners) {
      Promise.resolve()
        .then(listener)
        .catch((error: unknown) => {
          logger.error("Global settings listener failed", error);
        });
    }
  }

  /**
   * Registers a listener called whenever the global settings are read, so that what the Deck shows from them can follow
   * a settings page's changes, such as the lamp screens' cells (#177).
   */
  onChanged(listener: () => void | Promise<void>): void {
    this.listeners.push(listener);
  }

  /** The global settings as last read, or their defaults until the first read. */
  get current(): ParsedGlobalSettings {
    return this.parsed;
  }

  /** The lamps the plugin knows, by id, the only ones it acts on (#194). */
  get lamps(): ReadonlyMap<string, Lamp> {
    return this.knownLamps;
  }

  /**
   * Adds the lamps found that the plugin doesn't know to the ones it knows (#194), and saves them. Saves nothing when
   * every lamp found is known already.
   */
  async addLamps(found: readonly LampIdentity[]): Promise<void> {
    const added = found.filter(({ id }) => !this.knownLamps.has(id));
    if (added.length === 0) {
      return;
    }
    const lamps = added.map(({ id, model, serialEnd }) => new Lamp({ id, model, serialEnd }));
    for (const lamp of lamps) {
      this.knownLamps.set(lamp.id, lamp);
    }
    logger.info(`Lamps added: ${lamps.map(({ label }) => label).join(", ")}`);
    await this.saveLamps();
  }

  /**
   * Names a lamp the plugin knows (#146), or takes its name away when `name` is blank. The name is trimmed, and cut to
   * {@link MAX_LAMP_NAME_LENGTH} characters. Saves nothing for a lamp it doesn't know, or a name it already has.
   */
  async renameLamp(id: string, name: string): Promise<void> {
    const lamp = this.knownLamps.get(id);
    if (lamp === undefined) {
      logger.warn(`Rename: lamp ${id} isn't one of the plugin's lamps`);
      return;
    }
    const trimmed = name.trim().slice(0, MAX_LAMP_NAME_LENGTH);
    if ((lamp.name ?? "") === trimmed) {
      return;
    }
    // The name field sends every key typed, so a line for each would bury the others.
    logger.debug(trimmed === "" ? `Lamp ${lamp.label}'s name taken away` : `Lamp ${lamp.label} named "${trimmed}"`);
    lamp.rename(trimmed === "" ? undefined : trimmed);
    await this.saveLamps();
  }

  /**
   * Forgets a lamp (#194): the plugin no longer acts on it, and its name is gone, until a find adds it again. The keys
   * keep what they saved for it. Saves nothing for a lamp it doesn't know.
   */
  async forgetLamp(id: string): Promise<void> {
    const lamp = this.knownLamps.get(id);
    if (lamp === undefined) {
      logger.warn(`Forget: lamp ${id} isn't one of the plugin's lamps`);
      return;
    }
    this.knownLamps.delete(id);
    logger.info(`Lamp forgotten: ${lamp.label}`);
    await this.saveLamps();
  }

  /**
   * Whether a dial blinks each lamp as its lamp screen shows it (#144): the plugin's setting, or the opposite for a
   * dial that chose otherwise on its own page.
   */
  blinksOnLampScreen(dialId: string): boolean {
    return this.parsed.blinkOnLampScreen !== this.parsed.blinkOnLampScreenExceptions.includes(dialId);
  }

  /**
   * Whether a key takes in lamps added later (#147): the plugin's setting, or the opposite for a key that chose
   * otherwise.
   */
  addsNewLamps(keyId: string): boolean {
    return this.parsed.addNewLamps !== this.parsed.addNewLampsExceptions.includes(keyId);
  }

  /**
   * The lamps an action key acts on (#147), from the lamps its page checked and left out: every lamp for a key saved
   * before it could pick them, every lamp but the left out ones for a key that adds new lamps, or the checked ones.
   */
  actionKeyLamps(keyId: string, saved: { lamps: CheckedLamps; leftOutLamps: readonly string[] }): LampSelection {
    if (saved.lamps === "all") {
      return "all";
    }
    return this.addsNewLamps(keyId) ? { except: saved.leftOutLamps } : saved.lamps;
  }

  /** How long a blink that identifies a lamp keeps it switched, in ms (#171). */
  get identifyBlinkMs(): number {
    return this.parsed.identifyBlinkMs;
  }

  /** What each cell of the lamp screens shows, and how (#177). */
  get lampScreenCells(): Record<LampScreenCell, LampScreenCellContent> {
    return this.cells;
  }

  /**
   * The lamp screens' text styles (#153): Primary, for every text by default, Secondary, for the power's "OFF" by
   * default, Accent and Alert.
   */
  get textStyles(): TextStyles {
    const style = (color: string, weight: keyof typeof FONT_WEIGHTS, size: number): TextStyle => ({
      color,
      font: { size, weight: FONT_WEIGHTS[weight] },
    });
    const settings = this.parsed;
    return {
      primary: style(settings.lampScreenPrimaryColor, settings.lampScreenPrimaryWeight, settings.lampScreenPrimarySize),
      secondary: style(
        settings.lampScreenSecondaryColor,
        settings.lampScreenSecondaryWeight,
        settings.lampScreenSecondarySize,
      ),
      accent: style(settings.lampScreenAccentColor, settings.lampScreenAccentWeight, settings.lampScreenAccentSize),
      alert: style(settings.lampScreenAlertColor, settings.lampScreenAlertWeight, settings.lampScreenAlertSize),
    };
  }

  /** How a turn on a Brightness dial's main screen, or a Brightness step key's press, steps the lamps (#145). */
  get brightnessStepping(): Stepping {
    return this.parsed.keepBrightnessDifference ? "each" : "together";
  }

  /** How a turn on a Temperature dial's main screen, or a Temperature step key's press, steps the lamps (#145). */
  get temperatureStepping(): Stepping {
    return this.parsed.keepTemperatureDifference ? "each" : "together";
  }

  /** The lamps the plugin knows, as the global settings save them: by id, with what's kept of each. */
  private savedLamps(): Record<string, KnownLamp> {
    return Object.fromEntries(
      [...this.knownLamps.values()].map(({ id, model, serialEnd, name }) => [
        id,
        name === undefined ? { model, serialEnd } : { model, serialEnd, name },
      ]),
    );
  }

  /**
   * Saves the lamps the plugin knows, as they were just changed, in the global settings as Stream Deck last sent them,
   * and reads them back, so the settings as read, and the listeners, follow at once. The change stands even when saving
   * fails, which is logged, until the plugin restarts.
   */
  private async saveLamps(): Promise<void> {
    const settings = { ...this.sent, lamps: this.savedLamps() };
    this.read(settings);
    try {
      await this.save(settings);
    } catch (error) {
      logger.error("Saving the lamps failed", error);
    }
  }
}

/**
 * Reads each cell's item, and its options for that item against their schema, which take their defaults when they're
 * missing, and with a warning that names the cell when they aren't valid.
 */
function readCells(settings: ParsedGlobalSettings): Record<LampScreenCell, LampScreenCellContent> {
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

/** The plugin's global settings, the single instance, which saves them to Stream Deck. */
export const globalSettings = new GlobalSettings((settings) => streamDeck.settings.setGlobalSettings(settings));

/**
 * Follows the plugin's global settings, which the settings pages save (#144): hands litra-manager the lamps the plugin
 * knows, reads the settings once Stream Deck is connected, and again whenever a page changes them. They're kept rather
 * than asked for on every tap, turn or press, so none of them waits on Stream Deck. When the plugin knows no lamps yet,
 * it finds the connected ones first, so a new user starts with every lamp (#194).
 */
export function followGlobalSettings(): void {
  useLamps(globalSettings.lamps);
  streamDeck.settings.onDidReceiveGlobalSettings((ev) => globalSettings.read(ev.settings));
  streamDeck.settings
    .getGlobalSettings()
    .then(async (settings) => {
      globalSettings.read(settings);
      if (globalSettings.lamps.size === 0) {
        logger.info("No lamps known: finding the lamps connected");
        await globalSettings.addLamps(findLamps());
      }
    })
    .catch((error: unknown) => {
      logger.error("Reading the global settings failed", error);
    });
}
