import type { JsonObject } from "@elgato/utils";
import { vi } from "vitest";

import { createFakeDial, createFakeKey, type FakeAction, registeredActions, show } from "./fake-stream-deck";

type Handler = (ev: never) => void | Promise<void>;

/** An action, as the Deck sees it: the id it's registered under, which the fake SDK and the real one both give it. */
type DeckAction = { readonly manifestId?: string | undefined };

/** The handlers an action can have for the events the fake Deck sends. */
type EventName =
  | "onWillAppear"
  | "onWillDisappear"
  | "onDidReceiveSettings"
  | "onKeyDown"
  | "onDialDown"
  | "onDialRotate"
  | "onTouchTap";

/**
 * The Deck for the tests of the actions: it places keys and dials for some actions, and sends each one's events to the
 * action it belongs to, by its `manifestId`, as Stream Deck would. The integration tests give it the actions plugin.ts
 * registered with the fake `@elgato/streamdeck`, and the unit tests the action they test. It needs Vitest's fake
 * timers.
 *
 * Each interaction waits for everything it set off to finish, timers included: a brightness change that settles, the
 * dial's debounce, a blink, and what the actions redraw when the lamps change. Within {@link quickly}, the
 * interactions are sent back to back instead, as when a dial is turned fast, and the waiting comes after the last.
 */
export class FakeDeck {
  // The settings each key and dial has saved, by its id.
  private readonly settings = new Map<string, JsonObject>();
  private readonly placed: FakeAction[] = [];
  // The events sent within quickly(), which it waits for.
  private batch: Promise<void>[] | undefined;
  private readonly actions: readonly DeckAction[];

  /** A Deck for these actions: by default, the ones plugin.ts registered. */
  constructor(actions: readonly DeckAction[] = registeredActions()) {
    this.actions = actions;
  }

  /** Places a key for an action, with its settings, as when a profile is shown. */
  key(manifestId: string, settings: JsonObject = {}): Promise<FakeAction> {
    return this.place(createFakeKey(manifestId), settings);
  }

  /** Places a dial for an action, with its settings, as when a profile is shown. */
  dial(manifestId: string, settings: JsonObject = {}): Promise<FakeAction> {
    return this.place(createFakeDial(manifestId), settings);
  }

  /** Takes a key or a dial off the Deck, as when the user switches to another profile. */
  async remove(placed: FakeAction): Promise<void> {
    this.placed.splice(this.placed.indexOf(placed), 1);
    show(...this.placed);
    await this.send(placed, "onWillDisappear", {});
  }

  /** Presses a key. */
  press(key: FakeAction): Promise<void> {
    return this.send(key, "onKeyDown", {});
  }

  /** Turns a dial by some ticks: positive clockwise, negative counterclockwise. */
  turn(dial: FakeAction, ticks: number): Promise<void> {
    return this.send(dial, "onDialRotate", { ticks });
  }

  /** Pushes a dial down. */
  push(dial: FakeAction): Promise<void> {
    return this.send(dial, "onDialDown", {});
  }

  /** Taps a dial's part of the touch strip. */
  tap(dial: FakeAction): Promise<void> {
    return this.send(dial, "onTouchTap", { hold: false });
  }

  /** Holds a dial's part of the touch strip. */
  hold(dial: FakeAction): Promise<void> {
    return this.send(dial, "onTouchTap", { hold: true });
  }

  /** Saves new settings for a key or a dial, as its settings page does. */
  changeSettings(placed: FakeAction, settings: JsonObject): Promise<void> {
    this.settings.set(placed.id, settings);
    return this.send(placed, "onDidReceiveSettings", {});
  }

  /** Sends the interactions back to back, then waits for everything they set off. */
  async quickly(interactions: () => void): Promise<void> {
    this.batch = [];
    try {
      interactions();
      await vi.runAllTimersAsync();
      await Promise.all(this.batch);
    } finally {
      this.batch = undefined;
    }
  }

  /** Puts a key or a dial on the Deck, where its action sees it, and tells the action it appeared. */
  private async place(placed: FakeAction, settings: JsonObject): Promise<FakeAction> {
    this.settings.set(placed.id, settings);
    this.placed.push(placed);
    show(...this.placed);
    await this.send(placed, "onWillAppear", {});
    return placed;
  }

  /**
   * Sends an event to the action the key or dial belongs to, with the settings it has saved, as Stream Deck routes it,
   * and waits for what it set off unless within {@link quickly}. An action without a handler for it ignores it.
   */
  private send(placed: FakeAction, event: EventName, payload: object): Promise<void> {
    const target = this.actions.find((candidate) => candidate.manifestId === placed.manifestId);
    if (target === undefined) {
      throw new Error(`No action registered as ${String(placed.manifestId)}`);
    }
    const handler = (target as DeckAction & Partial<Record<EventName, Handler>>)[event];
    const ev = { action: placed, payload: { settings: this.settings.get(placed.id) ?? {}, ...payload } } as never;
    const handled = Promise.resolve(handler?.call(target, ev));
    if (this.batch !== undefined) {
      this.batch.push(handled);
      return Promise.resolve();
    }
    return vi.runAllTimersAsync().then(() => handled);
  }
}
