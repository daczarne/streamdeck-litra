import { vi } from "vitest";

type Options = {
  /** Whether to replace `@elgato/streamdeck` with the fake SDK too, for tests that start the plugin. */
  streamDeck?: boolean;
};

/**
 * Loads the plugin's code afresh for a test, with litra running on emulated lamps: what `load` imports, and everything
 * it imports in turn, starts with no state left by an earlier test, such as learned caps or listeners. Call it in a
 * `beforeEach`, and import the code under test through it rather than at the top of the file.
 *
 * It replaces `node-hid` with `fake-node-hid.ts` and `src/logging.ts` with `fake-logging.ts`, and returns, besides what
 * `load` returned, the fake node-hid, which plugs emulated lamps in, and the logger the code logs to. The fakes are mocked with
 * `vi.doMock` after `vi.resetModules()`, rather than with `vi.mock`, whose modules outlive the reset: the code and the
 * test then share this test's fakes.
 *
 * It fails when litra didn't get the fake `node-hid`, since the tests would then write to the lamps plugged into the
 * machine. Importing node-hid opens nothing, so the check comes before any lamp is touched.
 */
export async function loadOnEmulatedLamps<T>(load: () => Promise<T>, { streamDeck = false }: Options = {}) {
  vi.resetModules();
  let nodeHidFaked = false;
  vi.doMock("node-hid", () => {
    nodeHidFaked = true;
    return import("./fake-node-hid");
  });
  vi.doMock("../logging", () => import("./fake-logging"));
  if (streamDeck) {
    vi.doMock("@elgato/streamdeck", () => import("./fake-stream-deck"));
  }

  const hid = await import("./fake-node-hid");
  const { logger } = await import("./fake-logging");
  const loaded = await load();
  //! Without the fake, the tests would write to whatever lamps are plugged in.
  if (!nodeHidFaked) {
    throw new Error("litra imported the real node-hid: see the alias and server.deps.inline in vitest.config.mjs");
  }
  return { loaded, hid, logger };
}
