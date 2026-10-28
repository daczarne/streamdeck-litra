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
const SCENE = "com.daczarne.litra.scene";
const BRIGHTNESS_UP = "com.daczarne.litra.brightness-up";
const BRIGHTNESS_DOWN = "com.daczarne.litra.brightness-down";
const TEMPERATURE_UP = "com.daczarne.litra.temperature-up";
const TEMPERATURE_DOWN = "com.daczarne.litra.temperature-down";

// A Beam's brightness in lumens at a percentage of its range (30–400 lm), as litra rounds it.
const LUMEN_AT_0 = 30;
const LUMEN_AT_10 = 67;
const LUMEN_AT_50 = 215;
const LUMEN_AT_60 = 252;
const LUMEN_AT_80 = 326;
const LUMEN_AT_90 = 363;
const LUMEN_AT_100 = 400;

let connect: (...lamps: EmulatedLitra[]) => void;
let deck: FakeDeck;
// The fake SDK plugin.ts registered with, which carries the messages of the settings pages.
let sdk: typeof import("../test-support/fake-stream-deck");
let lampId: (serialNumber: string) => string;
// Every lamp plugged in during the test, whose handles have to be closed by its end.
let lamps: EmulatedLitra[];

beforeEach(async () => {
  vi.useFakeTimers();
  // A fresh plugin for every test, started as Stream Deck starts it, which registers its actions with the fake SDK
  // that the fake Deck sends events through.
  ({
    loaded: { deck, sdk, lampId },
    hid: { connect },
  } = await loadOnEmulatedLamps(
    async () => {
      const { FakeDeck } = await import("../test-support/fake-deck");
      await import("../plugin");
      return {
        deck: new FakeDeck(),
        sdk: await import("../test-support/fake-stream-deck"),
        lampId: (await import("../litra-manager")).lampId,
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

  it("shows an alert when no lamp answers, after the off state it switches to, so the state doesn't cover it (#132)", async () => {
    const pair = [beam(), beam()];
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

describe("the Scene key", () => {
  it("turns every lamp on at its brightness and temperature, and every dial and Power key follows (#86)", async () => {
    const pair = [beam({ on: false }), beam({ on: false })];
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
});

describe("the step keys", () => {
  it("step every lamp's brightness up and down by their step, and every step key shows the brightest lamp (#129)", async () => {
    const pair = [beam(), beam()];
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
    const pair = [beam(), beam()];
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
    // Two Beams on a Stream Deck + XL's USB hub, which stop at 63% and 79%.
    const pair = [
      beam({ brightnessInLumen: LUMEN_AT_60, capInLumen: 264 }),
      beam({ brightnessInLumen: LUMEN_AT_60, capInLumen: 324 }),
    ];
    plugIn(...pair);
    // 80%, a step of 20% up from 60%, is past both caps.
    const key = await deck.key(BRIGHTNESS_UP, { stepPercentage: 20 });

    await deck.press(key);

    expect(pair.map((lamp) => lamp.brightnessInLumen)).toEqual([264, 324]);
    expect(titleOf(key)).toBe("79%");
  });

  it("step every lamp's temperature up and down from the first lamp's, and every step key shows it (#129)", async () => {
    const pair = [beam({ temperatureInKelvin: 3000 }), beam({ temperatureInKelvin: 5000 })];
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
    plugIn(beam(), beam());
    const brightnessKey = await deck.key(BRIGHTNESS_DOWN, { stepPercentage: 10 });
    const temperatureKey = await deck.key(TEMPERATURE_UP, { stepKelvin: 300 });
    const scene = await deck.key(SCENE, { presetPercentage: 80, presetKelvin: 6500 });

    await deck.press(scene);

    expect([titleOf(brightnessKey), titleOf(temperatureKey)]).toEqual(["80%", "6500"]);
  });

  it("show an alert when a lamp fails, and still step the others", async () => {
    const [failing, working] = [beam(), beam()];
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
    // The first lamp is off, which its power shows in bold dark grey.
    expect(feedbackOf(dial)).toMatchObject({ power: { value: "Off", color: "#202020", font: { weight: 700 } } });
    expect(textOf(dial)).toEqual({
      lamp: "Beam - AL-A",
      position: "1 of 2",
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

    expect(textOf(dial)).toMatchObject({ lamp: "Beam - AL-A", position: "1 of 2", temperature: "5000 K" });
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
    expect(textOf(dial)).toMatchObject({
      lamp: "Beam - AL-A",
      position: "1 of 2",
      brightness: "80%",
      temperature: "6500 K",
    });
    expect(textOf(temperatureDial)).toMatchObject({
      lamp: "Beam - AL-B",
      position: "2 of 2",
      brightness: "50%",
      temperature: "4100 K",
    });

    await deck.push(dial);

    expect([first.on, second.on]).toEqual([false, true]);
    expect(textOf(dial)).toMatchObject({ power: "Off" });

    const mainDial = await deck.dial(BRIGHTNESS, { stepPercentage: 10 });
    await deck.turn(mainDial, 1);

    expect([first.on, second.on]).toEqual([true, true]);
    expect(first.brightnessInLumen).toBe(second.brightnessInLumen);
  });

  it("blink each lamp as a tap shows it, on every dial, once the dials' setting is on (#144)", async () => {
    const [first, second] = [beam({ serialNumber: "SERIAL-A" }), beam({ serialNumber: "SERIAL-B", on: false })];
    plugIn(second, first);
    const brightnessDial = await deck.dial(BRIGHTNESS);
    const temperatureDial = await deck.dial(TEMPERATURE);

    await deck.tap(brightnessDial);

    expect([first.writes("power"), second.writes("power")]).toEqual([[], []]);

    sdk.changeGlobalSettings({ blinkOnLampScreen: true });
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
    expect(textOf(temperatureDial)).toMatchObject({ lamp: "Beam - AL-A", position: "1 of 2" });
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

describe("lamps kept apart (#145)", () => {
  it("step each from its own brightness on a dial and a step key, while their temperatures stay together", async () => {
    const dim = beam({ brightnessInLumen: LUMEN_AT_50, temperatureInKelvin: 4000 });
    const bright = beam({ brightnessInLumen: LUMEN_AT_80, temperatureInKelvin: 5000 });
    plugIn(dim, bright);
    const brightnessDial = await deck.dial(BRIGHTNESS, { stepPercentage: 10 });
    const brightnessUp = await deck.key(BRIGHTNESS_UP, { stepPercentage: 10 });
    const temperatureDial = await deck.dial(TEMPERATURE, { stepKelvin: 100 });
    sdk.changeGlobalSettings({ keepBrightnessDifference: true });

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
    // Two Beams on a Stream Deck + XL's USB hub, which stop at 79% and 58%, the first one set a step ahead.
    const ahead = beam({ serialNumber: "SERIAL-A", brightnessInLumen: LUMEN_AT_10, capInLumen: 324 });
    const behind = beam({ serialNumber: "SERIAL-B", brightnessInLumen: LUMEN_AT_0, capInLumen: 244 });
    plugIn(ahead, behind);
    const dial = await deck.dial(BRIGHTNESS, { stepPercentage: 10 });
    sdk.changeGlobalSettings({ keepBrightnessDifference: true });
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
    const [dim, bright] = [beam({ brightnessInLumen: LUMEN_AT_50 }), beam({ brightnessInLumen: LUMEN_AT_80 })];
    plugIn(dim, bright);
    const dial = await deck.dial(BRIGHTNESS, { stepPercentage: 10 });
    sdk.changeGlobalSettings({ keepBrightnessDifference: true });
    await deck.turn(dial, -1);
    sdk.changeGlobalSettings({ keepBrightnessDifference: false });

    await deck.turn(dial, -1);

    expect([dim.brightnessInLumen, bright.brightnessInLumen]).toEqual([LUMEN_AT_60, LUMEN_AT_60]);
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

describe("lamps picked on a key's settings page (#20)", () => {
  /** A lamp as the settings page saves it: its id, and the label it showed. */
  function picked(lamp: EmulatedLitra) {
    return { id: lampId(lamp.serialNumber), label: `Beam - ${lamp.serialNumber.slice(-4)}` };
  }

  it("are the only ones a key switches, and its state shows theirs", async () => {
    const [first, second] = [beam({ on: false }), beam({ on: false })];
    plugIn(first, second);
    const firstKey = await deck.key(POWER, { mode: "toggle", lamps: [picked(first)] });
    const everyLamp = await deck.key(POWER, { mode: "toggle" });

    await deck.press(firstKey);

    expect([first.on, second.on]).toEqual([true, false]);
    expect([stateOf(firstKey), stateOf(everyLamp)]).toEqual([1, 0]);
  });

  it("are the only ones a step key steps, and its title shows them", async () => {
    const [first, second] = [beam(), beam({ brightnessInLumen: LUMEN_AT_80 })];
    plugIn(first, second);
    const key = await deck.key(BRIGHTNESS_UP, { stepPercentage: 10, lamps: [picked(first)] });

    await deck.press(key);

    expect([first.brightnessInLumen, second.brightnessInLumen]).toEqual([LUMEN_AT_60, LUMEN_AT_80]);
    expect(titleOf(key)).toBe("60%");
  });

  it("are listed for the page from the lamps plugged in, and blinked by its Identify button", async () => {
    const [first, second] = [beam({ serialNumber: "SERIAL-A" }), beam({ serialNumber: "SERIAL-B" })];
    plugIn(second, first);

    sdk.sendToPlugin({ event: "lamps" });
    await vi.runAllTimersAsync();

    expect(sdk.sentToPropertyInspector()).toEqual([{ event: "lamps", lamps: [picked(first), picked(second)] }]);

    sdk.sendToPlugin({ event: "identify", id: lampId(second.serialNumber) });
    await vi.runAllTimersAsync();

    expect([first.writes("power"), second.writes("power")]).toEqual([[], [0, 1]]);
  });
});
