import type { JsonValue } from "@elgato/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  adjustTemperatureAllByKelvinSteps,
  type BroadcastResult,
  createDialDebouncer,
  identifyLamp,
  type LampStatus,
  readLampStatuses,
  readRepresentativeTemperatureKelvin,
  setTemperatureAllInKelvin,
  toggleAll,
} from "../litra-manager";
import { logger } from "../logging";
import { at } from "../test-support/at";
import { createFakeDial, createFakeKey, type FakeAction, show } from "../test-support/fake-stream-deck";
import { LampScreens } from "./lamp-screens";
import { TemperatureAction } from "./temperature";

//* Fakes

vi.mock("@elgato/streamdeck", () => import("../test-support/fake-stream-deck"));

// The real logger writes to a logs/ folder.
vi.mock("../logging", () => import("../test-support/fake-logging"));

// The real litra-manager loads node-hid's native binary on import and talks to real lamps.
vi.mock("../litra-manager", () => ({
  adjustTemperatureAllByKelvinSteps: vi.fn(),
  createDialDebouncer: vi.fn(),
  identifyLamp: vi.fn(),
  onLampsChanged: vi.fn(),
  readLampStatuses: vi.fn(),
  readRepresentativeTemperatureKelvin: vi.fn(),
  setTemperatureAllInKelvin: vi.fn(),
  toggleAll: vi.fn(),
}));

/** A preset of 4050 K, snapped to the nearest temperature a Beam allows. */
const SNAPPED: BroadcastResult = {
  ok: true,
  deviceCount: 2,
  failures: 0,
  representativeTemperatureKelvin: 4000,
  representativeTemperaturePercentage: 34,
};

/** The event of a press on a key, with the preset it has saved. */
function keyDown(key: FakeAction, presetKelvin: JsonValue) {
  return { action: key, payload: { settings: { presetKelvin } } } as never;
}

/** The event of a key appearing, with the preset it has saved. */
function willAppear(key: FakeAction, presetKelvin: JsonValue) {
  return { action: key, payload: { settings: { presetKelvin } } } as never;
}

/** The event of a dial turned by some ticks, with the step it has saved. */
function dialRotate(dial: FakeAction, ticks: number, stepKelvin: JsonValue = 100) {
  return { action: dial, payload: { settings: { stepKelvin }, ticks } } as never;
}

const TEMPERATURE_SNAPPED = { title: "Temperature", value: "4000", indicator: 34 };

const BEAM: LampStatus = {
  serialNumber: "A1",
  model: "Beam",
  on: true,
  brightnessLumen: 324,
  brightnessPercentage: 79,
  temperatureKelvin: 2700,
};

/** The event of a tap on a dial's strip, or of a hold with `hold`. */
function touchTap(dial: FakeAction, hold = false) {
  return { action: dial, payload: { settings: {}, hold } } as never;
}

/** Waits for a dial's flush, which the fake debouncer starts at once and nobody awaits. */
function flushed(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  vi.mocked(createDialDebouncer).mockImplementation((flush) => (ticks) => void flush(ticks));
});

//* Tests

