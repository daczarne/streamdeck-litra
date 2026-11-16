import { action, type FeedbackPayload } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { identifyLamp, type OperationResult, onLampsChanged, toggleLamps } from "../lamps/manager";
import { logger } from "../logging";
import { syncGlobalSettings } from "../settings/global-settings";
import { globalSettingsSchema } from "../settings/schemas";
import { at } from "../test-support/at";
import { FakeDeck } from "../test-support/fake-deck";
import { changeGlobalSettings } from "../test-support/fake-stream-deck";
import { reachedLamp } from "../test-support/reached-lamps";
import { createDebouncer } from "./debouncer";
import { type Measure, MeasureAction, type Preset } from "./measure";
import { findLampsShown, lampsShown } from "./shown";

//* Fakes

vi.mock("@elgato/streamdeck", () => import("../test-support/fake-stream-deck"));

// The real logger writes to a logs/ folder.
vi.mock("../logging", () => import("../test-support/fake-logging"));

// The debouncer gathers what each test says, without the timing its own tests check.
vi.mock("./debouncer", () => ({ createDebouncer: vi.fn() }));

// The lamps the lamp screens show, which each test sets.
vi.mock("./shown", () => ({ findLampsShown: vi.fn(), lampsShown: vi.fn() }));

// The real lamp manager loads node-hid's native binary on import and talks to real lamps.
vi.mock("../lamps/manager", () => ({ identifyLamp: vi.fn(), onLampsChanged: vi.fn(), toggleLamps: vi.fn() }));

const FAKE = "com.daczarne.litra.fake-measure";

/** How an operation on two Beams went. */
const DONE: OperationResult = { ok: true, lampCount: 2, failures: 0 };
const FAILED: OperationResult = { ...DONE, ok: false, failures: 1 };
const NO_LAMP: OperationResult = { ok: false, lampCount: 0, failures: 1 };

/** A Beam on a Stream Deck + XL's USB hub, at its cap, which the lamp screens show. */
const AT_ITS_CAP = { on: true, lumen: 324, kelvin: 2700 };

const BEAM = reachedLamp("00000000000000a1", AT_ITS_CAP);

const OTHER_BEAM = reachedLamp("00000000000000b2", AT_ITS_CAP);

/** What the fake dials' main screen shows, whatever the lamps are at. */
const MAIN: FeedbackPayload = { title: "Fake", value: "42 u", indicator: 42 };

/** What the fake keys set: the preset in their settings, or 50, on the lamps checked, or every lamp. */
const PRESET = {
  read: vi.fn((settings: JsonObject) => ({
    preset: typeof settings.preset === "number" ? settings.preset : 50,
    lamps: Array.isArray(settings.lamps) ? settings.lamps.filter((id) => typeof id === "string") : ("all" as const),
    leftOutLamps: [],
  })),
  unit: " u",
  set: vi.fn<Preset["set"]>(),
} satisfies Preset;

/** What the fake dials step: by the step in their settings, or 2, and what they show. */
const MEASURE = {
  adjusts: "Fake",
  readStep: vi.fn((settings: JsonObject) => (typeof settings.step === "number" ? settings.step : 2)),
  unit: " u",
  stepping: vi.fn<Measure["stepping"]>(),
  adjust: vi.fn<Measure["adjust"]>(),
  mainScreen: vi.fn<Measure["mainScreen"]>(),
} satisfies Measure;

/**
 * An action built on MeasureAction, as the Set Brightness and Set Temperature actions are, with fakes for what's
 * theirs.
 */
@action({ UUID: FAKE })
class FakeMeasureAction extends MeasureAction {
  /** Sets and steps through the fakes. */
  constructor() {
    super(logger, PRESET, MEASURE);
  }
}

let deck: FakeDeck;
// What the action does when the lamp manager announces that the lamps changed.
let lampsChanged: () => Promise<void>;

// The global settings, which the tests change as a settings page does (#145, #147).
await syncGlobalSettings();

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  changeGlobalSettings({});
  // The debouncer flushes every turn at once: its own timing is debouncer.test.ts's to check.
  vi.mocked(createDebouncer).mockImplementation((flush) => (ticks) => void flush(ticks));
  PRESET.set.mockResolvedValue(DONE);
  MEASURE.stepping.mockReturnValue("together");
  MEASURE.adjust.mockResolvedValue(DONE);
  MEASURE.mainScreen.mockResolvedValue(MAIN);
  vi.mocked(lampsShown).mockResolvedValue([BEAM]);
  // A tap finds the lamps, then shows what the plugin holds of them, which each test sets as lampsShown.
  vi.mocked(findLampsShown).mockImplementation(() => lampsShown());
  vi.mocked(toggleLamps).mockResolvedValue({ ok: true, lampCount: 1, failures: 0 });
  vi.mocked(identifyLamp).mockResolvedValue({ ok: true, lampCount: 1, failures: 0 });
  const fake = new FakeMeasureAction();
  const listener = vi.mocked(onLampsChanged).mock.lastCall?.[0];
  if (listener === undefined) {
    throw new Error("The fake action didn't listen for lamp changes");
  }
  lampsChanged = async () => listener();
  deck = new FakeDeck([fake]);
});

