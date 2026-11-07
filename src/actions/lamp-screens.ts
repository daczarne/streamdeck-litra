import { brightnessGlyph, svgDoc, temperatureGlyph } from "@daczarne/streamdeck-icons";
import type { TouchTapEvent } from "@elgato/streamdeck";

import {
  FONT_WEIGHTS,
  globalSettings,
  type LampScreenCellContent,
  type TextStyle,
  type TextStyles,
} from "../global-settings";
import { Lamp, type ReachedLamp } from "../lamp";
import { byId } from "../lamp-order";
import { identifyLamp } from "../litra-manager";
import { logger as pluginLogger } from "../logging";
import { LAMP_SCREEN_CELLS, type LampScreenCell, type LampScreenItem, type LampScreenItemOptions } from "./settings";
import { findShownLamps, readShownLamps } from "./shown";

/** What a lamp screen uses of its dial, whichever action it belongs to. */
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

const logger = pluginLogger.createScope("Lamp screens");

export const MAIN_LAYOUT = "$B1";
const LAMP_LAYOUT = "layouts/lamp.json";

// The gestures on a lamp screen act on its lamp alone (#20).
const LAMP_TRIGGER_DESCRIPTIONS = { push: "Power", touch: "Next lamp", longTouch: "Identify" };

/**
 * The lamp screens of one Brightness or Temperature dial (#48), which the dial creates and drops with itself (#198).
 * Tapping the dial's strip shows each lamp in turn, in the order of their ids, then the dial's main screen
 * again. The dial stays on a lamp screen until it's tapped past the last lamp, and while it's there, the dial turns and
 * toggles that lamp alone (#20). It remembers the id of the lamp it shows rather than its position, so a lamp
 * unplugged mid-cycle is skipped and "n of m" counts the lamps connected at that moment.
 *
 * With the blink on, which the dials share as a global setting, a tap that shows a lamp also blinks it, so tapping
 * through the lamps shows which one the dial is about to adjust (#144). What each of a lamp screen's six cells shows is
 * a global setting, the same on every dial (#177).
 *
 * Its dial redraws it whenever the lamps change, whichever action changed them, and whenever the global settings do.
 * Operations run one at a time, since each reads the lamps and changes what the dial shows, and never reject: failures
 * are logged. A blink is part of the operation that asked for it, so a tap during a blink waits for it to end.
 */
export class LampScreen {
  // The id of the lamp on screen, or undefined on the main screen.
  private shown: string | undefined;
  private queue: Promise<void> = Promise.resolve();

  /** Takes the dial, and what only the dial knows: how to draw its main screen, and what turning it adjusts. */
  constructor(
    private readonly dial: LampScreenDial,
    private readonly owner: DialOwner,
  ) {}

  /** Whether the dial is on a lamp screen rather than its main screen. */
  get isShowing(): boolean {
    return this.shown !== undefined;
  }

  /** The id of the lamp on the dial's screen, or undefined on its main screen. */
  get lamp(): string | undefined {
    return this.shown;
  }

  /**
   * Shows the lamp after the one on screen, the first lamp from the main screen, and the main screen after the last.
   * With the blink on for the dial, the lamp shown blinks once it's drawn.
   */
  tap(): Promise<void> {
    return this.enqueue(async () => {
      const lamps = await findShownLamps();
      const current = this.shown;
      if (current === undefined && lamps.length === 0) {
        await this.dial.showAlert();
        return;
      }
      // The lamp after the one on screen in the order the lamps come in, which also finds the one after a lamp
      // unplugged since the last tap.
      const next = current === undefined ? lamps[0] : lamps.find((lamp) => byId(lamp.id, current) > 0);
      if (next === undefined) {
        await this.backToMain();
        return;
      }
      await this.show(next, lamps);
      if (globalSettings.blinksOnLampScreen(this.dial.id)) {
        await blink(this.dial, next.id);
      }
    });
  }

  /** Blinks the lamp on the dial's screen, so the user can tell which one it is. Does nothing on the main screen. */
  identify(): Promise<void> {
    return this.enqueue(async () => {
      if (this.shown !== undefined) {
        await blink(this.dial, this.shown);
      }
    });
  }

  /**
   * Redraws the lamp on screen, from what the plugin holds, or goes back to the main screen when the last operation
   * didn't find it. Does nothing on the main screen, which the dial draws.
   */
  refresh(): Promise<void> {
    return this.enqueue(async () => {
      const shown = this.shown;
      if (shown === undefined) {
        return;
      }
      const lamps = await readShownLamps();
      const lamp = lamps.find((candidate) => candidate.id === shown);
      if (lamp === undefined) {
        await this.backToMain();
      } else {
        await draw(this.dial, lamp, lamps);
      }
    });
  }

