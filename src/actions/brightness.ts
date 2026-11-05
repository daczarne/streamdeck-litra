import { action } from "@elgato/streamdeck";
import { globalSettings } from "../global-settings";
import { adjustLampsBrightness, readLampsBrightness, setLampsBrightness } from "../litra-manager";
import { logger as pluginLogger } from "../logging";
import { type LampScreens, lampScreens as sharedLampScreens } from "./lamp-screens";
import { type Measure, MeasureAction, type Preset } from "./measure";
import { brightnessSettings, parseSettings } from "./settings";

// Where fewer lamps reach, the bar fades from white towards this grey, never as far as the bar's own background, and
// light enough to read on the strip.
const FAINTEST_BAR_GREY = 0x80;

/**
 * The fill of the brightness bar for the lamps' levels, in %: white up to the dimmest lamp's level, then fainter for
 * each level fewer lamps reach, so the bar shows that only some lamps go that far (#59). A gradient's stops span the
 * bar's filled part, which ends at the brightest lamp's level, so each level is placed as a share of that one. Two
 * stops 0.001 apart draw a sharp edge.
 */
export function barFill(levels: number[]): string {
  const brightest = Math.max(0, ...levels);
  const distinct = [...new Set(levels)].filter((level) => level > 0).sort((a, b) => a - b);
  if (distinct.length === 0 || (distinct.length === 1 && levels.every((level) => level === brightest))) {
    return "white";
  }
  const offset = (share: number): number => Number(Math.min(1, share).toFixed(3));
  const stops: string[] = [];
  let start = 0;
  for (const level of distinct) {
    const reaching = levels.filter((other) => other >= level).length / levels.length;
    const grey = Math.round(FAINTEST_BAR_GREY + (0xff - FAINTEST_BAR_GREY) * reaching)
      .toString(16)
      .padStart(2, "0");
    const color = `#${grey}${grey}${grey}`;
    const end = level / brightest;
    stops.push(`${offset(start)}:${color}`, `${offset(end)}:${color}`);
    start = end + 0.001;
  }
  return stops.join(",");
}

/** What a Brightness key sets its lamps to: its preset, in % of their range. */
const PRESET: Preset = {
  read: (settings, logger) => {
    const { presetPercentage, lamps, leftOutLamps } = parseSettings(settings, brightnessSettings, logger);
    return { preset: presetPercentage, lamps, leftOutLamps };
  },
  unit: "%",
  set: setLampsBrightness,
};

/**
 * What a Brightness dial steps, and shows on its main screen, in the slots of the $B1 layout: the brightest lamp's %
 * as text, and again as the bar under it, banded by how many lamps reach each part of it, or a dash with no lamp.
 */
const BRIGHTNESS: Measure = {
  name: "Brightness",
  readStep: (settings, logger) => parseSettings(settings, brightnessSettings, logger).stepPercentage,
  unit: "%",
  readStepping: () => globalSettings.brightnessStepping,
  adjust: adjustLampsBrightness,
  readMainScreen: async () => {
    const levels = await readLampsBrightness("all");
    const brightest = levels.length === 0 ? undefined : Math.max(...levels);
    return {
      title: "Brightness",
      value: brightest === undefined ? "—" : `${Math.round(brightest)}%`,
      indicator: { value: brightest ?? 0, bar_fill_c: barFill(levels) },
    };
  },
};

/**
 * The Brightness action. On a key, it sets its lamps to the key's preset. On a dial, it steps the brightness as the
 * dial turns, toggles the lamps when pushed, and shows each lamp on its own screen when the strip is tapped (#20).
 */
@action({ UUID: "com.daczarne.litra.brightness" })
export class BrightnessAction extends MeasureAction {
  /** Takes the lamp screens that every dial shares, or the tests' own. */
  constructor(lampScreens: LampScreens = sharedLampScreens) {
    super(pluginLogger.createScope("Brightness"), PRESET, BRIGHTNESS, lampScreens);
  }
}
