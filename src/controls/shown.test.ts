import { beforeEach, describe, expect, it, vi } from "vitest";
import { Lamp, type LampState } from "../lamps/lamp";
import { lampsSettled, reachEveryLamp } from "../lamps/manager";
import { at } from "../test-support/at";
import { reachedLamp } from "../test-support/reached-lamps";
import { areLampsOn, brightnessShown, findLampsShown, lampsShown, temperatureShown } from "./shown";

//* Fakes

// The real logger writes to a logs/ folder, and a Lamp logs what it reads.
vi.mock("../logging", () => import("../test-support/fake-logging"));

// The lamps the plugin knows, which each test fills, as the global settings hold them. The real global settings load
// the SDK.
const known = vi.hoisted(() => new Map<string, unknown>());
vi.mock("../settings/global-settings", () => ({ globalSettings: { lamps: known } }));

// The real lamp manager loads node-hid's native binary on import and talks to real lamps.
vi.mock("../lamps/manager", () => ({ lampsSettled: vi.fn(), reachEveryLamp: vi.fn() }));

beforeEach(() => {
  known.clear();
  vi.mocked(lampsSettled).mockResolvedValue();
  vi.mocked(reachEveryLamp).mockResolvedValue({ ok: true, lampCount: 0, failures: 0 });
});

/** A Beam at 50% of its range and 4000 K, unless a test says otherwise. */
const HALF: LampState = { on: true, lumen: 215, kelvin: 4000 };

/** A Beam the plugin knows, by its id, as the last operation found it at a state. */
function held(id: string, state: Partial<LampState> = {}): Lamp {
  const lamp = reachedLamp(id, { ...HALF, ...state });
  known.set(id, lamp);
  return lamp;
}

/** A lamp the plugin knows that no operation has reached since it started, so it holds no state. */
function neverReached(id: string): Lamp {
  const lamp = new Lamp({ id, model: "Beam" });
  known.set(id, lamp);
  return lamp;
}

//* Tests

describe("what the Deck shows of the lamps (#198)", () => {
  it("shows the lamps a selection takes in, in the order of their ids", async () => {
    const later = held("00000000000b2222", { lumen: 400 });
    held("00000000000c3333");
    const earlier = held("00000000000a1111", { lumen: 30 });

    expect(await brightnessShown("all")).toEqual([0, 100, 50]);
    expect(await brightnessShown([later.id, earlier.id])).toEqual([0, 100]);
    expect(await brightnessShown({ except: [earlier.id] })).toEqual([100, 50]);
  });

  it("leaves out a lamp the last operation didn't find, and one never reached, which has no state", async () => {
    held("00000000000a1111");
    held("00000000000b2222").setFound(false);
    neverReached("00000000000c3333");

    expect(await brightnessShown("all")).toEqual([50]);
  });

  it.each([
    ["whether the lamps are on", () => areLampsOn("all")],
    ["their brightness", () => brightnessShown("all")],
    ["their temperature", () => temperatureShown("all")],
    ["the lamps the lamp screens show", () => lampsShown()],
  ])("shows %s once the operations queued are done, so not partway", async (_, show) => {
    held("00000000000a1111");
    let settle = (): void => {};
    vi.mocked(lampsSettled).mockReturnValue(new Promise((resolve) => (settle = resolve)));
    let answered = false;

    const shown = show().then(() => (answered = true));
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(answered).toBe(false);

    settle();
    await shown;

    expect(answered).toBe(true);
  });

  describe("whether every lamp is on, as a Power key shows it", () => {
    it("is on when every lamp the selection takes in is on", async () => {
      held("00000000000a1111");
      held("00000000000b2222");

      expect(await areLampsOn("all")).toBe(true);
    });

    it("is off when a lamp is off, even one the selection takes in alone", async () => {
      const on = held("00000000000a1111");
      held("00000000000b2222", { on: false });

      expect(await areLampsOn("all")).toBe(false);
      expect(await areLampsOn([on.id])).toBe(true);
    });

    it("is off when the selection takes in no lamp shown", async () => {
      expect(await areLampsOn("all")).toBe(false);

      held("00000000000a1111");

      expect(await areLampsOn([])).toBe(false);
    });
  });

  describe("the temperature, as a dial or a step key shows it", () => {
    it("is the first lamp's, in kelvin and as its place in the lamp's range", async () => {
      held("00000000000b2222", { kelvin: 5000 });
      held("00000000000a1111", { kelvin: 3500 });

      expect(await temperatureShown("all")).toEqual({ kelvin: 3500, percentage: 21 });
    });

    it("puts the lowest temperature the lamp allows at 0, and the highest at 100", async () => {
      const lamp = held("00000000000a1111", { kelvin: 2700 });

      expect(await temperatureShown("all")).toEqual({ kelvin: 2700, percentage: 0 });

      known.set(lamp.id, reachedLamp(lamp.id, { ...HALF, kelvin: 6500 }));

      expect(await temperatureShown("all")).toEqual({ kelvin: 6500, percentage: 100 });
    });

    it("is none without a lamp", async () => {
      expect(await temperatureShown("all")).toBeUndefined();
    });
  });

  describe("the lamp screens", () => {
    it("are handed each lamp shown as its Lamp, which holds the state it's at", async () => {
      const lamp = held("00000000000a1111", { on: false, lumen: 400, kelvin: 6500 });
      neverReached("00000000000b2222");

      const shown = await lampsShown();

      expect(shown).toHaveLength(1);
      expect(at(shown, 0)).toBe(lamp);
      expect(at(shown, 0).state).toEqual({ on: false, lumen: 400, kelvin: 6500 });
    });

    it("find the lamps for a tap before showing them, so they show the lamps as that leaves them", async () => {
      const lamp = held("00000000000a1111");
      vi.mocked(reachEveryLamp).mockImplementation(async () => {
        lamp.setFound(false);
        return { ok: true, lampCount: 0, failures: 0 };
      });

      expect(await findLampsShown()).toEqual([]);
      expect(reachEveryLamp).toHaveBeenCalledExactlyOnceWith("lamp screen");
    });
  });
});
