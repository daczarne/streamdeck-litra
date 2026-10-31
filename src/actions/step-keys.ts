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
  adjustLampsBrightness,
  adjustLampsTemperature,
  type BroadcastResult,
  createDialDebouncer,
  type LampSelection,
  onLampsChanged,
  readLampsBrightness,
  readLampsTemperature,
  type Stepping,
} from "../litra-manager";
import { logger as pluginLogger } from "../logging";
import { brightnessStepping, keyLamps, onGlobalSettingsChanged, temperatureStepping } from "./global-settings";
import {
  brightnessStepSettings,
  describeLamps,
  lampSettings,
  parseSettings,
  temperatureStepSettings,
} from "./settings";

/**
 * What a step key moves: how it reads its step, and how the global settings step several lamps (#145), moves the lamps
 * by it, and reads what they're at for its title.
 */
type Stepped = {
  readStep: (settings: JsonObject, logger: Logger) => number;
  readStepping: () => Stepping;
  unit: string;
  adjust: (
    lamps: LampSelection,
    ticks: number,
    step: number,
    stepping: Stepping,
  ) => BroadcastResult | Promise<BroadcastResult>;
  readTitle: (lamps: LampSelection) => Promise<string>;
};

/** The brightness, which a key shows as the dials do: the brightest lamp's %, or "—" when no lamp can be read. */
const BRIGHTNESS: Stepped = {
  readStep: (settings, logger) => parseSettings(settings, brightnessStepSettings, logger).stepPercentage,
  readStepping: brightnessStepping,
  unit: "%",
  adjust: adjustLampsBrightness,
  readTitle: async (lamps) => {
    const levels = (await readLampsBrightness(lamps)).brightnessPercentages ?? [];
    return levels.length === 0 ? "—" : `${Math.round(Math.max(...levels))}%`;
  },
};

/** The temperature, which a key shows as the dials do: the first lamp that answers, in kelvin, or "—" without one. */
const TEMPERATURE: Stepped = {
  readStep: (settings, logger) => parseSettings(settings, temperatureStepSettings, logger).stepKelvin,
  readStepping: temperatureStepping,
  unit: " K",
  adjust: adjustLampsTemperature,
  readTitle: async (lamps) => {
    const kelvin = (await readLampsTemperature(lamps)).representativeTemperatureKelvin;
    return kelvin === undefined ? "—" : `${Math.round(kelvin)}`;
  },
};

/**
 * A key that steps the brightness or the temperature up or down by its step, for decks without dials (#129). A press is
 * a dial's tick: it goes through the same operation, so the lamps stop on the same values and caps work the same, and
 * presses as quick as a dial's ticks are gathered into one move. Every key shows what its lamps are at as its title, and follows every change
 * through litra-manager's notice.
 */
abstract class StepKeyAction extends SingletonAction {
  private readonly queues = new Map<string, (presses: number) => void>();
  private readonly latestSettings = new Map<string, JsonObject>();

  /**
   * Takes what the key steps and which way, and subscribes the keys to every change made to the lamps, and to the global
   * settings, which choose their lamps (#147).
   */
  constructor(
    private readonly logger: Logger,
    private readonly stepped: Stepped,
    private readonly direction: 1 | -1,
  ) {
    super();
    onLampsChanged(() => this.syncEveryKey());
    onGlobalSettingsChanged(() => this.syncEveryKey());
  }

  /** Shows what its lamps are at as soon as the key is placed or shown. */
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    this.latestSettings.set(ev.action.id, ev.payload.settings);
    if (ev.action.isKey()) {
      await ev.action.setTitle(await this.stepped.readTitle(this.lampsOf(ev.action.id)));
    }
  }

  /** Takes the step and the lamps changed on the settings page, and shows what the key's lamps are now at. */
  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent): Promise<void> {
    this.latestSettings.set(ev.action.id, ev.payload.settings);
    if (ev.action.isKey()) {
      await ev.action.setTitle(await this.stepped.readTitle(this.lampsOf(ev.action.id)));
    }
  }

  /**
   * Steps the lamps once, gathering quick presses for a moment so they move the lamps once, by the step the key has
   * when they're applied, together or each from its own as the global settings say then (#145). The keys follow through the subscription, and the key pressed shows an alert when a lamp fails.
   */
  override onKeyDown(ev: KeyDownEvent): void {
    const id = ev.action.id;
    this.latestSettings.set(id, ev.payload.settings);
    let queue = this.queues.get(id);
    if (!queue) {
      queue = createDialDebouncer(async (presses) => {
        const step = this.stepped.readStep(this.latestSettings.get(id) ?? {}, this.logger);
        const stepping = this.stepped.readStepping();
        const lamps = this.lampsOf(id);
        const steps = `${presses} ${presses === 1 ? "step" : "steps"} of ${step}${this.stepped.unit}`;
        const each = stepping === "each" ? ", each lamp from its own" : "";
        this.logger.info(`Key pressed: ${steps}, on ${describeLamps(lamps)}${each}`);
        const result = await this.stepped.adjust(lamps, this.direction * presses, step, stepping);
        if (!result.ok) {
          await ev.action.showAlert();
        }
      });
      this.queues.set(id, queue);
    }
    queue(1);
  }

  /**
   * Shows what its lamps are at on every visible key of this action, from one read for each set of lamps the keys have,
   * and reads nothing without a key.
   */
  private async syncEveryKey(): Promise<void> {
    const titles = new Map<string, string>();
    for (const key of this.actions) {
      if (key.isKey()) {
        const lamps = this.lampsOf(key.id);
        const selection = JSON.stringify(lamps);
        let title = titles.get(selection);
        if (title === undefined) {
          title = await this.stepped.readTitle(lamps);
          titles.set(selection, title);
        }
        await key.setTitle(title);
      }
    }
  }

  /** The lamps a key acts on, from the settings it was last seen with. */
  private lampsOf(id: string): LampSelection {
    return keyLamps(id, parseSettings(this.latestSettings.get(id) ?? {}, lampSettings, this.logger));
  }
}

/** The Brightness Up key: steps its lamps' brightness up by the key's step. */
@action({ UUID: "com.daczarne.litra.brightness-up" })
export class BrightnessUpAction extends StepKeyAction {
  /** Steps the brightness up. */
  constructor() {
    super(pluginLogger.createScope("Brightness Up"), BRIGHTNESS, 1);
  }
}

/** The Brightness Down key: steps its lamps' brightness down by the key's step. */
@action({ UUID: "com.daczarne.litra.brightness-down" })
export class BrightnessDownAction extends StepKeyAction {
  /** Steps the brightness down. */
  constructor() {
    super(pluginLogger.createScope("Brightness Down"), BRIGHTNESS, -1);
  }
}

/** The Temperature Up key: steps its lamps' temperature up, cooler, by the key's step. */
@action({ UUID: "com.daczarne.litra.temperature-up" })
export class TemperatureUpAction extends StepKeyAction {
  /** Steps the temperature up. */
  constructor() {
    super(pluginLogger.createScope("Temperature Up"), TEMPERATURE, 1);
  }
}

/** The Temperature Down key: steps its lamps' temperature down, warmer, by the key's step. */
@action({ UUID: "com.daczarne.litra.temperature-down" })
export class TemperatureDownAction extends StepKeyAction {
  /** Steps the temperature down. */
  constructor() {
    super(pluginLogger.createScope("Temperature Down"), TEMPERATURE, -1);
  }
}
