import type { TouchTapEvent } from "@elgato/streamdeck";

import { identifyLamp, type LampStatus, onLampsChanged, readLampStatuses } from "../litra-manager";
import { logger as pluginLogger } from "../logging";
import {
  blinksOnLampScreen,
  identifyBlinkMs,
  type LampScreenCellContent,
  lampName,
  lampScreenCells,
  onGlobalSettingsChanged,
} from "./global-settings";
import { LAMP_SCREEN_CELLS, type LampScreenCell, type LampScreenItem, type LampScreenItemOptions } from "./settings";

/** What the lamp screens use of a dial, whichever action it belongs to. */
export type LampScreenDial = Pick<
  TouchTapEvent["action"],
  "id" | "setFeedback" | "setFeedbackLayout" | "setTriggerDescription" | "showAlert"
>;

/** What only a dial's action knows: how to draw its main screen, and what turning the dial adjusts. */
export type DialOwner = {
  showMain: () => Promise<void>;
  /** What turning the dial adjusts, which the app shows as the description of a turn. */
  adjusts: string;
};

type Screen = {
  dial: LampScreenDial;
  serialNumber: string;
  /** The lamp's id, which the operations on it take. */
  id: string;
  owner: DialOwner;
};

const logger = pluginLogger.createScope("Lamp screens");

export const MAIN_LAYOUT = "$B1";
const LAMP_LAYOUT = "layouts/lamp.json";

// The gestures on a lamp screen act on its lamp alone (#20).
const LAMP_TRIGGER_DESCRIPTIONS = { push: "Power", touch: "Next lamp", longTouch: "Identify" };

/**
 * The lamp screens of every Brightness and Temperature dial (#48). Tapping a dial's strip shows each lamp in turn, in
 * the order of their serial numbers, then the dial's main screen again. A dial stays on a lamp screen until it's tapped
 * past the last lamp, and while it's there, its action turns and toggles that lamp alone (#20). Each dial remembers the
 * serial of the lamp it shows rather than its position, so a lamp unplugged mid-cycle is skipped and "n of m" counts
 * the lamps connected at that moment.
 *
 * With the blink on, which the dials share as a global setting, a tap that shows a lamp also blinks it, so tapping
 * through the lamps shows which one the dial is about to adjust (#144).
 *
 * What each of a lamp screen's six cells shows is a global setting, the same on every dial (#177).
 *
 * Every dial shares one instance, which redraws every lamp screen whenever the lamps change, whichever action changed
 * them, and whenever the global settings do. Operations run one at a time, since each reads the lamps and changes what a dial shows, and never reject:
 * failures are logged. A blink is part of the operation that asked for it, so a tap during a blink waits for it to end.
 */
export class LampScreens {
  private readonly screens = new Map<string, Screen>();
  private queue: Promise<void> = Promise.resolve();

  /** Subscribes to every change made to the lamps, and to the global settings, to redraw the lamp screens. */
  constructor() {
    onLampsChanged(() => this.refresh());
    onGlobalSettingsChanged(() => this.refresh());
  }

  /** Whether a dial is on a lamp screen rather than its main screen. */
  isShowing(dialId: string): boolean {
    return this.screens.has(dialId);
  }

  /** The id of the lamp on a dial's screen, or undefined on its main screen. */
  lampOnScreen(dialId: string): string | undefined {
    return this.screens.get(dialId)?.id;
  }

  /**
   * Shows the lamp after the one on screen, the first lamp from the main screen, and the main screen after the last.
   * With the blink on for the dial, the lamp shown blinks once it's drawn.
   */
  tap(dial: LampScreenDial, owner: DialOwner): Promise<void> {
    return this.enqueue(async () => {
      const { lamps } = await readLampStatuses();
      const current = this.screens.get(dial.id)?.serialNumber;
      if (current === undefined && lamps.length === 0) {
        await dial.showAlert();
        return;
      }
      const next = current === undefined ? lamps[0] : lamps.find((lamp) => lamp.serialNumber > current);
      if (next === undefined) {
        await this.backToMain(dial.id);
        return;
      }
      await this.show(dial, next, lamps, owner);
      if (blinksOnLampScreen(dial.id)) {
        await blink(dial, next.id);
      }
    });
  }

  /** Blinks the lamp on a dial's screen, so the user can tell which one it is. */
  identify(dial: LampScreenDial): Promise<void> {
    return this.enqueue(async () => {
      const screen = this.screens.get(dial.id);
      if (screen === undefined) {
        return;
      }
      await blink(dial, screen.id);
    });
  }

