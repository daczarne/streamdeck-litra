import { beforeEach, describe, expect, it, vi } from "vitest";

import { globalSettings as pluginSettings } from "../global-settings";
import { connectedLamps, findLamps, identifyLamp, onConnectedChanged, reachEveryLamp } from "../litra-manager";
import { logger } from "../logging";
import { at } from "../test-support/at";
import { answer, answerLampPickers } from "./lamp-picker";
import { globalSettings } from "./settings";

//* Fakes

// The SDK's UI controller, which carries the messages between the settings pages and the plugin.
const ui = vi.hoisted(() => ({
  onSendToPlugin: vi.fn(),
  sendToPropertyInspector: vi.fn<(payload: unknown) => Promise<void>>(),
}));

vi.mock("@elgato/streamdeck", () => ({ default: { ui } }));

// The real logger writes to a logs/ folder.
vi.mock("../logging", () => import("../test-support/fake-logging"));

// The real litra-manager loads node-hid's native binary on import and talks to real lamps.
vi.mock("../litra-manager", () => ({
  connectedLamps: vi.fn(),
  findLamps: vi.fn(),
  identifyLamp: vi.fn(),
  onConnectedChanged: vi.fn(),
  reachEveryLamp: vi.fn(),
}));

// The lamps the plugin knows, which the real global settings save through Stream Deck.
vi.mock("../global-settings", async () => {
  const { globalSettings } = await import("./settings");
  return {
    globalSettings: {
      addLamps: vi.fn(async () => {}),
      forgetLamp: vi.fn(async () => {}),
      identifyBlinkMs: globalSettings.identifyBlinkMs.default,
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
  vi.mocked(findLamps).mockReturnValue(LAMPS);
  vi.mocked(identifyLamp).mockResolvedValue({ ok: true, deviceCount: 1, failures: 0 });
});

//* Tests

describe("the lamp picker's answers (#20)", () => {
  it("send a page that asks for the lamps the ones connected now, by id, label, model and serial end", async () => {
    await answer({ event: "lamps" });

    expect(findLamps).toHaveBeenCalledOnce();
    expect(ui.sendToPropertyInspector).toHaveBeenCalledExactlyOnceWith({ event: "lamps", lamps: LAMPS });
  });

  it("add the lamps found to the ones the plugin knows, before answering (#194)", async () => {
    await answer({ event: "lamps" });

    expect(pluginSettings.addLamps).toHaveBeenCalledExactlyOnceWith(LAMPS);
    expect(vi.mocked(pluginSettings.addLamps).mock.invocationCallOrder[0]).toBeLessThan(
      at(ui.sendToPropertyInspector.mock.invocationCallOrder, 0),
    );
  });

  it("read the lamps once they're added, so the keys and dials show them (#198)", async () => {
    await answer({ event: "lamps" });

    expect(reachEveryLamp).toHaveBeenCalledOnce();
    expect(at(vi.mocked(pluginSettings.addLamps).mock.invocationCallOrder, 0)).toBeLessThan(
      at(vi.mocked(reachEveryLamp).mock.invocationCallOrder, 0),
    );
  });

  it("send an empty list when no lamp is connected", async () => {
    vi.mocked(findLamps).mockReturnValue([]);

    await answer({ event: "lamps" });

    expect(ui.sendToPropertyInspector).toHaveBeenCalledExactlyOnceWith({ event: "lamps", lamps: [] });
  });

  it("blink the lamp whose Identify button was pressed", async () => {
    await answer({ event: "identify", id: "lamp-2" });

    expect(identifyLamp).toHaveBeenCalledExactlyOnceWith("lamp-2", globalSettings.identifyBlinkMs.default);
    expect(ui.sendToPropertyInspector).not.toHaveBeenCalled();
  });

  it("have the plugin name the lamp a page renamed (#146)", async () => {
    await answer({ event: "rename", id: "lamp-2", name: "Fill light" });

    expect(pluginSettings.renameLamp).toHaveBeenCalledExactlyOnceWith("lamp-2", "Fill light");
    expect(ui.sendToPropertyInspector).not.toHaveBeenCalled();
  });

  it("have the plugin forget the lamp a page asked it to (#194)", async () => {
    await answer({ event: "forget", id: "lamp-1" });

    expect(pluginSettings.forgetLamp).toHaveBeenCalledExactlyOnceWith("lamp-1");
    expect(ui.sendToPropertyInspector).not.toHaveBeenCalled();
  });

  it.each([
    ["another event", { event: "something" }],
    ["an identify without a lamp", { event: "identify" }],
    ["a rename without a name", { event: "rename", id: "lamp-1" }],
    ["a rename without a lamp", { event: "rename", name: "Key light" }],
    ["a forget without a lamp", { event: "forget" }],
    ["a message that isn't an object", "lamps"],
    ["an empty message", null],
  ])("ignore %s", async (_name, payload) => {
    await answer(payload);

    expect(findLamps).not.toHaveBeenCalled();
    expect(pluginSettings.addLamps).not.toHaveBeenCalled();
    expect(identifyLamp).not.toHaveBeenCalled();
    expect(pluginSettings.renameLamp).not.toHaveBeenCalled();
    expect(pluginSettings.forgetLamp).not.toHaveBeenCalled();
    expect(ui.sendToPropertyInspector).not.toHaveBeenCalled();
  });

  it("log what the page asked for", async () => {
    await answer({ event: "lamps" });
    await answer({ event: "identify", id: "lamp-1" });
    await answer({ event: "forget", id: "lamp-1" });

    expect(vi.mocked(logger.info).mock.calls).toEqual([
      [expect.stringContaining("asked for the lamps")],
      [expect.stringContaining("Identify")],
      [expect.stringContaining("Forget")],
    ]);
  });

  it("are given every message the pages send, and log one that fails, with its error", async () => {
    answerLampPickers();
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

describe("which lamps are connected (#198)", () => {
  it("are told to a page that asks, as the plugin last found them", async () => {
    vi.mocked(connectedLamps).mockReturnValue(["lamp-1"]);

    await answer({ event: "connected" });

    expect(ui.sendToPropertyInspector).toHaveBeenCalledExactlyOnceWith({ event: "connected", ids: ["lamp-1"] });
  });

  it("are told to the page shown whenever an operation finds a lamp plugged in or unplugged", async () => {
    answerLampPickers();
    const [listener] = at(vi.mocked(onConnectedChanged).mock.calls, 0);

    await listener(["lamp-2"]);

    expect(ui.sendToPropertyInspector).toHaveBeenCalledExactlyOnceWith({ event: "connected", ids: ["lamp-2"] });
  });
});
