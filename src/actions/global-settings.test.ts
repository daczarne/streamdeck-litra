import type { JsonObject } from "@elgato/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { findLamps, setKnownLamps } from "../litra-manager";
import { logger } from "../logging";
import { at } from "../test-support/at";

//* Fakes

// The SDK's settings, which carry the plugin's global settings between Stream Deck and the plugin.
const settings = vi.hoisted(() => ({
  getGlobalSettings: vi.fn<() => Promise<JsonObject>>(),
  onDidReceiveGlobalSettings: vi.fn<(listener: (ev: { settings: JsonObject }) => void) => void>(),
  setGlobalSettings: vi.fn<(settings: JsonObject) => Promise<void>>(),
}));

vi.mock("@elgato/streamdeck", () => ({ default: { settings } }));

// The real logger writes to a logs/ folder.
vi.mock("../logging", () => import("../test-support/fake-logging"));

// The real litra-manager loads node-hid's native binary on import and talks to real lamps.
vi.mock("../litra-manager", () => ({ findLamps: vi.fn(), setKnownLamps: vi.fn() }));

let globalSettings: typeof import("./global-settings");

beforeEach(async () => {
  // A fresh module for every test, since it keeps the settings it last read.
  vi.resetModules();
  globalSettings = await import("./global-settings");
  settings.getGlobalSettings.mockResolvedValue({});
  settings.setGlobalSettings.mockResolvedValue();
  vi.mocked(findLamps).mockReturnValue([]);
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
  addNewLamps: true,
  addNewLampsExceptions: [],
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
  lampScreenSecondaryColor: "#202020",
  lampScreenSecondaryWeight: "normal",
  lampScreenSecondarySize: 18,
  lampScreenAccentColor: "#4dd0e1",
  lampScreenAccentWeight: "normal",
  lampScreenAccentSize: 18,
  lampScreenAlertColor: "#ff6b6b",
  lampScreenAlertWeight: "bold",
  lampScreenAlertSize: 18,
  lamps: {},
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
          offStyle: "secondary",
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
  it("are white, dark grey, cyan and a bold soft red, at 18 px, by default", async () => {
    await follow();

    expect(globalSettings.textStyles()).toEqual({
      primary: { color: "#ffffff", font: { size: 18, weight: 400 } },
      secondary: { color: "#202020", font: { size: 18, weight: 400 } },
      accent: { color: "#4dd0e1", font: { size: 18, weight: 400 } },
      alert: { color: "#ff6b6b", font: { size: 18, weight: 700 } },
    });
  });

  it("are the ones the plugin settings saved, with the weight as a layout's text takes it", async () => {
    settings.getGlobalSettings.mockResolvedValue({
      lampScreenPrimaryColor: "#ffcc00",
      lampScreenPrimaryWeight: "bold",
      lampScreenPrimarySize: "22",
      lampScreenSecondarySize: 16,
      lampScreenAccentWeight: "bold",
      lampScreenAlertColor: "#FF0000",
    });

    await follow();

    expect(globalSettings.textStyles()).toEqual({
      primary: { color: "#ffcc00", font: { size: 22, weight: 700 } },
      secondary: { color: "#202020", font: { size: 16, weight: 400 } },
      accent: { color: "#4dd0e1", font: { size: 18, weight: 700 } },
      alert: { color: "#ff0000", font: { size: 18, weight: 700 } },
    });
  });

  it.each([15, 23, 18.5])("take the default size, with a warning, for a size of %s", async (size) => {
    settings.getGlobalSettings.mockResolvedValue({ lampScreenPrimarySize: size });

    await follow();

    expect(globalSettings.textStyles().primary.font.size).toBe(18);
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("lampScreenPrimarySize"));
  });
});

describe("the lamps a key acts on (#147)", () => {
  const picked = { lamps: ["lamp-1"], leftOutLamps: ["lamp-2"] };

  it("are every lamp but the ones its page left out, by default, so lamps added later join it", async () => {
    await follow();

    expect(globalSettings.addsNewLamps("key")).toBe(true);
    expect(globalSettings.keyLamps("key", picked)).toEqual({ except: ["lamp-2"] });
  });

  it("are the lamps checked, for a key that doesn't add new lamps", async () => {
    settings.getGlobalSettings.mockResolvedValue({ addNewLamps: false });

    await follow();

    expect(globalSettings.keyLamps("key", picked)).toEqual(["lamp-1"]);
  });

  it("follow the key's own choice, the opposite of the plugin's, for a key that chose otherwise", async () => {
    settings.getGlobalSettings.mockResolvedValue({ addNewLamps: false, addNewLampsExceptions: ["key"] });

    await follow();

    expect(globalSettings.keyLamps("key", picked)).toEqual({ except: ["lamp-2"] });
    expect(globalSettings.keyLamps("other-key", picked)).toEqual(["lamp-1"]);
  });

  it.each([true, false])(
    "are every lamp for a key saved before it could pick them, adding new lamps or not (%s)",
    async (addNewLamps) => {
      settings.getGlobalSettings.mockResolvedValue({ addNewLamps });

      await follow();

      expect(globalSettings.keyLamps("key", { lamps: "all", leftOutLamps: [] })).toBe("all");
    },
  );
});

