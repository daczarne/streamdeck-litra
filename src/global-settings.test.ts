import type { JsonObject } from "@elgato/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GlobalSettings } from "./global-settings";
import { logger } from "./logging";
import { at } from "./test-support/at";

//* Fakes

// The SDK's settings, which carry the plugin's global settings between Stream Deck and the plugin. The real SDK opens
// a connection to Stream Deck and creates a logs/ folder on import.
const settings = vi.hoisted(() => ({
  getGlobalSettings: vi.fn<() => Promise<JsonObject>>(),
  onDidReceiveGlobalSettings: vi.fn<(listener: (ev: { settings: JsonObject }) => void) => void>(),
  setGlobalSettings: vi.fn<(settings: JsonObject) => Promise<void>>(),
}));

vi.mock("@elgato/streamdeck", () => ({ default: { settings } }));

// The real logger writes to a logs/ folder.
vi.mock("./logging", () => import("./test-support/fake-logging"));

// What the global settings save through, which sends them to Stream Deck.
const save = vi.fn<(settings: JsonObject) => Promise<void>>();

let globalSettings: GlobalSettings;

beforeEach(() => {
  save.mockResolvedValue();
  globalSettings = new GlobalSettings(save);
});

/** Each lamp the plugin knows, by id, as the global settings save it. */
function savedLamps(): Record<string, object> {
  return Object.fromEntries(
    [...globalSettings.lamps].map(([id, { model, name }]) => [id, name === undefined ? { model } : { model, name }]),
  );
}

//* Tests

describe("the global settings (#144)", () => {
  it("are the ones read, and the next ones read replace them", () => {
    globalSettings.read({ blinkOnLampScreen: true, keepBrightnessDifference: true });

    expect(globalSettings.blinksOnLampScreen("dial")).toBe(true);
    expect(globalSettings.brightnessStepping).toBe("each");

    globalSettings.read({});

    expect(globalSettings.blinksOnLampScreen("dial")).toBe(false);
    expect(globalSettings.brightnessStepping).toBe("together");
  });

  it("take a setting's default, with a warning, when what is read isn't valid", () => {
    globalSettings.read({ blinkOnLampScreen: "yes" });

    expect(globalSettings.blinksOnLampScreen("dial")).toBe(false);
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("blinkOnLampScreen"));
  });

  it("tell their listeners each time they're read", async () => {
    const listener = vi.fn();
    globalSettings.onChanged(listener);

    globalSettings.read({});
    globalSettings.read({ lampScreenTopLeft: "none" });

    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(2));
  });

  it("log a listener that fails, and still tell the others", async () => {
    const error = new Error("redraw failed");
    const other = vi.fn();
    globalSettings.onChanged(() => {
      throw error;
    });
    globalSettings.onChanged(other);

    globalSettings.read({});

    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledExactlyOnceWith(expect.any(String), error));
    expect(other).toHaveBeenCalledOnce();
  });
});

describe("whether a dial blinks each lamp as its lamp screen shows it (#144)", () => {
  it.each([
    [false, false],
    [true, true],
  ])("follows the plugin's setting, %s, for a dial with no choice of its own", (blink, blinks) => {
    globalSettings.read({ blinkOnLampScreen: blink, blinkOnLampScreenExceptions: ["other-dial"] });

    expect(globalSettings.blinksOnLampScreen("dial")).toBe(blinks);
  });

  it.each([
    [false, true],
    [true, false],
  ])("does the opposite of the plugin's setting, %s, for a dial that chose otherwise", (blink, blinks) => {
    globalSettings.read({ blinkOnLampScreen: blink, blinkOnLampScreenExceptions: ["dial"] });

    expect(globalSettings.blinksOnLampScreen("dial")).toBe(blinks);
  });

  it("follows the plugin's setting, with a warning, when the dials that chose otherwise aren't a list of ids", () => {
    globalSettings.read({ blinkOnLampScreen: true, blinkOnLampScreenExceptions: ["dial", 7] });

    expect(globalSettings.blinksOnLampScreen("dial")).toBe(true);
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("blinkOnLampScreenExceptions"));
  });
});

