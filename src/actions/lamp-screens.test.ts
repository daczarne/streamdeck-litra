import { brightnessGlyph, svgDoc, temperatureGlyph } from "@daczarne/streamdeck-icons";
import type { JsonObject } from "@elgato/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { followGlobalSettings } from "../global-settings";
import type { LampState, ReachedLamp } from "../lamp";
import { identifyLamp } from "../litra-manager";
import { logger } from "../logging";
import { at } from "../test-support/at";
import { changeGlobalSettings, createFakeDial } from "../test-support/fake-stream-deck";
import { reachedLamp } from "../test-support/reached-lamps";
import { LampScreen, MAIN_LAYOUT } from "./lamp-screens";
import { globalSettings } from "./settings";
import { findShownLamps, readShownLamps } from "./shown";

//* Fakes

// The real SDK opens a connection to Stream Deck. The fake carries the global settings, which hold the blink.
vi.mock("@elgato/streamdeck", () => import("../test-support/fake-stream-deck"));

// The real logger writes to a logs/ folder.
vi.mock("../logging", () => import("../test-support/fake-logging"));

// What the keys and dials show of the lamps, which each test sets.
vi.mock("./shown", () => ({ findShownLamps: vi.fn(), readShownLamps: vi.fn() }));

// The real litra-manager loads node-hid's native binary on import and talks to real lamps.
vi.mock("../litra-manager", () => ({
  findLamps: vi.fn(() => []),
  identifyLamp: vi.fn(),
  reachEveryLamp: vi.fn(),
  useLamps: vi.fn(),
}));

const LAMP_LAYOUT = "layouts/lamp.json";

// How long a blink lasts unless the plugin settings say otherwise.
const BLINK_MS = globalSettings.identifyBlinkMs.default;

/** A Beam on a Stream Deck + XL's USB hub, at its cap: 324 lm, 79% of its range, unless a test says otherwise. */
const AT_ITS_CAP: LampState = { on: true, lumen: 324, kelvin: 2700 };

/** A lamp shown, a Beam at its cap unless a test says otherwise, by the last 4 characters of its id. */
function beam(idEnd: string, state: Partial<LampState> = {}, model = "Beam"): ReachedLamp {
  return reachedLamp(`000000000000${idEnd}`, { ...AT_ITS_CAP, ...state }, { model });
}

/** The same lamp at another state, as an operation leaves it. */
function changed(lamp: ReachedLamp, state: Partial<LampState>): ReachedLamp {
  return reachedLamp(lamp.id, { ...lamp.state, ...state }, { model: lamp.model, name: lamp.name });
}

/** The same lamp with the name given to it in the plugin settings (#146), which its `Lamp` holds. */
function named(lamp: ReachedLamp, name: string): ReachedLamp {
  return reachedLamp(lamp.id, lamp.state, { model: lamp.model, name });
}

/** A lamp's brightness, as a percentage of its range, which the lamp screens show. */
function percentageOf(lamp: ReachedLamp): number {
  return lamp.brightnessPercentage(lamp.state.lumen);
}

/** Connects the lamps, which readShownLamps reports in the order of their ids. */
function connect(...lamps: ReachedLamp[]): void {
  vi.mocked(readShownLamps).mockResolvedValue(lamps);
}

// The looks every text on a lamp screen is given, and how a slot left out of its cell is hidden (#177).
const PLAIN = { color: "#ffffff", font: { size: 18, weight: 400 } };
const OFF_POWER = { color: "#202020", font: { size: 18, weight: 400 } };
const HIDDEN = { value: "", enabled: false };
const NO_ICON = { enabled: false };
/** An icon as the lamp screens send it, drawn in a color: white by default (#153). */
function iconIn(glyph: typeof temperatureGlyph, color = "#ffffff"): string {
  return `data:image/svg+xml;base64,${Buffer.from(svgDoc(144, glyph(144, { color }))).toString("base64")}`;
}
const THERMOMETER = iconIn(temperatureGlyph);

// Text styles other than the defaults, as the plugin settings save them, and how the lamp screens draw them (#153).
const STYLES = {
  lampScreenPrimaryColor: "#FFCC00",
  lampScreenPrimaryWeight: "bold",
  lampScreenPrimarySize: "20",
  lampScreenSecondaryColor: "#336699",
  lampScreenSecondaryWeight: "normal",
  lampScreenSecondarySize: "16",
};
const PRIMARY = { color: "#ffcc00", font: { size: 20, weight: 700 } };
const SECONDARY = { color: "#336699", font: { size: 16, weight: 400 } };
const SUN = iconIn(brightnessGlyph);