afterEach(() => {
  vi.useRealTimers();
});

/** Forgets what placing the keys and dials did, so that a test checks only what its own interaction does. */
function clearCalls(): void {
  vi.clearAllMocks();
}

//* Tests

describe("a key of a MeasureAction", () => {
  it("reads its settings through what it sets, and shows its preset as its title when it appears", async () => {
    const key = await deck.key(FAKE, { preset: 40 });

    expect(PRESET.read).toHaveBeenCalledExactlyOnceWith({ preset: 40 }, logger);
    expect(key.setTitle).toHaveBeenCalledExactlyOnceWith("40");
  });

  it("shows a preset off the pages' grid rounded, as its title", async () => {
    const key = await deck.key(FAKE, { preset: 33.5 });

    expect(key.setTitle).toHaveBeenCalledExactlyOnceWith("34");
  });

  it("shows its new preset once the settings page changes it", async () => {
    const key = await deck.key(FAKE, { preset: 40 });

    await deck.changeSettings(key, { preset: 70 });

    expect(key.setTitle).toHaveBeenLastCalledWith("70");
  });

  it("sets every lamp to its preset, and leaves showing the result to the notice", async () => {
    const key = await deck.key(FAKE, { preset: 40 });
    const dial = await deck.dial(FAKE);
    clearCalls();

    await deck.press(key);

    expect(PRESET.set).toHaveBeenCalledExactlyOnceWith("all", 40);
    expect(key.showAlert).not.toHaveBeenCalled();
    expect(dial.setFeedback).not.toHaveBeenCalled();
  });

  it("sets its lamps alone, picked on the settings page (#20)", async () => {
    // A key that adds no new lamps acts on the lamps checked alone (#147).
    changeGlobalSettings({ addNewLamps: false });
    const key = await deck.key(FAKE, { preset: 40, lamps: ["lamp-1"] });
    clearCalls();

    await deck.press(key);

    expect(PRESET.set).toHaveBeenCalledExactlyOnceWith(["lamp-1"], 40);
    expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("1 lamp"));
  });

  it.each([
    ["a lamp fails", FAILED],
    ["no lamp is connected", NO_LAMP],
  ])("shows an alert when %s", async (_when, result) => {
    const key = await deck.key(FAKE);
    PRESET.set.mockResolvedValue(result);

    await deck.press(key);

    expect(key.showAlert).toHaveBeenCalledOnce();
  });

  it("follows no change to the lamps", async () => {
    const key = await deck.key(FAKE);
    clearCalls();

    await lampsChanged();

    expect(key.setTitle).not.toHaveBeenCalled();
  });
});