describe("how the lamps step (#145)", () => {
  it.each([
    ["brightness", "keepBrightnessDifference", () => globalSettings.brightnessStepping],
    ["temperature", "keepTemperatureDifference", () => globalSettings.temperatureStepping],
  ])("steps the %s of every lamp together, unless its difference is kept", (_, setting, stepping) => {
    expect(stepping()).toBe("together");

    globalSettings.read({ [setting]: true });

    expect(stepping()).toBe("each");
  });

  it("keeps the brightness and the temperature apart from each other", () => {
    globalSettings.read({ keepBrightnessDifference: true });

    expect([globalSettings.brightnessStepping, globalSettings.temperatureStepping]).toEqual(["each", "together"]);
  });
});

describe("how long a blink lasts (#171)", () => {
  it("follows the plugin settings", () => {
    expect(globalSettings.identifyBlinkMs).toBe(400);

    globalSettings.read({ identifyBlinkMs: 1000 });

    expect(globalSettings.identifyBlinkMs).toBe(1000);
  });

  it.each([200, 2000, 650.5])("takes its default, with a warning, when it's %s", (saved) => {
    globalSettings.read({ identifyBlinkMs: saved });

    expect(globalSettings.identifyBlinkMs).toBe(400);
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("identifyBlinkMs"));
  });
});

describe("what the lamp screens show (#177)", () => {
  /** The item each cell shows. */
  function items() {
    return Object.fromEntries(Object.entries(globalSettings.lampScreenCells).map(([cell, { item }]) => [cell, item]));
  }

  it("is, cell by cell, what the plugin settings choose, and what they showed before by default", () => {
    expect(items()).toEqual({
      topLeft: "identification",
      topRight: "counter",
      middleLeft: "temperature",
      middleRight: "power",
      bottomLeft: "brightnessPercentage",
      bottomRight: "brightnessLumen",
    });

    globalSettings.read({ lampScreenTopLeft: "none", lampScreenBottomRight: "identification" });

    expect(items()).toMatchObject({ topLeft: "none", bottomRight: "identification" });
  });

  it("takes a cell's default, with a warning, when what is read isn't one of the choices", () => {
    globalSettings.read({ lampScreenTopRight: "name" });

    expect(globalSettings.lampScreenCells.topRight.item).toBe("counter");
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("lampScreenTopRight"));
  });
});

