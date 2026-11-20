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
import { iconIn } from "../test-support/icons";
import { reachedLamp } from "../test-support/reached-lamps";
import { createDebouncer } from "./debouncer";
import { bar, barFill, type MainScreen, type Measure, MeasureAction } from "./measure";
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

/** A Beam on a Stream Deck + XL's USB hub, at its cap, which the lamp screens show. */
const AT_ITS_CAP = { on: true, lumen: 324, kelvin: 2700 };

const BEAM = reachedLamp("00000000000000a1", AT_ITS_CAP);

const OTHER_BEAM = reachedLamp("00000000000000b2", AT_ITS_CAP);

/** The glyph the fake dials' main screen draws its icon from: a square of its color. */
function fakeGlyph(size: number, { color }: { color: string }): string {
  return `<rect width="${size}" height="${size}" fill="${color}"/>`;
}

/** What the fake dials' main screen shows, whatever the lamps are at. */
const MAIN: MainScreen = { title: "Fake", value: "42 u", levels: [42] };

/**
 * What a dial shows of {@link MAIN}, with the icon, the value and the bar in the Primary style's color, as the default
 * settings give it.
 */
const SHOWN: FeedbackPayload = {
  heading: { value: "Fake", color: "#ffffff" },
  icon: iconIn(fakeGlyph),
  value: { value: "42 u", color: "#ffffff" },
  indicator: { value: 42, bar_fill_c: "#ffffff" },
};

/** What the fake dials step: by the step in their settings, or 2, under their title, if any, and what they show. */
const MEASURE = {
  adjusts: "Fake",
  readSettings: vi.fn((settings: JsonObject) => ({
    step: typeof settings.step === "number" ? settings.step : 2,
    title: typeof settings.title === "string" ? settings.title : "",
    startOn: typeof settings.startOn === "string" ? settings.startOn : "main",
    startColor: settings.startColor === "gold" ? ("gold" as const) : ("default" as const),
  })),
  unit: " u",
  stepping: vi.fn<Measure["stepping"]>(),
  turnsLampsOn: vi.fn<Measure["turnsLampsOn"]>(),
  adjust: vi.fn<Measure["adjust"]>(),
  glyph: fakeGlyph,
  mainScreen: vi.fn<Measure["mainScreen"]>(),
} satisfies Measure;