describe("a dial of a MeasureAction", () => {
  describe("on its main screen", () => {
    it("reads its step through what it steps, and starts on the main screen when it appears", async () => {
      const dial = await deck.dial(FAKE, { step: 5 });

      expect(MEASURE.readStep).toHaveBeenCalledExactlyOnceWith({ step: 5 }, logger);
      expect(dial.setFeedbackLayout).toHaveBeenCalledExactlyOnceWith("$B1");
      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(MAIN);
    });

    it("redraws on every dial when the lamps change (#29)", async () => {
      const dial = await deck.dial(FAKE);
      const otherDial = await deck.dial(FAKE);
      clearCalls();

      await lampsChanged();

      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(MAIN);
      expect(otherDial.setFeedback).toHaveBeenCalledExactlyOnceWith(MAIN);
    });

    it("redraws once the settings page changes its step", async () => {
      const dial = await deck.dial(FAKE, { step: 5 });
      clearCalls();

      await deck.changeSettings(dial, { step: 10 });

      expect(MEASURE.mainScreen).toHaveBeenCalledOnce();
      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(MAIN);
    });

    it("moves every lamp connected by its step, and leaves showing the result to the notice", async () => {
      const dial = await deck.dial(FAKE, { step: 5 });
      clearCalls();

      await deck.turn(dial, 3);

      expect(MEASURE.adjust).toHaveBeenCalledExactlyOnceWith("connected", 3, 5, "together");
      expect(dial.setFeedback).not.toHaveBeenCalled();
    });

    it("steps each lamp from its own value when the global settings say so (#145), and logs it", async () => {
      MEASURE.stepping.mockReturnValue("each");
      const dial = await deck.dial(FAKE, { step: 5 });
      clearCalls();

      await deck.turn(dial, 3);

      expect(MEASURE.adjust).toHaveBeenCalledExactlyOnceWith("connected", 3, 5, "each");
      expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("each lamp"));
    });

    it("shows an alert on the dial turned when a lamp fails", async () => {
      const turned = await deck.dial(FAKE);
      const otherDial = await deck.dial(FAKE);
      MEASURE.adjust.mockResolvedValue(FAILED);

      await deck.turn(turned, 3);

      expect(turned.showAlert).toHaveBeenCalledOnce();
      expect(otherDial.showAlert).not.toHaveBeenCalled();
    });

    it("toggles every lamp connected on a push", async () => {
      const pushed = await deck.dial(FAKE);
      const onLamp = await deck.dial(FAKE);
      await deck.tap(onLamp);
      clearCalls();

      await deck.push(pushed);

      expect(toggleLamps).toHaveBeenCalledExactlyOnceWith("connected");
    });

    it("shows an alert on a push when the lamps can't be toggled, and leaves its screen as it was", async () => {
      const dial = await deck.dial(FAKE);
      clearCalls();
      vi.mocked(toggleLamps).mockResolvedValue({ ok: false, lampCount: 0, failures: 1 });

      await deck.push(dial);

      expect(dial.showAlert).toHaveBeenCalledOnce();
      expect(dial.setFeedback).not.toHaveBeenCalled();
    });

    it("does nothing on a hold", async () => {
      const dial = await deck.dial(FAKE);
      clearCalls();

      await deck.hold(dial);

      expect(identifyLamp).not.toHaveBeenCalled();
      expect(dial.setFeedbackLayout).not.toHaveBeenCalled();
    });
  });

  describe("with lamp screens", () => {
    it("shows a lamp screen on a tap, and the main screen again after the last lamp", async () => {
      const dial = await deck.dial(FAKE);

      await deck.tap(dial);
      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith("layouts/lamp.json");

      await deck.tap(dial);
      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith("$B1");
      expect(dial.setFeedback).toHaveBeenLastCalledWith(MAIN);
    });

    it("works out no main screen while every dial shows a lamp screen", async () => {
      const onLamp = await deck.dial(FAKE);
      await deck.tap(onLamp);
      clearCalls();

      await lampsChanged();

      expect(MEASURE.mainScreen).not.toHaveBeenCalled();
      expect(onLamp.setFeedback).not.toHaveBeenCalledWith(MAIN);
    });

    it("blinks the lamp on screen on a hold, and stays on its screen (#20)", async () => {
      const dial = await deck.dial(FAKE);
      await deck.tap(dial);

      await deck.hold(dial);

      expect(identifyLamp).toHaveBeenCalledExactlyOnceWith(BEAM.id, globalSettingsSchema.identifyBlinkMs.default);
      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith("layouts/lamp.json");
    });

    it("toggles only the lamp on screen on a push (#20)", async () => {
      const dial = await deck.dial(FAKE);
      await deck.tap(dial);

      await deck.push(dial);

      expect(toggleLamps).toHaveBeenCalledExactlyOnceWith([BEAM.id]);
      expect(identifyLamp).not.toHaveBeenCalled();
    });

    it("moves only the lamp on screen, together whatever the global settings say (#20, #145)", async () => {
      MEASURE.stepping.mockReturnValue("each");
      const dial = await deck.dial(FAKE, { step: 5 });
      await deck.tap(dial);

      await deck.turn(dial, 3);

      expect(MEASURE.adjust).toHaveBeenCalledExactlyOnceWith([BEAM.id], 3, 5, "together");
    });

    it("moves the lamps on screen as the dial turned, even when the strip is tapped before (#20)", async () => {
      // Each turn waits to be applied, as the debouncer holds the ticks for a moment.
      const waiting: Array<() => void | Promise<void>> = [];
      vi.mocked(createDebouncer).mockImplementation((flush) => (ticks) => {
        waiting.push(() => flush(ticks));
      });
      vi.mocked(lampsShown).mockResolvedValue([BEAM, OTHER_BEAM]);
      const dial = await deck.dial(FAKE, { step: 5 });

      await deck.turn(dial, 1);
      await deck.tap(dial);
      await deck.turn(dial, 2);
      await deck.tap(dial);
      await deck.turn(dial, 3);
      for (const apply of waiting) {
        await apply();
      }

      expect(MEASURE.adjust.mock.calls).toEqual([
        ["connected", 1, 5, "together"],
        [[BEAM.id], 2, 5, "together"],
        [[OTHER_BEAM.id], 3, 5, "together"],
      ]);
    });

    it("redraws the lamp on screen when the lamps change, not the main screen", async () => {
      const onLamp = await deck.dial(FAKE);
      const onMain = await deck.dial(FAKE);
      await deck.tap(onLamp);
      clearCalls();

      await lampsChanged();

      expect(lampsShown).toHaveBeenCalledOnce();
      expect(onLamp.setFeedback).toHaveBeenCalledOnce();
      expect(onLamp.setFeedback).not.toHaveBeenCalledWith(MAIN);
      expect(onMain.setFeedback).toHaveBeenCalledExactlyOnceWith(MAIN);
    });

    it("goes back to the main screen when the lamp on screen is no longer connected", async () => {
      const dial = await deck.dial(FAKE);
      await deck.tap(dial);
      vi.mocked(lampsShown).mockResolvedValue([OTHER_BEAM]);

      await lampsChanged();

      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith("$B1");
      expect(dial.setFeedback).toHaveBeenLastCalledWith(MAIN);
    });

    it("redraws the lamp on screen when the global settings change, and leaves the main screens", async () => {
      const onLamp = await deck.dial(FAKE);
      const onMain = await deck.dial(FAKE);
      await deck.tap(onLamp);
      clearCalls();

      changeGlobalSettings({ lampScreenBottomRight: "none" });
      await vi.runAllTimersAsync();

      expect(onLamp.setFeedback).toHaveBeenCalledOnce();
      expect(onMain.setFeedback).not.toHaveBeenCalled();
    });

    it("no longer redraws a dial that disappeared", async () => {
      const dial = await deck.dial(FAKE);
      await deck.tap(dial);
      await deck.remove(dial);
      clearCalls();

      await lampsChanged();

      expect(dial.setFeedback).not.toHaveBeenCalled();
      expect(lampsShown).not.toHaveBeenCalled();
    });

    it("keeps a lamp screen drawn when the dial's settings change, and turns its lamp by the new step", async () => {
      const dial = await deck.dial(FAKE, { step: 5 });
      await deck.tap(dial);
      clearCalls();

      await deck.changeSettings(dial, { step: 10 });

      expect(dial.setFeedbackLayout).not.toHaveBeenCalled();
      expect(dial.setFeedback).not.toHaveBeenCalled();

      await deck.turn(dial, 1);

      expect(MEASURE.adjust).toHaveBeenCalledExactlyOnceWith([BEAM.id], 1, 10, "together");
    });
  });
});

