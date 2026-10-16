import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { at } from "../test-support/at";
import { loadOnEmulatedLamps } from "../test-support/emulated-lamps";
import { EmulatedLitra } from "../test-support/emulated-litra";
import type { FakeDeck } from "../test-support/fake-deck";

//* Fakes

const POWER = "com.daczarne.litra.power";
const BRIGHTNESS = "com.daczarne.litra.brightness";
const TEMPERATURE = "com.daczarne.litra.temperature";

// A Beam's brightness in lumens at a percentage of its range (30–400 lm), as litra rounds it.
const LUMEN_AT_50 = 215;
const LUMEN_AT_60 = 252;
const LUMEN_AT_80 = 326;
const LUMEN_AT_100 = 400;

let connect: (...lamps: EmulatedLitra[]) => void;
let deck: FakeDeck;
// Every lamp plugged in during the test, whose handles have to be closed by its end.
let lamps: EmulatedLitra[];

beforeEach(async () => {
  vi.useFakeTimers();
  // A fresh plugin for every test, started as Stream Deck starts it, which registers its actions with the fake SDK
  // that the fake Deck sends events through.
  ({
    loaded: deck,
    hid: { connect },
  } = await loadOnEmulatedLamps(
    async () => {
      const { FakeDeck } = await import("../test-support/fake-deck");
      await import("../plugin");
      return new FakeDeck();
    },
    { streamDeck: true },
  ));
  lamps = [];
});

afterEach(() => {
  expect(lamps.map((lamp) => lamp.openHandles)).toEqual(lamps.map(() => 0));
  vi.useRealTimers();
});

/** Plugs in these lamps, in the order litra finds them, in place of the ones before. */
function plugIn(...plugged: EmulatedLitra[]): void {
  lamps.push(...plugged.filter((lamp) => !lamps.includes(lamp)));
  connect(...plugged);
}

/** A Beam, on unless said otherwise, at 50% and 4000 K unless said otherwise. */
function beam(options: ConstructorParameters<typeof EmulatedLitra>[1] = {}): EmulatedLitra {
  return new EmulatedLitra("Beam", { on: true, brightnessInLumen: LUMEN_AT_50, temperatureInKelvin: 4000, ...options });
}

/** The state a key was last set to: on (1) or off (0). */
function stateOf(key: Awaited<ReturnType<FakeDeck["key"]>>): number {
  return at(key.setState.mock.calls, -1)[0];
}

/** What a dial was last told to show. */
function feedbackOf(dial: Awaited<ReturnType<FakeDeck["dial"]>>): object {
  return at(dial.setFeedback.mock.calls, -1)[0];
}

//* Tests

describe("the Power key", () => {
  it("turns every lamp off or on in its off and on modes, and every Power key follows (#57)", async () => {
    const pair = [beam(), beam()];
    plugIn(...pair);
    const offKey = await deck.key(POWER, { mode: "off" });
    const onKey = await deck.key(POWER, { mode: "on" });

    await deck.press(offKey);

    expect(pair.map((lamp) => lamp.on)).toEqual([false, false]);
    expect([stateOf(offKey), stateOf(onKey)]).toEqual([0, 0]);

    await deck.press(onKey);

    expect(pair.map((lamp) => lamp.on)).toEqual([true, true]);
    expect([stateOf(offKey), stateOf(onKey)]).toEqual([1, 1]);
  });

  it("follows a Brightness key, which turns the lamps on (#57)", async () => {
    const pair = [beam({ on: false }), beam({ on: false })];
    plugIn(...pair);
    const powerKey = await deck.key(POWER, { mode: "toggle" });
    const brightnessKey = await deck.key(BRIGHTNESS, { presetPercentage: 50 });

    await deck.press(brightnessKey);

    expect(pair.map((lamp) => lamp.on)).toEqual([true, true]);
    expect(stateOf(powerKey)).toBe(1);
  });

  it("follows a Brightness dial pushed to toggle the lamps (#57)", async () => {
    const pair = [beam(), beam()];
    plugIn(...pair);
    const powerKey = await deck.key(POWER, { mode: "toggle" });
    const dial = await deck.dial(BRIGHTNESS, { stepPercentage: 10 });

    await deck.push(dial);

    expect(pair.map((lamp) => lamp.on)).toEqual([false, false]);
    expect(stateOf(powerKey)).toBe(0);
  });
});