  /**
   * Starts the dial on the main screen as it appears. Stream Deck may keep the layout a dial had when it disappeared,
   * or when the plugin stopped.
   */
  appear(): Promise<void> {
    return this.enqueue(async () => {
      this.shown = undefined;
      await this.dial.setFeedbackLayout(MAIN_LAYOUT);
      await this.dial.setTriggerDescription();
    });
  }

  /** Runs an operation after the ones before it, and logs it if it fails, so the queue carries on. */
  private enqueue(operation: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(operation).catch((error: unknown) => {
      logger.error("Lamp screen update failed", error);
    });
    return this.queue;
  }

  /** Draws a lamp, switching the dial to the lamp layout first if it was on its main screen. */
  private async show(lamp: ReachedLamp, lamps: ReachedLamp[]): Promise<void> {
    const wasShowing = this.shown !== undefined;
    this.shown = lamp.id;
    if (!wasShowing) {
      await this.dial.setFeedbackLayout(LAMP_LAYOUT);
      await this.dial.setTriggerDescription({ rotate: this.owner.adjusts, ...LAMP_TRIGGER_DESCRIPTIONS });
    }
    await draw(this.dial, lamp, lamps);
  }

  /** Switches the dial back to the main layout and lets it draw its main screen. */
  private async backToMain(): Promise<void> {
    this.shown = undefined;
    await this.dial.setFeedbackLayout(MAIN_LAYOUT);
    await this.dial.setTriggerDescription();
    await this.owner.showMain();
  }
}

// The icons of the items that can show one, wherever they're shown: the lumens share the brightness's sun (#177). Each is
// drawn in its text's color (#153), as an SVG a layout's pixmap takes as a data URL, at the size of the glyph@2x.png the
// dials' main screens show, and kept once drawn, by item and color.
const ICONS: Partial<Record<LampScreenItem, (size: number, options: { color: string }) => string>> = {
  temperature: temperatureGlyph,
  brightnessPercentage: brightnessGlyph,
  brightnessLumen: brightnessGlyph,
};
const ICON_SIZE = 144;
const drawnIcons = new Map<string, string>();

// What a counter puts between the lamp's place and the count, by format.
const COUNTER_SEPARATORS = { of: " of ", slash: "/", dash: "-", space: " " };

// The characters a trimmed identification keeps, its "…" included: about as many as fit in half a row at 18 px.
const TRIMMED_LENGTH = 10;

/** Blinks a lamp, by its id, and shows an alert on the dial when it can't. */
async function blink(dial: LampScreenDial, lampId: string): Promise<void> {
  const result = await identifyLamp(lampId, globalSettings.identifyBlinkMs);
  if (!result.ok) {
    await dial.showAlert();
  }
}

/** What a cell shows: its text, with its look, and its icon and the side it's on, if it has one. */
type Shown = { text: { value: string } & TextStyle; icon?: string };

/**
 * What a cell shows for a lamp, in the lamp screens' text styles (#153), or undefined for a cell that shows nothing.
 * Every item takes the style chosen for its cell, but the power, which takes the style chosen for its state.
 */
function shownIn(
  content: LampScreenCellContent,
  lamp: ReachedLamp,
  lamps: ReachedLamp[],
  styles: TextStyles,
): Shown | undefined {
  const { state } = lamp;
  switch (content.item) {
    case "identification":
      return { text: { value: identification(content.options, lamp), ...styles[content.options.style] } };
    case "counter":
      return { text: { value: counter(content.options, lamp, lamps), ...styles[content.options.style] } };
    case "temperature":
      return measure(content, `${state.kelvin}`, " K", styles[content.options.style]);
    case "power":
      return { text: power(content.options, state.on, styles) };
    case "brightnessPercentage":
      return measure(content, `${lamp.brightnessPercentage(state.lumen)}`, "%", styles[content.options.style]);
    case "brightnessLumen":
      return measure(content, `${state.lumen}`, " lm", styles[content.options.style]);
    case "none":
      return undefined;
  }
}

/**
 * A lamp's identification, made of up to two parts joined by " - ": its model, the end of its id, or its name, which
 * falls back to its model and the end of its id, as the keys' settings pages show a lamp with no name (#20). A part
 * chosen empty is left out, so both chosen empty show nothing.
 */
