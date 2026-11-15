import type { JsonObject } from "@elgato/utils";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { BrightnessAction } from "../actions/brightness";
import { TemperatureAction } from "../actions/temperature";
import {
  adjustLampsBrightness,
  adjustLampsTemperature,
  identifyLamp,
  type OperationResult,
  onLampsChanged,
  setLampsBrightness,
  setLampsTemperature,
  toggleLamps,
} from "../lamps/manager";
import { logger } from "../logging";
import { syncGlobalSettings } from "../settings/global-settings";
import { globalSettings } from "../settings/schema";
import { at } from "../test-support/at";
import { FakeDeck } from "../test-support/fake-deck";
import { changeGlobalSettings } from "../test-support/fake-stream-deck";
import { reachedLamp } from "../test-support/reached-lamps";
import { createDebouncer } from "./debouncer";
import type { MeasureAction } from "./measure";
import { brightnessShown, findLampsShown, lampsShown, temperatureShown } from "./shown";

//* Fakes

vi.mock("@elgato/streamdeck", () => import("../test-support/fake-stream-deck"));

// The real logger writes to a logs/ folder.
vi.mock("../logging", () => import("../test-support/fake-logging"));

// The debouncer gathers what each test says, without the timing its own tests check.
vi.mock("./debouncer", () => ({ createDebouncer: vi.fn() }));

// What the keys and dials show of the lamps, which each test sets, with the real text it's shown as.
vi.mock("./shown", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./shown")>()),
  brightnessShown: vi.fn(),
  findLampsShown: vi.fn(),
  lampsShown: vi.fn(),
  temperatureShown: vi.fn(),
}));

// The real lamp manager loads node-hid's native binary on import and talks to real lamps.
vi.mock("../lamps/manager", () => ({
  adjustLampsBrightness: vi.fn(),
  adjustLampsTemperature: vi.fn(),
  identifyLamp: vi.fn(),
  onLampsChanged: vi.fn(),
  setLampsBrightness: vi.fn(),
  setLampsTemperature: vi.fn(),
  toggleLamps: vi.fn(),
}));

/** How an operation on two Beams went. */
const DONE: OperationResult = { ok: true, lampCount: 2, failures: 0 };
const FAILED: OperationResult = { ...DONE, ok: false, failures: 1 };
const NO_LAMP: OperationResult = { ok: false, lampCount: 0, failures: 1 };

/** A Beam on a Stream Deck + XL's USB hub, at its cap, which the lamp screens show. */
const AT_ITS_CAP = { on: true, lumen: 324, kelvin: 2700 };

const BEAM = reachedLamp("00000000000000a1", AT_ITS_CAP);

const OTHER_BEAM = reachedLamp("00000000000000b2", AT_ITS_CAP);

/**
 * One of the two actions built on `measure.ts`, with what's its own: its keys' preset and its dials' step, as their
 * settings save them, what its main screen shows of the lamps, and how many lamps it shows, and its global setting
 * for keeping the lamps' difference (#145).
 */
type Measured = {
  name: string;
  uuid: string;
  create: () => MeasureAction;
  set: Mock;
  adjust: Mock;
  shown: Mock;
  /** Shows the lamps the main screen shows, or none. */
  showLamps: () => void;
  showNoLamp: () => void;
  /** What the main screen shows of those lamps, and of none. */
  main: JsonObject;
  unknown: JsonObject;
  preset: { setting: string; value: number; other: number; invalid: string; fallback: number; logged: string };
  step: { setting: string; value: number; other: number; text: string; fallback: number; logged: string };
  keepDifference: string;
  keepOtherDifference: string;
};

