import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { syncGlobalSettings } from "../global-settings";
import {
  adjustLampsTemperature,
  identifyLamp,
  type OperationResult,
  onLampsChanged,
  setLampsTemperature,
  toggleLamps,
} from "../litra-manager";
import { logger } from "../logging";
import { at } from "../test-support/at";
import { FakeDeck } from "../test-support/fake-deck";
import { changeGlobalSettings } from "../test-support/fake-stream-deck";
import { reachedLamp } from "../test-support/reached-lamps";
import { createDialDebouncer } from "./debouncer";
import { globalSettings } from "./settings";
import { findShownLamps, readLampsTemperature, readShownLamps } from "./shown";
import { TemperatureAction } from "./temperature";

//* Fakes

vi.mock("@elgato/streamdeck", () => import("../test-support/fake-stream-deck"));

// The real logger writes to a logs/ folder.
vi.mock("../logging", () => import("../test-support/fake-logging"));

// The debouncer gathers what each test says, without the timing its own tests check.
vi.mock("./debouncer", () => ({ createDialDebouncer: vi.fn() }));

// What the keys and dials show of the lamps, which each test sets.
vi.mock("./shown", () => ({ findShownLamps: vi.fn(), readShownLamps: vi.fn(), readLampsTemperature: vi.fn() }));

// The real litra-manager loads node-hid's native binary on import and talks to real lamps.
vi.mock("../litra-manager", () => ({
  adjustLampsTemperature: vi.fn(),
  identifyLamp: vi.fn(),
  onLampsChanged: vi.fn(),
  setLampsTemperature: vi.fn(),
  toggleLamps: vi.fn(),
}));

const TEMPERATURE = "com.daczarne.litra.temperature";

/** A preset of 4050 K, snapped to the nearest temperature a Beam allows, as the plugin holds it. */
const SNAPPED = { kelvin: 4000, percentage: 34 };

const TEMPERATURE_SNAPPED = { title: "Temperature", value: "4000", indicator: 34 };

/** How an operation on two Beams went. */
const DONE: OperationResult = { ok: true, lampCount: 2, failures: 0 };
const FAILED: OperationResult = { ...DONE, ok: false, failures: 1 };
const NO_LAMP: OperationResult = { ok: false, lampCount: 0, failures: 1 };

const UNKNOWN_TEMPERATURE = { title: "Temperature", value: "—", indicator: 0 };

/** A Beam on a Stream Deck + XL's USB hub, at its cap, which the lamp screens show. */
const AT_ITS_CAP = { on: true, lumen: 324, kelvin: 2700 };

const BEAM = reachedLamp("00000000000000a1", AT_ITS_CAP);

const OTHER_BEAM = reachedLamp("00000000000000b2", AT_ITS_CAP);

let deck: FakeDeck;
// What the action does when litra-manager announces that the lamps changed.
let lampsChanged: () => Promise<void>;

// The global settings, which the tests change as a settings page does (#145).
await syncGlobalSettings();

