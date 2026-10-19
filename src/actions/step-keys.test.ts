import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  adjustLampsBrightness,
  adjustLampsTemperature,
  type BroadcastResult,
  createDialDebouncer,
  onLampsChanged,
  readLampsBrightness,
  readLampsTemperature,
} from "../litra-manager";
import { logger } from "../logging";
import { at } from "../test-support/at";
import { FakeDeck } from "../test-support/fake-deck";
import { BrightnessDownAction, BrightnessUpAction, TemperatureDownAction, TemperatureUpAction } from "./step-keys";

//* Fakes

vi.mock("@elgato/streamdeck", () => import("../test-support/fake-stream-deck"));

// The real logger writes to a logs/ folder.
vi.mock("../logging", () => import("../test-support/fake-logging"));

// The real litra-manager loads node-hid's native binary on import and talks to real lamps.
vi.mock("../litra-manager", () => ({
  adjustLampsBrightness: vi.fn(),
  adjustLampsTemperature: vi.fn(),
  createDialDebouncer: vi.fn(),
  onLampsChanged: vi.fn(),
  readLampsBrightness: vi.fn(),
  readLampsTemperature: vi.fn(),
}));

const BRIGHTNESS_UP = "com.daczarne.litra.brightness-up";
const BRIGHTNESS_DOWN = "com.daczarne.litra.brightness-down";
const TEMPERATURE_UP = "com.daczarne.litra.temperature-up";
const TEMPERATURE_DOWN = "com.daczarne.litra.temperature-down";

/** Two Beams on a Stream Deck + XL's USB hub, which stop at 63% and 79%, both at 4000 K. */
const LAMPS: BroadcastResult = {
  ok: true,
  deviceCount: 2,
  failures: 0,
  representativeBrightnessPercentage: 79,
  representativeBrightnessLumen: 324,
  brightnessPercentages: [63, 79],
  representativeTemperatureKelvin: 4000,
  representativeTemperaturePercentage: 34,
};

const NO_LAMP: BroadcastResult = { ok: false, deviceCount: 0, failures: 1 };

const FAILED: BroadcastResult = { ...LAMPS, ok: false, failures: 1 };

// Lamps as the settings page saves them, with their ids and labels (#20).
const LAMP_1 = { id: "lamp-1", label: "Beam - 1111" };
const LAMP_2 = { id: "lamp-2", label: "Beam - 2222" };

let deck: FakeDeck;
// What each action does when litra-manager announces that the lamps changed, in the order they were created.
let lampsChanged: () => Promise<void>;

beforeEach(() => {
  vi.useFakeTimers();
  // The debouncer flushes every press at once: its own timing is litra-manager's to test.
  vi.mocked(createDialDebouncer).mockImplementation((flush) => (presses) => void flush(presses));
  vi.mocked(readLampsBrightness).mockResolvedValue(LAMPS);
  vi.mocked(readLampsTemperature).mockResolvedValue(LAMPS);
  vi.mocked(adjustLampsBrightness).mockResolvedValue(LAMPS);
  vi.mocked(adjustLampsTemperature).mockReturnValue(LAMPS);
  const actions = [
    new BrightnessUpAction(),
    new BrightnessDownAction(),
    new TemperatureUpAction(),
    new TemperatureDownAction(),
  ];
  const listeners = vi.mocked(onLampsChanged).mock.calls.map(([listener]) => listener);
  if (listeners.length !== actions.length) {
    throw new Error("Not every step key listened for lamp changes");
  }
  lampsChanged = async () => {
    for (const listener of listeners) {
      await listener();
    }
  };
  deck = new FakeDeck(actions);
});

afterEach(() => {
  vi.useRealTimers();
});

/** Forgets what placing the keys did, so that a test checks only what its own interaction does. */
function clearCalls(): void {
  vi.clearAllMocks();
}

/** The title a key was last given. */
function titleOf(key: Awaited<ReturnType<FakeDeck["key"]>>): string | undefined {
  return at(key.setTitle.mock.calls, -1)[0];
}

//* Tests

