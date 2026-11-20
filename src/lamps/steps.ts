import type { Lamp } from "./lamp";

// Where a step of the brightness or the temperature takes each lamp, worked out from what the plugin holds of the
// lamps, without reaching them: the lamp manager sends the lamps there, and a step key's title shows where its next
// press takes them before it's pressed, so both work it out the same way.

/**
 * How a step moves several lamps (#145): `"together"` sends every lamp to one value, stepped from the brightest lamp's
 * brightness or the highest temperature, which brings lamps set apart back in sync, and `"each"` steps every lamp from
 * its own value, which keeps them apart. A lamp at an end of its range, or at its cap, stays there while the others
 * keep going, and comes back with them, as {@link stepApart} plans it.
 */
export type Stepping = "together" | "each";

/**
 * Moves a value by a number of steps along the grid min, min + step, min + 2 × step, …, clamped to min–max, so a dial
 * stops on the same values going up as going down (#14, #16). From a value off the grid, such as a lamp's cap or a
 * clamped end, the first step goes to the grid's next value in the direction of the turn. `ticks` is never 0, and
 * `step` is positive, as the dials and the step keys send them.
 */
export function stepOnGrid(value: number, ticks: number, step: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, stepAlongGrid(value, ticks, step, min)));
}

/**
 * Moves a value by a number of steps along the grid origin, origin + step, origin + 2 × step, …, which goes on past
 * either end. From a value off the grid, the first step goes to the grid's next value in the direction of the turn.
 */
function stepAlongGrid(value: number, ticks: number, step: number, origin: number): number {
  const position = (value - origin) / step;
  const index = ticks > 0 ? Math.floor(position) + ticks : Math.ceil(position) + ticks;
  return origin + index * step;
}

/** A lamp kept apart, as {@link stepApart} plans its steps. */
type ApartLamp = {
  /** What the lamp was last asked for, which can be past an end of its range or its cap, where it stopped (#145). */
  asked: number;
  /** What the lamp is at, in what it's sent. */
  value: number;
  /** What the lamp is sent for what it's asked for: the value within its range, and its cap. */
  reach: (asked: number) => number;
  /** Where the lamp's grid starts: the bottom of its range. */
  origin: number;
  /** How far the lamp's range goes from its origin. */
  span: number;
};

/**
 * Plans the steps of lamps kept apart (#145), a tick at a time. A tick moves what every lamp is asked for along its
 * grid, step after step, until one of the lamps moves, and each lamp goes as far towards it as it can. So one stopped
 * by an end of its range or its cap stays there while the others keep going, and comes back with them once they've
 * retraced the way. Steps that move no lamp cost no tick, such as the ones every lamp was asked for past a cap it
 * hadn't learned yet. A turn stops at the first tick that moves no lamp across their whole ranges, so turning on once
 * every lamp is at its end does nothing, rather than piling up steps to undo. Returns the lamps, each with what it's
 * asked for next.
 */
function stepApart<T extends ApartLamp>(lamps: readonly T[], ticks: number, step: number): T[] {
  const direction = Math.sign(ticks);
  // Enough steps to take any lamp from what it was asked for across its whole range, so a tick that moves no lamp ends.
  const bound = Math.max(...lamps.map((lamp) => Math.ceil((Math.abs(lamp.asked - lamp.origin) + lamp.span) / step)));
  let state = [...lamps];
  for (let tick = 0; tick < Math.abs(ticks); tick++) {
    let next = state;
    let moved = false;
    for (let steps = 0; !moved && steps < bound; steps++) {
      next = next.map((lamp) => {
        const asked = stepAlongGrid(lamp.asked, direction, step, lamp.origin);
        const value = lamp.reach(asked);
        moved ||= (value - lamp.value) * direction > 0;
        return { ...lamp, asked, value };
      });
    }
    if (!moved) {
      break;
    }
    state = next;
  }
  return state;
}

/**
 * A lamp a brightness step starts from: its `Lamp`, its brightness in lumens, and the lumens it's sent for a percentage
 * of its range, within its cap. `key` names it to whoever planned the step.
 */
export type BrightnessFrom<K> = {
  readonly key: K;
  readonly lamp: Lamp;
  readonly lumen: number;
  readonly reach: (percentage: number) => number;
};

/** Where a brightness step sends a lamp: a percentage of its range, and, for a lamp kept apart, what it asked (#145). */
export type BrightnessTo<K> = { readonly key: K; readonly percentage: number; readonly asked?: number | undefined };

/**
 * Where some ticks of a step take each lamp's brightness, in % of its range: together, every lamp to one value, stepped
 * from the brightest lamp's along the grid of 0 to 100%, or each from its own, as {@link stepApart} plans it (#145).
 * Plans nothing for no lamp.
 */
export function planBrightnessStep<K>(
  lamps: readonly BrightnessFrom<K>[],
  stepping: Stepping,
  ticks: number,
  step: number,
): BrightnessTo<K>[] {
  if (lamps.length === 0) {
    return [];
  }
  if (stepping === "together") {
    const levels = lamps.map(({ lamp, lumen }) => lamp.brightnessPercentage(lumen));
    const stepped = stepOnGrid(Math.max(...levels), ticks, step, 0, 100);
    return lamps.map(({ key }) => ({ key, percentage: stepped }));
  }
  const apart = lamps.map(({ key, lamp, lumen, reach }) => ({
    key,
    asked: lamp.brightnessAsked ?? lamp.brightnessPercentage(lumen),
    value: lumen,
    reach,
    origin: 0,
    span: 100,
  }));
  return stepApart(apart, ticks, step).map(({ key, asked }) => ({ key, percentage: asked, asked }));
}

/** A lamp a temperature step starts from: its `Lamp` and its temperature. `key` names it to whoever planned the step. */
export type TemperatureFrom<K> = { readonly key: K; readonly lamp: Lamp; readonly kelvin: number };

/** Where a temperature step sets a lamp: a temperature, and, for a lamp kept apart, what it asked (#145). */
export type TemperatureTo<K> = { readonly key: K; readonly kelvin: number; readonly asked?: number | undefined };

/**
 * Where some ticks of a step take each lamp's temperature, in kelvin: together, every lamp to one value, stepped from
 * the highest temperature along the grid of that lamp's range, the first such lamp on a tie, as the dials and the keys
 * show it (#229), or each from its own, as {@link stepApart} plans it (#145). Plans nothing for no lamp.
 */
export function planTemperatureStep<K>(
  lamps: readonly TemperatureFrom<K>[],
  stepping: Stepping,
  ticks: number,
  step: number,
): TemperatureTo<K>[] {
  const [first, ...others] = lamps;
  if (first === undefined) {
    return [];
  }
  if (stepping === "together") {
    const from = others.reduce((highest, lamp) => (lamp.kelvin > highest.kelvin ? lamp : highest), first);
    const stepped = stepOnGrid(from.kelvin, ticks, step, from.lamp.lowestKelvin, from.lamp.highestKelvin);
    return lamps.map(({ key }) => ({ key, kelvin: stepped }));
  }
  const apart = lamps.map(({ key, lamp, kelvin }) => ({
    key,
    asked: lamp.temperatureAsked ?? kelvin,
    value: kelvin,
    reach: (asked: number) => lamp.snapKelvin(asked),
    origin: lamp.lowestKelvin,
    span: lamp.highestKelvin - lamp.lowestKelvin,
  }));
  return stepApart(apart, ticks, step).map(({ key, asked }) => ({ key, kelvin: asked, asked }));
}
