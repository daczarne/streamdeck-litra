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
  adjustBrightnessAllByPercentageSteps,
  createDialDebouncer,
  readRepresentativeBrightnessPercentage,
  setBrightnessAllPercentage,
  toggleAll,
} from "../litra-manager";

type BrightnessSettings = {
  presetPercentage?: number;
  stepPercentage?: number;
};

type ActionRef = WillAppearEvent<BrightnessSettings>["action"];

@action({ UUID: "com.daczarne.litra.brightness" })
export class BrightnessAction extends SingletonAction<BrightnessSettings> {
  private readonly dialQueues = new Map<string, (ticks: number) => void>();
  private readonly latestSettings = new Map<string, BrightnessSettings>();

  override async onWillAppear(ev: WillAppearEvent<BrightnessSettings>): Promise<void> {
    this.latestSettings.set(ev.action.id, ev.payload.settings);
    await this.refreshDisplay(ev.action, ev.payload.settings);
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
    await this.showOnEveryDial(result.representativeBrightnessPercentage);
  }

  /** Dial press toggles power; rotate adjusts brightness. */
  override async onDialDown(ev: DialDownEvent<BrightnessSettings>): Promise<void> {
    const result = toggleAll();
    if (!result.ok) {
      await ev.action.showAlert();
      return;
    }
    await this.refreshDisplay(ev.action, ev.payload.settings);
  }

  override async onDialRotate(ev: DialRotateEvent<BrightnessSettings>): Promise<void> {
    const id = ev.action.id;
    this.latestSettings.set(id, ev.payload.settings);
    let queue = this.dialQueues.get(id);
    if (!queue) {
      queue = createDialDebouncer(async (ticks) => {
        const settings = this.latestSettings.get(id) ?? {};
        const step = Number(settings.stepPercentage ?? 5);
        const result = await adjustBrightnessAllByPercentageSteps(ticks, step);
        if (!result.ok) {
          await ev.action.showAlert();
        }
        await this.showOnEveryDial(result.representativeBrightnessPercentage);
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
    await this.showDialValue(
      action,
      result.ok ? result.representativeBrightnessPercentage : undefined,
    );
  }

  private async showKeyAmount(action: KeyAction<BrightnessSettings>, percentage: number): Promise<void> {
    await action.setTitle(`${Math.round(percentage)}`);
  }

  /** Shows the brightness on every visible dial of this action, since they all describe the same lamps. */
  private async showOnEveryDial(percentage: number | undefined): Promise<void> {
    for (const action of this.actions) {
      await this.showDialValue(action, percentage);
    }
  }

  /** Fills the slots of the $B1 layout: the % as text, and again as the bar under it. */
  private async showDialValue(action: ActionRef, percentage: number | undefined): Promise<void> {
    const label = percentage === undefined ? "—" : `${Math.round(percentage)}%`;
    if (action.isDial()) {
      await action.setFeedback({
        title: "Brightness",
        value: label,
        indicator: percentage ?? 0,
      });
    }
  }
}
