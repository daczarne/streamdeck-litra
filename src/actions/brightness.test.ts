import type { JsonValue } from "@elgato/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  adjustBrightnessAllByPercentageSteps,
  type BroadcastResult,
  createDialDebouncer,
  identifyLamp,
  type LampStatus,
  readLampStatuses,
  readRepresentativeBrightnessPercentage,
  setBrightnessAllPercentage,
  toggleAll,
} from "../litra-manager";
import { logger } from "../logging";
import { at } from "../test-support/at";
import { createFakeDial, createFakeKey, type FakeAction, show } from "../test-support/fake-stream-deck";
import { barFill, BrightnessAction } from "./brightness";
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

/** Two Beams on the Stream Deck + XL's USB hub, which stop at 63% and 79%. */
const REACHED_AT_CAP: BroadcastResult = {
  ok: true,
  deviceCount: 2,
  failures: 0,
  representativeBrightnessPercentage: 79,
  representativeBrightnessLumen: 324,
  brightnessPercentages: [63, 79],
};

const NO_LAMP: BroadcastResult = { ok: false, deviceCount: 0, failures: 1 };

function keyDown(key: FakeAction, presetPercentage: JsonValue) {
  return { action: key, payload: { settings: { presetPercentage } } } as never;
}

function willAppear(key: FakeAction, presetPercentage: JsonValue) {
  return { action: key, payload: { settings: { presetPercentage } } } as never;
}

function dialRotate(dial: FakeAction, ticks: number, stepPercentage: JsonValue = 5) {
  return { action: dial, payload: { settings: { stepPercentage }, ticks } } as never;
}

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

