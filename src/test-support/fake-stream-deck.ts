import { vi } from "vitest";

/**
 * Stands in for `@elgato/streamdeck` in the actions' tests, which mock it with
 * `vi.mock("@elgato/streamdeck", () => import("../test-support/fake-stream-deck"))`. The real SDK opens a connection to
 * Stream Deck and creates a logs/ folder on import.
 */

// Action ids are unique per plugin, so every fake key and dial gets its own.
let nextId = 1;

/**
 * A key or a dial an action is placed on, as the plugin sees it: it records what the plugin tells it to show. Given
 * the id of an action in the manifest, it belongs to that action alone, as on the Deck. Without one, every action
 * counts it as its own, which is enough for tests of one action.
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
    return visibleActions.filter((placed) => placed.manifestId === undefined || placed.manifestId === this.manifestId);
  }
}

// The actions plugin.ts registers, in order.
const registered: SingletonAction[] = [];

/** The actions the plugin registered, to which Stream Deck sends the events of their keys and dials. */
export function registeredActions(): readonly SingletonAction[] {
  return registered;
}

/** The SDK's entry point, as plugin.ts uses it: it records the actions registered, and connects to nothing. */
export default {
  logger: { setLevel: (_level: string): void => {} },
  actions: {
    registerAction: (registering: SingletonAction): void => {
      registered.push(registering);
    },
  },
  connect: async (): Promise<void> => {},
};
