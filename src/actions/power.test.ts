import type { JsonValue } from "@elgato/utils";
import { describe, expect, it, vi } from "vitest";

import { isOnAll, onLampsChanged, toggleAll, turnOffAll, turnOnAll } from "../litra-manager";
import { logger } from "../logging";
import { at } from "../test-support/at";
import { createFakeDial, createFakeKey, type FakeAction, show } from "../test-support/fake-stream-deck";
import { PowerAction } from "./power";

//* Fakes

vi.mock("@elgato/streamdeck", () => import("../test-support/fake-stream-deck"));

// The real logger writes to a logs/ folder.
vi.mock("../logging", () => import("../test-support/fake-logging"));

// The real litra-manager loads node-hid's native binary on import and talks to real lamps.
vi.mock("../litra-manager", () => ({
  isOnAll: vi.fn(),
  onLampsChanged: vi.fn(),
  toggleAll: vi.fn(),
  turnOffAll: vi.fn(),
  turnOnAll: vi.fn(),
}));

const SWITCHED = { ok: true, deviceCount: 2, failures: 0 };

/** The event of a press on a key, with the mode it has saved. */
function keyDown(key: FakeAction, mode?: JsonValue) {
  return { action: key, payload: { settings: { mode } } } as never;
}

/** Creates the action, and returns what it does when litra-manager announces that the lamps changed. */
function createPowerAction(): { power: PowerAction; lampsChanged: () => Promise<void> } {
  const power = new PowerAction();
  const listener = vi.mocked(onLampsChanged).mock.lastCall?.[0];
  if (listener === undefined) {
    throw new Error("PowerAction didn't listen for lamp changes");
  }
  return { power, lampsChanged: async () => listener() };
}

//* Tests

describe("PowerAction", () => {
  describe("when the lamps change", () => {
    it("shows the lamps' state on every Power key, not only the one pressed (#57)", async () => {
      const key = createFakeKey();
      const otherKey = createFakeKey();
      const dial = createFakeDial();
      show(key, dial, otherKey);
      const { lampsChanged } = createPowerAction();
      vi.mocked(isOnAll).mockResolvedValue({ ok: true, allOn: true, deviceCount: 2 });

      await lampsChanged();

      expect(key.setState).toHaveBeenCalledExactlyOnceWith(1);
      expect(otherKey.setState).toHaveBeenCalledExactlyOnceWith(1);
      expect(isOnAll).toHaveBeenCalledOnce();
    });

    it("shows off when only some lamps are on", async () => {
      const key = createFakeKey();
      show(key);
      const { lampsChanged } = createPowerAction();
      vi.mocked(isOnAll).mockResolvedValue({ ok: true, allOn: false, deviceCount: 2 });

      await lampsChanged();

      expect(key.setState).toHaveBeenCalledExactlyOnceWith(0);
    });

    it("shows off when no lamp is connected", async () => {
      const key = createFakeKey();
      show(key);
      const { lampsChanged } = createPowerAction();
      vi.mocked(isOnAll).mockResolvedValue({ ok: false, allOn: false, deviceCount: 0 });

      await lampsChanged();

      expect(key.setState).toHaveBeenCalledExactlyOnceWith(0);
    });
  });

  describe("on a key press", () => {
    it.each([
      [undefined, toggleAll],
      ["toggle" as const, toggleAll],
      ["on" as const, turnOnAll],
      ["off" as const, turnOffAll],
    ])("in mode %s, switches the lamps, and leaves showing the result to the notice", async (mode, operation) => {
      const key = createFakeKey();
      show(key);
      const { power } = createPowerAction();
      vi.mocked(operation).mockReturnValue(SWITCHED);

      await power.onKeyDown(keyDown(key, mode));

      expect(operation).toHaveBeenCalledOnce();
      expect(key.setState).not.toHaveBeenCalled();
      expect(key.showAlert).not.toHaveBeenCalled();
    });

    it("toggles the lamps in a mode that isn't valid, with a warning (#22)", async () => {
      const key = createFakeKey();
      show(key);
      const { power } = createPowerAction();
      vi.mocked(toggleAll).mockReturnValue(SWITCHED);

      await power.onKeyDown(keyDown(key, "blink"));

      expect(toggleAll).toHaveBeenCalledOnce();
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("mode"));
    });

    it("shows an alert when a lamp fails", async () => {
      const key = createFakeKey();
      show(key);
      const { power } = createPowerAction();
      vi.mocked(toggleAll).mockReturnValue({ ok: false, deviceCount: 0, failures: 1 });

      await power.onKeyDown(keyDown(key));

      expect(key.showAlert).toHaveBeenCalledOnce();
    });

    it("logs the press, with the key's mode, before switching the lamps", async () => {
      const key = createFakeKey();
      show(key);
      const { power } = createPowerAction();
      vi.mocked(turnOffAll).mockReturnValue(SWITCHED);

      await power.onKeyDown(keyDown(key, "off"));

      expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("off"));
      expect(at(vi.mocked(logger.info).mock.invocationCallOrder, 0)).toBeLessThan(
        at(vi.mocked(turnOffAll).mock.invocationCallOrder, 0),
      );
    });
  });

  it("shows the lamps' state on a key that appears", async () => {
    const key = createFakeKey();
    show(key);
    const { power } = createPowerAction();
    vi.mocked(isOnAll).mockResolvedValue({ ok: true, allOn: true, deviceCount: 2 });

    await power.onWillAppear({ action: key, payload: { settings: {} } } as never);

    expect(key.setState).toHaveBeenCalledExactlyOnceWith(1);
  });
});