describe("the Brightness action", () => {
  it("shows the brightest lamp when lamps stop at their caps, with the bar fainter where only one reaches (#13, #59)", async () => {
    // Two Beams on a Stream Deck + XL's USB hub, which stop at 63% and 79%.
    plugIn(beam({ capInLumen: 264 }), beam({ capInLumen: 324 }));
    const key = await deck.key(BRIGHTNESS, { presetPercentage: 100 });
    const dial = await deck.dial(BRIGHTNESS);

    await deck.press(key);

    expect(lamps.map((lamp) => lamp.brightnessInLumen)).toEqual([264, 324]);
    expect(feedbackOf(dial)).toEqual({
      title: "Brightness",
      value: "79%",
      indicator: { value: 79, bar_fill_c: "0:#ffffff,0.797:#ffffff,0.798:#c0c0c0,1:#c0c0c0" },
    });
  });

  it("keeps the lamps where a dial turned down right after a press past their caps leaves them (#55)", async () => {
    // Two Beams on a Stream Deck + XL's USB hub, which stop at 63% and 79%, and can go back to their caps for about a
    // second after being asked for more.
    const pair = [beam({ capInLumen: 264 }), beam({ capInLumen: 324 })];
    plugIn(...pair);
    const key = await deck.key(BRIGHTNESS, { presetPercentage: 100 });
    const dial = await deck.dial(BRIGHTNESS, { stepPercentage: 10 });

    await deck.quickly(() => {
      void deck.press(key);
      void deck.turn(dial, -3);
    });

    // Three steps of 10% down from 79%.
    expect(pair.map((lamp) => lamp.brightnessInLumen)).toEqual([LUMEN_AT_50, LUMEN_AT_50]);
    expect(feedbackOf(dial)).toMatchObject({ value: "50%" });
  });

  it("lets the lamps reach 100% once moved from a hub to the computer, without a restart (#55)", async () => {
    const onAHub = [beam({ capInLumen: 264 }), beam({ capInLumen: 324 })];
    plugIn(...onAHub);
    const key = await deck.key(BRIGHTNESS, { presetPercentage: 100 });
    const dial = await deck.dial(BRIGHTNESS);
    await deck.press(key);

    const onTheComputer = onAHub.map((lamp) => beam({ serialNumber: lamp.serialNumber }));
    plugIn(...onTheComputer);
    await deck.press(key);

    expect(onTheComputer.map((lamp) => lamp.brightnessInLumen)).toEqual([LUMEN_AT_100, LUMEN_AT_100]);
    expect(feedbackOf(dial)).toMatchObject({ value: "100%" });
  });

  it("moves the lamps once for a quick turn, with the step the dial has by then", async () => {
    const pair = [beam(), beam()];
    plugIn(...pair);
    const dial = await deck.dial(BRIGHTNESS, { stepPercentage: 5 });

    await deck.quickly(() => {
      void deck.turn(dial, 1);
      void deck.turn(dial, 1);
      void deck.changeSettings(dial, { stepPercentage: 10 });
      void deck.turn(dial, 1);
    });

    // Three ticks of 10% from 50%.
    expect(pair.map((lamp) => lamp.writes("brightness"))).toEqual([[LUMEN_AT_80], [LUMEN_AT_80]]);
    expect(feedbackOf(dial)).toMatchObject({ value: "80%" });
  });

  it("turns the lamps on before a dial changes their brightness", async () => {
    const pair = [beam({ on: false }), beam({ on: false })];
    plugIn(...pair);
    const powerKey = await deck.key(POWER, { mode: "toggle" });
    const dial = await deck.dial(BRIGHTNESS, { stepPercentage: 10 });

    await deck.turn(dial, 1);

    expect(pair.map((lamp) => lamp.writes("power"))).toEqual([[1], [1]]);
    expect(pair.map((lamp) => lamp.brightnessInLumen)).toEqual([LUMEN_AT_60, LUMEN_AT_60]);
    expect(stateOf(powerKey)).toBe(1);
  });

  it("shows an alert when a lamp fails, and still sets the others, which the dial shows", async () => {
    const [failing, working] = [beam({ brightnessInLumen: 30 }), beam({ brightnessInLumen: 30 })];
    plugIn(failing, working);
    const key = await deck.key(BRIGHTNESS, { presetPercentage: 50 });
    const dial = await deck.dial(BRIGHTNESS);
    failing.fail("everything");

    await deck.press(key);

    expect(key.showAlert).toHaveBeenCalledOnce();
    expect(working.brightnessInLumen).toBe(LUMEN_AT_50);
    expect(feedbackOf(dial)).toMatchObject({ value: "50%" });
  });
});

