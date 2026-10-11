import {
  action,
  DialDownEvent,
  DialRotateEvent,
  DidReceiveSettingsEvent,
  KeyAction,
  KeyDownEvent,
  SingletonAction,
  TouchTapEvent,
  WillAppearEvent,
  WillDisappearEvent,
} from "@elgato/streamdeck";

import {
  adjustBrightnessAllByPercentageSteps,
  createDialDebouncer,
  readRepresentativeBrightnessPercentage,
  setBrightnessAllPercentage,
  toggleAll,
} from "../litra-manager";
import { lampScreens as sharedLampScreens, type LampScreens } from "./lamp-screens";

type BrightnessSettings = {
  presetPercentage?: number;
  stepPercentage?: number;
};

type ActionRef = WillAppearEvent<BrightnessSettings>["action"];

// Where fewer lamps reach, the bar fades from white towards this grey, never as far as the bar's own background, and
// light enough to read on the strip.
const FAINTEST_BAR_GREY = 0x80;

/**
 * The fill of the brightness bar for the lamps' levels, in %: white up to the dimmest lamp's level, then fainter for
 * each level fewer lamps reach, so the bar shows that only some lamps go that far (#59). A gradient's stops span the
 * bar's filled part, which ends at the brightest lamp's level, so each level is placed as a share of that one. Two
 * stops 0.001 apart draw a sharp edge.
 */
export function barFill(levels: number[]): string {
  const brightest = Math.max(0, ...levels);
  const distinct = [...new Set(levels)].filter((level) => level > 0).sort((a, b) => a - b);
  if (distinct.length === 0 || (distinct.length === 1 && levels.every((level) => level === brightest))) {
    return "white";
  }
  const offset = (share: number): number => Number(Math.min(1, share).toFixed(3));
  const stops: string[] = [];
  let start = 0;
  for (const level of distinct) {
    const reaching = levels.filter((other) => other >= level).length / levels.length;
    const grey = Math.round(FAINTEST_BAR_GREY + (0xff - FAINTEST_BAR_GREY) * reaching).toString(16).padStart(2, "0");
    const color = `#${grey}${grey}${grey}`;
    const end = level / brightest;
    stops.push(`${offset(start)}:${color}`, `${offset(end)}:${color}`);
    start = end + 0.001;
  }
  return stops.join(",");
}

@action({ UUID: "com.daczarne.litra.brightness" })
export class BrightnessAction extends SingletonAction<BrightnessSettings> {
  private readonly dialQueues = new Map<string, (ticks: number) => void>();
  private readonly latestSettings = new Map<string, BrightnessSettings>();

  private readonly lampScreens: LampScreens;

  constructor(lampScreens: LampScreens = sharedLampScreens) {
    super();
    this.lampScreens = lampScreens;
  }

  override async onWillAppear(ev: WillAppearEvent<BrightnessSettings>): Promise<void> {
    this.latestSettings.set(ev.action.id, ev.payload.settings);
    if (ev.action.isDial()) {
      await this.lampScreens.appear(ev.action);
    }
    await this.refreshDisplay(ev.action, ev.payload.settings);
  }

  override async onWillDisappear(ev: WillDisappearEvent<BrightnessSettings>): Promise<void> {
    await this.lampScreens.disappear(ev.action.id);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<BrightnessSettings>): Promise<void> {
    this.latestSettings.set(ev.action.id, ev.payload.settings);
    await this.refreshDisplay(ev.action, ev.payload.settings);
  }

  override async onKeyDown(ev: KeyDownEvent<BrightnessSettings>): Promise<void> {
    const preset = Number(ev.payload.settings.presetPercentage ?? 100);
    const result = await setBrightnessAllPercentage(preset);
    if (!result.ok) {
      await ev.action.showAlert();
    }
    // The key shows its preset, and the dials what the lamps reached, which is less for a lamp at its cap.
    await this.showOnEveryDial(result.brightnessPercentages);
  }

  /** Dial press toggles power, or blinks the lamp on a lamp screen; rotate adjusts brightness. */
  override async onDialDown(ev: DialDownEvent<BrightnessSettings>): Promise<void> {
    if (this.lampScreens.isShowing(ev.action.id)) {
      await this.lampScreens.identify(ev.action);
      return;
    }
    const result = toggleAll();
    if (!result.ok) {
      await ev.action.showAlert();
      return;
    }
    await this.refreshDisplay(ev.action, ev.payload.settings);
  }

  /** Tapping the strip shows the lamps one by one, and holding it goes back to the main screen. */
  override async onTouchTap(ev: TouchTapEvent<BrightnessSettings>): Promise<void> {
    if (ev.payload.hold) {
      await this.lampScreens.back(ev.action.id);
      return;
    }
    await this.lampScreens.tap(ev.action, () => this.refreshDisplay(ev.action, ev.payload.settings));
  }

  override async onDialRotate(ev: DialRotateEvent<BrightnessSettings>): Promise<void> {
    const id = ev.action.id;
    this.latestSettings.set(id, ev.payload.settings);
    // Turning the dial does nothing on a lamp screen.
    if (this.lampScreens.isShowing(id)) {
      return;
    }
    let queue = this.dialQueues.get(id);
    if (!queue) {
      queue = createDialDebouncer(async (ticks) => {
        const settings = this.latestSettings.get(id) ?? {};
        const step = Number(settings.stepPercentage ?? 5);
        const result = await adjustBrightnessAllByPercentageSteps(ticks, step);
        if (!result.ok) {
          await ev.action.showAlert();
        }
        await this.showOnEveryDial(result.brightnessPercentages);
      });
      this.dialQueues.set(id, queue);
    }
    queue(ev.payload.ticks);
  }

  private async refreshDisplay(action: ActionRef, settings: BrightnessSettings): Promise<void> {
    if (action.isKey()) {
      await this.showKeyAmount(action, Number(settings.presetPercentage ?? 100));
      return;
    }

    const result = readRepresentativeBrightnessPercentage();
    await this.showDialValue(action, result.ok ? result.brightnessPercentages : undefined);
  }

  private async showKeyAmount(action: KeyAction<BrightnessSettings>, percentage: number): Promise<void> {
    await action.setTitle(`${Math.round(percentage)}`);
  }

  /** Shows the brightness on every visible dial of this action, since they all describe the same lamps. */
  private async showOnEveryDial(levels: number[] | undefined): Promise<void> {
    for (const action of this.actions) {
      await this.showDialValue(action, levels);
    }
  }

  /**
   * Fills the slots of the $B1 layout: the brightest lamp's % as text, and again as the bar under it, banded by how many
   * lamps reach each part of it.
   */
  private async showDialValue(action: ActionRef, levels: number[] | undefined): Promise<void> {
    const brightest = levels === undefined || levels.length === 0 ? undefined : Math.max(...levels);
    const label = brightest === undefined ? "—" : `${Math.round(brightest)}%`;
    // A dial on a lamp screen has another layout, which the lamp screens redraw.
    if (action.isDial() && !this.lampScreens.isShowing(action.id)) {
      await action.setFeedback({
        title: "Brightness",
        value: label,
        indicator: { value: brightest ?? 0, bar_fill_c: barFill(levels ?? []) },
      });
    }
  }
}
