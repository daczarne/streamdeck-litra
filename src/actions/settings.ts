import type { JsonObject, JsonValue } from "@elgato/utils";
import type { Logger } from "@elgato/utils/logging";

import type { LampSelection } from "../litra-manager";

/**
 * A setting an action reads: the value it takes when the setting is missing or invalid, what a valid value is, and how
 * to read one. `parse` returns undefined for a value that isn't valid.
 */
type Setting<T> = {
  default: T;
  expected: string;
  parse: (value: JsonValue) => T | undefined;
};

type Schema = Record<string, Setting<unknown>>;

type Parsed<S extends Schema> = { [Name in keyof S]: S[Name] extends Setting<infer T> ? T : never };

/**
 * A number, or text that is one, since a select on a settings page saves its value as text. Anything else is refused,
 * where `Number()` would turn an empty text, `null` or `false` into 0, and `true` into 1.
 */
function toNumber(value: JsonValue): number | undefined {
  const number =
    typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  return Number.isFinite(number) ? number : undefined;
}

/** A setting that takes any number from `min` to `max`, both included. */
function numberFrom(min: number, max: number, fallback: number): Setting<number> {
  return {
    default: fallback,
    expected: `a number from ${min} to ${max}`,
    parse: (value) => {
      const number = toNumber(value);
      return number !== undefined && number >= min && number <= max ? number : undefined;
    },
  };
}

/** A setting that takes a whole number from `min` to `max`, both included. */
function wholeNumberFrom(min: number, max: number, fallback: number): Setting<number> {
  const inRange = numberFrom(min, max, fallback);
  return {
    ...inRange,
    expected: `a whole number from ${min} to ${max}`,
    parse: (value) => {
      const number = inRange.parse(value);
      return number !== undefined && Number.isInteger(number) ? number : undefined;
    },
  };
}

/** A setting that takes one of a list of numbers, given as a number or as text. */
function oneOfNumbers(allowed: readonly number[], fallback: number): Setting<number> {
  return {
    default: fallback,
    expected: `one of ${allowed.join(", ")}`,
    parse: (value) => {
      const number = toNumber(value);
      return number !== undefined && allowed.includes(number) ? number : undefined;
    },
  };
}

/** A setting that takes one of a list of texts, as written. */
function oneOf<T extends string>(allowed: readonly T[], fallback: T): Setting<T> {
  return {
    default: fallback,
    expected: `one of ${allowed.join(", ")}`,
    parse: (value) => allowed.find((option) => option === value),
  };
}

/** A setting that is on or off, as a checkbox saves it. */
function flag(fallback: boolean): Setting<boolean> {
  return {
    default: fallback,
    expected: "true or false",
    parse: (value) => (typeof value === "boolean" ? value : undefined),
  };
}

/** A setting that takes a color as `#rrggbb`, as a color picker saves it, kept in lower case. */
function hexColor(fallback: string): Setting<string> {
  return {
    default: fallback,
    expected: "a color as #rrggbb",
    parse: (value) => (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : undefined),
  };
}

/** A setting that takes text by key, such as the lamps' names by lamp id. Entries that aren't text are left out. */
function textByKey(): Setting<Readonly<Record<string, string>>> {
  return {
    default: {},
    expected: "text by key",
    parse: (value) =>
      typeof value === "object" && value !== null && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
          )
        : undefined,
  };
}

/** A setting that takes any object, which whoever uses it reads further against a schema of its own. */
function anObject(): Setting<JsonObject> {
  return {
    default: {},
    expected: "an object",
    parse: (value) => (typeof value === "object" && value !== null && !Array.isArray(value) ? value : undefined),
  };
}

/** A setting that takes a list of text, such as the ids of some dials. */
function textList(): Setting<readonly string[]> {
  return {
    default: [],
    expected: "a list of text",
    parse: (value) =>
      Array.isArray(value) && value.every((item): item is string => typeof item === "string") ? value : undefined,
  };
}

/**
 * The lamps a key acts on (#20): `"all"`, which takes in lamps plugged in later, or the lamps checked on the settings
 * page, saved with their ids and the labels the page showed them with, so a lamp that isn't connected keeps its name
 * there. The plugin only takes the ids.
 */
function lampSelection(): Setting<LampSelection> {
  return {
    default: "all",
    expected: '"all", or a list of lamps with their ids',
    parse: (value) => {
      if (value === "all") {
        return "all";
      }
      if (!Array.isArray(value)) {
        return undefined;
      }
      const ids: string[] = [];
      for (const lamp of value) {
        if (typeof lamp !== "object" || lamp === null || Array.isArray(lamp) || typeof lamp.id !== "string") {
          return undefined;
        }
        ids.push(lamp.id);
      }
      return ids;
    },
  };
}

