import type { JsonObject } from "@elgato/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { GlobalSettings } from "./global-settings";
import { findLamps, useLamps } from "./litra-manager";
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

// The real litra-manager loads node-hid's native binary on import and talks to real lamps.
vi.mock("./litra-manager", () => ({ findLamps: vi.fn(), reachEveryLamp: vi.fn(), useLamps: vi.fn() }));

// What the global settings save through, which sends them to Stream Deck.
const save = vi.fn<(settings: JsonObject) => Promise<void>>();

let globalSettings: GlobalSettings;

beforeEach(() => {
  save.mockResolvedValue();
  globalSettings = new GlobalSettings(save);
});

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

/** Each lamp the plugin knows, by id, as the global settings save it. */
function savedLamps(): Record<string, object> {
  return Object.fromEntries(
    [...globalSettings.lamps].map(([id, { model, serialEnd, name }]) => [
      id,
      name === undefined ? { model, serialEnd } : { model, serialEnd, name },
    ]),
  );
}

//* Tests

describe("the global settings (#144)", () => {
  it("are their defaults before they're read", () => {
    expect(globalSettings.current).toEqual(DEFAULTS);
  });

  it("are the ones read, and the next ones read replace them", () => {
    globalSettings.read({ blinkOnLampScreen: true, keepBrightnessDifference: true });

    expect(globalSettings.current).toEqual({ ...DEFAULTS, blinkOnLampScreen: true, keepBrightnessDifference: true });

    globalSettings.read({});

    expect(globalSettings.current).toEqual(DEFAULTS);
  });

  it("take a setting's default, with a warning, when what is read isn't valid", () => {
    globalSettings.read({ blinkOnLampScreen: "yes" });

    expect(globalSettings.current).toEqual(DEFAULTS);
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
  const picked = { lamps: ["lamp-1"], leftOutLamps: ["lamp-2"] };

  it("are every lamp but the ones its page left out, by default, so lamps added later join it", () => {
    expect(globalSettings.addsNewLamps("key")).toBe(true);
    expect(globalSettings.actionKeyLamps("key", picked)).toEqual({ except: ["lamp-2"] });
  });

  it("are the lamps checked, for a key that doesn't add new lamps", () => {
    globalSettings.read({ addNewLamps: false });

    expect(globalSettings.actionKeyLamps("key", picked)).toEqual(["lamp-1"]);
  });

  it("follow the key's own choice, the opposite of the plugin's, for a key that chose otherwise", () => {
    globalSettings.read({ addNewLamps: false, addNewLampsExceptions: ["key"] });

    expect(globalSettings.actionKeyLamps("key", picked)).toEqual({ except: ["lamp-2"] });
    expect(globalSettings.actionKeyLamps("other-key", picked)).toEqual(["lamp-1"]);
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
  const BEAM = { id: "lamp-1", model: "Beam", serialEnd: "1111" };
  const BEAM_LX = { id: "lamp-2", model: "Beam LX", serialEnd: "2222" };

  it("are none before they're read", () => {
    expect(globalSettings.lamps.size).toBe(0);
  });

  it("are a Lamp for each lamp read, by id, with its model, the end of its serial number and its name", () => {
    globalSettings.read({
      lamps: {
        "lamp-1": { model: "Beam", serialEnd: "1111", name: "Key light" },
        "lamp-2": { model: "Beam LX", serialEnd: "2222" },
      },
    });

    expect(
      [...globalSettings.lamps.values()].map(({ id, model, serialEnd, name }) => [id, model, serialEnd, name]),
    ).toEqual([
      ["lamp-1", "Beam", "1111", "Key light"],
      ["lamp-2", "Beam LX", "2222", undefined],
    ]);
  });

  it("leave out an entry without a model and a serial end, and a name that isn't text, and keep the others", () => {
    globalSettings.read({
      lamps: {
        "lamp-1": { model: "Beam", serialEnd: "1111", name: 7 },
        "lamp-2": { model: "Beam LX" },
        "lamp-3": "Beam",
      },
    });

    expect(savedLamps()).toEqual({ "lamp-1": { model: "Beam", serialEnd: "1111" } });
  });

  it("are none, with a warning, when they aren't lamps by id", () => {
    globalSettings.read({ lamps: ["lamp-1"] });

    expect(globalSettings.lamps.size).toBe(0);
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("lamps"));
  });

  it("keep each lamp's Lamp, and what it remembers, across reads, with the name a page's save gives it (#198)", () => {
    globalSettings.read({ lamps: { "lamp-1": { model: "Beam", serialEnd: "1111" } } });
    const lamp = globalSettings.lamps.get("lamp-1");
    lamp?.leaveBrightness(70, 252);

    globalSettings.read({ lamps: { "lamp-1": { model: "Beam", serialEnd: "1111", name: "Key light" } } });

    expect(globalSettings.lamps.get("lamp-1")).toBe(lamp);
    expect(lamp?.name).toBe("Key light");
    expect(lamp?.brightnessPositionAt(252, 0)).toBe(70);
  });

  it("drop a lamp's Lamp once it's no longer among them, and give it a new one when it comes back (#198)", () => {
    globalSettings.read({ lamps: { "lamp-1": { model: "Beam", serialEnd: "1111" } } });
    const forgotten = globalSettings.lamps.get("lamp-1");

    globalSettings.read({});

    expect(globalSettings.lamps.has("lamp-1")).toBe(false);

    globalSettings.read({ lamps: { "lamp-1": { model: "Beam", serialEnd: "1111" } } });

    expect(globalSettings.lamps.get("lamp-1")).not.toBe(forgotten);
  });

  it("take in the new lamps found, and save them, keeping the lamps known and a page's settings", async () => {
    globalSettings.read({ lamps: { "lamp-1": { model: "Beam", serialEnd: "1111" } }, keepBrightnessDifference: true });

    await globalSettings.addLamps([BEAM, BEAM_LX]);

    const lamps = { "lamp-1": { model: "Beam", serialEnd: "1111" }, "lamp-2": { model: "Beam LX", serialEnd: "2222" } };
    expect(save).toHaveBeenCalledExactlyOnceWith({ lamps, keepBrightnessDifference: true });
    expect(savedLamps()).toEqual(lamps);
    expect(logger.info).toHaveBeenCalledExactlyOnceWith("Lamps added: Beam LX - 2222");
  });

  it("are taken even when saving them fails, which is logged with its error", async () => {
    const error = new Error("Stream Deck is gone");
    save.mockRejectedValue(error);

    await globalSettings.addLamps([BEAM]);

    expect(globalSettings.lamps.has("lamp-1")).toBe(true);
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("Saving the lamps"), error);
  });

  it("save nothing when every lamp found is known", async () => {
    globalSettings.read({ lamps: { "lamp-1": { model: "Beam", serialEnd: "1111" } } });

    await globalSettings.addLamps([BEAM]);

    expect(save).not.toHaveBeenCalled();
  });

  it("forget a lamp, with its name, and save the others, keeping the other settings", async () => {
    globalSettings.read({
      lamps: {
        "lamp-1": { model: "Beam", serialEnd: "1111", name: "Key light" },
        "lamp-2": { model: "Beam LX", serialEnd: "2222" },
      },
      identifyBlinkMs: 600,
    });

    await globalSettings.forgetLamp("lamp-1");

    expect(save).toHaveBeenCalledExactlyOnceWith({
      lamps: { "lamp-2": { model: "Beam LX", serialEnd: "2222" } },
      identifyBlinkMs: 600,
    });
    expect(globalSettings.lamps.has("lamp-1")).toBe(false);
    expect(logger.info).toHaveBeenCalledExactlyOnceWith("Lamp forgotten: Beam - 1111");
  });

  it("take a forgotten lamp in again when it's found, without its name", async () => {
    globalSettings.read({ lamps: { "lamp-1": { model: "Beam", serialEnd: "1111", name: "Key light" } } });

    await globalSettings.forgetLamp("lamp-1");
    await globalSettings.addLamps([BEAM]);

    expect(savedLamps()).toEqual({ "lamp-1": { model: "Beam", serialEnd: "1111" } });
  });

  it("save nothing when the lamp to forget isn't known, with a warning", async () => {
    globalSettings.read({ lamps: { "lamp-1": { model: "Beam", serialEnd: "1111" } } });

    await globalSettings.forgetLamp("lamp-2");

    expect(save).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("lamp-2"));
  });
});

describe("the lamps' names (#146)", () => {
  const KNOWN = {
    "lamp-1": { model: "Beam", serialEnd: "1111", name: "Key light" },
    "lamp-2": { model: "Beam LX", serialEnd: "2222" },
  };

  it("are given by the plugin, trimmed, which saves them, keeping the other lamps and settings", async () => {
    globalSettings.read({ lamps: KNOWN, identifyBlinkMs: 600 });

    await globalSettings.renameLamp("lamp-2", "  Fill light ");

    expect(save).toHaveBeenCalledExactlyOnceWith({
      lamps: { ...KNOWN, "lamp-2": { model: "Beam LX", serialEnd: "2222", name: "Fill light" } },
      identifyBlinkMs: 600,
    });
    expect(globalSettings.lamps.get("lamp-2")?.name).toBe("Fill light");
    expect(logger.debug).toHaveBeenCalledExactlyOnceWith('Lamp Beam LX - 2222 named "Fill light"');
  });

  it("are cut to 24 characters", async () => {
    globalSettings.read({ lamps: KNOWN });

    await globalSettings.renameLamp("lamp-1", "A name much longer than twenty-four");

    expect(globalSettings.lamps.get("lamp-1")?.name).toBe("A name much longer than ");
  });

  it("are taken away by a blank name", async () => {
    globalSettings.read({ lamps: KNOWN });

    await globalSettings.renameLamp("lamp-1", "  ");

    expect(savedLamps()["lamp-1"]).toEqual({ model: "Beam", serialEnd: "1111" });
    expect(logger.debug).toHaveBeenCalledExactlyOnceWith("Lamp Beam - 1111's name taken away");
  });

  it("save nothing when the name is the one the lamp has", async () => {
    globalSettings.read({ lamps: KNOWN });

    await globalSettings.renameLamp("lamp-1", "Key light");
    await globalSettings.renameLamp("lamp-2", "");

    expect(save).not.toHaveBeenCalled();
  });

  it("save nothing for a lamp the plugin doesn't know, with a warning", async () => {
    globalSettings.read({ lamps: KNOWN });

    await globalSettings.renameLamp("lamp-3", "Key light");

    expect(save).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("lamp-3"));
  });
});

