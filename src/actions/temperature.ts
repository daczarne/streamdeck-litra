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
  adjustTemperatureAllByKelvinSteps,
  type BroadcastResult,
  createDialDebouncer,
  readRepresentativeTemperatureKelvin,
  setTemperatureAllInKelvin,
  toggleAll,
} from "../litra-manager";
import { logger as pluginLogger } from "../logging";
import { lampScreens as sharedLampScreens, type LampScreens } from "./lamp-screens";
import { parseSettings, temperatureSettings } from "./settings";

const logger = pluginLogger.createScope("Temperature");

type ActionRef = WillAppearEvent["action"];

@action({ UUID: "com.daczarne.litra.temperature" })
export class TemperatureAction extends SingletonAction {
  private readonly dialQueues = new Map<string, (ticks: number) => void>();
  private readonly latestSettings = new Map<string, JsonObject>();

  private readonly lampScreens: LampScreens;

  constructor(lampScreens: LampScreens = sharedLampScreens) {
    super();
    this.lampScreens = lampScreens;
  }

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    this.latestSettings.set(ev.action.id, ev.payload.settings);
    if (ev.action.isDial()) {
      await this.lampScreens.appear(ev.action);
    }
    await this.refreshDisplay(ev.action, ev.payload.settings);
  }

  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    await this.lampScreens.disappear(ev.action.id);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent): Promise<void> {
    this.latestSettings.set(ev.action.id, ev.payload.settings);
    await this.refreshDisplay(ev.action, ev.payload.settings);
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const { presetKelvin: preset } = parseSettings(ev.payload.settings, temperatureSettings, logger);
    logger.info(`Key pressed: preset ${preset} K`);
    const result = setTemperatureAllInKelvin(preset);
    if (!result.ok) {
      await ev.action.showAlert();
    }
    // The key shows its preset, and the dials the temperature the lamps were set to: the preset snapped to an allowed one.
    await this.showOnEveryDial(result);
  }

  /** Dial press toggles power, or blinks the lamp on a lamp screen; rotate adjusts temperature. */
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
      return;
    }
    await this.refreshDisplay(ev.action, ev.payload.settings);
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
        const { stepKelvin: step } = parseSettings(settings, temperatureSettings, logger);
        logger.info(`Dial turned: ${ticks} ticks of ${step} K`);
        const result = adjustTemperatureAllByKelvinSteps(ticks, step);
        if (!result.ok) {
          await ev.action.showAlert();
        }
        await this.showOnEveryDial(result);
      });
      this.dialQueues.set(id, queue);
    }
    queue(ev.payload.ticks);
  }

  private async refreshDisplay(action: ActionRef, settings: JsonObject): Promise<void> {
    if (action.isKey()) {
      await this.showKeyAmount(action, parseSettings(settings, temperatureSettings, logger).presetKelvin);
      return;
    }

    const result = readRepresentativeTemperatureKelvin();
    await this.showDialValue(action, result.ok ? result : undefined);
  }

  private async showKeyAmount(action: KeyAction<JsonObject>, kelvin: number): Promise<void> {
    await action.setTitle(`${Math.round(kelvin)}`);
  }

  /** Shows the temperature on every visible dial of this action, since they all describe the same lamps. */
  private async showOnEveryDial(result: BroadcastResult): Promise<void> {
    for (const action of this.actions) {
      await this.showDialValue(action, result);
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