/** A text shown in a slot, with its look. */
function shown(value: string, look: object = PLAIN) {
  return { value, ...look, enabled: true };
}

/** The slots of a cell: showing `text` beside the icon given, or with no icon, or nothing when there's no text. */
function cell(name: string, text?: object, icon?: string) {
  return {
    [`${name}Icon`]: icon === undefined ? NO_ICON : { value: icon, enabled: true },
    [`${name}BesideIcon`]: icon === undefined ? HIDDEN : text,
    [name]: icon === undefined && text !== undefined ? text : HIDDEN,
  };
}

/** What a dial's lamp screen shows for a lamp, the `position`-th of `count`, with every cell at its default. */
function lampScreenOf(lamp: ReachedLamp, position: number, count: number) {
  return {
    ...cell("topLeft", shown(lamp.label)),
    ...cell("topRight", shown(`${position} of ${count}`)),
    ...cell("middleLeft", shown(`${lamp.state.kelvin} K`), THERMOMETER),
    ...cell("middleRight", lamp.state.on ? shown("ON") : shown("OFF", OFF_POWER)),
    ...cell("bottomLeft", shown(`${percentageOf(lamp)}%`), SUN),
    ...cell("bottomRight", shown(`${lamp.state.lumen} lm`)),
  };
}

const A = beam("00a1");
const B = beam("00b2", { on: false, lumen: 30, kelvin: 6500 });
const C = beam("00c3");

type Dial = ReturnType<typeof createFakeDial>;

// The lamp screen of each dial a test made, as each Brightness and Temperature dial makes its own.
let screens: Map<Dial, LampScreen>;
let showMain: () => Promise<void>;

/** A dial's lamp screen, made the first time it's asked for, for a dial that adjusts the brightness. */
function screenOf(dial: Dial): LampScreen {
  let screen = screens.get(dial);
  if (screen === undefined) {
    screen = new LampScreen(dial, { showMain, adjusts: "Brightness" });
    screens.set(dial, screen);
  }
  return screen;
}

/** Redraws every dial's lamp screen, as each dial does when the lamps change. */
async function refreshAll(): Promise<void> {
  for (const screen of screens.values()) {
    await screen.refresh();
  }
}

// The blink of the lamp screens is a global setting, which the tests change as a settings page does (#144).
followGlobalSettings();

beforeEach(() => {
  changeGlobalSettings({});
  screens = new Map();
  showMain = vi.fn(async () => {});
  connect(A, B);
  // A tap finds the lamps, then shows what the plugin holds of them, which each test sets as readShownLamps.
  vi.mocked(findShownLamps).mockImplementation(() => readShownLamps());
});

//* Tests