describe("BrightnessAction", () => {
  describe("on a key press", () => {
    it("sets the lamps to the key's preset", async () => {
      const key = createFakeKey();
      show(key);
      vi.mocked(setBrightnessAllPercentage).mockResolvedValue(REACHED_AT_CAP);

      await new BrightnessAction().onKeyDown(keyDown(key, 100));

      expect(setBrightnessAllPercentage).toHaveBeenCalledWith(100);
      expect(key.showAlert).not.toHaveBeenCalled();
    });

    it("shows on every dial the brightness the lamps reached, not the preset (#29)", async () => {
      const key = createFakeKey();
      const otherKey = createFakeKey();
      const dial = createFakeDial();
      const otherDial = createFakeDial();
      show(key, dial, otherKey, otherDial);
      vi.mocked(setBrightnessAllPercentage).mockResolvedValue(REACHED_AT_CAP);

      await new BrightnessAction().onKeyDown(keyDown(key, 100));

      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(AT_THE_CAPS);
      expect(otherDial.setFeedback).toHaveBeenCalledExactlyOnceWith(AT_THE_CAPS);
      // A key keeps showing its own preset.
      expect(key.setTitle).not.toHaveBeenCalled();
      expect(otherKey.setTitle).not.toHaveBeenCalled();
    });

    it("shows an alert when a lamp fails, and the brightness of the others on the dials", async () => {
      const key = createFakeKey();
      const dial = createFakeDial();
      show(key, dial);
      vi.mocked(setBrightnessAllPercentage).mockResolvedValue({ ...REACHED_AT_CAP, ok: false, failures: 1 });

      await new BrightnessAction().onKeyDown(keyDown(key, 100));

      expect(key.showAlert).toHaveBeenCalledOnce();
      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(AT_THE_CAPS);
    });

    it("shows an alert when no lamp is connected, and no brightness on the dials", async () => {
      const key = createFakeKey();
      const dial = createFakeDial();
      show(key, dial);
      vi.mocked(setBrightnessAllPercentage).mockResolvedValue(NO_LAMP);

      await new BrightnessAction().onKeyDown(keyDown(key, 100));

      expect(key.showAlert).toHaveBeenCalledOnce();
      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(UNKNOWN_BRIGHTNESS);
    });
  });

  describe("on a dial turn", () => {
    it("moves the lamps by the dial's step", async () => {
      const dial = createFakeDial();
      show(dial);
      vi.mocked(adjustBrightnessAllByPercentageSteps).mockResolvedValue(REACHED_AT_CAP);

      await new BrightnessAction().onDialRotate(dialRotate(dial, 3));
      await flushed();

      expect(adjustBrightnessAllByPercentageSteps).toHaveBeenCalledWith(3, 5);
    });

    it("shows the brightness the lamps reached on every dial, not only the one turned", async () => {
      const turned = createFakeDial();
      const otherDial = createFakeDial();
      const key = createFakeKey();
      show(turned, key, otherDial);
      vi.mocked(adjustBrightnessAllByPercentageSteps).mockResolvedValue(REACHED_AT_CAP);

      await new BrightnessAction().onDialRotate(dialRotate(turned, 3));
      await flushed();

      expect(turned.setFeedback).toHaveBeenCalledExactlyOnceWith(AT_THE_CAPS);
      expect(otherDial.setFeedback).toHaveBeenCalledExactlyOnceWith(AT_THE_CAPS);
      expect(key.setTitle).not.toHaveBeenCalled();
    });

    it("shows an alert on the dial turned when a lamp fails, and the brightness of the others on every dial", async () => {
      const turned = createFakeDial();
      const otherDial = createFakeDial();
      show(turned, otherDial);
      vi.mocked(adjustBrightnessAllByPercentageSteps).mockResolvedValue({ ...REACHED_AT_CAP, ok: false, failures: 1 });

      await new BrightnessAction().onDialRotate(dialRotate(turned, 3));
      await flushed();

      expect(turned.showAlert).toHaveBeenCalledOnce();
      expect(otherDial.showAlert).not.toHaveBeenCalled();
      expect(otherDial.setFeedback).toHaveBeenCalledExactlyOnceWith(AT_THE_CAPS);
    });
  });

  it("shows a key's preset as its title when it appears", async () => {
    const key = createFakeKey();
    show(key);

    await new BrightnessAction().onWillAppear(willAppear(key, 40));

    expect(key.setTitle).toHaveBeenCalledExactlyOnceWith("40");
  });

  describe("with a setting that isn't valid (#22)", () => {
    it("sets the lamps to the default preset on a key press, with a warning", async () => {
      const key = createFakeKey();
      show(key);
      vi.mocked(setBrightnessAllPercentage).mockResolvedValue(REACHED_AT_CAP);

      await new BrightnessAction().onKeyDown(keyDown(key, "abc"));

      expect(setBrightnessAllPercentage).toHaveBeenCalledExactlyOnceWith(0);
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("presetPercentage"));
    });

    it("shows the default preset on the key, with a warning", async () => {
      const key = createFakeKey();
      show(key);

      await new BrightnessAction().onWillAppear(willAppear(key, "abc"));

      expect(key.setTitle).toHaveBeenCalledExactlyOnceWith("0");
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("presetPercentage"));
    });

    it("moves the lamps by the default step on a dial turn, with a warning", async () => {
      const dial = createFakeDial();
      show(dial);
      vi.mocked(adjustBrightnessAllByPercentageSteps).mockResolvedValue(REACHED_AT_CAP);

      await new BrightnessAction().onDialRotate(dialRotate(dial, 3, 0));
      await flushed();

      expect(adjustBrightnessAllByPercentageSteps).toHaveBeenCalledExactlyOnceWith(3, 10);
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("stepPercentage"));
    });
  });

  describe("with lamp screens", () => {
    let lampScreens: LampScreens;

    beforeEach(() => {
      lampScreens = new LampScreens();
      vi.mocked(readLampStatuses).mockResolvedValue({ ok: true, lamps: [BEAM] });
      vi.mocked(readRepresentativeBrightnessPercentage).mockReturnValue(REACHED_AT_CAP);
    });

    it("shows a lamp screen on a tap, and the brightness again after the last lamp", async () => {
      const dial = createFakeDial();
      show(dial);
      const brightness = new BrightnessAction(lampScreens);

      await brightness.onTouchTap(touchTap(dial));
      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith("layouts/lamp.json");

      await brightness.onTouchTap(touchTap(dial));
      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith("$B1");
      expect(dial.setFeedback).toHaveBeenLastCalledWith(AT_THE_CAPS);
    });

    it("goes back to the brightness on a hold", async () => {
      const dial = createFakeDial();
      show(dial);
      const brightness = new BrightnessAction(lampScreens);
      await brightness.onTouchTap(touchTap(dial));

      await brightness.onTouchTap(touchTap(dial, true));

      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith("$B1");
      expect(dial.setFeedback).toHaveBeenLastCalledWith(AT_THE_CAPS);
    });

    it("does nothing when the dial is turned on a lamp screen", async () => {
      const dial = createFakeDial();
      show(dial);
      const brightness = new BrightnessAction(lampScreens);
      await brightness.onTouchTap(touchTap(dial));

      await brightness.onDialRotate(dialRotate(dial, 3));
      await flushed();

      expect(adjustBrightnessAllByPercentageSteps).not.toHaveBeenCalled();
    });

    it("doesn't show the brightness on a dial that shows a lamp screen", async () => {
      const key = createFakeKey();
      const onLamp = createFakeDial();
      const onMain = createFakeDial();
      show(key, onLamp, onMain);
      const brightness = new BrightnessAction(lampScreens);
      await brightness.onTouchTap(touchTap(onLamp));
      vi.mocked(setBrightnessAllPercentage).mockResolvedValue(REACHED_AT_CAP);

      await brightness.onKeyDown(keyDown(key, 0));

      expect(onLamp.setFeedback).not.toHaveBeenCalledWith(AT_THE_CAPS);
      expect(onMain.setFeedback).toHaveBeenCalledExactlyOnceWith(AT_THE_CAPS);
    });

    it("blinks the lamp on screen on a push, instead of toggling every lamp", async () => {
      const dial = createFakeDial();
      show(dial);
      const brightness = new BrightnessAction(lampScreens);
      await brightness.onTouchTap(touchTap(dial));
      vi.mocked(identifyLamp).mockResolvedValue({ ok: true, deviceCount: 1, failures: 0 });

      await brightness.onDialDown({ action: dial, payload: { settings: {} } } as never);

      expect(identifyLamp).toHaveBeenCalledExactlyOnceWith(BEAM.serialNumber);
      expect(toggleAll).not.toHaveBeenCalled();
    });

    it("toggles every lamp on a push on the main screen", async () => {
      const pushed = createFakeDial();
      const onLamp = createFakeDial();
      show(pushed, onLamp);
      const brightness = new BrightnessAction(lampScreens);
      await brightness.onTouchTap(touchTap(onLamp));
      vi.mocked(toggleAll).mockReturnValue({ ok: true, deviceCount: 1, failures: 0 });

      await brightness.onDialDown({ action: pushed, payload: { settings: {} } } as never);

      expect(toggleAll).toHaveBeenCalledOnce();
      expect(identifyLamp).not.toHaveBeenCalled();
      expect(pushed.setFeedback).toHaveBeenLastCalledWith(AT_THE_CAPS);
    });

    it("starts a dial that appears on the main screen", async () => {
      const dial = createFakeDial();
      show(dial);

      await new BrightnessAction(lampScreens).onWillAppear({ action: dial, payload: { settings: {} } } as never);

      expect(dial.setFeedbackLayout).toHaveBeenCalledExactlyOnceWith("$B1");
      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(AT_THE_CAPS);
    });
  });

  describe("logs", () => {
    let lampScreens: LampScreens;

    beforeEach(() => {
      lampScreens = new LampScreens();
      vi.mocked(readLampStatuses).mockResolvedValue({ ok: true, lamps: [BEAM] });
      vi.mocked(readRepresentativeBrightnessPercentage).mockReturnValue(REACHED_AT_CAP);
      vi.mocked(toggleAll).mockReturnValue({ ok: true, deviceCount: 1, failures: 0 });
      vi.mocked(identifyLamp).mockResolvedValue({ ok: true, deviceCount: 1, failures: 0 });
    });

    it("a key press, with the key's preset, before changing the lamps", async () => {
      const key = createFakeKey();
      show(key);
      vi.mocked(setBrightnessAllPercentage).mockResolvedValue(REACHED_AT_CAP);

      await new BrightnessAction().onKeyDown(keyDown(key, 80));

      expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("80%"));
      expect(at(vi.mocked(logger.info).mock.invocationCallOrder, 0)).toBeLessThan(
        at(vi.mocked(setBrightnessAllPercentage).mock.invocationCallOrder, 0),
      );
    });

    it("a dial turn, with its ticks and the dial's step", async () => {
      const dial = createFakeDial();
      show(dial);
      vi.mocked(adjustBrightnessAllByPercentageSteps).mockResolvedValue(REACHED_AT_CAP);

      await new BrightnessAction().onDialRotate(dialRotate(dial, 3));
      await flushed();

      const message = vi.mocked(logger.info).mock.calls[0]?.[0];
      expect(message).toContain("3 ticks");
      expect(message).toContain("5%");
    });

    it("a dial push, with what it does", async () => {
      const dial = createFakeDial();
      show(dial);
      const action = new BrightnessAction(lampScreens);

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
      const action = new BrightnessAction(lampScreens);

      await action.onTouchTap(touchTap(dial));
      await action.onTouchTap(touchTap(dial, true));

      expect(vi.mocked(logger.info).mock.calls).toEqual([
        [expect.stringContaining("tapped")],
        [expect.stringContaining("held")],
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
