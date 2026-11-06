import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { followGlobalSettings } from "../global-settings";
import type { LampStatus } from "../lamps-shown";
import {
  adjustLampsBrightness,
  identifyLamp,
  type OperationResult,
  onLampsChanged,
  setLampsBrightness,
  toggleLamps,
} from "../litra-manager";
import { logger } from "../logging";
import { at } from "../test-support/at";
import { FakeDeck } from "../test-support/fake-deck";
import { changeGlobalSettings } from "../test-support/fake-stream-deck";
import { BrightnessAction, barFill } from "./brightness";
import { createDialDebouncer } from "./debouncer";
import { globalSettings } from "./settings";
import { findLampStatuses, readLampStatuses, readLampsBrightness } from "./shown";

//* Fakes

vi.mock("@elgato/streamdeck", () => import("../test-support/fake-stream-deck"));

// The real logger writes to a logs/ folder.
vi.mock("../logging", () => import("../test-support/fake-logging"));

// The debouncer gathers what each test says, without the timing its own tests check.
vi.mock("./debouncer", () => ({ createDialDebouncer: vi.fn() }));

// What the keys and dials show of the lamps, which each test sets.
vi.mock("./shown", () => ({ findLampStatuses: vi.fn(), readLampStatuses: vi.fn(), readLampsBrightness: vi.fn() }));

// The real litra-manager loads node-hid's native binary on import and talks to real lamps.
vi.mock("../litra-manager", () => ({
  adjustLampsBrightness: vi.fn(),
  findLamps: vi.fn(() => []),
  identifyLamp: vi.fn(),
  onLampsChanged: vi.fn(),
  reachEveryLamp: vi.fn(),
  useLamps: vi.fn(),
  setLampsBrightness: vi.fn(),
  toggleLamps: vi.fn(),
}));

const BRIGHTNESS = "com.daczarne.litra.brightness";

/** Two Beams on a Stream Deck + XL's USB hub, which stopped at 63% and 79%, as the plugin holds them. */
const AT_THEIR_CAPS = [63, 79];

/** How an operation on the two Beams went. */
const DONE: OperationResult = { ok: true, lampCount: 2, failures: 0 };
const FAILED: OperationResult = { ...DONE, ok: false, failures: 1 };
const NO_LAMP: OperationResult = { ok: false, lampCount: 0, failures: 1 };

/** What a dial shows of {@link AT_THEIR_CAPS}: 79%, with the bar fainter from 63%, which only one lamp passes. */
const AT_THE_CAPS = {
  title: "Brightness",
  value: "79%",
  indicator: { value: 79, bar_fill_c: "0:#ffffff,0.797:#ffffff,0.798:#c0c0c0,1:#c0c0c0" },
};

const UNKNOWN_BRIGHTNESS = { title: "Brightness", value: "—", indicator: { value: 0, bar_fill_c: "white" } };

const BEAM: LampStatus = {
  id: "lamp-A1",
  model: "Beam",
  label: "Beam - A1",
  on: true,
  brightnessLumen: 324,
  brightnessPercentage: 79,
  temperatureKelvin: 2700,
};

const OTHER_BEAM: LampStatus = { ...BEAM, id: "lamp-B2", label: "Beam - B2" };

let deck: FakeDeck;
// What the action does when litra-manager announces that the lamps changed.
let lampsChanged: () => Promise<void>;

// The global settings, which the tests change as a settings page does (#145).
followGlobalSettings();

