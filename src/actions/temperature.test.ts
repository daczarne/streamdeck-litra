import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  adjustLampsTemperature,
  type BroadcastResult,
  createDialDebouncer,
  identifyLamp,
  type LampStatus,
  onLampsChanged,
  readLampStatuses,
  readLampsTemperature,
  setLampsTemperature,
  toggleLamps,
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
  adjustLampsTemperature: vi.fn(),
  createDialDebouncer: vi.fn(),
  identifyLamp: vi.fn(),
  onLampsChanged: vi.fn(),
  readLampStatuses: vi.fn(),
  readLampsTemperature: vi.fn(),
  setLampsTemperature: vi.fn(),
  toggleLamps: vi.fn(),
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

const NO_LAMP: BroadcastResult = { ok: false, deviceCount: 0, failures: 1 };

const UNKNOWN_TEMPERATURE = { title: "Temperature", value: "—", indicator: 0 };

const BEAM: LampStatus = {
  id: "lamp-A1",
  serialNumber: "A1",
  model: "Beam",
  on: true,
  brightnessLumen: 324,
  brightnessPercentage: 79,
  temperatureKelvin: 2700,
};

const OTHER_BEAM: LampStatus = { ...BEAM, id: "lamp-B2", serialNumber: "B2" };

let deck: FakeDeck;
// What the action does when litra-manager announces that the lamps changed.
let lampsChanged: () => Promise<void>;