  /** Redraws every lamp screen from a fresh read. */
  refresh(): Promise<void> {
    return this.enqueue(async () => {
      if (this.screens.size === 0) {
        return;
      }
      const { lamps } = await readLampStatuses();
      for (const [dialId, screen] of [...this.screens]) {
        const lamp = lamps.find((candidate) => candidate.serialNumber === screen.serialNumber);
        if (lamp === undefined) {
          await this.backToMain(dialId);
        } else {
          await draw(screen.dial, lamp, lamps);
        }
      }
    });
  }

  /**
   * Starts a dial that appears on the main screen. Stream Deck may keep the layout a dial had when it disappeared, or
   * when the plugin stopped.
   */
  appear(dial: LampScreenDial): Promise<void> {
    return this.enqueue(async () => {
      this.screens.delete(dial.id);
      await dial.setFeedbackLayout(MAIN_LAYOUT);
      await dial.setTriggerDescription();
    });
  }

  /** Forgets a dial that is no longer shown, so it isn't redrawn. */
  disappear(dialId: string): Promise<void> {
    return this.enqueue(async () => {
      this.screens.delete(dialId);
    });
  }

  /** Runs an operation after the ones before it, and logs it if it fails, so the queue carries on. */
  private enqueue(operation: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(operation).catch((error: unknown) => {
      logger.error("Lamp screen update failed", error);
    });
    return this.queue;
  }

  /** Draws a lamp on a dial, switching it to the lamp layout first if it was on its main screen. */
  private async show(dial: LampScreenDial, lamp: LampStatus, lamps: LampStatus[], owner: DialOwner): Promise<void> {
    const wasShowing = this.screens.has(dial.id);
    this.screens.set(dial.id, { dial, serialNumber: lamp.serialNumber, id: lamp.id, owner });
    if (!wasShowing) {
      await dial.setFeedbackLayout(LAMP_LAYOUT);
      await dial.setTriggerDescription({ rotate: owner.adjusts, ...LAMP_TRIGGER_DESCRIPTIONS });
    }
    await draw(dial, lamp, lamps);
  }

  /** Switches a dial back to the main layout and lets its action draw it. Does nothing on the main screen. */
  private async backToMain(dialId: string): Promise<void> {
    const screen = this.screens.get(dialId);
    if (screen === undefined) {
      return;
    }
    this.screens.delete(dialId);
    await screen.dial.setFeedbackLayout(MAIN_LAYOUT);
    await screen.dial.setTriggerDescription();
    await screen.owner.showMain();
  }
}

// Every text on a lamp screen is 18 px, white by default on the strip's own background. By default, "OFF" stands out in
// dark grey. Bold makes dark text read on a bright background, though the font joins the "ff" of "Off" into one shape
// (#153), so it's left to the options.
const FONT_SIZE = 18;
const PLAIN = { color: "#ffffff", font: { size: FONT_SIZE, weight: 400 } };

// The icons of the items that can show one, wherever they're shown: the lumens share the brightness's sun (#177).
const ICONS: Partial<Record<LampScreenItem, string>> = {
  temperature: "imgs/actions/temperature/glyph@2x.png",
  brightnessPercentage: "imgs/actions/brightness/glyph@2x.png",
  brightnessLumen: "imgs/actions/brightness/glyph@2x.png",
};

// What a counter puts between the lamp's place and the count, by format.
const COUNTER_SEPARATORS = { of: " of ", slash: "/", dash: "-", space: " " };

// The characters a trimmed identification keeps, its "…" included: about as many as fit in half a row at 18 px.
const TRIMMED_LENGTH = 10;

/** Blinks a lamp, by its id, and shows an alert on the dial when it can't. */
async function blink(dial: LampScreenDial, lampId: string): Promise<void> {
  const result = await identifyLamp(lampId, identifyBlinkMs());
  if (!result.ok) {
    await dial.showAlert();
  }
}

/** What a cell shows: its text, with its look, and its icon and the side it's on, if it has one. */
type Shown = { text: { value: string; color: string; font: { size: number; weight: number } }; icon?: Icon };
type Icon = { path: string; side: "outer" | "inner" };

/** What a cell shows for a lamp, or undefined for a cell that shows nothing. */
function shownIn(content: LampScreenCellContent, lamp: LampStatus, lamps: LampStatus[]): Shown | undefined {
  switch (content.item) {
    case "identification":
      return { text: { value: identification(content.options, lamp), ...PLAIN } };
    case "counter":
      return { text: { value: counter(content.options, lamp, lamps), ...PLAIN } };
    case "temperature":
      return measure(content, `${lamp.temperatureKelvin}`, " K");
    case "power":
      return { text: power(content.options, lamp.on) };
    case "brightnessPercentage":
      return measure(content, `${lamp.brightnessPercentage}`, "%");
    case "brightnessLumen":
      return measure(content, `${lamp.brightnessLumen}`, " lm");
    case "none":
      return undefined;
  }
}