describe("how each cell of the lamp screens shows its item (#177)", () => {
  it("takes the defaults, which draw what the lamp screens showed before but for the power", () => {
    expect(globalSettings.lampScreenCells).toEqual({
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

  it("reads a cell's options for the item it shows, and leaves out the ones kept for other items", () => {
    globalSettings.read({
      lampScreenTopLeft: "counter",
      lampScreenOptions: { topLeft: { counter: { format: "slash" }, identification: { trim: true } } },
    });

    expect(globalSettings.lampScreenCells.topLeft).toEqual({
      item: "counter",
      options: { count: "countOf", format: "slash", style: "primary" },
    });
  });

  it("takes an option's default, with a warning that names the cell, when what is read isn't valid", () => {
    globalSettings.read({ lampScreenOptions: { middleRight: { power: { onColor: "orange", onLabel: "ON" } } } });

    expect(globalSettings.lampScreenCells.middleRight.options).toMatchObject({ onColor: "#ffffff", onLabel: "ON" });
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("middleRight"),
      expect.stringContaining("onColor"),
    );
  });

  it("takes every default when the options aren't objects", () => {
    globalSettings.read({ lampScreenOptions: { topLeft: "trim" } });

    expect(globalSettings.lampScreenCells.topLeft.options).toEqual({
      first: "model",
      second: "id",
      trim: false,
      style: "primary",
    });
  });

  it("takes every cell's default options, with a warning, when the options of every cell aren't an object", () => {
    globalSettings.read({ lampScreenOptions: "trim" });

    expect(globalSettings.lampScreenCells.topLeft.options).toEqual({
      first: "model",
      second: "id",
      trim: false,
      style: "primary",
    });
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("lampScreenOptions"));
  });
});

describe("the lamp screens' text styles (#153)", () => {
  it("are white, dark grey, cyan and a bold soft red, at 18 px, by default", () => {
    expect(globalSettings.textStyles).toEqual({
      primary: { color: "#ffffff", font: { size: 18, weight: 400 } },
      secondary: { color: "#202020", font: { size: 18, weight: 400 } },
      accent: { color: "#4dd0e1", font: { size: 18, weight: 400 } },
      alert: { color: "#ff6b6b", font: { size: 18, weight: 700 } },
    });
  });

  it("are the ones the plugin settings saved, with the weight as a layout's text takes it", () => {
    globalSettings.read({
      lampScreenPrimaryColor: "#ffcc00",
      lampScreenPrimaryWeight: "bold",
      lampScreenPrimarySize: "22",
      lampScreenSecondarySize: 16,
      lampScreenAccentWeight: "bold",
      lampScreenAlertColor: "#FF0000",
    });

    expect(globalSettings.textStyles).toEqual({
      primary: { color: "#ffcc00", font: { size: 22, weight: 700 } },
      secondary: { color: "#202020", font: { size: 16, weight: 400 } },
      accent: { color: "#4dd0e1", font: { size: 18, weight: 700 } },
      alert: { color: "#ff0000", font: { size: 18, weight: 700 } },
    });
  });

  it.each([15, 23, 18.5])("take the default size, with a warning, for a size of %s", (size) => {
    globalSettings.read({ lampScreenPrimarySize: size });

    expect(globalSettings.textStyles.primary.font.size).toBe(18);
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("lampScreenPrimarySize"));
  });
});

describe("the lamps an action key acts on (#147)", () => {
  const picked = { lamps: ["0000000000001111"], leftOutLamps: ["0000000000002222"] };

  it("are every lamp but the ones its page left out, by default, so lamps added later join it", () => {
    expect(globalSettings.actionKeyLamps("key", picked)).toEqual({ except: ["0000000000002222"] });
  });

  it("are the lamps checked, for a key that doesn't add new lamps", () => {
    globalSettings.read({ addNewLamps: false });

    expect(globalSettings.actionKeyLamps("key", picked)).toEqual(["0000000000001111"]);
  });

  it("follow the key's own choice, the opposite of the plugin's, for a key that chose otherwise", () => {
    globalSettings.read({ addNewLamps: false, addNewLampsExceptions: ["key"] });

    expect(globalSettings.actionKeyLamps("key", picked)).toEqual({ except: ["0000000000002222"] });
    expect(globalSettings.actionKeyLamps("other-key", picked)).toEqual(["0000000000001111"]);
  });

  it.each([true, false])(
    "are every lamp for a key saved before it could pick them, adding new lamps or not (%s)",
    (addNewLamps) => {
      globalSettings.read({ addNewLamps });

      expect(globalSettings.actionKeyLamps("key", { lamps: "all", leftOutLamps: [] })).toBe("all");
    },
  );
});

describe("the lamps the plugin knows (#194)", () => {
  const BEAM = { id: "0000000000001111", model: "Beam" };
  const BEAM_LX = { id: "0000000000002222", model: "Beam LX" };

  it("are none before they're read", () => {
    expect(globalSettings.lamps.size).toBe(0);
  });

  it("are a Lamp for each lamp read, by id, with its model and its name", () => {
    globalSettings.read({
      lamps: {
        "0000000000001111": { model: "Beam", name: "Key light" },
        "0000000000002222": { model: "Beam LX" },
      },
    });

    expect([...globalSettings.lamps.values()].map(({ id, model, name }) => [id, model, name])).toEqual([
      ["0000000000001111", "Beam", "Key light"],
      ["0000000000002222", "Beam LX", undefined],
    ]);
  });

  it("leave out an entry without a model, and a name that isn't text, and keep the others", () => {
    globalSettings.read({
      lamps: {
        "0000000000001111": { model: "Beam", name: 7 },
        "0000000000002222": { name: "Fill light" },
        "0000000000003333": "Beam",
      },
    });

    expect(savedLamps()).toEqual({ "0000000000001111": { model: "Beam" } });
  });

  it("read a lamp saved with the end of its serial number, as lamps once were, and save it without it", async () => {
    globalSettings.read({ lamps: { "0000000000001111": { model: "Beam", serialEnd: "7K98", name: "Key light" } } });

    await globalSettings.renameLamp("0000000000001111", "Fill light");

    expect(vi.mocked(save).mock.lastCall?.[0]).toMatchObject({
      lamps: { "0000000000001111": { model: "Beam", name: "Fill light" } },
    });
    expect(JSON.stringify(vi.mocked(save).mock.lastCall?.[0])).not.toContain("7K98");
  });

  it("are none, with a warning, when they aren't lamps by id", () => {
    globalSettings.read({ lamps: ["0000000000001111"] });

    expect(globalSettings.lamps.size).toBe(0);
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("lamps"));
  });

  it("keep each lamp's Lamp, and what it remembers, across reads, with the name a page's save gives it (#198)", () => {
    globalSettings.read({ lamps: { "0000000000001111": { model: "Beam" } } });
    const lamp = globalSettings.lamps.get("0000000000001111");
    if (lamp !== undefined) {
      lamp.brightnessAsked = 70;
    }

    globalSettings.read({ lamps: { "0000000000001111": { model: "Beam", name: "Key light" } } });

    expect(globalSettings.lamps.get("0000000000001111")).toBe(lamp);
    expect(lamp?.name).toBe("Key light");
    expect(lamp?.brightnessAsked).toBe(70);
  });

  it("drop a lamp's Lamp once it's no longer among them, and give it a new one when it comes back (#198)", () => {
    globalSettings.read({ lamps: { "0000000000001111": { model: "Beam" } } });
    const forgotten = globalSettings.lamps.get("0000000000001111");

    globalSettings.read({});

    expect(globalSettings.lamps.has("0000000000001111")).toBe(false);

    globalSettings.read({ lamps: { "0000000000001111": { model: "Beam" } } });

    expect(globalSettings.lamps.get("0000000000001111")).not.toBe(forgotten);
  });

  it("take in the new lamps found, and save them, keeping the lamps known and a page's settings", async () => {
    globalSettings.read({ lamps: { "0000000000001111": { model: "Beam" } }, keepBrightnessDifference: true });

    await globalSettings.addLamps([BEAM, BEAM_LX]);

    const lamps = { "0000000000001111": { model: "Beam" }, "0000000000002222": { model: "Beam LX" } };
    expect(save).toHaveBeenCalledExactlyOnceWith({ lamps, keepBrightnessDifference: true });
    expect(savedLamps()).toEqual(lamps);
    expect(logger.info).toHaveBeenCalledExactlyOnceWith("Lamps added: Beam LX - 2222");
  });

  it.each([
    ["found", () => globalSettings.addLamps([BEAM_LX])],
    ["renamed", () => globalSettings.renameLamp("0000000000001111", "Key light")],
    ["forgotten", () => globalSettings.forgetLamp("0000000000001111")],
  ])("tell the listeners when a lamp is %s, without reading the settings again", async (_, change) => {
    globalSettings.read({ lamps: { "0000000000001111": { model: "Beam" } }, blinkOnLampScreen: "yes" });
    const listener = vi.fn();
    globalSettings.onChanged(listener);
    vi.mocked(logger.warn).mockClear();

    await change();

    await vi.waitFor(() => expect(listener).toHaveBeenCalledOnce());
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("save a second change on top of the first, keeping both", async () => {
    globalSettings.read({ lamps: { "0000000000001111": { model: "Beam" } }, identifyBlinkMs: 600 });

    await globalSettings.addLamps([BEAM_LX]);
    await globalSettings.renameLamp("0000000000002222", "Fill light");

    expect(vi.mocked(save).mock.lastCall?.[0]).toEqual({
      lamps: { "0000000000001111": { model: "Beam" }, "0000000000002222": { model: "Beam LX", name: "Fill light" } },
      identifyBlinkMs: 600,
    });
  });

  it("are taken even when saving them fails, which is logged with its error", async () => {
    const error = new Error("Stream Deck is gone");
    save.mockRejectedValue(error);

    await globalSettings.addLamps([BEAM]);

    expect(globalSettings.lamps.has("0000000000001111")).toBe(true);
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("Saving the lamps"), error);
  });

  it("save nothing when every lamp found is known", async () => {
    globalSettings.read({ lamps: { "0000000000001111": { model: "Beam" } } });

    await globalSettings.addLamps([BEAM]);

    expect(save).not.toHaveBeenCalled();
  });

  it("forget a lamp, with its name, and save the others, keeping the other settings", async () => {
    globalSettings.read({
      lamps: {
        "0000000000001111": { model: "Beam", name: "Key light" },
        "0000000000002222": { model: "Beam LX" },
      },
      identifyBlinkMs: 600,
    });

    await globalSettings.forgetLamp("0000000000001111");

    expect(save).toHaveBeenCalledExactlyOnceWith({
      lamps: { "0000000000002222": { model: "Beam LX" } },
      identifyBlinkMs: 600,
    });
    expect(globalSettings.lamps.has("0000000000001111")).toBe(false);
    expect(logger.info).toHaveBeenCalledExactlyOnceWith("Lamp forgotten: Beam - 1111");
  });

  it("take a forgotten lamp in again when it's found, without its name", async () => {
    globalSettings.read({ lamps: { "0000000000001111": { model: "Beam", name: "Key light" } } });

    await globalSettings.forgetLamp("0000000000001111");
    await globalSettings.addLamps([BEAM]);

    expect(savedLamps()).toEqual({ "0000000000001111": { model: "Beam" } });
  });

  it("save nothing when the lamp to forget isn't known, with a warning", async () => {
    globalSettings.read({ lamps: { "0000000000001111": { model: "Beam" } } });

    await globalSettings.forgetLamp("0000000000002222");

    expect(save).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("0000000000002222"));
  });
});