beforeEach(() => {
  vi.useFakeTimers();
  // The debouncer flushes every turn at once: its own timing is litra-manager's to test.
  vi.mocked(createDialDebouncer).mockImplementation((flush) => (ticks) => void flush(ticks));
  // The lamps, as a dial that appears or returns to its main screen reads them, and as the lamp screens read them.
  vi.mocked(readLampsTemperature).mockResolvedValue(SNAPPED);
  vi.mocked(readLampStatuses).mockResolvedValue({ ok: true, lamps: [BEAM] });
  const temperature = new TemperatureAction(new LampScreens());
  const listener = vi.mocked(onLampsChanged).mock.lastCall?.[0];
  if (listener === undefined) {
    throw new Error("TemperatureAction didn't listen for lamp changes");
  }
  lampsChanged = async () => listener();
  deck = new FakeDeck([temperature]);
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
  describe("when the lamps change", () => {
    it("shows on every dial the temperature the lamps are at, from one read, and leaves the keys' presets (#29)", async () => {
      const key = await deck.key(TEMPERATURE, { presetKelvin: 4050 });
      const dial = await deck.dial(TEMPERATURE);
      const otherDial = await deck.dial(TEMPERATURE);
      clearCalls();

      await lampsChanged();

      expect(readLampsTemperature).toHaveBeenCalledOnce();
      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(TEMPERATURE_SNAPPED);
      expect(otherDial.setFeedback).toHaveBeenCalledExactlyOnceWith(TEMPERATURE_SNAPPED);
      expect(key.setTitle).not.toHaveBeenCalled();
    });

    it("shows the temperature of a lamp it could read when another can't be read", async () => {
      const dial = await deck.dial(TEMPERATURE);
      clearCalls();
      vi.mocked(readLampsTemperature).mockResolvedValue({ ...SNAPPED, ok: false, failures: 1 });

      await lampsChanged();

      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(TEMPERATURE_SNAPPED);
    });

    it("shows no temperature when no lamp can be read", async () => {
      const dial = await deck.dial(TEMPERATURE);
      clearCalls();
      vi.mocked(readLampsTemperature).mockResolvedValue(NO_LAMP);

      await lampsChanged();

      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(UNKNOWN_TEMPERATURE);
    });

    it("reads nothing when no dial shows the temperature", async () => {
      await deck.key(TEMPERATURE, { presetKelvin: 4050 });
      const onLamp = await deck.dial(TEMPERATURE);
      await deck.tap(onLamp);
      clearCalls();

      await lampsChanged();

      expect(readLampsTemperature).not.toHaveBeenCalled();
      expect(onLamp.setFeedback).not.toHaveBeenCalledWith(TEMPERATURE_SNAPPED);
    });
  });

  describe("on a key press", () => {
    it("sets the key's lamps alone, picked on the settings page (#20)", async () => {
      const lamps = [{ id: "lamp-1", label: "Beam - 1111" }];
      const key = await deck.key(TEMPERATURE, { presetKelvin: 5000, lamps });
      clearCalls();
      vi.mocked(setLampsTemperature).mockReturnValue(SNAPPED);

      await deck.press(key);

      expect(setLampsTemperature).toHaveBeenCalledExactlyOnceWith(["lamp-1"], 5000);
      expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("1 lamp"));
    });

    it("sets the lamps to the key's preset, and leaves showing the result to the notice", async () => {
      const key = await deck.key(TEMPERATURE, { presetKelvin: 4050 });
      const dial = await deck.dial(TEMPERATURE);
      clearCalls();
      vi.mocked(setLampsTemperature).mockReturnValue(SNAPPED);

      await deck.press(key);

      expect(setLampsTemperature).toHaveBeenCalledWith("all", 4050);
      expect(key.showAlert).not.toHaveBeenCalled();
      expect(dial.setFeedback).not.toHaveBeenCalled();
    });

    it("shows an alert when no lamp is connected", async () => {
      const key = await deck.key(TEMPERATURE, { presetKelvin: 4050 });
      vi.mocked(setLampsTemperature).mockReturnValue(NO_LAMP);

      await deck.press(key);

      expect(key.showAlert).toHaveBeenCalledOnce();
    });
  });

  describe("on a dial turn", () => {
    it("moves the lamps by the dial's step, and leaves showing the result to the notice", async () => {
      const dial = await deck.dial(TEMPERATURE, { stepKelvin: 100 });
      clearCalls();
      vi.mocked(adjustLampsTemperature).mockReturnValue(SNAPPED);

      await deck.turn(dial, 2);

      expect(adjustLampsTemperature).toHaveBeenCalledWith("all", 2, 100);
      expect(dial.setFeedback).not.toHaveBeenCalled();
    });

    it("shows an alert on the dial turned when a lamp fails", async () => {
      const turned = await deck.dial(TEMPERATURE, { stepKelvin: 100 });
      const otherDial = await deck.dial(TEMPERATURE);
      vi.mocked(adjustLampsTemperature).mockReturnValue({ ...SNAPPED, ok: false, failures: 1 });

      await deck.turn(turned, 2);

      expect(turned.showAlert).toHaveBeenCalledOnce();
      expect(otherDial.showAlert).not.toHaveBeenCalled();
    });
  });

  it("moves the lamps by a step saved as text, as the step's select saves it", async () => {
    const dial = await deck.dial(TEMPERATURE, { stepKelvin: "200" });
    vi.mocked(adjustLampsTemperature).mockReturnValue(SNAPPED);

    await deck.turn(dial, 2);

    expect(adjustLampsTemperature).toHaveBeenCalledExactlyOnceWith("all", 2, 200);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("shows a key's preset as its title when it appears", async () => {
    const key = await deck.key(TEMPERATURE, { presetKelvin: 5000 });

    expect(key.setTitle).toHaveBeenCalledExactlyOnceWith("5000");
  });

  it("shows no temperature on a dial that appears while no lamp can be read", async () => {
    vi.mocked(readLampsTemperature).mockResolvedValue(NO_LAMP);

    const dial = await deck.dial(TEMPERATURE);

    expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(UNKNOWN_TEMPERATURE);
  });

  it("shows the temperature of a lamp it could read on a dial that appears while another can't be read", async () => {
    vi.mocked(readLampsTemperature).mockResolvedValue({ ...SNAPPED, ok: false, failures: 1 });

    const dial = await deck.dial(TEMPERATURE);

    expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(TEMPERATURE_SNAPPED);
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

      expect(readLampsTemperature).toHaveBeenCalledOnce();
      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(TEMPERATURE_SNAPPED);
    });
  });

  it("shows an alert on a dial pushed when the lamps can't be toggled, and leaves its screen as it was", async () => {
    const dial = await deck.dial(TEMPERATURE);
    clearCalls();
    vi.mocked(toggleLamps).mockReturnValue({ ok: false, deviceCount: 0, failures: 1 });

    await deck.push(dial);

    expect(dial.showAlert).toHaveBeenCalledOnce();
    expect(dial.setFeedback).not.toHaveBeenCalled();
  });

  describe("with a setting that isn't valid (#22)", () => {
    it("sets the lamps to the default preset on a key press, with a warning", async () => {
      const key = await deck.key(TEMPERATURE, { presetKelvin: "warm" });
      clearCalls();
      vi.mocked(setLampsTemperature).mockReturnValue(SNAPPED);

      await deck.press(key);

      expect(setLampsTemperature).toHaveBeenCalledExactlyOnceWith("all", 2700);
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
      vi.mocked(adjustLampsTemperature).mockReturnValue(SNAPPED);

      await deck.turn(dial, 2);

      expect(adjustLampsTemperature).toHaveBeenCalledExactlyOnceWith("all", 2, 300);
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

    it("blinks the lamp on screen on a hold, and stays on its screen (#20)", async () => {
      const dial = await deck.dial(TEMPERATURE);
      await deck.tap(dial);
      vi.mocked(identifyLamp).mockResolvedValue({ ok: true, deviceCount: 1, failures: 0 });

      await deck.hold(dial);

      expect(identifyLamp).toHaveBeenCalledExactlyOnceWith(BEAM.id);
      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith("layouts/lamp.json");
    });

    it("does nothing on a hold on the main screen", async () => {
      const dial = await deck.dial(TEMPERATURE);
      clearCalls();

      await deck.hold(dial);

      expect(identifyLamp).not.toHaveBeenCalled();
      expect(dial.setFeedbackLayout).not.toHaveBeenCalled();
    });

    it("toggles only the lamp on screen on a push (#20)", async () => {
      const dial = await deck.dial(TEMPERATURE);
      await deck.tap(dial);
      vi.mocked(toggleLamps).mockReturnValue({ ok: true, deviceCount: 1, failures: 0 });

      await deck.push(dial);

      expect(toggleLamps).toHaveBeenCalledExactlyOnceWith([BEAM.id]);
      expect(identifyLamp).not.toHaveBeenCalled();
    });

    it("toggles every lamp on a push on the main screen", async () => {
      const pushed = await deck.dial(TEMPERATURE);
      const onLamp = await deck.dial(TEMPERATURE);
      await deck.tap(onLamp);
      vi.mocked(toggleLamps).mockReturnValue({ ok: true, deviceCount: 1, failures: 0 });

      await deck.push(pushed);

      expect(toggleLamps).toHaveBeenCalledExactlyOnceWith("all");
    });

    it("moves only the lamp on screen when the dial is turned on a lamp screen (#20)", async () => {
      const dial = await deck.dial(TEMPERATURE, { stepKelvin: 100 });
      await deck.tap(dial);
      vi.mocked(adjustLampsTemperature).mockReturnValue(SNAPPED);

      await deck.turn(dial, 3);

      expect(adjustLampsTemperature).toHaveBeenCalledExactlyOnceWith([BEAM.id], 3, 100);
    });

    it("moves the lamps that were on screen as the dial turned, even when the strip is tapped before (#20)", async () => {
      // Each turn waits to be applied, as the debouncer holds the ticks for a moment.
      const waiting: Array<() => void | Promise<void>> = [];
      vi.mocked(createDialDebouncer).mockImplementation((flush) => (ticks) => {
        waiting.push(() => flush(ticks));
      });
      vi.mocked(readLampStatuses).mockResolvedValue({ ok: true, lamps: [BEAM, OTHER_BEAM] });
      vi.mocked(adjustLampsTemperature).mockReturnValue(SNAPPED);
      const dial = await deck.dial(TEMPERATURE, { stepKelvin: 100 });

      await deck.turn(dial, 1);
      await deck.tap(dial);
      await deck.turn(dial, 2);
      await deck.tap(dial);
      await deck.turn(dial, 3);
      for (const apply of waiting) {
        await apply();
      }

      expect(vi.mocked(adjustLampsTemperature).mock.calls).toEqual([
        ["all", 1, 100],
        [[BEAM.id], 2, 100],
        [[OTHER_BEAM.id], 3, 100],
      ]);
    });

    it("doesn't show the temperature on a dial that shows a lamp screen", async () => {
      const onLamp = await deck.dial(TEMPERATURE);
      const onMain = await deck.dial(TEMPERATURE);
      await deck.tap(onLamp);
      clearCalls();

      await lampsChanged();

      expect(onLamp.setFeedback).not.toHaveBeenCalled();
      expect(onMain.setFeedback).toHaveBeenCalledExactlyOnceWith(TEMPERATURE_SNAPPED);
    });
  });

  describe("logs", () => {
    beforeEach(() => {
      vi.mocked(toggleLamps).mockReturnValue({ ok: true, deviceCount: 1, failures: 0 });
      vi.mocked(identifyLamp).mockResolvedValue({ ok: true, deviceCount: 1, failures: 0 });
    });

    it("a key press, with the key's preset, before changing the lamps", async () => {
      const key = await deck.key(TEMPERATURE, { presetKelvin: 4050 });
      vi.mocked(setLampsTemperature).mockReturnValue(SNAPPED);

      await deck.press(key);

      expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("4050 K"));
      expect(at(vi.mocked(logger.info).mock.invocationCallOrder, 0)).toBeLessThan(
        at(vi.mocked(setLampsTemperature).mock.invocationCallOrder, 0),
      );
    });

    it("a dial turn, with its ticks and the dial's step", async () => {
      const dial = await deck.dial(TEMPERATURE, { stepKelvin: 100 });
      vi.mocked(adjustLampsTemperature).mockReturnValue(SNAPPED);

      await deck.turn(dial, 3);

      const [message] = at(vi.mocked(logger.info).mock.calls, 0);
      expect(message).toContain("3 ticks");
      expect(message).toContain("100 K");
    });

    it("a dial turn on a lamp screen, with its ticks and the dial's step", async () => {
      const dial = await deck.dial(TEMPERATURE, { stepKelvin: 100 });
      await deck.tap(dial);
      vi.mocked(logger.info).mockClear();
      vi.mocked(adjustLampsTemperature).mockReturnValue(SNAPPED);

      await deck.turn(dial, 3);

      const [message] = at(vi.mocked(logger.info).mock.calls, 0);
      expect(message).toContain("lamp screen");
      expect(message).toContain("3 ticks");
    });

    it("a dial push, with what it does", async () => {
      const dial = await deck.dial(TEMPERATURE);

      await deck.push(dial);
      await deck.tap(dial);
      await deck.push(dial);

      expect(vi.mocked(logger.info).mock.calls).toEqual([
        [expect.stringContaining("toggle")],
        [expect.any(String)],
        [expect.stringMatching(/lamp screen.*toggle/)],
      ]);
    });

    it("a tap and a hold on the strip, with what the hold does", async () => {
      const dial = await deck.dial(TEMPERATURE);

      await deck.hold(dial);
      await deck.tap(dial);
      await deck.hold(dial);

      expect(vi.mocked(logger.info).mock.calls).toEqual([
        [expect.stringMatching(/held.*nothing/)],
        [expect.stringContaining("tapped")],
        [expect.stringMatching(/held.*identify/)],
      ]);
    });
  });
});