describe("following the global settings (#144)", () => {
  // The plugin's instance, from a fresh module for every test, since it keeps the settings it last read.
  let followed: typeof import("./global-settings");

  const BEAM = { id: "lamp-1", label: "Beam - 1111", model: "Beam", serialEnd: "1111" };
  const BEAM_LX = { id: "lamp-2", label: "Beam LX - 2222", model: "Beam LX", serialEnd: "2222" };

  beforeEach(async () => {
    vi.resetModules();
    followed = await import("./global-settings");
    settings.getGlobalSettings.mockResolvedValue({});
    settings.setGlobalSettings.mockResolvedValue();
    vi.mocked(findLamps).mockReturnValue([]);
  });

  /** Follows the global settings, and waits for the first read to answer. */
  async function follow(): Promise<void> {
    followed.followGlobalSettings();
    await settings.getGlobalSettings.mock.results[0]?.value;
  }

  /** Changes the global settings from a settings page, as Stream Deck passes them on to the plugin. */
  function changeFromPage(saved: JsonObject): void {
    const [listener] = at(settings.onDidReceiveGlobalSettings.mock.calls, 0);
    listener({ settings: saved });
  }

  it("hands litra-manager the lamps the plugin knows, which follow every read (#198)", async () => {
    settings.getGlobalSettings.mockResolvedValue({ lamps: { "lamp-1": { model: "Beam", serialEnd: "1111" } } });

    await follow();

    const [handed] = at(vi.mocked(useLamps).mock.calls, 0);
    expect(handed).toBe(followed.globalSettings.lamps);
    expect([...handed.keys()]).toEqual(["lamp-1"]);

    changeFromPage({ lamps: { "lamp-2": { model: "Beam LX", serialEnd: "2222" } } });

    expect([...handed.keys()]).toEqual(["lamp-2"]);
  });

  it("are their defaults before the first read answers", () => {
    settings.getGlobalSettings.mockReturnValue(new Promise(() => {}));

    followed.followGlobalSettings();

    expect(followed.globalSettings.current).toEqual(DEFAULTS);
  });

  it("are the ones saved, once read, and follow a settings page that changes them", async () => {
    settings.getGlobalSettings.mockResolvedValue({ blinkOnLampScreen: true });

    await follow();

    expect(followed.globalSettings.current).toEqual({ ...DEFAULTS, blinkOnLampScreen: true });

    changeFromPage({ keepTemperatureDifference: true });

    expect(followed.globalSettings.current).toEqual({ ...DEFAULTS, keepTemperatureDifference: true });
  });

  it("log a failed read, and keep the defaults", async () => {
    const error = new Error("connection closed");
    settings.getGlobalSettings.mockRejectedValue(error);

    followed.followGlobalSettings();

    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledExactlyOnceWith(expect.any(String), error));
    expect(followed.globalSettings.current).toEqual(DEFAULTS);
  });

  it("save the lamps through Stream Deck, keeping the other settings", async () => {
    settings.getGlobalSettings.mockResolvedValue({ lamps: { "lamp-1": { model: "Beam", serialEnd: "1111" } } });
    await follow();

    await followed.globalSettings.renameLamp("lamp-1", "Key light");

    expect(settings.setGlobalSettings).toHaveBeenCalledExactlyOnceWith({
      lamps: { "lamp-1": { model: "Beam", serialEnd: "1111", name: "Key light" } },
    });
  });

  it("find and save the lamps when the plugin starts with none, keeping the other settings (#194)", async () => {
    settings.getGlobalSettings.mockResolvedValue({ identifyBlinkMs: 600 });
    vi.mocked(findLamps).mockReturnValue([BEAM, BEAM_LX]);

    await follow();
    await vi.waitFor(() => expect(settings.setGlobalSettings).toHaveBeenCalledOnce());

    expect(settings.setGlobalSettings).toHaveBeenCalledWith({
      identifyBlinkMs: 600,
      lamps: { "lamp-1": { model: "Beam", serialEnd: "1111" }, "lamp-2": { model: "Beam LX", serialEnd: "2222" } },
    });
    expect([...followed.globalSettings.lamps.keys()]).toEqual(["lamp-1", "lamp-2"]);
    expect(vi.mocked(logger.info).mock.calls).toEqual([
      [expect.stringContaining("No lamps known")],
      [expect.stringContaining("Beam - 1111, Beam LX - 2222")],
    ]);
  });

  it("find the lamps when what's saved isn't lamps by id, as when the plugin starts with none (#194)", async () => {
    settings.getGlobalSettings.mockResolvedValue({ lamps: ["lamp-1"] });
    vi.mocked(findLamps).mockReturnValue([BEAM]);

    await follow();
    await vi.waitFor(() => expect(settings.setGlobalSettings).toHaveBeenCalledOnce());

    expect(settings.setGlobalSettings).toHaveBeenCalledWith({
      lamps: { "lamp-1": { model: "Beam", serialEnd: "1111" } },
    });
  });

  it("don't look for the lamps when the plugin starts with some, or when a page leaves none (#194)", async () => {
    settings.getGlobalSettings.mockResolvedValue({ lamps: { "lamp-1": { model: "Beam", serialEnd: "1111" } } });
    await follow();

    changeFromPage({});

    expect(findLamps).not.toHaveBeenCalled();
  });

  it("save nothing when the plugin starts with none and finds none (#194)", async () => {
    await follow();
    await vi.waitFor(() => expect(findLamps).toHaveBeenCalledOnce());

    expect(settings.setGlobalSettings).not.toHaveBeenCalled();
  });
});