beforeEach(() => {
  vi.useFakeTimers();
  changeGlobalSettings({});
  // The debouncer flushes every turn at once: its own timing is debouncer.test.ts's to check.
  vi.mocked(createDialDebouncer).mockImplementation((flush) => (ticks) => void flush(ticks));
  // The lamps, as a dial that appears or returns to its main screen reads them, and as the lamp screens read them.
  vi.mocked(readLampsBrightness).mockResolvedValue(AT_THEIR_CAPS);
  vi.mocked(readLampStatuses).mockResolvedValue([BEAM]);
  // A tap finds the lamps, then shows what the plugin holds of them, which each test sets as readLampStatuses.
  vi.mocked(findLampStatuses).mockImplementation(() => readLampStatuses());
  const brightness = new BrightnessAction();
  const listener = vi.mocked(onLampsChanged).mock.lastCall?.[0];
  if (listener === undefined) {
    throw new Error("BrightnessAction didn't listen for lamp changes");
  }
  lampsChanged = async () => listener();
  deck = new FakeDeck([brightness]);
});

afterEach(() => {
  vi.useRealTimers();
});

/** Forgets what placing the keys and dials did, so that a test checks only what its own interaction does. */
function clearCalls(): void {
  vi.clearAllMocks();
}

//* Tests

