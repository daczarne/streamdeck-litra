import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
import { FakeDeck } from "../test-support/fake-deck";
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

const TEMPERATURE = "com.daczarne.litra.temperature";

/** A preset of 4050 K, snapped to the nearest temperature a Beam allows. */
const SNAPPED: BroadcastResult = {
  ok: true,
  deviceCount: 2,
  failures: 0,
  representativeTemperatureKelvin: 4000,
  representativeTemperaturePercentage: 34,
};

const TEMPERATURE_SNAPPED = { title: "Temperature", value: "4000", indicator: 34 };

const BEAM: LampStatus = {
  serialNumber: "A1",
  model: "Beam",
  on: true,
  brightnessLumen: 324,
  brightnessPercentage: 79,
  temperatureKelvin: 2700,
};

let deck: FakeDeck;

beforeEach(() => {
  vi.useFakeTimers();
  // The debouncer flushes every turn at once: its own timing is litra-manager's to test.
  vi.mocked(createDialDebouncer).mockImplementation((flush) => (ticks) => void flush(ticks));
  // The lamps, as a dial that appears or returns to its main screen reads them, and as the lamp screens read them.
  vi.mocked(readRepresentativeTemperatureKelvin).mockReturnValue(SNAPPED);
  vi.mocked(readLampStatuses).mockResolvedValue({ ok: true, lamps: [BEAM] });
  deck = new FakeDeck([new TemperatureAction(new LampScreens())]);
});

afterEach(() => {
  vi.useRealTimers();
});

/** Forgets what placing the keys and dials did, so that a test checks only what its own interaction does. */
function clearCalls(): void {
  vi.clearAllMocks();
}

//* Tests

