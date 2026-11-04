import fs from "node:fs";
import path from "node:path";
import type { JsonObject } from "@elgato/utils";
import { afterEach, beforeEach, describe, expect, inject, it, vi } from "vitest";

import { LAMP_SCREEN_CELLS } from "../actions/settings";
import { lampId } from "../lamp-identity";
import { at } from "../test-support/at";
import { loadOnEmulatedLamps } from "../test-support/emulated-lamps";
import { EmulatedLitra } from "../test-support/emulated-litra";
import type { FakeDeck } from "../test-support/fake-deck";

//* Fakes

const POWER = "com.daczarne.litra.power";
const BRIGHTNESS = "com.daczarne.litra.brightness";
const TEMPERATURE = "com.daczarne.litra.temperature";
const SCENE = "com.daczarne.litra.scene";
const BRIGHTNESS_UP = "com.daczarne.litra.brightness-up";
const BRIGHTNESS_DOWN = "com.daczarne.litra.brightness-down";
const TEMPERATURE_UP = "com.daczarne.litra.temperature-up";
const TEMPERATURE_DOWN = "com.daczarne.litra.temperature-down";

// The model of the lamps, a Beam or a Beam LX, by run (`vitest.config.mjs`).
const MODEL = inject("model");

// A lamp's brightness in lumens at a percentage of its range (30–400 lm, a Beam's and a Beam LX's), as litra rounds it.
const LUMEN_AT_0 = 30;
const LUMEN_AT_10 = 67;
const LUMEN_AT_50 = 215;
const LUMEN_AT_60 = 252;
const LUMEN_AT_80 = 326;
const LUMEN_AT_90 = 363;
const LUMEN_AT_100 = 400;

let connect: (...lamps: EmulatedLitra[]) => void;
let failFindingLamps: (error: Error) => void;
let deck: FakeDeck;
// The fake SDK plugin.ts registered with, which carries the messages of the settings pages.
let sdk: typeof import("../test-support/fake-stream-deck");
// Every lamp plugged in during the test, whose handles have to be closed by its end.
let lamps: EmulatedLitra[];

beforeEach(async () => {
  vi.useFakeTimers();
  // A fresh plugin for every test, started as Stream Deck starts it, which registers its actions with the fake SDK
  // that the fake Deck sends events through.
  ({
    loaded: { deck, sdk },
    hid: { connect, failFindingLamps },
  } = await loadOnEmulatedLamps(
    async () => {
      const { FakeDeck } = await import("../test-support/fake-deck");
      await import("../plugin");
      return {
        deck: new FakeDeck(),
        sdk: await import("../test-support/fake-stream-deck"),
      };
    },
    { streamDeck: true },
  ));
  lamps = [];
});

afterEach(() => {
  expect(lamps.map((lamp) => lamp.openHandles)).toEqual(lamps.map(() => 0));
  vi.useRealTimers();
});

/**
 * Plugs in these lamps, in the order litra finds them, in place of the ones before, and presses Find lamps, which adds
 * the new ones to the lamps the plugin knows (#194). The plugin takes them before the find's answer reaches the page.
 */
function plugIn(...plugged: EmulatedLitra[]): void {
  lamps.push(...plugged.filter((lamp) => !lamps.includes(lamp)));
  connect(...plugged);
  sdk.sendToPlugin({ event: "lamps" });
}

/**
 * Saves global settings from a settings page, which keeps the ones it doesn't show, such as the lamps the plugin knows
 * (#194).
 */
async function saveFromPage(changes: JsonObject): Promise<void> {
  sdk.changeGlobalSettings({ ...(await sdk.default.settings.getGlobalSettings()), ...changes });
}

/**
 * A lamp of the run's model, on unless said otherwise, at 50% and 4000 K unless said otherwise. The caps the tests give
 * it are the ones Beams were measured with on a hub: a Beam LX takes its power from a supply of its own, but the plugin
 * checks what every lamp reached the same way (#100).
 */
function newLamp(options: ConstructorParameters<typeof EmulatedLitra>[1] = {}): EmulatedLitra {
  return new EmulatedLitra(MODEL, { on: true, brightnessInLumen: LUMEN_AT_50, temperatureInKelvin: 4000, ...options });
}

/** The state a key was last set to: on (1) or off (0). */
function stateOf(key: Awaited<ReturnType<FakeDeck["key"]>>): number {
  return at(key.setState.mock.calls, -1)[0];
}

/** The title a key was last given. */
function titleOf(key: Awaited<ReturnType<FakeDeck["key"]>>): string | undefined {
  return at(key.setTitle.mock.calls, -1)[0];
}

/** What a dial was last told to show. */
function feedbackOf(dial: Awaited<ReturnType<FakeDeck["dial"]>>): object {
  return at(dial.setFeedback.mock.calls, -1)[0];
}

/** The text of each slot a dial was last told to show, whatever look a lamp screen gave it. */
function textOf(dial: Awaited<ReturnType<FakeDeck["dial"]>>): Record<string, unknown> {
  const shown = Object.entries(feedbackOf(dial)).map(([slot, value]: [string, unknown]) => [
    slot,
    typeof value === "object" && value !== null && "value" in value ? value.value : value,
  ]);
  return Object.fromEntries(shown);
}

/**
 * What each cell of a dial's lamp screen was last told to show (#177): the text of whichever of its text slots is
 * shown, beside its icon or without one, or nothing for a cell that shows none.
 */
function cellsOf(dial: Awaited<ReturnType<FakeDeck["dial"]>>): Record<string, string> {
  const slots = feedbackOf(dial) as Record<string, { value?: string; enabled?: boolean }>;
  const shownIn = (slot: string) => (slots[slot]?.enabled === true ? slots[slot].value : undefined);
  return Object.fromEntries(
    LAMP_SCREEN_CELLS.map((cell) => [cell, shownIn(`${cell}BesideIcon`) ?? shownIn(cell) ?? ""]),
  );
}

//* Tests