const BRIGHTNESS: Measured = {
  name: "Brightness",
  uuid: "com.daczarne.litra.brightness",
  create: () => new BrightnessAction(),
  set: vi.mocked(setLampsBrightness),
  adjust: vi.mocked(adjustLampsBrightness),
  shown: vi.mocked(brightnessShown),
  // Two Beams on a Stream Deck + XL's USB hub, which stopped at 63% and 79%, as the plugin holds them.
  showLamps: () => vi.mocked(brightnessShown).mockResolvedValue([63, 79]),
  showNoLamp: () => vi.mocked(brightnessShown).mockResolvedValue([]),
  // 79%, with the bar fainter from 63%, which only one lamp passes.
  main: {
    title: "Brightness",
    value: "79%",
    indicator: { value: 79, bar_fill_c: "0:#ffffff,0.797:#ffffff,0.798:#c0c0c0,1:#c0c0c0" },
  },
  unknown: { title: "Brightness", value: "—", indicator: { value: 0, bar_fill_c: "white" } },
  preset: { setting: "presetPercentage", value: 40, other: 70, invalid: "abc", fallback: 0, logged: "40%" },
  step: { setting: "stepPercentage", value: 5, other: 15, text: "20", fallback: 10, logged: "5%" },
  keepDifference: "keepBrightnessDifference",
  keepOtherDifference: "keepTemperatureDifference",
};

const TEMPERATURE: Measured = {
  name: "Temperature",
  uuid: "com.daczarne.litra.temperature",
  create: () => new TemperatureAction(),
  set: vi.mocked(setLampsTemperature),
  adjust: vi.mocked(adjustLampsTemperature),
  shown: vi.mocked(temperatureShown),
  // The first lamp at 4000 K, 34% of the way from a Beam's lowest temperature to its highest.
  showLamps: () => vi.mocked(temperatureShown).mockResolvedValue({ kelvin: 4000, percentage: 34 }),
  showNoLamp: () => vi.mocked(temperatureShown).mockResolvedValue(undefined),
  main: { title: "Temperature", value: "4000", indicator: 34 },
  unknown: { title: "Temperature", value: "—", indicator: 0 },
  preset: { setting: "presetKelvin", value: 5000, other: 6000, invalid: "warm", fallback: 2700, logged: "5000 K" },
  step: { setting: "stepKelvin", value: 100, other: 200, text: "400", fallback: 300, logged: "100 K" },
  keepDifference: "keepTemperatureDifference",
  keepOtherDifference: "keepBrightnessDifference",
};

// The global settings, which the tests change as a settings page does (#145).
await syncGlobalSettings();

afterEach(() => {
  vi.useRealTimers();
});

/** Forgets what placing the keys and dials did, so that a test checks only what its own interaction does. */
function clearCalls(): void {
  vi.clearAllMocks();
}

//* Tests