describe("the step keys", () => {
  describe("on a key press", () => {
    it.each([
      ["Brightness Up", BRIGHTNESS_UP, { stepPercentage: 5 }, adjustLampsBrightness, ["all", 1, 5]],
      ["Brightness Down", BRIGHTNESS_DOWN, { stepPercentage: 5 }, adjustLampsBrightness, ["all", -1, 5]],
      ["Temperature Up", TEMPERATURE_UP, { stepKelvin: 200 }, adjustLampsTemperature, ["all", 1, 200]],
      ["Temperature Down", TEMPERATURE_DOWN, { stepKelvin: 200 }, adjustLampsTemperature, ["all", -1, 200]],
    ])(
      "%s moves the lamps one step of the key's, as a dial's tick does",
      async (_name, uuid, settings, adjust, args) => {
        const key = await deck.key(uuid, settings);
        clearCalls();

        await deck.press(key);

        expect(adjust).toHaveBeenCalledExactlyOnceWith(...args);
        expect(key.showAlert).not.toHaveBeenCalled();
        // The keys follow through the notice, which litra-manager sends.
        expect(key.setTitle).not.toHaveBeenCalled();
      },
    );

    it.each([
      ["Brightness Up", BRIGHTNESS_UP, adjustLampsBrightness, ["all", 1, 10]],
      ["Temperature Down", TEMPERATURE_DOWN, adjustLampsTemperature, ["all", -1, 300]],
    ])("%s steps by the dials' default step when the key has no settings", async (_name, uuid, adjust, args) => {
      const key = await deck.key(uuid);

      await deck.press(key);

      expect(adjust).toHaveBeenCalledExactlyOnceWith(...args);
    });

    it("moves the lamps by every press gathered, with the step the key has by then", async () => {
      // Gathers the presses until the test flushes them, as the debouncer gathers quick ones.
      let flushPending = async (): Promise<void> => {};
      vi.mocked(createDialDebouncer).mockImplementation((flush) => {
        let pending = 0;
        flushPending = async () => flush(pending);
        return (presses) => {
          pending += presses;
        };
      });
      const key = await deck.key(BRIGHTNESS_DOWN, { stepPercentage: 5 });

      await deck.press(key);
      await deck.press(key);
      await deck.changeSettings(key, { stepPercentage: 10 });
      await flushPending();

      expect(adjustLampsBrightness).toHaveBeenCalledExactlyOnceWith("all", -2, 10);
    });

    it.each([
      ["a lamp fails", FAILED],
      ["no lamp is connected", NO_LAMP],
    ])("shows an alert on the key pressed when %s", async (_when, result) => {
      const pressed = await deck.key(TEMPERATURE_UP);
      const other = await deck.key(TEMPERATURE_UP);
      vi.mocked(adjustLampsTemperature).mockReturnValue(result);

      await deck.press(pressed);

      expect(pressed.showAlert).toHaveBeenCalledOnce();
      expect(other.showAlert).not.toHaveBeenCalled();
    });
  });

  describe("show what the lamps are at as their title", () => {
    it("when placed: the brightest lamp's %, or the first lamp's temperature, as the dials show them", async () => {
      const brightnessKey = await deck.key(BRIGHTNESS_UP);
      const temperatureKey = await deck.key(TEMPERATURE_DOWN);

      expect(titleOf(brightnessKey)).toBe("79%");
      expect(titleOf(temperatureKey)).toBe("4000");
    });

    it("on every key, whichever key or dial changed the lamps, from one read per action", async () => {
      const keys = [await deck.key(BRIGHTNESS_UP), await deck.key(BRIGHTNESS_UP), await deck.key(TEMPERATURE_UP)];
      clearCalls();
      vi.mocked(readLampsBrightness).mockResolvedValue({
        ...LAMPS,
        brightnessPercentages: [40, 50],
      });
      vi.mocked(readLampsTemperature).mockResolvedValue({
        ...LAMPS,
        representativeTemperatureKelvin: 3300,
      });

      await lampsChanged();

      expect(keys.map(titleOf)).toEqual(["50%", "50%", "3300"]);
      expect(readLampsBrightness).toHaveBeenCalledOnce();
      expect(readLampsTemperature).toHaveBeenCalledOnce();
    });

    it("from the lamps that could be read, when one can't be", async () => {
      const key = await deck.key(BRIGHTNESS_DOWN);
      vi.mocked(readLampsBrightness).mockResolvedValue({ ...FAILED, brightnessPercentages: [63] });

      await lampsChanged();

      expect(titleOf(key)).toBe("63%");
    });

    it("as a dash when no lamp can be read", async () => {
      vi.mocked(readLampsBrightness).mockResolvedValue(NO_LAMP);
      vi.mocked(readLampsTemperature).mockResolvedValue(NO_LAMP);
      const brightnessKey = await deck.key(BRIGHTNESS_UP);
      const temperatureKey = await deck.key(TEMPERATURE_UP);

      expect([titleOf(brightnessKey), titleOf(temperatureKey)]).toEqual(["—", "—"]);
    });

    it("and read nothing for an action without a key on the Deck", async () => {
      await deck.key(BRIGHTNESS_UP);
      clearCalls();

      await lampsChanged();

      expect(readLampsBrightness).toHaveBeenCalledOnce();
      expect(readLampsTemperature).not.toHaveBeenCalled();
    });
  });

  describe("with a setting that isn't valid (#22)", () => {
    it("uses the default step and warns", async () => {
      const key = await deck.key(TEMPERATURE_UP, { stepKelvin: 250 });

      await deck.press(key);

      expect(adjustLampsTemperature).toHaveBeenCalledExactlyOnceWith("all", 1, 300);
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("stepKelvin"));
    });
  });

  describe("logs", () => {
    it("the presses and the key's step, before changing the lamps", async () => {
      const key = await deck.key(BRIGHTNESS_UP, { stepPercentage: 15 });

      await deck.press(key);

      const message = String(at(vi.mocked(logger.info).mock.calls, 0)[0]);
      expect(message).toContain("1 step");
      expect(message).toContain("15%");
      expect(at(vi.mocked(logger.info).mock.invocationCallOrder, 0)).toBeLessThan(
        at(vi.mocked(adjustLampsBrightness).mock.invocationCallOrder, 0),
      );
    });
  });

  describe("with lamps picked on the settings page (#20)", () => {
    it.each([
      ["Brightness Up", BRIGHTNESS_UP, { stepPercentage: 5 }, adjustLampsBrightness, 5],
      ["Temperature Down", TEMPERATURE_DOWN, { stepKelvin: 200 }, adjustLampsTemperature, 200],
    ])("%s steps the key's lamps alone", async (_name, uuid, settings, adjust, step) => {
      const key = await deck.key(uuid, { ...settings, lamps: [LAMP_1] });
      clearCalls();

      await deck.press(key);

      expect(adjust).toHaveBeenCalledExactlyOnceWith([LAMP_1.id], expect.any(Number), step);
    });

    it("shows on each key what its own lamps are at, from one read for each set of lamps", async () => {
      const onEvery = await deck.key(BRIGHTNESS_UP);
      const onFirst = await deck.key(BRIGHTNESS_UP, { lamps: [LAMP_1] });
      const alsoOnFirst = await deck.key(BRIGHTNESS_UP, { lamps: [LAMP_1] });
      const onSecond = await deck.key(BRIGHTNESS_UP, { lamps: [LAMP_2] });
      clearCalls();
      // Lamp 1 at 63%, lamp 2 at 79%.
      vi.mocked(readLampsBrightness).mockImplementation(async (lamps) => ({
        ...LAMPS,
        brightnessPercentages: lamps === "all" ? [63, 79] : lamps.map((id) => (id === LAMP_1.id ? 63 : 79)),
      }));

      await lampsChanged();

      expect([onEvery, onFirst, alsoOnFirst, onSecond].map(titleOf)).toEqual(["79%", "63%", "63%", "79%"]);
      expect(vi.mocked(readLampsBrightness).mock.calls).toEqual([["all"], [[LAMP_1.id]], [[LAMP_2.id]]]);
    });

    it("shows what the key's new lamps are at once they're changed on the settings page", async () => {
      const key = await deck.key(TEMPERATURE_UP);
      clearCalls();
      vi.mocked(readLampsTemperature).mockResolvedValue({ ...LAMPS, representativeTemperatureKelvin: 6500 });

      await deck.changeSettings(key, { lamps: [LAMP_2] });

      expect(readLampsTemperature).toHaveBeenCalledExactlyOnceWith([LAMP_2.id]);
      expect(titleOf(key)).toBe("6500");
    });

    it("logs how many lamps a press steps", async () => {
      const key = await deck.key(BRIGHTNESS_DOWN, { lamps: [LAMP_1, LAMP_2] });
      clearCalls();

      await deck.press(key);

      expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("2 lamps"));
    });
  });
});
