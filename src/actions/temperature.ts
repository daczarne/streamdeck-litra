import {
  action,
  DialDownEvent,
  DialRotateEvent,
  DidReceiveSettingsEvent,
  KeyAction,
  KeyDownEvent,
  SingletonAction,
  WillAppearEvent,
} from "@elgato/streamdeck";

import {
  adjustTemperatureAllByKelvinSteps,
  type BroadcastResult,
  createDialDebouncer,
  readRepresentativeTemperatureKelvin,
  setTemperatureAllInKelvin,
  toggleAll,
} from "../litra-manager";

type TemperatureSettings = {
  presetKelvin?: number;
  stepKelvin?: number | string;
};

type ActionRef = WillAppearEvent<TemperatureSettings>["action"];

@action({ UUID: "com.daczarne.litra.temperature" })
export class TemperatureAction extends SingletonAction<TemperatureSettings> {
  private readonly dialQueues = new Map<string, (ticks: number) => void>();
  private readonly latestSettings = new Map<string, TemperatureSettings>();

  override async onWillAppear(ev: WillAppearEvent<TemperatureSettings>): Promise<void> {
    this.latestSettings.set(ev.action.id, ev.payload.settings);
    await this.refreshDisplay(ev.action, ev.payload.settings);
  }

  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent<TemperatureSettings>): Promise<void> {
    this.latestSettings.set(ev.action.id, ev.payload.settings);
    await this.refreshDisplay(ev.action, ev.payload.settings);
  }

  override async onKeyDown(ev: KeyDownEvent<TemperatureSettings>): Promise<void> {
    const preset = Number(ev.payload.settings.presetKelvin ?? 4000);
    const result = setTemperatureAllInKelvin(preset);
    if (!result.ok) {
      await ev.action.showAlert();
    }
    // The key shows its preset, and the dials the temperature the lamps were set to: the preset snapped to an allowed one.
    await this.showOnEveryDial(result);
  }

  /** Dial press toggles power; rotate adjusts temperature. */
  override async onDialDown(ev: DialDownEvent<TemperatureSettings>): Promise<void> {
    const result = toggleAll();
    if (!result.ok) {
      await ev.action.showAlert();
      return;
    }
    await this.refreshDisplay(ev.action, ev.payload.settings);
  }

  override async onDialRotate(ev: DialRotateEvent<TemperatureSettings>): Promise<void> {
    const id = ev.action.id;
    this.latestSettings.set(id, ev.payload.settings);
    let queue = this.dialQueues.get(id);
    if (!queue) {
      queue = createDialDebouncer(async (ticks) => {
        const settings = this.latestSettings.get(id) ?? {};
        const step = Number(settings.stepKelvin ?? 100);
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

  private async refreshDisplay(action: ActionRef, settings: TemperatureSettings): Promise<void> {
    if (action.isKey()) {
      await this.showKeyAmount(action, Number(settings.presetKelvin ?? 4000));
      return;
    }

    const result = readRepresentativeTemperatureKelvin();
    await this.showDialValue(action, result.ok ? result : undefined);
  }

  private async showKeyAmount(action: KeyAction<TemperatureSettings>, kelvin: number): Promise<void> {
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
    if (action.isDial()) {
      await action.setFeedback({
        title: "Temperature",
        value: kelvin === undefined ? "—" : `${Math.round(kelvin)}`,
        indicator: result?.representativeTemperaturePercentage ?? 0,
      });
    }
  }
}
