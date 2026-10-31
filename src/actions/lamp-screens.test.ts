import { brightnessGlyph, svgDoc, temperatureGlyph } from "@daczarne/streamdeck-icons";
import type { JsonObject } from "@elgato/utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { identifyLamp, type LampStatus, onLampsChanged, readLampStatuses } from "../litra-manager";
import { logger } from "../logging";
import { at } from "../test-support/at";
import { changeGlobalSettings, createFakeDial } from "../test-support/fake-stream-deck";
import { followGlobalSettings, onGlobalSettingsChanged } from "./global-settings";
import { type DialOwner, LampScreens, MAIN_LAYOUT } from "./lamp-screens";
import { globalSettings } from "./settings";

//* Fakes

// The real SDK opens a connection to Stream Deck. The fake carries the global settings, which hold the blink.
vi.mock("@elgato/streamdeck", () => import("../test-support/fake-stream-deck"));

// The real logger writes to a logs/ folder.
vi.mock("../logging", () => import("../test-support/fake-logging"));

// The global settings are the real ones, followed from the fake SDK, but the listeners each instance registers are
// kept by the mock, so the instances of earlier tests don't redraw.
vi.mock("./global-settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./global-settings")>()),
  onGlobalSettingsChanged: vi.fn(),
}));

// The real litra-manager loads node-hid's native binary on import and talks to real lamps.
vi.mock("../litra-manager", () => ({
  identifyLamp: vi.fn(),
  onLampsChanged: vi.fn(),
  readLampStatuses: vi.fn(),
}));

const LAMP_LAYOUT = "layouts/lamp.json";

// How long a blink lasts unless the plugin settings say otherwise.
const BLINK_MS = globalSettings.identifyBlinkMs.default;

/** A Beam on a Stream Deck + XL's USB hub, at its cap. */
function beam(serialNumber: string, overrides: Partial<LampStatus> = {}): LampStatus {
  return {
    id: `lamp-${serialNumber}`,
    serialNumber,
    model: "Beam",
    label: `Beam - ${serialNumber}`,
    on: true,
    brightnessLumen: 324,
    brightnessPercentage: 79,
    temperatureKelvin: 2700,
    ...overrides,
  };
}

