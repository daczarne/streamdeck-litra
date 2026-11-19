import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  connectedLamps,
  findLamps,
  identifyLamp,
  onConnectedChanged,
  reachEveryLamp,
  syncLampsToPlugin,
  syncPluginToLamps,
} from "../lamps/manager";
import { logger } from "../logging";
import { at } from "../test-support/at";
import { globalSettings } from "./global-settings";
import { answer, answerPluginSettingsPage } from "./plugin-settings-page";
import { globalSettingsSchema } from "./schemas";

//* Fakes

// The SDK's UI controller, which carries the messages between the settings pages and the plugin.
const ui = vi.hoisted(() => ({
  onSendToPlugin: vi.fn(),
  sendToPropertyInspector: vi.fn<(payload: unknown) => Promise<void>>(),
}));

vi.mock("@elgato/streamdeck", () => ({ default: { ui } }));

// The real logger writes to a logs/ folder.
vi.mock("../logging", () => import("../test-support/fake-logging"));

// The real lamp manager loads node-hid's native binary on import and talks to real lamps.
vi.mock("../lamps/manager", () => ({
  connectedLamps: vi.fn(),
  findLamps: vi.fn(),
  identifyLamp: vi.fn(),
  onConnectedChanged: vi.fn(),
  reachEveryLamp: vi.fn(),
  syncLampsToPlugin: vi.fn(),
  syncPluginToLamps: vi.fn(),
}));

// The lamps the plugin knows, which the real global settings save through Stream Deck.
vi.mock("./global-settings", async () => {
  const { globalSettingsSchema } = await import("./schemas");
  return {
    globalSettings: {
      addLamps: vi.fn(async () => {}),
      forgetLamp: vi.fn(async () => {}),
      identifyBlinkMs: globalSettingsSchema.identifyBlinkMs.default,
      renameLamp: vi.fn(async () => {}),
    },
  };
});

const LAMPS = [
  { id: "lamp-1", label: "Beam - mp-1", model: "Beam" },
  { id: "lamp-2", label: "Beam LX - mp-2", model: "Beam LX" },
];

beforeEach(() => {
  ui.sendToPropertyInspector.mockResolvedValue();
  vi.mocked(findLamps).mockResolvedValue(LAMPS);
  vi.mocked(identifyLamp).mockResolvedValue({ ok: true, lampCount: 1, failures: 0 });
});

//* Tests