describe("the lamps' names (#146)", () => {
  const KNOWN = {
    "0000000000001111": { model: "Beam", name: "Key light" },
    "0000000000002222": { model: "Beam LX" },
  };

  it("are given by the plugin, trimmed, which saves them, keeping the other lamps and settings", async () => {
    globalSettings.read({ lamps: KNOWN, identifyBlinkMs: 600 });

    await globalSettings.renameLamp("0000000000002222", "  Fill light ");

    expect(save).toHaveBeenCalledExactlyOnceWith({
      lamps: { ...KNOWN, "0000000000002222": { model: "Beam LX", name: "Fill light" } },
      identifyBlinkMs: 600,
    });
    expect(globalSettings.lamps.get("0000000000002222")?.name).toBe("Fill light");
    expect(logger.debug).toHaveBeenCalledExactlyOnceWith('Lamp Beam LX - 2222 named "Fill light"');
  });

  it("are cut to 24 characters", async () => {
    globalSettings.read({ lamps: KNOWN });

    await globalSettings.renameLamp("0000000000001111", "A name much longer than twenty-four");

    expect(globalSettings.lamps.get("0000000000001111")?.name).toBe("A name much longer than ");
  });

  it("are taken away by a blank name", async () => {
    globalSettings.read({ lamps: KNOWN });

    await globalSettings.renameLamp("0000000000001111", "  ");

    expect(savedLamps()["0000000000001111"]).toEqual({ model: "Beam" });
    expect(logger.debug).toHaveBeenCalledExactlyOnceWith("Lamp Beam - 1111's name taken away");
  });

  it("save nothing when the name is the one the lamp has", async () => {
    globalSettings.read({ lamps: KNOWN });

    await globalSettings.renameLamp("0000000000001111", "Key light");
    await globalSettings.renameLamp("0000000000002222", "");

    expect(save).not.toHaveBeenCalled();
  });

  it("save nothing for a lamp the plugin doesn't know, with a warning", async () => {
    globalSettings.read({ lamps: KNOWN });

    await globalSettings.renameLamp("0000000000003333", "Key light");

    expect(save).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("0000000000003333"));
  });
});

