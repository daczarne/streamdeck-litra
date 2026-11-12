import fs from "node:fs";

import type { JsonObject } from "@elgato/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { at } from "./test-support/at";

//* Fakes

// The SDK's default export, which only plugin.ts uses: the actions' fakes cover the rest of the module.
const streamDeck = vi.hoisted(() => ({
  logger: { setLevel: vi.fn() },
  actions: { registerAction: vi.fn() },
  ui: { onSendToPlugin: vi.fn(), sendToPropertyInspector: vi.fn() },
  settings: {
    getGlobalSettings: vi.fn<() => Promise<JsonObject>>(async () => ({})),
    onDidReceiveGlobalSettings: vi.fn(),
    setGlobalSettings: vi.fn(async () => {}),
  },
  connect: vi.fn<() => Promise<void>>(),
}));

vi.mock("@elgato/streamdeck", async () => ({
  ...(await import("./test-support/fake-stream-deck")),
  default: streamDeck,
}));
// The real logger writes to a logs/ folder.
vi.mock("./logging", () => import("./test-support/fake-logging"));
// The real litra loads node-hid's native binary on import, so only what litra-manager.ts reads when it loads is needed.
vi.mock("litra", () => ({
  DeviceType: { LitraGlow: "litra_glow", LitraBeam: "litra_beam", LitraBeamLX: "litra_beam_lx" },
}));
// The real litra-manager, but for what plugin.ts calls on it, which would reach the lamps plugged in.
const manager = vi.hoisted(() => ({
  useLamps: vi.fn(),
  findLamps: vi.fn<() => { id: string; label: string; model: string }[]>(() => []),
  reachEveryLamp: vi.fn(),
}));
vi.mock("./litra-manager", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./litra-manager")>()),
  ...manager,
}));

// The actions the manifest lists, which Stream Deck shows and sends events for.
const MANIFEST_UUIDS = (
  JSON.parse(fs.readFileSync("com.daczarne.litra.sdPlugin/manifest.json", "utf8")) as { Actions: { UUID: string }[] }
).Actions.map(({ UUID }) => UUID);

const BEAM = { id: "0000000000001111", label: "Beam - 1111", model: "Beam" };
const BEAM_LX = { id: "0000000000002222", label: "Beam LX - 2222", model: "Beam LX" };

/** Runs plugin.ts, as Stream Deck does when it starts the plugin, and returns the logger it logs to. */
async function start() {
  await import("./plugin");
  return (await import("./logging")).logger;
}

//* Tests

