import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

//* Fakes

// The SDK's default export, which only plugin.ts uses: the actions' fakes cover the rest of the module.
const streamDeck = vi.hoisted(() => ({
  logger: { setLevel: vi.fn() },
  actions: { registerAction: vi.fn() },
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

/** Runs plugin.ts, as Stream Deck does when it starts the plugin, and returns the logger it logs to. */
async function start() {
  await import("./plugin");
  return (await import("./logging")).logger;
}

//* Tests

describe("plugin", () => {
  let exit: MockInstance<typeof process.exit>;

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    exit = vi.spyOn(process, "exit").mockImplementation(() => undefined as never);
  });

  afterEach(() => {
    exit.mockRestore();
  });

  it("registers every action, then connects to Stream Deck", async () => {
    streamDeck.connect.mockResolvedValue();

    const logger = await start();

    expect(streamDeck.actions.registerAction).toHaveBeenCalledTimes(3);
    expect(streamDeck.connect).toHaveBeenCalledOnce();
    // Lets the connection settle, so that a handler for its failure would have run.
    await streamDeck.connect.mock.results[0]?.value;
    expect(logger.error).not.toHaveBeenCalled();
    expect(exit).not.toHaveBeenCalled();
  });

  it("logs a failed connection with its error, then ends", async () => {
    const error = new Error("connection refused");
    streamDeck.connect.mockRejectedValue(error);

    const logger = await start();

    await vi.waitFor(() => expect(exit).toHaveBeenCalledWith(1));
    expect(logger.error).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("connect"), error);
  });
});
