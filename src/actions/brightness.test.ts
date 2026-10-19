import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  adjustBrightnessAllByPercentageSteps,
  type BroadcastResult,
  createDialDebouncer,
  identifyLamp,
  type LampStatus,
  onLampsChanged,
  readLampStatuses,
  readRepresentativeBrightnessPercentage,
  setBrightnessAllPercentage,
  toggleAll,
} from "../litra-manager";
import { logger } from "../logging";
import { at } from "../test-support/at";
import { FakeDeck } from "../test-support/fake-deck";
import { BrightnessAction, barFill } from "./brightness";
import { LampScreens } from "./lamp-screens";

//* Fakes

vi.mock("@elgato/streamdeck", () => import("../test-support/fake-stream-deck"));

// The real logger writes to a logs/ folder.
vi.mock("../logging", () => import("../test-support/fake-logging"));

// The real litra-manager loads node-hid's native binary on import and talks to real lamps.
vi.mock("../litra-manager", () => ({
  adjustBrightnessAllByPercentageSteps: vi.fn(),
  createDialDebouncer: vi.fn(),
  identifyLamp: vi.fn(),
  onLampsChanged: vi.fn(),
  readLampStatuses: vi.fn(),
  readRepresentativeBrightnessPercentage: vi.fn(),
  setBrightnessAllPercentage: vi.fn(),
  toggleAll: vi.fn(),
}));

const BRIGHTNESS = "com.daczarne.litra.brightness";

/** Two Beams on a Stream Deck + XL's USB hub, which stop at 63% and 79%. */
const REACHED_AT_CAP: BroadcastResult = {
  ok: true,
  deviceCount: 2,
  failures: 0,
  representativeBrightnessPercentage: 79,
  representativeBrightnessLumen: 324,
  brightnessPercentages: [63, 79],
};

const NO_LAMP: BroadcastResult = { ok: false, deviceCount: 0, failures: 1 };

/** What a dial shows of {@link REACHED_AT_CAP}: 79%, with the bar fainter from 63%, which only one lamp passes. */
const AT_THE_CAPS = {
  title: "Brightness",
  value: "79%",
  indicator: { value: 79, bar_fill_c: "0:#ffffff,0.797:#ffffff,0.798:#c0c0c0,1:#c0c0c0" },
};

const UNKNOWN_BRIGHTNESS = { title: "Brightness", value: "—", indicator: { value: 0, bar_fill_c: "white" } };

const BEAM: LampStatus = {
  serialNumber: "A1",
  model: "Beam",
  on: true,
  brightnessLumen: 324,
  brightnessPercentage: 79,
  temperatureKelvin: 2700,
};

const OTHER_BEAM: LampStatus = { ...BEAM, serialNumber: "B2" };

let deck: FakeDeck;
// What the action does when litra-manager announces that the lamps changed.
let lampsChanged: () => Promise<void>;

