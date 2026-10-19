import fs from "node:fs";
import path from "node:path";
import type { JsonValue } from "@elgato/utils";

import { vi } from "vitest";

/**
 * Stands in for `@elgato/streamdeck` in the actions' tests, which mock it with
 * `vi.mock("@elgato/streamdeck", () => import("../test-support/fake-stream-deck"))`. The real SDK opens a connection to
 * Stream Deck and creates a logs/ folder on import.
 */

// Action ids are unique per plugin, so every fake key and dial gets its own.
let nextId = 1;

/**
 * A key or a dial an action is placed on, as the plugin sees it: it records what the plugin tells it to show. It
 * belongs to the action whose id in the manifest it's given, as on the Deck. The tests of what sits below the actions,
 * such as the lamp screens, create it without one.
 */
function createFakeAction(controller: "Keypad" | "Encoder", manifestId?: string) {
  return {
    id: `FAKE${String(nextId++).padStart(4, "0")}`,
    manifestId,
    isKey: (): boolean => controller === "Keypad",
    isDial: (): boolean => controller === "Encoder",
    setTitle: vi.fn(async (_title?: string): Promise<void> => {}),
    setFeedback: vi.fn(async (_feedback: object): Promise<void> => {}),
    setFeedbackLayout: vi.fn(async (_layout: string): Promise<void> => {}),
    setState: vi.fn(async (_state: number): Promise<void> => {}),
    setTriggerDescription: vi.fn(async (_descriptions?: object): Promise<void> => {}),
    showAlert: vi.fn(async (): Promise<void> => {}),
  };
}

export type FakeAction = ReturnType<typeof createFakeAction>;

/** A key, as an action placed on it sees it. */
export function createFakeKey(manifestId?: string): FakeAction {
  return createFakeAction("Keypad", manifestId);
}

/** A dial, as an action placed on it sees it. */
export function createFakeDial(manifestId?: string): FakeAction {
  return createFakeAction("Encoder", manifestId);
}

// The keys and dials on the Deck, which each SingletonAction filters for its own.
let visibleActions: FakeAction[] = [];

/** Places the keys and dials on the Deck, replacing the ones there before. */
export function show(...actions: FakeAction[]): void {
  visibleActions = actions;
}

/** The SDK's decorator for an action class, which gives the class the action's id in the manifest, as the SDK's does. */
export function action(definition: { UUID: string }) {
  return <T extends { prototype: object }>(target: T): T => {
    Object.defineProperty(target.prototype, "manifestId", { value: definition.UUID });
    return target;
  };
}

/** The SDK's base class for an action, which reports the keys and dials the test has placed for it. */
export class SingletonAction {
  /** The action's id in the manifest, which the decorator sets. */
  declare readonly manifestId: string | undefined;

  /** The keys and dials this action is placed on, which a test sets with `show`. */
  get actions(): FakeAction[] {
    return visibleActions.filter((placed) => placed.manifestId === this.manifestId);
  }
}

// The actions the manifest lists, against which the SDK checks every action registered.
const MANIFEST_UUIDS = (
  JSON.parse(
    fs.readFileSync(path.resolve(import.meta.dirname, "../../com.daczarne.litra.sdPlugin/manifest.json"), "utf8"),
  ) as { Actions: { UUID: string }[] }
).Actions.map(({ UUID }) => UUID);

// The actions plugin.ts registers, in order.
const registered: SingletonAction[] = [];

/** The actions the plugin registered, to which Stream Deck sends the events of their keys and dials. */
export function registeredActions(): readonly SingletonAction[] {
  return registered;
}

/**
 * The SDK's entry point, as plugin.ts uses it: it records the actions registered, and connects to nothing. Like the
 * SDK, it refuses an action whose id the manifest doesn't list, which Stream Deck would never send events to.
 */
const pluginListeners: Array<(ev: { payload: JsonValue }) => void> = [];
const toPropertyInspector: JsonValue[] = [];

/** Sends a message from a settings page to the plugin, as Stream Deck passes it on. */
export function sendToPlugin(payload: JsonValue): void {
  for (const listener of pluginListeners) {
    listener({ payload });
  }
}

/** What the plugin sent to the settings pages, in order. */
export function sentToPropertyInspector(): readonly JsonValue[] {
  return toPropertyInspector;
}

export default {
  logger: { setLevel: (_level: string): void => {} },
  ui: {
    onSendToPlugin: (listener: (ev: { payload: JsonValue }) => void): { dispose: () => void } => {
      pluginListeners.push(listener);
      return { dispose: () => pluginListeners.splice(pluginListeners.indexOf(listener), 1) };
    },
    sendToPropertyInspector: async (payload: JsonValue): Promise<void> => {
      toPropertyInspector.push(payload);
    },
  },
  actions: {
    registerAction: (registering: SingletonAction): void => {
      if (registering.manifestId === undefined || !MANIFEST_UUIDS.includes(registering.manifestId)) {
        throw new Error(`The action's manifestId was not found within the manifest: ${registering.manifestId}`);
      }
      registered.push(registering);
    },
  },
  connect: async (): Promise<void> => {},
};
