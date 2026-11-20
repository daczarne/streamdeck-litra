import { action } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type OperationResult, onLampsChanged } from "../lamps/manager";
import { logger } from "../logging";
import { syncGlobalSettings } from "../settings/global-settings";
import { at } from "../test-support/at";
import { FakeDeck } from "../test-support/fake-deck";
import { changeGlobalSettings } from "../test-support/fake-stream-deck";
import { type Preset, PresetKeyAction } from "./preset-key";

//* Fakes

vi.mock("@elgato/streamdeck", () => import("../test-support/fake-stream-deck"));

// The real logger writes to a logs/ folder.
vi.mock("../logging", () => import("../test-support/fake-logging"));

// The real lamp manager loads node-hid's native binary on import and talks to real lamps.
vi.mock("../lamps/manager", () => ({ onLampsChanged: vi.fn() }));

const FAKE = "com.daczarne.litra.fake-preset";

/** How an operation on two lamps went, or one with no lamp connected. */
const DONE: OperationResult = { ok: true, lampCount: 2, failures: 0 };
const FAILED: OperationResult = { ...DONE, ok: false, failures: 1 };
const NO_LAMP: OperationResult = { ok: false, lampCount: 0, failures: 1 };

/** What the fake keys set: the preset in their settings, or 50, on the lamps checked, or every lamp. */
const PRESET = {
  read: vi.fn((settings: JsonObject) => ({
    preset: typeof settings.preset === "number" ? settings.preset : 50,
    lamps: Array.isArray(settings.lamps) ? settings.lamps.filter((id) => typeof id === "string") : ("all" as const),
    leftOutLamps: [],
  })),
  unit: " u",
  turnsLampsOn: vi.fn<Preset["turnsLampsOn"]>(),
  set: vi.fn<Preset["set"]>(),
} satisfies Preset;

/**
 * An action built on PresetKeyAction, as the Set Brightness and Set Temperature actions are, with fakes for what's
 * theirs.
 */
@action({ UUID: FAKE })
class FakePresetKeyAction extends PresetKeyAction {
  /** Sets through the fakes. */
  constructor() {
    super(logger, PRESET);
  }
}

let deck: FakeDeck;
// What the action does when the lamp manager announces that the lamps changed.
let lampsChanged: () => Promise<void>;

// The global settings, which the tests change as a settings page does (#147).
await syncGlobalSettings();

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  changeGlobalSettings({});
  PRESET.turnsLampsOn.mockReturnValue(false);
  PRESET.set.mockResolvedValue(DONE);
  const fake = new FakePresetKeyAction();
  const listener = vi.mocked(onLampsChanged).mock.lastCall?.[0];
  if (listener === undefined) {
    throw new Error("The fake action didn't listen for lamp changes");
  }
  lampsChanged = async () => listener();
  deck = new FakeDeck([fake]);
});

afterEach(() => {
  vi.useRealTimers();
});

/** Forgets what placing the keys did, so that a test checks only what its own interaction does. */
function clearCalls(): void {
  vi.clearAllMocks();
}

//* Tests

describe("a key of a PresetKeyAction", () => {
  it("reads its settings through what it sets, and shows its preset as its title when it appears", async () => {
    const key = await deck.key(FAKE, { preset: 40 });

    expect(PRESET.read).toHaveBeenCalledExactlyOnceWith({ preset: 40 }, logger);
    expect(key.setTitle).toHaveBeenCalledExactlyOnceWith("40 u");
  });

  it("shows a preset off the pages' grid rounded, as its title", async () => {
    const key = await deck.key(FAKE, { preset: 33.5 });

    expect(key.setTitle).toHaveBeenCalledExactlyOnceWith("34 u");
  });

  it("shows its new preset once the settings page changes it", async () => {
    const key = await deck.key(FAKE, { preset: 40 });

    await deck.changeSettings(key, { preset: 70 });

    expect(key.setTitle).toHaveBeenLastCalledWith("70 u");
  });

  it("sets every lamp to its preset, and leaves showing the result to the notice", async () => {
    const key = await deck.key(FAKE, { preset: 40 });
    clearCalls();

    await deck.press(key);

    expect(PRESET.set).toHaveBeenCalledExactlyOnceWith("all", 40, false);
    expect(key.showAlert).not.toHaveBeenCalled();
    expect(key.setTitle).not.toHaveBeenCalled();
  });

  it("turns its lamps on as it sets them when the global settings say so (#268), and logs it", async () => {
    PRESET.turnsLampsOn.mockReturnValue(true);
    const key = await deck.key(FAKE, { preset: 40 });
    clearCalls();

    await deck.press(key);

    expect(PRESET.set).toHaveBeenCalledExactlyOnceWith("all", 40, true);
    expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("turning lamps on"));
  });

  it("sets its lamps alone, picked on the settings page (#20)", async () => {
    // A key that adds no new lamps acts on the lamps checked alone (#147).
    changeGlobalSettings({ addNewLamps: false });
    const key = await deck.key(FAKE, { preset: 40, lamps: ["lamp-1"] });
    clearCalls();

    await deck.press(key);

    expect(PRESET.set).toHaveBeenCalledExactlyOnceWith(["lamp-1"], 40, false);
    expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("1 lamp"));
  });

  it.each([
    ["a lamp fails", FAILED],
    ["no lamp is connected", NO_LAMP],
  ])("shows an alert when %s", async (_when, result) => {
    const key = await deck.key(FAKE);
    PRESET.set.mockResolvedValue(result);

    await deck.press(key);

    expect(key.showAlert).toHaveBeenCalledOnce();
  });

  it("follows no change to the lamps", async () => {
    const key = await deck.key(FAKE);
    clearCalls();

    await lampsChanged();

    expect(key.setTitle).not.toHaveBeenCalled();
  });
});

describe("a PresetKeyAction logs", () => {
  it("a key press, with the key's preset in its unit, before changing the lamps", async () => {
    const key = await deck.key(FAKE, { preset: 40 });

    await deck.press(key);

    expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("preset 40 u"));
    expect(at(vi.mocked(logger.info).mock.invocationCallOrder, 0)).toBeLessThan(
      at(PRESET.set.mock.invocationCallOrder, 0),
    );
  });

  it("nothing for a dial, which the manifest doesn't place it on", async () => {
    const dial = await deck.dial(FAKE);

    await deck.turn(dial, 1);
    await deck.push(dial);

    expect(logger.info).not.toHaveBeenCalled();
    expect(dial.setFeedback).not.toHaveBeenCalled();
  });
});
