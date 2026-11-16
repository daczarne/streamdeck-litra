import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDebouncer } from "../controls/debouncer";
import { temperatureShown } from "../controls/shown";
import { adjustLampsTemperature, type OperationResult, setLampsTemperature } from "../lamps/manager";
import { logger } from "../logging";
import { syncGlobalSettings } from "../settings/global-settings";
import { FakeDeck } from "../test-support/fake-deck";
import { changeGlobalSettings } from "../test-support/fake-stream-deck";
import { TemperatureAction } from "./temperature";

//* Fakes

vi.mock("@elgato/streamdeck", () => import("../test-support/fake-stream-deck"));

// The real logger writes to a logs/ folder.
vi.mock("../logging", () => import("../test-support/fake-logging"));

// The debouncer gathers what each test says, without the timing its own tests check.
vi.mock("../controls/debouncer", () => ({ createDebouncer: vi.fn() }));

// What the dials show of the lamps, which each test sets, with the real text it's shown as.
vi.mock("../controls/shown", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../controls/shown")>()),
  temperatureShown: vi.fn(),
}));

// The real lamp manager loads node-hid's native binary on import and talks to real lamps.
vi.mock("../lamps/manager", () => ({
  adjustLampsTemperature: vi.fn(),
  onLampsChanged: vi.fn(),
  setLampsTemperature: vi.fn(),
}));

const TEMPERATURE = "com.daczarne.litra.temperature";

/** How an operation on two Beams went. */
const DONE: OperationResult = { ok: true, lampCount: 2, failures: 0 };

/** The first lamp at 4000 K, 34% of the way from a Beam's lowest temperature to its highest. */
const AT_4000_K = { kelvin: 4000, percentage: 34 };

let deck: FakeDeck;

// The global settings, which the tests change as a settings page does (#145).
await syncGlobalSettings();

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  changeGlobalSettings({});
  // The debouncer flushes every turn at once: its own timing is debouncer.test.ts's to check.
  vi.mocked(createDebouncer).mockImplementation((flush) => (ticks) => void flush(ticks));
  vi.mocked(temperatureShown).mockResolvedValue(AT_4000_K);
  vi.mocked(setLampsTemperature).mockResolvedValue(DONE);
  vi.mocked(adjustLampsTemperature).mockResolvedValue(DONE);
  deck = new FakeDeck([new TemperatureAction()]);
});

afterEach(() => {
  vi.useRealTimers();
});

//* Tests

describe("TemperatureAction", () => {
  describe("with no settings", () => {
    it("has a key show its default preset, 2700 K, and set every lamp to it", async () => {
      const key = await deck.key(TEMPERATURE);

      await deck.press(key);

      expect(key.setTitle).toHaveBeenCalledExactlyOnceWith("2700");
      expect(setLampsTemperature).toHaveBeenCalledExactlyOnceWith("all", 2700);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("has a dial step every lamp connected by its default step, 300 K, together", async () => {
      const dial = await deck.dial(TEMPERATURE);

      await deck.turn(dial, 3);

      expect(adjustLampsTemperature).toHaveBeenCalledExactlyOnceWith("connected", 3, 300, "together");
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe("reads its settings", () => {
    it("a key's preset, in kelvin, which its title and log line show", async () => {
      const key = await deck.key(TEMPERATURE, { presetKelvin: 5000 });

      await deck.press(key);

      expect(key.setTitle).toHaveBeenCalledExactlyOnceWith("5000");
      expect(setLampsTemperature).toHaveBeenCalledExactlyOnceWith("all", 5000);
      expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("preset 5000 K"));
    });

    it("a preset between the temperatures a lamp allows, which the lamps snap to the nearest", async () => {
      const key = await deck.key(TEMPERATURE, { presetKelvin: 4050 });

      await deck.press(key);

      expect(setLampsTemperature).toHaveBeenCalledExactlyOnceWith("all", 4050);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it.each([200, "200"])("a dial's step, %j, in kelvin, which its log line shows", async (step) => {
      const dial = await deck.dial(TEMPERATURE, { stepKelvin: step });

      await deck.turn(dial, 3);

      expect(adjustLampsTemperature).toHaveBeenCalledExactlyOnceWith("connected", 3, 200, "together");
      expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("3 ticks of 200 K"));
    });

    it("with the default for a preset or a step that isn't valid, and a warning that names it (#22)", async () => {
      const key = await deck.key(TEMPERATURE, { presetKelvin: "warm" });
      const dial = await deck.dial(TEMPERATURE, { stepKelvin: 250 });

      await deck.press(key);
      await deck.turn(dial, 3);

      expect(setLampsTemperature).toHaveBeenCalledExactlyOnceWith("all", 2700);
      expect(adjustLampsTemperature).toHaveBeenCalledExactlyOnceWith("connected", 3, 300, "together");
      expect(vi.mocked(logger.warn).mock.calls).toEqual([
        [expect.stringContaining("presetKelvin")],
        [expect.stringContaining("stepKelvin")],
      ]);
    });
  });

  describe("steps each lamp from its own temperature (#145)", () => {
    it("once the temperature's difference is kept", async () => {
      changeGlobalSettings({ keepTemperatureDifference: true });
      const dial = await deck.dial(TEMPERATURE);

      await deck.turn(dial, 3);

      expect(adjustLampsTemperature).toHaveBeenCalledExactlyOnceWith("connected", 3, 300, "each");
    });

    it("but not when only the brightness's difference is kept", async () => {
      changeGlobalSettings({ keepBrightnessDifference: true });
      const dial = await deck.dial(TEMPERATURE);

      await deck.turn(dial, 3);

      expect(adjustLampsTemperature).toHaveBeenCalledExactlyOnceWith("connected", 3, 300, "together");
    });
  });

  describe("shows on a dial's main screen", () => {
    it("the first lamp connected's temperature, and its place in the lamp's range as the bar", async () => {
      const dial = await deck.dial(TEMPERATURE);

      expect(temperatureShown).toHaveBeenCalledExactlyOnceWith("connected");
      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith({
        title: "Set Temperature",
        value: "4000",
        indicator: 34,
      });
    });

    it("a dash and an empty bar when no lamp is connected", async () => {
      vi.mocked(temperatureShown).mockResolvedValue(undefined);

      const dial = await deck.dial(TEMPERATURE);

      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith({ title: "Set Temperature", value: "—", indicator: 0 });
    });
  });
});