describe("the lamps' names (#146)", () => {
  const KNOWN = {
    "lamp-1": { model: "Beam", serialEnd: "1111", name: "Key light" },
    "lamp-2": { model: "Beam LX", serialEnd: "2222" },
  };

  it("are the ones the lamps the plugin knows were given, and none for a lamp without one, or one it doesn't know", async () => {
    settings.getGlobalSettings.mockResolvedValue({
      lamps: { ...KNOWN, "lamp-3": { model: "Beam", serialEnd: "3333", name: 7 } },
    });

    await follow();

    expect(globalSettings.lampName("lamp-1")).toBe("Key light");
    expect(globalSettings.lampName("lamp-2")).toBeUndefined();
    expect(globalSettings.currentGlobalSettings().lamps["lamp-3"]).toEqual({ model: "Beam", serialEnd: "3333" });
    expect(globalSettings.lampName("lamp-4")).toBeUndefined();
  });

  it("are given by the plugin, trimmed, which saves them, keeping the other lamps and settings", async () => {
    settings.getGlobalSettings.mockResolvedValue({ lamps: KNOWN, identifyBlinkMs: 600 });
    await follow();

    await globalSettings.renameLamp("lamp-2", "  Fill light ");

    expect(settings.setGlobalSettings).toHaveBeenCalledExactlyOnceWith({
      lamps: { ...KNOWN, "lamp-2": { model: "Beam LX", serialEnd: "2222", name: "Fill light" } },
      identifyBlinkMs: 600,
    });
    expect(globalSettings.lampName("lamp-2")).toBe("Fill light");
    expect(logger.debug).toHaveBeenCalledExactlyOnceWith('Lamp Beam LX - 2222 named "Fill light"');
  });

  it("are cut to 24 characters", async () => {
    settings.getGlobalSettings.mockResolvedValue({ lamps: KNOWN });
    await follow();

    await globalSettings.renameLamp("lamp-1", "A name much longer than twenty-four");

    expect(globalSettings.lampName("lamp-1")).toBe("A name much longer than ");
  });

  it("are taken away by a blank name", async () => {
    settings.getGlobalSettings.mockResolvedValue({ lamps: KNOWN });
    await follow();

    await globalSettings.renameLamp("lamp-1", "  ");

    expect(globalSettings.currentGlobalSettings().lamps["lamp-1"]).toEqual({ model: "Beam", serialEnd: "1111" });
    expect(logger.debug).toHaveBeenCalledExactlyOnceWith("Lamp Beam - 1111's name taken away");
  });

  it("save nothing when the name is the one the lamp has", async () => {
    settings.getGlobalSettings.mockResolvedValue({ lamps: KNOWN });
    await follow();

    await globalSettings.renameLamp("lamp-1", "Key light");
    await globalSettings.renameLamp("lamp-2", "");

    expect(settings.setGlobalSettings).not.toHaveBeenCalled();
  });

  it("save nothing for a lamp the plugin doesn't know, with a warning", async () => {
    settings.getGlobalSettings.mockResolvedValue({ lamps: KNOWN });
    await follow();

    await globalSettings.renameLamp("lamp-3", "Key light");

    expect(settings.setGlobalSettings).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("lamp-3"));
  });
});

