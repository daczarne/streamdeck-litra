import type { Device } from "litra";
import { afterEach, beforeEach, describe, expect, inject, it, vi } from "vitest";

import { lampId } from "./lamp";
import type { BroadcastResult, SceneGroup } from "./litra-manager";
import { at } from "./test-support/at";
import { loadOnEmulatedLamps } from "./test-support/emulated-lamps";
import { EmulatedLitra, isIdentifying, kindOf, type LitraModel, type ReportKind } from "./test-support/emulated-litra";
import type { HidCall } from "./test-support/fake-node-hid";

//* Fakes

// The model of the lamps, a Beam or a Beam LX, by run (`vitest.config.mjs`). Both have the ranges litra gives a Beam,
// which were checked on both (#100).
const MODEL = inject("model");
const MIN_LUMEN = 30;
const MAX_LUMEN = 400;
const MIN_KELVIN = 2700;
const MAX_KELVIN = 6500;
const KELVIN_STEP = 100;
const ALLOWED_KELVIN = Array.from(
  { length: (MAX_KELVIN - MIN_KELVIN) / KELVIN_STEP + 1 },
  (_, index) => MIN_KELVIN + index * KELVIN_STEP,
);

// The id of a lamp the plugin knows that isn't plugged in.
const MISSING_LAMP = "0123456789abcdef";

// How long a blink lasts, in ms, the plugin settings' default.
const BLINK_MS = 400;

let manager: typeof import("./litra-manager");
let litra: typeof import("litra");
let hid: typeof import("./test-support/fake-node-hid");
let logger: typeof import("./test-support/fake-logging").logger;

beforeEach(async () => {
  // The emulated lamps take time to reach their cap, and the brightness changes wait for them, as on the Deck.
  vi.useFakeTimers();
  // A fresh litra-manager for every test: no learned caps, listeners or brightness changes carried over.
  ({
    loaded: { manager, litra },
    hid,
    logger,
  } = await loadOnEmulatedLamps(async () => ({
    manager: await import("./litra-manager"),
    litra: await import("litra"),
  })));
});

afterEach(() => {
  vi.useRealTimers();
});

/**
 * A lamp of the run's model, on, at its lowest brightness and at 4000 K, unless the options say otherwise. The caps the
 * tests give it are the ones Beams were measured with on a hub: a Beam LX takes its power from a supply of its own, but
 * the plugin checks what every lamp reached the same way (#100).
 */
function newLamp(options: ConstructorParameters<typeof EmulatedLitra>[1] = {}): EmulatedLitra {
  return new EmulatedLitra(MODEL, {
    on: true,
    brightnessInLumen: MIN_LUMEN,
    temperatureInKelvin: 4000,
    ...options,
  });
}

/** A Beam, whatever the run's model, as {@link newLamp} makes one, for what a Beam does unlike a Beam LX. */
function beam(options: ConstructorParameters<typeof EmulatedLitra>[1] = {}): EmulatedLitra {
  return new EmulatedLitra("Beam", { on: true, brightnessInLumen: MIN_LUMEN, temperatureInKelvin: 4000, ...options });
}

/**
 * Makes these the lamps plugged in, in the order litra finds them, and the lamps the plugin knows (#194), with
 * {@link MISSING_LAMP}, as finding them would.
 */
function connect(...lamps: EmulatedLitra[]): void {
  hid.connect(...lamps);
  manager.setKnownLamps([...lamps.map((lamp) => lampId(lamp.serialNumber)), MISSING_LAMP]);
}

/** Brightness in lumen at the given percentage of the lamps' range. */
function lumenAt(percentage: number): number {
  return MIN_LUMEN + ((MAX_LUMEN - MIN_LUMEN) * percentage) / 100;
}

/** A scene of one group, which turns every lamp on at a brightness and a temperature. */
function everyLampAt(percentage: number, kelvin: number): SceneGroup[] {
  return [{ lamps: "all", on: true, percentage, kelvin }];
}

/** Waits for an operation, letting the time it waits for pass: the lamps settling, a blink. */
async function settled<T>(operation: Promise<T>): Promise<T> {
  await vi.runAllTimersAsync();
  return operation;
}

/** Waits for the listeners, which are called once the operation has returned. */
async function announced(): Promise<void> {
  await vi.runAllTimersAsync();
}

/**
 * Where the calls on a lamp's handles came among every call on every lamp, for the calls of a kind and, for a write or
 * a read, about what. Comparing them tells what a lamp was asked before or after what.
 */
function positions(lamp: EmulatedLitra, call: HidCall, kind?: ReportKind): number[] {
  return hid.hidEvents().flatMap((event, index) => {
    const matches =
      event.lamp === lamp &&
      event.call === call &&
      (kind === undefined || (event.report !== undefined && kindOf(event.report) === kind));
    return matches ? [index] : [];
  });
}

/** How many times a lamp's handles were closed. */
function closes(lamp: EmulatedLitra): number {
  return positions(lamp, "close").length;
}

/**
 * What draining read from a lamp, by kind: the ACKs it took. A Beam LX's answers to the requests that identify it,
 * read the same way, aren't drained (#170).
 */
function drained(lamp: EmulatedLitra): Array<ReportKind | undefined> {
  return hid
    .hidEvents()
    .filter((event) => event.lamp === lamp && event.call === "readTimeout" && !isIdentifying(event.report ?? []))
    .map((event) => kindOf(event.report ?? []));
}

/** What was written to a lamp, but the requests that identify a Beam LX (#170): what an operation asked of it. */
function asked(lamp: EmulatedLitra): number[][] {
  return lamp.written.filter((report) => !isIdentifying(report));
}

/** Opens a lamp through litra, as litra-manager does, for a function that takes litra's device, then closes it. */
function withDevice<T>(lamp: EmulatedLitra, use: (device: Device) => T): T {
  connect(lamp);
  const device = at(litra.findDevices(), 0);
  try {
    return use(device);
  } finally {
    (device.hid as unknown as { close: () => void }).close();
  }
}

//* Pure functions

describe("percentageInRange", () => {
  it("maps the ends of the range to 0 and 100", () => {
    expect(manager.percentageInRange(MIN_LUMEN, MIN_LUMEN, MAX_LUMEN)).toBe(0);
    expect(manager.percentageInRange(MAX_LUMEN, MIN_LUMEN, MAX_LUMEN)).toBe(100);
  });

  it("maps a value inside the range proportionally, rounded to an integer", () => {
    expect(manager.percentageInRange(215, MIN_LUMEN, MAX_LUMEN)).toBe(50);
    expect(manager.percentageInRange(100, MIN_LUMEN, MAX_LUMEN)).toBe(19); // 18.92
    expect(manager.percentageInRange(102, MIN_LUMEN, MAX_LUMEN)).toBe(19); // 19.46
  });

  it("clamps values outside the range", () => {
    expect(manager.percentageInRange(20, MIN_LUMEN, MAX_LUMEN)).toBe(0);
    expect(manager.percentageInRange(500, MIN_LUMEN, MAX_LUMEN)).toBe(100);
  });

  it("returns 0 when the range is empty or inverted", () => {
    expect(manager.percentageInRange(50, 50, 50)).toBe(0);
    expect(manager.percentageInRange(50, 100, 20)).toBe(0);
  });
});

describe("percentageToLumen", () => {
  it("maps 0 and 100 to the ends of the range", () => {
    expect(manager.percentageToLumen(0, MIN_LUMEN, MAX_LUMEN)).toBe(30);
    expect(manager.percentageToLumen(100, MIN_LUMEN, MAX_LUMEN)).toBe(400);
  });

  it("rounds up, like litra", () => {
    expect(manager.percentageToLumen(70, MIN_LUMEN, MAX_LUMEN)).toBe(289);
    expect(manager.percentageToLumen(33, MIN_LUMEN, MAX_LUMEN)).toBe(153);
  });

  it("uses the range it's given", () => {
    // A Litra Glow's range.
    expect(manager.percentageToLumen(50, 20, 250)).toBe(135);
  });
});

describe("snapKelvin", () => {
  it("keeps an allowed value", () => {
    expect(manager.snapKelvin(3000, ALLOWED_KELVIN)).toBe(3000);
  });

  it("snaps to the nearest allowed value", () => {
    expect(manager.snapKelvin(3140, ALLOWED_KELVIN)).toBe(3100);
    expect(manager.snapKelvin(3160, ALLOWED_KELVIN)).toBe(3200);
  });

  it("snaps a tie to the value listed first", () => {
    expect(manager.snapKelvin(3150, ALLOWED_KELVIN)).toBe(3100);
    expect(manager.snapKelvin(3150, ALLOWED_KELVIN.toReversed())).toBe(3200);
  });

  it("snaps values outside the range to its ends", () => {
    expect(manager.snapKelvin(1000, ALLOWED_KELVIN)).toBe(MIN_KELVIN);
    expect(manager.snapKelvin(9000, ALLOWED_KELVIN)).toBe(MAX_KELVIN);
  });

  it("accepts an unsorted list", () => {
    expect(manager.snapKelvin(2800, [6500, 2700, 4000])).toBe(2700);
  });

  it("returns the value unchanged when nothing is allowed", () => {
    expect(manager.snapKelvin(3123, [])).toBe(3123);
  });
});

describe("stepOnGrid", () => {
  it("moves a value on the grid by whole steps, either way", () => {
    expect(manager.stepOnGrid(50, 2, 5, 0, 100)).toBe(60);
    expect(manager.stepOnGrid(50, -3, 5, 0, 100)).toBe(35);
  });

  it("counts the grid from the minimum", () => {
    expect(manager.stepOnGrid(MIN_KELVIN, 1, 500, MIN_KELVIN, MAX_KELVIN)).toBe(3200);
    expect(manager.stepOnGrid(3200, 2, 500, MIN_KELVIN, MAX_KELVIN)).toBe(4200);
  });

  it("clamps to the range", () => {
    expect(manager.stepOnGrid(90, 5, 10, 0, 100)).toBe(100);
    expect(manager.stepOnGrid(10, -5, 10, 0, 100)).toBe(0);
  });

  it("takes a value off the grid to the next grid value in the direction of the turn", () => {
    // The 79% cap of a Beam on a Stream Deck + XL's hub, with a 5% step.
    expect(manager.stepOnGrid(79, 1, 5, 0, 100)).toBe(80);
    expect(manager.stepOnGrid(79, -1, 5, 0, 100)).toBe(75);
    expect(manager.stepOnGrid(77, -1, 5, 0, 100)).toBe(75);
    expect(manager.stepOnGrid(79, -2, 5, 0, 100)).toBe(70);
  });

  it("goes down through the values it went up through, when the step doesn't divide the range (#14, #16)", () => {
    let value = 0;
    const up = [value];
    while (value < 100) {
      value = manager.stepOnGrid(value, 1, 7, 0, 100);
      up.push(value);
    }
    const down = [value];
    while (value > 0) {
      value = manager.stepOnGrid(value, -1, 7, 0, 100);
      down.push(value);
    }

    expect(up).toEqual([0, 7, 14, 21, 28, 35, 42, 49, 56, 63, 70, 77, 84, 91, 98, 100]);
    expect(down).toEqual(up.toReversed());
  });

  it("goes down from the clamped top to the grid, when the step doesn't divide the range", () => {
    expect(manager.stepOnGrid(MAX_KELVIN, -1, 500, MIN_KELVIN, MAX_KELVIN)).toBe(6200);
    expect(manager.stepOnGrid(MAX_KELVIN, -1, 300, MIN_KELVIN, MAX_KELVIN)).toBe(6300);
  });

  it("only clamps the value when there are no ticks or the step isn't positive", () => {
    expect(manager.stepOnGrid(79, 0, 5, 0, 100)).toBe(79);
    expect(manager.stepOnGrid(79, 2, 0, 0, 100)).toBe(79);
    expect(manager.stepOnGrid(79, 2, Number.NaN, 0, 100)).toBe(79);
    expect(manager.stepOnGrid(120, 0, 5, 0, 100)).toBe(100);
  });
});

/** What a dial action gives the debouncer to run with the ticks it gathered. */
type Flush = (ticks: number) => void | Promise<void>;

// The two ways a flush fails: an async flush rejects, and one that isn't async throws before returning anything.
const failedFlushes: [string, (error: Error) => Flush][] = [
  ["rejects", (error) => () => Promise.reject(error)],
  [
    "throws",
    (error) => () => {
      throw error;
    },
  ],
];