describe("the Power key", () => {
  it("turns every lamp off or on in its off and on modes, and every Power key follows (#57)", async () => {
    const pair = [newLamp(), newLamp()];
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

  it("shows an alert when no lamp answers, after the off state it switches to, so the state doesn't cover it (#132)", async () => {
    const pair = [newLamp(), newLamp()];
    plugIn(...pair);
    const key = await deck.key(POWER, { mode: "toggle" });
    expect(stateOf(key)).toBe(1);
    // Unplugged while on: nothing tells the plugin until the next press.
    plugIn();

    await deck.press(key);

    expect(stateOf(key)).toBe(0);
    expect(key.showAlert).toHaveBeenCalledOnce();
    expect(at(key.showAlert.mock.invocationCallOrder, 0)).toBeGreaterThan(
      at(key.setState.mock.invocationCallOrder, -1),
    );
  });

  it("follows a Brightness key, which turns the lamps on (#57)", async () => {
    const pair = [newLamp({ on: false }), newLamp({ on: false })];
    plugIn(...pair);
    const powerKey = await deck.key(POWER, { mode: "toggle" });
    const brightnessKey = await deck.key(BRIGHTNESS, { presetPercentage: 50 });

    await deck.press(brightnessKey);

    expect(pair.map((lamp) => lamp.on)).toEqual([true, true]);
    expect(stateOf(powerKey)).toBe(1);
  });

  it("follows a Brightness dial pushed to toggle the lamps (#57)", async () => {
    const pair = [newLamp(), newLamp()];
    plugIn(...pair);
    const powerKey = await deck.key(POWER, { mode: "toggle" });
    const dial = await deck.dial(BRIGHTNESS, { stepPercentage: 10 });

    await deck.push(dial);

    expect(pair.map((lamp) => lamp.on)).toEqual([false, false]);
    expect(stateOf(powerKey)).toBe(0);
  });

  it("toggles the lamps on when one can't be read, which counts as off, and shows an alert", async () => {
    const [failing, working] = [newLamp(), newLamp()];
    plugIn(failing, working);
    const key = await deck.key(POWER, { mode: "toggle" });
    failing.fail("everything");

    await deck.press(key);

    expect(working.on).toBe(true);
    expect(stateOf(key)).toBe(0);
    expect(key.showAlert).toHaveBeenCalledOnce();
  });

  it("turns on a lamp that can't be read, unchecked, without an alert, and shows it off, since it can't read it", async () => {
    const lamp = newLamp({ on: false });
    plugIn(lamp);
    const key = await deck.key(POWER, { mode: "on" });
    lamp.fail("readSync");

    await deck.press(key);

    expect(lamp.on).toBe(true);
    expect(stateOf(key)).toBe(0);
    expect(key.showAlert).not.toHaveBeenCalled();
  });
});

describe("the Brightness action", () => {
  it("shows the brightest lamp when lamps stop at their caps, with the bar fainter where only one reaches (#13, #59)", async () => {
    // Two lamps on a Stream Deck + XL's USB hub, which stop at 63% and 79%.
    plugIn(newLamp({ capInLumen: 264 }), newLamp({ capInLumen: 324 }));
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
    // Two lamps on a Stream Deck + XL's USB hub, which stop at 63% and 79%, and can go back to their caps for about a
    // second after being asked for more.
    const pair = [newLamp({ capInLumen: 264 }), newLamp({ capInLumen: 324 })];
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
    const onAHub = [newLamp({ capInLumen: 264 }), newLamp({ capInLumen: 324 })];
    plugIn(...onAHub);
    const key = await deck.key(BRIGHTNESS, { presetPercentage: 100 });
    const dial = await deck.dial(BRIGHTNESS);
    await deck.press(key);

    const onTheComputer = onAHub.map((lamp) => newLamp({ serialNumber: lamp.serialNumber }));
    plugIn(...onTheComputer);
    await deck.press(key);

    expect(onTheComputer.map((lamp) => lamp.brightnessInLumen)).toEqual([LUMEN_AT_100, LUMEN_AT_100]);
    expect(feedbackOf(dial)).toMatchObject({ value: "100%" });
  });

  it("moves the lamps once for a quick turn, with the step the dial has by then", async () => {
    const pair = [newLamp(), newLamp()];
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
    const pair = [newLamp({ on: false }), newLamp({ on: false })];
    plugIn(...pair);
    const powerKey = await deck.key(POWER, { mode: "toggle" });
    const dial = await deck.dial(BRIGHTNESS, { stepPercentage: 10 });

    await deck.turn(dial, 1);

    expect(pair.map((lamp) => lamp.writes("power"))).toEqual([[1], [1]]);
    expect(pair.map((lamp) => lamp.brightnessInLumen)).toEqual([LUMEN_AT_60, LUMEN_AT_60]);
    expect(stateOf(powerKey)).toBe(1);
  });

  it("shows an alert when a lamp fails, and still sets the others, which the dial shows", async () => {
    const [failing, working] = [newLamp({ brightnessInLumen: 30 }), newLamp({ brightnessInLumen: 30 })];
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
    const pair = [newLamp(), newLamp()];
    plugIn(...pair);
    const key = await deck.key(TEMPERATURE, { presetKelvin: 4230 });
    const dial = await deck.dial(TEMPERATURE);

    await deck.press(key);

    expect(pair.map((lamp) => lamp.temperatureInKelvin)).toEqual([4200, 4200]);
    expect(feedbackOf(dial)).toEqual({ title: "Temperature", value: "4200", indicator: 39 });
  });

  it("moves every lamp by a dial's step from the first lamp's temperature", async () => {
    const pair = [newLamp({ temperatureInKelvin: 3000 }), newLamp({ temperatureInKelvin: 5000 })];
    plugIn(...pair);
    const dial = await deck.dial(TEMPERATURE, { stepKelvin: 300 });

    await deck.turn(dial, 1);

    expect(pair.map((lamp) => lamp.temperatureInKelvin)).toEqual([3300, 3300]);
    expect(feedbackOf(dial)).toMatchObject({ value: "3300" });
  });

  it("moves the lamps once for a quick turn, with the step the dial has by then", async () => {
    const pair = [newLamp({ temperatureInKelvin: 3100 }), newLamp({ temperatureInKelvin: 3100 })];
    plugIn(...pair);
    const dial = await deck.dial(TEMPERATURE, { stepKelvin: 100 });

    await deck.quickly(() => {
      void deck.turn(dial, 1);
      void deck.turn(dial, 1);
      void deck.changeSettings(dial, { stepKelvin: 200 });
      void deck.turn(dial, 1);
    });

    // Three ticks of 200 K from 3100 K.
    expect(pair.map((lamp) => lamp.writes("temperature"))).toEqual([[3700], [3700]]);
    expect(feedbackOf(dial)).toMatchObject({ value: "3700" });
  });
});

describe("the Scene key", () => {
  it("turns every lamp on at its brightness and temperature, and every dial and Power key follows (#86)", async () => {
    const pair = [newLamp({ on: false }), newLamp({ on: false })];
    plugIn(...pair);
    const powerKey = await deck.key(POWER, { mode: "toggle" });
    const brightnessDial = await deck.dial(BRIGHTNESS);
    const temperatureDial = await deck.dial(TEMPERATURE);
    const key = await deck.key(SCENE, { presetPercentage: 100, presetKelvin: 6500 });

    await deck.press(key);

    expect(pair.map((lamp) => [lamp.on, lamp.brightnessInLumen, lamp.temperatureInKelvin])).toEqual([
      [true, LUMEN_AT_100, 6500],
      [true, LUMEN_AT_100, 6500],
    ]);
    expect(stateOf(powerKey)).toBe(1);
    expect(feedbackOf(brightnessDial)).toMatchObject({ value: "100%" });
    expect(feedbackOf(temperatureDial)).toMatchObject({ value: "6500" });
  });

  it("sets each group's lamps to the group's part, and every Power key follows the whole scene (#174)", async () => {
    const [left, center, right] = [newLamp({ on: false }), newLamp(), newLamp({ on: false })];
    plugIn(left, center, right);
    const powerKey = await deck.key(POWER, { mode: "toggle" });
    const key = await deck.key(SCENE, {
      presetPercentage: 100,
      presetKelvin: 6500,
      addedGroups: [
        {
          power: "off",
          lamps: [lampId(center.serialNumber)],
        },
      ],
    });

    await deck.press(key);

    expect([left, center, right].map((lamp) => [lamp.on, lamp.brightnessInLumen, lamp.temperatureInKelvin])).toEqual([
      [true, LUMEN_AT_100, 6500],
      [false, LUMEN_AT_50, 4000],
      [true, LUMEN_AT_100, 6500],
    ]);
    expect(stateOf(powerKey)).toBe(0);
  });

  it("takes a lamp added later into its first group, and leaves the lamps a group added after it checks to that group (#147, #174)", async () => {
    const [first, second, added] = [newLamp({ on: false }), newLamp({ on: false }), newLamp({ on: false })];
    plugIn(first, second);
    const key = await deck.key(SCENE, {
      presetPercentage: 100,
      presetKelvin: 6500,
      lamps: [lampId(first.serialNumber)],
      leftOutLamps: [],
      addedGroups: [{ power: "on", presetPercentage: 10, presetKelvin: 2700, lamps: [lampId(second.serialNumber)] }],
    });
    plugIn(first, second, added);

    await deck.press(key);

    expect([first, second, added].map((lamp) => [lamp.on, lamp.brightnessInLumen, lamp.temperatureInKelvin])).toEqual([
      [true, LUMEN_AT_100, 6500],
      [true, LUMEN_AT_10, 2700],
      [true, LUMEN_AT_100, 6500],
    ]);
  });

  it("gives a lamp both groups check to the group added after the first, on a key that takes in no lamps added later (#174)", async () => {
    await saveFromPage({ addNewLamps: false });
    const [first, second, added] = [newLamp({ on: false }), newLamp({ on: false }), newLamp({ on: false })];
    plugIn(first, second);
    const key = await deck.key(SCENE, {
      presetPercentage: 100,
      presetKelvin: 6500,
      lamps: [lampId(first.serialNumber), lampId(second.serialNumber)],
      addedGroups: [{ power: "on", presetPercentage: 10, presetKelvin: 2700, lamps: [lampId(second.serialNumber)] }],
    });
    plugIn(first, second, added);

    await deck.press(key);

    expect([first, second, added].map((lamp) => [lamp.on, lamp.brightnessInLumen, lamp.temperatureInKelvin])).toEqual([
      [true, LUMEN_AT_100, 6500],
      [true, LUMEN_AT_10, 2700],
      [false, LUMEN_AT_50, 4000],
    ]);
  });
});

describe("the step keys", () => {
  it("step every lamp's brightness up and down by their step, and every step key shows the brightest lamp (#129)", async () => {
    const pair = [newLamp(), newLamp()];
    plugIn(...pair);
    const up = await deck.key(BRIGHTNESS_UP, { stepPercentage: 10 });
    const down = await deck.key(BRIGHTNESS_DOWN, { stepPercentage: 10 });

    expect([titleOf(up), titleOf(down)]).toEqual(["50%", "50%"]);

    await deck.press(up);

    expect(pair.map((lamp) => lamp.brightnessInLumen)).toEqual([LUMEN_AT_60, LUMEN_AT_60]);
    expect([titleOf(up), titleOf(down)]).toEqual(["60%", "60%"]);

    await deck.press(down);

    expect(pair.map((lamp) => lamp.brightnessInLumen)).toEqual([LUMEN_AT_50, LUMEN_AT_50]);
    expect([titleOf(up), titleOf(down)]).toEqual(["50%", "50%"]);
  });

  it("move the lamps once for quick presses, with the step the key has by then", async () => {
    const pair = [newLamp(), newLamp()];
    plugIn(...pair);
    const key = await deck.key(BRIGHTNESS_UP, { stepPercentage: 5 });

    await deck.quickly(() => {
      void deck.press(key);
      void deck.press(key);
      void deck.changeSettings(key, { stepPercentage: 10 });
      void deck.press(key);
    });

    // Three steps of 10% from 50%.
    expect(pair.map((lamp) => lamp.writes("brightness"))).toEqual([[LUMEN_AT_80], [LUMEN_AT_80]]);
    expect(titleOf(key)).toBe("80%");
  });

  it("stop at the lamps' caps, as a dial does, and show the brightest lamp", async () => {
    // Two lamps on a Stream Deck + XL's USB hub, which stop at 63% and 79%.
    const pair = [
      newLamp({ brightnessInLumen: LUMEN_AT_60, capInLumen: 264 }),
      newLamp({ brightnessInLumen: LUMEN_AT_60, capInLumen: 324 }),
    ];
    plugIn(...pair);
    // 80%, a step of 20% up from 60%, is past both caps.
    const key = await deck.key(BRIGHTNESS_UP, { stepPercentage: 20 });

    await deck.press(key);

    expect(pair.map((lamp) => lamp.brightnessInLumen)).toEqual([264, 324]);
    expect(titleOf(key)).toBe("79%");
  });

  it("step every lamp's temperature up and down from the first lamp's, and every step key shows it (#129)", async () => {
    const pair = [newLamp({ temperatureInKelvin: 3000 }), newLamp({ temperatureInKelvin: 5000 })];
    plugIn(...pair);
    const up = await deck.key(TEMPERATURE_UP, { stepKelvin: 300 });
    const down = await deck.key(TEMPERATURE_DOWN, { stepKelvin: 300 });

    expect([titleOf(up), titleOf(down)]).toEqual(["3000", "3000"]);

    await deck.press(up);

    expect(pair.map((lamp) => lamp.temperatureInKelvin)).toEqual([3300, 3300]);
    expect([titleOf(up), titleOf(down)]).toEqual(["3300", "3300"]);

    await deck.press(down);

    expect(pair.map((lamp) => lamp.temperatureInKelvin)).toEqual([3000, 3000]);
    expect([titleOf(up), titleOf(down)]).toEqual(["3000", "3000"]);
  });

  it("follow what another action changes", async () => {
    plugIn(newLamp(), newLamp());
    const brightnessKey = await deck.key(BRIGHTNESS_DOWN, { stepPercentage: 10 });
    const temperatureKey = await deck.key(TEMPERATURE_UP, { stepKelvin: 300 });
    const scene = await deck.key(SCENE, { presetPercentage: 80, presetKelvin: 6500 });

    await deck.press(scene);

    expect([titleOf(brightnessKey), titleOf(temperatureKey)]).toEqual(["80%", "6500"]);
  });

  it("show an alert when a lamp fails, and still step the others", async () => {
    const [failing, working] = [newLamp(), newLamp()];
    plugIn(failing, working);
    const key = await deck.key(BRIGHTNESS_UP, { stepPercentage: 10 });
    failing.fail("everything");

    await deck.press(key);

    expect(key.showAlert).toHaveBeenCalledOnce();
    expect(working.brightnessInLumen).toBe(LUMEN_AT_60);
    expect(titleOf(key)).toBe("60%");
  });
});

describe("the lamp screens", () => {
  /** Two lamps, plugged in out of the order of their serial numbers, and a Brightness dial showing the first. */
  async function onFirstLampScreen() {
    const second = newLamp({ serialNumber: "SERIAL-B" });
    const first = newLamp({
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
    // The first lamp is off, which its power shows in dark grey.
    expect(feedbackOf(dial)).toMatchObject({ middleRight: { value: "OFF", color: "#202020", font: { weight: 400 } } });
    expect(cellsOf(dial)).toEqual({
      topLeft: `${MODEL} - AL-A`,
      topRight: "1 of 2",
      middleLeft: "6500 K",
      middleRight: "OFF",
      bottomLeft: "100%",
      bottomRight: "400 lm",
    });
  });

  it("follow what another action changes", async () => {
    const { dial } = await onFirstLampScreen();
    const key = await deck.key(TEMPERATURE, { presetKelvin: 5000 });

    await deck.press(key);

    expect(cellsOf(dial)).toMatchObject({ topLeft: `${MODEL} - AL-A`, topRight: "1 of 2", middleLeft: "5000 K" });
  });

  it("let each dial turn and toggle its lamp alone, until a turn on a main screen brings them back in sync (#20)", async () => {
    const { first, second, dial } = await onFirstLampScreen();
    const temperatureDial = await deck.dial(TEMPERATURE, { stepKelvin: 100 });
    await deck.tap(temperatureDial);
    await deck.tap(temperatureDial);

    await deck.turn(dial, -2);
    await deck.turn(temperatureDial, 1);

    // A brightness change turns its lamp on, as on the main screen.
    expect([first.on, first.brightnessInLumen, first.temperatureInKelvin]).toEqual([true, LUMEN_AT_80, 6500]);
    expect([second.on, second.brightnessInLumen, second.temperatureInKelvin]).toEqual([true, LUMEN_AT_50, 4100]);
    expect(cellsOf(dial)).toMatchObject({
      topLeft: `${MODEL} - AL-A`,
      topRight: "1 of 2",
      bottomLeft: "80%",
      middleLeft: "6500 K",
    });
    expect(cellsOf(temperatureDial)).toMatchObject({
      topLeft: `${MODEL} - AL-B`,
      topRight: "2 of 2",
      bottomLeft: "50%",
      middleLeft: "4100 K",
    });

    await deck.push(dial);

    expect([first.on, second.on]).toEqual([false, true]);
    expect(cellsOf(dial)).toMatchObject({ middleRight: "OFF" });

    const mainDial = await deck.dial(BRIGHTNESS, { stepPercentage: 10 });
    await deck.turn(mainDial, 1);

    expect([first.on, second.on]).toEqual([true, true]);
    expect(first.brightnessInLumen).toBe(second.brightnessInLumen);
  });

  it("show in each cell what the plugin settings choose, and follow a change on every dial on a lamp screen (#177)", async () => {
    const { dial } = await onFirstLampScreen();
    const temperatureDial = await deck.dial(TEMPERATURE);
    await deck.tap(temperatureDial);

    await saveFromPage({
      lampScreenTopLeft: "power",
      lampScreenMiddleRight: "none",
      lampScreenBottomRight: "counter",
    });
    await vi.runAllTimersAsync();

    for (const shown of [dial, temperatureDial]) {
      expect(cellsOf(shown)).toEqual({
        topLeft: "OFF",
        topRight: "1 of 2",
        middleLeft: "6500 K",
        middleRight: "",
        bottomLeft: "100%",
        bottomRight: "1 of 2",
      });
    }
  });

  it("trim the identification, count the lamp alone, and draw the power in a style of its own, as the plugin settings choose (#153, #177)", async () => {
    const { dial } = await onFirstLampScreen();

    await saveFromPage({
      lampScreenOptions: {
        topLeft: { identification: { first: "model", second: "id", trim: true } },
        topRight: { counter: { count: "count" } },
        middleRight: { power: { offStyle: "custom", offColor: "#ff0000", offWeight: "bold" } },
      },
    });
    await vi.runAllTimersAsync();

    // Trimmed to 10 characters, its "…" included.
    expect(cellsOf(dial)).toMatchObject({ topLeft: `${`${MODEL} - AL-A`.slice(0, 9)}…`, topRight: "1" });
    expect(feedbackOf(dial)).toMatchObject({ middleRight: { value: "OFF", color: "#ff0000", font: { weight: 700 } } });
  });

  it("show the name a lamp was given in the plugin settings, in a cell set to show it (#177)", async () => {
    const { first, dial } = await onFirstLampScreen();

    sdk.sendToPlugin({ event: "rename", id: lampId(first.serialNumber), name: "Key light" });
    await saveFromPage({ lampScreenOptions: { topLeft: { identification: { first: "name", second: "empty" } } } });
    await vi.runAllTimersAsync();

    expect(cellsOf(dial)).toMatchObject({ topLeft: "Key light", topRight: "1 of 2" });
  });

  it("blink each lamp as a tap shows it, on every dial, once the dials' setting is on (#144)", async () => {
    const [first, second] = [newLamp({ serialNumber: "SERIAL-A" }), newLamp({ serialNumber: "SERIAL-B", on: false })];
    plugIn(second, first);
    const brightnessDial = await deck.dial(BRIGHTNESS);
    const temperatureDial = await deck.dial(TEMPERATURE);

    await deck.tap(brightnessDial);

    expect([first.writes("power"), second.writes("power")]).toEqual([[], []]);

    await saveFromPage({ blinkOnLampScreen: true });
    await deck.quickly(() => {
      void deck.tap(brightnessDial);
      void deck.tap(brightnessDial);
    });

    // The second lamp blinks on and back off, as it was, and the way back to the main screen blinks nothing.
    expect([first.writes("power"), second.writes("power")]).toEqual([[], [1, 0]]);
    expect([first.on, second.on]).toEqual([true, false]);
    expect(brightnessDial.setFeedbackLayout).toHaveBeenLastCalledWith("$B1");

    await deck.tap(temperatureDial);

    expect([first.writes("power"), second.writes("power")]).toEqual([
      [0, 1],
      [1, 0],
    ]);
    expect(cellsOf(temperatureDial)).toMatchObject({ topLeft: `${MODEL} - AL-A`, topRight: "1 of 2" });
  });

  it("blink nothing on a dial that chose otherwise on its own page, while the other dials blink", async () => {
    const [first, second] = [newLamp({ serialNumber: "SERIAL-A" }), newLamp({ serialNumber: "SERIAL-B" })];
    plugIn(second, first);
    const brightnessDial = await deck.dial(BRIGHTNESS);
    const temperatureDial = await deck.dial(TEMPERATURE);

    await saveFromPage({ blinkOnLampScreen: true, blinkOnLampScreenExceptions: [brightnessDial.id] });
    await deck.tap(brightnessDial);

    expect(first.writes("power")).toEqual([]);

    await deck.tap(temperatureDial);

    expect(first.writes("power")).toEqual([0, 1]);
  });

  it.each([
    ["Brightness", BRIGHTNESS],
    ["Temperature", TEMPERATURE],
  ])(
    "blink the lamp on a %s dial's screen when its strip is held, and nothing on its main screen",
    async (_name, manifestId) => {
      const [first, second] = [newLamp({ serialNumber: "SERIAL-A" }), newLamp({ serialNumber: "SERIAL-B" })];
      plugIn(second, first);
      const dial = await deck.dial(manifestId);

      await deck.hold(dial);

      expect([first.writes("power"), second.writes("power")]).toEqual([[], []]);

      await deck.tap(dial);
      await deck.hold(dial);

      expect([first.writes("power"), second.writes("power")]).toEqual([[0, 1], []]);
      expect(first.on).toBe(true);
      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith("layouts/lamp.json");
    },
  );

  it("show an alert when the lamp on screen can't be blinked", async () => {
    const { first, dial } = await onFirstLampScreen();
    first.fail("everything");

    await deck.hold(dial);

    expect(dial.showAlert).toHaveBeenCalledOnce();
  });

  it("show an alert on a tap when there are no lamps, and stay on the main screen", async () => {
    plugIn();
    const dial = await deck.dial(BRIGHTNESS);

    await deck.tap(dial);

    expect(dial.showAlert).toHaveBeenCalledOnce();
    expect(dial.setFeedbackLayout).not.toHaveBeenCalledWith("layouts/lamp.json");
  });

  it("go back to the main screen once the lamps change, when the lamp on screen was unplugged", async () => {
    const { second, dial } = await onFirstLampScreen();
    const key = await deck.key(POWER, { mode: "toggle" });
    connect(second);

    await deck.press(key);

    expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith("$B1");
    expect(feedbackOf(dial)).toMatchObject({ title: "Brightness" });
  });

  it.each([
    ["Brightness", BRIGHTNESS],
    ["Temperature", TEMPERATURE],
  ])("forget a %s dial taken off the Deck, which the lamps changing no longer redraws", async (_name, manifestId) => {
    plugIn(newLamp({ serialNumber: "SERIAL-A" }), newLamp({ serialNumber: "SERIAL-B" }));
    const dial = await deck.dial(manifestId);
    const powerKey = await deck.key(POWER, { mode: "toggle" });
    await deck.tap(dial);
    await deck.remove(dial);
    dial.setFeedback.mockClear();

    await deck.press(powerKey);

    expect(dial.setFeedback).not.toHaveBeenCalled();
  });
});

describe("lamps kept apart (#145)", () => {
  it("step each from its own brightness on a dial and a step key, while their temperatures stay together", async () => {
    const dim = newLamp({ brightnessInLumen: LUMEN_AT_50, temperatureInKelvin: 4000 });
    const bright = newLamp({ brightnessInLumen: LUMEN_AT_80, temperatureInKelvin: 5000 });
    plugIn(dim, bright);
    const brightnessDial = await deck.dial(BRIGHTNESS, { stepPercentage: 10 });
    const brightnessUp = await deck.key(BRIGHTNESS_UP, { stepPercentage: 10 });
    const temperatureDial = await deck.dial(TEMPERATURE, { stepKelvin: 100 });
    await saveFromPage({ keepBrightnessDifference: true });

    await deck.turn(brightnessDial, 1);

    expect([dim.brightnessInLumen, bright.brightnessInLumen]).toEqual([LUMEN_AT_60, LUMEN_AT_90]);
    expect(textOf(brightnessDial)).toMatchObject({ value: "90%" });

    // The brighter lamp stops at 100%, and the dimmer one keeps going.
    await deck.press(brightnessUp);
    await deck.press(brightnessUp);

    expect([dim.brightnessInLumen, bright.brightnessInLumen]).toEqual([LUMEN_AT_80, LUMEN_AT_100]);
    expect(titleOf(brightnessUp)).toBe("100%");

    await deck.turn(temperatureDial, 1);

    expect([dim.temperatureInKelvin, bright.temperatureInKelvin]).toEqual([4100, 4100]);
  });

  it("stay a step apart through their caps, down to 0% and back up, on a dial", async () => {
    // Two lamps on a Stream Deck + XL's USB hub, which stop at 79% and 58%, the first one set a step ahead.
    const ahead = newLamp({ serialNumber: "SERIAL-A", brightnessInLumen: LUMEN_AT_10, capInLumen: 324 });
    const behind = newLamp({ serialNumber: "SERIAL-B", brightnessInLumen: LUMEN_AT_0, capInLumen: 244 });
    plugIn(ahead, behind);
    const dial = await deck.dial(BRIGHTNESS, { stepPercentage: 10 });
    await saveFromPage({ keepBrightnessDifference: true });
    const levels = () => [ahead.brightnessInLumen, behind.brightnessInLumen];

    for (let tick = 0; tick < 10; tick++) {
      await deck.turn(dial, 1);
    }

    expect(levels()).toEqual([324, 244]);

    await deck.turn(dial, -1);
    await deck.turn(dial, -1);

    expect(levels()).toEqual([LUMEN_AT_60, LUMEN_AT_50]);

    for (let tick = 0; tick < 10; tick++) {
      await deck.turn(dial, -1);
    }
    await deck.turn(dial, 1);

    expect(levels()).toEqual([LUMEN_AT_10, LUMEN_AT_0]);
  });

  it("come back in sync on a turn once the setting is off again", async () => {
    const [dim, bright] = [newLamp({ brightnessInLumen: LUMEN_AT_50 }), newLamp({ brightnessInLumen: LUMEN_AT_80 })];
    plugIn(dim, bright);
    const dial = await deck.dial(BRIGHTNESS, { stepPercentage: 10 });
    await saveFromPage({ keepBrightnessDifference: true });
    await deck.turn(dial, -1);
    await saveFromPage({ keepBrightnessDifference: false });

    await deck.turn(dial, -1);

    expect([dim.brightnessInLumen, bright.brightnessInLumen]).toEqual([LUMEN_AT_60, LUMEN_AT_60]);
  });

  it("step each from its own temperature on a dial and a step key, while their brightness stays together", async () => {
    const warm = newLamp({ serialNumber: "SERIAL-A", brightnessInLumen: LUMEN_AT_50, temperatureInKelvin: 3100 });
    const cool = newLamp({ serialNumber: "SERIAL-B", brightnessInLumen: LUMEN_AT_80, temperatureInKelvin: 4700 });
    plugIn(cool, warm);
    const temperatureDial = await deck.dial(TEMPERATURE, { stepKelvin: 200 });
    const temperatureUp = await deck.key(TEMPERATURE_UP, { stepKelvin: 200 });
    const brightnessDial = await deck.dial(BRIGHTNESS, { stepPercentage: 10 });
    await saveFromPage({ keepTemperatureDifference: true });

    await deck.turn(temperatureDial, 1);

    expect([warm.temperatureInKelvin, cool.temperatureInKelvin]).toEqual([3300, 4900]);
    // The dials and the keys show the first lamp's temperature.
    expect(textOf(temperatureDial)).toMatchObject({ value: "3300" });

    await deck.press(temperatureUp);

    expect([warm.temperatureInKelvin, cool.temperatureInKelvin]).toEqual([3500, 5100]);
    expect(titleOf(temperatureUp)).toBe("3500");

    await deck.turn(brightnessDial, 1);

    expect([warm.brightnessInLumen, cool.brightnessInLumen]).toEqual([LUMEN_AT_90, LUMEN_AT_90]);
  });

  it("stay apart through the end of the temperature range, and come back with their difference, on a dial", async () => {
    const warm = newLamp({ serialNumber: "SERIAL-A", temperatureInKelvin: 6100 });
    const cool = newLamp({ serialNumber: "SERIAL-B", temperatureInKelvin: 6300 });
    plugIn(warm, cool);
    const dial = await deck.dial(TEMPERATURE, { stepKelvin: 200 });
    await saveFromPage({ keepTemperatureDifference: true });
    const temperatures = () => [warm.temperatureInKelvin, cool.temperatureInKelvin];

    await deck.turn(dial, 4);

    expect(temperatures()).toEqual([6500, 6500]);

    await deck.turn(dial, -1);

    expect(temperatures()).toEqual([6300, 6500]);

    await deck.turn(dial, -1);

    expect(temperatures()).toEqual([6100, 6300]);
  });

  it("come back in sync on a temperature turn once the temperature's setting is off again", async () => {
    const warm = newLamp({ serialNumber: "SERIAL-A", temperatureInKelvin: 3100 });
    const cool = newLamp({ serialNumber: "SERIAL-B", temperatureInKelvin: 4700 });
    plugIn(warm, cool);
    const dial = await deck.dial(TEMPERATURE, { stepKelvin: 200 });
    await saveFromPage({ keepTemperatureDifference: true });
    await deck.turn(dial, -1);
    await saveFromPage({ keepTemperatureDifference: false });

    await deck.turn(dial, -1);

    // A step down from the first lamp's 2900 K.
    expect([warm.temperatureInKelvin, cool.temperatureInKelvin]).toEqual([2700, 2700]);
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
    plugIn(newLamp({ serialNumber: "SERIAL-A" }), newLamp({ serialNumber: "SERIAL-B" }));
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

describe("a Beam and a Beam LX together (#100)", () => {
  /** A Beam and a Beam LX, whatever the run's model, plugged in out of the order of their serial numbers. */
  function beamAndBeamLx() {
    const setting = { on: true, brightnessInLumen: LUMEN_AT_50, temperatureInKelvin: 4000 };
    const lx = new EmulatedLitra("Beam LX", { serialNumber: "SERIAL-B", ...setting });
    const beam = new EmulatedLitra("Beam", { serialNumber: "SERIAL-A", ...setting });
    plugIn(lx, beam);
    return { beam, lx };
  }

  it("go to the same percentage of their ranges from a dial's main screen, which shows them as one", async () => {
    const { beam, lx } = beamAndBeamLx();
    const dial = await deck.dial(BRIGHTNESS, { stepPercentage: 10 });

    await deck.turn(dial, 1);

    expect([beam.brightnessInLumen, lx.brightnessInLumen]).toEqual([LUMEN_AT_60, LUMEN_AT_60]);
    expect(feedbackOf(dial)).toMatchObject({ value: "60%", indicator: { value: 60 } });
  });

  it("are each named by their own model on the lamp screens", async () => {
    beamAndBeamLx();
    const dial = await deck.dial(BRIGHTNESS);

    await deck.tap(dial);
    const first = cellsOf(dial);
    await deck.tap(dial);

    expect([first.topLeft, cellsOf(dial).topLeft]).toEqual(["Beam - AL-A", "Beam LX - AL-B"]);
  });

  it("show an alert on a key for every lamp when the Beam LX can't be told apart, but not on the Beam's lamp screen", async () => {
    const { beam, lx } = beamAndBeamLx();
    const key = await deck.key(BRIGHTNESS, { presetPercentage: 100 });
    const dial = await deck.dial(BRIGHTNESS, { stepPercentage: 10 });
    await deck.tap(dial);
    lx.fail("identifying");

    await deck.press(key);

    expect(key.showAlert).toHaveBeenCalledOnce();
    expect(beam.brightnessInLumen).toBe(LUMEN_AT_100);

    await deck.turn(dial, -1);

    expect(dial.showAlert).not.toHaveBeenCalled();
    expect(beam.brightnessInLumen).toBe(LUMEN_AT_90);
  });

  it("come back from a blink as they were after a scene, as their lamp screens show", async () => {
    const { beam, lx } = beamAndBeamLx();
    const scene = await deck.key(SCENE, { presetPercentage: 100, presetKelvin: 6500 });
    const dial = await deck.dial(BRIGHTNESS);
    await saveFromPage({ blinkOnLampScreen: true });
    await deck.press(scene);

    await deck.tap(dial);
    await deck.tap(dial);

    expect([beam, lx].map((lamp) => [lamp.on, lamp.brightnessInLumen, lamp.temperatureInKelvin])).toEqual([
      [true, LUMEN_AT_100, 6500],
      [true, LUMEN_AT_100, 6500],
    ]);
    expect(cellsOf(dial)).toMatchObject({
      topLeft: "Beam LX - AL-B",
      middleLeft: "6500 K",
      bottomLeft: "100%",
      bottomRight: "400 lm",
    });
  });
});

describe("lamps picked on a key's settings page (#20)", () => {
  /** A lamp as the settings page saves it: its id (#194). */
  function picked(lamp: EmulatedLitra) {
    return lampId(lamp.serialNumber);
  }

  /** A lamp as the plugin lists it for a page: its id and label, with its model and the end of its serial (#146). */
  function listed(lamp: EmulatedLitra) {
    const serialEnd = lamp.serialNumber.slice(-4);
    return { id: picked(lamp), label: `${MODEL} - ${serialEnd}`, model: MODEL, serialEnd };
  }

  it("are the only ones a key switches, and its state shows theirs", async () => {
    // A key that adds no new lamps acts on the lamps checked alone (#147).
    await saveFromPage({ addNewLamps: false });
    const [first, second] = [newLamp({ on: false }), newLamp({ on: false })];
    plugIn(first, second);
    const firstKey = await deck.key(POWER, { mode: "toggle", lamps: [picked(first)] });
    const everyLamp = await deck.key(POWER, { mode: "toggle" });

    await deck.press(firstKey);

    expect([first.on, second.on]).toEqual([true, false]);
    expect([stateOf(firstKey), stateOf(everyLamp)]).toEqual([1, 0]);
  });

  it("are the ones a Power key shows the state of as soon as its page saves them", async () => {
    await saveFromPage({ addNewLamps: false });
    const [first, second] = [newLamp(), newLamp({ on: false })];
    plugIn(first, second);
    const key = await deck.key(POWER, { mode: "toggle", lamps: [picked(first)] });

    expect(stateOf(key)).toBe(1);

    await deck.changeSettings(key, { mode: "toggle", lamps: [picked(second)] });

    expect(stateOf(key)).toBe(0);
  });

  it("are the only ones a step key steps, and its title shows them", async () => {
    await saveFromPage({ addNewLamps: false });
    const [first, second] = [newLamp(), newLamp({ brightnessInLumen: LUMEN_AT_80 })];
    plugIn(first, second);
    const key = await deck.key(BRIGHTNESS_UP, { stepPercentage: 10, lamps: [picked(first)] });

    await deck.press(key);

    expect([first.brightnessInLumen, second.brightnessInLumen]).toEqual([LUMEN_AT_60, LUMEN_AT_80]);
    expect(titleOf(key)).toBe("60%");
  });

  it("take in a lamp added later, but not the ones the page left out, by default (#147)", async () => {
    const [first, second, third] = [newLamp({ on: false }), newLamp({ on: false }), newLamp({ on: false })];
    plugIn(first, second);
    const key = await deck.key(POWER, { mode: "on", lamps: [picked(first)], leftOutLamps: [picked(second)] });
    plugIn(first, second, third);

    await deck.press(key);

    expect([first.on, second.on, third.on]).toEqual([true, false, true]);
  });

  it("are listed for the page from the lamps plugged in, and blinked by its Identify button", async () => {
    const [first, second] = [newLamp({ serialNumber: "SERIAL-A" }), newLamp({ serialNumber: "SERIAL-B" })];
    plugIn(second, first);

    sdk.sendToPlugin({ event: "lamps" });
    await vi.runAllTimersAsync();

    expect(at(sdk.sentToPropertyInspector(), -1)).toEqual({ event: "lamps", lamps: [listed(first), listed(second)] });

    sdk.sendToPlugin({ event: "identify", id: lampId(second.serialNumber) });
    await vi.runAllTimersAsync();

    expect([first.writes("power"), second.writes("power")]).toEqual([[], [0, 1]]);
  });

  it("blink for as long as the plugin settings say (#171)", async () => {
    const lamp = newLamp();
    plugIn(lamp);

    await saveFromPage({ identifyBlinkMs: 1000 });
    sdk.sendToPlugin({ event: "identify", id: lampId(lamp.serialNumber) });
    await vi.advanceTimersByTimeAsync(999);

    expect(lamp.writes("power")).toEqual([0]);

    await vi.advanceTimersByTimeAsync(1);

    expect(lamp.writes("power")).toEqual([0, 1]);
  });
});

describe("the lamps the plugin knows (#194)", () => {
  it("leave a lamp plugged in alone until Find lamps adds it, then every key takes it in", async () => {
    const [known, added] = [newLamp({ on: false }), newLamp({ on: false })];
    plugIn(known);
    const key = await deck.key(POWER, { mode: "on" });
    lamps.push(added);
    connect(known, added);

    await deck.press(key);

    expect([known.on, added.on]).toEqual([true, false]);

    sdk.sendToPlugin({ event: "lamps" });
    await deck.press(key);

    expect([known.on, added.on]).toEqual([true, true]);
  });

  it("are kept when a lamp is unplugged, so it's acted on again once it's plugged back in, without a find", async () => {
    const lamp = newLamp({ on: false });
    plugIn(lamp);
    const key = await deck.key(POWER, { mode: "on" });
    connect();
    await deck.press(key);
    connect(lamp);

    await deck.press(key);

    expect(lamp.on).toBe(true);
  });

  it("are saved in the global settings, keeping the ones a page saved", async () => {
    await saveFromPage({ identifyBlinkMs: 600 });
    const lamp = newLamp({ serialNumber: "SERIAL-A" });

    plugIn(lamp);
    await vi.runAllTimersAsync();

    expect(await sdk.default.settings.getGlobalSettings()).toEqual({
      identifyBlinkMs: 600,
      lamps: { [lampId("SERIAL-A")]: { model: MODEL, serialEnd: "AL-A" } },
    });
  });

  it("are renamed from the plugin settings, with the name trimmed, and lose their name once it's cleared (#146)", async () => {
    const lamp = newLamp({ serialNumber: "SERIAL-A" });
    plugIn(lamp);
    const id = lampId(lamp.serialNumber);

    sdk.sendToPlugin({ event: "rename", id, name: "  Key light  " });
    await vi.runAllTimersAsync();

    expect(await sdk.default.settings.getGlobalSettings()).toEqual({
      lamps: { [id]: { model: MODEL, serialEnd: "AL-A", name: "Key light" } },
    });

    sdk.sendToPlugin({ event: "rename", id, name: " " });
    await vi.runAllTimersAsync();

    expect(await sdk.default.settings.getGlobalSettings()).toEqual({
      lamps: { [id]: { model: MODEL, serialEnd: "AL-A" } },
    });
  });

  it("are forgotten from the plugin settings, so no key acts on the lamp until Find lamps adds it again, without its name", async () => {
    const [forgotten, kept] = [
      newLamp({ serialNumber: "SERIAL-A", on: false }),
      newLamp({ serialNumber: "SERIAL-B", on: false }),
    ];
    plugIn(forgotten, kept);
    const key = await deck.key(POWER, { mode: "on" });
    const id = lampId(forgotten.serialNumber);
    sdk.sendToPlugin({ event: "rename", id, name: "Key light" });

    sdk.sendToPlugin({ event: "forget", id });
    await deck.press(key);

    expect([forgotten.on, kept.on]).toEqual([false, true]);
    expect(await sdk.default.settings.getGlobalSettings()).toEqual({
      lamps: { [lampId(kept.serialNumber)]: { model: MODEL, serialEnd: "AL-B" } },
    });

    sdk.sendToPlugin({ event: "lamps" });
    await deck.press(key);

    expect([forgotten.on, kept.on]).toEqual([true, true]);
    expect(await sdk.default.settings.getGlobalSettings()).toEqual({
      lamps: {
        [id]: { model: MODEL, serialEnd: "AL-A" },
        [lampId(kept.serialNumber)]: { model: MODEL, serialEnd: "AL-B" },
      },
    });
  });

  it("are left as they are when a page renames or forgets a lamp the plugin doesn't know", async () => {
    plugIn(newLamp({ serialNumber: "SERIAL-A" }));
    await vi.runAllTimersAsync();
    const before = await sdk.default.settings.getGlobalSettings();

    sdk.sendToPlugin({ event: "rename", id: lampId("UNKNOWN"), name: "Key light" });
    sdk.sendToPlugin({ event: "forget", id: lampId("UNKNOWN") });
    await vi.runAllTimersAsync();

    expect(await sdk.default.settings.getGlobalSettings()).toEqual(before);
  });
});

describe("keys and dials whose lamps can't be reached", () => {
  it.each([
    ["Brightness", BRIGHTNESS],
    ["Temperature", TEMPERATURE],
  ])("show an alert on a %s dial pushed or turned once its lamps are unplugged", async (_name, manifestId) => {
    plugIn(newLamp());
    const dial = await deck.dial(manifestId);
    connect();

    await deck.push(dial);
    await deck.turn(dial, 1);

    expect(dial.showAlert).toHaveBeenCalledTimes(2);
  });

  it("show an alert on a Temperature key once its lamps are unplugged", async () => {
    plugIn(newLamp());
    const key = await deck.key(TEMPERATURE, { presetKelvin: 5000 });
    connect();

    await deck.press(key);

    expect(key.showAlert).toHaveBeenCalledOnce();
  });

  it("show an alert on a key whose page checks no lamp, which acts on none (#20)", async () => {
    await saveFromPage({ addNewLamps: false });
    const lamp = newLamp({ on: false });
    plugIn(lamp);
    const key = await deck.key(POWER, { mode: "on", lamps: [] });

    await deck.press(key);

    expect(key.showAlert).toHaveBeenCalledOnce();
    expect(lamp.on).toBe(false);
  });

  it("show an alert on a key whose page leaves out every lamp connected (#147)", async () => {
    const [first, second] = [newLamp({ on: false }), newLamp({ on: false })];
    plugIn(first, second);
    const key = await deck.key(POWER, {
      mode: "on",
      lamps: [],
      leftOutLamps: [lampId(first.serialNumber), lampId(second.serialNumber)],
    });

    await deck.press(key);

    expect(key.showAlert).toHaveBeenCalledOnce();
    expect([first.on, second.on]).toEqual([false, false]);
  });

  it("show an alert on a key none of whose lamps is connected, which leaves the others alone (#20)", async () => {
    await saveFromPage({ addNewLamps: false });
    const [unplugged, other] = [newLamp({ on: false }), newLamp({ on: false })];
    plugIn(unplugged, other);
    const key = await deck.key(POWER, { mode: "on", lamps: [lampId(unplugged.serialNumber)] });
    connect(other);

    await deck.press(key);

    expect(key.showAlert).toHaveBeenCalledOnce();
    expect(other.on).toBe(false);
  });

  it("show an alert when none of the lamps connected is one the plugin knows, and leave them alone (#194)", async () => {
    const [known, unknown] = [newLamp({ on: false }), newLamp({ on: false })];
    plugIn(known);
    const key = await deck.key(POWER, { mode: "on" });
    lamps.push(unknown);
    connect(unknown);

    await deck.press(key);

    expect(key.showAlert).toHaveBeenCalledOnce();
    expect(unknown.on).toBe(false);
  });

  it("show an alert when finding the lamps fails, and no value on the dials", async () => {
    plugIn(newLamp());
    const key = await deck.key(BRIGHTNESS, { presetPercentage: 100 });
    const dial = await deck.dial(BRIGHTNESS);
    failFindingLamps(new Error("Cannot list HID devices"));

    await deck.press(key);

    expect(key.showAlert).toHaveBeenCalledOnce();
    expect(feedbackOf(dial)).toMatchObject({ value: "—" });
  });
});
