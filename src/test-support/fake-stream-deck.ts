import { vi } from "vitest";

/**
 * Stands in for `@elgato/streamdeck` in the actions' tests, which mock it with
 * `vi.mock("@elgato/streamdeck", () => import("../test-support/fake-stream-deck"))`. The real SDK opens a connection to
 * Stream Deck and creates a logs/ folder on import.
 */

// Action ids are unique per plugin, so every fake key and dial gets its own.
let nextId = 1;

/**
 * A key or a dial an action is placed on, as the plugin sees it: it records what the plugin tells it to show.
 */
function createFakeAction(controller: "Keypad" | "Encoder") {
  return {
    id: `FAKE${String(nextId++).padStart(4, "0")}`,
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
export function createFakeKey(): FakeAction {
  return createFakeAction("Keypad");
}

/** A dial, as an action placed on it sees it. */
export function createFakeDial(): FakeAction {
  return createFakeAction("Encoder");
}

// The keys and dials on the Deck, which every SingletonAction reports as its own: each test shows one action's.
let visibleActions: FakeAction[] = [];

/** Places the keys and dials on the Deck, replacing the ones there before. */
export function show(...actions: FakeAction[]): void {
  visibleActions = actions;
}

/** The SDK's decorator for an action class, which the fake leaves as it is. */
export function action(_definition: { UUID: string }) {
  return <T>(target: T): T => target;
}

/** The SDK's base class for an action, which reports the keys and dials the test has placed. */
export class SingletonAction {
  /** The keys and dials this action is placed on, which a test sets with `show`. */
  get actions(): FakeAction[] {
    return visibleActions;
  }
}
