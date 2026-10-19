import fs from "node:fs";

import { beforeEach, describe, expect, it, vi } from "vitest";

//* Fakes

// The SDK's default export, which only plugin.ts uses: the actions' fakes cover the rest of the module.
const streamDeck = vi.hoisted(() => ({
  logger: { setLevel: vi.fn() },
  actions: { registerAction: vi.fn() },
  ui: { onSendToPlugin: vi.fn(), sendToPropertyInspector: vi.fn() },
  connect: vi.fn<() => Promise<void>>(),
}));

vi.mock("@elgato/streamdeck", async () => ({
  ...(await import("./test-support/fake-stream-deck")),
  default: streamDeck,
}));
// The real logger writes to a logs/ folder.
vi.mock("./logging", () => import("./test-support/fake-logging"));
// The real litra loads node-hid's native binary on import. Starting the plugin talks to no lamp, so only what
// litra-manager.ts reads when it loads is needed.
vi.mock("litra", () => ({
  DeviceType: { LitraGlow: "litra_glow", LitraBeam: "litra_beam", LitraBeamLX: "litra_beam_lx" },
}));

// The actions the manifest lists, which Stream Deck shows and sends events for.
const MANIFEST_UUIDS = (
  JSON.parse(fs.readFileSync("com.daczarne.litra.sdPlugin/manifest.json", "utf8")) as { Actions: { UUID: string }[] }
).Actions.map(({ UUID }) => UUID);

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
});
