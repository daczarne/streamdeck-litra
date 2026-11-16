import { action } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adjustLampsBrightness, adjustLampsTemperature, type OperationResult, onLampsChanged } from "../lamps/manager";
import { logger } from "../logging";
import { syncGlobalSettings } from "../settings/global-settings";
import { at } from "../test-support/at";
import { FakeDeck } from "../test-support/fake-deck";
import { changeGlobalSettings } from "../test-support/fake-stream-deck";
import { createDebouncer } from "./debouncer";
import { brightnessShown, temperatureShown } from "./shown";
import { BRIGHTNESS, StepKeyAction, TEMPERATURE } from "./step-key";

//* Fakes

vi.mock("@elgato/streamdeck", () => import("../test-support/fake-stream-deck"));

// The real logger writes to a logs/ folder.
vi.mock("../logging", () => import("../test-support/fake-logging"));

// The debouncer gathers what each test says, without the timing its own tests check.
vi.mock("./debouncer", () => ({ createDebouncer: vi.fn() }));

// What the keys show of the lamps, which each test sets, with the real text it's shown as.
vi.mock("./shown", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./shown")>()),
  brightnessShown: vi.fn(),
  temperatureShown: vi.fn(),
}));

// The real lamp manager loads node-hid's native binary on import and talks to real lamps.
vi.mock("../lamps/manager", () => ({
  adjustLampsBrightness: vi.fn(),
  adjustLampsTemperature: vi.fn(),
  onLampsChanged: vi.fn(),
}));

const FAKE_UP = "com.daczarne.litra.fake-step-up";
const FAKE_DOWN = "com.daczarne.litra.fake-step-down";

/** How an operation on two Beams went. */
const DONE: OperationResult = { ok: true, lampCount: 2, failures: 0 };
const FAILED: OperationResult = { ...DONE, ok: false, failures: 1 };
const NO_LAMP: OperationResult = { ok: false, lampCount: 0, failures: 1 };

// Lamps as the settings page saves them, by their ids (#20, #194).
const LAMP_1 = "lamp-1";
const LAMP_2 = "lamp-2";

type Stepped = typeof BRIGHTNESS;

/** What the fake keys step: by the step in their settings, or 2, on the lamps checked, or every lamp. */
const STEPPED = {
  read: vi.fn((settings: JsonObject) => ({
    step: typeof settings.step === "number" ? settings.step : 2,
    lamps: Array.isArray(settings.lamps) ? settings.lamps.filter((id) => typeof id === "string") : ("all" as const),
    leftOutLamps: [],
  })),
  stepping: vi.fn<Stepped["stepping"]>(),
  unit: " u",
  adjust: vi.fn<Stepped["adjust"]>(),
  title: vi.fn<Stepped["title"]>(),
} satisfies Stepped;

/** A step action stepping up, as Brightness Up and Temperature Up are, with fakes for what it steps. */
@action({ UUID: FAKE_UP })
class FakeStepUpAction extends StepKeyAction {
  /** Steps up through the fakes. */
  constructor() {
    super(logger, STEPPED, 1);
  }
}

/** A step action stepping down, as Brightness Down and Temperature Down are. */
@action({ UUID: FAKE_DOWN })
class FakeStepDownAction extends StepKeyAction {
  /** Steps down through the fakes. */
  constructor() {
    super(logger, STEPPED, -1);
  }
}

let deck: FakeDeck;
// What both actions do when the lamp manager announces that the lamps changed.
let lampsChanged: () => Promise<void>;

// The global settings, which the tests change as a settings page does (#145, #147).
await syncGlobalSettings();

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  changeGlobalSettings({});
  // The debouncer flushes every press at once: its own timing is debouncer.test.ts's to check.
  vi.mocked(createDebouncer).mockImplementation((flush) => (presses) => void flush(presses));
  STEPPED.stepping.mockReturnValue("together");
  STEPPED.adjust.mockResolvedValue(DONE);
  STEPPED.title.mockResolvedValue("42 u");
  const actions = [new FakeStepUpAction(), new FakeStepDownAction()];
  const listeners = vi.mocked(onLampsChanged).mock.calls.map(([listener]) => listener);
  if (listeners.length !== actions.length) {
    throw new Error("Not every step action listened for lamp changes");
  }
  lampsChanged = async () => {
    for (const listener of listeners) {
      await listener();
    }
  };
  deck = new FakeDeck(actions);
});

afterEach(() => {
  vi.useRealTimers();
});

/** Forgets what placing the keys did, so that a test checks only what its own interaction does. */
function clearCalls(): void {
  vi.clearAllMocks();
}