describe("the Temperature action", () => {
  it("sets every lamp to a key's preset, snapped to a temperature they allow, and shows it on the dials", async () => {
    const pair = [beam(), beam()];
    plugIn(...pair);
    const key = await deck.key(TEMPERATURE, { presetKelvin: 4230 });
    const dial = await deck.dial(TEMPERATURE);

    await deck.press(key);

    expect(pair.map((lamp) => lamp.temperatureInKelvin)).toEqual([4200, 4200]);
    expect(feedbackOf(dial)).toEqual({ title: "Temperature", value: "4200", indicator: 39 });
  });

  it("moves every lamp by a dial's step from the first lamp's temperature", async () => {
    const pair = [beam({ temperatureInKelvin: 3000 }), beam({ temperatureInKelvin: 5000 })];
    plugIn(...pair);
    const dial = await deck.dial(TEMPERATURE, { stepKelvin: 300 });

    await deck.turn(dial, 1);

    expect(pair.map((lamp) => lamp.temperatureInKelvin)).toEqual([3300, 3300]);
    expect(feedbackOf(dial)).toMatchObject({ value: "3300" });
  });
});

describe("the lamp screens", () => {
  /** Two Beams, plugged in out of the order of their serial numbers, and a Brightness dial showing the first. */
  async function onFirstLampScreen() {
    const second = beam({ serialNumber: "SERIAL-B" });
    const first = beam({
      serialNumber: "SERIAL-A",
      on: false,
      brightnessInLumen: LUMEN_AT_100,
      temperatureInKelvin: 6500,
    });
    plugIn(second, first);
    const dial = await deck.dial(BRIGHTNESS, { stepPercentage: 10 });
    await deck.tap(dial);
    return { first, second, dial };
  }

  it("show each lamp as it reports itself, in the order of their serial numbers (#48)", async () => {
    const { dial } = await onFirstLampScreen();

    expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith("layouts/lamp.json");
    expect(feedbackOf(dial)).toEqual({
      lamp: "Beam · 1 of 2",
      power: "Off",
      brightness: "100%",
      lumens: "400 lm",
      temperature: "6500 K",
    });
  });

  it("follow what another action changes", async () => {
    const { dial } = await onFirstLampScreen();
    const key = await deck.key(TEMPERATURE, { presetKelvin: 5000 });

    await deck.press(key);

    expect(feedbackOf(dial)).toMatchObject({ lamp: "Beam · 1 of 2", temperature: "5000 K" });
  });

  it.each([
    ["Brightness", BRIGHTNESS],
    ["Temperature", TEMPERATURE],
  ])("forget a %s dial taken off the Deck, which the lamps changing no longer redraws", async (_name, manifestId) => {
    plugIn(beam({ serialNumber: "SERIAL-A" }), beam({ serialNumber: "SERIAL-B" }));
    const dial = await deck.dial(manifestId);
    const powerKey = await deck.key(POWER, { mode: "toggle" });
    await deck.tap(dial);
    await deck.remove(dial);
    dial.setFeedback.mockClear();

    await deck.press(powerKey);

    expect(dial.setFeedback).not.toHaveBeenCalled();
  });
});