describe("syncing the global settings (#144)", () => {
  // The plugin's instance, from a fresh module for every test, since it keeps the settings it last read.
  let synced: typeof import("./global-settings");

  beforeEach(async () => {
    vi.resetModules();
    synced = await import("./global-settings");
    settings.getGlobalSettings.mockResolvedValue({});
    settings.setGlobalSettings.mockResolvedValue();
  });

  /** Changes the global settings from a settings page, as Stream Deck passes them on to the plugin. */
  function changeFromPage(saved: JsonObject): void {
    const [listener] = at(settings.onDidReceiveGlobalSettings.mock.calls, 0);
    listener({ settings: saved });
  }

  it("are their defaults before the first read answers", () => {
    settings.getGlobalSettings.mockReturnValue(new Promise(() => {}));

    void synced.syncGlobalSettings();

    expect(synced.globalSettings.blinksOnLampScreen("dial")).toBe(false);
  });

  it("are the ones saved, once read, and follow a settings page that changes them", async () => {
    settings.getGlobalSettings.mockResolvedValue({ blinkOnLampScreen: true });

    await synced.syncGlobalSettings();

    expect(synced.globalSettings.blinksOnLampScreen("dial")).toBe(true);

    changeFromPage({ keepTemperatureDifference: true });

    expect(synced.globalSettings.blinksOnLampScreen("dial")).toBe(false);
    expect(synced.globalSettings.temperatureStepping).toBe("each");
  });

  it("keep the lamps the plugin knows in one map, which every read updates, as litra-manager holds it (#198)", async () => {
    settings.getGlobalSettings.mockResolvedValue({ lamps: { "0000000000001111": { model: "Beam" } } });
    // The map as litra-manager is handed it, before the first read.
    const { lamps } = synced.globalSettings;

    await synced.syncGlobalSettings();

    expect([...lamps.keys()]).toEqual(["0000000000001111"]);

    changeFromPage({ lamps: { "0000000000002222": { model: "Beam LX" } } });

    expect([...lamps.keys()]).toEqual(["0000000000002222"]);
  });

  it("reject when the first read fails, and keep the defaults", async () => {
    const error = new Error("connection closed");
    settings.getGlobalSettings.mockRejectedValue(error);

    await expect(synced.syncGlobalSettings()).rejects.toBe(error);

    expect(synced.globalSettings.blinksOnLampScreen("dial")).toBe(false);
  });

  it("save the lamps through Stream Deck, keeping the other settings", async () => {
    settings.getGlobalSettings.mockResolvedValue({ lamps: { "0000000000001111": { model: "Beam" } } });
    await synced.syncGlobalSettings();

    await synced.globalSettings.renameLamp("0000000000001111", "Key light");

    expect(settings.setGlobalSettings).toHaveBeenCalledExactlyOnceWith({
      lamps: { "0000000000001111": { model: "Beam", name: "Key light" } },
    });
  });
});