/** The lamps a key acts on, as its log line says it. */
export function describeLamps(lamps: LampSelection): string {
  return lamps === "all" ? "every lamp" : lamps.length === 1 ? "1 lamp" : `${lamps.length} lamps`;
}

//* The actions' settings

// The valid values are the ones each settings page offers, and the defaults match the pages' own, which are what a new
// key or dial saves. The browser tests check both against the pages.

// Every key picks its lamps, while a dial's main screen acts on every lamp, and its lamp screens on the lamp on screen.
const lamps = lampSelection();

export const powerSettings = {
  mode: oneOf(["toggle", "on", "off"], "toggle"),
  lamps,
};

export const brightnessSettings = {
  presetPercentage: numberFrom(0, 100, 0),
  stepPercentage: wholeNumberFrom(1, 25, 10),
  lamps,
};

export const temperatureSettings = {
  presetKelvin: numberFrom(2700, 6500, 2700),
  stepKelvin: oneOfNumbers([100, 200, 300, 500], 300),
  lamps,
};

// The step keys step as the dials do, by the same steps.
export const brightnessStepSettings = {
  stepPercentage: brightnessSettings.stepPercentage,
  lamps,
};

export const temperatureStepSettings = {
  stepKelvin: temperatureSettings.stepKelvin,
  lamps,
};

// A scene sets both presets, taken as the Brightness and Temperature keys take theirs.
export const sceneSettings = {
  presetPercentage: brightnessSettings.presetPercentage,
  presetKelvin: temperatureSettings.presetKelvin,
  lamps,
};

// The lamps alone, for an action that reads them apart from its other settings.
export const lampSettings = { lamps };

// What a lamp screen can show in each of its cells (#177): the lamp's model and the end of its serial number, its place
// among the lamps, its temperature, whether it's on, its brightness in % or in lumens, or nothing.
export const LAMP_SCREEN_ITEMS = [
  "identification",
  "counter",
  "temperature",
  "power",
  "brightnessPercentage",
  "brightnessLumen",
  "none",
] as const;

export type LampScreenItem = (typeof LAMP_SCREEN_ITEMS)[number];

// The cells of a lamp screen, three rows of two, as the strip gives each dial room for (#177).
export const LAMP_SCREEN_CELLS = [
  "topLeft",
  "topRight",
  "middleLeft",
  "middleRight",
  "bottomLeft",
  "bottomRight",
] as const;

export type LampScreenCell = (typeof LAMP_SCREEN_CELLS)[number];

// How each item shows in a cell, chosen for each cell apart, and kept for each item, so a cell switched to another item
// and back gets its options back (#177). The defaults draw what the lamp screens showed before the options, but for the
// power, which reads "ON" and "OFF", both in the normal weight. An identification is made of two parts, joined by " - "
// when both have text: a lamp with no name shows "Model - ID" for its name, and a lamp that reports no serial number,
// such as the Beam LX (#170), has no ID. Trimmed, it keeps to half a row. A counter counts every lamp, or the lamps of
// the shown one's model. A measure's icon, when it shows one, always sits on the cell's outer edge. Every item but the
// power takes one of the lamp screens' text styles, Primary by default, and each of the power's states takes one, or a
// color and a weight of its own, at the Primary style's size (#153).
const IDENTIFICATION_PARTS = ["model", "id", "name", "empty"] as const;
const WEIGHTS = ["normal", "bold"] as const;
const COUNTS = ["count", "countOf", "countByModel"] as const;
const COUNTER_FORMATS = ["of", "slash", "dash", "space"] as const;
const TEXT_STYLES = ["primary", "accent"] as const;
const FONT_STYLES = [...TEXT_STYLES, "custom"] as const;
const ON_LABELS = ["On", "ON", "●", "I"] as const;
const OFF_LABELS = ["Off", "OFF", "○", "O"] as const;

export const lampScreenItemOptions = {
  identification: {
    first: oneOf(IDENTIFICATION_PARTS, "model"),
    second: oneOf(IDENTIFICATION_PARTS, "id"),
    trim: flag(false),
    style: oneOf(TEXT_STYLES, "primary"),
  },
  counter: {
    count: oneOf(COUNTS, "countOf"),
    format: oneOf(COUNTER_FORMATS, "of"),
    style: oneOf(TEXT_STYLES, "primary"),
  },
  temperature: { icon: flag(true), unit: flag(true), style: oneOf(TEXT_STYLES, "primary") },
  power: {
    onLabel: oneOf(ON_LABELS, "ON"),
    onStyle: oneOf(FONT_STYLES, "primary"),
    onColor: hexColor("#ffffff"),
    onWeight: oneOf(WEIGHTS, "normal"),
    offLabel: oneOf(OFF_LABELS, "OFF"),
    offStyle: oneOf(FONT_STYLES, "accent"),
    offColor: hexColor("#202020"),
    offWeight: oneOf(WEIGHTS, "normal"),
  },
  brightnessPercentage: { icon: flag(true), unit: flag(true), style: oneOf(TEXT_STYLES, "primary") },
  brightnessLumen: { icon: flag(false), unit: flag(true), style: oneOf(TEXT_STYLES, "primary") },
  none: {},
} satisfies Record<LampScreenItem, Schema>;