describe("the plugin settings page's answers (#146)", () => {
  it("send a page that asks for the lamps the ones connected now, by id, label and model", async () => {
    await answer({ event: "lamps" });

    expect(findLamps).toHaveBeenCalledOnce();
    expect(ui.sendToPropertyInspector).toHaveBeenCalledExactlyOnceWith({ event: "lamps", lamps: LAMPS });
  });

  it("add the lamps found to the ones the plugin knows, before answering (#194)", async () => {
    await answer({ event: "lamps" });

    expect(globalSettings.addLamps).toHaveBeenCalledExactlyOnceWith(LAMPS);
    expect(at(vi.mocked(globalSettings.addLamps).mock.invocationCallOrder, 0)).toBeLessThan(
      at(ui.sendToPropertyInspector.mock.invocationCallOrder, 0),
    );
  });

  it("read the lamps once they're added, so the keys and dials show them (#198)", async () => {
    await answer({ event: "lamps" });

    expect(reachEveryLamp).toHaveBeenCalledExactlyOnceWith("find lamps");
    expect(at(vi.mocked(globalSettings.addLamps).mock.invocationCallOrder, 0)).toBeLessThan(
      at(vi.mocked(reachEveryLamp).mock.invocationCallOrder, 0),
    );
  });

  it("send an empty list when no lamp is connected", async () => {
    vi.mocked(findLamps).mockResolvedValue([]);

    await answer({ event: "lamps" });

    expect(ui.sendToPropertyInspector).toHaveBeenCalledExactlyOnceWith({ event: "lamps", lamps: [] });
  });

  it("blink the lamp whose Identify button was pressed", async () => {
    await answer({ event: "identify", id: "lamp-2" });

    expect(identifyLamp).toHaveBeenCalledExactlyOnceWith("lamp-2", globalSettingsSchema.identifyBlinkMs.default);
    expect(ui.sendToPropertyInspector).not.toHaveBeenCalled();
  });

  it("have the plugin name the lamp a page renamed (#146)", async () => {
    await answer({ event: "rename", id: "lamp-2", name: "Fill light" });

    expect(globalSettings.renameLamp).toHaveBeenCalledExactlyOnceWith("lamp-2", "Fill light");
    expect(ui.sendToPropertyInspector).not.toHaveBeenCalled();
  });

  it("have the plugin forget the lamp a page asked it to (#194)", async () => {
    await answer({ event: "forget", id: "lamp-1" });

    expect(globalSettings.forgetLamp).toHaveBeenCalledExactlyOnceWith("lamp-1");
    expect(ui.sendToPropertyInspector).not.toHaveBeenCalled();
  });

  it.each([
    ["another event", { event: "something" }],
    ["an identify without a lamp", { event: "identify" }],
    ["a rename without a name", { event: "rename", id: "lamp-1" }],
    ["a rename without a lamp", { event: "rename", name: "Key light" }],
    ["a forget without a lamp", { event: "forget" }],
    ["a re-sync without a direction", { event: "resync" }],
    ["a re-sync in a direction it doesn't know", { event: "resync", direction: "both" }],
    ["a message that isn't an object", "lamps"],
    ["an empty message", null],
  ])("ignore %s", async (_name, payload) => {
    await answer(payload);

    expect(findLamps).not.toHaveBeenCalled();
    expect(globalSettings.addLamps).not.toHaveBeenCalled();
    expect(identifyLamp).not.toHaveBeenCalled();
    expect(globalSettings.renameLamp).not.toHaveBeenCalled();
    expect(globalSettings.forgetLamp).not.toHaveBeenCalled();
    expect(syncPluginToLamps).not.toHaveBeenCalled();
    expect(syncLampsToPlugin).not.toHaveBeenCalled();
    expect(ui.sendToPropertyInspector).not.toHaveBeenCalled();
  });

  it("log what the page asked for", async () => {
    await answer({ event: "lamps" });
    await answer({ event: "identify", id: "lamp-1" });
    await answer({ event: "forget", id: "lamp-1" });
    await answer({ event: "resync", direction: "pluginToLamps" });
    await answer({ event: "resync", direction: "lampsToPlugin" });

    expect(vi.mocked(logger.info).mock.calls).toEqual([
      [expect.stringContaining("asked for the lamps")],
      [expect.stringContaining("Identify")],
      [expect.stringContaining("Forget")],
      ["Re-sync pressed on a settings page: plugin to lamps"],
      ["Re-sync pressed on a settings page: lamps to plugin"],
    ]);
  });

  it("are given every message the pages send, and log one that fails, with its error", async () => {
    answerPluginSettingsPage();
    const listener = at(ui.onSendToPlugin.mock.calls, 0)[0] as (ev: { payload: unknown }) => void;
    ui.sendToPropertyInspector.mockRejectedValue(new Error("Stream Deck is gone"));

    listener({ payload: { event: "lamps" } });
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalledOnce());

    expect(logger.error).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ message: "Stream Deck is gone" }),
    );
  });
});

describe("a re-sync (#214)", () => {
  it("brings the plugin in step with the lamps, when the page chose that direction", async () => {
    await answer({ event: "resync", direction: "pluginToLamps" });

    expect(syncPluginToLamps).toHaveBeenCalledOnce();
    expect(syncLampsToPlugin).not.toHaveBeenCalled();
    expect(ui.sendToPropertyInspector).not.toHaveBeenCalled();
  });

  it("brings the lamps in step with the plugin, when the page chose that direction", async () => {
    await answer({ event: "resync", direction: "lampsToPlugin" });

    expect(syncLampsToPlugin).toHaveBeenCalledOnce();
    expect(syncPluginToLamps).not.toHaveBeenCalled();
    expect(ui.sendToPropertyInspector).not.toHaveBeenCalled();
  });

  it("is ignored, with a warning, in a direction the plugin doesn't know", async () => {
    await answer({ event: "resync", direction: "both" });

    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      'Re-sync pressed on a settings page, in no direction it knows: "both"',
    );
  });
});

describe("which lamps are connected (#198)", () => {
  it("are told to a page that asks, as the plugin last found them", async () => {
    vi.mocked(connectedLamps).mockReturnValue(["lamp-1"]);

    await answer({ event: "connected" });

    expect(ui.sendToPropertyInspector).toHaveBeenCalledExactlyOnceWith({ event: "connected", ids: ["lamp-1"] });
  });

  it("are told to the page shown whenever an operation finds a lamp plugged in or unplugged", async () => {
    answerPluginSettingsPage();
    const [listener] = at(vi.mocked(onConnectedChanged).mock.calls, 0);

    await listener(["lamp-2"]);

    expect(ui.sendToPropertyInspector).toHaveBeenCalledExactlyOnceWith({ event: "connected", ids: ["lamp-2"] });
  });
});
