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
  toggle,
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
  toggle: vi.fn(),
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
  ["toggleAll", toggleAll, toggle],
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
  it("sets every lamp to the percentage and reports it, with its lumens", () => {
    const first = beam();
    const second = beam();
    connect(first, second);

    expect(setBrightnessAllPercentage(40)).toEqual({
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

  it("clamps the percentage to 0-100", () => {
    connect(beam());

    expect(setBrightnessAllPercentage(150).representativeBrightnessPercentage).toBe(100);
    expect(setBrightnessAllPercentage(-10).representativeBrightnessPercentage).toBe(0);
    expect(vi.mocked(setBrightnessInLumen).mock.calls.map(([, lumen]) => lumen)).toEqual([
      BEAM_MAX_LUMEN,
      BEAM_MIN_LUMEN,
    ]);
  });

  it("sends a lamp no more than its learned cap, but reports the percentage asked for", async () => {
    const capped = beam(BEAM_MIN_LUMEN, 244);
    const uncapped = beam();
    connect(capped, uncapped);
    await adjustBrightnessAllByPercentageSteps(20, 5, 0);
    vi.mocked(setBrightnessInLumen).mockClear();

    expect(setBrightnessAllPercentage(100).representativeBrightnessPercentage).toBe(100);
    expect(vi.mocked(setBrightnessInLumen).mock.calls).toEqual([
      [capped, 244],
      [uncapped, BEAM_MAX_LUMEN],
    ]);
  });

  it("turns a lamp that is off on before changing its brightness", () => {
    const device = beam();
    connect(device);
    vi.mocked(isOn).mockReturnValue(false);

    setBrightnessAllPercentage(40);

    expect(turnOn).toHaveBeenCalledWith(device);
    expect(firstCall(vi.mocked(turnOn))).toBeLessThan(firstCall(vi.mocked(setBrightnessInLumen)));
  });

  it("leaves a lamp that is on as it is", () => {
    connect(beam());
    vi.mocked(isOn).mockReturnValue(true);

    setBrightnessAllPercentage(40);

    expect(turnOn).not.toHaveBeenCalled();
  });

  it("reports the percentage when only some lamps succeed", () => {
    const first = beam();
    connect(first, beam());
    vi.mocked(setBrightnessInLumen).mockImplementation(failFor(first));

    expect(setBrightnessAllPercentage(40)).toEqual({
      ok: false,
      deviceCount: 2,
      failures: 1,
      representativeBrightnessPercentage: 40,
      representativeBrightnessLumen: 178,
    });
  });

  it("reports no percentage or lumens when no lamp succeeds", () => {
    const result = setBrightnessAllPercentage(40);

    expect(result.representativeBrightnessPercentage).toBeUndefined();
    expect(result.representativeBrightnessLumen).toBeUndefined();
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
  it("moves every lamp from its own temperature, and reports the first lamp's", () => {
    const first = beam();
    const second = beam();
    connect(first, second);
    vi.mocked(getTemperatureInKelvin).mockImplementation((device) => (device === first ? 3000 : 2700));

    // 2 ticks of 200 K, one of the dial's step options.
    expect(adjustTemperatureAllByKelvinSteps(2, 200)).toEqual({
      ok: true,
      deviceCount: 2,
      failures: 0,
      representativeTemperatureKelvin: 3400,
      representativeTemperaturePercentage: 18,
    });
    expect(vi.mocked(setTemperatureInKelvin).mock.calls).toEqual([
      [first, 3400],
      [second, 3100],
    ]);
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