/** An action built on MeasureAction, as the Brightness and Temperature dial actions are, with fakes for what's theirs. */
@action({ UUID: FAKE })
class FakeMeasureAction extends MeasureAction {
  /** Steps through the fakes. */
  constructor() {
    super(logger, MEASURE);
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
  MEASURE.stepping.mockReturnValue("together");
  MEASURE.turnsLampsOn.mockReturnValue(false);
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

describe("a dial of a MeasureAction", () => {
  describe("on its main screen", () => {
    it("reads its settings through what it steps, and starts on the main screen when it appears", async () => {
      const dial = await deck.dial(FAKE, { step: 5 });

      expect(MEASURE.readSettings).toHaveBeenCalledExactlyOnceWith({ step: 5 }, logger);
      expect(dial.setFeedbackLayout).toHaveBeenCalledExactlyOnceWith("layouts/main.json");
      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(SHOWN);
    });

    it("redraws on every dial when the lamps change (#29)", async () => {
      const dial = await deck.dial(FAKE);
      const otherDial = await deck.dial(FAKE);
      clearCalls();

      await lampsChanged();

      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(SHOWN);
      expect(otherDial.setFeedback).toHaveBeenCalledExactlyOnceWith(SHOWN);
    });

    it("shows its value in the color of the text style the global settings give it (#183)", async () => {
      changeGlobalSettings({ mainScreenValueStyle: "accent", lampScreenAccentColor: "#ff8800" });
      await vi.runAllTimersAsync();
      const dial = await deck.dial(FAKE);

      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith({
        ...SHOWN,
        value: { value: "42 u", color: "#ff8800" },
      });
    });

    it("shows its title in the color of the text style the global settings give it, apart from its value's (#183)", async () => {
      changeGlobalSettings({ mainScreenTitleStyle: "accent", lampScreenAccentColor: "#ff8800" });
      await vi.runAllTimersAsync();
      const dial = await deck.dial(FAKE);

      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith({
        ...SHOWN,
        heading: { value: "Fake", color: "#ff8800" },
      });
    });

    it("draws its icon in the color of the text style the global settings give it, apart from its value's (#183)", async () => {
      changeGlobalSettings({ mainScreenIconStyle: "accent", lampScreenAccentColor: "#ff8800" });
      await vi.runAllTimersAsync();
      const dial = await deck.dial(FAKE);

      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith({ ...SHOWN, icon: iconIn(fakeGlyph, "#ff8800") });
    });

    it("draws its bar in the color of the text style the global settings give it, apart from its value's (#183)", async () => {
      changeGlobalSettings({ mainScreenBarStyle: "alert", lampScreenAlertColor: "#ff8800" });
      await vi.runAllTimersAsync();
      MEASURE.mainScreen.mockResolvedValue({ ...MAIN, levels: [21, 42] });
      const dial = await deck.dial(FAKE);

      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith({
        ...SHOWN,
        indicator: { value: 42, bar_fill_c: "0:#ff8800,0.5:#ff8800,0.501:#c06600,1:#c06600" },
      });
    });

    it("redraws on every dial when the color of its value's text style changes (#183)", async () => {
      changeGlobalSettings({ mainScreenValueStyle: "accent" });
      const dial = await deck.dial(FAKE);
      const otherDial = await deck.dial(FAKE);
      clearCalls();

      changeGlobalSettings({ mainScreenValueStyle: "accent", lampScreenAccentColor: "#ff8800" });
      await vi.runAllTimersAsync();

      const shown = { ...SHOWN, value: { value: "42 u", color: "#ff8800" } };
      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(shown);
      expect(otherDial.setFeedback).toHaveBeenCalledExactlyOnceWith(shown);
    });

    it("shows its own title in place of its action's, in the same color, and its action's again once it's empty (#181)", async () => {
      changeGlobalSettings({ mainScreenTitleStyle: "accent", lampScreenAccentColor: "#ff8800" });
      await vi.runAllTimersAsync();
      const dial = await deck.dial(FAKE, { title: "Desk" });
      const otherDial = await deck.dial(FAKE);

      await deck.changeSettings(dial, { title: "" });

      expect(dial.setFeedback).toHaveBeenCalledTimes(2);
      expect(dial.setFeedback).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ heading: { value: "Desk", color: "#ff8800" } }),
      );
      expect(dial.setFeedback).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ heading: { value: "Fake", color: "#ff8800" } }),
      );
      expect(otherDial.setFeedback).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ heading: { value: "Fake", color: "#ff8800" } }),
      );
    });

    it("keeps its own title when its action's changes, which the dials without one follow (#181)", async () => {
      const dial = await deck.dial(FAKE, { title: "Desk" });
      const otherDial = await deck.dial(FAKE);
      clearCalls();
      MEASURE.mainScreen.mockResolvedValue({ ...MAIN, title: "Changed" });

      changeGlobalSettings({ brightnessDialTitle: "Changed" });
      await vi.runAllTimersAsync();

      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ heading: { value: "Desk", color: "#ffffff" } }),
      );
      expect(otherDial.setFeedback).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ heading: { value: "Changed", color: "#ffffff" } }),
      );
    });

    it("redraws once the settings page changes its step", async () => {
      const dial = await deck.dial(FAKE, { step: 5 });
      clearCalls();

      await deck.changeSettings(dial, { step: 10 });

      expect(MEASURE.mainScreen).toHaveBeenCalledOnce();
      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(SHOWN);
    });

    it("moves every lamp connected by its step, and leaves showing the result to the notice", async () => {
      const dial = await deck.dial(FAKE, { step: 5 });
      clearCalls();

      await deck.turn(dial, 3);

      expect(MEASURE.adjust).toHaveBeenCalledExactlyOnceWith("connected", 3, 5, "together", false);
      expect(dial.setFeedback).not.toHaveBeenCalled();
    });

    it("steps each lamp from its own value when the global settings say so (#145), and logs it", async () => {
      MEASURE.stepping.mockReturnValue("each");
      const dial = await deck.dial(FAKE, { step: 5 });
      clearCalls();

      await deck.turn(dial, 3);

      expect(MEASURE.adjust).toHaveBeenCalledExactlyOnceWith("connected", 3, 5, "each", false);
      expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("each lamp"));
    });

    it("turns the lamps on as it steps them when the global settings say so for its main screen (#268)", async () => {
      MEASURE.turnsLampsOn.mockImplementation((screen) => screen === "main");
      const dial = await deck.dial(FAKE, { step: 5 });
      clearCalls();

      await deck.turn(dial, 3);

      expect(MEASURE.turnsLampsOn).toHaveBeenCalledWith("main", dial.id);
      expect(MEASURE.adjust).toHaveBeenCalledExactlyOnceWith("connected", 3, 5, "together", true);
      expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("turning lamps on"));
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

  describe("on the screen it starts on (#278)", () => {
    it("appears on its lamp's screen when the lamp is connected, with no main screen drawn first, nor a blink", async () => {
      vi.mocked(lampsShown).mockResolvedValue([BEAM, OTHER_BEAM]);
      changeGlobalSettings({ blinkOnLampScreen: true });
      await vi.runAllTimersAsync();

      const dial = await deck.dial(FAKE, { startOn: OTHER_BEAM.id });

      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith("layouts/lamp.json");
      expect(dial.setFeedback).toHaveBeenCalledOnce();
      expect(dial.setFeedback).not.toHaveBeenCalledWith(SHOWN);
      expect(identifyLamp).not.toHaveBeenCalled();
    });

    it("appears on its main screen while its lamp isn't connected, and goes to it once it is", async () => {
      const dial = await deck.dial(FAKE, { startOn: OTHER_BEAM.id });

      expect(dial.setFeedbackLayout).toHaveBeenCalledExactlyOnceWith("layouts/main.json");
      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(SHOWN);

      vi.mocked(lampsShown).mockResolvedValue([BEAM, OTHER_BEAM]);
      await lampsChanged();

      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith("layouts/lamp.json");
    });

    it("goes back to its main screen, drawn once, when its lamp is unplugged, and to the lamp again when it's back", async () => {
      vi.mocked(lampsShown).mockResolvedValue([BEAM, OTHER_BEAM]);
      const dial = await deck.dial(FAKE, { startOn: OTHER_BEAM.id });
      clearCalls();

      vi.mocked(lampsShown).mockResolvedValue([BEAM]);
      await lampsChanged();

      expect(dial.setFeedbackLayout).toHaveBeenCalledExactlyOnceWith("layouts/main.json");
      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(SHOWN);

      vi.mocked(lampsShown).mockResolvedValue([BEAM, OTHER_BEAM]);
      await lampsChanged();

      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith("layouts/lamp.json");
    });

    it("goes to the screen its settings page now chooses, until its strip is tapped", async () => {
      vi.mocked(lampsShown).mockResolvedValue([BEAM, OTHER_BEAM]);
      const dial = await deck.dial(FAKE);

      await deck.changeSettings(dial, { startOn: BEAM.id });
      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith("layouts/lamp.json");

      await deck.changeSettings(dial, { startOn: "main" });
      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith("layouts/main.json");
      expect(dial.setFeedback).toHaveBeenLastCalledWith(SHOWN);

      await deck.tap(dial);
      clearCalls();
      await deck.changeSettings(dial, { startOn: OTHER_BEAM.id });

      expect(dial.setFeedbackLayout).not.toHaveBeenCalled();
    });

    it("redraws the lamp it starts on in the color its settings page now gives it, wherever the taps got to it", async () => {
      vi.mocked(lampsShown).mockResolvedValue([BEAM, OTHER_BEAM]);
      const dial = await deck.dial(FAKE, { startOn: OTHER_BEAM.id });
      clearCalls();

      await deck.changeSettings(dial, { startOn: OTHER_BEAM.id, startColor: "gold" });

      expect(dial.setFeedbackLayout).not.toHaveBeenCalled();
      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ topLeft: expect.objectContaining({ color: "#f5c542" }) }),
      );

      await deck.tap(dial);
      await deck.tap(dial);
      await deck.tap(dial);
      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith("layouts/lamp.json");
      clearCalls();

      await deck.changeSettings(dial, { startOn: OTHER_BEAM.id });

      expect(dial.setFeedbackLayout).not.toHaveBeenCalled();
      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(
        expect.objectContaining({ topLeft: expect.objectContaining({ color: "#ffffff" }) }),
      );
    });

    it("stays where the taps got to, whatever the lamps do, until it appears again", async () => {
      vi.mocked(lampsShown).mockResolvedValue([BEAM, OTHER_BEAM]);
      const dial = await deck.dial(FAKE, { startOn: OTHER_BEAM.id });
      await deck.tap(dial);
      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith("layouts/main.json");

      await lampsChanged();

      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith("layouts/main.json");

      await deck.remove(dial);
      await deck.show(dial);

      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith("layouts/lamp.json");
    });
  });

  describe("with lamp screens", () => {
    it("shows a lamp screen on a tap, and the main screen again after the last lamp", async () => {
      const dial = await deck.dial(FAKE);

      await deck.tap(dial);
      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith("layouts/lamp.json");

      await deck.tap(dial);
      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith("layouts/main.json");
      expect(dial.setFeedback).toHaveBeenLastCalledWith(SHOWN);
    });

    it("works out no main screen while every dial shows a lamp screen", async () => {
      const onLamp = await deck.dial(FAKE);
      await deck.tap(onLamp);
      clearCalls();

      await lampsChanged();

      expect(MEASURE.mainScreen).not.toHaveBeenCalled();
      expect(onLamp.setFeedback).not.toHaveBeenCalledWith(SHOWN);
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

      expect(MEASURE.adjust).toHaveBeenCalledExactlyOnceWith([BEAM.id], 3, 5, "together", false);
    });

    it("turns the lamp on screen on as it steps it when the global settings say so for lamp screens (#268)", async () => {
      MEASURE.turnsLampsOn.mockImplementation((screen) => screen === "lamp");
      const dial = await deck.dial(FAKE, { step: 5 });
      await deck.tap(dial);

      await deck.turn(dial, 3);

      expect(MEASURE.turnsLampsOn).toHaveBeenCalledWith("lamp", dial.id);
      expect(MEASURE.adjust).toHaveBeenCalledExactlyOnceWith([BEAM.id], 3, 5, "together", true);
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
        ["connected", 1, 5, "together", false],
        [[BEAM.id], 2, 5, "together", false],
        [[OTHER_BEAM.id], 3, 5, "together", false],
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
      expect(onLamp.setFeedback).not.toHaveBeenCalledWith(SHOWN);
      expect(onMain.setFeedback).toHaveBeenCalledExactlyOnceWith(SHOWN);
    });

    it("goes back to the main screen when the lamp on screen is no longer connected", async () => {
      const dial = await deck.dial(FAKE);
      await deck.tap(dial);
      vi.mocked(lampsShown).mockResolvedValue([OTHER_BEAM]);

      await lampsChanged();

      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith("layouts/main.json");
      expect(dial.setFeedback).toHaveBeenLastCalledWith(SHOWN);
    });

    it("redraws the lamp on screen and the main screens when the global settings change (#183)", async () => {
      const onLamp = await deck.dial(FAKE);
      const onMain = await deck.dial(FAKE);
      await deck.tap(onLamp);
      clearCalls();

      changeGlobalSettings({ lampScreenBottomRight: "none" });
      await vi.runAllTimersAsync();

      expect(onLamp.setFeedback).toHaveBeenCalledOnce();
      expect(onLamp.setFeedback).not.toHaveBeenCalledWith(SHOWN);
      expect(onMain.setFeedback).toHaveBeenCalledExactlyOnceWith(SHOWN);
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

    it("keeps a lamp screen on its lamp when the dial's settings change, and turns the lamp by the new step", async () => {
      const dial = await deck.dial(FAKE, { step: 5 });
      await deck.tap(dial);
      clearCalls();

      await deck.changeSettings(dial, { step: 10 });

      expect(dial.setFeedbackLayout).not.toHaveBeenCalled();
      expect(dial.setFeedback).not.toHaveBeenCalledWith(SHOWN);

      await deck.turn(dial, 1);

      expect(MEASURE.adjust).toHaveBeenCalledExactlyOnceWith([BEAM.id], 1, 10, "together", false);
    });
  });
});

