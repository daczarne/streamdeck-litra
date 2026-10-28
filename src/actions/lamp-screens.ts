import type { TouchTapEvent } from "@elgato/streamdeck";

import { identifyLamp, type LampStatus, onLampsChanged, readLampStatuses } from "../litra-manager";
import { logger as pluginLogger } from "../logging";

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
 * Every dial shares one instance, which redraws every lamp screen whenever the lamps change, whichever action changed
 * them. Operations run one at a time, since each reads the lamps and changes what a dial shows, and never reject:
 * failures are logged. A blink is part of the operation that asked for it, so a tap during a blink waits for it to end.
 */
export class LampScreens {
  private readonly screens = new Map<string, Screen>();
  private queue: Promise<void> = Promise.resolve();
  private blinkOnShow = false;

  /** Subscribes to every change made to the lamps, to redraw the lamp screens. */
  constructor() {
    onLampsChanged(() => this.refresh());
  }

  /** Whether a dial is on a lamp screen rather than its main screen. */
  isShowing(dialId: string): boolean {
    return this.screens.has(dialId);
  }

  /** The id of the lamp on a dial's screen, or undefined on its main screen. */
  lampOnScreen(dialId: string): string | undefined {
    return this.screens.get(dialId)?.id;
  }

  /** Turns on or off the blink of each lamp as a tap shows its screen. It applies from the next tap. */
  setBlinkOnShow(blink: boolean): void {
    this.blinkOnShow = blink;
  }

  /**
   * Shows the lamp after the one on screen, the first lamp from the main screen, and the main screen after the last.
   * With the blink on, the lamp shown blinks once it's drawn.
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
      if (this.blinkOnShow) {
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

// "Off" stands out from the lamp screen's other text, which stays white on the strip's own background: dark, and bold,
// so its thin strokes don't blur into the background at 18 px. The font still joins its "ff" into one shape (#153).
const ON_POWER = { color: "white", font: { size: 18, weight: 400 } };
const OFF_POWER = { color: "#202020", font: { size: 18, weight: 700 } };

/** Blinks a lamp, by its id, and shows an alert on the dial when it can't. */
async function blink(dial: LampScreenDial, lampId: string): Promise<void> {
  const result = await identifyLamp(lampId);
  if (!result.ok) {
    await dial.showAlert();
  }
}

/** Fills the slots of the lamp layout. The power is given its look each time, since a slot keeps what it was given. */
async function draw(dial: LampScreenDial, lamp: LampStatus, lamps: LampStatus[]): Promise<void> {
  await dial.setFeedback({
    // Named as the keys' settings pages name it, so a lamp found here matches the picker (#20).
    lamp: lamp.label,
    position: `${lamps.indexOf(lamp) + 1} of ${lamps.length}`,
    power: lamp.on ? { value: "On", ...ON_POWER } : { value: "Off", ...OFF_POWER },
    temperature: `${lamp.temperatureKelvin} K`,
    brightness: `${lamp.brightnessPercentage}%`,
    lumens: `${lamp.brightnessLumen} lm`,
  });
}

/** The lamp screens every action shares. */
export const lampScreens = new LampScreens();
