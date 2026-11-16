import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDebouncer } from "../controls/debouncer";
import { temperatureShown } from "../controls/shown";
import { adjustLampsTemperature, type OperationResult } from "../lamps/manager";
import { logger } from "../logging";
import { syncGlobalSettings } from "../settings/global-settings";
import { FakeDeck } from "../test-support/fake-deck";
import { changeGlobalSettings } from "../test-support/fake-stream-deck";
import { TemperatureUpAction } from "./temperature-up";

//* Fakes

vi.mock("@elgato/streamdeck", () => import("../test-support/fake-stream-deck"));

// The real logger writes to a logs/ folder.
vi.mock("../logging", () => import("../test-support/fake-logging"));

// The debouncer gathers what each test says, without the timing its own tests check.
vi.mock("../controls/debouncer", () => ({ createDebouncer: vi.fn() }));

// What the keys show of the lamps, which each test sets, with the real text it's shown as.
vi.mock("../controls/shown", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../controls/shown")>()),
  temperatureShown: vi.fn(),
}));

// The real lamp manager loads node-hid's native binary on import and talks to real lamps.
vi.mock("../lamps/manager", () => ({
  adjustLampsBrightness: vi.fn(),
  adjustLampsTemperature: vi.fn(),
  onLampsChanged: vi.fn(),
}));

const TEMPERATURE_UP = "com.daczarne.litra.temperature-up";

/** How an operation on two Beams went. */
const DONE: OperationResult = { ok: true, lampCount: 2, failures: 0 };

let deck: FakeDeck;

// The global settings, which hold the keys' lamps (#147).
await syncGlobalSettings();

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  changeGlobalSettings({});
  // The debouncer flushes every press at once: its own timing is debouncer.test.ts's to check.
  vi.mocked(createDebouncer).mockImplementation((flush) => (presses) => void flush(presses));
  // The first lamp at 4000 K, as the plugin holds it.
  vi.mocked(temperatureShown).mockResolvedValue({ kelvin: 4000, percentage: 34 });
  vi.mocked(adjustLampsTemperature).mockResolvedValue(DONE);
  deck = new FakeDeck([new TemperatureUpAction()]);
});

afterEach(() => {
  vi.useRealTimers();
});

//* Tests

describe("TemperatureUpAction", () => {
  it("steps every lamp up by the default step, and shows the first lamp's temperature as its title", async () => {
    const key = await deck.key(TEMPERATURE_UP);

    await deck.press(key);

    expect(key.setTitle).toHaveBeenCalledExactlyOnceWith("4000 K");
    expect(adjustLampsTemperature).toHaveBeenCalledExactlyOnceWith("all", 1, 300, "together");
    expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("1 step of 300 K"));
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