describe("a MeasureAction logs", () => {
  it("a key press, with the key's preset in its unit, before changing the lamps", async () => {
    const key = await deck.key(FAKE, { preset: 40 });

    await deck.press(key);

    expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("preset 40 u"));
    expect(at(vi.mocked(logger.info).mock.invocationCallOrder, 0)).toBeLessThan(
      at(PRESET.set.mock.invocationCallOrder, 0),
    );
  });

  it("a dial turn, with its ticks and the dial's step in its unit", async () => {
    const dial = await deck.dial(FAKE, { step: 5 });

    await deck.turn(dial, 3);

    expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(": 3 ticks of 5 u"));
  });

  it("a single tick of a dial turn as one tick, either way", async () => {
    const dial = await deck.dial(FAKE, { step: 5 });

    await deck.turn(dial, 1);
    await deck.turn(dial, -1);

    expect(vi.mocked(logger.info).mock.calls).toEqual([
      [expect.stringContaining(": 1 tick of 5 u")],
      [expect.stringContaining(": -1 tick of 5 u")],
    ]);
  });

  it("a dial turn on a lamp screen, with its ticks", async () => {
    const dial = await deck.dial(FAKE, { step: 5 });
    await deck.tap(dial);
    vi.mocked(logger.info).mockClear();

    await deck.turn(dial, 3);

    const [message] = at(vi.mocked(logger.info).mock.calls, 0);
    expect(message).toContain("lamp screen");
    expect(message).toContain("3 ticks");
  });

  it("a dial push, with what it does", async () => {
    const dial = await deck.dial(FAKE);

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
    const dial = await deck.dial(FAKE);

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
