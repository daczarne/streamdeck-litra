import { describe, expect, it, vi } from "vitest";
import { reachedLamp } from "../test-support/reached-lamps";
import type { LampState } from "./lamp";
import { planBrightnessStep, planTemperatureStep, stepOnGrid } from "./steps";

//* Fakes

// The real logger writes to a logs/ folder, and a Lamp logs what it reads.
vi.mock("../logging", () => import("../test-support/fake-logging"));

const MIN_KELVIN = 2700;
const MAX_KELVIN = 6500;

/** A Beam's lumens at a percentage of its range, 30 to 400 lm. */
function lumenAt(percentage: number): number {
  return Math.round(30 + (370 * percentage) / 100);
}

/** A Beam the plugin holds at a state, by an id that orders it. */
function beam(id: string, state: Partial<LampState>) {
  return reachedLamp(id.padStart(16, "0"), { on: true, lumen: lumenAt(50), kelvin: 4000, ...state });
}

/** Lamps as a brightness step starts from them: each by its id, at the lumens it holds, sent within its cap. */
function brightnessFrom(...lamps: ReturnType<typeof beam>[]) {
  return lamps.map((lamp) => ({
    key: lamp.id.slice(-1),
    lamp,
    lumen: lamp.state.lumen,
    reach: (percentage: number) => lamp.lumenToSendNow(percentage),
  }));
}

/** Lamps as a temperature step starts from them: each by its id, at the temperature it holds. */
function temperatureFrom(...lamps: ReturnType<typeof beam>[]) {
  return lamps.map((lamp) => ({ key: lamp.id.slice(-1), lamp, kelvin: lamp.state.kelvin }));
}

//* Tests

describe("stepOnGrid", () => {
  it("moves a value on the grid by whole steps, either way", () => {
    expect(stepOnGrid(50, 2, 5, 0, 100)).toBe(60);
    expect(stepOnGrid(50, -3, 5, 0, 100)).toBe(35);
  });

  it("counts the grid from the minimum", () => {
    expect(stepOnGrid(MIN_KELVIN, 1, 500, MIN_KELVIN, MAX_KELVIN)).toBe(3200);
    expect(stepOnGrid(3200, 2, 500, MIN_KELVIN, MAX_KELVIN)).toBe(4200);
  });

  it("clamps to the range", () => {
    expect(stepOnGrid(90, 5, 10, 0, 100)).toBe(100);
    expect(stepOnGrid(10, -5, 10, 0, 100)).toBe(0);
  });

  it("takes a value off the grid to the next grid value in the direction of the turn", () => {
    // The 79% cap of a Beam on a Stream Deck + XL's hub, with a 5% step.
    expect(stepOnGrid(79, 1, 5, 0, 100)).toBe(80);
    expect(stepOnGrid(79, -1, 5, 0, 100)).toBe(75);
    expect(stepOnGrid(77, -1, 5, 0, 100)).toBe(75);
    expect(stepOnGrid(79, -2, 5, 0, 100)).toBe(70);
  });

  it("goes down through the values it went up through, when the step doesn't divide the range (#14, #16)", () => {
    let value = 0;
    const up = [value];
    while (value < 100) {
      value = stepOnGrid(value, 1, 7, 0, 100);
      up.push(value);
    }
    const down = [value];
    while (value > 0) {
      value = stepOnGrid(value, -1, 7, 0, 100);
      down.push(value);
    }

    expect(up).toEqual([0, 7, 14, 21, 28, 35, 42, 49, 56, 63, 70, 77, 84, 91, 98, 100]);
    expect(down).toEqual(up.toReversed());
  });

  it("goes down from the clamped top to the grid, when the step doesn't divide the range", () => {
    expect(stepOnGrid(MAX_KELVIN, -1, 500, MIN_KELVIN, MAX_KELVIN)).toBe(6200);
    expect(stepOnGrid(MAX_KELVIN, -1, 300, MIN_KELVIN, MAX_KELVIN)).toBe(6300);
  });
});

describe("planBrightnessStep", () => {
  it("sends every lamp together to one value, stepped from the brightest lamp's along the grid", () => {
    const lamps = brightnessFrom(beam("1", { lumen: lumenAt(63) }), beam("2", { lumen: lumenAt(79) }));

    expect(planBrightnessStep(lamps, "together", 1, 10)).toEqual([
      { key: "1", percentage: 80 },
      { key: "2", percentage: 80 },
    ]);
    expect(planBrightnessStep(lamps, "together", -1, 10)).toEqual([
      { key: "1", percentage: 70 },
      { key: "2", percentage: 70 },
    ]);
  });

  it("steps each lamp from its own value once they're kept apart (#145), with what it asked", () => {
    const lamps = brightnessFrom(beam("1", { lumen: lumenAt(30) }), beam("2", { lumen: lumenAt(60) }));

    expect(planBrightnessStep(lamps, "each", 1, 10)).toEqual([
      { key: "1", percentage: 40, asked: 40 },
      { key: "2", percentage: 70, asked: 70 },
    ]);
  });

  it("plans nothing for no lamp", () => {
    expect(planBrightnessStep([], "together", 1, 10)).toEqual([]);
    expect(planBrightnessStep([], "each", 1, 10)).toEqual([]);
  });
});

describe("planTemperatureStep", () => {
  it("sets every lamp together to one value, stepped from the highest temperature along the grid", () => {
    const lamps = temperatureFrom(beam("1", { kelvin: 3400 }), beam("2", { kelvin: 4000 }));

    expect(planTemperatureStep(lamps, "together", 1, 300)).toEqual([
      { key: "1", kelvin: 4200 },
      { key: "2", kelvin: 4200 },
    ]);
  });

  it("steps each lamp from its own temperature once they're kept apart (#145), with what it asked", () => {
    const lamps = temperatureFrom(beam("1", { kelvin: 3300 }), beam("2", { kelvin: 4200 }));

    expect(planTemperatureStep(lamps, "each", -1, 300)).toEqual([
      { key: "1", kelvin: 3000, asked: 3000 },
      { key: "2", kelvin: 3900, asked: 3900 },
    ]);
  });

  it("stays at the highest temperature the lamps allow", () => {
    const lamps = temperatureFrom(beam("1", { kelvin: MAX_KELVIN }));

    expect(planTemperatureStep(lamps, "together", 1, 300)).toEqual([{ key: "1", kelvin: MAX_KELVIN }]);
  });

  it("plans nothing for no lamp", () => {
    expect(planTemperatureStep([], "together", 1, 300)).toEqual([]);
  });
});
