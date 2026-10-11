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
import { createFakeDial, createFakeKey, type FakeAction, show } from "../test-support/fake-stream-deck";
import { BrightnessAction } from "./brightness";
import { LampScreens } from "./lamp-screens";

//* Fakes

vi.mock("@elgato/streamdeck", () => import("../test-support/fake-stream-deck"));

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

/** Two Beams on the Stream Deck + XL's USB hub, the brightest of which stops at 79%. */
const REACHED_AT_CAP: BroadcastResult = {
  ok: true,
  deviceCount: 2,
  failures: 0,
  representativeBrightnessPercentage: 79,
  representativeBrightnessLumen: 324,
};

const NO_LAMP: BroadcastResult = { ok: false, deviceCount: 0, failures: 1 };

function keyDown(key: FakeAction, presetPercentage: number) {
  return { action: key, payload: { settings: { presetPercentage } } } as never;
}

function dialRotate(dial: FakeAction, ticks: number) {
  return { action: dial, payload: { settings: { stepPercentage: 5 }, ticks } } as never;
}

function brightnessOn(percentage: number) {
  return { title: "Brightness", value: `${percentage}%`, indicator: percentage };
}

const UNKNOWN_BRIGHTNESS = { title: "Brightness", value: "—", indicator: 0 };

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

      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(brightnessOn(79));
      expect(otherDial.setFeedback).toHaveBeenCalledExactlyOnceWith(brightnessOn(79));
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
      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(brightnessOn(79));
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

      expect(turned.setFeedback).toHaveBeenCalledExactlyOnceWith(brightnessOn(79));
      expect(otherDial.setFeedback).toHaveBeenCalledExactlyOnceWith(brightnessOn(79));
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
      expect(otherDial.setFeedback).toHaveBeenCalledExactlyOnceWith(brightnessOn(79));
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
      expect(dial.setFeedback).toHaveBeenLastCalledWith(brightnessOn(79));
    });

    it("goes back to the brightness on a hold", async () => {
      const dial = createFakeDial();
      show(dial);
      const brightness = new BrightnessAction(lampScreens);
      await brightness.onTouchTap(touchTap(dial));

      await brightness.onTouchTap(touchTap(dial, true));

      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith("$B1");
      expect(dial.setFeedback).toHaveBeenLastCalledWith(brightnessOn(79));
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

      expect(onLamp.setFeedback).not.toHaveBeenCalledWith(brightnessOn(79));
      expect(onMain.setFeedback).toHaveBeenCalledExactlyOnceWith(brightnessOn(79));
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
      expect(pushed.setFeedback).toHaveBeenLastCalledWith(brightnessOn(79));
    });

    it("starts a dial that appears on the main screen", async () => {
      const dial = createFakeDial();
      show(dial);

      await new BrightnessAction(lampScreens).onWillAppear({ action: dial, payload: { settings: {} } } as never);

      expect(dial.setFeedbackLayout).toHaveBeenCalledExactlyOnceWith("$B1");
      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(brightnessOn(79));
    });
  });
});
