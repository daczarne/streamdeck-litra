import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDebouncer } from "../controls/debouncer";
import { brightnessShown } from "../controls/shown";
import { adjustLampsBrightness, type OperationResult, setLampsBrightness } from "../lamps/manager";
import { logger } from "../logging";
import { syncGlobalSettings } from "../settings/global-settings";
import { FakeDeck } from "../test-support/fake-deck";
import { changeGlobalSettings } from "../test-support/fake-stream-deck";
import { BrightnessAction } from "./brightness";

//* Fakes

vi.mock("@elgato/streamdeck", () => import("../test-support/fake-stream-deck"));

// The real logger writes to a logs/ folder.
vi.mock("../logging", () => import("../test-support/fake-logging"));

// The debouncer gathers what each test says, without the timing its own tests check.
vi.mock("../controls/debouncer", () => ({ createDebouncer: vi.fn() }));

// What the dials show of the lamps, which each test sets, with the real text it's shown as.
vi.mock("../controls/shown", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../controls/shown")>()),
  brightnessShown: vi.fn(),
}));

// The real lamp manager loads node-hid's native binary on import and talks to real lamps.
vi.mock("../lamps/manager", () => ({
  adjustLampsBrightness: vi.fn(),
  onLampsChanged: vi.fn(),
  setLampsBrightness: vi.fn(),
}));

const BRIGHTNESS = "com.daczarne.litra.brightness";

/** How an operation on two Beams went. */
const DONE: OperationResult = { ok: true, lampCount: 2, failures: 0 };

/** Two Beams on a Stream Deck + XL's USB hub, which stopped at 63% and 79%, as the plugin holds them. */
const AT_THEIR_CAPS = [63, 79];

let deck: FakeDeck;

// The global settings, which the tests change as a settings page does (#145).
await syncGlobalSettings();

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  changeGlobalSettings({});
  // The debouncer flushes every turn at once: its own timing is debouncer.test.ts's to check.
  vi.mocked(createDebouncer).mockImplementation((flush) => (ticks) => void flush(ticks));
  vi.mocked(brightnessShown).mockResolvedValue(AT_THEIR_CAPS);
  vi.mocked(setLampsBrightness).mockResolvedValue(DONE);
  vi.mocked(adjustLampsBrightness).mockResolvedValue(DONE);
  deck = new FakeDeck([new BrightnessAction()]);
});

afterEach(() => {
  vi.useRealTimers();
});

//* Tests

describe("BrightnessAction", () => {
  describe("with no settings", () => {
    it("has a key show its default preset, 0%, and set every lamp to it", async () => {
      const key = await deck.key(BRIGHTNESS);

      await deck.press(key);

      expect(key.setTitle).toHaveBeenCalledExactlyOnceWith("0%");
      expect(setLampsBrightness).toHaveBeenCalledExactlyOnceWith("all", 0);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it("has a dial step every lamp connected by its default step, 10%, together", async () => {
      const dial = await deck.dial(BRIGHTNESS);

      await deck.turn(dial, 3);

      expect(adjustLampsBrightness).toHaveBeenCalledExactlyOnceWith("connected", 3, 10, "together");
      expect(logger.warn).not.toHaveBeenCalled();
    });
  });

  describe("reads its settings", () => {
    it("a key's preset, in % of the lamps' range, which its title and log line show", async () => {
      const key = await deck.key(BRIGHTNESS, { presetPercentage: 40 });

      await deck.press(key);

      expect(key.setTitle).toHaveBeenCalledExactlyOnceWith("40%");
      expect(setLampsBrightness).toHaveBeenCalledExactlyOnceWith("all", 40);
      expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("preset 40%"));
    });

    it.each([5, "5"])("a dial's step, %j, in %, which its log line shows", async (step) => {
      const dial = await deck.dial(BRIGHTNESS, { stepPercentage: step });

      await deck.turn(dial, 3);

      expect(adjustLampsBrightness).toHaveBeenCalledExactlyOnceWith("connected", 3, 5, "together");
      expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("3 ticks of 5%"));
    });

    it("with the default for a preset or a step that isn't valid, and a warning that names it (#22)", async () => {
      const key = await deck.key(BRIGHTNESS, { presetPercentage: "abc" });
      const dial = await deck.dial(BRIGHTNESS, { stepPercentage: 0 });

      await deck.press(key);
      await deck.turn(dial, 3);

      expect(setLampsBrightness).toHaveBeenCalledExactlyOnceWith("all", 0);
      expect(adjustLampsBrightness).toHaveBeenCalledExactlyOnceWith("connected", 3, 10, "together");
      expect(vi.mocked(logger.warn).mock.calls).toEqual([
        [expect.stringContaining("presetPercentage")],
        [expect.stringContaining("stepPercentage")],
      ]);
    });
  });

  describe("steps each lamp from its own brightness (#145)", () => {
    it("once the brightness's difference is kept", async () => {
      changeGlobalSettings({ keepBrightnessDifference: true });
      const dial = await deck.dial(BRIGHTNESS);

      await deck.turn(dial, 3);

      expect(adjustLampsBrightness).toHaveBeenCalledExactlyOnceWith("connected", 3, 10, "each");
    });

    it("but not when only the temperature's difference is kept", async () => {
      changeGlobalSettings({ keepTemperatureDifference: true });
      const dial = await deck.dial(BRIGHTNESS);

      await deck.turn(dial, 3);

      expect(adjustLampsBrightness).toHaveBeenCalledExactlyOnceWith("connected", 3, 10, "together");
    });
  });

  describe("shows on a dial's main screen", () => {
    it("the brightest lamp connected, with the bar fainter from the dimmest one, which one lamp passes", async () => {
      const dial = await deck.dial(BRIGHTNESS);

      expect(brightnessShown).toHaveBeenCalledExactlyOnceWith("connected");
      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith({
        title: "Set Brightness",
        value: "79%",
        indicator: { value: 79, bar_fill_c: "0:#ffffff,0.797:#ffffff,0.798:#c0c0c0,1:#c0c0c0" },
      });
    });

    it("a dash and an empty bar when no lamp is connected", async () => {
      vi.mocked(brightnessShown).mockResolvedValue([]);

      const dial = await deck.dial(BRIGHTNESS);

      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith({
        title: "Set Brightness",
        value: "—",
        indicator: { value: 0, bar_fill_c: "white" },
      });
    });
  });
});
