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
  adjustLampsTemperature,
  type BroadcastResult,
  createDialDebouncer,
  onLampsChanged,
  readLampsTemperature,
  setLampsTemperature,
  toggleLamps,
} from "../litra-manager";
import { logger as pluginLogger } from "../logging";
import { type LampScreens, lampScreens as sharedLampScreens } from "./lamp-screens";
import { describeLamps, parseSettings, temperatureSettings } from "./settings";

const logger = pluginLogger.createScope("Temperature");

type ActionRef = WillAppearEvent["action"];

/**
 * The Temperature action. On a key, it sets its lamps to the key's preset. On a dial, it steps the temperature as the
 * dial turns, toggles the lamps when pressed, and shows each lamp on its own screen when the strip is tapped. On a
 * lamp screen, turning and pushing the dial act on that lamp alone, and holding the strip blinks it (#20).
 */
@action({ UUID: "com.daczarne.litra.temperature" })
export class TemperatureAction extends SingletonAction {
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
   * Sets the key's lamps to its preset. The key keeps showing its preset, and the dials follow through the subscription
   * with the temperature the lamps were set to: the preset snapped to an allowed one.
   */
  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const { presetKelvin: preset, lamps } = parseSettings(ev.payload.settings, temperatureSettings, logger);
    logger.info(`Key pressed: preset ${preset} K, on ${describeLamps(lamps)}`);
    const result = setLampsTemperature(lamps, preset);
    if (!result.ok) {
      await ev.action.showAlert();
    }
  }

  /** Toggles every lamp from the main screen, or the lamp on screen from a lamp screen. */
  override async onDialDown(ev: DialDownEvent): Promise<void> {
    const lamp = this.lampScreens.lampOnScreen(ev.action.id);
    logger.info(lamp === undefined ? "Dial pressed: toggle" : "Dial pressed on a lamp screen: toggle");
    const result = toggleLamps(lamp === undefined ? "all" : [lamp]);
    if (!result.ok) {
      await ev.action.showAlert();
    }
  }

  /** Tapping the strip shows the lamps one by one, and holding it on a lamp screen blinks the lamp on screen. */
  override async onTouchTap(ev: TouchTapEvent): Promise<void> {
    if (ev.payload.hold) {
      if (!this.lampScreens.isShowing(ev.action.id)) {
        logger.info("Strip held on the main screen: nothing to do");
        return;
      }
      logger.info("Strip held: identify");
      await this.lampScreens.identify(ev.action);
      return;
    }
    logger.info("Strip tapped: next screen");
    await this.lampScreens.tap(ev.action, {
      showMain: () => this.refreshDisplay(ev.action, ev.payload.settings),
      adjusts: "Temperature",
    });
  }

  /**
   * Steps the temperature by the dial's ticks, gathered for a moment so a quick turn moves the lamps once, with the
   * settings the dial has when they are applied. Ticks go to what the dial showed as it turned: every lamp from the main
   * screen, or the lamp on screen, even when the strip is tapped before they are applied. The dials follow through the
   * subscription.
   */
  override async onDialRotate(ev: DialRotateEvent): Promise<void> {
    const id = ev.action.id;
    this.latestSettings.set(id, ev.payload.settings);
    const lamp = this.lampScreens.lampOnScreen(id);
    // One queue for each lamp the dial can turn, so ticks gathered on one screen aren't applied to the next.
    const queueId = `${id}/${lamp ?? "all"}`;
    let queue = this.dialQueues.get(queueId);
    if (!queue) {
      queue = createDialDebouncer(async (ticks) => {
        const settings = this.latestSettings.get(id) ?? {};
        const { stepKelvin: step } = parseSettings(settings, temperatureSettings, logger);
        const screen = lamp === undefined ? "" : " on a lamp screen";
        logger.info(`Dial turned${screen}: ${ticks} ticks of ${step} K`);
        const result = adjustLampsTemperature(lamp === undefined ? "all" : [lamp], ticks, step);
        if (!result.ok) {
          await ev.action.showAlert();
        }
      });
      this.dialQueues.set(queueId, queue);
    }
    queue(ev.payload.ticks);
  }

  /** Shows the preset on a key, or what the lamps are at on a dial. */
  private async refreshDisplay(action: ActionRef, settings: JsonObject): Promise<void> {
    if (action.isKey()) {
      await this.showKeyAmount(action, parseSettings(settings, temperatureSettings, logger).presetKelvin);
      return;
    }

    await this.showDialValue(action, await readLampsTemperature("all"));
  }

  /** Writes the preset as the key's title, which the user can replace or hide. */
  private async showKeyAmount(action: KeyAction<JsonObject>, kelvin: number): Promise<void> {
    await action.setTitle(`${Math.round(kelvin)}`);
  }

  /**
   * Shows what the lamps are at on every visible dial of this action, from one read, since they all describe the same
   * lamps. The first lamp that answers stands for them, and nothing is read when no dial shows the temperature.
   */
  private async syncEveryDial(): Promise<void> {
    const dials = [...this.actions].filter((action) => action.isDial() && !this.lampScreens.isShowing(action.id));
    if (dials.length === 0) {
      return;
    }
    const result = await readLampsTemperature("all");
    for (const dial of dials) {
      await this.showDialValue(dial, result);
    }
  }

  /** Fills the slots of the $B1 layout: the kelvin as text, and its place in the lamp's range as the bar under it. */
  private async showDialValue(action: ActionRef, result: BroadcastResult | undefined): Promise<void> {
    const kelvin = result?.representativeTemperatureKelvin;
    // A dial on a lamp screen has another layout, which the lamp screens redraw.
    if (action.isDial() && !this.lampScreens.isShowing(action.id)) {
      await action.setFeedback({
        title: "Temperature",
        value: kelvin === undefined ? "—" : `${Math.round(kelvin)}`,
        indicator: result?.representativeTemperaturePercentage ?? 0,
      });
    }
  }
}