/** The title a key was last given. */
function titleOf(key: Awaited<ReturnType<FakeDeck["key"]>>): string | undefined {
  return at(key.setTitle.mock.calls, -1)[0];
}

//* Tests

describe("a key of a StepKeyAction", () => {
  describe("on a press", () => {
    it.each([
      ["up", FAKE_UP, 1],
      ["down", FAKE_DOWN, -1],
    ])("moves every lamp one step %s, as a dial's tick does", async (_way, uuid, ticks) => {
      const key = await deck.key(uuid, { step: 5 });
      clearCalls();

      await deck.press(key);

      expect(STEPPED.adjust).toHaveBeenCalledExactlyOnceWith("all", ticks, 5, "together");
      expect(key.showAlert).not.toHaveBeenCalled();
      // The keys follow through the notice, which the lamp manager sends.
      expect(key.setTitle).not.toHaveBeenCalled();
    });

    it("moves the lamps by every press gathered, with the step the key has by then", async () => {
      // Gathers the presses until the test flushes them, as the debouncer gathers quick ones.
      let flushPending = async (): Promise<void> => {};
      vi.mocked(createDebouncer).mockImplementation((flush) => {
        let pending = 0;
        flushPending = async () => flush(pending);
        return (presses) => {
          pending += presses;
        };
      });
      const key = await deck.key(FAKE_DOWN, { step: 5 });

      await deck.press(key);
      await deck.press(key);
      await deck.changeSettings(key, { step: 10 });
      await flushPending();

      expect(STEPPED.adjust).toHaveBeenCalledExactlyOnceWith("all", -2, 10, "together");
    });

    it("steps each lamp from its own value when the global settings say so (#145), and logs it", async () => {
      STEPPED.stepping.mockReturnValue("each");
      const key = await deck.key(FAKE_UP);
      clearCalls();

      await deck.press(key);

      expect(STEPPED.adjust).toHaveBeenCalledExactlyOnceWith("all", 1, 2, "each");
      expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("each lamp"));
    });

    it.each([
      ["a lamp fails", FAILED],
      ["no lamp is connected", NO_LAMP],
    ])("shows an alert on the key pressed when %s", async (_when, result) => {
      const pressed = await deck.key(FAKE_UP);
      const other = await deck.key(FAKE_UP);
      STEPPED.adjust.mockResolvedValue(result);

      await deck.press(pressed);

      expect(pressed.showAlert).toHaveBeenCalledOnce();
      expect(other.showAlert).not.toHaveBeenCalled();
    });

    it("logs the presses and the key's step, in its unit, before changing the lamps", async () => {
      const key = await deck.key(FAKE_UP, { step: 15 });

      await deck.press(key);

      expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("1 step of 15 u, on every lamp"));
      expect(at(vi.mocked(logger.info).mock.invocationCallOrder, 0)).toBeLessThan(
        at(STEPPED.adjust.mock.invocationCallOrder, 0),
      );
    });
  });

  describe("shows what its lamps are at as its title", () => {
    it("when placed, read through what it steps", async () => {
      const key = await deck.key(FAKE_UP, { step: 5 });

      expect(STEPPED.read).toHaveBeenCalledWith({ step: 5 }, logger);
      expect(STEPPED.title).toHaveBeenCalledWith("all");
      expect(titleOf(key)).toBe("42 u");
    });

    it("on every key, whichever key or dial changed the lamps", async () => {
      const keys = [await deck.key(FAKE_UP), await deck.key(FAKE_UP), await deck.key(FAKE_DOWN)];
      clearCalls();
      STEPPED.title.mockResolvedValue("50 u");

      await lampsChanged();

      expect(keys.map(titleOf)).toEqual(["50 u", "50 u", "50 u"]);
    });

    it("once a page changes the global settings, which choose its lamps (#147)", async () => {
      const key = await deck.key(FAKE_UP);
      STEPPED.title.mockResolvedValue("50 u");

      changeGlobalSettings({ addNewLamps: false });
      await vi.runAllTimersAsync();

      expect(titleOf(key)).toBe("50 u");
    });
  });

  describe("with lamps picked on the settings page (#20)", () => {
    // A key that adds no new lamps acts on the lamps checked alone (#147).
    beforeEach(() => {
      changeGlobalSettings({ addNewLamps: false });
    });

    it("steps the key's lamps alone, and logs how many", async () => {
      const key = await deck.key(FAKE_UP, { lamps: [LAMP_1, LAMP_2] });
      clearCalls();

      await deck.press(key);

      expect(STEPPED.adjust).toHaveBeenCalledExactlyOnceWith([LAMP_1, LAMP_2], 1, 2, "together");
      expect(logger.info).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("2 lamps"));
    });

    it("shows on each key what its own lamps are at", async () => {
      await deck.key(FAKE_UP);
      await deck.key(FAKE_UP, { lamps: [LAMP_1] });
      await deck.key(FAKE_DOWN, { lamps: [LAMP_2] });
      clearCalls();

      await lampsChanged();

      expect(STEPPED.title.mock.calls).toEqual([["all"], [[LAMP_1]], [[LAMP_2]]]);
    });

    it("shows what the key's new lamps are at once they're changed on the settings page", async () => {
      const key = await deck.key(FAKE_UP);
      clearCalls();

      await deck.changeSettings(key, { lamps: [LAMP_2] });

      expect(STEPPED.title).toHaveBeenCalledExactlyOnceWith([LAMP_2]);
    });
  });
});