describe("createDialDebouncer", () => {
  it("flushes once, 60 ms after the last tick", async () => {
    const flush = vi.fn();
    const debounce = manager.createDialDebouncer(flush);

    debounce(1);
    await vi.advanceTimersByTimeAsync(59);
    expect(flush).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(flush).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledWith(1);
  });

  it("sums the ticks received within the window", async () => {
    const flush = vi.fn();
    const debounce = manager.createDialDebouncer(flush);

    debounce(1);
    debounce(2);
    debounce(-1);
    await vi.advanceTimersByTimeAsync(60);

    expect(flush).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledWith(2);
  });

  it("restarts the window on every tick", async () => {
    const flush = vi.fn();
    const debounce = manager.createDialDebouncer(flush);

    debounce(1);
    await vi.advanceTimersByTimeAsync(50);
    debounce(1);
    await vi.advanceTimersByTimeAsync(50);
    expect(flush).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10);
    expect(flush).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledWith(2);
  });

  it("starts counting from zero after a flush", async () => {
    const flush = vi.fn();
    const debounce = manager.createDialDebouncer(flush);

    debounce(3);
    await vi.advanceTimersByTimeAsync(60);
    debounce(1);
    await vi.advanceTimersByTimeAsync(60);

    expect(flush.mock.calls).toEqual([[3], [1]]);
  });

  it("uses the given delay", async () => {
    const flush = vi.fn();
    const debounce = manager.createDialDebouncer(flush, 200);

    debounce(1);
    await vi.advanceTimersByTimeAsync(199);
    expect(flush).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(flush).toHaveBeenCalledOnce();
  });

  it("waits for a running flush, then flushes every tick received meanwhile at once", async () => {
    const flush = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 300)));
    const debounce = manager.createDialDebouncer(flush);

    debounce(1);
    await vi.advanceTimersByTimeAsync(60);
    debounce(2);
    await vi.advanceTimersByTimeAsync(100);
    debounce(3);
    await vi.advanceTimersByTimeAsync(100);
    expect(flush.mock.calls).toEqual([[1]]);

    await vi.advanceTimersByTimeAsync(100);
    expect(flush.mock.calls).toEqual([[1], [5]]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(flush.mock.calls).toEqual([[1], [5]]);
  });

  it.each(failedFlushes)("keeps flushing after a flush that %s (#46)", async (_how, failing) => {
    const flush = vi.fn<Flush>().mockImplementationOnce(failing(new Error("HID write failed")));
    const debounce = manager.createDialDebouncer(flush);

    debounce(1);
    await vi.advanceTimersByTimeAsync(60);
    debounce(1);
    await vi.advanceTimersByTimeAsync(60);

    expect(flush).toHaveBeenCalledTimes(2);
  });
});

//* HID parsing

describe("getBrightnessInLumenSafe", () => {
  /** A notice a capped Beam sends unasked when it lowers its brightness to 244 lm. */
  const CHANGE_NOTICE = [0x11, 0xff, 0x04, 0x40, 0x01, 0x00, 0xf4, ...Array(13).fill(0)];

  it.each<[LitraModel, number]>([
    ["Glow", 0x04],
    ["Beam", 0x04],
    ["Beam LX", 0x06],
  ])("sends the brightness query for a %s as a 20-byte report", (model, featureIndex) => {
    const lamp = new EmulatedLitra(model);

    withDevice(lamp, (device) => manager.getBrightnessInLumenSafe(device));

    expect(lamp.written).toEqual([[0x11, 0xff, featureIndex, 0x31, ...Array(16).fill(0)]]);
  });

  it("reads the brightness from two bytes, so values above 255 survive", () => {
    expect(withDevice(newLamp({ brightnessInLumen: 400 }), manager.getBrightnessInLumenSafe)).toBe(400);
    expect(withDevice(newLamp({ brightnessInLumen: 30 }), manager.getBrightnessInLumenSafe)).toBe(30);
  });

  it("skips the reports a lamp sends unasked, ahead of the reply", () => {
    const lamp = newLamp({ brightnessInLumen: 244 });

    const brightness = withDevice(lamp, (device) => {
      // A set-brightness ACK, a change notice and an error report, as a capped Beam sends them.
      lamp.send([0x11, 0xff, 0x04, 0x4c, ...Array(16).fill(0)]);
      lamp.send(CHANGE_NOTICE);
      lamp.send([0x11, 0xff, 0xff, 0x04, 0x4c, 0x02, ...Array(14).fill(0)]);
      return manager.getBrightnessInLumenSafe(device);
    });

    expect(brightness).toBe(244);
  });

  it("skips a report too short to hold the brightness, even with the reply's header", () => {
    const lamp = newLamp({ brightnessInLumen: 244 });

    const brightness = withDevice(lamp, (device) => {
      lamp.send([0x11, 0xff, 0x04, 0x31, 0x00]);
      return manager.getBrightnessInLumenSafe(device);
    });

    expect(brightness).toBe(244);
  });

  it("gives up when the reply doesn't come", () => {
    const lamp = newLamp();

    expect(() =>
      withDevice(lamp, (device) => {
        // More reports than it skips, ahead of the reply.
        for (let report = 0; report <= 10; report += 1) {
          lamp.send(CHANGE_NOTICE);
        }
        return manager.getBrightnessInLumenSafe(device);
      }),
    ).toThrow("No brightness reply");
  });
});

//* Broadcasting to lamps

describe("forEachDevice", () => {
  /** An operation that fails on one lamp, by its serial number, as a lamp failing mid-operation would. */
  function failingOn(lamp: EmulatedLitra) {
    return vi.fn((device: Device) => {
      if (device.serialNumber === lamp.serialNumber) {
        throw new Error("HID write failed");
      }
    });
  }

  /** The serial numbers of the lamps an operation ran on, in order. */
  function ranOn(operation: ReturnType<typeof vi.fn>): string[] {
    return operation.mock.calls.map(([device]) => (device as Device).serialNumber);
  }

  it("goes through the lamps in the order of their serial numbers, whatever order they're found in", () => {
    const [later, earlier] = [newLamp({ serialNumber: "2325FE02BBBB" }), newLamp({ serialNumber: "2325FE01AAAA" })];
    connect(later, earlier);
    const operation = vi.fn();

    manager.forEachDevice("test", operation, "all");

    expect(ranOn(operation)).toEqual([earlier.serialNumber, later.serialNumber]);
  });

  it("orders the lamps by the last 4 characters of their serial numbers first, as the settings pages list them", () => {
    const [startsEarlier, endsEarlier] = [
      newLamp({ serialNumber: "2325FE01ZZZZ" }),
      newLamp({ serialNumber: "2325FE02AAAA" }),
    ];
    connect(startsEarlier, endsEarlier);
    const operation = vi.fn();

    manager.forEachDevice("test", operation, "all");

    expect(ranOn(operation)).toEqual([endsEarlier.serialNumber, startsEarlier.serialNumber]);
  });

  it("orders lamps whose serial numbers end alike by the whole serial number", () => {
    const [later, earlier] = [newLamp({ serialNumber: "2325FE02AAAA" }), newLamp({ serialNumber: "2325FE01AAAA" })];
    connect(later, earlier);
    const operation = vi.fn();

    manager.forEachDevice("test", operation, "all");

    expect(ranOn(operation)).toEqual([earlier.serialNumber, later.serialNumber]);
  });

  it("fails without running the operation when no lamp is connected", () => {
    const operation = vi.fn();

    expect(manager.forEachDevice("test", operation, "all")).toEqual({ ok: false, deviceCount: 0, failures: 1 });
    expect(operation).not.toHaveBeenCalled();
  });

  it("fails without running the operation when finding the lamps throws", () => {
    connect(newLamp());
    hid.failFindingLamps(new Error("HID enumeration failed"));
    const operation = vi.fn();

    expect(manager.forEachDevice("test", operation, "all")).toEqual({ ok: false, deviceCount: 0, failures: 1 });
    expect(operation).not.toHaveBeenCalled();
  });

  it("runs the operation once on every lamp", () => {
    const [first, second] = [newLamp(), newLamp()];
    connect(first, second);
    const operation = vi.fn();

    expect(manager.forEachDevice("test", operation, "all")).toEqual({ ok: true, deviceCount: 2, failures: 0 });
    expect(ranOn(operation)).toEqual([first.serialNumber, second.serialNumber]);
  });

  it("keeps going when a lamp fails, and counts the failure", () => {
    const [first, second] = [newLamp(), newLamp()];
    connect(first, second);
    const operation = failingOn(first);

    expect(manager.forEachDevice("test", operation, "all")).toEqual({ ok: false, deviceCount: 2, failures: 1 });
    expect(ranOn(operation)).toEqual([first.serialNumber, second.serialNumber]);
  });

  it("closes every lamp's handle after its operation, including a failed one", () => {
    const [first, second] = [newLamp(), newLamp()];
    connect(first, second);
    // Where the calls on the lamps had got to when the operation ran on each lamp.
    const reached: number[] = [];
    const failing = failingOn(first);
    const operation = vi.fn((device: Device) => {
      reached.push(hid.hidEvents().length);
      failing(device);
    });

    manager.forEachDevice("test", operation, "all");

    expect([closes(first), closes(second)]).toEqual([1, 1]);
    expect(at(positions(first, "close"), 0)).toBeLessThan(at(reached, 1));
  });

  it("ignores a handle that fails to close", () => {
    const [first, second] = [newLamp(), newLamp()];
    first.fail("close");
    connect(first, second);
    const operation = vi.fn();

    expect(manager.forEachDevice("test", operation, "all")).toEqual({ ok: true, deviceCount: 2, failures: 0 });
    expect(ranOn(operation)).toEqual([first.serialNumber, second.serialNumber]);
  });
});

describe("a selection of lamps (#20)", () => {
  it("runs the operation on the selected lamps alone, and closes the others without using them", () => {
    const [selected, other] = [newLamp(), newLamp()];
    connect(other, selected);
    const operation = vi.fn();

    expect(manager.forEachDevice("test", operation, [lampId(selected.serialNumber)])).toEqual({
      ok: true,
      deviceCount: 1,
      failures: 0,
    });
    expect(operation.mock.calls.map(([device]) => (device as Device).serialNumber)).toEqual([selected.serialNumber]);
    expect([closes(selected), closes(other)]).toEqual([1, 1]);
    expect(asked(other)).toEqual([]);
  });

  it("toggles the selected lamp alone", () => {
    const [selected, other] = [newLamp({ on: true }), newLamp({ on: false })];
    connect(selected, other);

    expect(manager.toggleLamps([lampId(selected.serialNumber)])).toEqual({
      ok: true,
      deviceCount: 1,
      failures: 0,
    });
    expect([selected.on, other.on]).toEqual([false, false]);
    expect(other.writes("power")).toEqual([]);
  });

  it("steps the brightness of the selected lamp alone, from its own brightness", async () => {
    const [selected, other] = [
      newLamp({ brightnessInLumen: lumenAt(20) }),
      newLamp({ brightnessInLumen: lumenAt(50) }),
    ];
    connect(selected, other);

    const result = await settled(manager.adjustLampsBrightness([lampId(selected.serialNumber)], 2, 5));

    expect(result).toMatchObject({ ok: true, deviceCount: 1, brightnessPercentages: [30] });
    expect([selected.writes("brightness"), other.writes("brightness")]).toEqual([[lumenAt(30)], []]);
  });

  it("steps the temperature of the selected lamp alone, from its own temperature", () => {
    const [other, selected] = [newLamp({ temperatureInKelvin: 3100 }), newLamp({ temperatureInKelvin: 5000 })];
    connect(other, selected);

    expect(manager.adjustLampsTemperature([lampId(selected.serialNumber)], 1, 200)).toMatchObject({
      ok: true,
      deviceCount: 1,
      representativeTemperatureKelvin: 5100,
    });
    expect([selected.writes("temperature"), other.writes("temperature")]).toEqual([[5100], []]);
  });

  it("fails when no selected lamp is connected, and closes the lamps it found", () => {
    const other = newLamp();
    connect(other);

    expect(manager.toggleLamps(["GONE"])).toEqual({ ok: false, deviceCount: 0, failures: 1 });
    expect(other.writes("power")).toEqual([]);
    expect(closes(other)).toBe(1);
  });

  it("acts on the selected lamps that are connected when another isn't", () => {
    const selected = newLamp({ on: true });
    connect(selected);

    expect(manager.toggleLamps([lampId(selected.serialNumber), "GONE"])).toEqual({
      ok: true,
      deviceCount: 1,
      failures: 0,
    });
    expect(selected.on).toBe(false);
  });
});

