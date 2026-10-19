import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { areLampsOn, onLampsChanged, toggleLamps, turnLampsOff, turnLampsOn } from "../litra-manager";
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
  areLampsOn: vi.fn(),
  onLampsChanged: vi.fn(),
  toggleLamps: vi.fn(),
  turnLampsOff: vi.fn(),
  turnLampsOn: vi.fn(),
}));

const POWER = "com.daczarne.litra.power";

const SWITCHED = { ok: true, deviceCount: 2, failures: 0 };

// Lamps as the settings page saves them, with their ids and labels (#20).
const LAMP_1 = { id: "lamp-1", label: "Beam - 1111" };
const LAMP_2 = { id: "lamp-2", label: "Beam - 2222" };

let deck: FakeDeck;
// What the action does when litra-manager announces that the lamps changed.
let lampsChanged: () => Promise<void>;

beforeEach(() => {
  vi.useFakeTimers();
  // The lamps as a key that appears reads them, unless a test says otherwise: some on, some off.
  vi.mocked(areLampsOn).mockResolvedValue({ ok: true, allOn: false, deviceCount: 2 });
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
      vi.mocked(areLampsOn).mockResolvedValue({ ok: true, allOn: true, deviceCount: 2 });

      await lampsChanged();

      expect(key.setState).toHaveBeenCalledExactlyOnceWith(1);
      expect(otherKey.setState).toHaveBeenCalledExactlyOnceWith(1);
      expect(areLampsOn).toHaveBeenCalledOnce();
    });

    it("shows off when only some lamps are on", async () => {
      const key = await deck.key(POWER);
      clearCalls();
      vi.mocked(areLampsOn).mockResolvedValue({ ok: true, allOn: false, deviceCount: 2 });

      await lampsChanged();

      expect(key.setState).toHaveBeenCalledExactlyOnceWith(0);
    });

    it("shows off when no lamp is connected", async () => {
      const key = await deck.key(POWER);
      clearCalls();
      vi.mocked(areLampsOn).mockResolvedValue({ ok: false, allOn: false, deviceCount: 0 });

      await lampsChanged();

      expect(key.setState).toHaveBeenCalledExactlyOnceWith(0);
    });
  });

  describe("on a key press", () => {
    it.each([
      [undefined, toggleLamps],
      ["toggle" as const, toggleLamps],
      ["on" as const, turnLampsOn],
      ["off" as const, turnLampsOff],
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
      vi.mocked(toggleLamps).mockReturnValue(SWITCHED);

      await deck.press(key);

      expect(toggleLamps).toHaveBeenCalledOnce();
      expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("mode"));
    });

    it("shows an alert when a lamp fails, once the notice has redrawn the key's state, so the state doesn't cover it (#132)", async () => {
      const key = await deck.key(POWER);
      const otherKey = await deck.key(POWER);
      clearCalls();
      vi.mocked(toggleLamps).mockReturnValue({ ok: false, deviceCount: 0, failures: 1 });

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
      vi.mocked(toggleLamps).mockReturnValue({ ok: false, deviceCount: 0, failures: 1 });
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
      vi.mocked(turnLampsOff).mockReturnValue(SWITCHED);

      await deck.press(key);

      expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("off"));
      expect(at(vi.mocked(logger.info).mock.invocationCallOrder, 0)).toBeLessThan(
        at(vi.mocked(turnLampsOff).mock.invocationCallOrder, 0),
      );
    });
  });

  it("shows the lamps' state on a key that appears", async () => {
    vi.mocked(areLampsOn).mockResolvedValue({ ok: true, allOn: true, deviceCount: 2 });

    const key = await deck.key(POWER);

    expect(key.setState).toHaveBeenCalledExactlyOnceWith(1);
  });

  describe("with lamps picked on the settings page (#20)", () => {
    it.each([
      ["toggle" as const, toggleLamps],
      ["on" as const, turnLampsOn],
      ["off" as const, turnLampsOff],
    ])("in mode %s, switches the key's lamps alone", async (mode, operation) => {
      const key = await deck.key(POWER, { mode, lamps: [LAMP_1, LAMP_2] });
      clearCalls();
      vi.mocked(operation).mockReturnValue(SWITCHED);

      await deck.press(key);

      expect(operation).toHaveBeenCalledExactlyOnceWith([LAMP_1.id, LAMP_2.id]);
    });

    it("switches every lamp from a key without lamps saved, set up before they could be picked", async () => {
      const key = await deck.key(POWER, { mode: "toggle" });
      clearCalls();
      vi.mocked(toggleLamps).mockReturnValue(SWITCHED);

      await deck.press(key);

      expect(toggleLamps).toHaveBeenCalledExactlyOnceWith("all");
    });

    it("shows each key the state of its own lamps, from one read for each set of lamps", async () => {
      const onEvery = await deck.key(POWER);
      const onFirst = await deck.key(POWER, { lamps: [LAMP_1] });
      const alsoOnFirst = await deck.key(POWER, { lamps: [LAMP_1] });
      const onSecond = await deck.key(POWER, { lamps: [LAMP_2] });
      clearCalls();
      // Lamp 1 is on, lamp 2 off.
      vi.mocked(areLampsOn).mockImplementation(async (lamps) => ({
        ok: true,
        allOn: lamps !== "all" && lamps.every((id) => id === LAMP_1.id),
        deviceCount: lamps === "all" ? 2 : lamps.length,
      }));

      await lampsChanged();

      expect([onEvery, onFirst, alsoOnFirst, onSecond].map((key) => key.setState.mock.lastCall)).toEqual([
        [0],
        [1],
        [1],
        [0],
      ]);
      expect(vi.mocked(areLampsOn).mock.calls).toEqual([["all"], [[LAMP_1.id]], [[LAMP_2.id]]]);
    });

    it("shows the state of the key's new lamps once they're changed on the settings page", async () => {
      const key = await deck.key(POWER);
      clearCalls();
      vi.mocked(areLampsOn).mockResolvedValue({ ok: true, allOn: true, deviceCount: 1 });

      await deck.changeSettings(key, { lamps: [LAMP_2] });

      expect(areLampsOn).toHaveBeenCalledExactlyOnceWith([LAMP_2.id]);
      expect(key.setState).toHaveBeenCalledExactlyOnceWith(1);
    });

    it("logs how many lamps a press switches", async () => {
      const key = await deck.key(POWER, { mode: "on", lamps: [LAMP_1] });
      const everyLamp = await deck.key(POWER, { mode: "on" });
      clearCalls();
      vi.mocked(turnLampsOn).mockReturnValue(SWITCHED);

      await deck.press(key);
      await deck.press(everyLamp);

      expect(vi.mocked(logger.info).mock.calls).toEqual([
        [expect.stringContaining("1 lamp")],
        [expect.stringContaining("every lamp")],
      ]);
    });
  });
});