describe("LampScreen", () => {
  describe("on a tap", () => {
    it("shows the first lamp from the main screen, on the lamp layout", async () => {
      const dial = createFakeDial();

      await screenOf(dial).tap();

      expect(dial.setFeedbackLayout).toHaveBeenCalledExactlyOnceWith(LAMP_LAYOUT);
      expect(dial.setTriggerDescription).toHaveBeenCalledExactlyOnceWith({
        rotate: "Brightness",
        push: "Power",
        touch: "Next lamp",
        longTouch: "Identify",
      });
      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(lampScreenOf(A, 1, 2));
      expect(screenOf(dial).isShowing).toBe(true);
      expect(screenOf(dial).lamp).toBe(A.id);
      // The blink is off by default (#144).
      expect(identifyLamp).not.toHaveBeenCalled();
    });

    it("goes through every lamp, then back to the main screen", async () => {
      const dial = createFakeDial();

      await screenOf(dial).tap();
      await screenOf(dial).tap();

      // The layout only changes when the dial leaves the main screen.
      expect(dial.setFeedbackLayout).toHaveBeenCalledOnce();
      expect(dial.setFeedback).toHaveBeenLastCalledWith(lampScreenOf(B, 2, 2));

      await screenOf(dial).tap();

      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith(MAIN_LAYOUT);
      expect(dial.setTriggerDescription).toHaveBeenLastCalledWith();
      expect(showMain).toHaveBeenCalledOnce();
      expect(screenOf(dial).isShowing).toBe(false);
      expect(screenOf(dial).lamp).toBeUndefined();
    });

    it("goes through the lamps in the order of their ids", async () => {
      const dial = createFakeDial();
      connect(A, B, C);

      for (const [place, lamp] of [A, B, C].entries()) {
        await screenOf(dial).tap();

        expect(screenOf(dial).lamp).toBe(lamp.id);
        expect(dial.setFeedback).toHaveBeenLastCalledWith(lampScreenOf(lamp, place + 1, 3));
      }
    });

    it("skips a lamp unplugged since the last tap", async () => {
      const dial = createFakeDial();
      connect(A, B, C);
      await screenOf(dial).tap();
      await screenOf(dial).tap();
      connect(A, C);

      await screenOf(dial).tap();

      expect(dial.setFeedback).toHaveBeenLastCalledWith(lampScreenOf(C, 2, 2));
    });

    it("goes back to the main screen when no lamp comes after the one unplugged", async () => {
      const dial = createFakeDial();
      await screenOf(dial).tap();
      await screenOf(dial).tap();
      connect(A);

      await screenOf(dial).tap();

      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith(MAIN_LAYOUT);
      expect(showMain).toHaveBeenCalledOnce();
    });

    it("shows an alert and stays on the main screen when no lamp is connected", async () => {
      const dial = createFakeDial();
      connect();

      await screenOf(dial).tap();

      expect(dial.showAlert).toHaveBeenCalledOnce();
      expect(dial.setFeedbackLayout).not.toHaveBeenCalled();
      expect(screenOf(dial).isShowing).toBe(false);
    });

    it("handles quick taps one at a time, in order", async () => {
      const dial = createFakeDial();

      await Promise.all([screenOf(dial).tap(), screenOf(dial).tap()]);

      expect(dial.setFeedback.mock.calls).toEqual([[lampScreenOf(A, 1, 2)], [lampScreenOf(B, 2, 2)]]);
    });

    it("logs a failed read instead of failing", async () => {
      const dial = createFakeDial();
      vi.mocked(readShownLamps).mockRejectedValueOnce(new Error("HID read failed"));

      await screenOf(dial).tap();
      await screenOf(dial).tap();

      expect(logger.error).toHaveBeenCalledOnce();
      // A failure doesn't hold up the next tap.
      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(lampScreenOf(A, 1, 2));
    });

    it("leaves the other dials as they are", async () => {
      const dial = createFakeDial();
      const otherDial = createFakeDial();

      await screenOf(dial).tap();

      expect(screenOf(otherDial).isShowing).toBe(false);
      expect(otherDial.setFeedback).not.toHaveBeenCalled();
    });
  });

  describe("with the cells chosen in the plugin settings (#177)", () => {
    it("shows in each cell what it's given, an icon on the outer side by default, and nothing in a cell given none", async () => {
      const dial = createFakeDial();
      changeGlobalSettings({
        lampScreenTopLeft: "power",
        lampScreenTopRight: "temperature",
        lampScreenMiddleLeft: "none",
        lampScreenMiddleRight: "brightnessPercentage",
        lampScreenBottomLeft: "brightnessLumen",
        lampScreenBottomRight: "identification",
      });

      await screenOf(dial).tap();

      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith({
        ...cell("topLeft", shown("ON")),
        ...cell("topRight", shown(`${A.state.kelvin} K`), THERMOMETER),
        ...cell("middleLeft"),
        ...cell("middleRight", shown(`${percentageOf(A)}%`), SUN),
        ...cell("bottomLeft", shown(`${A.state.lumen} lm`)),
        ...cell("bottomRight", shown(A.label)),
      });
    });

    it("shows the same in several cells", async () => {
      const dial = createFakeDial();
      changeGlobalSettings({ lampScreenTopLeft: "counter", lampScreenTopRight: "counter" });

      await screenOf(dial).tap();

      expect(dial.setFeedback).toHaveBeenCalledWith(
        expect.objectContaining({ topLeft: shown("1 of 2"), topRight: shown("1 of 2") }),
      );
    });

    it("redraws the lamp on screen with the cells as they are now", async () => {
      const dial = createFakeDial();
      await screenOf(dial).tap();

      changeGlobalSettings({ lampScreenBottomRight: "none" });
      await screenOf(dial).refresh();

      expect(dial.setFeedback).toHaveBeenLastCalledWith({ ...lampScreenOf(A, 1, 2), ...cell("bottomRight") });
    });
  });

  describe("with each cell's options (#177)", () => {
    /** Taps a new dial to the first lamp's screen, with the top left cell showing `item`, as `options` say. */
    async function topLeftOf(item: string, options: JsonObject, others: JsonObject = {}) {
      const dial = createFakeDial();
      changeGlobalSettings({ lampScreenTopLeft: item, lampScreenOptions: { topLeft: { [item]: options } }, ...others });
      await screenOf(dial).tap();
      return dial;
    }

    /** What the top left cell of a dial was last told to show. */
    function topLeft(dial: ReturnType<typeof createFakeDial>) {
      const slots = at(dial.setFeedback.mock.calls, -1)[0] as Record<string, unknown>;
      return Object.fromEntries(Object.entries(slots).filter(([slot]) => slot.startsWith("topLeft")));
    }

    it.each([
      [{ first: "name", second: "empty" }, "Key light"],
      [{ first: "name", second: "id" }, "Key light - 00a1"],
      [{ first: "id", second: "model" }, "00a1 - Beam"],
      [{ first: "empty", second: "model" }, "Beam"],
    ])("builds the identification from its parts, %o", async (options, text) => {
      connect(named(A, "Key light"), B);
      const dial = await topLeftOf("identification", options);

      expect(topLeft(dial)).toEqual(cell("topLeft", shown(text)));
    });

    it("shows the model and the end of the id for the name of a lamp with none", async () => {
      const dial = await topLeftOf("identification", { first: "name", second: "empty" });

      expect(topLeft(dial)).toEqual(cell("topLeft", shown(A.label)));
    });

    it("shows nothing for an identification with both parts empty", async () => {
      const dial = await topLeftOf("identification", { first: "empty", second: "empty" });

      expect(topLeft(dial)).toEqual(cell("topLeft", shown("")));
    });

    it("trims a long identification to 10 characters, ending in …, and leaves a short one as it is", async () => {
      connect(named(A, "Studio key light"), named(B, "Key light"));
      const dial = await topLeftOf("identification", { first: "name", second: "empty", trim: true });

      expect(topLeft(dial)).toEqual(cell("topLeft", shown("Studio ke…")));

      await screenOf(dial).tap();

      expect(topLeft(dial)).toEqual(cell("topLeft", shown("Key light")));
    });

    it.each([
      [{ count: "count" }, "1"],
      [{ count: "countOf", format: "slash" }, "1/2"],
      [{ count: "countOf", format: "dash" }, "1-2"],
      [{ count: "countOf", format: "space" }, "1 2"],
    ])("counts as %o", async (options, text) => {
      const dial = await topLeftOf("counter", options);

      expect(topLeft(dial)).toEqual(cell("topLeft", shown(text)));
    });

    it("counts the lamps of the shown one's model alone, when asked to", async () => {
      const lx = beam("00c3", {}, "Beam LX");
      connect(A, B, lx);
      const dial = await topLeftOf("counter", { count: "countByModel" });
      await screenOf(dial).tap();

      expect(topLeft(dial)).toEqual(cell("topLeft", shown("2 of 2")));

      await screenOf(dial).tap();

      expect(topLeft(dial)).toEqual(cell("topLeft", shown("1 of 1")));
    });

    it.each([
      ["temperature", { unit: false }, cell("topLeft", shown(`${A.state.kelvin}`), THERMOMETER)],
      ["temperature", { icon: false }, cell("topLeft", shown(`${A.state.kelvin} K`))],
      ["brightnessPercentage", { unit: false }, cell("topLeft", shown(`${percentageOf(A)}`), SUN)],
      ["brightnessLumen", {}, cell("topLeft", shown(`${A.state.lumen} lm`))],
      ["brightnessLumen", { icon: true }, cell("topLeft", shown(`${A.state.lumen} lm`), SUN)],
    ])("shows the %s as %o", async (item, options, slots) => {
      const dial = await topLeftOf(item, options);

      expect(topLeft(dial)).toEqual(slots);
    });

    it("shows the power with the label, and the color and weight of its own, chosen for each state", async () => {
      const options = {
        onLabel: "●",
        onStyle: "custom",
        onColor: "#FF8800",
        onWeight: "bold",
        offLabel: "O",
        offStyle: "custom",
        offColor: "#00aaff",
        offWeight: "normal",
      };
      const dial = await topLeftOf("power", options);

      expect(topLeft(dial)).toEqual(cell("topLeft", shown("●", { color: "#ff8800", font: { size: 18, weight: 700 } })));

      await screenOf(dial).tap();

      expect(topLeft(dial)).toEqual(cell("topLeft", shown("O", { color: "#00aaff", font: { size: 18, weight: 400 } })));
    });

    it("draws every text in the Primary style, and the power's OFF in the Secondary style (#153)", async () => {
      const dial = createFakeDial();
      changeGlobalSettings(STYLES);
      await screenOf(dial).tap();

      expect(dial.setFeedback).toHaveBeenLastCalledWith(
        expect.objectContaining({
          topLeft: shown(A.label, PRIMARY),
          middleLeftBesideIcon: shown(`${A.state.kelvin} K`, PRIMARY),
          middleRight: shown("ON", PRIMARY),
          bottomRight: shown(`${A.state.lumen} lm`, PRIMARY),
        }),
      );

      await screenOf(dial).tap();

      expect(dial.setFeedback).toHaveBeenLastCalledWith(
        expect.objectContaining({ middleRight: shown("OFF", SECONDARY) }),
      );
    });

    it.each([
      ["identification", {}, cell("topLeft", shown(A.label, SECONDARY))],
      ["counter", {}, cell("topLeft", shown("1 of 2", SECONDARY))],
      [
        "temperature",
        {},
        cell("topLeft", shown(`${A.state.kelvin} K`, SECONDARY), iconIn(temperatureGlyph, SECONDARY.color)),
      ],
      [
        "brightnessPercentage",
        {},
        cell("topLeft", shown(`${percentageOf(A)}%`, SECONDARY), iconIn(brightnessGlyph, SECONDARY.color)),
      ],
      ["brightnessLumen", {}, cell("topLeft", shown(`${A.state.lumen} lm`, SECONDARY))],
    ])("shows the %s in the text style chosen for its cell (#153)", async (item, options, slots) => {
      const dial = await topLeftOf(item, { ...options, style: "secondary" }, STYLES);

      expect(topLeft(dial)).toEqual(slots);
    });

    it("shows each of the power's states in the text style chosen for it (#153)", async () => {
      const dial = await topLeftOf("power", { onStyle: "secondary", offStyle: "primary" }, STYLES);

      expect(topLeft(dial)).toEqual(cell("topLeft", shown("ON", SECONDARY)));

      await screenOf(dial).tap();

      expect(topLeft(dial)).toEqual(cell("topLeft", shown("OFF", PRIMARY)));
    });

    it("shows a power state in its own color and weight at the Primary style's size (#153)", async () => {
      const dial = await topLeftOf("power", { onStyle: "custom", onColor: "#ff8800", onWeight: "bold" }, STYLES);

      expect(topLeft(dial)).toEqual(
        cell("topLeft", shown("ON", { color: "#ff8800", font: { size: 20, weight: 700 } })),
      );
    });

    it("keeps each item's options apart, so a cell's options for another item don't change how it shows this one", async () => {
      const dial = createFakeDial();
      changeGlobalSettings({ lampScreenOptions: { topLeft: { counter: { count: "count" } } } });
      await screenOf(dial).tap();

      expect(topLeft(dial)).toEqual(cell("topLeft", shown(A.label)));
    });

    it("keeps each cell's options apart", async () => {
      const dial = createFakeDial();
      changeGlobalSettings({
        lampScreenTopLeft: "counter",
        lampScreenOptions: { topLeft: { counter: { count: "count" } } },
      });
      await screenOf(dial).tap();

      expect(dial.setFeedback).toHaveBeenLastCalledWith(
        expect.objectContaining({ topLeft: shown("1"), topRight: shown("1 of 2") }),
      );
    });
  });

  describe("on identify", () => {
    it("blinks the lamp on the dial's screen", async () => {
      const dial = createFakeDial();
      vi.mocked(identifyLamp).mockResolvedValue({ ok: true, lampCount: 1, failures: 0 });
      await screenOf(dial).tap();
      await screenOf(dial).tap();

      await screenOf(dial).identify();

      expect(identifyLamp).toHaveBeenCalledExactlyOnceWith(B.id, BLINK_MS);
      expect(dial.showAlert).not.toHaveBeenCalled();
    });

    it("blinks for as long as the plugin settings say (#171)", async () => {
      const dial = createFakeDial();
      vi.mocked(identifyLamp).mockResolvedValue({ ok: true, lampCount: 1, failures: 0 });
      changeGlobalSettings({ identifyBlinkMs: 1000 });
      await screenOf(dial).tap();

      await screenOf(dial).identify();

      expect(identifyLamp).toHaveBeenCalledExactlyOnceWith(A.id, 1000);
    });

    it("shows an alert when the lamp can't be blinked", async () => {
      const dial = createFakeDial();
      vi.mocked(identifyLamp).mockResolvedValue({ ok: false, lampCount: 0, failures: 1 });
      await screenOf(dial).tap();

      await screenOf(dial).identify();

      expect(dial.showAlert).toHaveBeenCalledOnce();
    });

    it("does nothing on the main screen", async () => {
      const dial = createFakeDial();

      await screenOf(dial).identify();

      expect(identifyLamp).not.toHaveBeenCalled();
    });
  });

  describe("with the blink on (#144)", () => {
    beforeEach(() => {
      changeGlobalSettings({ blinkOnLampScreen: true });
      vi.mocked(identifyLamp).mockResolvedValue({ ok: true, lampCount: 1, failures: 0 });
    });

    it("blinks each lamp a tap shows, once its screen is drawn, and nothing on the way back to the main screen", async () => {
      const dial = createFakeDial();

      await screenOf(dial).tap();

      expect(identifyLamp).toHaveBeenCalledExactlyOnceWith(A.id, BLINK_MS);
      expect(at(dial.setFeedback.mock.invocationCallOrder, 0)).toBeLessThan(
        at(vi.mocked(identifyLamp).mock.invocationCallOrder, 0),
      );

      await screenOf(dial).tap();
      await screenOf(dial).tap();

      expect(vi.mocked(identifyLamp).mock.calls).toEqual([
        [A.id, BLINK_MS],
        [B.id, BLINK_MS],
      ]);
      expect(showMain).toHaveBeenCalledOnce();
    });

    it("makes a tap during a blink wait for it to end", async () => {
      const dial = createFakeDial();
      let endBlink: () => void = () => {};
      vi.mocked(identifyLamp).mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            endBlink = () => resolve({ ok: true, lampCount: 1, failures: 0 });
          }),
      );

      const first = screenOf(dial).tap();
      const second = screenOf(dial).tap();
      await vi.waitFor(() => expect(identifyLamp).toHaveBeenCalledOnce());

      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(lampScreenOf(A, 1, 2));

      endBlink();
      await Promise.all([first, second]);

      expect(dial.setFeedback).toHaveBeenLastCalledWith(lampScreenOf(B, 2, 2));
      expect(vi.mocked(identifyLamp).mock.calls).toEqual([
        [A.id, BLINK_MS],
        [B.id, BLINK_MS],
      ]);
    });

    it("shows an alert when the lamp can't be blinked, and stays on its screen", async () => {
      const dial = createFakeDial();
      vi.mocked(identifyLamp).mockResolvedValue({ ok: false, lampCount: 0, failures: 1 });

      await screenOf(dial).tap();

      expect(dial.showAlert).toHaveBeenCalledOnce();
      expect(screenOf(dial).lamp).toBe(A.id);
    });

    it("blinks nothing when a lamp screen is redrawn", async () => {
      const dial = createFakeDial();
      await screenOf(dial).tap();

      await refreshAll();

      expect(identifyLamp).toHaveBeenCalledOnce();
    });

    it("blinks nothing on a dial that chose otherwise, while the others still blink", async () => {
      const [dial, other] = [createFakeDial(), createFakeDial()];
      changeGlobalSettings({ blinkOnLampScreen: true, blinkOnLampScreenExceptions: [dial.id] });

      await screenOf(dial).tap();
      await screenOf(other).tap();

      expect(identifyLamp).toHaveBeenCalledExactlyOnceWith(A.id, BLINK_MS);
    });

    it("blinks for as long as the plugin settings say (#171)", async () => {
      const dial = createFakeDial();
      changeGlobalSettings({ blinkOnLampScreen: true, identifyBlinkMs: 1000 });

      await screenOf(dial).tap();

      expect(identifyLamp).toHaveBeenCalledExactlyOnceWith(A.id, 1000);
    });

    it("stops blinking once turned off", async () => {
      const dial = createFakeDial();
      await screenOf(dial).tap();

      changeGlobalSettings({ blinkOnLampScreen: false });
      await screenOf(dial).tap();

      expect(identifyLamp).toHaveBeenCalledExactlyOnceWith(A.id, BLINK_MS);
    });
  });

  describe("going back to the main screen", () => {
    it("doesn't happen on its own", async () => {
      vi.useFakeTimers();
      const dial = createFakeDial();
      await screenOf(dial).tap();

      await vi.advanceTimersByTimeAsync(60_000);
      vi.useRealTimers();

      expect(screenOf(dial).isShowing).toBe(true);
      expect(showMain).not.toHaveBeenCalled();
    });
  });

  describe("on a refresh", () => {
    it("redraws the lamp on each dial's screen from a fresh read, and leaves a main screen alone", async () => {
      const onA = createFakeDial();
      const onB = createFakeDial();
      const onMain = createFakeDial();
      await screenOf(onA).tap();
      await screenOf(onB).tap();
      await screenOf(onB).tap();
      const dimmedA = changed(A, { lumen: 30 });
      const turnedOnB = changed(B, { on: true });
      connect(dimmedA, turnedOnB);

      await refreshAll();
      await screenOf(onMain).refresh();

      expect(onA.setFeedback).toHaveBeenLastCalledWith(lampScreenOf(dimmedA, 1, 2));
      expect(onB.setFeedback).toHaveBeenLastCalledWith(lampScreenOf(turnedOnB, 2, 2));
      expect(onMain.setFeedback).not.toHaveBeenCalled();
    });

    it("shows the power of a lamp turned off in dark grey, and in white again once it's on", async () => {
      const dial = createFakeDial();
      await screenOf(dial).tap();

      connect(changed(A, { on: false }), B);
      await refreshAll();

      expect(dial.setFeedback).toHaveBeenLastCalledWith(
        expect.objectContaining({ topLeft: shown(A.label), middleRight: shown("OFF", OFF_POWER) }),
      );

      connect(A, B);
      await refreshAll();

      expect(dial.setFeedback).toHaveBeenLastCalledWith(expect.objectContaining({ middleRight: shown("ON") }));
    });

    it("shows what the plugin holds of the lamps, while a tap finds them first (#198)", async () => {
      const dial = createFakeDial();
      await screenOf(dial).tap();

      expect(findShownLamps).toHaveBeenCalledOnce();

      vi.mocked(findShownLamps).mockClear();
      await screenOf(dial).refresh();

      expect(findShownLamps).not.toHaveBeenCalled();
      expect(dial.setFeedback).toHaveBeenLastCalledWith(lampScreenOf(A, 1, 2));
    });

    it("doesn't read the lamps on the main screen, which the dial draws", async () => {
      await screenOf(createFakeDial()).refresh();

      expect(readShownLamps).not.toHaveBeenCalled();
      expect(showMain).not.toHaveBeenCalled();
    });

    it("sends a dial back to the main screen when its lamp is gone", async () => {
      const dial = createFakeDial();
      await screenOf(dial).tap();
      connect(B);

      await refreshAll();

      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith(MAIN_LAYOUT);
      expect(showMain).toHaveBeenCalledOnce();
    });
  });

  describe("when a dial appears", () => {
    it("starts it on the main screen, with the manifest's descriptions", async () => {
      const dial = createFakeDial();

      await screenOf(dial).appear();

      expect(dial.setFeedbackLayout).toHaveBeenCalledExactlyOnceWith(MAIN_LAYOUT);
      expect(dial.setTriggerDescription).toHaveBeenCalledExactlyOnceWith();
    });

    it("forgets the lamp it showed, which a refresh then leaves alone", async () => {
      const dial = createFakeDial();
      await screenOf(dial).tap();

      await screenOf(dial).appear();
      await screenOf(dial).refresh();

      expect(screenOf(dial).isShowing).toBe(false);
      // The refresh had no lamp screen left to redraw.
      expect(readShownLamps).toHaveBeenCalledOnce();
    });
  });
});
