import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { followGlobalSettings } from "../global-settings";
import { type LampSelection, setLampsScene } from "../litra-manager";
import { logger } from "../logging";
import { at } from "../test-support/at";
import { FakeDeck } from "../test-support/fake-deck";
import { changeGlobalSettings } from "../test-support/fake-stream-deck";
import { SceneAction } from "./scene";

//* Fakes

vi.mock("@elgato/streamdeck", () => import("../test-support/fake-stream-deck"));

// The real logger writes to a logs/ folder.
vi.mock("../logging", () => import("../test-support/fake-logging"));

// The real litra-manager loads node-hid's native binary on import and talks to real lamps.
vi.mock("../litra-manager", () => ({
  findLamps: vi.fn(() => []),
  onLampsChanged: vi.fn(),
  reachEveryLamp: vi.fn(),
  useLamps: vi.fn(),
  setLampsScene: vi.fn(),
}));

const SCENE = "com.daczarne.litra.scene";

const SET = { ok: true, deviceCount: 2, failures: 0 };

/** A group of a scene, as the key hands it to litra-manager, which turns its lamps on at these values. */
function onAt(lamps: LampSelection, percentage: number, kelvin: number) {
  return { lamps, on: true, percentage, kelvin };
}

let deck: FakeDeck;

beforeEach(() => {
  vi.useFakeTimers();
  changeGlobalSettings({});
  deck = new FakeDeck([new SceneAction()]);
});

afterEach(() => {
  vi.useRealTimers();
});

// The keys read whether they add new lamps from the global settings, which each test sets afresh (#147).
followGlobalSettings();

//* Tests

