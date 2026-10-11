import {
  type Device,
  DeviceType,
  findDevices,
  getAllowedTemperaturesInKelvinForDevice,
  getMaximumBrightnessInLumenForDevice,
  getMinimumBrightnessInLumenForDevice,
  getTemperatureInKelvin,
  isOn,
  setBrightnessInLumen,
  setTemperatureInKelvin,
  turnOff,
  turnOn,
} from "litra";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import {
  adjustBrightnessAllByPercentageSteps,
  adjustTemperatureAllByKelvinSteps,
  createDialDebouncer,
  forEachDevice,
  forgetBrightnessCaps,
  getBrightnessInLumenSafe,
  isOnAll,
  percentageInRange,
  percentageToLumen,
  readRepresentativeBrightnessPercentage,
  readRepresentativeTemperatureKelvin,
  setBrightnessAllPercentage,
  setTemperatureAllInKelvin,
  snapKelvin,
  stepOnGrid,
  toggleAll,
  turnOffAll,
  turnOnAll,
} from "./litra-manager";
import { createFakeDevice, type FakeDevice } from "./test-support/fake-device";

//* Fakes

// The real SDK creates a logs/ folder on import.
vi.mock("@elgato/streamdeck", () => ({
  default: {
    logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() },
  },
}));

// The real litra loads node-hid's native binary on import and talks to real lamps.
vi.mock("litra", () => ({
  DeviceType: { LitraGlow: "litra_glow", LitraBeam: "litra_beam", LitraBeamLX: "litra_beam_lx" },
  findDevices: vi.fn(),
  getAllowedTemperaturesInKelvinForDevice: vi.fn(),
  getMaximumBrightnessInLumenForDevice: vi.fn(),
  getMinimumBrightnessInLumenForDevice: vi.fn(),
  getTemperatureInKelvin: vi.fn(),
  isOn: vi.fn(),
  setBrightnessInLumen: vi.fn(),
  setTemperatureInKelvin: vi.fn(),
  turnOff: vi.fn(),
  turnOn: vi.fn(),
}));

// The fake lamps are Litra Beams, with the ranges litra reports for one.
const BEAM_MIN_LUMEN = 30;
const BEAM_MAX_LUMEN = 400;
const BEAM_MIN_KELVIN = 2700;
const BEAM_MAX_KELVIN = 6500;
const BEAM_KELVIN_STEP = 100;
const BEAM_ALLOWED_KELVIN = Array.from(
  { length: (BEAM_MAX_KELVIN - BEAM_MIN_KELVIN) / BEAM_KELVIN_STEP + 1 },
  (_, index) => BEAM_MIN_KELVIN + index * BEAM_KELVIN_STEP,
);

function connect(...devices: FakeDevice[]): void {
  vi.mocked(findDevices).mockReturnValue(devices);
}

function beam(brightnessInLumen?: number, capInLumen?: number): FakeDevice {
  return createFakeDevice({ type: DeviceType.LitraBeam, brightnessInLumen, capInLumen });
}

/** Brightness in lumen at the given percentage of the fake lamps' range. */
function lumenAt(percentage: number): number {
  return BEAM_MIN_LUMEN + ((BEAM_MAX_LUMEN - BEAM_MIN_LUMEN) * percentage) / 100;
}

function failFor(target: FakeDevice): (device: Device) => void {
  return (device) => {
    if (device === target) {
      throw new Error("HID write failed");
    }
  };
}

/** Position of a mock's first call among all mock calls, to check the order of calls across mocks. */
function firstCall(mock: Mock): number {
  return mock.mock.invocationCallOrder[0];
}

beforeEach(() => {
  connect();
  forgetBrightnessCaps();
  vi.mocked(isOn).mockReturnValue(true);
  vi.mocked(setBrightnessInLumen).mockImplementation((device, lumen) => (device as FakeDevice).setBrightness(lumen));
  vi.mocked(getMinimumBrightnessInLumenForDevice).mockReturnValue(BEAM_MIN_LUMEN);
  vi.mocked(getMaximumBrightnessInLumenForDevice).mockReturnValue(BEAM_MAX_LUMEN);
  vi.mocked(getAllowedTemperaturesInKelvinForDevice).mockReturnValue(BEAM_ALLOWED_KELVIN);
});

//* Pure functions

describe("percentageInRange", () => {
  it("maps the ends of the range to 0 and 100", () => {
    expect(percentageInRange(BEAM_MIN_LUMEN, BEAM_MIN_LUMEN, BEAM_MAX_LUMEN)).toBe(0);
    expect(percentageInRange(BEAM_MAX_LUMEN, BEAM_MIN_LUMEN, BEAM_MAX_LUMEN)).toBe(100);
  });

  it("maps a value inside the range proportionally, rounded to an integer", () => {
    expect(percentageInRange(215, BEAM_MIN_LUMEN, BEAM_MAX_LUMEN)).toBe(50);
    expect(percentageInRange(100, BEAM_MIN_LUMEN, BEAM_MAX_LUMEN)).toBe(19); // 18.92
    expect(percentageInRange(102, BEAM_MIN_LUMEN, BEAM_MAX_LUMEN)).toBe(19); // 19.46
  });

  it("clamps values outside the range", () => {
    expect(percentageInRange(20, BEAM_MIN_LUMEN, BEAM_MAX_LUMEN)).toBe(0);
    expect(percentageInRange(500, BEAM_MIN_LUMEN, BEAM_MAX_LUMEN)).toBe(100);
  });

  it("returns 0 when the range is empty or inverted", () => {
    expect(percentageInRange(50, 50, 50)).toBe(0);
    expect(percentageInRange(50, 100, 20)).toBe(0);
  });
});