describe("the lamps the plugin knows (#194)", () => {
  /** Plugs these lamps in, and makes the plugin know only the ones in `known`. */
  function connectKnowing(known: readonly EmulatedLitra[], ...lamps: EmulatedLitra[]): void {
    hid.connect(...lamps);
    manager.setKnownLamps(known.map((lamp) => lampId(lamp.serialNumber)));
  }

  it("are the only ones an operation on every lamp acts on, and the others are closed unused", () => {
    const [known, unknown] = [newLamp({ on: true }), newLamp({ on: true })];
    connectKnowing([known], unknown, known);

    expect(manager.turnLampsOff("all")).toEqual({ ok: true, deviceCount: 1, failures: 0 });
    expect([known.on, unknown.on]).toEqual([false, true]);
    expect(asked(unknown)).toEqual([]);
    expect([closes(known), closes(unknown)]).toEqual([1, 1]);
  });

  it("are the only ones every lamp but the left out ones takes in (#147)", () => {
    const [known, leftOut, unknown] = [newLamp({ on: true }), newLamp({ on: true }), newLamp({ on: true })];
    connectKnowing([known, leftOut], known, leftOut, unknown);

    manager.turnLampsOff({ except: [lampId(leftOut.serialNumber)] });

    expect([known.on, leftOut.on, unknown.on]).toEqual([false, true, true]);
  });

  it("leave alone a lamp selected by id that the plugin doesn't know, and log it", () => {
    const [known, unknown] = [newLamp({ on: true }), newLamp({ on: true })];
    connectKnowing([known], known, unknown);
    const unknownId = lampId(unknown.serialNumber);

    manager.turnLampsOff([lampId(known.serialNumber), unknownId]);

    expect([known.on, unknown.on]).toEqual([false, true]);
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(`turn off: lamp ${unknownId} isn't one of the plugin's lamps`);
  });

  it("make an operation on every lamp but some fail, and log it, when every lamp connected is left out (#147)", () => {
    const [first, second] = [newLamp({ on: true }), newLamp({ on: true })];
    connectKnowing([first, second], first, second);

    const result = manager.turnLampsOff({
      except: [lampId(first.serialNumber), lampId(second.serialNumber)],
    });

    expect(result).toEqual({ ok: false, deviceCount: 0, failures: 1 });
    expect([first.on, second.on]).toEqual([true, true]);
    expect([closes(first), closes(second)]).toEqual([1, 1]);
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith("turn off: every lamp connected is left out");
  });

  it("are the only ones a scene sets (#174)", async () => {
    const [known, unknown] = [newLamp({ on: false }), newLamp({ on: false })];
    connectKnowing([known], known, unknown);

    await settled(manager.setLampsScene(everyLampAt(50, 5000)));

    expect([known.on, unknown.on]).toEqual([true, false]);
    expect(asked(unknown)).toEqual([]);
  });

  it("are the only ones the lamp screens read", async () => {
    const [known, unknown] = [newLamp(), newLamp()];
    connectKnowing([known], known, unknown);

    const { lamps } = await settled(manager.readLampStatuses());

    expect(lamps.map(({ serialNumber }) => serialNumber)).toEqual([known.serialNumber]);
  });

  it("make an operation fail, and log it, when none of the lamps connected is one of them", () => {
    const unknown = newLamp({ on: true });
    connectKnowing([], unknown);

    expect(manager.turnLampsOff("all")).toEqual({ ok: false, deviceCount: 0, failures: 1 });
    expect(unknown.on).toBe(true);
    expect(closes(unknown)).toBe(1);
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      "turn off: none of the lamps connected is one of the plugin's lamps",
    );
  });

  it("are none until they're set, so nothing is acted on before the global settings are read", () => {
    const lamp = newLamp({ on: true });
    hid.connect(lamp);

    expect(manager.turnLampsOff("all")).toMatchObject({ ok: false, deviceCount: 0 });
    expect(lamp.on).toBe(true);
  });

  it("don't limit finding the lamps, which lists the ones the plugin doesn't know too", () => {
    const [known, unknown] = [newLamp({ serialNumber: "2325FE01AAAA" }), newLamp({ serialNumber: "2325FE02BBBB" })];
    connectKnowing([known], known, unknown);

    expect(manager.findLamps().map(({ serialEnd }) => serialEnd)).toEqual(["AAAA", "BBBB"]);
  });
});

describe.each([
  ["turnLampsOn", () => manager.turnLampsOn("all"), false, 1],
  ["turnLampsOff", () => manager.turnLampsOff("all"), true, 0],
])("%s", (_name, broadcast, on, written) => {
  it("sends the command to every lamp, then drains its ACK", () => {
    const pair = [newLamp({ on }), newLamp({ on })];
    connect(...pair);

    expect(broadcast()).toEqual({ ok: true, deviceCount: 2, failures: 0 });
    expect(pair.map((lamp) => lamp.writes("power"))).toEqual([[written], [written]]);
    expect(pair.map((lamp) => lamp.on)).toEqual([!on, !on]);
    expect(pair.map(drained)).toEqual([["power"], ["power"]]);
    for (const lamp of pair) {
      expect(at(positions(lamp, "write", "power"), 0)).toBeLessThan(at(positions(lamp, "readTimeout", "power"), 0));
    }
  });

  it("succeeds when there is no ACK to drain", () => {
    const lamp = newLamp({ on });
    lamp.fail("readTimeout");
    connect(lamp);

    expect(broadcast()).toEqual({ ok: true, deviceCount: 1, failures: 0 });
  });

  it("reports a lamp that fails", () => {
    const first = newLamp({ on });
    first.failWrites("power");
    connect(first, newLamp({ on }));

    expect(broadcast()).toEqual({ ok: false, deviceCount: 2, failures: 1 });
  });
});

describe("a lamp without a serial number in its USB descriptor (#170)", () => {
  /** A Beam LX, off, whose USB descriptor gives no serial number, as the one probed. */
  function beamLx(serialNumber: string): EmulatedLitra {
    return new EmulatedLitra("Beam LX", { serialNumber, on: false });
  }

  it("is told apart by the serial number it keeps, which it's asked for", () => {
    const [first, second] = [beamLx("2541AB01C1T8"), beamLx("2541AB02D2T9")];
    connect(second, first);

    expect([first.info.serialNumber, second.info.serialNumber]).toEqual(["", ""]);
    expect(manager.findLamps().map(({ id, serialEnd }) => ({ id, serialEnd }))).toEqual([
      { id: lampId("2541AB01C1T8"), serialEnd: "C1T8" },
      { id: lampId("2541AB02D2T9"), serialEnd: "D2T9" },
    ]);

    manager.turnLampsOn([lampId("2541AB02D2T9")]);

    expect([first.on, second.on]).toEqual([false, true]);
  });

  it("is asked through Root for the index of Device Information, then for its serial number there", () => {
    const lamp = beamLx("2541AB01C1T8");
    connect(lamp);

    manager.turnLampsOn("all");

    expect(lamp.written.slice(0, 2)).toEqual([
      [0x11, 0xff, 0x00, 0x01, 0x00, 0x03, ...Array(14).fill(0)],
      [0x11, 0xff, 0x02, 0x21, ...Array(16).fill(0)],
    ]);
    expect(lamp.on).toBe(true);
  });

  it("is the only one asked, since a lamp whose descriptor gives its serial number is found with it", () => {
    const [lx, other] = [beamLx("2541AB01C1T8"), beam({ on: false })];
    connect(lx, other);

    manager.turnLampsOn("all");

    // The requests to Root and Device Information are the only ones that aren't about the lamp's light.
    const identifying = (lamp: EmulatedLitra) => lamp.written.filter((report) => kindOf(report) === undefined);
    expect([identifying(lx).length, identifying(other).length]).toEqual([2, 0]);
    expect([lx.on, other.on]).toEqual([true, true]);
  });

  it("is left out, closed and logged when its serial number can't be read, and the others go on", () => {
    const [lx, other] = [beamLx("2541AB01C1T8"), beam({ on: false })];
    lx.fail("identifying");
    connect(lx, other);

    manager.turnLampsOn("all");

    expect([lx.on, other.on]).toEqual([false, true]);
    expect(closes(lx)).toBe(1);
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      "turn on: Beam LX … failed: Error: Cannot read from hid device",
    );
  });

  describe("whose serial number can't be read (#100)", () => {
    /** A Beam LX that can't be told apart, plugged in with a Beam. */
    function unidentifiedWithBeam(): { lx: EmulatedLitra; other: EmulatedLitra } {
      const [lx, other] = [beamLx("2541AB01C1T8"), beam({ on: true })];
      lx.fail("identifying");
      connect(lx, other);
      return { lx, other };
    }

    it.each<[string, () => BroadcastResult | Promise<BroadcastResult>]>([
      ["turnLampsOn", () => manager.turnLampsOn("all")],
      ["toggleLamps", () => manager.toggleLamps("all")],
      ["setLampsBrightness", () => manager.setLampsBrightness("all", 50)],
      ["setLampsScene", () => manager.setLampsScene(everyLampAt(50, 5000))],
      ["adjustLampsTemperature, each lamp from its own", () => manager.adjustLampsTemperature("all", 1, 100, "each")],
      ["readLampsBrightness", () => manager.readLampsBrightness("all")],
    ])("counts as a failed lamp for %s on every lamp, which it could be one of", async (_name, operation) => {
      const { other } = unidentifiedWithBeam();

      expect(await settled(Promise.resolve(operation()))).toMatchObject({ ok: false, deviceCount: 2, failures: 1 });
      expect(other.on).toBe(true);
    });

    it("counts as a failed lamp for every lamp but some, which it could be one of", () => {
      unidentifiedWithBeam();

      expect(manager.turnLampsOff({ except: [MISSING_LAMP] })).toEqual({ ok: false, deviceCount: 2, failures: 1 });
    });

    it("counts as off, as a lamp that can't be read does, so the lamps don't all read as on", async () => {
      unidentifiedWithBeam();

      expect(await manager.areLampsOn("all")).toEqual({ ok: false, allOn: false, deviceCount: 2 });
    });

    it("is left out unnoticed by an operation on given lamps, which can't tell whether it was one of them", () => {
      const { other } = unidentifiedWithBeam();

      expect(manager.turnLampsOff([lampId(other.serialNumber)])).toEqual({
        ok: true,
        deviceCount: 1,
        failures: 0,
      });
    });

    it("is left out unnoticed when the plugin finds the lamps, which lists the others", () => {
      const { other } = unidentifiedWithBeam();

      expect(manager.findLamps().map(({ id }) => id)).toEqual([lampId(other.serialNumber)]);
    });
  });

  it.each<[string, ConstructorParameters<typeof EmulatedLitra>[1], string]>([
    [
      "has no Device Information",
      { deviceInformation: "none" },
      "No Device Information feature to read a serial number from",
    ],
    [
      "has a Device Information from before its serial number could be read",
      { deviceInformation: 3 },
      "Error 7 for function 2 of feature index 2",
    ],
    ["gives an empty serial number", { serialNumber: "" }, "Empty serial number"],
  ])("is left out, and the reason logged, when it %s", (_name, options, reason) => {
    const lamp = new EmulatedLitra("Beam LX", { on: false, ...options });
    connect(lamp);

    expect(manager.turnLampsOn("all")).toEqual({ ok: false, deviceCount: 0, failures: 1 });
    expect(lamp.on).toBe(false);
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(`turn on: Beam LX … failed: Error: ${reason}`);
  });

  it("makes an operation fail when it's the only lamp, and its serial number can't be read", () => {
    const lamp = beamLx("2541AB01C1T8");
    lamp.fail("identifying");
    connect(lamp);

    expect(manager.turnLampsOn("all")).toEqual({ ok: false, deviceCount: 0, failures: 1 });
    expect(lamp.on).toBe(false);
    expect(closes(lamp)).toBe(1);
  });
});

describe("a lamp that turns on at the setting it saved once switched off (#100)", () => {
  /** A Beam LX, on, at its lowest brightness and temperature, which it has saved, unless the options say otherwise. */
  function beamLx(options: ConstructorParameters<typeof EmulatedLitra>[1] = {}): EmulatedLitra {
    return new EmulatedLitra("Beam LX", { serialNumber: "2541AB01C1T8", on: true, ...options });
  }

  const identify = (lamp: EmulatedLitra) => settled(manager.identifyLamp(lampId(lamp.serialNumber), BLINK_MS));

  it("comes back from a blink shorter than it takes to save its setting at the setting it had, and logs it", async () => {
    const lamp = beamLx();
    connect(lamp);
    await settled(manager.setLampsScene(everyLampAt(100, 6500)));

    expect(await identify(lamp)).toEqual({ ok: true, deviceCount: 1, failures: 0 });

    expect([lamp.on, lamp.brightnessInLumen, lamp.temperatureInKelvin]).toEqual([true, 400, 6500]);
    expect(logger.info).toHaveBeenCalledWith(
      "identify: Beam LX …C1T8 turned on at 30 lm and 2700 K, put back to 400 lm and 6500 K",
    );
  });

  it("is put back only to what it lost", async () => {
    const lamp = beamLx();
    connect(lamp);
    await settled(manager.setLampsBrightness("all", 100));

    await identify(lamp);

    expect([lamp.brightnessInLumen, lamp.temperatureInKelvin]).toEqual([400, 2700]);
    expect([lamp.writes("brightness"), lamp.writes("temperature")]).toEqual([[400, 400], []]);
  });

  it.each<[string, () => unknown]>([
    ["turnLampsOn", () => manager.turnLampsOn("all")],
    ["toggleLamps", () => manager.toggleLamps("all")],
    ["setLampsBrightness", () => manager.setLampsBrightness("all", 50)],
    ["adjustLampsBrightness", () => manager.adjustLampsBrightness("all", 1, 10)],
  ])("turns on, through %s, at the temperature it was given while off", async (_name, turnOn) => {
    const lamp = beamLx({ on: false });
    connect(lamp);
    manager.setLampsTemperature("all", 5000);

    await settled(Promise.resolve(turnOn()));

    expect([lamp.on, lamp.temperatureInKelvin]).toEqual([true, 5000]);
  });

  it("keeps the temperature it was given while off through a blink, and turns on at it", async () => {
    const lamp = beamLx({ on: false });
    connect(lamp);
    manager.setLampsTemperature("all", 5000);

    await identify(lamp);
    manager.turnLampsOn("all");

    expect([lamp.on, lamp.temperatureInKelvin]).toEqual([true, 5000]);
  });

  it("isn't written to again when it turns on as it was, as a Beam does", () => {
    const lamp = beam({ on: false });
    connect(lamp);
    manager.setLampsTemperature("all", 5000);

    manager.turnLampsOn("all");

    expect([lamp.writes("temperature"), lamp.writes("brightness")]).toEqual([[5000], []]);
  });

  it("is still turned on, unchecked, when it can't be read, and says so", () => {
    const lamp = beam({ on: false });
    lamp.fail("readSync");
    connect(lamp);

    expect(manager.turnLampsOn("all")).toEqual({ ok: true, deviceCount: 1, failures: 0 });

    expect(lamp.on).toBe(true);
    expect(logger.warn).toHaveBeenCalledWith(
      `turn on: Beam …${lamp.serialNumber.slice(-4)} turned on unchecked, since it can't be read: Error: Cannot read from hid device`,
    );
  });
});