describe.each([BRIGHTNESS, TEMPERATURE])("the $name action's keys and dials", (measured) => {
  const { uuid, preset, step } = measured;
  let deck: FakeDeck;
  // What the action does when the lamp manager announces that the lamps changed.
  let lampsChanged: () => Promise<void>;

  beforeEach(() => {
    vi.useFakeTimers();
    changeGlobalSettings({});
    // The debouncer flushes every turn at once: its own timing is debouncer.test.ts's to check.
    vi.mocked(createDebouncer).mockImplementation((flush) => (ticks) => void flush(ticks));
    // The lamps, as a dial's main screen works them out, and as its lamp screens show them.
    measured.showLamps();
    vi.mocked(lampsShown).mockResolvedValue([BEAM]);
    // A tap finds the lamps, then shows what the plugin holds of them, which each test sets as lampsShown.
    vi.mocked(findLampsShown).mockImplementation(() => lampsShown());
    const action = measured.create();
    const listener = vi.mocked(onLampsChanged).mock.lastCall?.[0];
    if (listener === undefined) {
      throw new Error(`The ${measured.name} action didn't listen for lamp changes`);
    }
    lampsChanged = async () => listener();
    deck = new FakeDeck([action]);
  });

  describe("when the lamps change", () => {
    it("shows on every dial what the lamps are at, and leaves the keys' presets (#29)", async () => {
      const key = await deck.key(uuid, { [preset.setting]: preset.value });
      const dial = await deck.dial(uuid);
      const otherDial = await deck.dial(uuid);
      clearCalls();

      await lampsChanged();

      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(measured.main);
      expect(otherDial.setFeedback).toHaveBeenCalledExactlyOnceWith(measured.main);
      expect(key.setTitle).not.toHaveBeenCalled();
    });

    it("shows a dash when no lamp is connected", async () => {
      const dial = await deck.dial(uuid);
      clearCalls();
      measured.showNoLamp();

      await lampsChanged();

      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(measured.unknown);
    });

    it("works out nothing when no dial shows its main screen", async () => {
      await deck.key(uuid, { [preset.setting]: preset.value });
      const onLamp = await deck.dial(uuid);
      await deck.tap(onLamp);
      clearCalls();

      await lampsChanged();

      expect(measured.shown).not.toHaveBeenCalled();
      expect(onLamp.setFeedback).not.toHaveBeenCalledWith(measured.main);
    });
  });

  describe("on a key press", () => {
    it("sets the key's lamps alone, picked on the settings page (#20)", async () => {
      // A key that adds no new lamps acts on the lamps checked alone (#147).
      changeGlobalSettings({ addNewLamps: false });
      const key = await deck.key(uuid, { [preset.setting]: preset.value, lamps: ["lamp-1"] });
      clearCalls();
      measured.set.mockResolvedValue(DONE);

      await deck.press(key);

      expect(measured.set).toHaveBeenCalledExactlyOnceWith(["lamp-1"], preset.value);
      expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("1 lamp"));
    });

    it("sets the lamps to the key's preset, and leaves showing the result to the notice", async () => {
      const key = await deck.key(uuid, { [preset.setting]: preset.value });
      const dial = await deck.dial(uuid);
      clearCalls();
      measured.set.mockResolvedValue(DONE);

      await deck.press(key);

      expect(measured.set).toHaveBeenCalledWith("all", preset.value);
      expect(key.showAlert).not.toHaveBeenCalled();
      expect(dial.setFeedback).not.toHaveBeenCalled();
    });

    it.each([
      ["a lamp fails", FAILED],
      ["no lamp is connected", NO_LAMP],
    ])("shows an alert when %s", async (_when, result) => {
      const key = await deck.key(uuid, { [preset.setting]: preset.value });
      measured.set.mockResolvedValue(result);

      await deck.press(key);

      expect(key.showAlert).toHaveBeenCalledOnce();
    });
  });

  describe("on a dial turn", () => {
    it("moves the lamps by the dial's step, and leaves showing the result to the notice", async () => {
      const dial = await deck.dial(uuid, { [step.setting]: step.value });
      clearCalls();
      measured.adjust.mockResolvedValue(DONE);

      await deck.turn(dial, 3);

      expect(measured.adjust).toHaveBeenCalledWith("connected", 3, step.value, "together");
      expect(dial.setFeedback).not.toHaveBeenCalled();
    });

    it("shows an alert on the dial turned when a lamp fails", async () => {
      const turned = await deck.dial(uuid, { [step.setting]: step.value });
      const otherDial = await deck.dial(uuid);
      measured.adjust.mockResolvedValue(FAILED);

      await deck.turn(turned, 3);

      expect(turned.showAlert).toHaveBeenCalledOnce();
      expect(otherDial.showAlert).not.toHaveBeenCalled();
    });

    it("moves the lamps by a step saved as text, as a select saves it", async () => {
      const dial = await deck.dial(uuid, { [step.setting]: step.text });
      measured.adjust.mockResolvedValue(DONE);

      await deck.turn(dial, 3);

      expect(measured.adjust).toHaveBeenCalledExactlyOnceWith("connected", 3, Number(step.text), "together");
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  it("shows a key's preset as its title when it appears", async () => {
    const key = await deck.key(uuid, { [preset.setting]: preset.value });

    expect(key.setTitle).toHaveBeenCalledExactlyOnceWith(`${preset.value}`);
  });

  it("starts a dial that appears on the main screen, with what the lamps are at", async () => {
    const dial = await deck.dial(uuid);

    expect(dial.setFeedbackLayout).toHaveBeenCalledExactlyOnceWith("$B1");
    expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(measured.main);
  });

  it("shows a dash on a dial that appears while no lamp is connected", async () => {
    measured.showNoLamp();

    const dial = await deck.dial(uuid);

    expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(measured.unknown);
  });

  describe("when the settings page changes a setting", () => {
    it("shows a key's new preset as its title", async () => {
      const key = await deck.key(uuid, { [preset.setting]: preset.value });

      await deck.changeSettings(key, { [preset.setting]: preset.other });

      expect(key.setTitle).toHaveBeenLastCalledWith(`${preset.other}`);
    });

    it("redraws a dial with what the lamps are at", async () => {
      const dial = await deck.dial(uuid, { [step.setting]: step.value });
      clearCalls();

      await deck.changeSettings(dial, { [step.setting]: step.other });

      expect(measured.shown).toHaveBeenCalledOnce();
      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(measured.main);
    });
  });

  it("shows an alert on a dial pushed when the lamps can't be toggled, and leaves its screen as it was", async () => {
    const dial = await deck.dial(uuid);
    clearCalls();
    vi.mocked(toggleLamps).mockResolvedValue({ ok: false, lampCount: 0, failures: 1 });

    await deck.push(dial);

    expect(dial.showAlert).toHaveBeenCalledOnce();
    expect(dial.setFeedback).not.toHaveBeenCalled();
  });

  describe("with a setting that isn't valid (#22)", () => {
    it("sets the lamps to the default preset on a key press, warned about as the key appeared", async () => {
      const key = await deck.key(uuid, { [preset.setting]: preset.invalid });
      expect(logger.warn).toHaveBeenCalledOnce();
      clearCalls();
      measured.set.mockResolvedValue(DONE);

      await deck.press(key);

      expect(measured.set).toHaveBeenCalledExactlyOnceWith("all", preset.fallback);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("shows the default preset on the key, with a warning", async () => {
      const key = await deck.key(uuid, { [preset.setting]: preset.invalid });

      expect(key.setTitle).toHaveBeenCalledExactlyOnceWith(`${preset.fallback}`);
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(preset.setting));
    });

    it("moves the lamps by the default step on a dial turn, warned about as the dial appeared", async () => {
      const dial = await deck.dial(uuid, { [step.setting]: 0 });
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(step.setting));
      clearCalls();
      measured.adjust.mockResolvedValue(DONE);

      await deck.turn(dial, 3);

      expect(measured.adjust).toHaveBeenCalledExactlyOnceWith("connected", 3, step.fallback, "together");
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe("with its difference kept (#145)", () => {
    beforeEach(() => {
      changeGlobalSettings({ [measured.keepDifference]: true });
      measured.adjust.mockResolvedValue(DONE);
    });

    it("steps each lamp from its own value on a turn on the main screen, and logs it", async () => {
      const dial = await deck.dial(uuid, { [step.setting]: step.value });
      clearCalls();

      await deck.turn(dial, 3);

      expect(measured.adjust).toHaveBeenCalledExactlyOnceWith("connected", 3, step.value, "each");
      expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("each lamp"));
    });

    it("still turns the lamp on screen alone on a lamp screen", async () => {
      const dial = await deck.dial(uuid, { [step.setting]: step.value });
      await deck.tap(dial);
      clearCalls();

      await deck.turn(dial, 3);

      expect(measured.adjust).toHaveBeenCalledExactlyOnceWith([BEAM.id], 3, step.value, "together");
    });

    it("steps the lamps together when only the other difference is kept", async () => {
      changeGlobalSettings({ [measured.keepOtherDifference]: true });
      const dial = await deck.dial(uuid, { [step.setting]: step.value });

      await deck.turn(dial, 3);

      expect(measured.adjust).toHaveBeenCalledExactlyOnceWith("connected", 3, step.value, "together");
    });
  });

  describe("with lamp screens", () => {
    it("shows a lamp screen on a tap, and the main screen again after the last lamp", async () => {
      const dial = await deck.dial(uuid);

      await deck.tap(dial);
      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith("layouts/lamp.json");

      await deck.tap(dial);
      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith("$B1");
      expect(dial.setFeedback).toHaveBeenLastCalledWith(measured.main);
    });

    it("blinks the lamp on screen on a hold, and stays on its screen (#20)", async () => {
      const dial = await deck.dial(uuid);
      await deck.tap(dial);
      vi.mocked(identifyLamp).mockResolvedValue({ ok: true, lampCount: 1, failures: 0 });

      await deck.hold(dial);

      expect(identifyLamp).toHaveBeenCalledExactlyOnceWith(BEAM.id, globalSettings.identifyBlinkMs.default);
      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith("layouts/lamp.json");
    });

    it("does nothing on a hold on the main screen", async () => {
      const dial = await deck.dial(uuid);
      clearCalls();

      await deck.hold(dial);

      expect(identifyLamp).not.toHaveBeenCalled();
      expect(dial.setFeedbackLayout).not.toHaveBeenCalled();
    });

    it("toggles only the lamp on screen on a push (#20)", async () => {
      const dial = await deck.dial(uuid);
      await deck.tap(dial);
      vi.mocked(toggleLamps).mockResolvedValue({ ok: true, lampCount: 1, failures: 0 });

      await deck.push(dial);

      expect(toggleLamps).toHaveBeenCalledExactlyOnceWith([BEAM.id]);
      expect(identifyLamp).not.toHaveBeenCalled();
    });

    it("toggles every lamp on a push on the main screen", async () => {
      const pushed = await deck.dial(uuid);
      const onLamp = await deck.dial(uuid);
      await deck.tap(onLamp);
      vi.mocked(toggleLamps).mockResolvedValue({ ok: true, lampCount: 1, failures: 0 });

      await deck.push(pushed);

      expect(toggleLamps).toHaveBeenCalledExactlyOnceWith("connected");
    });

    it("moves only the lamp on screen when the dial is turned on a lamp screen (#20)", async () => {
      const dial = await deck.dial(uuid, { [step.setting]: step.value });
      await deck.tap(dial);
      measured.adjust.mockResolvedValue(DONE);

      await deck.turn(dial, 3);

      expect(measured.adjust).toHaveBeenCalledExactlyOnceWith([BEAM.id], 3, step.value, "together");
    });

    it("moves the lamps on screen as the dial turned, even when the strip is tapped before (#20)", async () => {
      // Each turn waits to be applied, as the debouncer holds the ticks for a moment.
      const waiting: Array<() => void | Promise<void>> = [];
      vi.mocked(createDebouncer).mockImplementation((flush) => (ticks) => {
        waiting.push(() => flush(ticks));
      });
      vi.mocked(lampsShown).mockResolvedValue([BEAM, OTHER_BEAM]);
      measured.adjust.mockResolvedValue(DONE);
      const dial = await deck.dial(uuid, { [step.setting]: step.value });

      await deck.turn(dial, 1);
      await deck.tap(dial);
      await deck.turn(dial, 2);
      await deck.tap(dial);
      await deck.turn(dial, 3);
      for (const apply of waiting) {
        await apply();
      }

      expect(measured.adjust.mock.calls).toEqual([
        ["connected", 1, step.value, "together"],
        [[BEAM.id], 2, step.value, "together"],
        [[OTHER_BEAM.id], 3, step.value, "together"],
      ]);
    });

    it("redraws the lamp on screen when the lamps change, not the main screen", async () => {
      const onLamp = await deck.dial(uuid);
      const onMain = await deck.dial(uuid);
      await deck.tap(onLamp);
      clearCalls();

      await lampsChanged();

      expect(lampsShown).toHaveBeenCalledOnce();
      expect(onLamp.setFeedback).toHaveBeenCalledOnce();
      expect(onLamp.setFeedback).not.toHaveBeenCalledWith(measured.main);
      expect(onMain.setFeedback).toHaveBeenCalledExactlyOnceWith(measured.main);
    });

    it("goes back to the main screen when the lamp on screen is no longer connected", async () => {
      const dial = await deck.dial(uuid);
      await deck.tap(dial);
      vi.mocked(lampsShown).mockResolvedValue([OTHER_BEAM]);

      await lampsChanged();

      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith("$B1");
      expect(dial.setFeedback).toHaveBeenLastCalledWith(measured.main);
    });

    it("redraws the lamp on screen when the global settings change, and leaves the main screens", async () => {
      const onLamp = await deck.dial(uuid);
      const onMain = await deck.dial(uuid);
      await deck.tap(onLamp);
      clearCalls();

      changeGlobalSettings({ lampScreenBottomRight: "none" });
      await vi.runAllTimersAsync();

      expect(onLamp.setFeedback).toHaveBeenCalledOnce();
      expect(onMain.setFeedback).not.toHaveBeenCalled();
    });

    it("no longer redraws a dial that disappeared", async () => {
      const dial = await deck.dial(uuid);
      await deck.tap(dial);
      await deck.remove(dial);
      clearCalls();

      await lampsChanged();

      expect(dial.setFeedback).not.toHaveBeenCalled();
      expect(lampsShown).not.toHaveBeenCalled();
    });

    it("keeps a lamp screen drawn when the dial's settings change, and turns its lamp by the new step", async () => {
      const dial = await deck.dial(uuid, { [step.setting]: step.value });
      await deck.tap(dial);
      clearCalls();
      measured.adjust.mockResolvedValue(DONE);

      await deck.changeSettings(dial, { [step.setting]: step.other });

      expect(dial.setFeedbackLayout).not.toHaveBeenCalled();
      expect(dial.setFeedback).not.toHaveBeenCalled();

      await deck.turn(dial, 1);

      expect(measured.adjust).toHaveBeenCalledExactlyOnceWith([BEAM.id], 1, step.other, "together");
    });
  });

  describe("logs", () => {
    beforeEach(() => {
      vi.mocked(toggleLamps).mockResolvedValue({ ok: true, lampCount: 1, failures: 0 });
      vi.mocked(identifyLamp).mockResolvedValue({ ok: true, lampCount: 1, failures: 0 });
    });

    it("a key press, with the key's preset, before changing the lamps", async () => {
      const key = await deck.key(uuid, { [preset.setting]: preset.value });
      measured.set.mockResolvedValue(DONE);

      await deck.press(key);

      expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(preset.logged));
      expect(at(vi.mocked(logger.info).mock.invocationCallOrder, 0)).toBeLessThan(
        at(measured.set.mock.invocationCallOrder, 0),
      );
    });

    it("a dial turn, with its ticks and the dial's step", async () => {
      const dial = await deck.dial(uuid, { [step.setting]: step.value });
      measured.adjust.mockResolvedValue(DONE);

      await deck.turn(dial, 3);

      const [message] = at(vi.mocked(logger.info).mock.calls, 0);
      expect(message).toContain("3 ticks");
      expect(message).toContain(step.logged);
    });

    it("a single tick of a dial turn as one tick, either way", async () => {
      const dial = await deck.dial(uuid, { [step.setting]: step.value });
      measured.adjust.mockResolvedValue(DONE);

      await deck.turn(dial, 1);
      await deck.turn(dial, -1);

      expect(vi.mocked(logger.info).mock.calls).toEqual([
        [expect.stringContaining(`: 1 tick of ${step.logged}`)],
        [expect.stringContaining(`: -1 tick of ${step.logged}`)],
      ]);
    });

    it("a dial turn on a lamp screen, with its ticks and the dial's step", async () => {
      const dial = await deck.dial(uuid, { [step.setting]: step.value });
      await deck.tap(dial);
      vi.mocked(logger.info).mockClear();
      measured.adjust.mockResolvedValue(DONE);

      await deck.turn(dial, 3);

      const [message] = at(vi.mocked(logger.info).mock.calls, 0);
      expect(message).toContain("lamp screen");
      expect(message).toContain("3 ticks");
    });

    it("a dial push, with what it does", async () => {
      const dial = await deck.dial(uuid);

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
      const dial = await deck.dial(uuid);

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
