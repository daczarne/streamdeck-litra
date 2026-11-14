import type { JsonObject, JsonValue } from "@elgato/utils";
import type { Logger } from "@elgato/utils/logging";

import type { LampSelection } from "../lamp-selection";

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

/** Settings as {@link parseSettings} reads them against their schema: each one valid, or its default. */
export type Parsed<S extends Schema> = { [Name in keyof S]: S[Name] extends Setting<infer T> ? T : never };

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

/**
 * A setting that takes a number from `min` to `max`, both included, on a step counted from `min`, as a number field
 * offers them (#195), given as a number or as text.
 */
function steppedFrom(min: number, max: number, step: number, fallback: number): Setting<number> {
  const inRange = numberFrom(min, max, fallback);
  return {
    ...inRange,
    expected: `a number from ${min} to ${max}, in steps of ${step}`,
    parse: (value) => {
      const number = inRange.parse(value);
      return number !== undefined && Number.isInteger((number - min) / step) ? number : undefined;
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

/**
 * What the global settings save of a lamp the plugin knows (#194), by its id: its model, such as "Beam", and the name
 * given to it in the plugin settings, if any (#146). Nothing of its serial number is saved. The plugin holds each one as
 * a `Lamp`.
 */
export type SavedLamp = { readonly model: string; readonly name?: string };

/** The longest name a lamp can be given (#146), which the plugin settings' name field also stops at. */
export const MAX_LAMP_NAME_LENGTH = 24;

/**
 * The lamps the plugin knows, by id (#194). Entries without a model, as text, are left out, so one that was edited
 * doesn't take the others with it, and so is a name that isn't text. Anything else an entry holds, such as the end of
 * the serial number lamps were once saved with, is dropped, and goes at the next save.
 */
function lampsById(): Setting<Readonly<Record<string, SavedLamp>>> {
  return {
    default: {},
    expected: "lamps by id, each with its model",
    parse: (value) =>
      typeof value === "object" && value !== null && !Array.isArray(value)
        ? Object.fromEntries(
            Object.entries(value).flatMap(([id, lamp]) =>
              typeof lamp === "object" && lamp !== null && !Array.isArray(lamp) && typeof lamp.model === "string"
                ? [
                    [
                      id,
                      {
                        model: lamp.model,
                        ...(typeof lamp.name === "string" ? { name: lamp.name } : {}),
                      },
                    ],
                  ]
                : [],
            ),
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

/** A setting that takes a list of objects, each of which whoever uses it reads further against a schema of its own. */
function objectList(): Setting<readonly JsonObject[]> {
  return {
    default: [],
    expected: "a list of objects",
    parse: (value) =>
      Array.isArray(value) &&
      value.every((item): item is JsonObject => typeof item === "object" && item !== null && !Array.isArray(item))
        ? value
        : undefined,
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

/** The lamps a key's page checked (#20): `"all"`, for a key saved before it could pick its lamps, or their ids. */
export type CheckedLamps = "all" | readonly string[];

/**
 * The ids of the lamps a key's settings page saved (#20), which the lamps the plugin knows name and label (#194), and
 * which may include lamps it no longer knows, which the plugin leaves alone.
 */
function lampList(): Setting<readonly string[]> {
  return { ...textList(), expected: "a list of lamp ids" };
}

/**
 * The lamps checked on a key's settings page (#20), or `"all"`, which acts on every lamp, for a key saved before lamps
 * could be picked, or never saved.
 */
function checkedLamps(): Setting<CheckedLamps> {
  const list = lampList();
  return {
    default: "all",
    expected: '"all", or a list of lamp ids',
    parse: (value) => (value === "all" ? "all" : list.parse(value)),
  };
}

/** The lamps a key acts on, as its log line says it. */
export function describeLamps(lamps: LampSelection): string {
  const count = (n: number): string => (n === 1 ? "1 lamp" : `${n} lamps`);
  if (lamps === "all") {
    return "every lamp";
  }
  if (lamps === "connected") {
    return "every lamp connected";
  }
  if ("except" in lamps) {
    return lamps.except.length === 0 ? "every lamp" : `every lamp but ${count(lamps.except.length)}`;
  }
  return count(lamps.length);
}

//* The actions' settings

// The valid values are the ones each settings page offers, and the defaults match the pages' own, which are what a new
// key or dial saves. The browser tests check both against the pages.

// Every key picks its lamps, while a dial's main screen acts on every lamp, and its lamp screens on the lamp on screen.
// A key also keeps the lamps its page listed and left unchecked, so a lamp added later can join a key that adds
// new lamps without the ones left out joining too (#147).
const lamps = checkedLamps();
const leftOutLamps = lampList();

export const powerSettings = {
  mode: oneOf(["toggle", "on", "off"], "toggle"),
  lamps,
  leftOutLamps,
};

export const brightnessSettings = {
  presetPercentage: numberFrom(0, 100, 0),
  stepPercentage: wholeNumberFrom(1, 25, 10),
  lamps,
  leftOutLamps,
};

export const temperatureSettings = {
  presetKelvin: numberFrom(2700, 6500, 2700),
  stepKelvin: steppedFrom(100, 500, 100, 300),
  lamps,
  leftOutLamps,
};

// The step keys step as the dials do, by the same steps.
export const brightnessStepSettings = {
  stepPercentage: brightnessSettings.stepPercentage,
  lamps,
  leftOutLamps,
};

export const temperatureStepSettings = {
  stepKelvin: temperatureSettings.stepKelvin,
  lamps,
  leftOutLamps,
};

// A scene is made of groups, each of which turns its lamps off, or on at its own brightness and temperature, taken as
// the Brightness and Temperature keys take their presets (#174). The first group is the key's own settings, as a scene
// saved before groups had them, and picks its lamps as every key does, lamps added later included. Each group
// added after it is saved with its power, its presets and the lamps checked for it, read against sceneGroupSettings,
// and a lamp it checks leaves the first group. A group turns its lamps on by default, as every scene did.
const scenePower = oneOf(["on", "off"], "on");

export const sceneSettings = {
  power: scenePower,
  presetPercentage: brightnessSettings.presetPercentage,
  presetKelvin: temperatureSettings.presetKelvin,
  lamps,
  leftOutLamps,
  addedGroups: objectList(),
};

export const sceneGroupSettings = {
  power: scenePower,
  presetPercentage: brightnessSettings.presetPercentage,
  presetKelvin: temperatureSettings.presetKelvin,
  lamps: lampList(),
};

// What a lamp screen can show in each of its cells (#177): the lamp's model and the end of its id, its place
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
const TEXT_STYLES = ["primary", "secondary", "accent", "alert"] as const;

export type TextStyleName = (typeof TEXT_STYLES)[number];
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
    offStyle: oneOf(FONT_STYLES, "secondary"),
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

// The plugin's own settings, which every dial and key shares rather than each saving its own. A key that adds new lamps
// acts on every lamp but the ones its page left unchecked, so a lamp added later joins it, and one that doesn't acts
// on the lamps checked (#147). Every key adds them by default, as every key did before, and the keys that chose
// otherwise on their own page are kept by id, as the dials that chose otherwise about the blink are. With the blink on, tapping
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
// kept by cell and by item, read against lampScreenItemOptions. The lamp screens' text takes four styles, the same on every
// dial, each named for its role rather than its look (see docs/contributing.md, #153): Primary, Secondary, Accent and
// Alert. Each has a color, a weight and a size, which a layout's text takes, and nothing else: no font family. The sizes
// stop at 16 px, below which text is hard to read on the strip (#8), and at 22 px, which still fits the 26 px rows of
// layouts/lamp.json. Only Primary and Secondary are used by default, which draws what the lamp screens showed before.
// The lamps the plugin knows are the only ones it acts on (#194), each with the name the plugin settings gave it (#146),
// which the lamp screens' cells show. Unlike the others, the plugin writes them, and no page does: a page asks it to
// find the lamps, and to rename or forget one.
export const globalSettings = {
  addNewLamps: flag(true),
  addNewLampsExceptions: textList(),
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
  lampScreenSecondaryColor: hexColor("#202020"),
  lampScreenSecondaryWeight: oneOf(WEIGHTS, "normal"),
  lampScreenSecondarySize: wholeNumberFrom(16, 22, 18),
  lampScreenAccentColor: hexColor("#4dd0e1"),
  lampScreenAccentWeight: oneOf(WEIGHTS, "normal"),
  lampScreenAccentSize: wholeNumberFrom(16, 22, 18),
  lampScreenAlertColor: hexColor("#ff6b6b"),
  lampScreenAlertWeight: oneOf(WEIGHTS, "bold"),
  lampScreenAlertSize: wholeNumberFrom(16, 22, 18),
  lamps: lampsById(),
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