describe("toggleLamps", () => {
  it("turns every lamp off when every lamp is on, then drains each ACK", () => {
    const pair = [newLamp(), newLamp()];
    connect(...pair);

    expect(manager.toggleLamps("all")).toEqual({ ok: true, deviceCount: 2, failures: 0 });
    expect(pair.map((lamp) => lamp.writes("power"))).toEqual([[0], [0]]);
    expect(pair.map(drained)).toEqual([["power"], ["power"]]);
  });

  it("turns every lamp on when one is on and one is off", () => {
    const pair = [newLamp({ on: true }), newLamp({ on: false })];
    connect(...pair);

    expect(manager.toggleLamps("all")).toEqual({ ok: true, deviceCount: 2, failures: 0 });
    expect(pair.map((lamp) => lamp.writes("power"))).toEqual([[1], [1]]);
  });

  it("turns every lamp on when every lamp is off", () => {
    const pair = [newLamp({ on: false }), newLamp({ on: false })];
    connect(...pair);

    expect(manager.toggleLamps("all")).toEqual({ ok: true, deviceCount: 2, failures: 0 });
    expect(pair.map((lamp) => lamp.writes("power"))).toEqual([[1], [1]]);
  });

  it("reads every lamp before sending any command", () => {
    const [first, second] = [newLamp(), newLamp()];
    connect(first, second);

    manager.toggleLamps("all");

    const lastQuery = Math.max(
      ...positions(first, "write", "power query"),
      ...positions(second, "write", "power query"),
    );
    const firstCommand = Math.min(...positions(first, "write", "power"), ...positions(second, "write", "power"));
    expect(lastQuery).toBeLessThan(firstCommand);
  });

  it("counts a lamp that can't be read as off, and still turns it on", () => {
    const [first, second] = [newLamp(), newLamp()];
    first.fail("readSync");
    connect(first, second);

    expect(manager.toggleLamps("all")).toEqual({ ok: false, deviceCount: 2, failures: 1 });
    expect([first.writes("power"), second.writes("power")]).toEqual([[1], [1]]);
  });

  it("counts a lamp once when it can't be read nor written", () => {
    const first = newLamp();
    first.fail("everything");
    connect(first, newLamp());

    expect(manager.toggleLamps("all")).toEqual({ ok: false, deviceCount: 2, failures: 1 });
  });

  it("reports a lamp that fails, and still sends the command to the others", () => {
    const [first, second] = [newLamp(), newLamp()];
    first.failWrites("power");
    connect(first, second);

    expect(manager.toggleLamps("all")).toEqual({ ok: false, deviceCount: 2, failures: 1 });
    expect(second.writes("power")).toEqual([0]);
  });

  it("closes every handle, including a failed lamp's", () => {
    const [first, second] = [newLamp(), newLamp()];
    first.failWrites("power");
    connect(first, second);

    manager.toggleLamps("all");

    expect([closes(first), closes(second)]).toEqual([1, 1]);
  });

  it("succeeds when there is no ACK to drain", () => {
    const lamp = newLamp();
    lamp.fail("readTimeout");
    connect(lamp);

    expect(manager.toggleLamps("all")).toEqual({ ok: true, deviceCount: 1, failures: 0 });
  });

  it("fails when no lamp is connected", () => {
    expect(manager.toggleLamps("all")).toEqual({ ok: false, deviceCount: 0, failures: 1 });
  });
});

describe("areLampsOn", () => {
  it("reports on when every lamp is on", async () => {
    connect(newLamp(), newLamp());

    expect(await manager.areLampsOn("all")).toEqual({ ok: true, allOn: true, deviceCount: 2 });
  });

  it("reports off when at least one lamp is off", async () => {
    connect(newLamp({ on: true }), newLamp({ on: false }));

    expect(await manager.areLampsOn("all")).toEqual({ ok: true, allOn: false, deviceCount: 2 });
  });

  it("fails and reports off when no lamp is connected", async () => {
    expect(await manager.areLampsOn("all")).toEqual({ ok: false, allOn: false, deviceCount: 0 });
  });

  it("fails and reports off when finding the lamps throws", async () => {
    connect(newLamp());
    hid.failFindingLamps(new Error("HID enumeration failed"));

    expect(await manager.areLampsOn("all")).toEqual({ ok: false, allOn: false, deviceCount: 0 });
  });

  it("fails and reports off when a lamp can't be read, but still closes every handle", async () => {
    const [first, second] = [newLamp(), newLamp()];
    first.fail("readSync");
    connect(first, second);

    expect(await manager.areLampsOn("all")).toEqual({ ok: false, allOn: false, deviceCount: 2 });
    expect([closes(first), closes(second)]).toEqual([1, 1]);
  });

  it("waits for the brightness change in progress", async () => {
    const lamp = newLamp();
    connect(lamp);

    await settled(Promise.all([manager.setLampsBrightness("all", 100), manager.areLampsOn("all")]));

    // The change reads its lamp back before the lamps are opened again to read their power.
    expect(at(positions(lamp, "write", "brightness query"), -1)).toBeLessThan(
      at(positions(lamp, "write", "power query"), -1),
    );
  });
});

describe("onLampsChanged", () => {
  it.each([
    ["turnLampsOn", () => manager.turnLampsOn("all")],
    ["turnLampsOff", () => manager.turnLampsOff("all")],
    ["toggleLamps", () => manager.toggleLamps("all")],
    ["setLampsBrightness", () => manager.setLampsBrightness("all", 50)],
    ["adjustLampsBrightness", () => manager.adjustLampsBrightness("all", 1, 5)],
    ["setLampsTemperature", () => manager.setLampsTemperature("all", 4000)],
    ["adjustLampsTemperature", () => manager.adjustLampsTemperature("all", 1, 100)],
    ["setLampsScene", () => manager.setLampsScene(everyLampAt(50, 4000))],
  ])("calls every listener once after %s", async (_, operation) => {
    connect(newLamp(), newLamp());
    const listener = vi.fn();
    const otherListener = vi.fn();
    manager.onLampsChanged(listener);
    manager.onLampsChanged(otherListener);

    await settled(Promise.resolve(operation()));
    await announced();

    expect(listener).toHaveBeenCalledOnce();
    expect(otherListener).toHaveBeenCalledOnce();
  });

  it.each([
    ["areLampsOn", () => manager.areLampsOn("all")],
    ["readLampStatuses", () => manager.readLampStatuses()],
    ["readLampsBrightness", () => manager.readLampsBrightness("all")],
    ["readLampsTemperature", () => manager.readLampsTemperature("all")],
    ["identifyLamp, which leaves the lamp as it was", () => manager.identifyLamp("FAKE", BLINK_MS)],
  ])("doesn't call the listeners after %s", async (_, operation) => {
    connect(newLamp(), newLamp());
    const listener = vi.fn();
    manager.onLampsChanged(listener);

    await settled(Promise.resolve(operation()));
    await announced();

    expect(listener).not.toHaveBeenCalled();
  });

  it("calls the listeners after a brightness change has read the lamps back", async () => {
    const lamp = newLamp();
    connect(lamp);
    // Where the calls on the lamps had got to when the listener ran.
    const reached: number[] = [];
    manager.onLampsChanged(() => {
      reached.push(hid.hidEvents().length);
    });

    await settled(manager.setLampsBrightness("all", 50));
    await announced();

    expect(at(positions(lamp, "write", "brightness query"), -1)).toBeLessThan(at(reached, 0));
  });

  it("calls the listeners after an operation that found no lamp", async () => {
    const listener = vi.fn();
    manager.onLampsChanged(listener);

    manager.toggleLamps("all");
    await announced();

    expect(listener).toHaveBeenCalledOnce();
  });

  it("calls the listeners once the operation has returned", async () => {
    connect(newLamp());
    const listener = vi.fn();
    manager.onLampsChanged(listener);

    manager.toggleLamps("all");

    expect(listener).not.toHaveBeenCalled();
    await announced();
    expect(listener).toHaveBeenCalledOnce();
  });

  it("keeps calling the other listeners when one fails", async () => {
    connect(newLamp());
    manager.onLampsChanged(() => {
      throw new Error("listener failed");
    });
    const listener = vi.fn();
    manager.onLampsChanged(listener);

    manager.turnLampsOn("all");
    await announced();

    expect(listener).toHaveBeenCalledOnce();
  });

  it("removes a listener once, however many times it's removed, and keeps the others", async () => {
    connect(newLamp());
    const others = [vi.fn(), vi.fn()];
    const remove = manager.onLampsChanged(vi.fn());
    for (const other of others) {
      manager.onLampsChanged(other);
    }

    remove();
    remove();
    manager.turnLampsOn("all");
    await announced();

    expect(others.map((other) => other.mock.calls.length)).toEqual([1, 1]);
  });

  it("stops calling a listener once it's removed", async () => {
    connect(newLamp());
    const listener = vi.fn();
    const remove = manager.onLampsChanged(listener);

    remove();
    manager.turnLampsOn("all");
    await announced();

    expect(listener).not.toHaveBeenCalled();
  });
});

describe("setLampsBrightness", () => {
  const set = (percentage: number) => settled(manager.setLampsBrightness("all", percentage));

  it("sets every lamp to the percentage and reports it, with its lumens", async () => {
    const pair = [newLamp(), newLamp()];
    connect(...pair);

    expect(await set(40)).toEqual({
      ok: true,
      deviceCount: 2,
      failures: 0,
      representativeBrightnessPercentage: 40,
      representativeBrightnessLumen: 178,
      brightnessPercentages: [40, 40],
    });
    expect(pair.map((lamp) => lamp.writes("brightness"))).toEqual([[178], [178]]);
  });

  it("clamps the percentage to 0-100", async () => {
    const lamp = newLamp();
    connect(lamp);

    expect((await set(150)).representativeBrightnessPercentage).toBe(100);
    expect((await set(-10)).representativeBrightnessPercentage).toBe(0);
    expect(lamp.writes("brightness")).toEqual([MAX_LUMEN, MIN_LUMEN]);
  });

  it("reports the brightness the lamps reached, not the percentage asked for (#29)", async () => {
    // On a Stream Deck + XL's USB hub, a lamp stops below what it's asked for.
    connect(newLamp({ capInLumen: 244 }), newLamp({ capInLumen: 324 }));

    const result = await set(100);

    expect(result.representativeBrightnessPercentage).toBe(79);
    expect(result.representativeBrightnessLumen).toBe(324);
  });

  it("learns a lamp's cap, and sends it no more than its cap afterwards", async () => {
    const [capped, uncapped] = [newLamp({ capInLumen: 244 }), newLamp()];
    connect(capped, uncapped);

    await set(100);
    await set(90);

    expect(capped.writes("brightness")).toEqual([MAX_LUMEN, 244]);
    expect(uncapped.writes("brightness")).toEqual([MAX_LUMEN, lumenAt(90)]);
  });

  it("sends a lamp no more than a cap the dial learned", async () => {
    const capped = newLamp({ capInLumen: 244 });
    connect(capped);
    await settled(manager.adjustLampsBrightness("all", 20, 5));

    await set(100);

    expect(capped.writes("brightness")).toEqual([MAX_LUMEN, 244]);
  });

  it("forgets a lamp's cap once it's plugged in again, and sends it more (#55)", async () => {
    // A lamp on a Stream Deck + XL's USB hub, then plugged into the computer, where it isn't capped.
    const onAHub = newLamp({ capInLumen: 244 });
    connect(onAHub);
    await set(100);

    const onTheComputer = newLamp({ serialNumber: onAHub.serialNumber });
    connect(onTheComputer);
    await set(100);

    expect(onTheComputer.writes("brightness")).toEqual([MAX_LUMEN]);
    expect(onTheComputer.brightnessInLumen).toBe(MAX_LUMEN);
  });

  it("keeps a lamp's cap while it stays plugged in, when another lamp is plugged in again (#55)", async () => {
    const [staying, moving] = [newLamp({ capInLumen: 244 }), newLamp({ capInLumen: 264 })];
    connect(staying, moving);
    await set(100);

    // Listed first, the lamp plugged in again is the one whose cap is forgotten before the other lamp is sent anything.
    connect(newLamp({ serialNumber: moving.serialNumber }), staying);
    await set(100);

    expect(staying.writes("brightness")).toEqual([MAX_LUMEN, 244]);
  });

  it("waits for the lamps to settle before reading them back", async () => {
    const lamp = newLamp();
    connect(lamp);

    const result = manager.setLampsBrightness("all", 40);
    await vi.advanceTimersByTimeAsync(249);
    expect(lamp.queries("brightness")).toBe(0);

    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(lamp.queries("brightness")).toBe(1);
  });

  it("turns a lamp that is off on before changing its brightness", async () => {
    const lamp = newLamp({ on: false });
    connect(lamp);

    await set(40);

    expect(lamp.writes("power")).toEqual([1]);
    expect(at(positions(lamp, "write", "power"), 0)).toBeLessThan(at(positions(lamp, "write", "brightness"), 0));
  });

  it("leaves a lamp that is on as it is", async () => {
    const lamp = newLamp({ on: true });
    connect(lamp);

    await set(40);

    expect(lamp.writes("power")).toEqual([]);
  });

  it("reports the lamps that succeeded when some fail, and closes every handle", async () => {
    const [first, second] = [newLamp(), newLamp()];
    first.failWrites("brightness");
    connect(first, second);

    expect(await set(40)).toEqual({
      ok: false,
      deviceCount: 2,
      failures: 1,
      representativeBrightnessPercentage: 40,
      representativeBrightnessLumen: 178,
      brightnessPercentages: [40],
    });
    expect([closes(first), closes(second)]).toEqual([1, 1]);
  });

  it("leaves out a lamp that can't be read, without writing to it", async () => {
    const [first, second] = [newLamp(), newLamp()];
    first.fail("readSync");
    connect(first, second);

    expect(await set(40)).toMatchObject({ ok: false, failures: 1, brightnessPercentages: [40] });
    expect(first.writes("brightness")).toEqual([]);
  });

  it("fails without writing, and reports no percentage or lumens, when no lamp is connected", async () => {
    expect(await set(40)).toEqual({ ok: false, deviceCount: 0, failures: 1 });
  });
});