describe("percentageToLumen", () => {
  it("maps 0 and 100 to the ends of the range", () => {
    expect(percentageToLumen(0, BEAM_MIN_LUMEN, BEAM_MAX_LUMEN)).toBe(30);
    expect(percentageToLumen(100, BEAM_MIN_LUMEN, BEAM_MAX_LUMEN)).toBe(400);
  });

  it("rounds up, like litra", () => {
    expect(percentageToLumen(70, BEAM_MIN_LUMEN, BEAM_MAX_LUMEN)).toBe(289);
    expect(percentageToLumen(33, BEAM_MIN_LUMEN, BEAM_MAX_LUMEN)).toBe(153);
  });

  it("uses the range it's given", () => {
    // A Litra Glow's range.
    expect(percentageToLumen(50, 20, 250)).toBe(135);
  });
});

describe("snapKelvin", () => {
  it("keeps an allowed value", () => {
    expect(snapKelvin(3000, BEAM_ALLOWED_KELVIN)).toBe(3000);
  });

  it("snaps to the nearest allowed value", () => {
    expect(snapKelvin(3140, BEAM_ALLOWED_KELVIN)).toBe(3100);
    expect(snapKelvin(3160, BEAM_ALLOWED_KELVIN)).toBe(3200);
  });

  it("snaps a tie to the value listed first", () => {
    expect(snapKelvin(3150, BEAM_ALLOWED_KELVIN)).toBe(3100);
    expect(snapKelvin(3150, BEAM_ALLOWED_KELVIN.toReversed())).toBe(3200);
  });

  it("snaps values outside the range to its ends", () => {
    expect(snapKelvin(1000, BEAM_ALLOWED_KELVIN)).toBe(BEAM_MIN_KELVIN);
    expect(snapKelvin(9000, BEAM_ALLOWED_KELVIN)).toBe(BEAM_MAX_KELVIN);
  });

  it("accepts an unsorted list", () => {
    expect(snapKelvin(2800, [6500, 2700, 4000])).toBe(2700);
  });

  it("returns the value unchanged when nothing is allowed", () => {
    expect(snapKelvin(3123, [])).toBe(3123);
  });
});

describe("stepOnGrid", () => {
  it("moves a value on the grid by whole steps, either way", () => {
    expect(stepOnGrid(50, 2, 5, 0, 100)).toBe(60);
    expect(stepOnGrid(50, -3, 5, 0, 100)).toBe(35);
  });

  it("counts the grid from the minimum", () => {
    expect(stepOnGrid(BEAM_MIN_KELVIN, 1, 500, BEAM_MIN_KELVIN, BEAM_MAX_KELVIN)).toBe(3200);
    expect(stepOnGrid(3200, 2, 500, BEAM_MIN_KELVIN, BEAM_MAX_KELVIN)).toBe(4200);
  });

  it("clamps to the range", () => {
    expect(stepOnGrid(90, 5, 10, 0, 100)).toBe(100);
    expect(stepOnGrid(10, -5, 10, 0, 100)).toBe(0);
  });

  it("takes a value off the grid to the next grid value in the direction of the turn", () => {
    // The 79% cap of a Beam on the Stream Deck + XL's hub, with a 5% step.
    expect(stepOnGrid(79, 1, 5, 0, 100)).toBe(80);
    expect(stepOnGrid(79, -1, 5, 0, 100)).toBe(75);
    expect(stepOnGrid(77, -1, 5, 0, 100)).toBe(75);
    expect(stepOnGrid(79, -2, 5, 0, 100)).toBe(70);
  });

  it("goes down through the values it went up through, when the step doesn't divide the range (#14, #16)", () => {
    const up = [0];
    while (up[up.length - 1] < 100) {
      up.push(stepOnGrid(up[up.length - 1], 1, 7, 0, 100));
    }
    const down = [100];
    while (down[down.length - 1] > 0) {
      down.push(stepOnGrid(down[down.length - 1], -1, 7, 0, 100));
    }

    expect(up).toEqual([0, 7, 14, 21, 28, 35, 42, 49, 56, 63, 70, 77, 84, 91, 98, 100]);
    expect(down).toEqual(up.toReversed());
  });

  it("goes down from the clamped top to the grid, when the step doesn't divide the range", () => {
    expect(stepOnGrid(BEAM_MAX_KELVIN, -1, 500, BEAM_MIN_KELVIN, BEAM_MAX_KELVIN)).toBe(6200);
    expect(stepOnGrid(BEAM_MAX_KELVIN, -1, 300, BEAM_MIN_KELVIN, BEAM_MAX_KELVIN)).toBe(6300);
  });

  it("only clamps the value when there are no ticks or the step isn't positive", () => {
    expect(stepOnGrid(79, 0, 5, 0, 100)).toBe(79);
    expect(stepOnGrid(79, 2, 0, 0, 100)).toBe(79);
    expect(stepOnGrid(79, 2, Number.NaN, 0, 100)).toBe(79);
    expect(stepOnGrid(120, 0, 5, 0, 100)).toBe(100);
  });
});