describe("TemperatureAction", () => {
  describe("on a key press", () => {
    it("sets the lamps to the key's preset", () => {
      const key = createFakeKey();
      show(key);
      vi.mocked(setTemperatureAllInKelvin).mockReturnValue(SNAPPED);

      void new TemperatureAction().onKeyDown(keyDown(key, 4050));

      expect(setTemperatureAllInKelvin).toHaveBeenCalledWith(4050);
    });

    it("shows on every dial the temperature the lamps were set to, snapped to an allowed one (#29)", async () => {
      const key = createFakeKey();
      const dial = createFakeDial();
      const otherDial = createFakeDial();
      show(key, dial, otherDial);
      vi.mocked(setTemperatureAllInKelvin).mockReturnValue(SNAPPED);

      await new TemperatureAction().onKeyDown(keyDown(key, 4050));

      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(TEMPERATURE_SNAPPED);
      expect(otherDial.setFeedback).toHaveBeenCalledExactlyOnceWith(TEMPERATURE_SNAPPED);
      expect(key.setTitle).not.toHaveBeenCalled();
      expect(key.showAlert).not.toHaveBeenCalled();
    });

    it("shows an alert when no lamp is connected, and no temperature on the dials", async () => {
      const key = createFakeKey();
      const dial = createFakeDial();
      show(key, dial);
      vi.mocked(setTemperatureAllInKelvin).mockReturnValue({ ok: false, deviceCount: 0, failures: 1 });

      await new TemperatureAction().onKeyDown(keyDown(key, 4050));

      expect(key.showAlert).toHaveBeenCalledOnce();
      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith({ title: "Temperature", value: "—", indicator: 0 });
    });
  });

  describe("on a dial turn", () => {
    it("shows the temperature the lamps were set to on every dial, not only the one turned", async () => {
      const turned = createFakeDial();
      const otherDial = createFakeDial();
      show(turned, otherDial);
      vi.mocked(adjustTemperatureAllByKelvinSteps).mockReturnValue(SNAPPED);

      await new TemperatureAction().onDialRotate(dialRotate(turned, 2));
      await flushed();

      expect(adjustTemperatureAllByKelvinSteps).toHaveBeenCalledWith(2, 100);
      expect(turned.setFeedback).toHaveBeenCalledExactlyOnceWith(TEMPERATURE_SNAPPED);
      expect(otherDial.setFeedback).toHaveBeenCalledExactlyOnceWith(TEMPERATURE_SNAPPED);
    });

    it("shows an alert on the dial turned when a lamp fails", async () => {
      const turned = createFakeDial();
      const otherDial = createFakeDial();
      show(turned, otherDial);
      vi.mocked(adjustTemperatureAllByKelvinSteps).mockReturnValue({ ...SNAPPED, ok: false, failures: 1 });

      await new TemperatureAction().onDialRotate(dialRotate(turned, 2));
      await flushed();

      expect(turned.showAlert).toHaveBeenCalledOnce();
      expect(otherDial.showAlert).not.toHaveBeenCalled();
    });
  });

  it("moves the lamps by a step saved as text, as the step's select saves it", async () => {
    const dial = createFakeDial();
    show(dial);
    vi.mocked(adjustTemperatureAllByKelvinSteps).mockReturnValue(SNAPPED);

    await new TemperatureAction().onDialRotate(dialRotate(dial, 2, "200"));
    await flushed();

    expect(adjustTemperatureAllByKelvinSteps).toHaveBeenCalledExactlyOnceWith(2, 200);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("shows a key's preset as its title when it appears", async () => {
    const key = createFakeKey();
    show(key);

    await new TemperatureAction().onWillAppear(willAppear(key, 5000));

    expect(key.setTitle).toHaveBeenCalledExactlyOnceWith("5000");
  });

  describe("with a setting that isn't valid (#22)", () => {
    it("sets the lamps to the default preset on a key press, with a warning", () => {
      const key = createFakeKey();
      show(key);
      vi.mocked(setTemperatureAllInKelvin).mockReturnValue(SNAPPED);

      void new TemperatureAction().onKeyDown(keyDown(key, "warm"));

      expect(setTemperatureAllInKelvin).toHaveBeenCalledExactlyOnceWith(2700);
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("presetKelvin"));
    });

    it("shows the default preset on the key, with a warning", async () => {
      const key = createFakeKey();
      show(key);

      await new TemperatureAction().onWillAppear(willAppear(key, "warm"));

      expect(key.setTitle).toHaveBeenCalledExactlyOnceWith("2700");
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("presetKelvin"));
    });

    it("moves the lamps by the default step on a dial turn, with a warning", async () => {
      const dial = createFakeDial();
      show(dial);
      vi.mocked(adjustTemperatureAllByKelvinSteps).mockReturnValue(SNAPPED);

      await new TemperatureAction().onDialRotate(dialRotate(dial, 2, 0));
      await flushed();

      expect(adjustTemperatureAllByKelvinSteps).toHaveBeenCalledExactlyOnceWith(2, 300);
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("stepKelvin"));
    });
  });

  describe("with lamp screens", () => {
    let lampScreens: LampScreens;

    beforeEach(() => {
      lampScreens = new LampScreens();
      vi.mocked(readLampStatuses).mockResolvedValue({ ok: true, lamps: [BEAM] });
      vi.mocked(readRepresentativeTemperatureKelvin).mockReturnValue(SNAPPED);
    });

    it("shows the temperature again after the last lamp", async () => {
      const dial = createFakeDial();
      show(dial);
      const temperature = new TemperatureAction(lampScreens);

      await temperature.onTouchTap(touchTap(dial));
      await temperature.onTouchTap(touchTap(dial));

      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith("$B1");
      expect(dial.setFeedback).toHaveBeenLastCalledWith(TEMPERATURE_SNAPPED);
    });

    it("blinks the lamp on screen on a push, instead of toggling every lamp", async () => {
      const dial = createFakeDial();
      show(dial);
      const temperature = new TemperatureAction(lampScreens);
      await temperature.onTouchTap(touchTap(dial));
      vi.mocked(identifyLamp).mockResolvedValue({ ok: true, deviceCount: 1, failures: 0 });

      await temperature.onDialDown({ action: dial, payload: { settings: {} } } as never);

      expect(identifyLamp).toHaveBeenCalledExactlyOnceWith(BEAM.serialNumber);
      expect(toggleAll).not.toHaveBeenCalled();
    });

    it("does nothing when the dial is turned on a lamp screen", async () => {
      const dial = createFakeDial();
      show(dial);
      const temperature = new TemperatureAction(lampScreens);
      await temperature.onTouchTap(touchTap(dial));

      await temperature.onDialRotate(dialRotate(dial, 3));
      await flushed();

      expect(adjustTemperatureAllByKelvinSteps).not.toHaveBeenCalled();
    });

    it("doesn't show the temperature on a dial that shows a lamp screen", async () => {
      const key = createFakeKey();
      const onLamp = createFakeDial();
      const onMain = createFakeDial();
      show(key, onLamp, onMain);
      const temperature = new TemperatureAction(lampScreens);
      await temperature.onTouchTap(touchTap(onLamp));
      vi.mocked(setTemperatureAllInKelvin).mockReturnValue(SNAPPED);

      await temperature.onKeyDown(keyDown(key, 4050));

      expect(onLamp.setFeedback).not.toHaveBeenCalledWith(TEMPERATURE_SNAPPED);
      expect(onMain.setFeedback).toHaveBeenCalledExactlyOnceWith(TEMPERATURE_SNAPPED);
    });
  });

  describe("logs", () => {
    let lampScreens: LampScreens;

    beforeEach(() => {
      lampScreens = new LampScreens();
      vi.mocked(readLampStatuses).mockResolvedValue({ ok: true, lamps: [BEAM] });
      vi.mocked(readRepresentativeTemperatureKelvin).mockReturnValue(SNAPPED);
      vi.mocked(toggleAll).mockReturnValue({ ok: true, deviceCount: 1, failures: 0 });
      vi.mocked(identifyLamp).mockResolvedValue({ ok: true, deviceCount: 1, failures: 0 });
    });

    it("a key press, with the key's preset, before changing the lamps", async () => {
      const key = createFakeKey();
      show(key);
      vi.mocked(setTemperatureAllInKelvin).mockReturnValue(SNAPPED);

      await new TemperatureAction().onKeyDown(keyDown(key, 4050));

      expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("4050 K"));
      expect(at(vi.mocked(logger.info).mock.invocationCallOrder, 0)).toBeLessThan(
        at(vi.mocked(setTemperatureAllInKelvin).mock.invocationCallOrder, 0),
      );
    });

    it("a dial turn, with its ticks and the dial's step", async () => {
      const dial = createFakeDial();
      show(dial);
      vi.mocked(adjustTemperatureAllByKelvinSteps).mockReturnValue(SNAPPED);

      await new TemperatureAction().onDialRotate(dialRotate(dial, 3));
      await flushed();

      const message = vi.mocked(logger.info).mock.calls[0]?.[0];
      expect(message).toContain("3 ticks");
      expect(message).toContain("100 K");
    });

    it("a dial push, with what it does", async () => {
      const dial = createFakeDial();
      show(dial);
      const action = new TemperatureAction(lampScreens);

      await action.onDialDown({ action: dial, payload: { settings: {} } } as never);
      await action.onTouchTap(touchTap(dial));
      await action.onDialDown({ action: dial, payload: { settings: {} } } as never);

      expect(vi.mocked(logger.info).mock.calls).toEqual([
        [expect.stringContaining("toggle")],
        [expect.any(String)],
        [expect.stringContaining("identify")],
      ]);
    });

    it("a tap and a hold on the strip", async () => {
      const dial = createFakeDial();
      show(dial);
      const action = new TemperatureAction(lampScreens);

      await action.onTouchTap(touchTap(dial));
      await action.onTouchTap(touchTap(dial, true));

      expect(vi.mocked(logger.info).mock.calls).toEqual([
        [expect.stringContaining("tapped")],
        [expect.stringContaining("held")],
      ]);
    });
  });
});