describe("brightness changes", () => {
  it("run one at a time, in the order they were asked for", async () => {
    const lamp = newLamp();
    connect(lamp);

    await settled(Promise.all([manager.setLampsBrightness("all", 100), manager.setLampsBrightness("all", 20)]));

    // The lamp is read back after each change, before the next one is written.
    expect(lamp.writes("brightness")).toEqual([MAX_LUMEN, lumenAt(20)]);
    expect(at(positions(lamp, "write", "brightness query"), 0)).toBeLessThan(
      at(positions(lamp, "write", "brightness"), 1),
    );
  });

  it("don't take a later change's lower brightness for a cap", async () => {
    const lamp = newLamp();
    connect(lamp);
    await settled(Promise.all([manager.setLampsBrightness("all", 100), manager.adjustLampsBrightness("all", -16, 5)]));

    await settled(manager.setLampsBrightness("all", 100));

    expect(at(lamp.writes("brightness"), -1)).toBe(MAX_LUMEN);
  });
});

describe("adjustLampsBrightness", () => {
  const adjust = (ticks: number, stepPercentage: number) =>
    settled(manager.adjustLampsBrightness("all", ticks, stepPercentage));

  it("moves every lamp to one target, stepped from the brightest lamp", async () => {
    const [first, second] = [newLamp({ brightnessInLumen: lumenAt(20) }), newLamp({ brightnessInLumen: lumenAt(50) })];
    connect(first, second);

    expect(await adjust(2, 5)).toEqual({
      ok: true,
      deviceCount: 2,
      failures: 0,
      representativeBrightnessPercentage: 60,
      representativeBrightnessLumen: lumenAt(60),
      brightnessPercentages: [60, 60],
    });
    expect([first.writes("brightness"), second.writes("brightness")]).toEqual([[lumenAt(60)], [lumenAt(60)]]);
  });

  it("moves down for negative ticks", async () => {
    const lamp = newLamp({ brightnessInLumen: lumenAt(50) });
    connect(lamp);

    await adjust(-3, 10);

    expect(lamp.writes("brightness")).toEqual([lumenAt(20)]);
  });

  it("clamps the target to 0-100", async () => {
    const bright = newLamp({ brightnessInLumen: lumenAt(90) });
    const dim = newLamp({ brightnessInLumen: lumenAt(10) });

    connect(bright);
    await adjust(5, 10);
    connect(dim);
    await adjust(-5, 10);

    expect([bright.writes("brightness"), dim.writes("brightness")]).toEqual([[MAX_LUMEN], [MIN_LUMEN]]);
  });

  it("steps from a brightness off the step's multiples to the next one in the direction of the turn", async () => {
    // 33%, set by a key.
    const goingUp = newLamp({ brightnessInLumen: 153 });
    const goingDown = newLamp({ brightnessInLumen: 153 });

    connect(goingUp);
    await adjust(1, 20);
    connect(goingDown);
    await adjust(-1, 20);

    expect([goingUp.writes("brightness"), goingDown.writes("brightness")]).toEqual([[lumenAt(40)], [lumenAt(20)]]);
  });

  it("steps down from a lamp's cap to the multiple of the step below it (#14)", async () => {
    // A lamp capped at 70% on a Stream Deck + XL's USB hub, turned up past it with a 20% step.
    const lamp = newLamp({ brightnessInLumen: lumenAt(60), capInLumen: lumenAt(70) });
    connect(lamp);

    await adjust(1, 20);
    await adjust(-1, 20);

    expect(lamp.writes("brightness")).toEqual([lumenAt(80), lumenAt(60)]);
  });

  it("reports the brightness the lamp reached, not the one requested (#13)", async () => {
    // On a Stream Deck + XL's USB hub, a lamp stops below what it's asked for.
    const lamp = newLamp({ brightnessInLumen: lumenAt(70), capInLumen: lumenAt(70) });
    connect(lamp);

    const result = await adjust(4, 5);

    expect(lamp.writes("brightness")).toEqual([lumenAt(90)]);
    expect(result.representativeBrightnessPercentage).toBe(70);
    expect(result.representativeBrightnessLumen).toBe(lumenAt(70));
  });

  it("reports the brightest lamp when the lamps reach different brightnesses", async () => {
    connect(newLamp({ capInLumen: 244 }), newLamp({ capInLumen: 324 }));

    const result = await adjust(20, 5);

    expect(result.representativeBrightnessPercentage).toBe(79);
    expect(result.representativeBrightnessLumen).toBe(324);
  });

  it("learns a lamp's cap, and sends it no more than its cap afterwards", async () => {
    const [capped, uncapped] = [newLamp({ capInLumen: 244 }), newLamp()];
    connect(capped, uncapped);

    await adjust(20, 5);
    await adjust(-2, 5);

    expect(capped.writes("brightness")).toEqual([MAX_LUMEN, 244]);
    expect(uncapped.writes("brightness")).toEqual([MAX_LUMEN, lumenAt(90)]);
  });

  it("keeps a learned cap per lamp", async () => {
    const capped = newLamp({ capInLumen: 244 });
    connect(capped);
    await adjust(20, 5);

    const other = newLamp();
    connect(other);
    await adjust(20, 5);

    expect(other.writes("brightness")).toEqual([MAX_LUMEN]);
  });

  it("waits for the lamps to settle before reading them back", async () => {
    const lamp = newLamp();
    connect(lamp);

    const result = manager.adjustLampsBrightness("all", 1, 10);
    await vi.advanceTimersByTimeAsync(249);
    expect(lamp.queries("brightness")).toBe(1);

    await vi.advanceTimersByTimeAsync(1);
    await result;
    expect(lamp.queries("brightness")).toBe(2);
  });

  it("fails without writing when no lamp can be read", async () => {
    const [first, second] = [newLamp({ brightnessInLumen: lumenAt(50) }), newLamp({ brightnessInLumen: lumenAt(50) })];
    first.fail("readSync");
    second.fail("readSync");
    connect(first, second);

    expect(await adjust(1, 10)).toMatchObject({ ok: false, failures: 2 });
    expect([first.writes("brightness"), second.writes("brightness")]).toEqual([[], []]);
  });

  it("turns a lamp that is off on before changing its brightness", async () => {
    const lamp = newLamp({ on: false, brightnessInLumen: lumenAt(50) });
    connect(lamp);

    await adjust(1, 5);

    expect(lamp.writes("power")).toEqual([1]);
    expect(at(positions(lamp, "write", "power"), 0)).toBeLessThan(at(positions(lamp, "write", "brightness"), 0));
  });

  it("keeps going when a lamp fails, counts it once, and closes every handle", async () => {
    const [first, second] = [newLamp({ brightnessInLumen: lumenAt(50) }), newLamp({ brightnessInLumen: lumenAt(50) })];
    first.failWrites("brightness");
    connect(first, second);

    expect(await adjust(2, 5)).toEqual({
      ok: false,
      deviceCount: 2,
      failures: 1,
      representativeBrightnessPercentage: 60,
      representativeBrightnessLumen: lumenAt(60),
      brightnessPercentages: [60],
    });
    expect([closes(first), closes(second)]).toEqual([1, 1]);
  });

  it("leaves a lamp that can't be read out of the target and the writes", async () => {
    const [first, second] = [newLamp({ brightnessInLumen: lumenAt(90) }), newLamp({ brightnessInLumen: lumenAt(50) })];
    first.fail("readSync");
    connect(first, second);

    expect(await adjust(1, 10)).toMatchObject({ ok: false, failures: 1, brightnessPercentages: [60] });
    expect([first.writes("brightness"), second.writes("brightness")]).toEqual([[], [lumenAt(60)]]);
  });

  it("fails without writing when no lamp is connected", async () => {
    expect(await adjust(1, 5)).toEqual({ ok: false, deviceCount: 0, failures: 1 });
  });
});

describe("adjustLampsBrightness, each lamp from its own (#145)", () => {
  const adjust = (ticks: number, stepPercentage: number) =>
    settled(manager.adjustLampsBrightness("all", ticks, stepPercentage, "each"));

  it("steps every lamp from its own brightness, and reports the brightest", async () => {
    const [first, second] = [newLamp({ brightnessInLumen: lumenAt(20) }), newLamp({ brightnessInLumen: lumenAt(50) })];
    connect(first, second);

    expect(await adjust(2, 5)).toEqual({
      ok: true,
      deviceCount: 2,
      failures: 0,
      representativeBrightnessPercentage: 60,
      representativeBrightnessLumen: lumenAt(60),
      brightnessPercentages: [30, 60],
    });
    expect([first.writes("brightness"), second.writes("brightness")]).toEqual([[lumenAt(30)], [lumenAt(60)]]);
  });

  it("keeps stepping the other lamps once one reaches an end of its range, and comes back with their difference", async () => {
    const [dim, bright] = [newLamp({ brightnessInLumen: lumenAt(50) }), newLamp({ brightnessInLumen: lumenAt(90) })];
    connect(dim, bright);

    await adjust(2, 10);
    await adjust(1, 10);

    expect([dim.brightnessInLumen, bright.brightnessInLumen]).toEqual([lumenAt(80), MAX_LUMEN]);

    await adjust(-3, 10);

    expect([dim.brightnessInLumen, bright.brightnessInLumen]).toEqual([lumenAt(50), lumenAt(90)]);
  });

  it("keeps the lamps a step apart through their caps and down to 0%, and back up (#145)", async () => {
    // Two lamps on a Stream Deck + XL's USB hub, which stop at 79% and 58%, the first one step ahead.
    const ahead = newLamp({ brightnessInLumen: lumenAt(10), capInLumen: 324 });
    const behind = newLamp({ brightnessInLumen: MIN_LUMEN, capInLumen: 244 });
    connect(ahead, behind);
    const levels = () => [ahead.brightnessInLumen, behind.brightnessInLumen];

    await adjust(5, 10);

    expect(levels()).toEqual([lumenAt(60), lumenAt(50)]);

    await adjust(1, 10);
    await adjust(1, 10);

    expect(levels()).toEqual([324, 244]);

    // Both are at their caps: a turn up does nothing, so the next turn down moves at once.
    await adjust(3, 10);
    await adjust(-1, 10);

    expect(levels()).toEqual([lumenAt(70), 244]);

    await adjust(-1, 10);

    expect(levels()).toEqual([lumenAt(60), lumenAt(50)]);

    await adjust(-6, 10);

    expect(levels()).toEqual([lumenAt(0), lumenAt(0)]);

    // Both are at 0%: a turn down does nothing, and the first lamp is still a step ahead on the way up.
    await adjust(-3, 10);
    await adjust(1, 10);

    expect(levels()).toEqual([lumenAt(10), lumenAt(0)]);
  });

  it("moves the lamps on the first tick down after a turn up went past caps it hadn't learned yet", async () => {
    // Two lamps on a Stream Deck + XL's USB hub, which stop at 79% and 58%, whose caps aren't learned yet: a quick
    // turn up is planned as if they could reach every step of it.
    const first = newLamp({ brightnessInLumen: lumenAt(70), capInLumen: 324 });
    const second = newLamp({ brightnessInLumen: lumenAt(50), capInLumen: 244 });
    connect(first, second);

    await adjust(2, 10);

    expect([first.brightnessInLumen, second.brightnessInLumen]).toEqual([324, 244]);

    await adjust(-1, 10);

    expect([first.brightnessInLumen, second.brightnessInLumen]).toEqual([lumenAt(70), lumenAt(50)]);
  });

  it("steps a lamp set by anything else from where it is, even where its position left it", async () => {
    const [dim, bright] = [newLamp({ brightnessInLumen: lumenAt(50) }), newLamp({ brightnessInLumen: lumenAt(90) })];
    connect(dim, bright);
    // The bright lamp is left at 100%, with its position a step above.
    await adjust(2, 10);

    await settled(manager.setLampsBrightness("all", 100));
    await adjust(-1, 10);

    expect([dim.brightnessInLumen, bright.brightnessInLumen]).toEqual([lumenAt(90), lumenAt(90)]);
  });

  it("steps a lamp moved with its own buttons from where it is", async () => {
    const [dim, bright] = [newLamp({ brightnessInLumen: lumenAt(50) }), newLamp({ brightnessInLumen: lumenAt(90) })];
    connect(dim, bright);
    await adjust(2, 10);

    bright.brightnessInLumen = lumenAt(60);
    await adjust(-1, 10);

    expect([dim.brightnessInLumen, bright.brightnessInLumen]).toEqual([lumenAt(60), lumenAt(50)]);
  });

  it("keeps stepping the other lamps once one stops at its cap", async () => {
    // A lamp capped at 58% on a Stream Deck + XL's USB hub.
    const capped = newLamp({ brightnessInLumen: lumenAt(50), capInLumen: 244 });
    const uncapped = newLamp({ brightnessInLumen: lumenAt(50) });
    connect(capped, uncapped);

    await adjust(2, 10);
    await adjust(1, 10);

    expect([capped.brightnessInLumen, uncapped.brightnessInLumen]).toEqual([244, lumenAt(80)]);
    // Once its cap is learned, the capped lamp is sent no more than it.
    expect(capped.writes("brightness")).toEqual([lumenAt(70), 244]);
  });

  it("steps a lamp off the step's multiples to the next one, and the others along them", async () => {
    // 33%, set by a key.
    const [offGrid, onGrid] = [newLamp({ brightnessInLumen: 153 }), newLamp({ brightnessInLumen: lumenAt(60) })];
    connect(offGrid, onGrid);

    await adjust(1, 20);

    expect([offGrid.writes("brightness"), onGrid.writes("brightness")]).toEqual([[lumenAt(40)], [lumenAt(80)]]);
  });

  it("leaves a lamp that can't be read out of the writes, and steps the others", async () => {
    const [first, second] = [newLamp({ brightnessInLumen: lumenAt(90) }), newLamp({ brightnessInLumen: lumenAt(50) })];
    first.fail("readSync");
    connect(first, second);

    expect(await adjust(1, 10)).toMatchObject({ ok: false, failures: 1, brightnessPercentages: [60] });
    expect([first.writes("brightness"), second.writes("brightness")]).toEqual([[], [lumenAt(60)]]);
  });

  it("fails without writing when no lamp is connected", async () => {
    expect(await adjust(1, 5)).toEqual({ ok: false, deviceCount: 0, failures: 1 });
  });
});