describe("createDialDebouncer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flushes once, 60 ms after the last tick", async () => {
    const flush = vi.fn();
    const debounce = createDialDebouncer(flush);

    debounce(1);
    await vi.advanceTimersByTimeAsync(59);
    expect(flush).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(flush).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledWith(1);
  });

  it("sums the ticks received within the window", async () => {
    const flush = vi.fn();
    const debounce = createDialDebouncer(flush);

    debounce(1);
    debounce(2);
    debounce(-1);
    await vi.advanceTimersByTimeAsync(60);

    expect(flush).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledWith(2);
  });

  it("restarts the window on every tick", async () => {
    const flush = vi.fn();
    const debounce = createDialDebouncer(flush);

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
    const debounce = createDialDebouncer(flush);

    debounce(3);
    await vi.advanceTimersByTimeAsync(60);
    debounce(1);
    await vi.advanceTimersByTimeAsync(60);

    expect(flush.mock.calls).toEqual([[3], [1]]);
  });

  it("uses the given delay", async () => {
    const flush = vi.fn();
    const debounce = createDialDebouncer(flush, 200);

    debounce(1);
    await vi.advanceTimersByTimeAsync(199);
    expect(flush).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(flush).toHaveBeenCalledOnce();
  });

  it("waits for a running flush, then flushes every tick received meanwhile at once", async () => {
    const flush = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 300)));
    const debounce = createDialDebouncer(flush);

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

  it("keeps flushing after a flush fails", async () => {
    const flush = vi.fn().mockRejectedValueOnce(new Error("HID write failed"));
    const debounce = createDialDebouncer(flush);

    debounce(1);
    await vi.advanceTimersByTimeAsync(60);
    debounce(1);
    await vi.advanceTimersByTimeAsync(60);

    expect(flush).toHaveBeenCalledTimes(2);
  });
});

//* HID parsing

describe("getBrightnessInLumenSafe", () => {
  it.each([
    [DeviceType.LitraGlow, 0x04],
    [DeviceType.LitraBeam, 0x04],
    [DeviceType.LitraBeamLX, 0x06],
  ])("sends the brightness query for a %s as a 20-byte report", (type, featureIndex) => {
    const device = createFakeDevice({ type });

    getBrightnessInLumenSafe(device);

    expect(device.hid.write).toHaveBeenCalledWith([0x11, 0xff, featureIndex, 0x31, ...Array(16).fill(0)]);
  });

  it("reads the brightness from two bytes, so values above 255 survive", () => {
    expect(getBrightnessInLumenSafe(beam(400))).toBe(400);
    expect(getBrightnessInLumenSafe(beam(30))).toBe(30);
  });

  it("skips the reports a lamp sends unasked, ahead of the reply", () => {
    const device = beam(244);
    // A set-brightness ACK, a change notice and an error report, as a capped Beam sends them.
    device.queueReport([0x11, 0xff, 0x04, 0x4c, ...Array(16).fill(0)]);
    device.queueReport([0x11, 0xff, 0x04, 0x40, 0x01, 0x00, 0xf4, ...Array(13).fill(0)]);
    device.queueReport([0x11, 0xff, 0xff, 0x04, 0x4c, 0x02, ...Array(14).fill(0)]);

    expect(getBrightnessInLumenSafe(device)).toBe(244);
  });

  it("gives up when the reply doesn't come", () => {
    const device = beam();
    device.hid.readSync.mockReturnValue([0x11, 0xff, 0x04, 0x40, 0x01, 0x00, 0xf4, ...Array(13).fill(0)]);

    expect(() => getBrightnessInLumenSafe(device)).toThrow("No brightness reply");
  });
});

//* Broadcasting to lamps

