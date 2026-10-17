import type { JsonObject, JsonValue } from "@elgato/utils";
import type { Logger } from "@elgato/utils/logging";

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

//* The actions' settings

// The valid values are the ones each settings page offers, and the defaults match the pages' own, which are what a new
// key or dial saves. The browser tests check both against the pages.

export const powerSettings = {
  mode: oneOf(["toggle", "on", "off"], "toggle"),
};

export const brightnessSettings = {
  presetPercentage: numberFrom(0, 100, 0),
  stepPercentage: wholeNumberFrom(1, 25, 10),
};

export const temperatureSettings = {
  presetKelvin: numberFrom(2700, 6500, 2700),
  stepKelvin: oneOfNumbers([100, 200, 300, 500], 300),
};

// The step keys step as the dials do, by the same steps.
export const brightnessStepSettings = {
  stepPercentage: brightnessSettings.stepPercentage,
};

export const temperatureStepSettings = {
  stepKelvin: temperatureSettings.stepKelvin,
};

// A scene sets both presets, taken as the Brightness and Temperature keys take theirs.
export const sceneSettings = {
  presetPercentage: brightnessSettings.presetPercentage,
  presetKelvin: temperatureSettings.presetKelvin,
};

/**
 * Reads an action's settings, as Stream Deck sent them, against the action's schema (#22). A setting that is missing
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