describe("a lamp going back to its cap (#55)", () => {
  // Asking a lamp for more than its cap, then right away for 30%, from a key's preset and from the dial. Going down six
  // steps of 5 from a cap of 244 lm (58%) also ends at 30%.
  const upThenDown: [string, () => Promise<BroadcastResult>, () => Promise<BroadcastResult>][] = [
    ["a preset", () => manager.setLampsBrightness("all", 100), () => manager.setLampsBrightness("all", 30)],
    ["the dial", () => manager.adjustLampsBrightness("all", 20, 5), () => manager.adjustLampsBrightness("all", -6, 5)],
  ];

  it.each(upThenDown)(
    "keeps a lower brightness asked for right after %s went above the cap",
    async (_from, up, down) => {
      const lamp = newLamp({ capInLumen: 244 });
      connect(lamp);

      const [, result] = await settled(Promise.all([up(), down()]));

      expect(lamp.brightnessInLumen).toBe(lumenAt(30));
      expect(result.representativeBrightnessPercentage).toBe(30);
    },
  );

  it("waits until 1.5 s after the request above the cap, then writes", async () => {
    const lamp = newLamp({ capInLumen: 244 });
    connect(lamp);

    const both = Promise.all([manager.setLampsBrightness("all", 100), manager.setLampsBrightness("all", 30)]);
    await vi.advanceTimersByTimeAsync(1499);
    expect(lamp.writes("brightness")).toEqual([MAX_LUMEN]);

    await vi.advanceTimersByTimeAsync(1);
    expect(lamp.writes("brightness")).toEqual([MAX_LUMEN, lumenAt(30)]);
    await settled(both);
  });

  it.each([
    ["a lamp without a cap", beam, 100],
    ["a lamp sent less than its cap", () => newLamp({ capInLumen: 244 }), 50],
  ])("makes no change wait for %s", async (_lamp, lamp, percentage) => {
    const plugged = lamp();
    connect(plugged);

    const both = Promise.all([manager.setLampsBrightness("all", percentage), manager.setLampsBrightness("all", 30)]);
    await vi.advanceTimersByTimeAsync(250);

    expect(plugged.writes("brightness")).toEqual([lumenAt(percentage), lumenAt(30)]);
    await settled(both);
  });
});

describe("readLampsBrightness", () => {
  it("reads every lamp and reports the brightest, with its lumens", async () => {
    const [first, second] = [newLamp({ brightnessInLumen: lumenAt(20) }), newLamp({ brightnessInLumen: lumenAt(50) })];
    connect(first, second);

    expect(await manager.readLampsBrightness("all")).toEqual({
      ok: true,
      deviceCount: 2,
      failures: 0,
      representativeBrightnessPercentage: 50,
      representativeBrightnessLumen: lumenAt(50),
      brightnessPercentages: [20, 50],
    });
    expect([closes(first), closes(second)]).toEqual([1, 1]);
  });

  it("reports the lamps it could read when one can't be read", async () => {
    const first = newLamp({ brightnessInLumen: lumenAt(50) });
    first.fail("readSync");
    connect(first, newLamp({ brightnessInLumen: lumenAt(20) }));

    expect(await manager.readLampsBrightness("all")).toEqual({
      ok: false,
      deviceCount: 2,
      failures: 1,
      representativeBrightnessPercentage: 20,
      representativeBrightnessLumen: lumenAt(20),
      brightnessPercentages: [20],
    });
  });

  it("waits for the brightness change in progress", async () => {
    connect(newLamp());

    const [, read] = await settled(
      Promise.all([manager.setLampsBrightness("all", 40), manager.readLampsBrightness("all")]),
    );

    expect(read.representativeBrightnessPercentage).toBe(40);
  });
});

describe("setLampsScene", () => {
  const scene = (percentage: number, kelvin: number) => settled(manager.setLampsScene(everyLampAt(percentage, kelvin)));

  it("turns every lamp on, then sets its temperature, snapped to an allowed one, then its brightness", async () => {
    const pair = [newLamp({ on: false }), newLamp({ on: false })];
    connect(...pair);

    const result = await scene(40, 4040);

    for (const lamp of pair) {
      expect([lamp.writes("power"), lamp.writes("temperature"), lamp.writes("brightness")]).toEqual([
        [1],
        [4000],
        [lumenAt(40)],
      ]);
      expect(at(positions(lamp, "write", "power"), 0)).toBeLessThan(at(positions(lamp, "write", "temperature"), 0));
      expect(at(positions(lamp, "write", "temperature"), 0)).toBeLessThan(
        at(positions(lamp, "write", "brightness"), 0),
      );
    }
    expect(result).toMatchObject({ ok: true, deviceCount: 2, failures: 0, representativeBrightnessPercentage: 40 });
  });

  it("stops a lamp at its cap, learns it, and sends it no more than its cap afterwards", async () => {
    const lamp = newLamp({ capInLumen: 244 });
    connect(lamp);

    const result = await scene(100, 6500);
    await scene(100, 6500);

    expect(result.representativeBrightnessLumen).toBe(244);
    expect(lamp.writes("brightness")).toEqual([MAX_LUMEN, 244]);
  });

  it("runs after the brightness change in progress, and waits for a lamp that can still go back to its cap", async () => {
    // A lamp on a hub, asked for more than its cap right before the scene asks for less.
    const lamp = newLamp({ capInLumen: 244 });
    connect(lamp);

    await settled(Promise.all([manager.setLampsBrightness("all", 100), manager.setLampsScene(everyLampAt(30, 2700))]));

    expect(lamp.brightnessInLumen).toBe(lumenAt(30));
  });

  it("fails without writing when no lamp is connected", async () => {
    expect(await scene(40, 4000)).toEqual({ ok: false, deviceCount: 0, failures: 1 });
  });

  describe("with groups (#174)", () => {
    const id = (lamp: EmulatedLitra) => lampId(lamp.serialNumber);

    it("sets each group's lamps to the group's own brightness and temperature, in one pass", async () => {
      const [left, center, right] = [newLamp(), newLamp(), newLamp()];
      connect(left, center, right);

      const result = await settled(
        manager.setLampsScene([
          { lamps: [id(left), id(right)], on: true, percentage: 50, kelvin: 5000 },
          { lamps: [id(center)], on: true, percentage: 30, kelvin: 3000 },
        ]),
      );

      expect([left, center, right].map((lamp) => [lamp.brightnessInLumen, lamp.temperatureInKelvin])).toEqual([
        [lumenAt(50), 5000],
        [lumenAt(30), 3000],
        [lumenAt(50), 5000],
      ]);
      expect(result).toMatchObject({ ok: true, deviceCount: 3, failures: 0, representativeBrightnessPercentage: 50 });
    });

    it("turns a group's lamps off, and leaves their brightness and temperature as they are", async () => {
      const [lit, dark] = [newLamp({ on: false }), newLamp()];
      connect(lit, dark);

      const result = await settled(
        manager.setLampsScene([
          { lamps: [id(lit)], on: true, percentage: 40, kelvin: 4000 },
          { lamps: [id(dark)], on: false, percentage: 100, kelvin: 6500 },
        ]),
      );

      expect([lit.on, dark.on]).toEqual([true, false]);
      expect([dark.writes("power"), dark.writes("brightness"), dark.writes("temperature")]).toEqual([[0], [], []]);
      expect(result).toMatchObject({ ok: true, deviceCount: 2, failures: 0, brightnessPercentages: [40] });
    });

    it("gives a lamp that two groups select the first group's part", async () => {
      const [taken, rest] = [newLamp(), newLamp()];
      connect(taken, rest);

      await settled(
        manager.setLampsScene([
          { lamps: [id(taken)], on: false, percentage: 0, kelvin: 2700 },
          { lamps: "all", on: true, percentage: 40, kelvin: 4000 },
        ]),
      );

      expect([taken.on, taken.writes("brightness")]).toEqual([false, []]);
      expect(rest.brightnessInLumen).toBe(lumenAt(40));
    });

    it("sets the lamps of the groups that select some, when another group selects none", async () => {
      const lamp = newLamp();
      connect(lamp);

      const result = await settled(
        manager.setLampsScene([
          { lamps: [], on: true, percentage: 100, kelvin: 6500 },
          { lamps: "all", on: true, percentage: 40, kelvin: 4000 },
        ]),
      );

      expect(lamp.brightnessInLumen).toBe(lumenAt(40));
      expect(result.ok).toBe(true);
    });
  });
});

describe("setLampsTemperature", () => {
  it("sets every lamp to the temperature, snapped to an allowed value, and reports it and its %", () => {
    const pair = [newLamp(), newLamp()];
    connect(...pair);

    expect(manager.setLampsTemperature("all", 4321)).toEqual({
      ok: true,
      deviceCount: 2,
      failures: 0,
      representativeTemperatureKelvin: 4300,
      representativeTemperaturePercentage: 42,
    });
    expect(pair.map((lamp) => lamp.writes("temperature"))).toEqual([[4300], [4300]]);
  });

  it("drains each lamp's ACK", () => {
    const lamp = newLamp();
    connect(lamp);

    manager.setLampsTemperature("all", 3000);

    expect(drained(lamp)).toEqual(["temperature"]);
  });

  it("fails without writing when no lamp is connected", () => {
    expect(manager.setLampsTemperature("all", 3000)).toEqual({ ok: false, deviceCount: 0, failures: 1 });
  });
});