export type LampScreenItemOptions = {
  [Item in LampScreenItem]: Parsed<(typeof lampScreenItemOptions)[Item]>;
};

// The plugin's own settings, which every dial and key shares rather than each saving its own. With the blink on, tapping
// a dial through its lamp screens blinks each lamp as its screen appears (#144). It's off by default, since every lamp
// then blinks in turn, which shows on camera. A dial can choose otherwise on its own page: the dials that do are kept
// here too, by id, rather than in their own settings, so the plugin settings can tell when the dials differ, and reset
// every dial at once, even the ones not on screen. With a difference kept, a turn on a dial's main screen and a step key's
// press step each lamp from its own value, instead of bringing the lamps back in sync (#145). Brightness and
// temperature each have their own, so lamps can keep their brightness apart while their colors stay matched. Both are
// off by default: the lamps are managed together (see docs/contributing.md). Every blink that identifies a lamp, from
// the plugin settings or on a lamp screen, lasts as long as the plugin settings say, in ms (#171). A lamp fades out
// when switched off, in about 750 ms at any brightness, so a blink much shorter than the fade brings the lamp back
// before it has dimmed enough to notice among lamps that stay on, while one as long as the whole fade makes each tap
// through the lamp screens wait longer than it needs to. The default suits dim lamps, and a bright lamp among others
// needs a longer one. The longest is twice the fade. What each cell of the lamp screens shows is the same on every dial,
// and the defaults are what the lamp screens showed before it could be chosen (#177). How each cell shows its item is
// kept by cell and by item, read against lampScreenItemOptions. The lamps' names, which the plugin settings save by lamp
// id (#146), are read too, for the cells that show them. The lamp screens' text takes two styles, the same on every dial:
// by default, Primary for every text, and Accent for the power's "OFF" (#153). Each has a color, a weight and a size,
// which a layout's text takes, and nothing else: no font family. The sizes stop at 16 px, below which text is hard to
// read on the strip (#8), and at 22 px, which still fits the 26 px rows of layouts/lamp.json. The defaults draw what the
// lamp screens showed before: white and dark grey, in the normal weight, at 18 px.
export const globalSettings = {
  blinkOnLampScreen: flag(false),
  blinkOnLampScreenExceptions: textList(),
  keepBrightnessDifference: flag(false),
  keepTemperatureDifference: flag(false),
  identifyBlinkMs: wholeNumberFrom(300, 1500, 400),
  lampScreenTopLeft: oneOf(LAMP_SCREEN_ITEMS, "identification"),
  lampScreenTopRight: oneOf(LAMP_SCREEN_ITEMS, "counter"),
  lampScreenMiddleLeft: oneOf(LAMP_SCREEN_ITEMS, "temperature"),
  lampScreenMiddleRight: oneOf(LAMP_SCREEN_ITEMS, "power"),
  lampScreenBottomLeft: oneOf(LAMP_SCREEN_ITEMS, "brightnessPercentage"),
  lampScreenBottomRight: oneOf(LAMP_SCREEN_ITEMS, "brightnessLumen"),
  lampScreenOptions: anObject(),
  lampScreenPrimaryColor: hexColor("#ffffff"),
  lampScreenPrimaryWeight: oneOf(WEIGHTS, "normal"),
  lampScreenPrimarySize: wholeNumberFrom(16, 22, 18),
  lampScreenAccentColor: hexColor("#202020"),
  lampScreenAccentWeight: oneOf(WEIGHTS, "normal"),
  lampScreenAccentSize: wholeNumberFrom(16, 22, 18),
  lampNames: textByKey(),
};

export type GlobalSettings = Parsed<typeof globalSettings>;

/**
 * Reads an action's settings, or the plugin's global ones, as Stream Deck sent them, against their schema (#22). A setting that is missing
 * takes its default. One that isn't valid, from an older or edited profile, takes its default too, with a warning.
 */
export function parseSettings<S extends Schema>(
  settings: JsonObject,
  schema: S,
  logger: Pick<Logger, "warn">,
): Parsed<S> {
  const parsed: Record<string, unknown> = {};
  for (const [name, setting] of Object.entries(schema)) {
    const value = settings[name];
    const valid = value === undefined ? undefined : setting.parse(value);
    if (value !== undefined && valid === undefined) {
      logger.warn(`Setting ${name} is ${JSON.stringify(value)}, not ${setting.expected}: using ${setting.default}`);
    }
    parsed[name] = valid ?? setting.default;
  }
  return parsed as Parsed<S>;
}
