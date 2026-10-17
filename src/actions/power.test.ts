import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { isOnAll, onLampsChanged, toggleAll, turnOffAll, turnOnAll } from "../litra-manager";
import { logger } from "../logging";
import { at } from "../test-support/at";
import { FakeDeck } from "../test-support/fake-deck";
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

const POWER = "com.daczarne.litra.power";

const SWITCHED = { ok: true, deviceCount: 2, failures: 0 };

let deck: FakeDeck;
// What the action does when litra-manager announces that the lamps changed.
let lampsChanged: () => Promise<void>;

beforeEach(() => {
  vi.useFakeTimers();
  // The lamps as a key that appears reads them, unless a test says otherwise: some on, some off.
  vi.mocked(isOnAll).mockResolvedValue({ ok: true, allOn: false, deviceCount: 2 });
  const power = new PowerAction();
  const listener = vi.mocked(onLampsChanged).mock.lastCall?.[0];
  if (listener === undefined) {
    throw new Error("PowerAction didn't listen for lamp changes");
  }
  lampsChanged = async () => listener();
  deck = new FakeDeck([power]);
});

afterEach(() => {
  vi.useRealTimers();
});

/** Forgets what placing the keys did, so that a test checks only what its own interaction does. */
function clearCalls(): void {
  vi.clearAllMocks();
}

//* Tests

describe("PowerAction", () => {
  describe("when the lamps change", () => {
    it("shows the lamps' state on every Power key, not only the one pressed, from one read (#57)", async () => {
      const key = await deck.key(POWER);
      const otherKey = await deck.key(POWER);
      clearCalls();
      vi.mocked(isOnAll).mockResolvedValue({ ok: true, allOn: true, deviceCount: 2 });

      await lampsChanged();

      expect(key.setState).toHaveBeenCalledExactlyOnceWith(1);
      expect(otherKey.setState).toHaveBeenCalledExactlyOnceWith(1);
      expect(isOnAll).toHaveBeenCalledOnce();
    });

    it("shows off when only some lamps are on", async () => {
      const key = await deck.key(POWER);
      clearCalls();
      vi.mocked(isOnAll).mockResolvedValue({ ok: true, allOn: false, deviceCount: 2 });

      await lampsChanged();

      expect(key.setState).toHaveBeenCalledExactlyOnceWith(0);
    });

    it("shows off when no lamp is connected", async () => {
      const key = await deck.key(POWER);
      clearCalls();
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
      const key = await deck.key(POWER, mode === undefined ? {} : { mode });
      clearCalls();
      vi.mocked(operation).mockReturnValue(SWITCHED);

      await deck.press(key);

      expect(operation).toHaveBeenCalledOnce();
      expect(key.setState).not.toHaveBeenCalled();
      expect(key.showAlert).not.toHaveBeenCalled();
    });

    it("toggles the lamps in a mode that isn't valid, with a warning (#22)", async () => {
      const key = await deck.key(POWER, { mode: "blink" });
      clearCalls();
      vi.mocked(toggleAll).mockReturnValue(SWITCHED);

      await deck.press(key);

      expect(toggleAll).toHaveBeenCalledOnce();
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("mode"));
    });

    it("shows an alert when a lamp fails, once the notice has redrawn the key's state, so the state doesn't cover it (#132)", async () => {
      const key = await deck.key(POWER);
      const otherKey = await deck.key(POWER);
      clearCalls();
      vi.mocked(toggleAll).mockReturnValue({ ok: false, deviceCount: 0, failures: 1 });

      await deck.press(key);

      expect(key.showAlert).not.toHaveBeenCalled();

      await lampsChanged();

      expect(key.showAlert).toHaveBeenCalledOnce();
      expect(at(key.showAlert.mock.invocationCallOrder, 0)).toBeGreaterThan(
        at(key.setState.mock.invocationCallOrder, 0),
      );
      expect(otherKey.showAlert).not.toHaveBeenCalled();
    });

    it("shows a failed press's alert only once, with the redraw that follows the press", async () => {
      const key = await deck.key(POWER);
      vi.mocked(toggleAll).mockReturnValue({ ok: false, deviceCount: 0, failures: 1 });
      await deck.press(key);
      await lampsChanged();
      clearCalls();

      await lampsChanged();

      expect(key.setState).toHaveBeenCalledOnce();
      expect(key.showAlert).not.toHaveBeenCalled();
    });

    it("logs the press, with the key's mode, before switching the lamps", async () => {
      const key = await deck.key(POWER, { mode: "off" });
      clearCalls();
      vi.mocked(turnOffAll).mockReturnValue(SWITCHED);

      await deck.press(key);

      expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("off"));
      expect(at(vi.mocked(logger.info).mock.invocationCallOrder, 0)).toBeLessThan(
        at(vi.mocked(turnOffAll).mock.invocationCallOrder, 0),
      );
    });
  });

  it("shows the lamps' state on a key that appears", async () => {
    vi.mocked(isOnAll).mockResolvedValue({ ok: true, allOn: true, deviceCount: 2 });

    const key = await deck.key(POWER);

    expect(key.setState).toHaveBeenCalledExactlyOnceWith(1);
  });
});