describe("adjustLampsTemperature", () => {
  it("moves every lamp to one target, stepped from the first lamp's temperature, and reports it", () => {
    const [first, second] = [newLamp({ temperatureInKelvin: 3100 }), newLamp({ temperatureInKelvin: 2700 })];
    connect(first, second);

    // 2 ticks of 200 K, one of the dial's step options.
    expect(manager.adjustLampsTemperature("all", 2, 200)).toEqual({
      ok: true,
      deviceCount: 2,
      failures: 0,
      representativeTemperatureKelvin: 3500,
      representativeTemperaturePercentage: 21,
    });
    expect([first.writes("temperature"), second.writes("temperature")]).toEqual([[3500], [3500]]);
    expect([first.queries("temperature"), second.queries("temperature")]).toEqual([1, 0]);
  });

  it("steps from the lamp with the lowest serial number, whatever order the lamps are found in", () => {
    const later = newLamp({ serialNumber: "2325FE02BBBB", temperatureInKelvin: 5000 });
    const earlier = newLamp({ serialNumber: "2325FE01AAAA", temperatureInKelvin: 3100 });
    connect(later, earlier);

    manager.adjustLampsTemperature("all", 1, 200);

    expect([earlier.temperatureInKelvin, later.temperatureInKelvin]).toEqual([3300, 3300]);
  });

  it("steps along the grid counted from the lowest allowed value (#16)", () => {
    // The default preset, off the 200 K grid that starts at 2700 K.
    const lamp = newLamp({ temperatureInKelvin: 4000 });
    connect(lamp);

    manager.adjustLampsTemperature("all", 1, 200);
    manager.adjustLampsTemperature("all", -1, 200);

    expect(lamp.writes("temperature")).toEqual([4100, 3900]);
  });

  it("steps down from the highest allowed value to the grid, when the step doesn't divide the range (#16)", () => {
    connect(newLamp({ temperatureInKelvin: MAX_KELVIN }));

    expect(manager.adjustLampsTemperature("all", -1, 500).representativeTemperatureKelvin).toBe(6200);
  });

  it("steps from the next lamp when the first can't be read", () => {
    const [first, second] = [newLamp(), newLamp({ temperatureInKelvin: 3000 })];
    first.fail("readSync");
    connect(first, second);

    expect(manager.adjustLampsTemperature("all", 1, 100)).toEqual({
      ok: false,
      deviceCount: 2,
      failures: 1,
      representativeTemperatureKelvin: 3100,
      representativeTemperaturePercentage: 11,
    });
    expect([first.writes("temperature"), second.writes("temperature")]).toEqual([[], [3100]]);
  });

  it("moves down for negative ticks, and stops at the lowest allowed value", () => {
    connect(newLamp({ temperatureInKelvin: 3000 }));

    const result = manager.adjustLampsTemperature("all", -10, KELVIN_STEP);

    expect(result.representativeTemperatureKelvin).toBe(MIN_KELVIN);
    expect(result.representativeTemperaturePercentage).toBe(0);
  });

  it("stops at the highest allowed value", () => {
    connect(newLamp({ temperatureInKelvin: MAX_KELVIN - KELVIN_STEP }));

    const result = manager.adjustLampsTemperature("all", 3, KELVIN_STEP);

    expect(result.representativeTemperatureKelvin).toBe(MAX_KELVIN);
    expect(result.representativeTemperaturePercentage).toBe(100);
  });

  it("fails without writing when no lamp is connected", () => {
    expect(manager.adjustLampsTemperature("all", 1, KELVIN_STEP)).toEqual({
      ok: false,
      deviceCount: 0,
      failures: 1,
    });
  });
});

describe("adjustLampsTemperature, each lamp from its own (#145)", () => {
  it("steps every lamp from its own temperature, and reports the first lamp's", () => {
    const [first, second] = [newLamp({ temperatureInKelvin: 3100 }), newLamp({ temperatureInKelvin: 4700 })];
    connect(first, second);

    expect(manager.adjustLampsTemperature("all", 2, 200, "each")).toEqual({
      ok: true,
      deviceCount: 2,
      failures: 0,
      representativeTemperatureKelvin: 3500,
      representativeTemperaturePercentage: 21,
    });
    expect([first.writes("temperature"), second.writes("temperature")]).toEqual([[3500], [5100]]);
  });

  it("keeps stepping the other lamps once one reaches an end of its range", () => {
    const [warm, cool] = [newLamp({ temperatureInKelvin: 5700 }), newLamp({ temperatureInKelvin: 6300 })];
    connect(warm, cool);

    manager.adjustLampsTemperature("all", 1, 200, "each");
    manager.adjustLampsTemperature("all", 1, 200, "each");

    expect([warm.temperatureInKelvin, cool.temperatureInKelvin]).toEqual([6100, MAX_KELVIN]);
  });

  it("keeps the lamps' difference through the end of the range, and does nothing once both are there", () => {
    const [warm, cool] = [newLamp({ temperatureInKelvin: 6100 }), newLamp({ temperatureInKelvin: 6300 })];
    connect(warm, cool);
    const temperatures = () => [warm.temperatureInKelvin, cool.temperatureInKelvin];

    manager.adjustLampsTemperature("all", 4, 200, "each");

    expect(temperatures()).toEqual([MAX_KELVIN, MAX_KELVIN]);

    manager.adjustLampsTemperature("all", -1, 200, "each");

    expect(temperatures()).toEqual([6300, MAX_KELVIN]);

    manager.adjustLampsTemperature("all", -1, 200, "each");

    expect(temperatures()).toEqual([6100, 6300]);
  });

  it("steps a lamp set by anything else from where it is, rather than from its position", () => {
    const [warm, cool] = [newLamp({ temperatureInKelvin: 6100 }), newLamp({ temperatureInKelvin: 6300 })];
    connect(warm, cool);
    manager.adjustLampsTemperature("all", 2, 200, "each");

    manager.setLampsTemperature("all", 5000);
    manager.adjustLampsTemperature("all", 1, 200, "each");

    expect([warm.temperatureInKelvin, cool.temperatureInKelvin]).toEqual([5100, 5100]);
  });

  it("steps each lamp along the grid counted from the lowest allowed value (#16)", () => {
    // The default preset, off the 200 K grid that starts at 2700 K, and a lamp on it.
    const [offGrid, onGrid] = [newLamp({ temperatureInKelvin: 4000 }), newLamp({ temperatureInKelvin: 3100 })];
    connect(offGrid, onGrid);

    manager.adjustLampsTemperature("all", 1, 200, "each");

    expect([offGrid.writes("temperature"), onGrid.writes("temperature")]).toEqual([[4100], [3300]]);
  });

  it("fails without writing when no lamp is connected", () => {
    expect(manager.adjustLampsTemperature("all", 1, 200, "each")).toEqual({ ok: false, deviceCount: 0, failures: 1 });
  });
});

describe("findLamps", () => {
  it("lists every lamp by id, with its model and the end of its serial number, sorted by serial number", () => {
    const [second, first] = [
      beam({ serialNumber: "2325FE02BBBB" }),
      new EmulatedLitra("Beam LX", { serialNumber: "2325FE01AAAA" }),
    ];
    connect(second, first);

    expect(manager.findLamps()).toEqual([
      { id: lampId("2325FE01AAAA"), label: "Beam LX - AAAA", model: "Beam LX", serialEnd: "AAAA" },
      { id: lampId("2325FE02BBBB"), label: "Beam - BBBB", model: "Beam", serialEnd: "BBBB" },
    ]);
  });

  it("asks a lamp nothing but the serial number its USB descriptor doesn't give, and closes every handle", () => {
    const pair = [newLamp(), newLamp()];
    connect(...pair);

    manager.findLamps();

    expect(pair.map(asked)).toEqual([[], []]);
    expect(pair.map(closes)).toEqual([1, 1]);
  });

  it("lists none when no lamp is connected, or finding them fails", () => {
    expect(manager.findLamps()).toEqual([]);

    connect(newLamp());
    hid.failFindingLamps(new Error("HID enumeration failed"));

    expect(manager.findLamps()).toEqual([]);
  });
});

describe("readLampStatuses", () => {
  it("reports every lamp sorted by serial number, and closes every handle", async () => {
    const second = beam({ serialNumber: "B2", on: false, brightnessInLumen: lumenAt(50), temperatureInKelvin: 6500 });
    const first = new EmulatedLitra("Beam LX", {
      serialNumber: "A1",
      on: true,
      brightnessInLumen: 400,
      temperatureInKelvin: 2700,
    });
    connect(second, first);

    expect(await manager.readLampStatuses()).toEqual({
      ok: true,
      lamps: [
        {
          id: lampId("A1"),
          serialNumber: "A1",
          model: "Beam LX",
          label: "Beam LX - A1",
          on: true,
          brightnessLumen: 400,
          brightnessPercentage: 100,
          temperatureKelvin: 2700,
        },
        {
          id: lampId("B2"),
          serialNumber: "B2",
          model: "Beam",
          label: "Beam - B2",
          on: false,
          brightnessLumen: lumenAt(50),
          brightnessPercentage: 50,
          temperatureKelvin: 6500,
        },
      ],
    });
    expect([closes(first), closes(second)]).toEqual([1, 1]);
  });

  it("leaves out a lamp that can't be read", async () => {
    const [unreadable, readable] = [newLamp(), newLamp()];
    unreadable.fail("readSync");
    connect(unreadable, readable);

    const result = await manager.readLampStatuses();

    expect(result.ok).toBe(false);
    expect(result.lamps.map((lamp) => lamp.serialNumber)).toEqual([readable.serialNumber]);
  });

  it("reports no lamps when none is connected", async () => {
    expect(await manager.readLampStatuses()).toEqual({ ok: false, lamps: [] });
  });

  it("waits for the brightness change in progress", async () => {
    connect(newLamp());

    const [, statuses] = await settled(
      Promise.all([manager.setLampsBrightness("all", 100), manager.readLampStatuses()]),
    );

    expect(at(statuses.lamps, 0).brightnessLumen).toBe(MAX_LUMEN);
  });
});

describe("identifyLamp", () => {
  const identify = (serialNumber: string) => settled(manager.identifyLamp(lampId(serialNumber), BLINK_MS));

  it("switches a lamp that is on off and back on, and leaves the other lamps alone", async () => {
    const [target, other] = [newLamp({ on: true }), newLamp()];
    connect(other, target);

    expect(await identify(target.serialNumber)).toEqual({ ok: true, deviceCount: 1, failures: 0 });

    expect([target.writes("power"), other.writes("power")]).toEqual([[0, 1], []]);
    expect(target.on).toBe(true);
    expect([closes(target), closes(other)]).toEqual([1, 1]);
  });

  it("switches a lamp that is off on and back off", async () => {
    const lamp = newLamp({ on: false });
    connect(lamp);

    await identify(lamp.serialNumber);

    expect(lamp.writes("power")).toEqual([1, 0]);
    expect(lamp.on).toBe(false);
  });

  it("keeps the lamp switched for the time it's given", async () => {
    const lamp = newLamp({ on: true });
    connect(lamp);

    const blinked = manager.identifyLamp(lampId(lamp.serialNumber), 1000);
    await vi.advanceTimersByTimeAsync(999);

    expect(lamp.writes("power")).toEqual([0]);

    await vi.advanceTimersByTimeAsync(1);

    expect(lamp.writes("power")).toEqual([0, 1]);
    await blinked;
  });

  it("writes no brightness", async () => {
    const lamp = newLamp();
    connect(lamp);

    await identify(lamp.serialNumber);

    expect(lamp.writes("brightness")).toEqual([]);
  });

  it("fails when the lamp isn't connected, and closes the lamps it opened", async () => {
    const other = newLamp();
    connect(other);

    expect(await identify("GONE")).toEqual({ ok: false, deviceCount: 0, failures: 1 });
    expect(other.writes("power")).toEqual([]);
    expect(closes(other)).toBe(1);
  });

  it("fails when the lamp can't be switched, and still closes it", async () => {
    const lamp = newLamp();
    lamp.failWrites("power");
    connect(lamp);

    expect(await identify(lamp.serialNumber)).toEqual({ ok: false, deviceCount: 1, failures: 1 });
    expect(closes(lamp)).toBe(1);
  });

  it("waits for the brightness change in progress", async () => {
    const lamp = newLamp();
    connect(lamp);

    await settled(
      Promise.all([manager.setLampsBrightness("all", 100), manager.identifyLamp(lampId(lamp.serialNumber), BLINK_MS)]),
    );

    // The change reads its lamp back before the blink starts.
    expect(at(positions(lamp, "write", "brightness query"), 0)).toBeLessThan(at(positions(lamp, "write", "power"), 0));
  });
});

describe("readLampsTemperature", () => {
  it("reads only the first lamp, with its place in the range, but closes every handle", async () => {
    const [first, second] = [newLamp({ temperatureInKelvin: 3500 }), newLamp({ temperatureInKelvin: 3500 })];
    connect(first, second);

    expect(await manager.readLampsTemperature("all")).toEqual({
      ok: true,
      deviceCount: 2,
      failures: 0,
      representativeTemperatureKelvin: 3500,
      representativeTemperaturePercentage: 21,
    });
    expect([first.queries("temperature"), second.queries("temperature")]).toEqual([1, 0]);
    expect([closes(first), closes(second)]).toEqual([1, 1]);
  });

  it("reads the lamp with the lowest serial number, whatever order the lamps are found in", async () => {
    const later = newLamp({ serialNumber: "2325FE02BBBB", temperatureInKelvin: 5000 });
    const earlier = newLamp({ serialNumber: "2325FE01AAAA", temperatureInKelvin: 3500 });
    connect(later, earlier);

    expect(await manager.readLampsTemperature("all")).toMatchObject({ representativeTemperatureKelvin: 3500 });
  });

  it("waits for the brightness change in progress", async () => {
    const lamp = newLamp();
    connect(lamp);

    await settled(Promise.all([manager.setLampsBrightness("all", 100), manager.readLampsTemperature("all")]));

    // The change reads its lamp back before the lamps are opened again to read their temperature.
    expect(at(positions(lamp, "write", "brightness query"), -1)).toBeLessThan(
      at(positions(lamp, "write", "temperature query"), -1),
    );
  });
});

