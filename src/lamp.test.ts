import { describe, expect, it, vi } from "vitest";

import { BRIGHTNESS_CAP_REVERSAL_WINDOW_MS, Lamp } from "./lamp";
import { lampId } from "./lamp-identity";
import { logger } from "./test-support/fake-logging";

vi.mock("./logging", () => import("./test-support/fake-logging"));

const SERIAL = "2541AB017K98";
const PATH = "path-1";
const OTHER_PATH = "path-2";

/** A lamp the plugin knows, of a model, and reached as an operation reaches it, with its whole serial number. */
function reachedLamp(model = "Beam"): Lamp {
  const lamp = new Lamp({ id: lampId(SERIAL), model, serialEnd: "7K98" });
  lamp.reachedAs(SERIAL);
  return lamp;
}

describe("a lamp's identity", () => {
  it("is what the global settings keep: its id, model, the end of its serial number, and its name", () => {
    const lamp = new Lamp({ id: lampId(SERIAL), model: "Beam", serialEnd: "7K98", name: "Key light" });

    expect([lamp.id, lamp.model, lamp.serialEnd, lamp.name]).toEqual([lampId(SERIAL), "Beam", "7K98", "Key light"]);
  });

  it("has no name unless it was given one, and takes a new one, or loses it (#146)", () => {
    const lamp = new Lamp({ id: lampId(SERIAL), model: "Beam", serialEnd: "7K98" });

    expect(lamp.name).toBeUndefined();

    lamp.rename("Key light");

    expect(lamp.name).toBe("Key light");

    lamp.rename(undefined);

    expect(lamp.name).toBeUndefined();
  });

  it("names itself by its model and the end of its serial number, for the logs and for the pages", () => {
    const lamp = new Lamp({ id: lampId(SERIAL), model: "Beam LX", serialEnd: "7K98" });

    expect([lamp.logLabel, lamp.label]).toEqual(["Beam LX …7K98", "Beam LX - 7K98"]);
  });

  it("learns its whole serial number once an operation reaches it", () => {
    const lamp = new Lamp({ id: lampId(SERIAL), model: "Beam", serialEnd: "7K98" });

    expect(lamp.serialNumber).toBeUndefined();

    lamp.reachedAs(SERIAL);

    expect(lamp.serialNumber).toBe(SERIAL);
  });

  it("refuses a serial number that isn't its own, without the whole serial number in the error", () => {
    const lamp = new Lamp({ id: lampId(SERIAL), model: "Beam", serialEnd: "7K98" });

    expect(() => lamp.reachedAs("2541AB027K99")).toThrow(/^Serial number …7K99 isn't lamp [0-9a-f]{16}'s$/);
    expect(lamp.serialNumber).toBeUndefined();
  });
});

