import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type OperationResult, setLampsBrightness } from "../lamps/manager";
import { logger } from "../logging";
import { syncGlobalSettings } from "../settings/global-settings";
import { FakeDeck } from "../test-support/fake-deck";
import { changeGlobalSettings } from "../test-support/fake-stream-deck";
import { SetBrightnessAction } from "./set-brightness";

//* Fakes

vi.mock("@elgato/streamdeck", () => import("../test-support/fake-stream-deck"));

// The real logger writes to a logs/ folder.
vi.mock("../logging", () => import("../test-support/fake-logging"));

// The real lamp manager loads node-hid's native binary on import and talks to real lamps.
vi.mock("../lamps/manager", () => ({ onLampsChanged: vi.fn(), setLampsBrightness: vi.fn() }));

const SET_BRIGHTNESS = "com.daczarne.litra.set-brightness";

/** How an operation on two Beams went. */
const DONE: OperationResult = { ok: true, lampCount: 2, failures: 0 };

let deck: FakeDeck;

// The global settings, which the tests change as a settings page does (#268).
await syncGlobalSettings();

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  changeGlobalSettings({});
  vi.mocked(setLampsBrightness).mockResolvedValue(DONE);
  deck = new FakeDeck([new SetBrightnessAction()]);
});

afterEach(() => {
  vi.useRealTimers();
});

//* Tests

describe("SetBrightnessAction", () => {
  it("has a key with no settings show its default preset, 0%, and set every lamp to it", async () => {
    const key = await deck.key(SET_BRIGHTNESS);

    await deck.press(key);

    expect(key.setTitle).toHaveBeenCalledExactlyOnceWith("0%");
    expect(setLampsBrightness).toHaveBeenCalledExactlyOnceWith("all", 0, false);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("reads a key's preset, in % of the lamps' range, which its title and log line show", async () => {
    const key = await deck.key(SET_BRIGHTNESS, { presetPercentage: 40 });

    await deck.press(key);

    expect(key.setTitle).toHaveBeenCalledExactlyOnceWith("40%");
    expect(setLampsBrightness).toHaveBeenCalledExactlyOnceWith("all", 40, false);
    expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("preset 40%"));
  });

  it("takes the default for a preset that isn't valid, with a warning that names it (#22)", async () => {
    const key = await deck.key(SET_BRIGHTNESS, { presetPercentage: "abc" });

    await deck.press(key);

    expect(setLampsBrightness).toHaveBeenCalledExactlyOnceWith("all", 0, false);
    expect(vi.mocked(logger.warn).mock.calls).toEqual([[expect.stringContaining("presetPercentage")]]);
  });

  it("turns the lamps on as a key sets them, once Set Brightness keys turn lamps on (#268)", async () => {
    changeGlobalSettings({ setBrightnessKeysTurnLampsOn: true });
    const key = await deck.key(SET_BRIGHTNESS);

    await deck.press(key);

    expect(setLampsBrightness).toHaveBeenCalledExactlyOnceWith("all", 0, true);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("turning lamps on"));
  });

  it("turns the lamps on, or not, as a key chose on its own page, whatever the other keys do (#181)", async () => {
    const key = await deck.key(SET_BRIGHTNESS);
    const other = await deck.key(SET_BRIGHTNESS);
    changeGlobalSettings({ setBrightnessKeysTurnLampsOnExceptions: [key.id] });

    await deck.press(key);
    await deck.press(other);
    changeGlobalSettings({ setBrightnessKeysTurnLampsOn: true, setBrightnessKeysTurnLampsOnExceptions: [key.id] });
    await deck.press(key);
    await deck.press(other);

    expect(vi.mocked(setLampsBrightness).mock.calls).toEqual([
      ["all", 0, true],
      ["all", 0, false],
      ["all", 0, false],
      ["all", 0, true],
    ]);
  });

  it("leaves the lamps' power as it is, whichever other keys and dials turn lamps on (#268)", async () => {
    changeGlobalSettings({
      brightnessUpKeysTurnLampsOn: true,
      brightnessDownKeysTurnLampsOn: true,
      setTemperatureKeysTurnLampsOn: true,
      temperatureUpKeysTurnLampsOn: true,
      temperatureDownKeysTurnLampsOn: true,
      setBrightnessDialsTurnLampsOn: true,
      setTemperatureDialsTurnLampsOn: true,
      setBrightnessLampScreensTurnLampsOn: true,
      setTemperatureLampScreensTurnLampsOn: true,
    });
    const key = await deck.key(SET_BRIGHTNESS);

    await deck.press(key);

    expect(setLampsBrightness).toHaveBeenCalledExactlyOnceWith("all", 0, false);
  });
});