describe("a MeasureAction logs", () => {
  it("nothing for a key, which the manifest doesn't place it on", async () => {
    const key = await deck.key(FAKE);

    await deck.press(key);

    expect(logger.info).not.toHaveBeenCalled();
    expect(key.setTitle).not.toHaveBeenCalled();
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

describe("bar", () => {
  it("is filled up to the highest level, and banded by barFill", () => {
    expect(bar([63, 79], "#ffffff")).toEqual({
      value: 79,
      bar_fill_c: "0:#ffffff,0.797:#ffffff,0.798:#c0c0c0,1:#c0c0c0",
    });
  });

  it("is empty with no lamp", () => {
    expect(bar([], "#ffffff")).toEqual({ value: 0, bar_fill_c: "#ffffff" });
  });
});

describe("barFill", () => {
  it("is plain in its color for one lamp", () => {
    expect(barFill([79], "#ffffff")).toBe("#ffffff");
  });

  it("is plain in its color when every lamp is at the same level", () => {
    expect(barFill([50, 50], "#ffffff")).toBe("#ffffff");
  });

  it("is plain in its color when no lamp is lit or none is shown", () => {
    expect(barFill([0, 0], "#ffffff")).toBe("#ffffff");
    expect(barFill([], "#ffffff")).toBe("#ffffff");
  });

  it("is in its color up to the dimmest lamp, then fainter up to the brightest, placed as shares of the brightest", () => {
    expect(barFill([79, 63], "#ffffff")).toBe("0:#ffffff,0.797:#ffffff,0.798:#c0c0c0,1:#c0c0c0");
  });

  it("adds a fainter band for each level fewer lamps reach", () => {
    // Up to 25: all three lamps. Up to 50: two of them. Up to 100: one.
    expect(barFill([25, 50, 100], "#ffffff")).toBe(
      "0:#ffffff,0.25:#ffffff,0.251:#d5d5d5,0.5:#d5d5d5,0.501:#aaaaaa,1:#aaaaaa",
    );
  });

  it("counts lamps at the same level together", () => {
    expect(barFill([40, 80, 80], "#ffffff")).toBe("0:#ffffff,0.5:#ffffff,0.501:#d5d5d5,1:#d5d5d5");
  });

  it("is the color it's given, and fades each of its channels alike where fewer lamps reach (#183)", () => {
    expect(barFill([42], "#4dd0e1")).toBe("#4dd0e1");
    expect(barFill([63, 79], "#ff8800")).toBe("0:#ff8800,0.797:#ff8800,0.798:#c06600,1:#c06600");
  });

  it("fades a dark color towards white, since black has nothing darker to fade to (#183)", () => {
    expect(barFill([63, 79], "#000000")).toBe("0:#000000,0.797:#000000,0.798:#404040,1:#404040");
    expect(barFill([63, 79], "#333333")).toBe("0:#333333,0.797:#333333,0.798:#666666,1:#666666");
    expect(barFill([40, 80, 80], "#000000")).toBe("0:#000000,0.5:#000000,0.501:#2a2a2a,1:#2a2a2a");
  });

  it("is fainter from the start when a lamp is at 0%, since it lights none of the bar", () => {
    expect(barFill([0, 60], "#ffffff")).toBe("0:#c0c0c0,1:#c0c0c0");
  });
});
