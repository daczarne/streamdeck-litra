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

const DEFAULTS = {
  blinkOnLampScreen: false,
  blinkOnLampScreenExceptions: [],
  keepBrightnessDifference: false,
  keepTemperatureDifference: false,
  identifyBlinkMs: 400,
  lampScreenTopLeft: "identification",
  lampScreenTopRight: "counter",
  lampScreenMiddleLeft: "temperature",
  lampScreenMiddleRight: "power",
  lampScreenBottomLeft: "brightnessPercentage",
  lampScreenBottomRight: "brightnessLumen",
  lampScreenOptions: {},
  lampScreenPrimaryColor: "#ffffff",
  lampScreenPrimaryWeight: "normal",
  lampScreenPrimarySize: 18,
  lampScreenAccentColor: "#202020",
  lampScreenAccentWeight: "normal",
  lampScreenAccentSize: 18,
  lampNames: {},
};

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

describe("whether a dial blinks each lamp as its lamp screen shows it (#144)", () => {
  it.each([
    [false, false],
    [true, true],
  ])("follows the plugin's setting, %s, for a dial with no choice of its own", async (blink, blinks) => {
    await follow();

    changeFromPage({ blinkOnLampScreen: blink, blinkOnLampScreenExceptions: ["other-dial"] });

    expect(globalSettings.blinksOnLampScreen("dial")).toBe(blinks);
  });

  it.each([
    [false, true],
    [true, false],
  ])("does the opposite of the plugin's setting, %s, for a dial that chose otherwise", async (blink, blinks) => {
    await follow();

    changeFromPage({ blinkOnLampScreen: blink, blinkOnLampScreenExceptions: ["dial"] });

    expect(globalSettings.blinksOnLampScreen("dial")).toBe(blinks);
  });

  it("follows the plugin's setting, with a warning, when the dials that chose otherwise aren't a list of ids", async () => {
    settings.getGlobalSettings.mockResolvedValue({ blinkOnLampScreen: true, blinkOnLampScreenExceptions: ["dial", 7] });

    await follow();

    expect(globalSettings.blinksOnLampScreen("dial")).toBe(true);
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("blinkOnLampScreenExceptions"));
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

describe("how long a blink lasts (#171)", () => {
  it("follows the plugin settings", async () => {
    await follow();

    expect(globalSettings.identifyBlinkMs()).toBe(400);

    changeFromPage({ identifyBlinkMs: 1000 });

    expect(globalSettings.identifyBlinkMs()).toBe(1000);
  });

  it.each([200, 2000, 650.5])("takes its default, with a warning, when it's %s", async (saved) => {
    settings.getGlobalSettings.mockResolvedValue({ identifyBlinkMs: saved });

    await follow();

    expect(globalSettings.identifyBlinkMs()).toBe(400);
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("identifyBlinkMs"));
  });
});

describe("what the lamp screens show (#177)", () => {
  /** The item each cell shows. */
  function items() {
    return Object.fromEntries(Object.entries(globalSettings.lampScreenCells()).map(([cell, { item }]) => [cell, item]));
  }

  it("is, cell by cell, what the plugin settings choose, and what they showed before by default", async () => {
    await follow();

    expect(items()).toEqual({
      topLeft: "identification",
      topRight: "counter",
      middleLeft: "temperature",
      middleRight: "power",
      bottomLeft: "brightnessPercentage",
      bottomRight: "brightnessLumen",
    });

    changeFromPage({ lampScreenTopLeft: "none", lampScreenBottomRight: "identification" });

    expect(items()).toMatchObject({ topLeft: "none", bottomRight: "identification" });
  });

  it("takes a cell's default, with a warning, when what is saved isn't one of the choices", async () => {
    settings.getGlobalSettings.mockResolvedValue({ lampScreenTopRight: "name" });

    await follow();

    expect(globalSettings.lampScreenCells().topRight.item).toBe("counter");
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("lampScreenTopRight"));
  });

  it("tells its listeners each time they're read", async () => {
    const listener = vi.fn();
    globalSettings.onGlobalSettingsChanged(listener);
    await follow();
    await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce());

    changeFromPage({ lampScreenTopLeft: "none" });

    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2));
  });

  it("logs a listener that fails, and still tells the others", async () => {
    const error = new Error("redraw failed");
    const other = vi.fn();
    globalSettings.onGlobalSettingsChanged(() => {
      throw error;
    });
    globalSettings.onGlobalSettingsChanged(other);

    await follow();

    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledExactlyOnceWith(expect.any(String), error));
    expect(other).toHaveBeenCalledOnce();
  });
});

