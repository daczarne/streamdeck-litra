import type { JsonObject } from "@elgato/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "../logging";
import { at } from "../test-support/at";

//* Fakes

// The SDK's settings, which carry the plugin's global settings between Stream Deck and the plugin.
const settings = vi.hoisted(() => ({
  getGlobalSettings: vi.fn<() => Promise<JsonObject>>(),
  onDidReceiveGlobalSettings: vi.fn<(listener: (ev: { settings: JsonObject }) => void) => void>(),
}));

vi.mock("@elgato/streamdeck", () => ({ default: { settings } }));

// The real logger writes to a logs/ folder.
vi.mock("../logging", () => import("../test-support/fake-logging"));

let globalSettings: typeof import("./global-settings");

beforeEach(async () => {
  // A fresh module for every test, since it keeps the settings it last read.
  vi.resetModules();
  globalSettings = await import("./global-settings");
  settings.getGlobalSettings.mockResolvedValue({});
});

/** Follows the global settings, and waits for the first read to answer. */
async function follow(): Promise<void> {
  globalSettings.followGlobalSettings();
  await settings.getGlobalSettings.mock.results[0]?.value;
}

/** Changes the global settings from a settings page, as Stream Deck passes them on to the plugin. */
function changeFromPage(saved: JsonObject): void {
  const [listener] = at(settings.onDidReceiveGlobalSettings.mock.calls, 0);
  listener({ settings: saved });
}

const DEFAULTS = { blinkOnLampScreen: false, keepBrightnessDifference: false, keepTemperatureDifference: false };

//* Tests

describe("the global settings (#144)", () => {
  it("are their defaults before the first read answers", () => {
    settings.getGlobalSettings.mockReturnValue(new Promise(() => {}));

    globalSettings.followGlobalSettings();

    expect(globalSettings.currentGlobalSettings()).toEqual(DEFAULTS);
  });

  it("are the ones saved, once read", async () => {
    settings.getGlobalSettings.mockResolvedValue({ blinkOnLampScreen: true, keepBrightnessDifference: true });

    await follow();

    expect(globalSettings.currentGlobalSettings()).toEqual({
      ...DEFAULTS,
      blinkOnLampScreen: true,
      keepBrightnessDifference: true,
    });
  });

  it("follow a settings page that changes them", async () => {
    await follow();

    changeFromPage({ keepTemperatureDifference: true });

    expect(globalSettings.currentGlobalSettings()).toEqual({ ...DEFAULTS, keepTemperatureDifference: true });

    changeFromPage({});

    expect(globalSettings.currentGlobalSettings()).toEqual(DEFAULTS);
  });

  it("take a setting's default, with a warning, when what is saved isn't valid", async () => {
    settings.getGlobalSettings.mockResolvedValue({ blinkOnLampScreen: "yes" });

    await follow();

    expect(globalSettings.currentGlobalSettings()).toEqual(DEFAULTS);
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("blinkOnLampScreen"));
  });

  it("log a failed read, and keep the defaults", async () => {
    const error = new Error("connection closed");
    settings.getGlobalSettings.mockRejectedValue(error);

    globalSettings.followGlobalSettings();

    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledExactlyOnceWith(expect.any(String), error));
    expect(globalSettings.currentGlobalSettings()).toEqual(DEFAULTS);
  });
});

describe("how the lamps step (#145)", () => {
  it.each([
    ["brightness", "keepBrightnessDifference", () => globalSettings.brightnessStepping()],
    ["temperature", "keepTemperatureDifference", () => globalSettings.temperatureStepping()],
  ])("steps the %s of every lamp together, unless its difference is kept", async (_, setting, stepping) => {
    await follow();

    expect(stepping()).toBe("together");

    changeFromPage({ [setting]: true });

    expect(stepping()).toBe("each");
  });

  it("keeps the brightness and the temperature apart from each other", async () => {
    await follow();

    changeFromPage({ keepBrightnessDifference: true });

    expect([globalSettings.brightnessStepping(), globalSettings.temperatureStepping()]).toEqual(["each", "together"]);
  });
});
