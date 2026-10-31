import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { setLampsScene } from "../litra-manager";
import { logger } from "../logging";
import { at } from "../test-support/at";
import { FakeDeck } from "../test-support/fake-deck";
import { changeGlobalSettings } from "../test-support/fake-stream-deck";
import { followGlobalSettings } from "./global-settings";
import { SceneAction } from "./scene";

//* Fakes

vi.mock("@elgato/streamdeck", () => import("../test-support/fake-stream-deck"));

// The real logger writes to a logs/ folder.
vi.mock("../logging", () => import("../test-support/fake-logging"));

// The real litra-manager loads node-hid's native binary on import and talks to real lamps.
vi.mock("../litra-manager", () => ({
  setLampsScene: vi.fn(),
}));

const SCENE = "com.daczarne.litra.scene";

const SET = { ok: true, deviceCount: 2, failures: 0 };

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

      expect(setLampsScene).toHaveBeenCalledExactlyOnceWith("all", 100, 6500);
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

      expect(setLampsScene).toHaveBeenCalledExactlyOnceWith("all", 0, 2700);
    });

    it("sets the key's lamps alone, picked on the settings page (#20)", async () => {
      // A key that adds no new lamps acts on the lamps checked alone (#147).
      changeGlobalSettings({ addNewLamps: false });
      const lamps = [{ id: "lamp-1", label: "Beam - 1111" }];
      const key = await deck.key(SCENE, { presetPercentage: 100, presetKelvin: 6500, lamps });
      vi.mocked(setLampsScene).mockResolvedValue(SET);

      await deck.press(key);

      expect(setLampsScene).toHaveBeenCalledExactlyOnceWith(["lamp-1"], 100, 6500);
      expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("1 lamp"));
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

      expect(setLampsScene).toHaveBeenCalledExactlyOnceWith("all", 0, 6500);
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("presetPercentage"));
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
  });
});