describe("BRIGHTNESS, what the Brightness Up and Down keys step", () => {
  it("reads the step, the dials' default of 10% without one, and the key's lamps", () => {
    expect(BRIGHTNESS.read({}, logger)).toEqual({ step: 10, lamps: "all", leftOutLamps: [] });
    expect(BRIGHTNESS.read({ stepPercentage: 5, lamps: [LAMP_1] }, logger)).toMatchObject({
      step: 5,
      lamps: [LAMP_1],
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("takes the default step, with a warning that names it, for one that isn't valid (#22)", () => {
    expect(BRIGHTNESS.read({ stepPercentage: 0 }, logger)).toMatchObject({ step: 10 });
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("stepPercentage"));
  });

  it("steps the brightness, in %, each lamp from its own once the brightness's difference is kept (#145)", () => {
    expect(BRIGHTNESS.adjust).toBe(adjustLampsBrightness);
    expect(BRIGHTNESS.unit).toBe("%");
    expect(BRIGHTNESS.stepping()).toBe("together");

    changeGlobalSettings({ keepTemperatureDifference: true });
    expect(BRIGHTNESS.stepping()).toBe("together");

    changeGlobalSettings({ keepBrightnessDifference: true });
    expect(BRIGHTNESS.stepping()).toBe("each");
  });

  it("shows the brightest of its lamps, as the dials do, or a dash with none", async () => {
    vi.mocked(brightnessShown).mockResolvedValue([63, 79]);
    expect(await BRIGHTNESS.title([LAMP_1, LAMP_2])).toBe("79%");
    expect(brightnessShown).toHaveBeenCalledExactlyOnceWith([LAMP_1, LAMP_2]);

    vi.mocked(brightnessShown).mockResolvedValue([]);
    expect(await BRIGHTNESS.title("all")).toBe("—");
  });
});

describe("TEMPERATURE, what the Temperature Up and Down keys step", () => {
  it("reads the step, the dials' default of 300 K without one, and the key's lamps", () => {
    expect(TEMPERATURE.read({}, logger)).toEqual({ step: 300, lamps: "all", leftOutLamps: [] });
    expect(TEMPERATURE.read({ stepKelvin: "200", lamps: [LAMP_1] }, logger)).toMatchObject({
      step: 200,
      lamps: [LAMP_1],
    });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("takes the default step, with a warning that names it, for one that isn't valid (#22)", () => {
    expect(TEMPERATURE.read({ stepKelvin: 250 }, logger)).toMatchObject({ step: 300 });
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("stepKelvin"));
  });

  it("steps the temperature, in kelvin, each lamp from its own once its difference is kept (#145)", () => {
    expect(TEMPERATURE.adjust).toBe(adjustLampsTemperature);
    expect(TEMPERATURE.unit).toBe(" K");
    expect(TEMPERATURE.stepping()).toBe("together");

    changeGlobalSettings({ keepBrightnessDifference: true });
    expect(TEMPERATURE.stepping()).toBe("together");

    changeGlobalSettings({ keepTemperatureDifference: true });
    expect(TEMPERATURE.stepping()).toBe("each");
  });

  it("shows the highest of its lamps, as the dials do, or a dash with none", async () => {
    vi.mocked(temperatureShown).mockResolvedValue([
      { kelvin: 3400, percentage: 18 },
      { kelvin: 4000, percentage: 34 },
    ]);
    expect(await TEMPERATURE.title([LAMP_1])).toBe("4000 K");
    expect(temperatureShown).toHaveBeenCalledExactlyOnceWith([LAMP_1]);

    vi.mocked(temperatureShown).mockResolvedValue([]);
    expect(await TEMPERATURE.title("all")).toBe("—");
  });
});