describe("plugin", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("registers an action for each one in the manifest, then connects to Stream Deck", async () => {
    streamDeck.connect.mockResolvedValue();

    const logger = await start();

    // An action in the manifest without one registered would show in Stream Deck and do nothing.
    const registered = streamDeck.actions.registerAction.mock.calls.map(
      ([action]) => (action as { manifestId: string }).manifestId,
    );
    expect(registered.toSorted()).toEqual(MANIFEST_UUIDS.toSorted());
    // The lamp picker on the keys' settings pages asks the plugin for the lamps (#20).
    expect(streamDeck.ui.onSendToPlugin).toHaveBeenCalledOnce();
    // The dials share the blink of their lamp screens as a global setting (#144).
    expect(streamDeck.settings.onDidReceiveGlobalSettings).toHaveBeenCalledOnce();
    expect(streamDeck.settings.getGlobalSettings).toHaveBeenCalledOnce();
    expect(streamDeck.connect).toHaveBeenCalledOnce();
    // Lets the connection settle, so that a handler for its failure would have run.
    await streamDeck.connect.mock.results[0]?.value;
    expect(logger.error).not.toHaveBeenCalled();
  });

  it("logs a failed connection with its error", async () => {
    const error = new Error("connection refused");
    streamDeck.connect.mockRejectedValue(error);

    const logger = await start();

    await vi.waitFor(() =>
      expect(logger.error).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("connect"), error),
    );
  });

  it("hands litra-manager the lamps the global settings hold, before it connects (#198)", async () => {
    streamDeck.connect.mockResolvedValue();

    await start();

    const { globalSettings } = await import("./global-settings");
    expect(manager.useLamps).toHaveBeenCalledExactlyOnceWith(globalSettings.lamps);
    expect(at(manager.useLamps.mock.invocationCallOrder, 0)).toBeLessThan(
      at(streamDeck.connect.mock.invocationCallOrder, 0),
    );
  });

  it("reads every lamp it knows once the global settings are read, without looking for others (#198)", async () => {
    streamDeck.settings.getGlobalSettings.mockResolvedValue({ lamps: { [BEAM.id]: { model: "Beam" } } });
    streamDeck.connect.mockResolvedValue();

    await start();

    await vi.waitFor(() => expect(manager.reachEveryLamp).toHaveBeenCalledOnce());
    expect(manager.findLamps).not.toHaveBeenCalled();
    expect(streamDeck.settings.setGlobalSettings).not.toHaveBeenCalled();
  });

  it("finds, saves and reads the lamps when it knows none, keeping the other settings (#194)", async () => {
    streamDeck.settings.getGlobalSettings.mockResolvedValue({ identifyBlinkMs: 600 });
    manager.findLamps.mockReturnValue([BEAM, BEAM_LX]);
    streamDeck.connect.mockResolvedValue();

    const logger = await start();

    await vi.waitFor(() => expect(manager.reachEveryLamp).toHaveBeenCalledOnce());
    expect(streamDeck.settings.setGlobalSettings).toHaveBeenCalledExactlyOnceWith({
      identifyBlinkMs: 600,
      lamps: { [BEAM.id]: { model: "Beam" }, [BEAM_LX.id]: { model: "Beam LX" } },
    });
    // The lamps are read once they're known, or the read would reach none.
    expect(at(manager.reachEveryLamp.mock.invocationCallOrder, 0)).toBeGreaterThan(
      at(streamDeck.settings.setGlobalSettings.mock.invocationCallOrder, 0),
    );
    expect(vi.mocked(logger.info).mock.calls).toEqual([
      ["Plugin started"],
      [expect.stringContaining("No lamps known")],
      [expect.stringContaining("Beam - 1111, Beam LX - 2222")],
    ]);
  });

  it("finds the lamps when what's saved isn't lamps by id, as when it knows none", async () => {
    streamDeck.settings.getGlobalSettings.mockResolvedValue({ lamps: [BEAM.id] });
    manager.findLamps.mockReturnValue([BEAM]);
    streamDeck.connect.mockResolvedValue();

    await start();

    await vi.waitFor(() => expect(manager.reachEveryLamp).toHaveBeenCalledOnce());
    expect(streamDeck.settings.setGlobalSettings).toHaveBeenCalledExactlyOnceWith({
      lamps: { [BEAM.id]: { model: "Beam" } },
    });
  });

  it("saves nothing when it knows no lamps and finds none, and still reads", async () => {
    streamDeck.connect.mockResolvedValue();

    await start();

    await vi.waitFor(() => expect(manager.reachEveryLamp).toHaveBeenCalledOnce());
    expect(manager.findLamps).toHaveBeenCalledOnce();
    expect(streamDeck.settings.setGlobalSettings).not.toHaveBeenCalled();
  });

  it("logs a failed read of the global settings, and reads no lamp, so it saves none over the ones saved", async () => {
    const error = new Error("connection closed");
    streamDeck.settings.getGlobalSettings.mockRejectedValue(error);
    streamDeck.connect.mockResolvedValue();

    const logger = await start();

    await vi.waitFor(() =>
      expect(logger.error).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("global settings"), error),
    );
    expect(manager.findLamps).not.toHaveBeenCalled();
    expect(manager.reachEveryLamp).not.toHaveBeenCalled();
  });
});
