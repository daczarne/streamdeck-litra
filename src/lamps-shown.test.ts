import { describe, expect, it, vi } from "vitest";
import { Lamp, type LampState } from "./lamp";
import { allLampsOn, brightnessPercentages, shownLamps, temperatureShown } from "./lamps-shown";
import { reachedLamp } from "./test-support/reached-lamps";

//* Fakes

// The real logger writes to a logs/ folder, and a Lamp logs what it reads.
vi.mock("./logging", () => import("./test-support/fake-logging"));

/** A Beam at 50% of its range and 4000 K, unless a test says otherwise. */
const HALF: LampState = { on: true, lumen: 215, kelvin: 4000 };

/** A Beam the plugin knows, by its id, as the last operation found it at a state. */
function held(id: string, state: Partial<LampState> = {}): Lamp {
  return reachedLamp(id, { ...HALF, ...state });
}

/** A lamp the plugin knows that no operation has reached since it started, so it holds no state. */
function neverReached(id: string): Lamp {
  return new Lamp({ id, model: "Beam" });
}

//* Tests

describe("what the Deck shows of the lamps (#198)", () => {
  it("shows the lamps a selection takes in, in the order of their ids", () => {
    const [later, earlier, other] = [
      held("00000000000b2222", { lumen: 400 }),
      held("00000000000a1111", { lumen: 30 }),
      held("00000000000c3333"),
    ];

    expect(brightnessPercentages([later, other, earlier], "all")).toEqual([0, 100, 50]);
    expect(brightnessPercentages([later, other, earlier], [later.id, earlier.id])).toEqual([0, 100]);
    expect(brightnessPercentages([later, other, earlier], { except: [earlier.id] })).toEqual([100, 50]);
  });

  it("leaves out a lamp the last operation didn't find, and one never reached, which has no state", () => {
    const [found, unplugged] = [held("00000000000a1111"), held("00000000000b2222")];
    unplugged.setFound(false);

    expect(brightnessPercentages([found, unplugged, neverReached("00000000000c3333")], "all")).toEqual([50]);
  });

  describe("whether every lamp is on, as a Power key shows it", () => {
    it("is on when every lamp the selection takes in is on", () => {
      expect(allLampsOn([held("00000000000a1111"), held("00000000000b2222")], "all")).toBe(true);
    });

    it("is off when a lamp is off, even one the selection takes in alone", () => {
      const [on, off] = [held("00000000000a1111"), held("00000000000b2222", { on: false })];

      expect(allLampsOn([on, off], "all")).toBe(false);
      expect(allLampsOn([on, off], [on.id])).toBe(true);
    });

    it("is off when the selection takes in no lamp shown", () => {
      expect(allLampsOn([], "all")).toBe(false);
      expect(allLampsOn([held("00000000000a1111")], [])).toBe(false);
    });
  });

  describe("the temperature, as a dial or a step key shows it", () => {
    it("is the first lamp's, in kelvin and as its place in the lamp's range", () => {
      const lamps = [held("00000000000b2222", { kelvin: 5000 }), held("00000000000a1111", { kelvin: 3500 })];

      expect(temperatureShown(lamps, "all")).toEqual({ kelvin: 3500, percentage: 21 });
    });

    it("is none without a lamp", () => {
      expect(temperatureShown([], "all")).toBeUndefined();
    });
  });

  it("holds each lamp shown with the state it's at, which the lamp screens draw from", () => {
    const lamp = held("00000000000a1111", { on: false, lumen: 400, kelvin: 6500 });

    expect(shownLamps([lamp, neverReached("00000000000b2222")], "all")).toEqual([
      { lamp, state: { on: false, lumen: 400, kelvin: 6500 } },
    ]);
  });
});
