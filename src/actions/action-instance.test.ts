import type { JsonObject } from "@elgato/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { globalSettings } from "../global-settings";
import { onLampsChanged } from "../litra-manager";
import { FakeDeck } from "../test-support/fake-deck";
import { action } from "../test-support/fake-stream-deck";
import { ActionInstance, type DeckControl, RoutingAction } from "./action-instance";

//* Fakes

vi.mock("@elgato/streamdeck", () => import("../test-support/fake-stream-deck"));

// The real litra-manager loads node-hid's native binary on import and talks to real lamps.
vi.mock("../litra-manager", () => ({ onLampsChanged: vi.fn() }));

vi.mock("../global-settings", () => ({ globalSettings: { onChanged: vi.fn() } }));

const TESTED = "com.daczarne.litra.tested";

/** How the tested instances read their settings: the step alone, which every instance reads through this spy. */
const read = vi.fn((settings: JsonObject) => ({ step: typeof settings.step === "number" ? settings.step : 1 }));

/** An instance that records each call it gets, with the step its settings had then. */
class Recorder extends ActionInstance<{ step: number }> {
  readonly calls: string[] = [];

  /** Takes the key or dial and its settings. */
  constructor(control: DeckControl, settings: JsonObject) {
    super(control, settings, read);
  }

  /** Records a call, with the step the settings had then. */
  private record(call: string): void {
    this.calls.push(`${call} ${this.config.step}`);
  }

  /** Records it. */
  override appear(): void {
    this.record("appear");
  }

  /** Records it. */
  override disappear(): void {
    this.record("disappear");
  }

  /** Records it. */
  override settingsChanged(): void {
    this.record("settingsChanged");
  }

  /** Records it. */
  override lampsChanged(): void {
    this.record("lampsChanged");
  }

  /** Records it. */
  override globalSettingsChanged(): void {
    this.record("globalSettingsChanged");
  }

  /** Records it. */
  override keyDown(): void {
    this.record("keyDown");
  }

  /** Records it. */
  override dialDown(): void {
    this.record("dialDown");
  }

  /** Records it, with the ticks. */
  override dialRotate(ticks: number): void {
    this.record(`dialRotate(${ticks})`);
  }

  /** Records it, with whether the strip was held. */
  override touchTap(hold: boolean): void {
    this.record(`touchTap(${hold})`);
  }
}

/** An action whose instances record what they get, and which places none on a dial when told to. */
@action({ UUID: TESTED })
class TestedAction extends RoutingAction<Recorder> {
  readonly created: Recorder[] = [];
  keysOnly = false;

  /** A recorder, kept for the test, or none on a dial when the action takes keys alone. */
  protected override create(control: DeckControl, settings: JsonObject): Recorder | undefined {
    if (this.keysOnly && !control.isKey()) {
      return undefined;
    }
    const recorder = new Recorder(control, settings);
    this.created.push(recorder);
    return recorder;
  }
}

let tested: TestedAction;
let deck: FakeDeck;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  tested = new TestedAction();
  deck = new FakeDeck([tested]);
});

afterEach(() => {
  vi.useRealTimers();
});

/** The listener the action registered with a subscription, such as litra-manager's notice. */
function listenerOf(subscribe: (listener: () => void | Promise<void>) => unknown): () => void | Promise<void> {
  const listener = vi.mocked(subscribe).mock.lastCall?.[0];
  if (listener === undefined) {
    throw new Error("The action didn't subscribe");
  }
  return listener;
}

//* Tests

describe("RoutingAction", () => {
  it("creates an instance for each key or dial as it appears, with its settings, and lets it draw itself", async () => {
    await deck.key(TESTED, { step: 5 });
    await deck.dial(TESTED);

    expect(tested.created.map((instance) => instance.calls)).toEqual([["appear 5"], ["appear 1"]]);
  });

  it("hands each event to the instance of its own key or dial", async () => {
    const key = await deck.key(TESTED);
    const dial = await deck.dial(TESTED);

    await deck.press(key);
    await deck.push(dial);
    await deck.turn(dial, -3);
    await deck.tap(dial);
    await deck.hold(dial);

    const [keyInstance, dialInstance] = tested.created;
    expect(keyInstance?.calls).toEqual(["appear 1", "keyDown 1"]);
    expect(dialInstance?.calls).toEqual([
      "appear 1",
      "dialDown 1",
      "dialRotate(-3) 1",
      "touchTap(false) 1",
      "touchTap(true) 1",
    ]);
  });

  it("hands an instance its new settings, and lets it redraw", async () => {
    const key = await deck.key(TESTED);

    await deck.changeSettings(key, { step: 5 });
    await deck.press(key);

    expect(tested.created[0]?.calls).toEqual(["appear 1", "settingsChanged 5", "keyDown 5"]);
  });

  it("reads the settings again only when they changed, so a setting that isn't valid is warned about once", async () => {
    const key = await deck.key(TESTED, { step: 5 });

    await deck.press(key);
    await deck.press(key);

    expect(read).toHaveBeenCalledOnce();

    await deck.changeSettings(key, { step: 2 });

    expect(read).toHaveBeenCalledTimes(2);
  });

  it("hands every instance the notice that the lamps changed, or the global settings", async () => {
    await deck.key(TESTED);
    await deck.dial(TESTED);

    await listenerOf(onLampsChanged)();
    await listenerOf(globalSettings.onChanged)();

    for (const instance of tested.created) {
      expect(instance.calls).toEqual(["appear 1", "lampsChanged 1", "globalSettingsChanged 1"]);
    }
  });

  it("drops the instance of a key that disappears, once it let go of what it holds, and no longer hands it anything", async () => {
    const key = await deck.key(TESTED);
    const instance = tested.created[0];

    await deck.remove(key);
    await listenerOf(onLampsChanged)();

    expect(instance?.calls).toEqual(["appear 1", "disappear 1"]);
  });

  it("ignores an event of a key that disappeared, which the SDK doesn't send", async () => {
    const key = await deck.key(TESTED);
    await deck.remove(key);

    await deck.changeSettings(key, { step: 5 });
    await deck.press(key);

    expect(tested.created.map((instance) => instance.calls)).toEqual([["appear 1", "disappear 1"]]);
  });

  it("ignores a key or dial it creates no instance for", async () => {
    tested.keysOnly = true;
    const dial = await deck.dial(TESTED);

    await deck.turn(dial, 1);
    await listenerOf(onLampsChanged)();

    expect(tested.created).toEqual([]);
  });
});