describe("how each cell of the lamp screens shows its item (#177)", () => {
  it("takes the defaults, which draw what the lamp screens showed before but for the power", async () => {
    await follow();

    expect(globalSettings.lampScreenCells()).toEqual({
      topLeft: { item: "identification", options: { first: "model", second: "id", trim: false, style: "primary" } },
      topRight: { item: "counter", options: { count: "countOf", format: "of", style: "primary" } },
      middleLeft: { item: "temperature", options: { icon: true, unit: true, style: "primary" } },
      middleRight: {
        item: "power",
        options: {
          onLabel: "ON",
          onStyle: "primary",
          onColor: "#ffffff",
          onWeight: "normal",
          offLabel: "OFF",
          offStyle: "accent",
          offColor: "#202020",
          offWeight: "normal",
        },
      },
      bottomLeft: { item: "brightnessPercentage", options: { icon: true, unit: true, style: "primary" } },
      bottomRight: { item: "brightnessLumen", options: { icon: false, unit: true, style: "primary" } },
    });
  });

  it("reads a cell's options for the item it shows, and leaves out the ones kept for other items", async () => {
    settings.getGlobalSettings.mockResolvedValue({
      lampScreenTopLeft: "counter",
      lampScreenOptions: { topLeft: { counter: { format: "slash" }, identification: { trim: true } } },
    });

    await follow();

    expect(globalSettings.lampScreenCells().topLeft).toEqual({
      item: "counter",
      options: { count: "countOf", format: "slash", style: "primary" },
    });
  });

  it("takes an option's default, with a warning that names the cell, when what is saved isn't valid", async () => {
    settings.getGlobalSettings.mockResolvedValue({
      lampScreenOptions: { middleRight: { power: { onColor: "orange", onLabel: "ON" } } },
    });

    await follow();

    expect(globalSettings.lampScreenCells().middleRight.options).toMatchObject({ onColor: "#ffffff", onLabel: "ON" });
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("middleRight"),
      expect.stringContaining("onColor"),
    );
  });

  it("takes every default when the options aren't objects", async () => {
    settings.getGlobalSettings.mockResolvedValue({ lampScreenOptions: { topLeft: "trim" } });

    await follow();

    expect(globalSettings.lampScreenCells().topLeft.options).toEqual({
      first: "model",
      second: "id",
      trim: false,
      style: "primary",
    });
  });
});

describe("the lamp screens' text styles (#153)", () => {
  it("are white and dark grey, in the normal weight, at 18 px, by default", async () => {
    await follow();

    expect(globalSettings.textStyles()).toEqual({
      primary: { color: "#ffffff", font: { size: 18, weight: 400 } },
      accent: { color: "#202020", font: { size: 18, weight: 400 } },
    });
  });

  it("are the ones the plugin settings saved, with the weight as a layout's text takes it", async () => {
    settings.getGlobalSettings.mockResolvedValue({
      lampScreenPrimaryColor: "#ffcc00",
      lampScreenPrimaryWeight: "bold",
      lampScreenPrimarySize: "22",
      lampScreenAccentSize: 16,
    });

    await follow();

    expect(globalSettings.textStyles()).toEqual({
      primary: { color: "#ffcc00", font: { size: 22, weight: 700 } },
      accent: { color: "#202020", font: { size: 16, weight: 400 } },
    });
  });

  it.each([15, 23, 18.5])("take the default size, with a warning, for a size of %s", async (size) => {
    settings.getGlobalSettings.mockResolvedValue({ lampScreenPrimarySize: size });

    await follow();

    expect(globalSettings.textStyles().primary.font.size).toBe(18);
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("lampScreenPrimarySize"));
  });
});

describe("the lamps' names (#146)", () => {
  it("are the ones the plugin settings saved, by lamp id, and none for a lamp without one", async () => {
    settings.getGlobalSettings.mockResolvedValue({ lampNames: { "lamp-1": "Key light", "lamp-2": 7 } });

    await follow();

    expect(globalSettings.lampName("lamp-1")).toBe("Key light");
    expect(globalSettings.lampName("lamp-2")).toBeUndefined();
    expect(globalSettings.lampName("lamp-3")).toBeUndefined();
  });
});