describe("SceneAction", () => {
  describe("on a key press", () => {
    it("sets the lamps to the key's brightness and temperature", async () => {
      const key = await deck.key(SCENE, { presetPercentage: 100, presetKelvin: 6500 });
      vi.mocked(setLampsScene).mockResolvedValue(SET);

      await deck.press(key);

      expect(setLampsScene).toHaveBeenCalledExactlyOnceWith([onAt("all", 100, 6500)]);
      expect(key.showAlert).not.toHaveBeenCalled();
    });

    it.each([
      ["a lamp fails", { ...SET, ok: false, failures: 1 }],
      ["no lamp is connected", { ok: false, deviceCount: 0, failures: 1 }],
    ])("shows an alert when %s", async (_when, result) => {
      const key = await deck.key(SCENE, { presetPercentage: 100, presetKelvin: 6500 });
      vi.mocked(setLampsScene).mockResolvedValue(result);

      await deck.press(key);

      expect(key.showAlert).toHaveBeenCalledOnce();
    });

    it("sets the lamps to the default brightness and temperature, 0% at 2700 K, when the key has no settings", async () => {
      const key = await deck.key(SCENE);
      vi.mocked(setLampsScene).mockResolvedValue(SET);

      await deck.press(key);

      expect(setLampsScene).toHaveBeenCalledExactlyOnceWith([onAt("all", 0, 2700)]);
    });

    it("sets the key's lamps alone, picked on the settings page (#20)", async () => {
      // A key that adds no new lamps acts on the lamps checked alone (#147).
      changeGlobalSettings({ addNewLamps: false });
      const lamps = ["lamp-1"];
      const key = await deck.key(SCENE, { presetPercentage: 100, presetKelvin: 6500, lamps });
      vi.mocked(setLampsScene).mockResolvedValue(SET);

      await deck.press(key);

      expect(setLampsScene).toHaveBeenCalledExactlyOnceWith([onAt(["lamp-1"], 100, 6500)]);
      expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("1 lamp"));
    });

    it("turns the key's lamps off when its power is off (#174)", async () => {
      const key = await deck.key(SCENE, { power: "off", presetPercentage: 100, presetKelvin: 6500 });
      vi.mocked(setLampsScene).mockResolvedValue(SET);

      await deck.press(key);

      expect(setLampsScene).toHaveBeenCalledExactlyOnceWith([{ ...onAt("all", 100, 6500), on: false }]);
    });
  });

  describe("with groups added after the first (#174)", () => {
    const LAMP_2 = "lamp-2";
    const LAMP_3 = "lamp-3";

    it("sets each group's lamps to its own power, brightness and temperature, and leaves them out of the first", async () => {
      const key = await deck.key(SCENE, {
        presetPercentage: 50,
        presetKelvin: 5000,
        addedGroups: [
          { power: "off", presetPercentage: 0, presetKelvin: 2700, lamps: [LAMP_2] },
          { power: "on", presetPercentage: 30, presetKelvin: 3000, lamps: [LAMP_3] },
        ],
      });
      vi.mocked(setLampsScene).mockResolvedValue(SET);

      await deck.press(key);

      expect(setLampsScene).toHaveBeenCalledExactlyOnceWith([
        onAt({ except: ["lamp-2", "lamp-3"] }, 50, 5000),
        { ...onAt(["lamp-2"], 0, 2700), on: false },
        onAt(["lamp-3"], 30, 3000),
      ]);
    });

    it("leaves the groups' lamps out of the lamps the first group checked, for a key that adds no new lamps", async () => {
      changeGlobalSettings({ addNewLamps: false });
      const key = await deck.key(SCENE, {
        presetPercentage: 50,
        presetKelvin: 5000,
        lamps: ["lamp-1", LAMP_2],
        addedGroups: [{ presetPercentage: 30, presetKelvin: 3000, lamps: [LAMP_2] }],
      });
      vi.mocked(setLampsScene).mockResolvedValue(SET);

      await deck.press(key);

      expect(setLampsScene).toHaveBeenCalledExactlyOnceWith([onAt(["lamp-1"], 50, 5000), onAt(["lamp-2"], 30, 3000)]);
    });

    it("leaves the groups' lamps out along with the ones the first group left out, for a key that adds new lamps", async () => {
      const key = await deck.key(SCENE, {
        presetPercentage: 50,
        presetKelvin: 5000,
        lamps: ["lamp-1"],
        leftOutLamps: [LAMP_2],
        addedGroups: [{ presetPercentage: 30, presetKelvin: 3000, lamps: [LAMP_3] }],
      });
      vi.mocked(setLampsScene).mockResolvedValue(SET);

      await deck.press(key);

      expect(setLampsScene).toHaveBeenCalledExactlyOnceWith([
        onAt({ except: ["lamp-2", "lamp-3"] }, 50, 5000),
        onAt(["lamp-3"], 30, 3000),
      ]);
    });

    it("turns a group's lamps on, at the default brightness and temperature, for a group with no settings but its lamps", async () => {
      const key = await deck.key(SCENE, {
        presetPercentage: 50,
        presetKelvin: 5000,
        addedGroups: [{ lamps: [LAMP_2] }],
      });
      vi.mocked(setLampsScene).mockResolvedValue(SET);

      await deck.press(key);

      expect(setLampsScene).toHaveBeenCalledExactlyOnceWith([
        onAt({ except: ["lamp-2"] }, 50, 5000),
        onAt(["lamp-2"], 0, 2700),
      ]);
    });
  });

  it("shows only its image, without a title of its own", async () => {
    const key = await deck.key(SCENE, { presetPercentage: 100, presetKelvin: 6500 });

    expect(key.setTitle).not.toHaveBeenCalled();
  });

  describe("with a setting that isn't valid (#22)", () => {
    it("uses that setting's default, keeps the other, and warns", async () => {
      const key = await deck.key(SCENE, { presetPercentage: 150, presetKelvin: 6500 });
      vi.mocked(setLampsScene).mockResolvedValue(SET);

      await deck.press(key);

      expect(setLampsScene).toHaveBeenCalledExactlyOnceWith([onAt("all", 0, 6500)]);
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("presetPercentage"));
    });

    it("uses the default of a group's setting that isn't valid, keeps the group's others, and warns (#174)", async () => {
      const lamps = ["lamp-2"];
      const key = await deck.key(SCENE, { addedGroups: [{ presetPercentage: 150, presetKelvin: 3000, lamps }] });
      vi.mocked(setLampsScene).mockResolvedValue(SET);

      await deck.press(key);

      expect(setLampsScene).toHaveBeenCalledExactlyOnceWith([
        onAt({ except: ["lamp-2"] }, 0, 2700),
        onAt(["lamp-2"], 0, 3000),
      ]);
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("presetPercentage"));
    });

    it("sets the first group alone when the groups added aren't a list of groups, and warns (#174)", async () => {
      const key = await deck.key(SCENE, { addedGroups: ["lamp-2"] });
      vi.mocked(setLampsScene).mockResolvedValue(SET);

      await deck.press(key);

      expect(setLampsScene).toHaveBeenCalledExactlyOnceWith([onAt("all", 0, 2700)]);
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("addedGroups"));
    });
  });

  describe("logs", () => {
    it("a key press, with the key's brightness and temperature, before changing the lamps", async () => {
      const key = await deck.key(SCENE, { presetPercentage: 40, presetKelvin: 5000 });
      vi.mocked(setLampsScene).mockResolvedValue(SET);

      await deck.press(key);

      const message = String(at(vi.mocked(logger.info).mock.calls, 0)[0]);
      expect(message).toContain("40%");
      expect(message).toContain("5000 K");
      expect(at(vi.mocked(logger.info).mock.invocationCallOrder, 0)).toBeLessThan(
        at(vi.mocked(setLampsScene).mock.invocationCallOrder, 0),
      );
    });

    it("a key press, with what each group sets and on how many lamps (#174)", async () => {
      const key = await deck.key(SCENE, {
        presetPercentage: 40,
        presetKelvin: 5000,
        addedGroups: [{ power: "off", lamps: ["lamp-2"] }],
      });
      vi.mocked(setLampsScene).mockResolvedValue(SET);

      await deck.press(key);

      expect(logger.info).toHaveBeenCalledExactlyOnceWith(
        "Key pressed: scene 40% at 5000 K on every lamp but 1 lamp; off on 1 lamp",
      );
    });
  });
});