describe("a lamp's cap (#55)", () => {
  it("has none until the lamp reaches less than it was sent, and sends what's asked for until then", () => {
    const lamp = reachedLamp();

    expect(lamp.brightnessCapAt("set brightness", PATH)).toBeUndefined();
    expect(lamp.withinBrightnessCap("set brightness", PATH, 400)).toBe(400);
  });

  it("is learned when the lamp reaches less than it was sent, and caps what's sent from then on", () => {
    const lamp = reachedLamp();

    lamp.brightnessReached("set brightness", PATH, 400, 324, 0);

    expect(lamp.brightnessCapAt("set brightness", PATH)).toBe(324);
    expect(lamp.withinBrightnessCap("set brightness", PATH, 400)).toBe(324);
    expect(lamp.withinBrightnessCap("set brightness", PATH, 200)).toBe(200);
  });

  it("is learned again when it drops, and kept when the lamp reaches all it was sent", () => {
    const lamp = reachedLamp();
    lamp.brightnessReached("set brightness", PATH, 400, 324, 0);

    lamp.brightnessReached("set brightness", PATH, 324, 320, 0);

    expect(lamp.brightnessCapAt("set brightness", PATH)).toBe(320);

    lamp.brightnessReached("set brightness", PATH, 320, 320, 0);

    expect(lamp.brightnessCapAt("set brightness", PATH)).toBe(320);
  });

  it("is forgotten once the lamp is reached at another path, since it was plugged in again", () => {
    const lamp = reachedLamp();
    lamp.brightnessReached("set brightness", PATH, 400, 324, 0);

    expect(lamp.withinBrightnessCap("set brightness", OTHER_PATH, 400)).toBe(400);
    expect(lamp.brightnessCapAt("set brightness", PATH)).toBeUndefined();
  });

  it("logs the cap learned and the cap forgotten at info, with the operation, the lamp and the lumens", () => {
    const lamp = reachedLamp();

    lamp.brightnessReached("set brightness", PATH, 400, 324, 0);
    lamp.brightnessCapAt("adjust brightness", OTHER_PATH);

    expect(logger.info.mock.calls.map(([message]: unknown[]) => message)).toEqual([
      expect.stringMatching(/^set brightness: Beam …7K98 .*324 lm/),
      expect.stringMatching(/^adjust brightness: Beam …7K98 .*324 lm/),
    ]);
  });

  it("is logged without the whole serial number", () => {
    const lamp = reachedLamp();

    lamp.brightnessReached("set brightness", PATH, 400, 324, 0);
    lamp.brightnessCapAt("set brightness", OTHER_PATH);

    for (const [message] of logger.info.mock.calls) {
      expect(message).not.toContain(SERIAL);
    }
  });

  it("logs nothing when the lamp reaches all it was sent", () => {
    reachedLamp().brightnessReached("set brightness", PATH, 400, 400, 0);

    expect(logger.info).not.toHaveBeenCalled();
  });
});

describe("when a capped lamp may go back to its cap (#55)", () => {
  it("is never for a lamp that was never capped", () => {
    const lamp = reachedLamp();
    lamp.brightnessReached("set brightness", PATH, 400, 400, 1000);

    expect(lamp.brightnessCapReversalEndsAt).toBe(0);
  });

  it("ends a window after the write that went above the cap, and the latest window counts", () => {
    const lamp = reachedLamp();

    lamp.brightnessReached("set brightness", PATH, 400, 324, 5000);

    expect(lamp.brightnessCapReversalEndsAt).toBe(5000 + BRIGHTNESS_CAP_REVERSAL_WINDOW_MS);

    lamp.brightnessReached("set brightness", PATH, 324, 320, 6000);

    expect(lamp.brightnessCapReversalEndsAt).toBe(6000 + BRIGHTNESS_CAP_REVERSAL_WINDOW_MS);

    lamp.brightnessReached("set brightness", PATH, 400, 320, 5500);

    expect(lamp.brightnessCapReversalEndsAt).toBe(6000 + BRIGHTNESS_CAP_REVERSAL_WINDOW_MS);
  });
});

describe.each([
  ["brightness", "brightnessPositionAt", "leaveBrightness"],
  ["temperature", "temperaturePositionAt", "leaveTemperature"],
] as const)("a lamp kept apart, on its %s (#145)", (_value, positionAt, leave) => {
  it("steps from the fallback until it's left at a position", () => {
    const lamp = reachedLamp();

    expect(lamp[positionAt](300, 70)).toBe(70);
  });

  it("steps from the position it was left at, while it's still at the value it was left at", () => {
    const lamp = reachedLamp();

    lamp[leave](120, 300);

    expect(lamp[positionAt](300, 70)).toBe(120);
  });

  it("steps from the fallback once it's at another value, set by anything else", () => {
    const lamp = reachedLamp();
    lamp[leave](120, 300);

    expect(lamp[positionAt](250, 70)).toBe(70);
  });

  it("forgets its position when it's left without one", () => {
    const lamp = reachedLamp();
    lamp[leave](120, 300);

    lamp[leave](undefined, 300);

    expect(lamp[positionAt](300, 70)).toBe(70);
  });
});

describe("a lamp kept apart (#145)", () => {
  it("keeps its brightness's and its temperature's positions apart", () => {
    const lamp = reachedLamp();

    lamp.leaveBrightness(120, 300);

    expect(lamp.temperaturePositionAt(300, 70)).toBe(70);
  });
});