describe("the lamps the plugin knows (#194)", () => {
  const BEAM = { id: "lamp-1", label: "Beam - 1111", model: "Beam", serialEnd: "1111" };
  const BEAM_LX = { id: "lamp-2", label: "Beam LX - 2222", model: "Beam LX", serialEnd: "2222" };

  it("are told to litra-manager each time they're read, by id", async () => {
    settings.getGlobalSettings.mockResolvedValue({ lamps: { "lamp-1": { model: "Beam", serialEnd: "1111" } } });

    await follow();
    changeFromPage({ lamps: { "lamp-2": { model: "Beam LX", serialEnd: "2222" } } });

    expect(vi.mocked(setKnownLamps).mock.calls).toEqual([[["lamp-1"]], [["lamp-2"]]]);
  });

  it("leave out an entry without a model and a serial end, and keep the others", async () => {
    settings.getGlobalSettings.mockResolvedValue({
      lamps: { "lamp-1": { model: "Beam", serialEnd: "1111" }, "lamp-2": { model: "Beam LX" }, "lamp-3": "Beam" },
    });

    await follow();

    expect(globalSettings.currentGlobalSettings().lamps).toEqual({ "lamp-1": { model: "Beam", serialEnd: "1111" } });
  });

  it("are found and saved when the plugin starts with none, keeping the other settings", async () => {
    settings.getGlobalSettings.mockResolvedValue({ identifyBlinkMs: 600 });
    vi.mocked(findLamps).mockReturnValue([BEAM, BEAM_LX]);

    await follow();
    await vi.waitFor(() => expect(settings.setGlobalSettings).toHaveBeenCalledOnce());

    const lamps = {
      "lamp-1": { model: "Beam", serialEnd: "1111" },
      "lamp-2": { model: "Beam LX", serialEnd: "2222" },
    };
    expect(settings.setGlobalSettings).toHaveBeenCalledWith({ identifyBlinkMs: 600, lamps });
    expect(globalSettings.currentGlobalSettings().lamps).toEqual(lamps);
    expect(setKnownLamps).toHaveBeenLastCalledWith(["lamp-1", "lamp-2"]);
    expect(vi.mocked(logger.info).mock.calls).toEqual([
      [expect.stringContaining("No lamps known")],
      [expect.stringContaining("Beam - 1111, Beam LX - 2222")],
    ]);
  });

  it("aren't looked for when the plugin starts with some", async () => {
    settings.getGlobalSettings.mockResolvedValue({ lamps: { "lamp-1": { model: "Beam", serialEnd: "1111" } } });

    await follow();

    expect(findLamps).not.toHaveBeenCalled();
  });

  it("aren't looked for when a page leaves none, only when the plugin starts", async () => {
    settings.getGlobalSettings.mockResolvedValue({ lamps: { "lamp-1": { model: "Beam", serialEnd: "1111" } } });
    await follow();

    changeFromPage({});

    expect(findLamps).not.toHaveBeenCalled();
  });

  it("save nothing when the plugin starts with none and finds none", async () => {
    await follow();
    await vi.waitFor(() => expect(findLamps).toHaveBeenCalledOnce());

    expect(settings.setGlobalSettings).not.toHaveBeenCalled();
  });

  it("take in the new lamps found, and keep the ones known and the settings a page saved since", async () => {
    settings.getGlobalSettings.mockResolvedValue({ lamps: { "lamp-1": { model: "Beam", serialEnd: "1111" } } });
    await follow();
    changeFromPage({ lamps: { "lamp-1": { model: "Beam", serialEnd: "1111" } }, keepBrightnessDifference: true });

    await globalSettings.addLamps([BEAM, BEAM_LX]);

    expect(settings.setGlobalSettings).toHaveBeenCalledExactlyOnceWith({
      lamps: { "lamp-1": { model: "Beam", serialEnd: "1111" }, "lamp-2": { model: "Beam LX", serialEnd: "2222" } },
      keepBrightnessDifference: true,
    });
    expect(setKnownLamps).toHaveBeenLastCalledWith(["lamp-1", "lamp-2"]);
    expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("Beam LX - 2222"));
  });

  it("are taken even when saving them fails, which is logged with its error", async () => {
    const error = new Error("Stream Deck is gone");
    settings.setGlobalSettings.mockRejectedValue(error);
    await follow();

    await globalSettings.addLamps([BEAM]);

    expect(setKnownLamps).toHaveBeenLastCalledWith(["lamp-1"]);
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("Saving the lamps"), error);
  });

  it("forget a lamp, with its name, and save the others, keeping the other settings", async () => {
    const lamps = {
      "lamp-1": { model: "Beam", serialEnd: "1111", name: "Key light" },
      "lamp-2": { model: "Beam LX", serialEnd: "2222" },
    };
    settings.getGlobalSettings.mockResolvedValue({ lamps, identifyBlinkMs: 600 });
    await follow();

    await globalSettings.forgetLamp("lamp-1");

    expect(settings.setGlobalSettings).toHaveBeenCalledExactlyOnceWith({
      lamps: { "lamp-2": { model: "Beam LX", serialEnd: "2222" } },
      identifyBlinkMs: 600,
    });
    expect(setKnownLamps).toHaveBeenLastCalledWith(["lamp-2"]);
    expect(globalSettings.lampName("lamp-1")).toBeUndefined();
    expect(logger.info).toHaveBeenCalledExactlyOnceWith("Lamp forgotten: Beam - 1111");
  });

  it("take a forgotten lamp in again when it's found, without its name", async () => {
    settings.getGlobalSettings.mockResolvedValue({
      lamps: { "lamp-1": { model: "Beam", serialEnd: "1111", name: "Key light" } },
    });
    await follow();

    await globalSettings.forgetLamp("lamp-1");
    await globalSettings.addLamps([BEAM]);

    expect(globalSettings.currentGlobalSettings().lamps).toEqual({ "lamp-1": { model: "Beam", serialEnd: "1111" } });
  });

  it("save nothing when the lamp to forget isn't known, with a warning", async () => {
    settings.getGlobalSettings.mockResolvedValue({ lamps: { "lamp-1": { model: "Beam", serialEnd: "1111" } } });
    await follow();

    await globalSettings.forgetLamp("lamp-2");

    expect(settings.setGlobalSettings).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("lamp-2"));
  });

  it("save nothing when every lamp found is known", async () => {
    settings.getGlobalSettings.mockResolvedValue({ lamps: { "lamp-1": { model: "Beam", serialEnd: "1111" } } });
    await follow();

    await globalSettings.addLamps([BEAM]);

    expect(settings.setGlobalSettings).not.toHaveBeenCalled();
  });
});
