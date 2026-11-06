import { describe, expect, it, vi } from "vitest";

import type { LampHandle, LampRange } from "./device";
import { BRIGHTNESS_CAP_REVERSAL_WINDOW_MS, Lamp } from "./lamp";
import { logger } from "./test-support/fake-logging";

vi.mock("./logging", () => import("./test-support/fake-logging"));

const SERIAL = "2541AB017K98";
const PATH = "path-1";
const OTHER_PATH = "path-2";

/** A lamp the plugin knows, of a model, and reached as an operation reaches it, with its whole serial number. */
function reachedLamp(model = "Beam"): Lamp {
  const lamp = new Lamp({ id: Lamp.idOf(SERIAL), model, serialEnd: "7K98" });
  lamp.reachedAs(SERIAL);
  return lamp;
}

describe("a lamp's identity", () => {
  it("is what the global settings keep: its id, model and the end of its serial number", () => {
    const lamp = new Lamp({ id: Lamp.idOf(SERIAL), model: "Beam", serialEnd: "7K98" });

    expect([lamp.id, lamp.model, lamp.serialEnd]).toEqual([Lamp.idOf(SERIAL), "Beam", "7K98"]);
  });

  it("has no name until it's given one, and takes a new one, or loses it (#146)", () => {
    const lamp = new Lamp({ id: Lamp.idOf(SERIAL), model: "Beam", serialEnd: "7K98" });

    expect(lamp.name).toBeUndefined();

    lamp.name = "Key light";

    expect(lamp.name).toBe("Key light");

    lamp.name = undefined;

    expect(lamp.name).toBeUndefined();
  });

  it("has an id that is the first 16 hex characters of its serial number's SHA-256, which tells lamps apart", () => {
    // printf '%s' 2325FE01ABCD | shasum -a 256
    expect(Lamp.idOf("2325FE01ABCD")).toBe("912c77c6cebad870");
    expect(Lamp.idOf("2541AB017K98")).not.toBe(Lamp.idOf("2541AB027K99"));
  });

  it("names itself by its model and the end of its serial number, for the logs and for the pages", () => {
    const lamp = new Lamp({ id: Lamp.idOf(SERIAL), model: "Beam LX", serialEnd: "7K98" });

    expect([lamp.logLabel, lamp.label]).toEqual(["Beam LX …7K98", "Beam LX - 7K98"]);
  });

  it("names a lamp found that has no Lamp yet the same way", () => {
    const found = { model: "Beam LX", serialEnd: "7K98" };

    expect([Lamp.logLabelOf(found), Lamp.labelOf(found)]).toEqual(["Beam LX …7K98", "Beam LX - 7K98"]);
  });

  it("learns its whole serial number once an operation reaches it", () => {
    const lamp = new Lamp({ id: Lamp.idOf(SERIAL), model: "Beam", serialEnd: "7K98" });

    expect(lamp.serialNumber).toBeUndefined();

    lamp.reachedAs(SERIAL);

    expect(lamp.serialNumber).toBe(SERIAL);
  });

  it("refuses a serial number that isn't its own, without the whole serial number in the error", () => {
    const lamp = new Lamp({ id: Lamp.idOf(SERIAL), model: "Beam", serialEnd: "7K98" });

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
  ["brightness", "brightnessAsked", 110],
  ["temperature", "temperatureAsked", 6700],
] as const)("what a lamp kept apart was last asked for, on its %s (#145)", (_value, asked, pastTheEnd) => {
  it("is nothing until a step asks it of the lamp", () => {
    expect(reachedLamp()[asked]).toBeUndefined();
  });

  it("is what the step asked, even past an end of the lamp's range, whatever the lamp is at", () => {
    const lamp = reachedLamp();

    lamp[asked] = pastTheEnd;

    expect(lamp[asked]).toBe(pastTheEnd);
  });

  it("is forgotten once another change sets the lamp", () => {
    const lamp = reachedLamp();
    lamp[asked] = pastTheEnd;

    lamp[asked] = undefined;

    expect(lamp[asked]).toBeUndefined();
  });
});

describe("what a lamp kept apart was last asked for (#145)", () => {
  it("is kept apart for its brightness and its temperature", () => {
    const lamp = reachedLamp();

    lamp.brightnessAsked = 110;

    expect(lamp.temperatureAsked).toBeUndefined();
  });
});

//* A lamp's state (#198)

const RANGE: LampRange = {
  minLumen: 30,
  maxLumen: 400,
  allowedKelvin: Array.from({ length: 39 }, (_, step) => 2700 + step * 100),
};

/**
 * A lamp opened for an operation, as a `Lamp` acts on it: it keeps its power, brightness and temperature, stops at its
 * cap, if it has one, turns on at another setting when told to, as a Beam LX does (#100), and fails as many of its next
 * reads as it's told to. It records what it's written.
 */
class FakeHandle implements LampHandle {
  readonly serialNumber = SERIAL;
  readonly range = RANGE;
  readonly written: string[] = [];
  path = PATH;
  on = true;
  lumen = 215;
  kelvin = 4000;
  cap: number | undefined;
  turnsOnAt: { lumen: number; kelvin: number } | undefined;
  failingReads = 0;

  /** Whether the lamp is on. */
  isOn(): boolean {
    this.read();
    return this.on;
  }

  /** Turns the lamp on or off, at the setting it turns on at, if it has one. */
  switchPower(on: boolean): void {
    this.written.push(`power ${on ? "on" : "off"}`);
    this.on = on;
    if (on && this.turnsOnAt !== undefined) {
      ({ lumen: this.lumen, kelvin: this.kelvin } = this.turnsOnAt);
    }
  }

  /** The lamp's brightness, in lumens. */
  readBrightness(): number {
    this.read();
    return this.lumen;
  }

  /** Sets the lamp's brightness, which stops at its cap. */
  writeBrightness(lumen: number): void {
    this.written.push(`${lumen} lm`);
    this.lumen = this.cap === undefined ? lumen : Math.min(lumen, this.cap);
  }

  /** The lamp's temperature, in kelvin. */
  readTemperature(): number {
    this.read();
    return this.kelvin;
  }

  /** Sets the lamp's temperature. */
  writeTemperature(kelvin: number): void {
    this.written.push(`${kelvin} K`);
    this.kelvin = kelvin;
  }

  /** A read, which fails while the lamp has reads left to fail. */
  private read(): void {
    if (this.failingReads > 0) {
      this.failingReads -= 1;
      throw new Error("Cannot read from hid device");
    }
  }
}

/** A lamp the plugin knows, reached through a handle, as an operation reaches it before it changes it. */
function reached(handle = new FakeHandle()): { lamp: Lamp; handle: FakeHandle } {
  const lamp = new Lamp({ id: Lamp.idOf(SERIAL), model: "Beam", serialEnd: "7K98" });
  lamp.reach("test", handle);
  vi.clearAllMocks();
  return { lamp, handle };
}

/** The messages logged at a level. */
function logged(level: "info" | "warn" | "debug"): unknown[] {
  return logger[level].mock.calls.map(([message]: unknown[]) => message);
}

describe("a lamp reached by an operation (#198)", () => {
  it("is read the first time, and holds its state, its range, and that it's connected", () => {
    const lamp = new Lamp({ id: Lamp.idOf(SERIAL), model: "Beam", serialEnd: "7K98" });

    expect([lamp.state, lamp.isConnected]).toEqual([undefined, false]);

    lamp.reach("set brightness", new FakeHandle());

    expect([lamp.state, lamp.range, lamp.isConnected, lamp.serialNumber]).toEqual([
      { on: true, lumen: 215, kelvin: 4000 },
      RANGE,
      true,
      SERIAL,
    ]);
    expect(logged("info")).toEqual([
      "set brightness: Beam …7K98 read, since it was first reached: on at 215 lm (50%) and 4000 K",
    ]);
  });

  it("isn't read again at the same path, so it keeps what the plugin set, whatever the lamp is at", () => {
    const { lamp, handle } = reached();
    handle.lumen = 400;

    lamp.reach("set brightness", handle);

    expect(lamp.state).toEqual({ on: true, lumen: 215, kelvin: 4000 });
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("is read again at another path, since it was plugged in again, which forgets its cap", () => {
    const { lamp, handle } = reached();
    lamp.brightnessReached("set brightness", PATH, 400, 324, 0);
    vi.clearAllMocks();
    Object.assign(handle, { path: OTHER_PATH, on: false, lumen: 324 });

    lamp.reach("set brightness", handle);

    expect(lamp.state).toEqual({ on: false, lumen: 324, kelvin: 4000 });
    expect(lamp.withinBrightnessCap("set brightness", OTHER_PATH, 400)).toBe(400);
    expect(logged("info")).toEqual([
      "set brightness: Beam …7K98 was plugged in again, its cap of 324 lm is forgotten",
      "set brightness: Beam …7K98 read, since it was plugged in again: off at 324 lm (79%) and 4000 K",
    ]);
  });

  it("is no longer connected once an operation doesn't find it, and is again once one does", () => {
    const { lamp, handle } = reached();

    lamp.setFound(false);

    expect(lamp.isConnected).toBe(false);

    lamp.reach("toggle", handle);

    expect(lamp.isConnected).toBe(true);
  });

  it("can't be changed before it's reached, since the plugin holds nothing of it yet", () => {
    const lamp = new Lamp({ id: Lamp.idOf(SERIAL), model: "Beam", serialEnd: "7K98" });

    expect(() => lamp.setPower("turn on", new FakeHandle(), true)).toThrow(
      "Beam …7K98 was changed before it was reached",
    );
  });
});

describe("a lamp's power (#198)", () => {
  it("is switched, and holds what the lamp reports, which is logged at debug", () => {
    const { lamp, handle } = reached();

    lamp.setPower("turn off", handle, false);

    expect([handle.on, lamp.state?.on]).toEqual([false, false]);
    expect(logged("info")).toEqual(["turn off: Beam …7K98 turned off"]);
    expect(logged("debug")).toEqual(["turn off: Beam …7K98 is off"]);
  });

  it("turns a lamp on as it was, with nothing else written, when it turns on at the setting it holds", () => {
    const { lamp, handle } = reached(Object.assign(new FakeHandle(), { on: false }));

    lamp.setPower("turn on", handle, true);

    expect(handle.written).toEqual(["power on"]);
    expect(lamp.state).toEqual({ on: true, lumen: 215, kelvin: 4000 });
  });

  it("puts back the setting it holds when the lamp turns on at another, as a Beam LX can (#100)", () => {
    const { lamp, handle } = reached(Object.assign(new FakeHandle(), { on: false }));
    handle.turnsOnAt = { lumen: 400, kelvin: 6500 };

    lamp.setPower("turn on", handle, true);

    expect(handle.written).toEqual(["power on", "4000 K", "215 lm"]);
    expect([handle.lumen, handle.kelvin]).toEqual([215, 4000]);
    expect(lamp.state).toEqual({ on: true, lumen: 215, kelvin: 4000 });
    expect(logged("info")).toEqual([
      "turn on: Beam …7K98 turned on at 400 lm and 6500 K, put back to 215 lm and 4000 K",
      "turn on: Beam …7K98 turned on",
    ]);
  });
});

describe("a lamp's brightness (#198)", () => {
  it("is sent, then read back once the lamp has settled, and the lamp holds what it reached", () => {
    const { lamp, handle } = reached();

    const sent = lamp.sendBrightness("set brightness", handle, 400);
    const reachedLumen = lamp.readBackBrightness("set brightness", handle, sent, 0);

    expect([sent, reachedLumen, lamp.state?.lumen]).toEqual([400, 400, 400]);
    expect(logged("info")).toEqual(["set brightness: Beam …7K98 sent 400 lm, reached 400 lm (100%)"]);
  });

  it("holds the brightness a capped lamp reached, not the one asked for, and caps what's sent next (#55)", () => {
    const { lamp, handle } = reached(Object.assign(new FakeHandle(), { cap: 244 }));

    lamp.readBackBrightness("set brightness", handle, lamp.sendBrightness("set brightness", handle, 400), 0);

    expect(lamp.state?.lumen).toBe(244);
    expect(lamp.sendBrightness("adjust brightness", handle, 400)).toBe(244);
  });
});

describe("a lamp's temperature (#198)", () => {
  it("is set, and holds what the lamp reports", () => {
    const { lamp, handle } = reached();

    expect(lamp.setTemperature("set temperature", handle, 6500)).toBe(6500);
    expect(lamp.state?.kelvin).toBe(6500);
    expect(logged("info")).toEqual(["set temperature: Beam …7K98 set to 6500 K"]);
    expect(logged("debug")).toEqual(["set temperature: Beam …7K98 at 6500 K"]);
  });
});

describe("a lamp that doesn't report what it set (#198)", () => {
  it("is asked again, and holds what it reports then, with a warning", () => {
    const { lamp, handle } = reached();
    handle.failingReads = 1;

    lamp.setTemperature("set temperature", handle, 6500);

    expect(lamp.state?.kelvin).toBe(6500);
    expect(logged("warn")).toEqual([
      "set temperature: Beam …7K98 didn't report its temperature, so it's read again: " +
        "Error: Cannot read from hid device",
    ]);
  });

  it("holds the value asked for when it doesn't report it again either, with a warning each time", () => {
    const { lamp, handle } = reached(Object.assign(new FakeHandle(), { cap: 244 }));
    handle.failingReads = 2;

    lamp.readBackBrightness("set brightness", handle, lamp.sendBrightness("set brightness", handle, 400), 0);

    expect([handle.lumen, lamp.state?.lumen]).toEqual([244, 400]);
    expect(logged("warn")).toEqual([
      expect.stringContaining("didn't report its brightness, so it's read again"),
      "set brightness: Beam …7K98 didn't report its brightness again, so it holds the brightness asked for, 400: " +
        "Error: Cannot read from hid device",
    ]);
  });
});

describe("a lamp's blink (#48)", () => {
  it("switches the lamp the other way from the power it holds, and back after the blink, as it was", async () => {
    vi.useFakeTimers();
    try {
      const { lamp, handle } = reached();

      const blink = lamp.blink("identify", handle, 400);

      expect(handle.on).toBe(false);

      await vi.advanceTimersByTimeAsync(400);
      await blink;

      expect([handle.on, lamp.state?.on]).toEqual([true, true]);
      expect(logged("info")).toEqual(["identify: Beam …7K98 blinked"]);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("a lamp's brightness as a percentage", () => {
  it("sits in the lamp's range once it's reached, and is 0 before", () => {
    const lamp = new Lamp({ id: Lamp.idOf(SERIAL), model: "Beam", serialEnd: "7K98" });

    expect(lamp.brightnessPercentage(215)).toBe(0);

    lamp.reach("test", new FakeHandle());

    expect(lamp.brightnessPercentage(215)).toBe(50);
  });
});

describe("a lamp's range (#198)", () => {
  it("gives the lumens for a percentage of its brightness, as litra sends them", () => {
    const { lamp } = reached();

    expect([lamp.lumenAt(0), lamp.lumenAt(50), lamp.lumenAt(100)]).toEqual([30, 215, 400]);
  });

  it("gives the lowest and highest temperatures it allows, and snaps to the nearest one", () => {
    const { lamp } = reached();

    expect([lamp.lowestKelvin, lamp.highestKelvin, lamp.snapKelvin(4230), lamp.snapKelvin(9000)]).toEqual([
      2700, 6500, 4200, 6500,
    ]);
  });

  it("places a temperature between the lowest and highest it allows", () => {
    const { lamp } = reached();

    expect([
      lamp.temperaturePercentage(2700),
      lamp.temperaturePercentage(4600),
      lamp.temperaturePercentage(6500),
    ]).toEqual([0, 50, 100]);
  });

  it("isn't known before the lamp is reached", () => {
    const lamp = new Lamp({ id: Lamp.idOf(SERIAL), model: "Beam", serialEnd: "7K98" });

    expect(() => lamp.lumenAt(50)).toThrow("Beam …7K98 has no range before it's reached");
    expect(() => lamp.lowestKelvin).toThrow("Beam …7K98 has no range before it's reached");
  });

  it("can't place a temperature for a lamp that allows none", () => {
    const { lamp } = reached(Object.assign(new FakeHandle(), { range: { ...RANGE, allowedKelvin: [] } }));

    expect(() => lamp.temperaturePercentage(4000)).toThrow("Beam …7K98 reports no allowed temperatures");
  });
});

/** A lamp reached through a handle of this range. */
function inRange(range: Partial<LampRange>): Lamp {
  return reached(Object.assign(new FakeHandle(), { range: { ...RANGE, ...range } })).lamp;
}

describe("a lamp's brightness as a percentage of its range", () => {
  it("maps the ends of the range to 0 and 100", () => {
    const lamp = inRange({});

    expect([lamp.brightnessPercentage(30), lamp.brightnessPercentage(400)]).toEqual([0, 100]);
  });

  it("maps a value inside the range proportionally, rounded to an integer", () => {
    const lamp = inRange({});

    // 18.92 and 19.46.
    expect([lamp.brightnessPercentage(215), lamp.brightnessPercentage(100), lamp.brightnessPercentage(102)]).toEqual([
      50, 19, 19,
    ]);
  });

  it("clamps values outside the range", () => {
    const lamp = inRange({});

    expect([lamp.brightnessPercentage(20), lamp.brightnessPercentage(500)]).toEqual([0, 100]);
  });

  it("is 0 when the range is empty or inverted", () => {
    expect(inRange({ minLumen: 50, maxLumen: 50 }).brightnessPercentage(50)).toBe(0);
    expect(inRange({ minLumen: 100, maxLumen: 20 }).brightnessPercentage(50)).toBe(0);
  });
});

describe("the lumens a lamp is sent for a percentage", () => {
  it("are the ends of the range at 0 and 100", () => {
    const lamp = inRange({});

    expect([lamp.lumenAt(0), lamp.lumenAt(100)]).toEqual([30, 400]);
  });

  it("are rounded up, like litra's", () => {
    const lamp = inRange({});

    expect([lamp.lumenAt(70), lamp.lumenAt(33)]).toEqual([289, 153]);
  });

  it("follow the lamp's own range", () => {
    // A Litra Glow's range.
    expect(inRange({ minLumen: 20, maxLumen: 250 }).lumenAt(50)).toBe(135);
  });
});

describe("the temperature a lamp allows nearest to another", () => {
  it("is the temperature itself when it's allowed", () => {
    expect(inRange({}).snapKelvin(3000)).toBe(3000);
  });

  it("is the nearest allowed one", () => {
    const lamp = inRange({});

    expect([lamp.snapKelvin(3140), lamp.snapKelvin(3160)]).toEqual([3100, 3200]);
  });

  it("is the one the lamp lists first on a tie", () => {
    expect(inRange({}).snapKelvin(3150)).toBe(3100);
    expect(inRange({ allowedKelvin: [...RANGE.allowedKelvin].reverse() }).snapKelvin(3150)).toBe(3200);
  });

  it("is an end of the range for a temperature outside it", () => {
    const lamp = inRange({});

    expect([lamp.snapKelvin(1000), lamp.snapKelvin(9000)]).toEqual([2700, 6500]);
  });

  it("is found in a list that isn't sorted", () => {
    expect(inRange({ allowedKelvin: [6500, 2700, 4000] }).snapKelvin(2800)).toBe(2700);
  });

  it("can't be found for a lamp that allows none", () => {
    expect(() => inRange({ allowedKelvin: [] }).snapKelvin(3123)).toThrow("Beam …7K98 reports no allowed temperatures");
  });
});
