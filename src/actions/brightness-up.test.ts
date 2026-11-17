import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDebouncer } from "../controls/debouncer";
import { brightnessShown } from "../controls/shown";
import { adjustLampsBrightness, type OperationResult } from "../lamps/manager";
import { logger } from "../logging";
import { syncGlobalSettings } from "../settings/global-settings";
import { FakeDeck } from "../test-support/fake-deck";
import { changeGlobalSettings } from "../test-support/fake-stream-deck";
import { BrightnessUpAction } from "./brightness-up";

//* Fakes

vi.mock("@elgato/streamdeck", () => import("../test-support/fake-stream-deck"));

// The real logger writes to a logs/ folder.
vi.mock("../logging", () => import("../test-support/fake-logging"));

// The debouncer gathers what each test says, without the timing its own tests check.
vi.mock("../controls/debouncer", () => ({ createDebouncer: vi.fn() }));

// What the keys show of the lamps, which each test sets, with the real text it's shown as.
vi.mock("../controls/shown", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../controls/shown")>()),
  brightnessShown: vi.fn(),
}));

// The real lamp manager loads node-hid's native binary on import and talks to real lamps.
vi.mock("../lamps/manager", () => ({
  adjustLampsBrightness: vi.fn(),
  adjustLampsTemperature: vi.fn(),
  onLampsChanged: vi.fn(),
}));

const BRIGHTNESS_UP = "com.daczarne.litra.brightness-up";

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
  // Two Beams on a Stream Deck + XL's USB hub, which stopped at 63% and 79%, as the plugin holds them.
  vi.mocked(brightnessShown).mockResolvedValue([63, 79]);
  vi.mocked(adjustLampsBrightness).mockResolvedValue(DONE);
  deck = new FakeDeck([new BrightnessUpAction()]);
});

afterEach(() => {
  vi.useRealTimers();
});

//* Tests

describe("BrightnessUpAction", () => {
  it("steps every lamp up by the default step, and shows the brightest lamp's % as its title", async () => {
    const key = await deck.key(BRIGHTNESS_UP);

    await deck.press(key);

    expect(key.setTitle).toHaveBeenCalledExactlyOnceWith("79%");
    expect(adjustLampsBrightness).toHaveBeenCalledExactlyOnceWith("all", 1, 10, "together", false);
    expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("1 step of 10%"));
    expect(logger.warn).not.toHaveBeenCalled();
  });
});