describe("BrightnessAction", () => {
  describe("when the lamps change", () => {
    it("shows on every dial the brightness the lamps reached, and leaves the keys' presets (#29)", async () => {
      const key = await deck.key(BRIGHTNESS, { presetPercentage: 100 });
      const dial = await deck.dial(BRIGHTNESS);
      const otherDial = await deck.dial(BRIGHTNESS);
      clearCalls();

      await lampsChanged();

      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(AT_THE_CAPS);
      expect(otherDial.setFeedback).toHaveBeenCalledExactlyOnceWith(AT_THE_CAPS);
      expect(key.setTitle).not.toHaveBeenCalled();
    });

    it("shows no brightness when no lamp is connected", async () => {
      const dial = await deck.dial(BRIGHTNESS);
      clearCalls();
      vi.mocked(readLampsBrightness).mockResolvedValue([]);

      await lampsChanged();

      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(UNKNOWN_BRIGHTNESS);
    });

    it("reads nothing when no dial shows the brightness", async () => {
      await deck.key(BRIGHTNESS, { presetPercentage: 100 });
      const onLamp = await deck.dial(BRIGHTNESS);
      await deck.tap(onLamp);
      clearCalls();

      await lampsChanged();

      expect(readLampsBrightness).not.toHaveBeenCalled();
      expect(onLamp.setFeedback).not.toHaveBeenCalledWith(AT_THE_CAPS);
    });
  });

  describe("on a key press", () => {
    it("sets the key's lamps alone, picked on the settings page (#20)", async () => {
      // A key that adds no new lamps acts on the lamps checked alone (#147).
      changeGlobalSettings({ addNewLamps: false });
      const lamps = ["lamp-1"];
      const key = await deck.key(BRIGHTNESS, { presetPercentage: 100, lamps });
      clearCalls();
      vi.mocked(setLampsBrightness).mockResolvedValue(DONE);

      await deck.press(key);

      expect(setLampsBrightness).toHaveBeenCalledExactlyOnceWith(["lamp-1"], 100);
      expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("1 lamp"));
    });

    it("sets the lamps to the key's preset, and leaves showing the result to the notice", async () => {
      const key = await deck.key(BRIGHTNESS, { presetPercentage: 100 });
      const dial = await deck.dial(BRIGHTNESS);
      clearCalls();
      vi.mocked(setLampsBrightness).mockResolvedValue(DONE);

      await deck.press(key);

      expect(setLampsBrightness).toHaveBeenCalledWith("all", 100);
      expect(key.showAlert).not.toHaveBeenCalled();
      expect(dial.setFeedback).not.toHaveBeenCalled();
    });

    it.each([
      ["a lamp fails", FAILED],
      ["no lamp is connected", NO_LAMP],
    ])("shows an alert when %s", async (_when, result) => {
      const key = await deck.key(BRIGHTNESS, { presetPercentage: 100 });
      vi.mocked(setLampsBrightness).mockResolvedValue(result);

      await deck.press(key);

      expect(key.showAlert).toHaveBeenCalledOnce();
    });
  });

  describe("on a dial turn", () => {
    it("moves the lamps by the dial's step, and leaves showing the result to the notice", async () => {
      const dial = await deck.dial(BRIGHTNESS, { stepPercentage: 5 });
      clearCalls();
      vi.mocked(adjustLampsBrightness).mockResolvedValue(DONE);

      await deck.turn(dial, 3);

      expect(adjustLampsBrightness).toHaveBeenCalledWith("all", 3, 5, "together");
      expect(dial.setFeedback).not.toHaveBeenCalled();
    });

    it("shows an alert on the dial turned when a lamp fails", async () => {
      const turned = await deck.dial(BRIGHTNESS, { stepPercentage: 5 });
      const otherDial = await deck.dial(BRIGHTNESS);
      vi.mocked(adjustLampsBrightness).mockResolvedValue(FAILED);

      await deck.turn(turned, 3);

      expect(turned.showAlert).toHaveBeenCalledOnce();
      expect(otherDial.showAlert).not.toHaveBeenCalled();
    });
  });

  it("shows a key's preset as its title when it appears", async () => {
    const key = await deck.key(BRIGHTNESS, { presetPercentage: 40 });

    expect(key.setTitle).toHaveBeenCalledExactlyOnceWith("40");
  });

  it("shows no brightness on a dial that appears while no lamp is connected", async () => {
    vi.mocked(readLampsBrightness).mockResolvedValue([]);

    const dial = await deck.dial(BRIGHTNESS);

    expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(UNKNOWN_BRIGHTNESS);
  });

  describe("when the settings page changes a setting", () => {
    it("shows a key's new preset as its title", async () => {
      const key = await deck.key(BRIGHTNESS, { presetPercentage: 40 });

      await deck.changeSettings(key, { presetPercentage: 70 });

      expect(key.setTitle).toHaveBeenLastCalledWith("70");
    });

    it("redraws a dial with what the lamps are at", async () => {
      const dial = await deck.dial(BRIGHTNESS, { stepPercentage: 5 });
      clearCalls();

      await deck.changeSettings(dial, { stepPercentage: 10 });

      expect(readLampsBrightness).toHaveBeenCalledOnce();
      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(AT_THE_CAPS);
    });
  });

  it("shows an alert on a dial pushed when the lamps can't be toggled, and leaves its screen as it was", async () => {
    const dial = await deck.dial(BRIGHTNESS);
    clearCalls();
    vi.mocked(toggleLamps).mockReturnValue({ ok: false, lampCount: 0, failures: 1 });

    await deck.push(dial);

    expect(dial.showAlert).toHaveBeenCalledOnce();
    expect(dial.setFeedback).not.toHaveBeenCalled();
  });

  describe("with a setting that isn't valid (#22)", () => {
    it("sets the lamps to the default preset on a key press, warned about as the key appeared", async () => {
      const key = await deck.key(BRIGHTNESS, { presetPercentage: "abc" });
      expect(logger.warn).toHaveBeenCalledOnce();
      clearCalls();
      vi.mocked(setLampsBrightness).mockResolvedValue(DONE);

      await deck.press(key);

      expect(setLampsBrightness).toHaveBeenCalledExactlyOnceWith("all", 0);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("shows the default preset on the key, with a warning", async () => {
      const key = await deck.key(BRIGHTNESS, { presetPercentage: "abc" });

      expect(key.setTitle).toHaveBeenCalledExactlyOnceWith("0");
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("presetPercentage"));
    });

    it("moves the lamps by the default step on a dial turn, warned about as the dial appeared", async () => {
      const dial = await deck.dial(BRIGHTNESS, { stepPercentage: 0 });
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("step"));
      clearCalls();
      vi.mocked(adjustLampsBrightness).mockResolvedValue(DONE);

      await deck.turn(dial, 3);

      expect(adjustLampsBrightness).toHaveBeenCalledExactlyOnceWith("all", 3, 10, "together");
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe("with the brightness difference kept (#145)", () => {
    beforeEach(() => {
      changeGlobalSettings({ keepBrightnessDifference: true });
      vi.mocked(adjustLampsBrightness).mockResolvedValue(DONE);
    });

    it("steps each lamp from its own brightness on a turn on the main screen, and logs it", async () => {
      const dial = await deck.dial(BRIGHTNESS, { stepPercentage: 5 });
      clearCalls();

      await deck.turn(dial, 3);

      expect(adjustLampsBrightness).toHaveBeenCalledExactlyOnceWith("all", 3, 5, "each");
      expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("each lamp"));
    });

    it("still turns the lamp on screen alone on a lamp screen", async () => {
      const dial = await deck.dial(BRIGHTNESS, { stepPercentage: 5 });
      await deck.tap(dial);
      clearCalls();

      await deck.turn(dial, 3);

      expect(adjustLampsBrightness).toHaveBeenCalledExactlyOnceWith([BEAM.id], 3, 5, "together");
    });

    it("steps the lamps together when only the temperature difference is kept", async () => {
      changeGlobalSettings({ keepTemperatureDifference: true });
      const dial = await deck.dial(BRIGHTNESS, { stepPercentage: 5 });

      await deck.turn(dial, 3);

      expect(adjustLampsBrightness).toHaveBeenCalledExactlyOnceWith("all", 3, 5, "together");
    });
  });

  describe("with lamp screens", () => {
    it("shows a lamp screen on a tap, and the brightness again after the last lamp", async () => {
      const dial = await deck.dial(BRIGHTNESS);

      await deck.tap(dial);
      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith("layouts/lamp.json");

      await deck.tap(dial);
      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith("$B1");
      expect(dial.setFeedback).toHaveBeenLastCalledWith(AT_THE_CAPS);
    });

    it("blinks the lamp on screen on a hold, and stays on its screen (#20)", async () => {
      const dial = await deck.dial(BRIGHTNESS);
      await deck.tap(dial);
      vi.mocked(identifyLamp).mockResolvedValue({ ok: true, lampCount: 1, failures: 0 });

      await deck.hold(dial);

      expect(identifyLamp).toHaveBeenCalledExactlyOnceWith(BEAM.id, globalSettings.identifyBlinkMs.default);
      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith("layouts/lamp.json");
    });

    it("does nothing on a hold on the main screen", async () => {
      const dial = await deck.dial(BRIGHTNESS);
      clearCalls();

      await deck.hold(dial);

      expect(identifyLamp).not.toHaveBeenCalled();
      expect(dial.setFeedbackLayout).not.toHaveBeenCalled();
    });

    it("toggles only the lamp on screen on a push (#20)", async () => {
      const dial = await deck.dial(BRIGHTNESS);
      await deck.tap(dial);
      vi.mocked(toggleLamps).mockReturnValue({ ok: true, lampCount: 1, failures: 0 });

      await deck.push(dial);

      expect(toggleLamps).toHaveBeenCalledExactlyOnceWith([BEAM.id]);
      expect(identifyLamp).not.toHaveBeenCalled();
    });

    it("toggles every lamp on a push on the main screen", async () => {
      const pushed = await deck.dial(BRIGHTNESS);
      const onLamp = await deck.dial(BRIGHTNESS);
      await deck.tap(onLamp);
      vi.mocked(toggleLamps).mockReturnValue({ ok: true, lampCount: 1, failures: 0 });

      await deck.push(pushed);

      expect(toggleLamps).toHaveBeenCalledExactlyOnceWith("all");
    });

    it("moves only the lamp on screen when the dial is turned on a lamp screen (#20)", async () => {
      const dial = await deck.dial(BRIGHTNESS, { stepPercentage: 5 });
      await deck.tap(dial);
      vi.mocked(adjustLampsBrightness).mockResolvedValue(DONE);

      await deck.turn(dial, 3);

      expect(adjustLampsBrightness).toHaveBeenCalledExactlyOnceWith([BEAM.id], 3, 5, "together");
    });

    it("moves the lamps that were on screen as the dial turned, even when the strip is tapped before (#20)", async () => {
      // Each turn waits to be applied, as the debouncer holds the ticks for a moment.
      const waiting: Array<() => void | Promise<void>> = [];
      vi.mocked(createDialDebouncer).mockImplementation((flush) => (ticks) => {
        waiting.push(() => flush(ticks));
      });
      vi.mocked(readLampStatuses).mockResolvedValue([BEAM, OTHER_BEAM]);
      vi.mocked(adjustLampsBrightness).mockResolvedValue(DONE);
      const dial = await deck.dial(BRIGHTNESS, { stepPercentage: 5 });

      await deck.turn(dial, 1);
      await deck.tap(dial);
      await deck.turn(dial, 2);
      await deck.tap(dial);
      await deck.turn(dial, 3);
      for (const apply of waiting) {
        await apply();
      }

      expect(vi.mocked(adjustLampsBrightness).mock.calls).toEqual([
        ["all", 1, 5, "together"],
        [[BEAM.id], 2, 5, "together"],
        [[OTHER_BEAM.id], 3, 5, "together"],
      ]);
    });

    it("redraws the lamp on screen when the lamps change, not the brightness of every lamp", async () => {
      const onLamp = await deck.dial(BRIGHTNESS);
      const onMain = await deck.dial(BRIGHTNESS);
      await deck.tap(onLamp);
      clearCalls();

      await lampsChanged();

      expect(readLampStatuses).toHaveBeenCalledOnce();
      expect(onLamp.setFeedback).toHaveBeenCalledOnce();
      expect(onLamp.setFeedback).not.toHaveBeenCalledWith(AT_THE_CAPS);
      expect(onMain.setFeedback).toHaveBeenCalledExactlyOnceWith(AT_THE_CAPS);
    });

    it("goes back to the main screen when the lamp on screen is no longer connected", async () => {
      const dial = await deck.dial(BRIGHTNESS);
      await deck.tap(dial);
      vi.mocked(readLampStatuses).mockResolvedValue([OTHER_BEAM]);

      await lampsChanged();

      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith("$B1");
      expect(dial.setFeedback).toHaveBeenLastCalledWith(AT_THE_CAPS);
    });

    it("redraws the lamp on screen when the global settings change, and leaves the main screens", async () => {
      const onLamp = await deck.dial(BRIGHTNESS);
      const onMain = await deck.dial(BRIGHTNESS);
      await deck.tap(onLamp);
      clearCalls();

      changeGlobalSettings({ lampScreenBottomRight: "none" });
      await vi.runAllTimersAsync();

      expect(onLamp.setFeedback).toHaveBeenCalledOnce();
      expect(onMain.setFeedback).not.toHaveBeenCalled();
    });

    it("no longer redraws a dial that disappeared", async () => {
      const dial = await deck.dial(BRIGHTNESS);
      await deck.tap(dial);
      await deck.remove(dial);
      clearCalls();

      await lampsChanged();

      expect(dial.setFeedback).not.toHaveBeenCalled();
      expect(readLampStatuses).not.toHaveBeenCalled();
    });

    it("keeps a lamp screen drawn when the dial's settings change on it, and turns its lamp by the new step", async () => {
      const dial = await deck.dial(BRIGHTNESS, { stepPercentage: 5 });
      await deck.tap(dial);
      clearCalls();
      vi.mocked(adjustLampsBrightness).mockResolvedValue(DONE);

      await deck.changeSettings(dial, { stepPercentage: 10 });

      expect(dial.setFeedbackLayout).not.toHaveBeenCalled();
      expect(dial.setFeedback).not.toHaveBeenCalled();

      await deck.turn(dial, 1);

      expect(adjustLampsBrightness).toHaveBeenCalledExactlyOnceWith([BEAM.id], 1, 10, "together");
    });

    it("starts a dial that appears on the main screen", async () => {
      const dial = await deck.dial(BRIGHTNESS);

      expect(dial.setFeedbackLayout).toHaveBeenCalledExactlyOnceWith("$B1");
      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(AT_THE_CAPS);
    });
  });

  describe("logs", () => {
    beforeEach(() => {
      vi.mocked(toggleLamps).mockReturnValue({ ok: true, lampCount: 1, failures: 0 });
      vi.mocked(identifyLamp).mockResolvedValue({ ok: true, lampCount: 1, failures: 0 });
    });

    it("a key press, with the key's preset, before changing the lamps", async () => {
      const key = await deck.key(BRIGHTNESS, { presetPercentage: 80 });
      vi.mocked(setLampsBrightness).mockResolvedValue(DONE);

      await deck.press(key);

      expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("80%"));
      expect(at(vi.mocked(logger.info).mock.invocationCallOrder, 0)).toBeLessThan(
        at(vi.mocked(setLampsBrightness).mock.invocationCallOrder, 0),
      );
    });

    it("a dial turn, with its ticks and the dial's step", async () => {
      const dial = await deck.dial(BRIGHTNESS, { stepPercentage: 5 });
      vi.mocked(adjustLampsBrightness).mockResolvedValue(DONE);

      await deck.turn(dial, 3);

      const [message] = at(vi.mocked(logger.info).mock.calls, 0);
      expect(message).toContain("3 ticks");
      expect(message).toContain("5%");
    });

    it("a dial turn on a lamp screen, with its ticks and the dial's step", async () => {
      const dial = await deck.dial(BRIGHTNESS, { stepPercentage: 5 });
      await deck.tap(dial);
      vi.mocked(logger.info).mockClear();
      vi.mocked(adjustLampsBrightness).mockResolvedValue(DONE);

      await deck.turn(dial, 3);

      const [message] = at(vi.mocked(logger.info).mock.calls, 0);
      expect(message).toContain("lamp screen");
      expect(message).toContain("3 ticks");
    });

    it("a dial push, with what it does", async () => {
      const dial = await deck.dial(BRIGHTNESS);

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
      const dial = await deck.dial(BRIGHTNESS);

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

describe("barFill", () => {
  it("is plain white for one lamp", () => {
    expect(barFill([79])).toBe("white");
  });

  it("is plain white when every lamp is at the same level", () => {
    expect(barFill([50, 50])).toBe("white");
  });

  it("is plain white when no lamp is lit or none could be read", () => {
    expect(barFill([0, 0])).toBe("white");
    expect(barFill([])).toBe("white");
  });

  it("is white up to the dimmest lamp, then fainter up to the brightest, placed as shares of the brightest", () => {
    expect(barFill([79, 63])).toBe("0:#ffffff,0.797:#ffffff,0.798:#c0c0c0,1:#c0c0c0");
  });

  it("adds a fainter band for each level fewer lamps reach", () => {
    // Up to 25: all three lamps. Up to 50: two of them. Up to 100: one.
    expect(barFill([25, 50, 100])).toBe("0:#ffffff,0.25:#ffffff,0.251:#d5d5d5,0.5:#d5d5d5,0.501:#aaaaaa,1:#aaaaaa");
  });

  it("counts lamps at the same level together", () => {
    expect(barFill([40, 80, 80])).toBe("0:#ffffff,0.5:#ffffff,0.501:#d5d5d5,1:#d5d5d5");
  });

  it("is fainter from the start when a lamp is at 0%, since it lights none of the bar", () => {
    expect(barFill([0, 60])).toBe("0:#c0c0c0,1:#c0c0c0");
  });
});