describe("forEachDevice", () => {
  it("fails without running the operation when no lamp is connected", () => {
    const operation = vi.fn();

    expect(forEachDevice(operation)).toEqual({ ok: false, deviceCount: 0, failures: 1 });
    expect(operation).not.toHaveBeenCalled();
  });

  it("fails without running the operation when finding the lamps throws", () => {
    vi.mocked(findDevices).mockImplementation(() => {
      throw new Error("HID enumeration failed");
    });
    const operation = vi.fn();

    expect(forEachDevice(operation)).toEqual({ ok: false, deviceCount: 0, failures: 1 });
    expect(operation).not.toHaveBeenCalled();
  });

  it("runs the operation once on every lamp", () => {
    const first = beam();
    const second = beam();
    connect(first, second);
    const operation = vi.fn();

    expect(forEachDevice(operation)).toEqual({ ok: true, deviceCount: 2, failures: 0 });
    expect(operation.mock.calls).toEqual([[first], [second]]);
  });

  it("keeps going when a lamp fails, and counts the failure", () => {
    const first = beam();
    const second = beam();
    connect(first, second);
    const operation = vi.fn(failFor(first));

    expect(forEachDevice(operation)).toEqual({ ok: false, deviceCount: 2, failures: 1 });
    expect(operation).toHaveBeenCalledWith(second);
  });

  it("closes every lamp's handle after its operation, including a failed one", () => {
    const first = beam();
    const second = beam();
    connect(first, second);
    const operation = vi.fn(failFor(first));

    forEachDevice(operation);

    for (const device of [first, second]) {
      expect(device.hid.close).toHaveBeenCalledOnce();
    }
    expect(firstCall(first.hid.close)).toBeLessThan(operation.mock.invocationCallOrder[1]);
  });

  it("ignores a handle that fails to close", () => {
    const first = beam();
    const second = beam();
    first.hid.close.mockImplementation(() => {
      throw new Error("already closed");
    });
    connect(first, second);
    const operation = vi.fn();

    expect(forEachDevice(operation)).toEqual({ ok: true, deviceCount: 2, failures: 0 });
    expect(operation).toHaveBeenCalledWith(second);
  });
});

describe.each([
  ["turnOnAll", turnOnAll, turnOn],
  ["turnOffAll", turnOffAll, turnOff],
])("%s", (_name, broadcast, command) => {
  it("sends the command to every lamp, then drains its ACK", () => {
    const first = beam();
    const second = beam();
    connect(first, second);

    expect(broadcast()).toEqual({ ok: true, deviceCount: 2, failures: 0 });
    expect(vi.mocked(command).mock.calls).toEqual([[first], [second]]);
    expect(firstCall(vi.mocked(command))).toBeLessThan(firstCall(first.hid.readTimeout));
    expect(second.hid.readTimeout).toHaveBeenCalledOnce();
  });

  it("succeeds when there is no ACK to drain", () => {
    const device = beam();
    device.hid.readTimeout.mockImplementation(() => {
      throw new Error("timed out");
    });
    connect(device);

    expect(broadcast()).toEqual({ ok: true, deviceCount: 1, failures: 0 });
  });

  it("reports a lamp that fails", () => {
    const first = beam();
    connect(first, beam());
    vi.mocked(command).mockImplementation(failFor(first));

    expect(broadcast()).toEqual({ ok: false, deviceCount: 2, failures: 1 });
  });
});

describe("toggleAll", () => {
  it("turns every lamp off when every lamp is on, then drains each ACK", () => {
    const first = beam();
    const second = beam();
    connect(first, second);

    expect(toggleAll()).toEqual({ ok: true, deviceCount: 2, failures: 0 });
    expect(vi.mocked(turnOff).mock.calls).toEqual([[first], [second]]);
    expect(turnOn).not.toHaveBeenCalled();
    expect(firstCall(vi.mocked(turnOff))).toBeLessThan(firstCall(first.hid.readTimeout));
    expect(second.hid.readTimeout).toHaveBeenCalledOnce();
  });

  it("turns every lamp on when one is on and one is off", () => {
    const first = beam();
    const second = beam();
    connect(first, second);
    vi.mocked(isOn).mockImplementation((device) => device === first);

    expect(toggleAll()).toEqual({ ok: true, deviceCount: 2, failures: 0 });
    expect(vi.mocked(turnOn).mock.calls).toEqual([[first], [second]]);
    expect(turnOff).not.toHaveBeenCalled();
  });

  it("turns every lamp on when every lamp is off", () => {
    const first = beam();
    const second = beam();
    connect(first, second);
    vi.mocked(isOn).mockReturnValue(false);

    expect(toggleAll()).toEqual({ ok: true, deviceCount: 2, failures: 0 });
    expect(vi.mocked(turnOn).mock.calls).toEqual([[first], [second]]);
  });

  it("reads every lamp before sending any command", () => {
    connect(beam(), beam());

    toggleAll();

    expect(vi.mocked(isOn).mock.invocationCallOrder[1]).toBeLessThan(firstCall(vi.mocked(turnOff)));
  });

  it("counts a lamp that can't be read as off, and still turns it on", () => {
    const first = beam();
    const second = beam();
    connect(first, second);
    vi.mocked(isOn).mockImplementation((device) => {
      failFor(first)(device);
      return true;
    });

    expect(toggleAll()).toEqual({ ok: false, deviceCount: 2, failures: 1 });
    expect(vi.mocked(turnOn).mock.calls).toEqual([[first], [second]]);
  });

  it("counts a lamp once when it can't be read nor written", () => {
    const first = beam();
    connect(first, beam());
    vi.mocked(isOn).mockImplementation((device) => {
      failFor(first)(device);
      return true;
    });
    vi.mocked(turnOn).mockImplementation(failFor(first));

    expect(toggleAll()).toEqual({ ok: false, deviceCount: 2, failures: 1 });
  });

  it("reports a lamp that fails, and still sends the command to the others", () => {
    const first = beam();
    const second = beam();
    connect(first, second);
    vi.mocked(turnOff).mockImplementation(failFor(first));

    expect(toggleAll()).toEqual({ ok: false, deviceCount: 2, failures: 1 });
    expect(turnOff).toHaveBeenCalledWith(second);
  });

  it("closes every handle, including a failed lamp's", () => {
    const first = beam();
    const second = beam();
    connect(first, second);
    vi.mocked(turnOff).mockImplementation(failFor(first));

    toggleAll();

    expect(first.hid.close).toHaveBeenCalledOnce();
    expect(second.hid.close).toHaveBeenCalledOnce();
  });

  it("succeeds when there is no ACK to drain", () => {
    const device = beam();
    device.hid.readTimeout.mockImplementation(() => {
      throw new Error("timed out");
    });
    connect(device);

    expect(toggleAll()).toEqual({ ok: true, deviceCount: 1, failures: 0 });
  });

  it("fails when no lamp is connected", () => {
    expect(toggleAll()).toEqual({ ok: false, deviceCount: 0, failures: 1 });
    expect(turnOn).not.toHaveBeenCalled();
    expect(turnOff).not.toHaveBeenCalled();
  });
});