describe("what the dials show", () => {
  const PLUGIN = "com.daczarne.litra.sdPlugin";
  const MANIFEST = JSON.parse(fs.readFileSync(path.join(PLUGIN, "manifest.json"), "utf8")) as {
    Actions: { UUID: string; Encoder?: { layout: string } }[];
  };

  // The slots of Stream Deck's built-in layouts the dials use, as docs/elgato_sdk/layouts.md lists them.
  const BUILT_IN_SLOTS: Record<string, string[]> = { $B1: ["title", "icon", "value", "indicator"] };

  /** The keys a dial can fill on a layout: a built-in one's slots, or the items of a layout file in the plugin folder. */
  function slotsOf(layout: string): string[] {
    const builtIn = BUILT_IN_SLOTS[layout];
    if (builtIn !== undefined) {
      return builtIn;
    }
    const file = path.join(PLUGIN, layout);
    expect(fs.existsSync(file), `layout ${layout} isn't in the plugin folder`).toBe(true);
    const { items } = JSON.parse(fs.readFileSync(file, "utf8")) as { items: { key: string }[] };
    return items.map((item) => item.key);
  }

  /**
   * Everything a dial was told to show, with the layout it was on at the time: the one its action has in the
   * manifest, until the plugin set another.
   */
  function shownWithLayouts(dial: Awaited<ReturnType<FakeDeck["dial"]>>, manifestId: string) {
    const manifestLayout = MANIFEST.Actions.find((entry) => entry.UUID === manifestId)?.Encoder?.layout;
    expect(manifestLayout, `${manifestId} has no dial layout in the manifest`).toBeDefined();
    const layouts = dial.setFeedbackLayout.mock.calls.map(([layout], index) => ({
      layout,
      order: at(dial.setFeedbackLayout.mock.invocationCallOrder, index),
    }));
    return dial.setFeedback.mock.calls.map(([feedback], index) => {
      const order = at(dial.setFeedback.mock.invocationCallOrder, index);
      const layout = layouts.filter((set) => set.order < order).at(-1)?.layout ?? manifestLayout ?? "";
      return { layout, keys: Object.keys(feedback) };
    });
  }

  it.each([
    ["Brightness", BRIGHTNESS, { presetPercentage: 50 }],
    ["Temperature", TEMPERATURE, { presetKelvin: 5000 }],
  ])("fits the layout the %s dial is on, on every screen it shows", async (_name, manifestId, keySettings) => {
    plugIn(beam({ serialNumber: "SERIAL-A" }), beam({ serialNumber: "SERIAL-B" }));
    const dial = await deck.dial(manifestId);
    const key = await deck.key(manifestId, keySettings);

    // The main screen, redrawn by a turn, a key and a push.
    await deck.turn(dial, 1);
    await deck.press(key);
    await deck.push(dial);
    // A lamp screen, redrawn when the lamps change, then the next one, and back to the main screen past the last.
    await deck.tap(dial);
    await deck.press(key);
    await deck.tap(dial);
    await deck.tap(dial);
    // A lamp screen left with a hold.
    await deck.tap(dial);
    await deck.hold(dial);

    const shown = shownWithLayouts(dial, manifestId);
    expect(new Set(shown.map(({ layout }) => layout))).toEqual(new Set(["$B1", "layouts/lamp.json"]));
    for (const { layout, keys } of shown) {
      expect(slotsOf(layout)).toEqual(expect.arrayContaining(keys));
    }
  });
});
