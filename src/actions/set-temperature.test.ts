import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type OperationResult, setLampsTemperature } from "../lamps/manager";
import { logger } from "../logging";
import { syncGlobalSettings } from "../settings/global-settings";
import { FakeDeck } from "../test-support/fake-deck";
import { changeGlobalSettings } from "../test-support/fake-stream-deck";
import { SetTemperatureAction } from "./set-temperature";

//* Fakes

vi.mock("@elgato/streamdeck", () => import("../test-support/fake-stream-deck"));

// The real logger writes to a logs/ folder.
vi.mock("../logging", () => import("../test-support/fake-logging"));

// The real lamp manager loads node-hid's native binary on import and talks to real lamps.
vi.mock("../lamps/manager", () => ({ onLampsChanged: vi.fn(), setLampsTemperature: vi.fn() }));

const SET_TEMPERATURE = "com.daczarne.litra.set-temperature";

/** How an operation on two Beams went. */
const DONE: OperationResult = { ok: true, lampCount: 2, failures: 0 };

let deck: FakeDeck;

// The global settings, which the tests change as a settings page does (#268).
await syncGlobalSettings();

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  changeGlobalSettings({});
  vi.mocked(setLampsTemperature).mockResolvedValue(DONE);
  deck = new FakeDeck([new SetTemperatureAction()]);
});

afterEach(() => {
  vi.useRealTimers();
});

//* Tests

describe("SetTemperatureAction", () => {
  it("has a key with no settings show its default preset, 2700 K, and set every lamp to it", async () => {
    const key = await deck.key(SET_TEMPERATURE);

    await deck.press(key);

    expect(key.setTitle).toHaveBeenCalledExactlyOnceWith("2700 K");
    expect(setLampsTemperature).toHaveBeenCalledExactlyOnceWith("all", 2700, false);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("reads a key's preset, in kelvin, which its title and log line show", async () => {
    const key = await deck.key(SET_TEMPERATURE, { presetKelvin: 5000 });

    await deck.press(key);

    expect(key.setTitle).toHaveBeenCalledExactlyOnceWith("5000 K");
    expect(setLampsTemperature).toHaveBeenCalledExactlyOnceWith("all", 5000, false);
    expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("preset 5000 K"));
  });

  it("reads a preset between the temperatures a lamp allows, which the lamps snap to the nearest", async () => {
    const key = await deck.key(SET_TEMPERATURE, { presetKelvin: 4050 });

    await deck.press(key);

    expect(setLampsTemperature).toHaveBeenCalledExactlyOnceWith("all", 4050, false);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("takes the default for a preset that isn't valid, with a warning that names it (#22)", async () => {
    const key = await deck.key(SET_TEMPERATURE, { presetKelvin: "warm" });

    await deck.press(key);

    expect(setLampsTemperature).toHaveBeenCalledExactlyOnceWith("all", 2700, false);
    expect(vi.mocked(logger.warn).mock.calls).toEqual([[expect.stringContaining("presetKelvin")]]);
  });

  it("turns the lamps on as a key sets them, once Set Temperature keys turn lamps on (#268)", async () => {
    changeGlobalSettings({ setTemperatureKeysTurnLampsOn: true });
    const key = await deck.key(SET_TEMPERATURE);

    await deck.press(key);

    expect(setLampsTemperature).toHaveBeenCalledExactlyOnceWith("all", 2700, true);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("turning lamps on"));
  });

  it("turns the lamps on, or not, as a key chose on its own page, whatever the other keys do (#181)", async () => {
    const key = await deck.key(SET_TEMPERATURE);
    const other = await deck.key(SET_TEMPERATURE);
    changeGlobalSettings({ setTemperatureKeysTurnLampsOnExceptions: [key.id] });

    await deck.press(key);
    await deck.press(other);
    changeGlobalSettings({ setTemperatureKeysTurnLampsOn: true, setTemperatureKeysTurnLampsOnExceptions: [key.id] });
    await deck.press(key);
    await deck.press(other);

    expect(vi.mocked(setLampsTemperature).mock.calls).toEqual([
      ["all", 2700, true],
      ["all", 2700, false],
      ["all", 2700, false],
      ["all", 2700, true],
    ]);
  });

  it("leaves the lamps' power as it is, whichever other keys and dials turn lamps on (#268)", async () => {
    changeGlobalSettings({
      setBrightnessKeysTurnLampsOn: true,
      brightnessUpKeysTurnLampsOn: true,
      brightnessDownKeysTurnLampsOn: true,
      temperatureUpKeysTurnLampsOn: true,
      temperatureDownKeysTurnLampsOn: true,
      setBrightnessDialsTurnLampsOn: true,
      setTemperatureDialsTurnLampsOn: true,
      setBrightnessLampScreensTurnLampsOn: true,
      setTemperatureLampScreensTurnLampsOn: true,
    });
    const key = await deck.key(SET_TEMPERATURE);

    await deck.press(key);

    expect(setLampsTemperature).toHaveBeenCalledExactlyOnceWith("all", 2700, false);
  });
});