describe("isOnAll", () => {
  it("reports on when every lamp is on", () => {
    connect(beam(), beam());

    expect(isOnAll()).toEqual({ ok: true, allOn: true, deviceCount: 2 });
  });

  it("reports off when at least one lamp is off", () => {
    const first = beam();
    connect(first, beam());
    vi.mocked(isOn).mockImplementation((device) => device === first);

    expect(isOnAll()).toEqual({ ok: true, allOn: false, deviceCount: 2 });
  });

  it("fails and reports off when no lamp is connected", () => {
    expect(isOnAll()).toEqual({ ok: false, allOn: false, deviceCount: 0 });
  });

  it("fails and reports off when finding the lamps throws", () => {
    vi.mocked(findDevices).mockImplementation(() => {
      throw new Error("HID enumeration failed");
    });

    expect(isOnAll()).toEqual({ ok: false, allOn: false, deviceCount: 0 });
  });

  it("fails and reports off when a lamp can't be read, but still closes every handle", () => {
    const first = beam();
    const second = beam();
    connect(first, second);
    vi.mocked(isOn).mockImplementation((device) => {
      failFor(first)(device);
      return true;
    });

    expect(isOnAll()).toEqual({ ok: false, allOn: false, deviceCount: 2 });
    expect(first.hid.close).toHaveBeenCalledOnce();
    expect(second.hid.close).toHaveBeenCalledOnce();
  });
});

