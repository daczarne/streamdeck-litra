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
import { createFakeDial, createFakeKey, type FakeAction, show } from "../test-support/fake-stream-deck";
import { LampScreens } from "./lamp-screens";
import { TemperatureAction } from "./temperature";

//* Fakes

vi.mock("@elgato/streamdeck", () => import("../test-support/fake-stream-deck"));

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

function keyDown(key: FakeAction, presetKelvin: number) {
  return { action: key, payload: { settings: { presetKelvin } } } as never;
}

function dialRotate(dial: FakeAction, ticks: number) {
  return { action: dial, payload: { settings: { stepKelvin: 100 }, ticks } } as never;
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

function touchTap(dial: FakeAction) {
  return { action: dial, payload: { settings: {}, hold: false } } as never;
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
});
