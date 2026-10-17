import {
  action,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  SingletonAction,
  type WillAppearEvent,
} from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import type { Logger } from "@elgato/utils/logging";

import {
  adjustBrightnessAllByPercentageSteps,
  adjustTemperatureAllByKelvinSteps,
  type BroadcastResult,
  createDialDebouncer,
  onLampsChanged,
  readRepresentativeBrightnessPercentage,
  readRepresentativeTemperatureKelvin,
} from "../litra-manager";
import { logger as pluginLogger } from "../logging";
import { brightnessStepSettings, parseSettings, temperatureStepSettings } from "./settings";

/** What a step key moves: how it reads its step, moves the lamps by it, and reads what they're at for its title. */
type Stepped = {
  readStep: (settings: JsonObject, logger: Logger) => number;
  unit: string;
  adjust: (ticks: number, step: number) => BroadcastResult | Promise<BroadcastResult>;
  readTitle: () => Promise<string>;
};

/** The brightness, which a key shows as the dials do: the brightest lamp's %, or "—" when no lamp can be read. */
const BRIGHTNESS: Stepped = {
  readStep: (settings, logger) => parseSettings(settings, brightnessStepSettings, logger).stepPercentage,
  unit: "%",
  adjust: adjustBrightnessAllByPercentageSteps,
  readTitle: async () => {
    const levels = (await readRepresentativeBrightnessPercentage()).brightnessPercentages ?? [];
    return levels.length === 0 ? "—" : `${Math.round(Math.max(...levels))}%`;
  },
};

/** The temperature, which a key shows as the dials do: the first lamp that answers, in kelvin, or "—" without one. */
const TEMPERATURE: Stepped = {
  readStep: (settings, logger) => parseSettings(settings, temperatureStepSettings, logger).stepKelvin,
  unit: " K",
  adjust: adjustTemperatureAllByKelvinSteps,
  readTitle: async () => {
    const kelvin = (await readRepresentativeTemperatureKelvin()).representativeTemperatureKelvin;
    return kelvin === undefined ? "—" : `${Math.round(kelvin)}`;
  },
};

/**
 * A key that steps the brightness or the temperature up or down by its step, for decks without dials (#129). A press is
 * a dial's tick: it goes through the same operation, so the lamps stop on the same values and caps work the same, and
 * presses as quick as a dial's ticks are gathered into one move. Every key shows what the lamps are at as its title, and follows every change
 * through litra-manager's notice.
 */
abstract class StepKeyAction extends SingletonAction {
  private readonly queues = new Map<string, (presses: number) => void>();
  private readonly latestSettings = new Map<string, JsonObject>();

  /** Takes what the key steps and which way, and subscribes the keys to every change made to the lamps. */
  constructor(
    private readonly logger: Logger,
    private readonly stepped: Stepped,
    private readonly direction: 1 | -1,
  ) {
    super();
    onLampsChanged(() => this.syncEveryKey());
  }

  /** Shows what the lamps are at as soon as the key is placed or shown. */
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    this.latestSettings.set(ev.action.id, ev.payload.settings);
    if (ev.action.isKey()) {
      await ev.action.setTitle(await this.stepped.readTitle());
    }
  }

  /** Takes the step changed on the settings page, for the next press. */
  override onDidReceiveSettings(ev: DidReceiveSettingsEvent): void {
    this.latestSettings.set(ev.action.id, ev.payload.settings);
  }

  /**
   * Steps the lamps once, gathering quick presses for a moment so they move the lamps once, by the step the key has
   * when they're applied. The keys follow through the subscription, and the key pressed shows an alert when a lamp fails.
   */
  override onKeyDown(ev: KeyDownEvent): void {
    const id = ev.action.id;
    this.latestSettings.set(id, ev.payload.settings);
    let queue = this.queues.get(id);
    if (!queue) {
      queue = createDialDebouncer(async (presses) => {
        const step = this.stepped.readStep(this.latestSettings.get(id) ?? {}, this.logger);
        this.logger.info(`Key pressed: ${presses} ${presses === 1 ? "step" : "steps"} of ${step}${this.stepped.unit}`);
        const result = await this.stepped.adjust(this.direction * presses, step);
        if (!result.ok) {
          await ev.action.showAlert();
        }
      });
      this.queues.set(id, queue);
    }
    queue(1);
  }

  /** Shows what the lamps are at on every visible key of this action, from one read, and reads nothing without one. */
  private async syncEveryKey(): Promise<void> {
    const keys = [...this.actions].filter((key) => key.isKey());
    if (keys.length === 0) {
      return;
    }
    const title = await this.stepped.readTitle();
    for (const key of keys) {
      await key.setTitle(title);
    }
  }
}

/** The Brightness Up key: steps every lamp's brightness up by the key's step. */
@action({ UUID: "com.daczarne.litra.brightness-up" })
export class BrightnessUpAction extends StepKeyAction {
  /** Steps the brightness up. */
  constructor() {
    super(pluginLogger.createScope("Brightness Up"), BRIGHTNESS, 1);
  }
}

/** The Brightness Down key: steps every lamp's brightness down by the key's step. */
@action({ UUID: "com.daczarne.litra.brightness-down" })
export class BrightnessDownAction extends StepKeyAction {
  /** Steps the brightness down. */
  constructor() {
    super(pluginLogger.createScope("Brightness Down"), BRIGHTNESS, -1);
  }
}

/** The Temperature Up key: steps every lamp's temperature up, cooler, by the key's step. */
@action({ UUID: "com.daczarne.litra.temperature-up" })
export class TemperatureUpAction extends StepKeyAction {
  /** Steps the temperature up. */
  constructor() {
    super(pluginLogger.createScope("Temperature Up"), TEMPERATURE, 1);
  }
}

/** The Temperature Down key: steps every lamp's temperature down, warmer, by the key's step. */
@action({ UUID: "com.daczarne.litra.temperature-down" })
export class TemperatureDownAction extends StepKeyAction {
  /** Steps the temperature down. */
  constructor() {
    super(pluginLogger.createScope("Temperature Down"), TEMPERATURE, -1);
  }
}
