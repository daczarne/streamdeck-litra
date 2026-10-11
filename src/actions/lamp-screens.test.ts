import streamDeck from "@elgato/streamdeck";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { identifyLamp, type LampStatus, readLampStatuses } from "../litra-manager";
import { createFakeDial } from "../test-support/fake-stream-deck";
import { LampScreens, MAIN_LAYOUT } from "./lamp-screens";

//* Fakes

vi.mock("@elgato/streamdeck", () => import("../test-support/fake-stream-deck"));

// The real litra-manager loads node-hid's native binary on import and talks to real lamps.
vi.mock("../litra-manager", () => ({
  identifyLamp: vi.fn(),
  readLampStatuses: vi.fn(),
}));

const LAMP_LAYOUT = "layouts/lamp.json";

/** A Beam on the Stream Deck + XL's USB hub, at its cap. */
function beam(serialNumber: string, overrides: Partial<LampStatus> = {}): LampStatus {
  return {
    serialNumber,
    model: "Beam",
    on: true,
    brightnessLumen: 324,
    brightnessPercentage: 79,
    temperatureKelvin: 2700,
    ...overrides,
  };
}

/** Connects the lamps, which readLampStatuses reports sorted by serial number. */
function connect(...lamps: LampStatus[]): void {
  vi.mocked(readLampStatuses).mockResolvedValue({ ok: lamps.length > 0, lamps });
}

function lampScreenOf(lamp: LampStatus, position: number, count: number) {
  return {
    lamp: `${lamp.model} · ${position} of ${count}`,
    power: lamp.on ? "On" : "Off",
    brightness: `${lamp.brightnessPercentage}%`,
    lumens: `${lamp.brightnessLumen} lm`,
    temperature: `${lamp.temperatureKelvin} K`,
  };
}

const A = beam("A1");
const B = beam("B2", { on: false, brightnessLumen: 30, brightnessPercentage: 0, temperatureKelvin: 6500 });
const C = beam("C3");

let screens: LampScreens;
let showMain: () => Promise<void>;

beforeEach(() => {
  screens = new LampScreens();
  showMain = vi.fn(async () => {});
  connect(A, B);
});

//* Tests