function identification(options: LampScreenItemOptions["identification"], lamp: Lamp): string {
  const partOf = (part: typeof options.first): string => {
    switch (part) {
      case "model":
        return lamp.model;
      case "id":
        return Lamp.idEndOf(lamp.id);
      case "name":
        return lamp.name ?? lamp.label;
      case "empty":
        return "";
    }
  };
  const parts = [partOf(options.first), partOf(options.second)].filter((part) => part !== "");
  const text = parts.join(" - ");
  return options.trim ? trimmed(text) : text;
}

/** A text cut to TRIMMED_LENGTH characters, ending in "…", or as it is when it's short enough. */
function trimmed(text: string): string {
  const characters = Array.from(text);
  return characters.length > TRIMMED_LENGTH ? `${characters.slice(0, TRIMMED_LENGTH - 1).join("")}…` : text;
}

/** A lamp's place among the lamps, or among the lamps of its model, alone or with their count. */
function counter(options: LampScreenItemOptions["counter"], lamp: Lamp, lamps: readonly Lamp[]): string {
  const among = options.count === "countByModel" ? lamps.filter((other) => other.model === lamp.model) : lamps;
  const place = among.indexOf(lamp) + 1;
  return options.count === "count" ? `${place}` : `${place}${COUNTER_SEPARATORS[options.format]}${among.length}`;
}

/** A measure with its unit, if it shows one, and its icon, if it shows one. */
function measure(
  content: Extract<LampScreenCellContent, { item: "temperature" | "brightnessPercentage" | "brightnessLumen" }>,
  value: string,
  unit: string,
  style: TextStyle,
): Shown {
  const { icon, unit: withUnit } = content.options;
  const glyph = ICONS[content.item];
  const text = { value: withUnit ? `${value}${unit}` : value, ...style };
  return icon && glyph !== undefined ? { text, icon: iconOf(content.item, glyph, style.color) } : { text };
}

/** An item's icon in a color, as a data URL, drawn the first time it's asked for. */
function iconOf(item: LampScreenItem, glyph: NonNullable<(typeof ICONS)[LampScreenItem]>, color: string): string {
  const key = `${item} ${color}`;
  let icon = drawnIcons.get(key);
  if (icon === undefined) {
    const svg = svgDoc(ICON_SIZE, glyph(ICON_SIZE, { color }));
    icon = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    drawnIcons.set(key, icon);
  }
  return icon;
}

/**
 * Whether a lamp is on, with the label chosen for its state, in the text style chosen for it, or in its own color and
 * weight, at the Primary style's size.
 */
function power(options: LampScreenItemOptions["power"], on: boolean, styles: TextStyles): Shown["text"] {
  const [value, style, color, weight] = on
    ? [options.onLabel, options.onStyle, options.onColor, options.onWeight]
    : [options.offLabel, options.offStyle, options.offColor, options.offWeight];
  if (style !== "custom") {
    return { value, ...styles[style] };
  }
  return { value, color, font: { size: styles.primary.font.size, weight: FONT_WEIGHTS[weight] } };
}

/**
 * The slots of one cell of the lamp layout, placed at fixed points, since a slot can't move (#177): an icon on the
 * cell's outer edge, with a text beside it, and a text with no icon. Both texts are aligned to the cell's side, left
 * for a left cell and right for a right one, so a cell reads icon, value and unit on the left, and value, unit and icon
 * on the right. The cell shows the slots its item needs, and hides the others. Every slot is given its whole look each
 * time, since a slot keeps what it was given.
 */
function cellSlots(cell: LampScreenCell, shown: Shown | undefined) {
  const hidden = { value: "", enabled: false };
  const text = shown === undefined ? hidden : { ...shown.text, enabled: true };
  const icon = shown?.icon;
  return {
    [`${cell}Icon`]: icon === undefined ? { enabled: false } : { value: icon, enabled: true },
    [`${cell}BesideIcon`]: icon === undefined ? hidden : text,
    [cell]: icon === undefined ? text : hidden,
  };
}

/** Fills the slots of the lamp layout, each cell with what the global settings give it, and how (#177). */
async function draw(dial: LampScreenDial, lamp: ReachedLamp, lamps: ReachedLamp[]): Promise<void> {
  const cells = globalSettings.lampScreenCells;
  const styles = globalSettings.textStyles;
  await dial.setFeedback(
    Object.assign({}, ...LAMP_SCREEN_CELLS.map((cell) => cellSlots(cell, shownIn(cells[cell], lamp, lamps, styles)))),
  );
}