/**
 * A lamp's identification, made of up to two parts joined by " - ": its model, the end of its serial number, or its
 * name, which falls back to its model and the end of its serial number, as the keys' settings pages show a lamp with no
 * name (#20). A part with no text, such as the serial of a Beam LX, which reports none (#170), is left out. When
 * neither chosen part has text, the lamp shows its model.
 */
function identification(options: LampScreenItemOptions["identification"], lamp: LampStatus): string {
  const partOf = (part: typeof options.first): string => {
    switch (part) {
      case "model":
        return lamp.model;
      case "id":
        return lamp.serialNumber.slice(-4);
      case "name":
        return lampName(lamp.id) ?? lamp.label;
      case "empty":
        return "";
    }
  };
  const parts = [partOf(options.first), partOf(options.second)].filter((part) => part !== "");
  const chosen = options.first !== "empty" || options.second !== "empty";
  const text = parts.length > 0 ? parts.join(" - ") : chosen ? lamp.model : "";
  return options.trim ? trimmed(text) : text;
}

/** A text cut to TRIMMED_LENGTH characters, ending in "…", or as it is when it's short enough. */
function trimmed(text: string): string {
  const characters = Array.from(text);
  return characters.length > TRIMMED_LENGTH ? `${characters.slice(0, TRIMMED_LENGTH - 1).join("")}…` : text;
}

/** A lamp's place among the lamps, or among the lamps of its model, alone or with their count. */
function counter(options: LampScreenItemOptions["counter"], lamp: LampStatus, lamps: LampStatus[]): string {
  const among = options.count === "countByModel" ? lamps.filter((other) => other.model === lamp.model) : lamps;
  const place = among.indexOf(lamp) + 1;
  return options.count === "count" ? `${place}` : `${place}${COUNTER_SEPARATORS[options.format]}${among.length}`;
}

/** A measure with its unit, if it shows one, and its icon on the side chosen, if it shows one. */
function measure(
  content: Extract<LampScreenCellContent, { item: "temperature" | "brightnessPercentage" | "brightnessLumen" }>,
  value: string,
  unit: string,
): Shown {
  const { icon, unit: withUnit, iconSide } = content.options;
  const path = ICONS[content.item];
  const text = { value: withUnit ? `${value}${unit}` : value, ...PLAIN };
  return icon && path !== undefined ? { text, icon: { path, side: iconSide } } : { text };
}

/** Whether a lamp is on, with the label, color and weight chosen for its state. */
function power(options: LampScreenItemOptions["power"], on: boolean): Shown["text"] {
  const [value, color, weight] = on
    ? [options.onLabel, options.onColor, options.onWeight]
    : [options.offLabel, options.offColor, options.offWeight];
  return { value, color, font: { size: FONT_SIZE, weight: weight === "bold" ? 700 : 400 } };
}

/**
 * The slots of one cell of the lamp layout, each spanning its row or placed at a fixed point, since a slot can't move
 * (#177): an icon on the cell's outer edge, with a text beside it, an icon on its inner edge, at the middle of the row,
 * with a text beside it, and a text with no icon, aligned to the cell's side. The cell shows the slots its item needs,
 * and hides the others. Every slot is given its whole look each time, since a slot keeps what it was given.
 */
function cellSlots(cell: LampScreenCell, shown: Shown | undefined) {
  const hidden = { value: "", enabled: false };
  const text = shown === undefined ? hidden : { ...shown.text, enabled: true };
  const side = shown?.icon?.side;
  const icon = (at: Icon["side"]) =>
    shown?.icon !== undefined && side === at ? { value: shown.icon.path, enabled: true } : { enabled: false };
  return {
    [`${cell}OuterIcon`]: icon("outer"),
    [`${cell}BesideOuterIcon`]: side === "outer" ? text : hidden,
    [`${cell}InnerIcon`]: icon("inner"),
    [`${cell}BesideInnerIcon`]: side === "inner" ? text : hidden,
    [cell]: side === undefined ? text : hidden,
  };
}

/** Fills the slots of the lamp layout, each cell with what the global settings give it, and how (#177). */
async function draw(dial: LampScreenDial, lamp: LampStatus, lamps: LampStatus[]): Promise<void> {
  const cells = lampScreenCells();
  await dial.setFeedback(
    Object.assign({}, ...LAMP_SCREEN_CELLS.map((cell) => cellSlots(cell, shownIn(cells[cell], lamp, lamps)))),
  );
}

/** The lamp screens every action shares. */
export const lampScreens = new LampScreens();