/** Connects the lamps, which readLampStatuses reports sorted by serial number. */
function connect(...lamps: LampStatus[]): void {
  vi.mocked(readLampStatuses).mockResolvedValue({ ok: lamps.length > 0, lamps });
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
function lampScreenOf(lamp: LampStatus, position: number, count: number) {
  return {
    ...cell("topLeft", shown(lamp.label)),
    ...cell("topRight", shown(`${position} of ${count}`)),
    ...cell("middleLeft", shown(`${lamp.temperatureKelvin} K`), THERMOMETER),
    ...cell("middleRight", lamp.on ? shown("ON") : shown("OFF", OFF_POWER)),
    ...cell("bottomLeft", shown(`${lamp.brightnessPercentage}%`), SUN),
    ...cell("bottomRight", shown(`${lamp.brightnessLumen} lm`)),
  };
}

const A = beam("A1");
const B = beam("B2", { on: false, brightnessLumen: 30, brightnessPercentage: 0, temperatureKelvin: 6500 });
const C = beam("C3");

let screens: LampScreens;
let showMain: () => Promise<void>;
let owner: DialOwner;

// The blink of the lamp screens is a global setting, which the tests change as a settings page does (#144).
followGlobalSettings();

beforeEach(() => {
  changeGlobalSettings({});
  screens = new LampScreens();
  showMain = vi.fn(async () => {});
  owner = { showMain, adjusts: "Brightness" };
  connect(A, B);
});

//* Tests

describe("LampScreens", () => {
  describe("on a tap", () => {
    it("shows the first lamp from the main screen, on the lamp layout", async () => {
      const dial = createFakeDial();

      await screens.tap(dial, owner);

      expect(dial.setFeedbackLayout).toHaveBeenCalledExactlyOnceWith(LAMP_LAYOUT);
      expect(dial.setTriggerDescription).toHaveBeenCalledExactlyOnceWith({
        rotate: "Brightness",
        push: "Power",
        touch: "Next lamp",
        longTouch: "Identify",
      });
      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(lampScreenOf(A, 1, 2));
      expect(screens.isShowing(dial.id)).toBe(true);
      expect(screens.lampOnScreen(dial.id)).toBe(A.id);
      // The blink is off by default (#144).
      expect(identifyLamp).not.toHaveBeenCalled();
    });

    it("goes through every lamp, then back to the main screen", async () => {
      const dial = createFakeDial();

      await screens.tap(dial, owner);
      await screens.tap(dial, owner);

      // The layout only changes when the dial leaves the main screen.
      expect(dial.setFeedbackLayout).toHaveBeenCalledOnce();
      expect(dial.setFeedback).toHaveBeenLastCalledWith(lampScreenOf(B, 2, 2));

      await screens.tap(dial, owner);

      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith(MAIN_LAYOUT);
      expect(dial.setTriggerDescription).toHaveBeenLastCalledWith();
      expect(showMain).toHaveBeenCalledOnce();
      expect(screens.isShowing(dial.id)).toBe(false);
      expect(screens.lampOnScreen(dial.id)).toBeUndefined();
    });

    it("skips a lamp unplugged since the last tap", async () => {
      const dial = createFakeDial();
      connect(A, B, C);
      await screens.tap(dial, owner);
      await screens.tap(dial, owner);
      connect(A, C);

      await screens.tap(dial, owner);

      expect(dial.setFeedback).toHaveBeenLastCalledWith(lampScreenOf(C, 2, 2));
    });

    it("goes back to the main screen when no lamp comes after the one unplugged", async () => {
      const dial = createFakeDial();
      await screens.tap(dial, owner);
      await screens.tap(dial, owner);
      connect(A);

      await screens.tap(dial, owner);

      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith(MAIN_LAYOUT);
      expect(showMain).toHaveBeenCalledOnce();
    });

    it("shows an alert and stays on the main screen when no lamp is connected", async () => {
      const dial = createFakeDial();
      connect();

      await screens.tap(dial, owner);

      expect(dial.showAlert).toHaveBeenCalledOnce();
      expect(dial.setFeedbackLayout).not.toHaveBeenCalled();
      expect(screens.isShowing(dial.id)).toBe(false);
    });

    it("handles quick taps one at a time, in order", async () => {
      const dial = createFakeDial();

      await Promise.all([screens.tap(dial, owner), screens.tap(dial, owner)]);

      expect(dial.setFeedback.mock.calls).toEqual([[lampScreenOf(A, 1, 2)], [lampScreenOf(B, 2, 2)]]);
    });

    it("logs a failed read instead of failing", async () => {
      const dial = createFakeDial();
      vi.mocked(readLampStatuses).mockRejectedValueOnce(new Error("HID read failed"));

      await screens.tap(dial, owner);
      await screens.tap(dial, owner);

      expect(logger.error).toHaveBeenCalledOnce();
      // A failure doesn't hold up the next tap.
      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith(lampScreenOf(A, 1, 2));
    });

    it("leaves the other dials as they are", async () => {
      const dial = createFakeDial();
      const otherDial = createFakeDial();

      await screens.tap(dial, owner);

      expect(screens.isShowing(otherDial.id)).toBe(false);
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

      await screens.tap(dial, owner);

      expect(dial.setFeedback).toHaveBeenCalledExactlyOnceWith({
        ...cell("topLeft", shown("ON")),
        ...cell("topRight", shown(`${A.temperatureKelvin} K`), THERMOMETER),
        ...cell("middleLeft"),
        ...cell("middleRight", shown(`${A.brightnessPercentage}%`), SUN),
        ...cell("bottomLeft", shown(`${A.brightnessLumen} lm`)),
        ...cell("bottomRight", shown(A.label)),
      });
    });

    it("shows the same in several cells", async () => {
      const dial = createFakeDial();
      changeGlobalSettings({ lampScreenTopLeft: "counter", lampScreenTopRight: "counter" });

      await screens.tap(dial, owner);

      expect(dial.setFeedback).toHaveBeenCalledWith(
        expect.objectContaining({ topLeft: shown("1 of 2"), topRight: shown("1 of 2") }),
      );
    });

    it("redraws the lamp screens on show when they change", async () => {
      const dial = createFakeDial();
      await screens.tap(dial, owner);

      changeGlobalSettings({ lampScreenBottomRight: "none" });
      const globalSettingsChanged = vi.mocked(onGlobalSettingsChanged).mock.lastCall?.[0];
      await globalSettingsChanged?.();

      expect(dial.setFeedback).toHaveBeenLastCalledWith({ ...lampScreenOf(A, 1, 2), ...cell("bottomRight") });
    });
  });

  describe("with each cell's options (#177)", () => {
    /** Taps a new dial to the first lamp's screen, with the top left cell showing `item`, as `options` say. */
    async function topLeftOf(item: string, options: JsonObject, others: JsonObject = {}) {
      const dial = createFakeDial();
      changeGlobalSettings({ lampScreenTopLeft: item, lampScreenOptions: { topLeft: { [item]: options } }, ...others });
      await screens.tap(dial, owner);
      return dial;
    }

    /** What the top left cell of a dial was last told to show. */
    function topLeft(dial: ReturnType<typeof createFakeDial>) {
      const slots = at(dial.setFeedback.mock.calls, -1)[0] as Record<string, unknown>;
      return Object.fromEntries(Object.entries(slots).filter(([slot]) => slot.startsWith("topLeft")));
    }

    it.each([
      [{ first: "name", second: "empty" }, "Key light"],
      [{ first: "name", second: "id" }, "Key light - A1"],
      [{ first: "id", second: "model" }, "A1 - Beam"],
      [{ first: "empty", second: "model" }, "Beam"],
    ])("builds the identification from its parts, %o", async (options, text) => {
      const dial = await topLeftOf("identification", options, { lampNames: { [A.id]: "Key light" } });

      expect(topLeft(dial)).toEqual(cell("topLeft", shown(text)));
    });

    it("shows the model and the end of the serial number for the name of a lamp with none", async () => {
      const dial = await topLeftOf("identification", { first: "name", second: "empty" });

      expect(topLeft(dial)).toEqual(cell("topLeft", shown(A.label)));
    });

    it("leaves out the ID of a lamp that reports no serial number, and shows its model when nothing else is left", async () => {
      const lx = beam("", { model: "Beam LX", label: "Beam LX - " });
      connect(lx, A);

      const withModel = await topLeftOf("identification", { first: "model", second: "id" });
      const alone = await topLeftOf("identification", { first: "id", second: "empty" });

      expect(topLeft(withModel)).toEqual(cell("topLeft", shown("Beam LX")));
      expect(topLeft(alone)).toEqual(cell("topLeft", shown("Beam LX")));
    });

    it("shows nothing for an identification with both parts empty", async () => {
      const dial = await topLeftOf("identification", { first: "empty", second: "empty" });

      expect(topLeft(dial)).toEqual(cell("topLeft", shown("")));
    });

    it("trims a long identification to 10 characters, ending in …, and leaves a short one as it is", async () => {
      const names = { lampNames: { [A.id]: "Studio key light", [B.id]: "Key light" } };
      const dial = await topLeftOf("identification", { first: "name", second: "empty", trim: true }, names);

      expect(topLeft(dial)).toEqual(cell("topLeft", shown("Studio ke…")));

      await screens.tap(dial, owner);

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
      const lx = beam("C3", { model: "Beam LX" });
      connect(A, B, lx);
      const dial = await topLeftOf("counter", { count: "countByModel" });
      await screens.tap(dial, owner);

      expect(topLeft(dial)).toEqual(cell("topLeft", shown("2 of 2")));

      await screens.tap(dial, owner);

      expect(topLeft(dial)).toEqual(cell("topLeft", shown("1 of 1")));
    });

    it.each([
      ["temperature", { unit: false }, cell("topLeft", shown(`${A.temperatureKelvin}`), THERMOMETER)],
      ["temperature", { icon: false }, cell("topLeft", shown(`${A.temperatureKelvin} K`))],
      ["brightnessPercentage", { unit: false }, cell("topLeft", shown(`${A.brightnessPercentage}`), SUN)],
      ["brightnessLumen", {}, cell("topLeft", shown(`${A.brightnessLumen} lm`))],
      ["brightnessLumen", { icon: true }, cell("topLeft", shown(`${A.brightnessLumen} lm`), SUN)],
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

      await screens.tap(dial, owner);

      expect(topLeft(dial)).toEqual(cell("topLeft", shown("O", { color: "#00aaff", font: { size: 18, weight: 400 } })));
    });

    it("draws every text in the Primary style, and the power's OFF in the Secondary style (#153)", async () => {
      const dial = createFakeDial();
      changeGlobalSettings(STYLES);
      await screens.tap(dial, owner);

      expect(dial.setFeedback).toHaveBeenLastCalledWith(
        expect.objectContaining({
          topLeft: shown(A.label, PRIMARY),
          middleLeftBesideIcon: shown(`${A.temperatureKelvin} K`, PRIMARY),
          middleRight: shown("ON", PRIMARY),
          bottomRight: shown(`${A.brightnessLumen} lm`, PRIMARY),
        }),
      );

      await screens.tap(dial, owner);

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
        cell("topLeft", shown(`${A.temperatureKelvin} K`, SECONDARY), iconIn(temperatureGlyph, SECONDARY.color)),
      ],
      [
        "brightnessPercentage",
        {},
        cell("topLeft", shown(`${A.brightnessPercentage}%`, SECONDARY), iconIn(brightnessGlyph, SECONDARY.color)),
      ],
      ["brightnessLumen", {}, cell("topLeft", shown(`${A.brightnessLumen} lm`, SECONDARY))],
    ])("shows the %s in the text style chosen for its cell (#153)", async (item, options, slots) => {
      const dial = await topLeftOf(item, { ...options, style: "secondary" }, STYLES);

      expect(topLeft(dial)).toEqual(slots);
    });

    it("shows each of the power's states in the text style chosen for it (#153)", async () => {
      const dial = await topLeftOf("power", { onStyle: "secondary", offStyle: "primary" }, STYLES);

      expect(topLeft(dial)).toEqual(cell("topLeft", shown("ON", SECONDARY)));

      await screens.tap(dial, owner);

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
      await screens.tap(dial, owner);

      expect(topLeft(dial)).toEqual(cell("topLeft", shown(A.label)));
    });

    it("keeps each cell's options apart", async () => {
      const dial = createFakeDial();
      changeGlobalSettings({
        lampScreenTopLeft: "counter",
        lampScreenOptions: { topLeft: { counter: { count: "count" } } },
      });
      await screens.tap(dial, owner);

      expect(dial.setFeedback).toHaveBeenLastCalledWith(
        expect.objectContaining({ topLeft: shown("1"), topRight: shown("1 of 2") }),
      );
    });
  });

  describe("on identify", () => {
    it("blinks the lamp on the dial's screen", async () => {
      const dial = createFakeDial();
      vi.mocked(identifyLamp).mockResolvedValue({ ok: true, deviceCount: 1, failures: 0 });
      await screens.tap(dial, owner);
      await screens.tap(dial, owner);

      await screens.identify(dial);

      expect(identifyLamp).toHaveBeenCalledExactlyOnceWith(B.id, BLINK_MS);
      expect(dial.showAlert).not.toHaveBeenCalled();
    });

    it("blinks for as long as the plugin settings say (#171)", async () => {
      const dial = createFakeDial();
      vi.mocked(identifyLamp).mockResolvedValue({ ok: true, deviceCount: 1, failures: 0 });
      changeGlobalSettings({ identifyBlinkMs: 1000 });
      await screens.tap(dial, owner);

      await screens.identify(dial);

      expect(identifyLamp).toHaveBeenCalledExactlyOnceWith(A.id, 1000);
    });

    it("shows an alert when the lamp can't be blinked", async () => {
      const dial = createFakeDial();
      vi.mocked(identifyLamp).mockResolvedValue({ ok: false, deviceCount: 0, failures: 1 });
      await screens.tap(dial, owner);

      await screens.identify(dial);

      expect(dial.showAlert).toHaveBeenCalledOnce();
    });

    it("does nothing on the main screen", async () => {
      const dial = createFakeDial();

      await screens.identify(dial);

      expect(identifyLamp).not.toHaveBeenCalled();
    });
  });

  describe("with the blink on (#144)", () => {
    beforeEach(() => {
      changeGlobalSettings({ blinkOnLampScreen: true });
      vi.mocked(identifyLamp).mockResolvedValue({ ok: true, deviceCount: 1, failures: 0 });
    });

    it("blinks each lamp a tap shows, once its screen is drawn, and nothing on the way back to the main screen", async () => {
      const dial = createFakeDial();

      await screens.tap(dial, owner);

      expect(identifyLamp).toHaveBeenCalledExactlyOnceWith(A.id, BLINK_MS);
      expect(at(dial.setFeedback.mock.invocationCallOrder, 0)).toBeLessThan(
        at(vi.mocked(identifyLamp).mock.invocationCallOrder, 0),
      );

      await screens.tap(dial, owner);
      await screens.tap(dial, owner);

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
            endBlink = () => resolve({ ok: true, deviceCount: 1, failures: 0 });
          }),
      );

      const first = screens.tap(dial, owner);
      const second = screens.tap(dial, owner);
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
      vi.mocked(identifyLamp).mockResolvedValue({ ok: false, deviceCount: 0, failures: 1 });

      await screens.tap(dial, owner);

      expect(dial.showAlert).toHaveBeenCalledOnce();
      expect(screens.lampOnScreen(dial.id)).toBe(A.id);
    });

    it("blinks nothing when a lamp screen is redrawn", async () => {
      const dial = createFakeDial();
      await screens.tap(dial, owner);

      await screens.refresh();

      expect(identifyLamp).toHaveBeenCalledOnce();
    });

    it("blinks nothing on a dial that chose otherwise, while the others still blink", async () => {
      const [dial, other] = [createFakeDial(), createFakeDial()];
      changeGlobalSettings({ blinkOnLampScreen: true, blinkOnLampScreenExceptions: [dial.id] });

      await screens.tap(dial, owner);
      await screens.tap(other, owner);

      expect(identifyLamp).toHaveBeenCalledExactlyOnceWith(A.id, BLINK_MS);
    });

    it("blinks for as long as the plugin settings say (#171)", async () => {
      const dial = createFakeDial();
      changeGlobalSettings({ blinkOnLampScreen: true, identifyBlinkMs: 1000 });

      await screens.tap(dial, owner);

      expect(identifyLamp).toHaveBeenCalledExactlyOnceWith(A.id, 1000);
    });

    it("stops blinking once turned off", async () => {
      const dial = createFakeDial();
      await screens.tap(dial, owner);

      changeGlobalSettings({ blinkOnLampScreen: false });
      await screens.tap(dial, owner);

      expect(identifyLamp).toHaveBeenCalledExactlyOnceWith(A.id, BLINK_MS);
    });
  });

  describe("going back to the main screen", () => {
    it("doesn't happen on its own", async () => {
      vi.useFakeTimers();
      const dial = createFakeDial();
      await screens.tap(dial, owner);

      await vi.advanceTimersByTimeAsync(60_000);
      vi.useRealTimers();

      expect(screens.isShowing(dial.id)).toBe(true);
      expect(showMain).not.toHaveBeenCalled();
    });
  });

  describe("on a refresh", () => {
    it("redraws every lamp screen from a fresh read, and leaves the main screens alone", async () => {
      const onA = createFakeDial();
      const onB = createFakeDial();
      const onMain = createFakeDial();
      await screens.tap(onA, owner);
      await screens.tap(onB, owner);
      await screens.tap(onB, owner);
      const dimmedA = { ...A, brightnessLumen: 30, brightnessPercentage: 0 };
      const turnedOnB = { ...B, on: true };
      connect(dimmedA, turnedOnB);

      await screens.refresh();

      expect(onA.setFeedback).toHaveBeenLastCalledWith(lampScreenOf(dimmedA, 1, 2));
      expect(onB.setFeedback).toHaveBeenLastCalledWith(lampScreenOf(turnedOnB, 2, 2));
      expect(onMain.setFeedback).not.toHaveBeenCalled();
    });

    it("happens whenever the lamps change, whichever action changed them", async () => {
      const dial = createFakeDial();
      await screens.tap(dial, owner);
      const lampsChanged = vi.mocked(onLampsChanged).mock.lastCall?.[0];
      const turnedOffA = { ...A, on: false };
      connect(turnedOffA, B);

      await lampsChanged?.();

      expect(dial.setFeedback).toHaveBeenLastCalledWith(lampScreenOf(turnedOffA, 1, 2));
    });

    it("shows the power of a lamp turned off in dark grey, and in white again once it's on", async () => {
      const dial = createFakeDial();
      await screens.tap(dial, owner);

      connect({ ...A, on: false }, B);
      await screens.refresh();

      expect(dial.setFeedback).toHaveBeenLastCalledWith(
        expect.objectContaining({ topLeft: shown(A.label), middleRight: shown("OFF", OFF_POWER) }),
      );

      connect(A, B);
      await screens.refresh();

      expect(dial.setFeedback).toHaveBeenLastCalledWith(expect.objectContaining({ middleRight: shown("ON") }));
    });

    it("doesn't read the lamps when no dial shows a lamp screen", async () => {
      await screens.refresh();

      expect(readLampStatuses).not.toHaveBeenCalled();
    });

    it("sends a dial back to the main screen when its lamp is gone", async () => {
      const dial = createFakeDial();
      await screens.tap(dial, owner);
      connect(B);

      await screens.refresh();

      expect(dial.setFeedbackLayout).toHaveBeenLastCalledWith(MAIN_LAYOUT);
      expect(showMain).toHaveBeenCalledOnce();
    });
  });

  describe("when a dial appears or disappears", () => {
    it("starts a dial that appears on the main screen, with the manifest's descriptions", async () => {
      const dial = createFakeDial();

      await screens.appear(dial);

      expect(dial.setFeedbackLayout).toHaveBeenCalledExactlyOnceWith(MAIN_LAYOUT);
      expect(dial.setTriggerDescription).toHaveBeenCalledExactlyOnceWith();
    });

    it.each([
      ["appears again", (dial: ReturnType<typeof createFakeDial>) => screens.appear(dial)],
      ["disappears", (dial: ReturnType<typeof createFakeDial>) => screens.disappear(dial.id)],
    ])("forgets the lamp screen of a dial that %s", async (_, event) => {
      const dial = createFakeDial();
      await screens.tap(dial, owner);

      await event(dial);
      await screens.refresh();

      expect(screens.isShowing(dial.id)).toBe(false);
      // The refresh had no lamp screen left to redraw.
      expect(readLampStatuses).toHaveBeenCalledOnce();
    });
  });
});
