import type { JsonObject } from "@elgato/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { logger } from "../logging";
import { at } from "../test-support/at";
import { followGlobalSettings } from "./global-settings";
import { LampScreens } from "./lamp-screens";

//* Fakes

// The SDK's settings, which carry the plugin's global settings between Stream Deck and the plugin.
const settings = vi.hoisted(() => ({
  getGlobalSettings: vi.fn<() => Promise<JsonObject>>(),
  onDidReceiveGlobalSettings: vi.fn<(listener: (ev: { settings: JsonObject }) => void) => void>(),
}));

vi.mock("@elgato/streamdeck", () => ({ default: { settings } }));

// The real logger writes to a logs/ folder.
vi.mock("../logging", () => import("../test-support/fake-logging"));

// The real litra-manager loads node-hid's native binary on import and talks to real lamps.
vi.mock("../litra-manager", () => ({
  identifyLamp: vi.fn(),
  onLampsChanged: vi.fn(),
  readLampStatuses: vi.fn(),
}));

let screens: LampScreens;

beforeEach(() => {
  screens = new LampScreens();
  vi.spyOn(screens, "setBlinkOnShow");
  settings.getGlobalSettings.mockResolvedValue({});
});

/** Follows the global settings, and waits for the first read to answer. */
async function follow(): Promise<void> {
  followGlobalSettings(screens);
  await vi.waitFor(() => expect(settings.getGlobalSettings).toHaveBeenCalledOnce());
  await settings.getGlobalSettings.mock.results[0]?.value;
}

/** Changes the global settings from a settings page, as Stream Deck passes them on to the plugin. */
function changeFromPage(saved: JsonObject): void {
  const [listener] = at(settings.onDidReceiveGlobalSettings.mock.calls, 0);
  listener({ settings: saved });
}

//* Tests

describe("the global settings (#144)", () => {
  it("give the lamp screens the blink saved, once read", async () => {
    settings.getGlobalSettings.mockResolvedValue({ blinkOnLampScreen: true });

    await follow();

    expect(screens.setBlinkOnShow).toHaveBeenCalledExactlyOnceWith(true);
  });

  it("leave the blink off when none is saved", async () => {
    await follow();

    expect(screens.setBlinkOnShow).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("follow a settings page that turns the blink on and off", async () => {
    await follow();

    changeFromPage({ blinkOnLampScreen: true });
    changeFromPage({ blinkOnLampScreen: false });

    expect(vi.mocked(screens.setBlinkOnShow).mock.calls).toEqual([[false], [true], [false]]);
  });

  it("leave the blink off, with a warning, when what is saved isn't valid", async () => {
    settings.getGlobalSettings.mockResolvedValue({ blinkOnLampScreen: "yes" });

    await follow();

    expect(screens.setBlinkOnShow).toHaveBeenCalledExactlyOnceWith(false);
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("blinkOnLampScreen"));
  });

  it("log a failed read, and leave the blink as it was", async () => {
    const error = new Error("connection closed");
    settings.getGlobalSettings.mockRejectedValue(error);

    followGlobalSettings(screens);

    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledExactlyOnceWith(expect.any(String), error));
    expect(screens.setBlinkOnShow).not.toHaveBeenCalled();
  });
});
