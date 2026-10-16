import {
  action,
  type DialDownEvent,
  type DialRotateEvent,
  type DidReceiveSettingsEvent,
  type KeyAction,
  type KeyDownEvent,
  SingletonAction,
  type TouchTapEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import {
  adjustBrightnessAllByPercentageSteps,
  createDialDebouncer,
  onLampsChanged,
  readRepresentativeBrightnessPercentage,
  setBrightnessAllPercentage,
  toggleAll,
} from "../litra-manager";
import { logger as pluginLogger } from "../logging";
import { type LampScreens, lampScreens as sharedLampScreens } from "./lamp-screens";
import { brightnessSettings, parseSettings } from "./settings";

const logger = pluginLogger.createScope("Brightness");

type ActionRef = WillAppearEvent["action"];

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
    const grey = Math.round(FAINTEST_BAR_GREY + (0xff - FAINTEST_BAR_GREY) * reaching)
      .toString(16)
      .padStart(2, "0");
    const color = `#${grey}${grey}${grey}`;
    const end = level / brightest;
    stops.push(`${offset(start)}:${color}`, `${offset(end)}:${color}`);
    start = end + 0.001;
  }
  return stops.join(",");
}

/**
 * The Brightness action. On a key, it sets every lamp to the key's preset. On a dial, it steps the brightness as the
 * dial turns, toggles the lamps when pressed, and shows each lamp on its own screen when the strip is tapped.
 */
@action({ UUID: "com.daczarne.litra.brightness" })
export class BrightnessAction extends SingletonAction {
  private readonly dialQueues = new Map<string, (ticks: number) => void>();
  private readonly latestSettings = new Map<string, JsonObject>();

  private readonly lampScreens: LampScreens;

  /** Takes the lamp screens that every dial shares, or the tests' own, and subscribes the dials to every change. */
  constructor(lampScreens: LampScreens = sharedLampScreens) {
    super();
    this.lampScreens = lampScreens;
    // Every dial follows the lamps, whichever key or dial changed them, this action's own included.
    onLampsChanged(() => this.syncEveryDial());
  }

  /** Shows the key's preset, or starts a dial on its main screen with the lamps' value, when the action appears. */
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    this.latestSettings.set(ev.action.id, ev.payload.settings);
    if (ev.action.isDial()) {
      await this.lampScreens.appear(ev.action);
    }
    await this.refreshDisplay(ev.action, ev.payload.settings);
  }

  /** Forgets the dial's lamp screen, so the lamp screens stop redrawing a dial that isn't shown. */
  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    await this.lampScreens.disappear(ev.action.id);
  }

  /** Takes the settings changed on the settings page, and redraws the action with them. */
  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent): Promise<void> {
    this.latestSettings.set(ev.action.id, ev.payload.settings);
    await this.refreshDisplay(ev.action, ev.payload.settings);
  }

  /**
   * Sets every lamp to the key's preset. The key keeps showing its preset, and the dials follow through the subscription
   * with what the lamps reached, which is less for a lamp at its cap.
   */
  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const { presetPercentage: preset } = parseSettings(ev.payload.settings, brightnessSettings, logger);
    logger.info(`Key pressed: preset ${preset}%`);
    const result = await setBrightnessAllPercentage(preset);
    if (!result.ok) {
      await ev.action.showAlert();
    }
  }

  /** Dial press toggles power, or blinks the lamp on a lamp screen; rotate adjusts brightness. */
  override async onDialDown(ev: DialDownEvent): Promise<void> {
    if (this.lampScreens.isShowing(ev.action.id)) {
      logger.info("Dial pressed: identify");
      await this.lampScreens.identify(ev.action);
      return;
    }
    logger.info("Dial pressed: toggle");
    const result = toggleAll();
    if (!result.ok) {
      await ev.action.showAlert();
    }
  }

  /** Tapping the strip shows the lamps one by one, and holding it goes back to the main screen. */
  override async onTouchTap(ev: TouchTapEvent): Promise<void> {
    if (ev.payload.hold) {
      logger.info("Strip held: back");
      await this.lampScreens.back(ev.action.id);
      return;
    }
    logger.info("Strip tapped: next screen");
    await this.lampScreens.tap(ev.action, () => this.refreshDisplay(ev.action, ev.payload.settings));
  }

  /**
   * Steps the brightness by the dial's ticks, gathered for a moment so a quick turn moves the lamps once, with the
   * settings the dial has when they are applied. The dials follow through the subscription.
   */
  override async onDialRotate(ev: DialRotateEvent): Promise<void> {
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
        const { stepPercentage: step } = parseSettings(settings, brightnessSettings, logger);
        logger.info(`Dial turned: ${ticks} ticks of ${step}%`);
        const result = await adjustBrightnessAllByPercentageSteps(ticks, step);
        if (!result.ok) {
          await ev.action.showAlert();
        }
      });
      this.dialQueues.set(id, queue);
    }
    queue(ev.payload.ticks);
  }

  /** Shows the preset on a key, or what the lamps are at on a dial. */
  private async refreshDisplay(action: ActionRef, settings: JsonObject): Promise<void> {
    if (action.isKey()) {
      await this.showKeyAmount(action, parseSettings(settings, brightnessSettings, logger).presetPercentage);
      return;
    }

    await this.showDialValue(action, (await readRepresentativeBrightnessPercentage()).brightnessPercentages);
  }

  /** Writes the preset as the key's title, which the user can replace or hide. */
  private async showKeyAmount(action: KeyAction<JsonObject>, percentage: number): Promise<void> {
    await action.setTitle(`${Math.round(percentage)}`);
  }

  /**
   * Shows what the lamps are at on every visible dial of this action, from one read, since they all describe the same
   * lamps. A lamp that can't be read is left out, and nothing is read when no dial shows the brightness.
   */
  private async syncEveryDial(): Promise<void> {
    const dials = [...this.actions].filter((action) => action.isDial() && !this.lampScreens.isShowing(action.id));
    if (dials.length === 0) {
      return;
    }
    const { brightnessPercentages } = await readRepresentativeBrightnessPercentage();
    for (const dial of dials) {
      await this.showDialValue(dial, brightnessPercentages);
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
