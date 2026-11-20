import { temperatureGlyph } from "@daczarne/streamdeck-icons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDebouncer } from "../controls/debouncer";
import { temperatureShown } from "../controls/shown";
import { adjustLampsTemperature, type OperationResult } from "../lamps/manager";
import { logger } from "../logging";
import { syncGlobalSettings } from "../settings/global-settings";
import { FakeDeck } from "../test-support/fake-deck";
import { changeGlobalSettings } from "../test-support/fake-stream-deck";
import { iconIn } from "../test-support/icons";
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
vi.mock("../lamps/manager", () => ({ adjustLampsTemperature: vi.fn(), onLampsChanged: vi.fn() }));

const TEMPERATURE = "com.daczarne.litra.temperature";

/** How an operation on two Beams went. */
const DONE: OperationResult = { ok: true, lampCount: 2, failures: 0 };

/**
 * Two Beams, the first at 3400 K and the second at 4000 K: 18% and 34% of the way from a Beam's lowest temperature to
 * its highest.
 */
const APART = [
  { kelvin: 3400, percentage: 18 },
  { kelvin: 4000, percentage: 34 },
];

let deck: FakeDeck;

// The global settings, which the tests change as a settings page does (#145).
await syncGlobalSettings();

beforeEach(async () => {
  vi.useFakeTimers();
  changeGlobalSettings({});
  // The dials of earlier tests redraw their main screens as the global settings change (#183), before the mocks are
  // cleared, so the test sees only what its own dials do.
  await vi.runAllTimersAsync();
  vi.clearAllMocks();
  // The debouncer flushes every turn at once: its own timing is debouncer.test.ts's to check.
  vi.mocked(createDebouncer).mockImplementation((flush) => (ticks) => void flush(ticks));
  vi.mocked(temperatureShown).mockResolvedValue(APART);
  vi.mocked(adjustLampsTemperature).mockResolvedValue(DONE);
  deck = new FakeDeck([new TemperatureAction()]);
});

afterEach(() => {
  vi.useRealTimers();
});

//* Tests

describe("TemperatureAction", () => {
  describe("reads its settings", () => {
    it("with none, stepping every lamp connected by its default step, 300 K, together", async () => {
      const dial = await deck.dial(TEMPERATURE);

      await deck.turn(dial, 3);

      expect(adjustLampsTemperature).toHaveBeenCalledExactlyOnceWith("connected", 3, 300, "together", false);
      expect(logger.warn).not.toHaveBeenCalled();
    });

    it.each([200, "200"])("a step, %j, in kelvin, which its log line shows", async (step) => {
      const dial = await deck.dial(TEMPERATURE, { stepKelvin: step });

      await deck.turn(dial, 3);

      expect(adjustLampsTemperature).toHaveBeenCalledExactlyOnceWith("connected", 3, 200, "together", false);
      expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("3 ticks of 200 K"));
    });

    it("with the default for a step that isn't valid, and a warning that names it (#22)", async () => {
      const dial = await deck.dial(TEMPERATURE, { stepKelvin: 250 });

      await deck.turn(dial, 3);

      expect(adjustLampsTemperature).toHaveBeenCalledExactlyOnceWith("connected", 3, 300, "together", false);
      expect(vi.mocked(logger.warn).mock.calls).toEqual([[expect.stringContaining("stepKelvin")]]);
    });
  });

  describe("turns the lamps on as it changes them on its main screen (#268)", () => {
    it("once Temperature dials turn lamps on", async () => {
      changeGlobalSettings({ setTemperatureDialsTurnLampsOn: true });
      const dial = await deck.dial(TEMPERATURE);

      await deck.turn(dial, 3);

      expect(adjustLampsTemperature).toHaveBeenCalledExactlyOnceWith("connected", 3, 300, "together", true);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("turning lamps on"));
    });

    it("but not whichever other keys and dials turn lamps on", async () => {
      changeGlobalSettings({
        setBrightnessKeysTurnLampsOn: true,
        brightnessUpKeysTurnLampsOn: true,
        brightnessDownKeysTurnLampsOn: true,
        setTemperatureKeysTurnLampsOn: true,
        temperatureUpKeysTurnLampsOn: true,
        temperatureDownKeysTurnLampsOn: true,
        setBrightnessDialsTurnLampsOn: true,
        setBrightnessLampScreensTurnLampsOn: true,
        setTemperatureLampScreensTurnLampsOn: true,
      });
      const dial = await deck.dial(TEMPERATURE);

      await deck.turn(dial, 3);

      expect(adjustLampsTemperature).toHaveBeenCalledExactlyOnceWith("connected", 3, 300, "together", false);
    });
  });

  describe("steps each lamp from its own temperature (#145)", () => {
    it("once the temperature's difference is kept", async () => {
      changeGlobalSettings({ keepTemperatureDifference: true });
      const dial = await deck.dial(TEMPERATURE);

      await deck.turn(dial, 3);

      expect(adjustLampsTemperature).toHaveBeenCalledExactlyOnceWith("connected", 3, 300, "each", false);
    });

    it("but not when only the brightness's difference is kept", async () => {
      changeGlobalSettings({ keepBrightnessDifference: true });
      const dial = await deck.dial(TEMPERATURE);

      await deck.turn(dial, 3);

      expect(adjustLampsTemperature).toHaveBeenCalledExactlyOnceWith("connected", 3, 300, "together", false);
    });
  });

  describe("shows on a dial's main screen", () => {
    it("the highest temperature connected, with the bar fainter from the lowest one, which one lamp passes", async () => {
      const dial = await deck.dial(TEMPERATURE);

      expect(temperatureShown).toHaveBeenCalledExactlyOnceWith("connected");
      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith({
        title: "Temperature",
        icon: iconIn(temperatureGlyph),
        value: { value: "4000 K", color: "#ffffff" },
        indicator: { value: 34, bar_fill_c: "0:#ffffff,0.529:#ffffff,0.53:#c0c0c0,1:#c0c0c0" },
      });
    });

    it("a white bar when every lamp is at the same temperature", async () => {
      vi.mocked(temperatureShown).mockResolvedValue([
        { kelvin: 4000, percentage: 34 },
        { kelvin: 4000, percentage: 34 },
      ]);

      const dial = await deck.dial(TEMPERATURE);

      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith({
        title: "Temperature",
        icon: iconIn(temperatureGlyph),
        value: { value: "4000 K", color: "#ffffff" },
        indicator: { value: 34, bar_fill_c: "#ffffff" },
      });
    });

    it("a dash and an empty bar when no lamp is connected", async () => {
      vi.mocked(temperatureShown).mockResolvedValue([]);

      const dial = await deck.dial(TEMPERATURE);

      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith({
        title: "Temperature",
        icon: iconIn(temperatureGlyph),
        value: { value: "—", color: "#ffffff" },
        indicator: { value: 0, bar_fill_c: "#ffffff" },
      });
    });
  });
});