//* Logs

describe("logs", () => {
  type Level = "error" | "warn" | "info" | "debug";

  /** How the logs name an emulated lamp: its model and the end of its serial number. */
  function labelOf(lamp: EmulatedLitra): string {
    return `${lamp.model} …${lamp.serialNumber.slice(-4)}`;
  }

  /** The messages logged at a level, each as its arguments joined. */
  function messages(level: Level): string[] {
    return vi.mocked(logger[level]).mock.calls.map((args) => args.map(String).join(" "));
  }

  /** The one message logged at a level, which a test then checks for what it must include. */
  function onlyMessage(level: Level): string {
    expect(messages(level)).toHaveLength(1);
    return at(messages(level), 0);
  }

  /** Runs an operation, letting the time it waits for pass. */
  async function run(operation: () => unknown): Promise<void> {
    await settled(Promise.resolve(operation()));
  }

  /** Every public operation, by the name the logs give it. */
  const OPERATIONS: Array<[string, () => unknown]> = [
    ["turn on", () => manager.turnLampsOn("all")],
    ["turn off", () => manager.turnLampsOff("all")],
    ["toggle", () => manager.toggleLamps("all")],
    ["read power", () => manager.areLampsOn("all")],
    ["set brightness", () => manager.setLampsBrightness("all", 50)],
    ["adjust brightness", () => manager.adjustLampsBrightness("all", 1, 5)],
    ["set scene", () => manager.setLampsScene(everyLampAt(50, 4000))],
    ["read brightness", () => manager.readLampsBrightness("all")],
    ["read lamp status", () => manager.readLampStatuses()],
    ["identify", () => manager.identifyLamp("FAKE9999", BLINK_MS)],
    ["set temperature", () => manager.setLampsTemperature("all", 4000)],
    ["adjust temperature", () => manager.adjustLampsTemperature("all", 1, 100)],
    ["read temperature", () => manager.readLampsTemperature("all")],
  ];

  it.each(OPERATIONS)("warns when %s finds no lamps", async (operation, operate) => {
    await run(operate);

    expect(messages("warn")).toContainEqual(expect.stringContaining(operation));
    expect(logger.error).not.toHaveBeenCalled();
  });

  it.each(OPERATIONS)("logs an error, with the error, when %s can't look for lamps", async (operation, operate) => {
    hid.failFindingLamps(new Error("HID enumeration failed"));

    await run(operate);

    const message = onlyMessage("error");
    expect(message).toContain(operation);
    expect(message).toContain("HID enumeration failed");
  });

  it.each<[string, () => unknown, (lamp: EmulatedLitra) => void, string]>([
    ["turn on", () => manager.turnLampsOn("all"), (lamp) => lamp.failWrites("power"), "write"],
    ["turn off", () => manager.turnLampsOff("all"), (lamp) => lamp.failWrites("power"), "write"],
    ["toggle", () => manager.toggleLamps("all"), (lamp) => lamp.failWrites("power"), "write"],
    ["read power", () => manager.areLampsOn("all"), (lamp) => lamp.fail("readSync"), "read"],
    ["set brightness", () => manager.setLampsBrightness("all", 50), (lamp) => lamp.failWrites("brightness"), "write"],
    [
      "set scene",
      () => manager.setLampsScene(everyLampAt(50, 4000)),
      (lamp) => lamp.failWrites("temperature"),
      "write",
    ],
    [
      "adjust brightness",
      () => manager.adjustLampsBrightness("all", 1, 5),
      (lamp) => lamp.failWrites("brightness"),
      "write",
    ],
    ["read brightness", () => manager.readLampsBrightness("all"), (lamp) => lamp.fail("readSync"), "read"],
    ["read lamp status", () => manager.readLampStatuses(), (lamp) => lamp.fail("readSync"), "read"],
    [
      "set temperature",
      () => manager.setLampsTemperature("all", 4000),
      (lamp) => lamp.failWrites("temperature"),
      "write",
    ],
    [
      "adjust temperature",
      () => manager.adjustLampsTemperature("all", 1, 100),
      (lamp) => lamp.failWrites("temperature"),
      "write",
    ],
    ["read temperature", () => manager.readLampsTemperature("all"), (lamp) => lamp.fail("readSync"), "read"],
  ])("logs an error, with the lamp and the error, when %s fails on a lamp", async (operation, operate, fail, call) => {
    const lamp = newLamp();
    fail(lamp);
    connect(lamp);

    await run(operate);

    const message = onlyMessage("error");
    expect(message).toContain(operation);
    expect(message).toContain(labelOf(lamp));
    expect(message).toContain(call === "write" ? "Cannot write to hid device" : "Cannot read from hid device");
  });

  it("logs an error, with the lamp and the error, when identifying a lamp fails", async () => {
    const lamp = newLamp();
    lamp.fail("readSync");
    connect(lamp);

    await run(() => manager.identifyLamp(lampId(lamp.serialNumber), BLINK_MS));

    const message = onlyMessage("error");
    expect(message).toContain("identify");
    expect(message).toContain(labelOf(lamp));
    expect(message).toContain("Cannot read from hid device");
  });

  it("warns, with the lamp and the error, when a handle fails to close", () => {
    const lamp = newLamp();
    lamp.fail("close");
    connect(lamp);

    manager.turnLampsOn("all");

    const message = onlyMessage("warn");
    expect(message).toContain(labelOf(lamp));
    expect(message).toContain("Cannot close hid device");
  });

  it.each<[string, () => unknown]>([
    ["identify", () => manager.identifyLamp(MISSING_LAMP, BLINK_MS)],
    ["toggle", () => manager.toggleLamps([MISSING_LAMP])],
    ["adjust brightness", () => manager.adjustLampsBrightness([MISSING_LAMP], 1, 5)],
    ["adjust temperature", () => manager.adjustLampsTemperature([MISSING_LAMP], 1, 100)],
    ["set scene", () => manager.setLampsScene([{ lamps: [MISSING_LAMP], on: true, percentage: 50, kelvin: 4000 }])],
  ])("warns, with its id, when the lamp to %s isn't connected", async (operation, operate) => {
    connect(newLamp());

    await run(operate);

    const message = onlyMessage("warn");
    expect(message).toContain(operation);
    expect(message).toContain(MISSING_LAMP);
  });

  it.each<[string, () => unknown]>([
    ["toggle", () => manager.toggleLamps([])],
    ["read power", () => manager.areLampsOn([])],
    ["set brightness", () => manager.setLampsBrightness([], 50)],
    ["read temperature", () => manager.readLampsTemperature([])],
    [
      "set scene",
      () =>
        manager.setLampsScene([
          { lamps: [], on: true, percentage: 50, kelvin: 4000 },
          { lamps: [], on: false, percentage: 0, kelvin: 2700 },
        ]),
    ],
  ])("warns when %s is given no lamp, without looking for any", async (operation, operate) => {
    connect(newLamp());

    await run(operate);

    const message = onlyMessage("warn");
    expect(message).toContain(operation);
    expect(message).toContain("no lamp selected");
    expect(hid.hidEvents()).toEqual([]);
  });

  it.each<[string, () => unknown, string]>([
    ["turn on", () => manager.turnLampsOn("all"), ""],
    ["turn off", () => manager.turnLampsOff("all"), ""],
    ["toggle", () => manager.toggleLamps("all"), ""],
    ["set brightness", () => manager.setLampsBrightness("all", 50), `${lumenAt(50)} lm`],
    // 5% of the lamps' range, as litra rounds it up.
    ["adjust brightness", () => manager.adjustLampsBrightness("all", 1, 5), "49 lm"],
    ["set temperature", () => manager.setLampsTemperature("all", 4000), "4000 K"],
    ["adjust temperature", () => manager.adjustLampsTemperature("all", 1, 100), "4100 K"],
  ])("logs what %s did to each lamp, with the value sent", async (operation, operate, value) => {
    const pair = [newLamp(), newLamp()];
    connect(...pair);

    await run(operate);

    for (const lamp of pair) {
      const message = messages("info").find((candidate) => candidate.includes(labelOf(lamp)));
      expect(message).toContain(operation);
      expect(message).toContain(value);
    }
  });

  it("logs each lamp a scene turns off (#174)", async () => {
    const lamp = newLamp();
    connect(lamp);

    await run(() => manager.setLampsScene([{ lamps: "all", on: false, percentage: 50, kelvin: 4000 }]));

    expect(onlyMessage("info")).toContain(`set scene: ${labelOf(lamp)} turned off`);
  });

  it("logs the lamp it blinked when identifying a lamp", async () => {
    const lamp = newLamp();
    connect(lamp);

    await run(() => manager.identifyLamp(lampId(lamp.serialNumber), BLINK_MS));

    const message = onlyMessage("info");
    expect(message).toContain("identify");
    expect(message).toContain(labelOf(lamp));
  });

  it("logs the brightness a lamp reached, and the cap it learns", async () => {
    const lamp = newLamp({ capInLumen: 250 });
    connect(lamp);

    await run(() => manager.setLampsBrightness("all", 100));

    const lampMessages = messages("info").filter((message) => message.includes(labelOf(lamp)));
    expect(lampMessages).toContainEqual(expect.stringContaining(`${MAX_LUMEN} lm`));
    expect(lampMessages).toContainEqual(expect.stringContaining("capped at 250 lm"));
  });

  it("logs a change that waits for a lamp that can still go back to its cap, and for how long (#55)", async () => {
    connect(newLamp({ capInLumen: 250 }));

    await run(() => Promise.all([manager.setLampsBrightness("all", 100), manager.setLampsBrightness("all", 30)]));

    expect(onlyMessage("debug")).toContain("waiting 1250 ms");
  });

  it("logs a cap forgotten because its lamp was plugged in again, with the lamp and the cap (#55)", async () => {
    const lamp = newLamp({ capInLumen: 250 });
    connect(lamp);
    await run(() => manager.setLampsBrightness("all", 100));
    vi.mocked(logger.info).mockClear();

    const again = newLamp({ serialNumber: lamp.serialNumber });
    connect(again);
    await run(() => manager.setLampsBrightness("all", 100));

    // Sent more than its old cap, the lamp has no other message that mentions it.
    expect(again.writes("brightness")).toEqual([MAX_LUMEN]);
    const forgotten = messages("info").filter((message) => message.includes("250 lm"));
    expect(forgotten).toHaveLength(1);
    expect(at(forgotten, 0)).toContain(labelOf(lamp));
  });

  it("logs a lamp that a brightness change turns on", async () => {
    connect(newLamp({ on: false }));

    await run(() => manager.setLampsBrightness("all", 50));

    expect(messages("info")).toContainEqual(expect.stringContaining("turned on"));
  });

  it.each([
    ["read power", () => manager.areLampsOn("all")],
    ["read brightness", () => manager.readLampsBrightness("all")],
    ["read lamp status", () => manager.readLampStatuses()],
    ["read temperature", () => manager.readLampsTemperature("all")],
  ])("logs what %s read at debug, not info", async (operation, operate) => {
    const lamp = newLamp();
    connect(lamp);

    await run(operate);

    const message = onlyMessage("debug");
    expect(message).toContain(operation);
    expect(message).toContain(labelOf(lamp));
    expect(logger.info).not.toHaveBeenCalled();
  });

  it("never writes a lamp's whole serial number", async () => {
    const lamp = newLamp({ serialNumber: "2325FE01ABCD" });
    lamp.fail("close");
    connect(lamp);

    manager.turnLampsOn("all");
    lamp.failWrites("power");
    manager.turnLampsOff("all");
    await manager.readLampStatuses();

    const everything = (["error", "warn", "info", "debug"] as const).flatMap(messages);
    expect(everything).toContainEqual(expect.stringContaining("…ABCD"));
    expect(everything).not.toContainEqual(expect.stringContaining("2325FE01ABCD"));
  });

  it("logs nothing when there is no ACK to drain", () => {
    const lamp = newLamp();
    lamp.fail("readTimeout");
    connect(lamp);

    manager.turnLampsOn("all");

    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("logs a failed listener with its error, for the stack", async () => {
    const error = new Error("listener broke");
    manager.onLampsChanged(() => {
      throw error;
    });
    connect(newLamp());

    manager.turnLampsOn("all");
    await announced();

    expect(logger.error).toHaveBeenCalledExactlyOnceWith(expect.any(String), error);
  });

  it.each(failedFlushes)("logs a dial flush that %s with its error, for the stack (#46)", async (_how, failing) => {
    const error = new Error("flush broke");
    const debounce = manager.createDialDebouncer(failing(error));

    debounce(1);
    await vi.advanceTimersByTimeAsync(60);

    expect(logger.error).toHaveBeenCalledExactlyOnceWith(expect.any(String), error);
  });
});