describe("TemperatureAction", () => {
  describe("on a key press", () => {
    it("sets the lamps to the key's preset", async () => {
      const key = await deck.key(TEMPERATURE, { presetKelvin: 4050 });
      vi.mocked(setTemperatureAllInKelvin).mockReturnValue(SNAPPED);

      await deck.press(key);

      expect(setTemperatureAllInKelvin).toHaveBeenCalledWith(4050);
    });

    it("shows on every dial the temperature the lamps were set to, snapped to an allowed one (#29)", async () => {
      const key = await deck.key(TEMPERATURE, { presetKelvin: 4050 });
      const dial = await deck.dial(TEMPERATURE);
      const otherDial = await deck.dial(TEMPERATURE);
      clearCalls();
      vi.mocked(setTemperatureAllInKelvin).mockReturnValue(SNAPPED);

      await deck.press(key);

      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(TEMPERATURE_SNAPPED);
      expect(otherDial.setFeedback).toHaveBeenCalledExactlyOnceWith(TEMPERATURE_SNAPPED);
      expect(key.setTitle).not.toHaveBeenCalled();
      expect(key.showAlert).not.toHaveBeenCalled();
    });

    it("shows an alert when no lamp is connected, and no temperature on the dials", async () => {
      const key = await deck.key(TEMPERATURE, { presetKelvin: 4050 });
      const dial = await deck.dial(TEMPERATURE);
      clearCalls();
      vi.mocked(setTemperatureAllInKelvin).mockReturnValue({ ok: false, deviceCount: 0, failures: 1 });

      await deck.press(key);

      expect(key.showAlert).toHaveBeenCalledOnce();
      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith({ title: "Temperature", value: "—", indicator: 0 });
    });
  });

  describe("on a dial turn", () => {
    it("shows the temperature the lamps were set to on every dial, not only the one turned", async () => {
      const turned = await deck.dial(TEMPERATURE, { stepKelvin: 100 });
      const otherDial = await deck.dial(TEMPERATURE);
      clearCalls();
      vi.mocked(adjustTemperatureAllByKelvinSteps).mockReturnValue(SNAPPED);

      await deck.turn(turned, 2);

      expect(adjustTemperatureAllByKelvinSteps).toHaveBeenCalledWith(2, 100);
      expect(turned.setFeedback).toHaveBeenCalledExactlyOnceWith(TEMPERATURE_SNAPPED);
      expect(otherDial.setFeedback).toHaveBeenCalledExactlyOnceWith(TEMPERATURE_SNAPPED);
    });

    it("shows an alert on the dial turned when a lamp fails", async () => {
      const turned = await deck.dial(TEMPERATURE, { stepKelvin: 100 });
      const otherDial = await deck.dial(TEMPERATURE);
      vi.mocked(adjustTemperatureAllByKelvinSteps).mockReturnValue({ ...SNAPPED, ok: false, failures: 1 });

      await deck.turn(turned, 2);

      expect(turned.showAlert).toHaveBeenCalledOnce();
      expect(otherDial.showAlert).not.toHaveBeenCalled();
    });
  });

  it("moves the lamps by a step saved as text, as the step's select saves it", async () => {
    const dial = await deck.dial(TEMPERATURE, { stepKelvin: "200" });
    vi.mocked(adjustTemperatureAllByKelvinSteps).mockReturnValue(SNAPPED);

    await deck.turn(dial, 2);

    expect(adjustTemperatureAllByKelvinSteps).toHaveBeenCalledExactlyOnceWith(2, 200);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("shows a key's preset as its title when it appears", async () => {
    const key = await deck.key(TEMPERATURE, { presetKelvin: 5000 });

    expect(key.setTitle).toHaveBeenCalledExactlyOnceWith("5000");
  });

  describe("when the settings page changes a setting", () => {
    it("shows a key's new preset as its title", async () => {
      const key = await deck.key(TEMPERATURE, { presetKelvin: 5000 });

      await deck.changeSettings(key, { presetKelvin: 6000 });

      expect(key.setTitle).toHaveBeenLastCalledWith("6000");
    });

    it("redraws a dial with what the lamps are at", async () => {
      const dial = await deck.dial(TEMPERATURE, { stepKelvin: 100 });
      clearCalls();

      await deck.changeSettings(dial, { stepKelvin: 200 });

      expect(readRepresentativeTemperatureKelvin).toHaveBeenCalledOnce();
      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(TEMPERATURE_SNAPPED);
    });
  });

  it("shows an alert on a dial pushed when the lamps can't be toggled, and leaves its screen as it was", async () => {
    const dial = await deck.dial(TEMPERATURE);
    clearCalls();
    vi.mocked(toggleAll).mockReturnValue({ ok: false, deviceCount: 0, failures: 1 });

    await deck.push(dial);

    expect(dial.showAlert).toHaveBeenCalledOnce();
    expect(dial.setFeedback).not.toHaveBeenCalled();
  });

  describe("with a setting that isn't valid (#22)", () => {
    it("sets the lamps to the default preset on a key press, with a warning", async () => {
      const key = await deck.key(TEMPERATURE, { presetKelvin: "warm" });
      clearCalls();
      vi.mocked(setTemperatureAllInKelvin).mockReturnValue(SNAPPED);

      await deck.press(key);

      expect(setTemperatureAllInKelvin).toHaveBeenCalledExactlyOnceWith(2700);
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("presetKelvin"));
    });

    it("shows the default preset on the key, with a warning", async () => {
      const key = await deck.key(TEMPERATURE, { presetKelvin: "warm" });

      expect(key.setTitle).toHaveBeenCalledExactlyOnceWith("2700");
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("presetKelvin"));
    });

    it("moves the lamps by the default step on a dial turn, with a warning", async () => {
      const dial = await deck.dial(TEMPERATURE, { stepKelvin: 0 });
      clearCalls();
      vi.mocked(adjustTemperatureAllByKelvinSteps).mockReturnValue(SNAPPED);

      await deck.turn(dial, 2);

      expect(adjustTemperatureAllByKelvinSteps).toHaveBeenCalledExactlyOnceWith(2, 300);
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("stepKelvin"));
    });
  });

  describe("with lamp screens", () => {
    it("shows the temperature again after the last lamp", async () => {
      const dial = await deck.dial(TEMPERATURE);

      await deck.tap(dial);
      await deck.tap(dial);

      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith("$B1");
      expect(dial.setFeedback).toHaveBeenLastCalledWith(TEMPERATURE_SNAPPED);
    });

    it("blinks the lamp on screen on a push, instead of toggling every lamp", async () => {
      const dial = await deck.dial(TEMPERATURE);
      await deck.tap(dial);
      vi.mocked(identifyLamp).mockResolvedValue({ ok: true, deviceCount: 1, failures: 0 });

      await deck.push(dial);

      expect(identifyLamp).toHaveBeenCalledExactlyOnceWith(BEAM.serialNumber);
      expect(toggleAll).not.toHaveBeenCalled();
    });

    it("does nothing when the dial is turned on a lamp screen", async () => {
      const dial = await deck.dial(TEMPERATURE, { stepKelvin: 100 });
      await deck.tap(dial);

      await deck.turn(dial, 3);

      expect(adjustTemperatureAllByKelvinSteps).not.toHaveBeenCalled();
    });

    it("doesn't show the temperature on a dial that shows a lamp screen", async () => {
      const key = await deck.key(TEMPERATURE, { presetKelvin: 4050 });
      const onLamp = await deck.dial(TEMPERATURE);
      const onMain = await deck.dial(TEMPERATURE);
      await deck.tap(onLamp);
      clearCalls();
      vi.mocked(setTemperatureAllInKelvin).mockReturnValue(SNAPPED);

      await deck.press(key);

      expect(onLamp.setFeedback).not.toHaveBeenCalledWith(TEMPERATURE_SNAPPED);
      expect(onMain.setFeedback).toHaveBeenCalledExactlyOnceWith(TEMPERATURE_SNAPPED);
    });
  });

  describe("logs", () => {
    beforeEach(() => {
      vi.mocked(toggleAll).mockReturnValue({ ok: true, deviceCount: 1, failures: 0 });
      vi.mocked(identifyLamp).mockResolvedValue({ ok: true, deviceCount: 1, failures: 0 });
    });

    it("a key press, with the key's preset, before changing the lamps", async () => {
      const key = await deck.key(TEMPERATURE, { presetKelvin: 4050 });
      vi.mocked(setTemperatureAllInKelvin).mockReturnValue(SNAPPED);

      await deck.press(key);

      expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("4050 K"));
      expect(at(vi.mocked(logger.info).mock.invocationCallOrder, 0)).toBeLessThan(
        at(vi.mocked(setTemperatureAllInKelvin).mock.invocationCallOrder, 0),
      );
    });

    it("a dial turn, with its ticks and the dial's step", async () => {
      const dial = await deck.dial(TEMPERATURE, { stepKelvin: 100 });
      vi.mocked(adjustTemperatureAllByKelvinSteps).mockReturnValue(SNAPPED);

      await deck.turn(dial, 3);

      const [message] = at(vi.mocked(logger.info).mock.calls, 0);
      expect(message).toContain("3 ticks");
      expect(message).toContain("100 K");
    });

    it("a dial push, with what it does", async () => {
      const dial = await deck.dial(TEMPERATURE);

      await deck.push(dial);
      await deck.tap(dial);
      await deck.push(dial);

      expect(vi.mocked(logger.info).mock.calls).toEqual([
        [expect.stringContaining("toggle")],
        [expect.any(String)],
        [expect.stringContaining("identify")],
      ]);
    });

    it("a tap and a hold on the strip", async () => {
      const dial = await deck.dial(TEMPERATURE);

      await deck.tap(dial);
      await deck.hold(dial);

      expect(vi.mocked(logger.info).mock.calls).toEqual([
        [expect.stringContaining("tapped")],
        [expect.stringContaining("held")],
      ]);
    });
  });
});
