import { describe, expect, it, vi } from "vitest";

import type { LampHandle, LampRange } from "./device";
import { Lamp, type LampState } from "./lamp";
import { lampId } from "./lamp-identity";
import { allLampsOn, brightnessPercentages, lampStatuses, temperatureShown } from "./lamps-shown";

//* Fakes

// The real logger writes to a logs/ folder, and a Lamp logs what it reads.
vi.mock("./logging", () => import("./test-support/fake-logging"));

/** A Beam's range: 30 to 400 lm, and 2700 K to 6500 K in steps of 100 K. */
const RANGE: LampRange = {
  minLumen: 30,
  maxLumen: 400,
  allowedKelvin: Array.from({ length: 39 }, (_, step) => 2700 + step * 100),
};

/** A Beam at 50% of its range and 4000 K, unless a test says otherwise. */
const HALF: LampState = { on: true, lumen: 215, kelvin: 4000 };

/** A lamp opened for an operation, which only answers what it's at, as reaching a lamp reads it. */
function handleAt(serialNumber: string, state: LampState): LampHandle {
  return {
    serialNumber,
    path: `path-${serialNumber}`,
    range: RANGE,
    isOn: () => state.on,
    switchPower: () => {},
    readBrightness: () => state.lumen,
    writeBrightness: () => {},
    readTemperature: () => state.kelvin,
    writeTemperature: () => {},
  };
}

/** A Beam the plugin knows, by the end of its serial number, as the last operation found it at a state. */
function held(serialEnd: string, state: Partial<LampState> = {}): Lamp {
  const serialNumber = `2541AB01${serialEnd}`;
  const lamp = new Lamp({ id: lampId(serialNumber), model: "Beam", serialEnd });
  lamp.reach("test", handleAt(serialNumber, { ...HALF, ...state }));
  return lamp;
}

/** A lamp the plugin knows that no operation has reached since it started, so it holds no state. */
function neverReached(serialEnd: string): Lamp {
  return new Lamp({ id: lampId(`2541AB01${serialEnd}`), model: "Beam", serialEnd });
}

//* Tests

describe("what the Deck shows of the lamps (#198)", () => {
  it("shows the lamps a selection takes in, in the order of the ends of their serial numbers", () => {
    const [later, earlier, other] = [held("BBBB", { lumen: 400 }), held("AAAA", { lumen: 30 }), held("CCCC")];

    expect(brightnessPercentages([later, other, earlier], "all")).toEqual([0, 100, 50]);
    expect(brightnessPercentages([later, other, earlier], [later.id, earlier.id])).toEqual([0, 100]);
    expect(brightnessPercentages([later, other, earlier], { except: [earlier.id] })).toEqual([100, 50]);
  });

  it("leaves out a lamp the last operation didn't find, and one never reached, which has no state", () => {
    const [found, unplugged] = [held("AAAA"), held("BBBB")];
    unplugged.setFound(false);

    expect(brightnessPercentages([found, unplugged, neverReached("CCCC")], "all")).toEqual([50]);
  });

  describe("whether every lamp is on, as a Power key shows it", () => {
    it("is on when every lamp the selection takes in is on", () => {
      expect(allLampsOn([held("AAAA"), held("BBBB")], "all")).toBe(true);
    });

    it("is off when a lamp is off, even one the selection takes in alone", () => {
      const [on, off] = [held("AAAA"), held("BBBB", { on: false })];

      expect(allLampsOn([on, off], "all")).toBe(false);
      expect(allLampsOn([on, off], [on.id])).toBe(true);
    });

    it("is off when the selection takes in no lamp shown", () => {
      expect(allLampsOn([], "all")).toBe(false);
      expect(allLampsOn([held("AAAA")], [])).toBe(false);
    });
  });

  describe("the temperature, as a dial or a step key shows it", () => {
    it("is the first lamp's, in kelvin and as its place in the lamp's range", () => {
      const lamps = [held("BBBB", { kelvin: 5000 }), held("AAAA", { kelvin: 3500 })];

      expect(temperatureShown(lamps, "all")).toEqual({ kelvin: 3500, percentage: 21 });
    });

    it("is none without a lamp", () => {
      expect(temperatureShown([], "all")).toBeUndefined();
    });
  });

  it("shows every lamp on the lamp screens, with its name, power, brightness and temperature", () => {
    const lamp = held("AAAA", { on: false, lumen: 400, kelvin: 6500 });

    expect(lampStatuses([lamp, neverReached("BBBB")])).toEqual([
      {
        id: lamp.id,
        serialNumber: "2541AB01AAAA",
        model: "Beam",
        label: "Beam - AAAA",
        on: false,
        brightnessLumen: 400,
        brightnessPercentage: 100,
        temperatureKelvin: 6500,
      },
    ]);
  });
});