describe("LampScreens", () => {
  describe("on a tap", () => {
    it("shows the first lamp from the main screen, on the lamp layout", async () => {
      const dial = createFakeDial();

      await screens.tap(dial, showMain);

      expect(dial.setFeedbackLayout).toHaveBeenCalledExactlyOnceWith(LAMP_LAYOUT);
      expect(dial.setTriggerDescription).toHaveBeenCalledExactlyOnceWith({
        push: "Identify",
        touch: "Next lamp",
        longTouch: "Back",
      });
      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(lampScreenOf(A, 1, 2));
      expect(screens.isShowing(dial.id)).toBe(true);
    });

    it("goes through every lamp, then back to the main screen", async () => {
      const dial = createFakeDial();

      await screens.tap(dial, showMain);
      await screens.tap(dial, showMain);

      // The layout only changes when the dial leaves the main screen.
      expect(dial.setFeedbackLayout).toHaveBeenCalledOnce();
      expect(dial.setFeedback).toHaveBeenLastCalledWith(lampScreenOf(B, 2, 2));

      await screens.tap(dial, showMain);

      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith(MAIN_LAYOUT);
      expect(dial.setTriggerDescription).toHaveBeenLastCalledWith();
      expect(showMain).toHaveBeenCalledOnce();
      expect(screens.isShowing(dial.id)).toBe(false);
    });

    it("skips a lamp unplugged since the last tap", async () => {
      const dial = createFakeDial();
      connect(A, B, C);
      await screens.tap(dial, showMain);
      await screens.tap(dial, showMain);
      connect(A, C);

      await screens.tap(dial, showMain);

      expect(dial.setFeedback).toHaveBeenLastCalledWith(lampScreenOf(C, 2, 2));
    });

    it("goes back to the main screen when no lamp comes after the one unplugged", async () => {
      const dial = createFakeDial();
      await screens.tap(dial, showMain);
      await screens.tap(dial, showMain);
      connect(A);

      await screens.tap(dial, showMain);

      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith(MAIN_LAYOUT);
      expect(showMain).toHaveBeenCalledOnce();
    });

    it("shows an alert and stays on the main screen when no lamp is connected", async () => {
      const dial = createFakeDial();
      connect();

      await screens.tap(dial, showMain);

      expect(dial.showAlert).toHaveBeenCalledOnce();
      expect(dial.setFeedbackLayout).not.toHaveBeenCalled();
      expect(screens.isShowing(dial.id)).toBe(false);
    });

    it("handles quick taps one at a time, in order", async () => {
      const dial = createFakeDial();

      await Promise.all([screens.tap(dial, showMain), screens.tap(dial, showMain)]);

      expect(dial.setFeedback.mock.calls).toEqual([[lampScreenOf(A, 1, 2)], [lampScreenOf(B, 2, 2)]]);
    });

    it("logs a failed read instead of failing", async () => {
      const dial = createFakeDial();
      vi.mocked(readLampStatuses).mockRejectedValueOnce(new Error("HID read failed"));

      await screens.tap(dial, showMain);
      await screens.tap(dial, showMain);

      expect(streamDeck.logger.error).toHaveBeenCalledOnce();
      // A failure doesn't hold up the next tap.
      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(lampScreenOf(A, 1, 2));
    });

    it("leaves the other dials as they are", async () => {
      const dial = createFakeDial();
      const otherDial = createFakeDial();

      await screens.tap(dial, showMain);

      expect(screens.isShowing(otherDial.id)).toBe(false);
      expect(otherDial.setFeedback).not.toHaveBeenCalled();
    });
  });

  describe("on identify", () => {
    it("blinks the lamp on the dial's screen", async () => {
      const dial = createFakeDial();
      vi.mocked(identifyLamp).mockResolvedValue({ ok: true, deviceCount: 1, failures: 0 });
      await screens.tap(dial, showMain);
      await screens.tap(dial, showMain);

      await screens.identify(dial);

      expect(identifyLamp).toHaveBeenCalledExactlyOnceWith(B.serialNumber);
      expect(dial.showAlert).not.toHaveBeenCalled();
    });

    it("shows an alert when the lamp can't be blinked", async () => {
      const dial = createFakeDial();
      vi.mocked(identifyLamp).mockResolvedValue({ ok: false, deviceCount: 0, failures: 1 });
      await screens.tap(dial, showMain);

      await screens.identify(dial);

      expect(dial.showAlert).toHaveBeenCalledOnce();
    });

    it("does nothing on the main screen", async () => {
      const dial = createFakeDial();

      await screens.identify(dial);

      expect(identifyLamp).not.toHaveBeenCalled();
    });
  });

  describe("going back to the main screen", () => {
    it("happens right away on a hold", async () => {
      const dial = createFakeDial();
      await screens.tap(dial, showMain);

      await screens.back(dial.id);

      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith(MAIN_LAYOUT);
      expect(showMain).toHaveBeenCalledOnce();
      expect(screens.isShowing(dial.id)).toBe(false);
    });

    it("does nothing on a hold from the main screen", async () => {
      const dial = createFakeDial();

      await screens.back(dial.id);

      expect(dial.setFeedbackLayout).not.toHaveBeenCalled();
    });

    it("doesn't happen on its own", async () => {
      vi.useFakeTimers();
      const dial = createFakeDial();
      await screens.tap(dial, showMain);

      await vi.advanceTimersByTimeAsync(60_000);
      vi.useRealTimers();

      expect(screens.isShowing(dial.id)).toBe(true);
      expect(showMain).not.toHaveBeenCalled();
    });
  });

  describe("on a refresh", () => {
    it("redraws every lamp screen from a fresh read, and leaves the main screens alone", async () => {
      const onA = createFakeDial();
      const onB = createFakeDial();
      const onMain = createFakeDial();
      await screens.tap(onA, showMain);
      await screens.tap(onB, showMain);
      await screens.tap(onB, showMain);
      const dimmedA = { ...A, brightnessLumen: 30, brightnessPercentage: 0 };
      const turnedOnB = { ...B, on: true };
      connect(dimmedA, turnedOnB);

      await screens.refresh();

      expect(onA.setFeedback).toHaveBeenLastCalledWith(lampScreenOf(dimmedA, 1, 2));
      expect(onB.setFeedback).toHaveBeenLastCalledWith(lampScreenOf(turnedOnB, 2, 2));
      expect(onMain.setFeedback).not.toHaveBeenCalled();
    });

    it("doesn't read the lamps when no dial shows a lamp screen", async () => {
      await screens.refresh();

      expect(readLampStatuses).not.toHaveBeenCalled();
    });

    it("sends a dial back to the main screen when its lamp is gone", async () => {
      const dial = createFakeDial();
      await screens.tap(dial, showMain);
      connect(B);

      await screens.refresh();

      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith(MAIN_LAYOUT);
      expect(showMain).toHaveBeenCalledOnce();
    });
  });

  describe("when a dial appears or disappears", () => {
    it("starts a dial that appears on the main screen, with the manifest's descriptions", async () => {
      const dial = createFakeDial();

      await screens.appear(dial);

      expect(dial.setFeedbackLayout).toHaveBeenCalledExactlyOnceWith(MAIN_LAYOUT);
      expect(dial.setTriggerDescription).toHaveBeenCalledExactlyOnceWith();
    });

    it.each([
      ["appears again", (dial: ReturnType<typeof createFakeDial>) => screens.appear(dial)],
      ["disappears", (dial: ReturnType<typeof createFakeDial>) => screens.disappear(dial.id)],
    ])("forgets the lamp screen of a dial that %s", async (_, event) => {
      const dial = createFakeDial();
      await screens.tap(dial, showMain);

      await event(dial);
      await screens.refresh();

      expect(screens.isShowing(dial.id)).toBe(false);
      // The refresh had no lamp screen left to redraw.
      expect(readLampStatuses).toHaveBeenCalledOnce();
    });
  });
});
