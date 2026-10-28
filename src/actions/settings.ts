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

// The plugin's own settings, which every dial and key shares rather than each saving its own. With the blink on, tapping
// a dial through its lamp screens blinks each lamp as its screen appears (#144). It's off by default, since every lamp
// then blinks in turn, which shows on camera. With a difference kept, a turn on a dial's main screen and a step key's
// press step each lamp from its own value, instead of bringing the lamps back in sync (#145). Brightness and
// temperature each have their own, so lamps can keep their brightness apart while their colors stay matched. Both are
// off by default: the lamps are managed together (see docs/contributing.md).
export const globalSettings = {
  blinkOnLampScreen: flag(false),
  keepBrightnessDifference: flag(false),
  keepTemperatureDifference: flag(false),
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