beforeEach(() => {
  vi.useFakeTimers();
  changeGlobalSettings({});
  // The debouncer flushes every turn at once: its own timing is debouncer.test.ts's to check.
  vi.mocked(createDialDebouncer).mockImplementation((flush) => (ticks) => void flush(ticks));
  // The lamps, as a dial that appears or returns to its main screen reads them, and as the lamp screens read them.
  vi.mocked(readLampsTemperature).mockResolvedValue(SNAPPED);
  vi.mocked(readShownLamps).mockResolvedValue([BEAM]);
  // A tap finds the lamps, then shows what the plugin holds of them, which each test sets as readShownLamps.
  vi.mocked(findShownLamps).mockImplementation(() => readShownLamps());
  const temperature = new TemperatureAction();
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
    it("shows on every dial the temperature the lamps are at, and leaves the keys' presets (#29)", async () => {
      const key = await deck.key(TEMPERATURE, { presetKelvin: 4050 });
      const dial = await deck.dial(TEMPERATURE);
      const otherDial = await deck.dial(TEMPERATURE);
      clearCalls();

      await lampsChanged();

      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(TEMPERATURE_SNAPPED);
      expect(otherDial.setFeedback).toHaveBeenCalledExactlyOnceWith(TEMPERATURE_SNAPPED);
      expect(key.setTitle).not.toHaveBeenCalled();
    });

    it("shows no temperature when no lamp is connected", async () => {
      const dial = await deck.dial(TEMPERATURE);
      clearCalls();
      vi.mocked(readLampsTemperature).mockResolvedValue(undefined);

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
      // A key that adds no new lamps acts on the lamps checked alone (#147).
      changeGlobalSettings({ addNewLamps: false });
      const lamps = ["lamp-1"];
      const key = await deck.key(TEMPERATURE, { presetKelvin: 5000, lamps });
      clearCalls();
      vi.mocked(setLampsTemperature).mockReturnValue(DONE);

      await deck.press(key);

      expect(setLampsTemperature).toHaveBeenCalledExactlyOnceWith(["lamp-1"], 5000);
      expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("1 lamp"));
    });

    it("sets the lamps to the key's preset, and leaves showing the result to the notice", async () => {
      const key = await deck.key(TEMPERATURE, { presetKelvin: 4050 });
      const dial = await deck.dial(TEMPERATURE);
      clearCalls();
      vi.mocked(setLampsTemperature).mockReturnValue(DONE);

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
      vi.mocked(adjustLampsTemperature).mockReturnValue(DONE);

      await deck.turn(dial, 2);

      expect(adjustLampsTemperature).toHaveBeenCalledWith("all", 2, 100, "together");
      expect(dial.setFeedback).not.toHaveBeenCalled();
    });

    it("shows an alert on the dial turned when a lamp fails", async () => {
      const turned = await deck.dial(TEMPERATURE, { stepKelvin: 100 });
      const otherDial = await deck.dial(TEMPERATURE);
      vi.mocked(adjustLampsTemperature).mockReturnValue(FAILED);

      await deck.turn(turned, 2);

      expect(turned.showAlert).toHaveBeenCalledOnce();
      expect(otherDial.showAlert).not.toHaveBeenCalled();
    });
  });

  it("moves the lamps by a step saved as text, as the step's select saves it", async () => {
    const dial = await deck.dial(TEMPERATURE, { stepKelvin: "200" });
    vi.mocked(adjustLampsTemperature).mockReturnValue(DONE);

    await deck.turn(dial, 2);

    expect(adjustLampsTemperature).toHaveBeenCalledExactlyOnceWith("all", 2, 200, "together");
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("shows a key's preset as its title when it appears", async () => {
    const key = await deck.key(TEMPERATURE, { presetKelvin: 5000 });

    expect(key.setTitle).toHaveBeenCalledExactlyOnceWith("5000");
  });

  it("shows no temperature on a dial that appears while no lamp is connected", async () => {
    vi.mocked(readLampsTemperature).mockResolvedValue(undefined);

    const dial = await deck.dial(TEMPERATURE);

    expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(UNKNOWN_TEMPERATURE);
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
    vi.mocked(toggleLamps).mockReturnValue({ ok: false, lampCount: 0, failures: 1 });

    await deck.push(dial);

    expect(dial.showAlert).toHaveBeenCalledOnce();
    expect(dial.setFeedback).not.toHaveBeenCalled();
  });

  describe("with a setting that isn't valid (#22)", () => {
    it("sets the lamps to the default preset on a key press, warned about as the key appeared", async () => {
      const key = await deck.key(TEMPERATURE, { presetKelvin: "warm" });
      expect(logger.warn).toHaveBeenCalledOnce();
      clearCalls();
      vi.mocked(setLampsTemperature).mockReturnValue(DONE);

      await deck.press(key);

      expect(setLampsTemperature).toHaveBeenCalledExactlyOnceWith("all", 2700);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("shows the default preset on the key, with a warning", async () => {
      const key = await deck.key(TEMPERATURE, { presetKelvin: "warm" });

      expect(key.setTitle).toHaveBeenCalledExactlyOnceWith("2700");
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("presetKelvin"));
    });

    it("moves the lamps by the default step on a dial turn, warned about as the dial appeared", async () => {
      const dial = await deck.dial(TEMPERATURE, { stepKelvin: 0 });
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("step"));
      clearCalls();
      vi.mocked(adjustLampsTemperature).mockReturnValue(DONE);

      await deck.turn(dial, 2);

      expect(adjustLampsTemperature).toHaveBeenCalledExactlyOnceWith("all", 2, 300, "together");
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe("with the temperature difference kept (#145)", () => {
    beforeEach(() => {
      changeGlobalSettings({ keepTemperatureDifference: true });
      vi.mocked(adjustLampsTemperature).mockReturnValue(DONE);
    });

    it("steps each lamp from its own temperature on a turn on the main screen, and logs it", async () => {
      const dial = await deck.dial(TEMPERATURE, { stepKelvin: 100 });
      clearCalls();

      await deck.turn(dial, 2);

      expect(adjustLampsTemperature).toHaveBeenCalledExactlyOnceWith("all", 2, 100, "each");
      expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("each lamp"));
    });

    it("still turns the lamp on screen alone on a lamp screen", async () => {
      const dial = await deck.dial(TEMPERATURE, { stepKelvin: 100 });
      await deck.tap(dial);
      clearCalls();

      await deck.turn(dial, 2);

      expect(adjustLampsTemperature).toHaveBeenCalledExactlyOnceWith([BEAM.id], 2, 100, "together");
    });

    it("steps the lamps together when only the brightness difference is kept", async () => {
      changeGlobalSettings({ keepBrightnessDifference: true });
      const dial = await deck.dial(TEMPERATURE, { stepKelvin: 100 });

      await deck.turn(dial, 2);

      expect(adjustLampsTemperature).toHaveBeenCalledExactlyOnceWith("all", 2, 100, "together");
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
      vi.mocked(identifyLamp).mockResolvedValue({ ok: true, lampCount: 1, failures: 0 });

      await deck.hold(dial);

      expect(identifyLamp).toHaveBeenCalledExactlyOnceWith(BEAM.id, globalSettings.identifyBlinkMs.default);
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
      vi.mocked(toggleLamps).mockReturnValue({ ok: true, lampCount: 1, failures: 0 });

      await deck.push(dial);

      expect(toggleLamps).toHaveBeenCalledExactlyOnceWith([BEAM.id]);
      expect(identifyLamp).not.toHaveBeenCalled();
    });

    it("toggles every lamp on a push on the main screen", async () => {
      const pushed = await deck.dial(TEMPERATURE);
      const onLamp = await deck.dial(TEMPERATURE);
      await deck.tap(onLamp);
      vi.mocked(toggleLamps).mockReturnValue({ ok: true, lampCount: 1, failures: 0 });

      await deck.push(pushed);

      expect(toggleLamps).toHaveBeenCalledExactlyOnceWith("all");
    });

    it("moves only the lamp on screen when the dial is turned on a lamp screen (#20)", async () => {
      const dial = await deck.dial(TEMPERATURE, { stepKelvin: 100 });
      await deck.tap(dial);
      vi.mocked(adjustLampsTemperature).mockReturnValue(DONE);

      await deck.turn(dial, 3);

      expect(adjustLampsTemperature).toHaveBeenCalledExactlyOnceWith([BEAM.id], 3, 100, "together");
    });

    it("moves the lamps that were on screen as the dial turned, even when the strip is tapped before (#20)", async () => {
      // Each turn waits to be applied, as the debouncer holds the ticks for a moment.
      const waiting: Array<() => void | Promise<void>> = [];
      vi.mocked(createDialDebouncer).mockImplementation((flush) => (ticks) => {
        waiting.push(() => flush(ticks));
      });
      vi.mocked(readShownLamps).mockResolvedValue([BEAM, OTHER_BEAM]);
      vi.mocked(adjustLampsTemperature).mockReturnValue(DONE);
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
        ["all", 1, 100, "together"],
        [[BEAM.id], 2, 100, "together"],
        [[OTHER_BEAM.id], 3, 100, "together"],
      ]);
    });

    it("redraws the lamp on screen when the lamps change, not the temperature of every lamp", async () => {
      const onLamp = await deck.dial(TEMPERATURE);
      const onMain = await deck.dial(TEMPERATURE);
      await deck.tap(onLamp);
      clearCalls();

      await lampsChanged();

      expect(readShownLamps).toHaveBeenCalledOnce();
      expect(onLamp.setFeedback).toHaveBeenCalledOnce();
      expect(onLamp.setFeedback).not.toHaveBeenCalledWith(TEMPERATURE_SNAPPED);
      expect(onMain.setFeedback).toHaveBeenCalledExactlyOnceWith(TEMPERATURE_SNAPPED);
    });

    it("goes back to the main screen when the lamp on screen is no longer connected", async () => {
      const dial = await deck.dial(TEMPERATURE);
      await deck.tap(dial);
      vi.mocked(readShownLamps).mockResolvedValue([OTHER_BEAM]);

      await lampsChanged();

      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith("$B1");
      expect(dial.setFeedback).toHaveBeenLastCalledWith(TEMPERATURE_SNAPPED);
    });

    it("redraws the lamp on screen when the global settings change, and leaves the main screens", async () => {
      const onLamp = await deck.dial(TEMPERATURE);
      const onMain = await deck.dial(TEMPERATURE);
      await deck.tap(onLamp);
      clearCalls();

      changeGlobalSettings({ lampScreenBottomRight: "none" });
      await vi.runAllTimersAsync();

      expect(onLamp.setFeedback).toHaveBeenCalledOnce();
      expect(onMain.setFeedback).not.toHaveBeenCalled();
    });

    it("no longer redraws a dial that disappeared", async () => {
      const dial = await deck.dial(TEMPERATURE);
      await deck.tap(dial);
      await deck.remove(dial);
      clearCalls();

      await lampsChanged();

      expect(dial.setFeedback).not.toHaveBeenCalled();
      expect(readShownLamps).not.toHaveBeenCalled();
    });

    it("keeps a lamp screen drawn when the dial's settings change on it, and turns its lamp by the new step", async () => {
      const dial = await deck.dial(TEMPERATURE, { stepKelvin: 100 });
      await deck.tap(dial);
      clearCalls();
      vi.mocked(adjustLampsTemperature).mockReturnValue(DONE);

      await deck.changeSettings(dial, { stepKelvin: 200 });

      expect(dial.setFeedbackLayout).not.toHaveBeenCalled();
      expect(dial.setFeedback).not.toHaveBeenCalled();

      await deck.turn(dial, 1);

      expect(adjustLampsTemperature).toHaveBeenCalledExactlyOnceWith([BEAM.id], 1, 200, "together");
    });
  });

  describe("logs", () => {
    beforeEach(() => {
      vi.mocked(toggleLamps).mockReturnValue({ ok: true, lampCount: 1, failures: 0 });
      vi.mocked(identifyLamp).mockResolvedValue({ ok: true, lampCount: 1, failures: 0 });
    });

    it("a key press, with the key's preset, before changing the lamps", async () => {
      const key = await deck.key(TEMPERATURE, { presetKelvin: 4050 });
      vi.mocked(setLampsTemperature).mockReturnValue(DONE);

      await deck.press(key);

      expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("4050 K"));
      expect(at(vi.mocked(logger.info).mock.invocationCallOrder, 0)).toBeLessThan(
        at(vi.mocked(setLampsTemperature).mock.invocationCallOrder, 0),
      );
    });

    it("a dial turn, with its ticks and the dial's step", async () => {
      const dial = await deck.dial(TEMPERATURE, { stepKelvin: 100 });
      vi.mocked(adjustLampsTemperature).mockReturnValue(DONE);

      await deck.turn(dial, 3);

      const [message] = at(vi.mocked(logger.info).mock.calls, 0);
      expect(message).toContain("3 ticks");
      expect(message).toContain("100 K");
    });

    it("a dial turn on a lamp screen, with its ticks and the dial's step", async () => {
      const dial = await deck.dial(TEMPERATURE, { stepKelvin: 100 });
      await deck.tap(dial);
      vi.mocked(logger.info).mockClear();
      vi.mocked(adjustLampsTemperature).mockReturnValue(DONE);

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