describe("setBrightnessAllPercentage", () => {
  // Without waiting for the lamps to settle: the fake lamps apply a write at once.
  const set = (percentage: number) => setBrightnessAllPercentage(percentage, 0);

  it("sets every lamp to the percentage and reports it, with its lumens", async () => {
    const first = beam();
    const second = beam();
    connect(first, second);

    expect(await set(40)).toEqual({
      ok: true,
      deviceCount: 2,
      failures: 0,
      representativeBrightnessPercentage: 40,
      representativeBrightnessLumen: 178,
    });
    expect(vi.mocked(setBrightnessInLumen).mock.calls).toEqual([
      [first, 178],
      [second, 178],
    ]);
  });

  it("clamps the percentage to 0-100", async () => {
    connect(beam());

    expect((await set(150)).representativeBrightnessPercentage).toBe(100);
    expect((await set(-10)).representativeBrightnessPercentage).toBe(0);
    expect(vi.mocked(setBrightnessInLumen).mock.calls.map(([, lumen]) => lumen)).toEqual([
      BEAM_MAX_LUMEN,
      BEAM_MIN_LUMEN,
    ]);
  });

  it("reports the brightness the lamps reached, not the percentage asked for (#29)", async () => {
    // On the Stream Deck + XL's USB hub, a Beam stops below what it's asked for.
    connect(beam(BEAM_MIN_LUMEN, 244), beam(BEAM_MIN_LUMEN, 324));

    const result = await set(100);

    expect(result.representativeBrightnessPercentage).toBe(79);
    expect(result.representativeBrightnessLumen).toBe(324);
  });

  it("learns a lamp's cap, and sends it no more than its cap afterwards", async () => {
    const capped = beam(BEAM_MIN_LUMEN, 244);
    const uncapped = beam();
    connect(capped, uncapped);

    await set(100);
    vi.mocked(setBrightnessInLumen).mockClear();
    await set(90);

    expect(vi.mocked(setBrightnessInLumen).mock.calls).toEqual([
      [capped, 244],
      [uncapped, lumenAt(90)],
    ]);
  });

  it("sends a lamp no more than a cap the dial learned", async () => {
    const capped = beam(BEAM_MIN_LUMEN, 244);
    connect(capped);
    await adjustBrightnessAllByPercentageSteps(20, 5, 0);
    vi.mocked(setBrightnessInLumen).mockClear();

    await set(100);

    expect(vi.mocked(setBrightnessInLumen).mock.calls).toEqual([[capped, 244]]);
  });

  it("waits for the lamps to settle before reading them back", async () => {
    vi.useFakeTimers();
    try {
      const device = beam();
      connect(device);

      const result = setBrightnessAllPercentage(40);
      await vi.advanceTimersByTimeAsync(249);
      expect(device.hid.readSync).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1);
      await result;
      expect(device.hid.readSync).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("turns a lamp that is off on before changing its brightness", async () => {
    const device = beam();
    connect(device);
    vi.mocked(isOn).mockReturnValue(false);

    await set(40);

    expect(turnOn).toHaveBeenCalledWith(device);
    expect(firstCall(vi.mocked(turnOn))).toBeLessThan(firstCall(vi.mocked(setBrightnessInLumen)));
  });

  it("leaves a lamp that is on as it is", async () => {
    connect(beam());
    vi.mocked(isOn).mockReturnValue(true);

    await set(40);

    expect(turnOn).not.toHaveBeenCalled();
  });

  it("reports the lamps that succeeded when some fail, and closes every handle", async () => {
    const first = beam();
    const second = beam();
    connect(first, second);
    vi.mocked(setBrightnessInLumen).mockImplementation((device, lumen) => {
      failFor(first)(device);
      (device as FakeDevice).setBrightness(lumen);
    });

    expect(await set(40)).toEqual({
      ok: false,
      deviceCount: 2,
      failures: 1,
      representativeBrightnessPercentage: 40,
      representativeBrightnessLumen: 178,
    });
    expect(first.hid.close).toHaveBeenCalledOnce();
    expect(second.hid.close).toHaveBeenCalledOnce();
  });

  it("fails without writing, and reports no percentage or lumens, when no lamp is connected", async () => {
    expect(await set(40)).toEqual({ ok: false, deviceCount: 0, failures: 1 });
    expect(setBrightnessInLumen).not.toHaveBeenCalled();
  });
});

describe("brightness changes", () => {
  it("run one at a time, in the order they were asked for", async () => {
    const device = beam();
    connect(device);

    await Promise.all([setBrightnessAllPercentage(100, 0), setBrightnessAllPercentage(20, 0)]);

    // The lamp is read back after each change, before the next one is written.
    expect(vi.mocked(setBrightnessInLumen).mock.calls).toEqual([
      [device, BEAM_MAX_LUMEN],
      [device, lumenAt(20)],
    ]);
    expect(device.hid.readSync.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(setBrightnessInLumen).mock.invocationCallOrder[1],
    );
  });

  it("don't take a later change's lower brightness for a cap", async () => {
    const device = beam();
    connect(device);
    await Promise.all([setBrightnessAllPercentage(100, 0), adjustBrightnessAllByPercentageSteps(-16, 5, 0)]);
    vi.mocked(setBrightnessInLumen).mockClear();

    await setBrightnessAllPercentage(100, 0);

    expect(setBrightnessInLumen).toHaveBeenCalledWith(device, BEAM_MAX_LUMEN);
  });
});

describe("adjustBrightnessAllByPercentageSteps", () => {
  // Without waiting for the lamps to settle: the fake lamps apply a write at once.
  const adjust = (ticks: number, stepPercentage: number) =>
    adjustBrightnessAllByPercentageSteps(ticks, stepPercentage, 0);

  it("moves every lamp to one target, stepped from the brightest lamp", async () => {
    const first = beam(lumenAt(20));
    const second = beam(lumenAt(50));
    connect(first, second);

    expect(await adjust(2, 5)).toEqual({
      ok: true,
      deviceCount: 2,
      failures: 0,
      representativeBrightnessPercentage: 60,
      representativeBrightnessLumen: lumenAt(60),
    });
    expect(vi.mocked(setBrightnessInLumen).mock.calls).toEqual([
      [first, lumenAt(60)],
      [second, lumenAt(60)],
    ]);
  });

  it("moves down for negative ticks", async () => {
    const device = beam(lumenAt(50));
    connect(device);

    await adjust(-3, 10);

    expect(setBrightnessInLumen).toHaveBeenCalledWith(device, lumenAt(20));
  });

  it("clamps the target to 0-100", async () => {
    const bright = beam(lumenAt(90));
    const dim = beam(lumenAt(10));

    connect(bright);
    await adjust(5, 10);
    connect(dim);
    await adjust(-5, 10);

    expect(vi.mocked(setBrightnessInLumen).mock.calls).toEqual([
      [bright, BEAM_MAX_LUMEN],
      [dim, BEAM_MIN_LUMEN],
    ]);
  });

  it("steps from a brightness off the step's multiples to the next one in the direction of the turn", async () => {
    // 33%, set by a key.
    const goingUp = beam(153);
    const goingDown = beam(153);

    connect(goingUp);
    await adjust(1, 20);
    connect(goingDown);
    await adjust(-1, 20);

    expect(vi.mocked(setBrightnessInLumen).mock.calls).toEqual([
      [goingUp, lumenAt(40)],
      [goingDown, lumenAt(20)],
    ]);
  });

  it("steps down from a lamp's cap to the multiple of the step below it (#14)", async () => {
    // A Beam capped at 70% on the Stream Deck + XL's USB hub, turned up past it with a 20% step.
    const device = beam(lumenAt(60), lumenAt(70));
    connect(device);

    await adjust(1, 20);
    await adjust(-1, 20);

    expect(vi.mocked(setBrightnessInLumen).mock.calls).toEqual([
      [device, lumenAt(80)],
      [device, lumenAt(60)],
    ]);
  });

  it("reports the brightness the lamp reached, not the one requested (#13)", async () => {
    // On the Stream Deck + XL's USB hub, a Beam stops below what it's asked for.
    const device = beam(lumenAt(70), lumenAt(70));
    connect(device);

    const result = await adjust(4, 5);

    expect(setBrightnessInLumen).toHaveBeenCalledWith(device, lumenAt(90));
    expect(result.representativeBrightnessPercentage).toBe(70);
    expect(result.representativeBrightnessLumen).toBe(lumenAt(70));
  });

  it("reports the brightest lamp when the lamps reach different brightnesses", async () => {
    connect(beam(BEAM_MIN_LUMEN, 244), beam(BEAM_MIN_LUMEN, 324));

    const result = await adjust(20, 5);

    expect(result.representativeBrightnessPercentage).toBe(79);
    expect(result.representativeBrightnessLumen).toBe(324);
  });

  it("learns a lamp's cap, and sends it no more than its cap afterwards", async () => {
    const capped = beam(BEAM_MIN_LUMEN, 244);
    const uncapped = beam();
    connect(capped, uncapped);

    await adjust(20, 5);
    vi.mocked(setBrightnessInLumen).mockClear();
    await adjust(-2, 5);

    expect(vi.mocked(setBrightnessInLumen).mock.calls).toEqual([
      [capped, 244],
      [uncapped, lumenAt(90)],
    ]);
  });

  it("keeps a learned cap per lamp", async () => {
    const capped = beam(BEAM_MIN_LUMEN, 244);
    connect(capped);
    await adjust(20, 5);

    const other = beam();
    connect(other);
    await adjust(20, 5);

    expect(setBrightnessInLumen).toHaveBeenLastCalledWith(other, BEAM_MAX_LUMEN);
  });

  it("waits for the lamps to settle before reading them back", async () => {
    vi.useFakeTimers();
    try {
      const device = beam();
      connect(device);

      const result = adjustBrightnessAllByPercentageSteps(1, 10);
      await vi.advanceTimersByTimeAsync(249);
      expect(device.hid.readSync).toHaveBeenCalledOnce();

      await vi.advanceTimersByTimeAsync(1);
      await result;
      expect(device.hid.readSync).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("turns a lamp that is off on before changing its brightness", async () => {
    const device = beam(lumenAt(50));
    connect(device);
    vi.mocked(isOn).mockReturnValue(false);

    await adjust(1, 5);

    expect(turnOn).toHaveBeenCalledWith(device);
    expect(firstCall(vi.mocked(turnOn))).toBeLessThan(firstCall(vi.mocked(setBrightnessInLumen)));
  });

  it("keeps going when a lamp fails, counts it once, and closes every handle", async () => {
    const first = beam(lumenAt(50));
    const second = beam(lumenAt(50));
    connect(first, second);
    vi.mocked(setBrightnessInLumen).mockImplementation((device, lumen) => {
      failFor(first)(device);
      (device as FakeDevice).setBrightness(lumen);
    });

    expect(await adjust(2, 5)).toEqual({
      ok: false,
      deviceCount: 2,
      failures: 1,
      representativeBrightnessPercentage: 60,
      representativeBrightnessLumen: lumenAt(60),
    });
    expect(first.hid.close).toHaveBeenCalledOnce();
    expect(second.hid.close).toHaveBeenCalledOnce();
  });

  it("fails without writing when no lamp is connected", async () => {
    expect(await adjust(1, 5)).toEqual({ ok: false, deviceCount: 0, failures: 1 });
    expect(setBrightnessInLumen).not.toHaveBeenCalled();
  });
});

describe("readRepresentativeBrightnessPercentage", () => {
  it("reads every lamp and reports the brightest, with its lumens", () => {
    const first = beam(lumenAt(20));
    const second = beam(lumenAt(50));
    connect(first, second);

    expect(readRepresentativeBrightnessPercentage()).toEqual({
      ok: true,
      deviceCount: 2,
      failures: 0,
      representativeBrightnessPercentage: 50,
      representativeBrightnessLumen: lumenAt(50),
    });
    expect(first.hid.close).toHaveBeenCalledOnce();
    expect(second.hid.close).toHaveBeenCalledOnce();
  });

  it("reports the lamps it could read when one can't be read", () => {
    const first = beam(lumenAt(50));
    first.hid.readSync.mockImplementation(() => {
      throw new Error("HID read failed");
    });
    connect(first, beam(lumenAt(20)));

    expect(readRepresentativeBrightnessPercentage()).toEqual({
      ok: false,
      deviceCount: 2,
      failures: 1,
      representativeBrightnessPercentage: 20,
      representativeBrightnessLumen: lumenAt(20),
    });
  });
});

describe("setTemperatureAllInKelvin", () => {
  it("sets every lamp to the temperature, snapped to an allowed value, and reports it and its %", () => {
    const first = beam();
    const second = beam();
    connect(first, second);

    expect(setTemperatureAllInKelvin(4321)).toEqual({
      ok: true,
      deviceCount: 2,
      failures: 0,
      representativeTemperatureKelvin: 4300,
      representativeTemperaturePercentage: 42,
    });
    expect(vi.mocked(setTemperatureInKelvin).mock.calls).toEqual([
      [first, 4300],
      [second, 4300],
    ]);
  });

  it("drains each lamp's ACK", () => {
    const device = beam();
    connect(device);

    setTemperatureAllInKelvin(3000);

    expect(device.hid.readTimeout).toHaveBeenCalledOnce();
  });
});

describe("adjustTemperatureAllByKelvinSteps", () => {
  it("moves every lamp to one target, stepped from the first lamp's temperature, and reports it", () => {
    const first = beam();
    const second = beam();
    connect(first, second);
    vi.mocked(getTemperatureInKelvin).mockImplementation((device) => (device === first ? 3100 : 2700));

    // 2 ticks of 200 K, one of the dial's step options.
    expect(adjustTemperatureAllByKelvinSteps(2, 200)).toEqual({
      ok: true,
      deviceCount: 2,
      failures: 0,
      representativeTemperatureKelvin: 3500,
      representativeTemperaturePercentage: 21,
    });
    expect(vi.mocked(setTemperatureInKelvin).mock.calls).toEqual([
      [first, 3500],
      [second, 3500],
    ]);
    expect(getTemperatureInKelvin).toHaveBeenCalledOnce();
  });

  it("steps along the grid counted from the lowest allowed value (#16)", () => {
    connect(beam());
    // The default preset, off the 200 K grid that starts at 2700 K.
    vi.mocked(getTemperatureInKelvin).mockReturnValue(4000);

    adjustTemperatureAllByKelvinSteps(1, 200);
    adjustTemperatureAllByKelvinSteps(-1, 200);

    expect(vi.mocked(setTemperatureInKelvin).mock.calls.map(([, kelvin]) => kelvin)).toEqual([4100, 3900]);
  });

  it("steps down from the highest allowed value to the grid, when the step doesn't divide the range (#16)", () => {
    connect(beam());
    vi.mocked(getTemperatureInKelvin).mockReturnValue(BEAM_MAX_KELVIN);

    expect(adjustTemperatureAllByKelvinSteps(-1, 500).representativeTemperatureKelvin).toBe(6200);
  });

  it("steps from the next lamp when the first can't be read", () => {
    const first = beam();
    const second = beam();
    connect(first, second);
    vi.mocked(getTemperatureInKelvin).mockImplementation((device) => {
      if (device === first) {
        throw new Error("HID read failed");
      }
      return 3000;
    });

    expect(adjustTemperatureAllByKelvinSteps(1, 100)).toEqual({
      ok: false,
      deviceCount: 2,
      failures: 1,
      representativeTemperatureKelvin: 3100,
      representativeTemperaturePercentage: 11,
    });
    expect(vi.mocked(setTemperatureInKelvin).mock.calls).toEqual([[second, 3100]]);
  });

  it("moves down for negative ticks, and stops at the lowest allowed value", () => {
    connect(beam());
    vi.mocked(getTemperatureInKelvin).mockReturnValue(3000);

    const result = adjustTemperatureAllByKelvinSteps(-10, BEAM_KELVIN_STEP);

    expect(result.representativeTemperatureKelvin).toBe(BEAM_MIN_KELVIN);
    expect(result.representativeTemperaturePercentage).toBe(0);
  });

  it("stops at the highest allowed value", () => {
    connect(beam());
    vi.mocked(getTemperatureInKelvin).mockReturnValue(BEAM_MAX_KELVIN - BEAM_KELVIN_STEP);

    const result = adjustTemperatureAllByKelvinSteps(3, BEAM_KELVIN_STEP);

    expect(result.representativeTemperatureKelvin).toBe(BEAM_MAX_KELVIN);
    expect(result.representativeTemperaturePercentage).toBe(100);
  });
});

describe("readRepresentativeTemperatureKelvin", () => {
  it("reads only the first lamp, with its place in the range, but closes every handle", () => {
    const first = beam();
    const second = beam();
    connect(first, second);
    vi.mocked(getTemperatureInKelvin).mockReturnValue(3500);

    expect(readRepresentativeTemperatureKelvin()).toEqual({
      ok: true,
      deviceCount: 2,
      failures: 0,
      representativeTemperatureKelvin: 3500,
      representativeTemperaturePercentage: 21,
    });
    expect(vi.mocked(getTemperatureInKelvin).mock.calls).toEqual([[first]]);
    expect(first.hid.close).toHaveBeenCalledOnce();
    expect(second.hid.close).toHaveBeenCalledOnce();
  });
});