beforeEach(() => {
  vi.useFakeTimers();
  // The debouncer flushes every turn at once: its own timing is litra-manager's to test.
  vi.mocked(createDialDebouncer).mockImplementation((flush) => (ticks) => void flush(ticks));
  // The lamps, as a dial that appears or returns to its main screen reads them, and as the lamp screens read them.
  vi.mocked(readRepresentativeBrightnessPercentage).mockResolvedValue(REACHED_AT_CAP);
  vi.mocked(readLampStatuses).mockResolvedValue({ ok: true, lamps: [BEAM] });
  const brightness = new BrightnessAction(new LampScreens());
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
    it("shows on every dial the brightness the lamps reached, from one read, and leaves the keys' presets (#29)", async () => {
      const key = await deck.key(BRIGHTNESS, { presetPercentage: 100 });
      const dial = await deck.dial(BRIGHTNESS);
      const otherDial = await deck.dial(BRIGHTNESS);
      clearCalls();

      await lampsChanged();

      expect(readRepresentativeBrightnessPercentage).toHaveBeenCalledOnce();
      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(AT_THE_CAPS);
      expect(otherDial.setFeedback).toHaveBeenCalledExactlyOnceWith(AT_THE_CAPS);
      expect(key.setTitle).not.toHaveBeenCalled();
    });

    it("shows the brightness of the lamps it could read when one can't be read", async () => {
      const dial = await deck.dial(BRIGHTNESS);
      clearCalls();
      vi.mocked(readRepresentativeBrightnessPercentage).mockResolvedValue({
        ...REACHED_AT_CAP,
        ok: false,
        failures: 1,
      });

      await lampsChanged();

      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(AT_THE_CAPS);
    });

    it("shows no brightness when no lamp can be read", async () => {
      const dial = await deck.dial(BRIGHTNESS);
      clearCalls();
      vi.mocked(readRepresentativeBrightnessPercentage).mockResolvedValue(NO_LAMP);

      await lampsChanged();

      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(UNKNOWN_BRIGHTNESS);
    });

    it("reads nothing when no dial shows the brightness", async () => {
      await deck.key(BRIGHTNESS, { presetPercentage: 100 });
      const onLamp = await deck.dial(BRIGHTNESS);
      await deck.tap(onLamp);
      clearCalls();

      await lampsChanged();

      expect(readRepresentativeBrightnessPercentage).not.toHaveBeenCalled();
      expect(onLamp.setFeedback).not.toHaveBeenCalledWith(AT_THE_CAPS);
    });
  });

  describe("on a key press", () => {
    it("sets the lamps to the key's preset, and leaves showing the result to the notice", async () => {
      const key = await deck.key(BRIGHTNESS, { presetPercentage: 100 });
      const dial = await deck.dial(BRIGHTNESS);
      clearCalls();
      vi.mocked(setBrightnessAllPercentage).mockResolvedValue(REACHED_AT_CAP);

      await deck.press(key);

      expect(setBrightnessAllPercentage).toHaveBeenCalledWith(100);
      expect(key.showAlert).not.toHaveBeenCalled();
      expect(dial.setFeedback).not.toHaveBeenCalled();
    });

    it.each([
      ["a lamp fails", { ...REACHED_AT_CAP, ok: false, failures: 1 }],
      ["no lamp is connected", NO_LAMP],
    ])("shows an alert when %s", async (_when, result) => {
      const key = await deck.key(BRIGHTNESS, { presetPercentage: 100 });
      vi.mocked(setBrightnessAllPercentage).mockResolvedValue(result);

      await deck.press(key);

      expect(key.showAlert).toHaveBeenCalledOnce();
    });
  });

  describe("on a dial turn", () => {
    it("moves the lamps by the dial's step, and leaves showing the result to the notice", async () => {
      const dial = await deck.dial(BRIGHTNESS, { stepPercentage: 5 });
      clearCalls();
      vi.mocked(adjustBrightnessAllByPercentageSteps).mockResolvedValue(REACHED_AT_CAP);

      await deck.turn(dial, 3);

      expect(adjustBrightnessAllByPercentageSteps).toHaveBeenCalledWith(3, 5, "all");
      expect(dial.setFeedback).not.toHaveBeenCalled();
    });

    it("shows an alert on the dial turned when a lamp fails", async () => {
      const turned = await deck.dial(BRIGHTNESS, { stepPercentage: 5 });
      const otherDial = await deck.dial(BRIGHTNESS);
      vi.mocked(adjustBrightnessAllByPercentageSteps).mockResolvedValue({ ...REACHED_AT_CAP, ok: false, failures: 1 });

      await deck.turn(turned, 3);

      expect(turned.showAlert).toHaveBeenCalledOnce();
      expect(otherDial.showAlert).not.toHaveBeenCalled();
    });
  });

  it("shows a key's preset as its title when it appears", async () => {
    const key = await deck.key(BRIGHTNESS, { presetPercentage: 40 });

    expect(key.setTitle).toHaveBeenCalledExactlyOnceWith("40");
  });

  it("shows no brightness on a dial that appears while no lamp can be read", async () => {
    vi.mocked(readRepresentativeBrightnessPercentage).mockResolvedValue(NO_LAMP);

    const dial = await deck.dial(BRIGHTNESS);

    expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(UNKNOWN_BRIGHTNESS);
  });

  it("shows the brightness of the lamps it could read on a dial that appears while one can't be read", async () => {
    vi.mocked(readRepresentativeBrightnessPercentage).mockResolvedValue({ ...REACHED_AT_CAP, ok: false, failures: 1 });

    const dial = await deck.dial(BRIGHTNESS);

    expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(AT_THE_CAPS);
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

      expect(readRepresentativeBrightnessPercentage).toHaveBeenCalledOnce();
      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(AT_THE_CAPS);
    });
  });

  it("shows an alert on a dial pushed when the lamps can't be toggled, and leaves its screen as it was", async () => {
    const dial = await deck.dial(BRIGHTNESS);
    clearCalls();
    vi.mocked(toggleAll).mockReturnValue({ ok: false, deviceCount: 0, failures: 1 });

    await deck.push(dial);

    expect(dial.showAlert).toHaveBeenCalledOnce();
    expect(dial.setFeedback).not.toHaveBeenCalled();
  });

  describe("with a setting that isn't valid (#22)", () => {
    it("sets the lamps to the default preset on a key press, with a warning", async () => {
      const key = await deck.key(BRIGHTNESS, { presetPercentage: "abc" });
      clearCalls();
      vi.mocked(setBrightnessAllPercentage).mockResolvedValue(REACHED_AT_CAP);

      await deck.press(key);

      expect(setBrightnessAllPercentage).toHaveBeenCalledExactlyOnceWith(0);
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("presetPercentage"));
    });

    it("shows the default preset on the key, with a warning", async () => {
      const key = await deck.key(BRIGHTNESS, { presetPercentage: "abc" });

      expect(key.setTitle).toHaveBeenCalledExactlyOnceWith("0");
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("presetPercentage"));
    });

    it("moves the lamps by the default step on a dial turn, with a warning", async () => {
      const dial = await deck.dial(BRIGHTNESS, { stepPercentage: 0 });
      clearCalls();
      vi.mocked(adjustBrightnessAllByPercentageSteps).mockResolvedValue(REACHED_AT_CAP);

      await deck.turn(dial, 3);

      expect(adjustBrightnessAllByPercentageSteps).toHaveBeenCalledExactlyOnceWith(3, 10, "all");
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("stepPercentage"));
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
      vi.mocked(identifyLamp).mockResolvedValue({ ok: true, deviceCount: 1, failures: 0 });

      await deck.hold(dial);

      expect(identifyLamp).toHaveBeenCalledExactlyOnceWith(BEAM.serialNumber);
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
      vi.mocked(toggleAll).mockReturnValue({ ok: true, deviceCount: 1, failures: 0 });

      await deck.push(dial);

      expect(toggleAll).toHaveBeenCalledExactlyOnceWith([BEAM.serialNumber]);
      expect(identifyLamp).not.toHaveBeenCalled();
    });

    it("toggles every lamp on a push on the main screen", async () => {
      const pushed = await deck.dial(BRIGHTNESS);
      const onLamp = await deck.dial(BRIGHTNESS);
      await deck.tap(onLamp);
      vi.mocked(toggleAll).mockReturnValue({ ok: true, deviceCount: 1, failures: 0 });

      await deck.push(pushed);

      expect(toggleAll).toHaveBeenCalledExactlyOnceWith("all");
    });

    it("moves only the lamp on screen when the dial is turned on a lamp screen (#20)", async () => {
      const dial = await deck.dial(BRIGHTNESS, { stepPercentage: 5 });
      await deck.tap(dial);
      vi.mocked(adjustBrightnessAllByPercentageSteps).mockResolvedValue(REACHED_AT_CAP);

      await deck.turn(dial, 3);

      expect(adjustBrightnessAllByPercentageSteps).toHaveBeenCalledExactlyOnceWith(3, 5, [BEAM.serialNumber]);
    });

    it("moves the lamps that were on screen as the dial turned, even when the strip is tapped before (#20)", async () => {
      // Each turn waits to be applied, as the debouncer holds the ticks for a moment.
      const waiting: Array<() => void | Promise<void>> = [];
      vi.mocked(createDialDebouncer).mockImplementation((flush) => (ticks) => {
        waiting.push(() => flush(ticks));
      });
      vi.mocked(readLampStatuses).mockResolvedValue({ ok: true, lamps: [BEAM, OTHER_BEAM] });
      vi.mocked(adjustBrightnessAllByPercentageSteps).mockResolvedValue(REACHED_AT_CAP);
      const dial = await deck.dial(BRIGHTNESS, { stepPercentage: 5 });

      await deck.turn(dial, 1);
      await deck.tap(dial);
      await deck.turn(dial, 2);
      await deck.tap(dial);
      await deck.turn(dial, 3);
      for (const apply of waiting) {
        await apply();
      }

      expect(vi.mocked(adjustBrightnessAllByPercentageSteps).mock.calls).toEqual([
        [1, 5, "all"],
        [2, 5, [BEAM.serialNumber]],
        [3, 5, [OTHER_BEAM.serialNumber]],
      ]);
    });

    it("doesn't show the brightness on a dial that shows a lamp screen", async () => {
      const onLamp = await deck.dial(BRIGHTNESS);
      const onMain = await deck.dial(BRIGHTNESS);
      await deck.tap(onLamp);
      clearCalls();

      await lampsChanged();

      expect(onLamp.setFeedback).not.toHaveBeenCalled();
      expect(onMain.setFeedback).toHaveBeenCalledExactlyOnceWith(AT_THE_CAPS);
    });

    it("starts a dial that appears on the main screen", async () => {
      const dial = await deck.dial(BRIGHTNESS);

      expect(dial.setFeedbackLayout).toHaveBeenCalledExactlyOnceWith("$B1");
      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(AT_THE_CAPS);
    });
  });

  describe("logs", () => {
    beforeEach(() => {
      vi.mocked(toggleAll).mockReturnValue({ ok: true, deviceCount: 1, failures: 0 });
      vi.mocked(identifyLamp).mockResolvedValue({ ok: true, deviceCount: 1, failures: 0 });
    });

    it("a key press, with the key's preset, before changing the lamps", async () => {
      const key = await deck.key(BRIGHTNESS, { presetPercentage: 80 });
      vi.mocked(setBrightnessAllPercentage).mockResolvedValue(REACHED_AT_CAP);

      await deck.press(key);

      expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("80%"));
      expect(at(vi.mocked(logger.info).mock.invocationCallOrder, 0)).toBeLessThan(
        at(vi.mocked(setBrightnessAllPercentage).mock.invocationCallOrder, 0),
      );
    });

    it("a dial turn, with its ticks and the dial's step", async () => {
      const dial = await deck.dial(BRIGHTNESS, { stepPercentage: 5 });
      vi.mocked(adjustBrightnessAllByPercentageSteps).mockResolvedValue(REACHED_AT_CAP);

      await deck.turn(dial, 3);

      const [message] = at(vi.mocked(logger.info).mock.calls, 0);
      expect(message).toContain("3 ticks");
      expect(message).toContain("5%");
    });

    it("a dial turn on a lamp screen, with its ticks and the dial's step", async () => {
      const dial = await deck.dial(BRIGHTNESS, { stepPercentage: 5 });
      await deck.tap(dial);
      vi.mocked(logger.info).mockClear();
      vi.mocked(adjustBrightnessAllByPercentageSteps).mockResolvedValue(REACHED_AT_CAP);

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
