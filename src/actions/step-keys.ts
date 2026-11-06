import { action, type KeyAction } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import type { Logger } from "@elgato/utils/logging";
import { globalSettings } from "../global-settings";
import type { LampSelection } from "../lamp-selection";
import { adjustLampsBrightness, adjustLampsTemperature, type OperationResult, type Stepping } from "../litra-manager";
import { logger as pluginLogger } from "../logging";
import { ActionInstance, type DeckControl, RoutingAction } from "./action-instance";
import { createDialDebouncer } from "./debouncer";
import {
  brightnessStepSettings,
  type CheckedLamps,
  describeLamps,
  parseSettings,
  temperatureStepSettings,
} from "./settings";
import { readLampsBrightness, readLampsTemperature } from "./shown";

/** A step key's settings: its step, and its lamps. */
type StepConfig = { step: number; lamps: CheckedLamps; leftOutLamps: readonly string[] };

/**
 * What a step key moves: how it reads its settings, and how the global settings step several lamps (#145), moves the
 * lamps by its step, and reads what they're at for its title.
 */
type Stepped = {
  read: (settings: JsonObject, logger: Logger) => StepConfig;
  readStepping: () => Stepping;
  unit: string;
  adjust: (
    lamps: LampSelection,
    ticks: number,
    step: number,
    stepping: Stepping,
  ) => OperationResult | Promise<OperationResult>;
  readTitle: (lamps: LampSelection) => Promise<string>;
};

/** The brightness, which a key shows as the dials do: the brightest lamp's %, or "—" when no lamp can be read. */
const BRIGHTNESS: Stepped = {
  read: (settings, logger) => {
    const { stepPercentage, ...lamps } = parseSettings(settings, brightnessStepSettings, logger);
    return { step: stepPercentage, ...lamps };
  },
  readStepping: () => globalSettings.brightnessStepping,
  unit: "%",
  adjust: adjustLampsBrightness,
  readTitle: async (lamps) => {
    const levels = await readLampsBrightness(lamps);
    return levels.length === 0 ? "—" : `${Math.round(Math.max(...levels))}%`;
  },
};

/** The temperature, which a key shows as the dials do: the first lamp that answers, in kelvin, or "—" without one. */
const TEMPERATURE: Stepped = {
  read: (settings, logger) => {
    const { stepKelvin, ...lamps } = parseSettings(settings, temperatureStepSettings, logger);
    return { step: stepKelvin, ...lamps };
  },
  readStepping: () => globalSettings.temperatureStepping,
  unit: " K",
  adjust: adjustLampsTemperature,
  readTitle: async (lamps) => {
    const kelvin = (await readLampsTemperature(lamps))?.kelvin;
    return kelvin === undefined ? "—" : `${Math.round(kelvin)}`;
  },
};

/**
 * The action of a step key, which gives each of its keys a {@link StepKey} that steps what it steps, in its direction.
 */
abstract class StepKeyAction extends RoutingAction<StepKey> {
  /** Takes what the keys step and which way. */
  constructor(
    private readonly logger: Logger,
    private readonly stepped: Stepped,
    private readonly direction: 1 | -1,
  ) {
    super();
  }

  /** A step key, for a key: the manifest places the action on keys alone. */
  protected override create(control: DeckControl, settings: JsonObject): StepKey | undefined {
    return control.isKey() ? new StepKey(control, settings, this.logger, this.stepped, this.direction) : undefined;
  }
}

/**
 * A key that steps the brightness or the temperature up or down by its step, for decks without dials (#129). A press is
 * a dial's tick: it goes through the same operation, so the lamps stop on the same values and caps work the same, and
 * presses as quick as a dial's ticks are gathered into one move. Every key shows what its lamps are at as its title, and
 * follows every change through litra-manager's notice, and the global settings, which choose its lamps (#147).
 */
class StepKey extends ActionInstance<StepConfig, KeyAction<JsonObject>> {
  /** The presses gathered for a moment, so quick ones move the lamps once. */
  private readonly presses: (presses: number) => void;

  /** Takes the key and its settings, what it steps and which way. */
  constructor(
    control: KeyAction<JsonObject>,
    settings: JsonObject,
    private readonly logger: Logger,
    private readonly stepped: Stepped,
    private readonly direction: 1 | -1,
  ) {
    super(control, settings, (saved) => stepped.read(saved, logger));
    this.presses = createDialDebouncer((presses) => this.step(presses), logger);
  }

  /** Shows what its lamps are at as soon as the key is placed or shown. */
  override appear(): Promise<void> {
    return this.showTitle();
  }

  /** Shows what the key's lamps are at, with the lamps it now has. */
  override settingsChanged(): Promise<void> {
    return this.showTitle();
  }

  /** Shows what its lamps are at, whichever key or dial changed them. */
  override lampsChanged(): Promise<void> {
    return this.showTitle();
  }

  /** Shows what the lamps it now has are at, which may take in lamps it didn't before. */
  override globalSettingsChanged(): Promise<void> {
    return this.showTitle();
  }

  /** Gathers the press with the ones just before it. */
  override keyDown(): void {
    this.presses(1);
  }

  /**
   * Steps the lamps by the presses gathered, by the step the key has when they're applied, together or each from its
   * own as the global settings say then (#145). The keys follow through the notice, and the key shows an alert when a
   * lamp fails.
   */
  private async step(presses: number): Promise<void> {
    const { step } = this.config;
    const stepping = this.stepped.readStepping();
    const lamps = this.lamps();
    const steps = `${presses} ${presses === 1 ? "step" : "steps"} of ${step}${this.stepped.unit}`;
    const each = stepping === "each" ? ", each lamp from its own" : "";
    this.logger.info(`Key pressed: ${steps}, on ${describeLamps(lamps)}${each}`);
    const result = await this.stepped.adjust(lamps, this.direction * presses, step, stepping);
    if (!result.ok) {
      await this.control.showAlert();
    }
  }

  /** The lamps the key acts on. */
  private lamps(): LampSelection {
    return globalSettings.actionKeyLamps(this.control.id, this.config);
  }

  /** Shows what the key's lamps are at as its title. */
  private async showTitle(): Promise<void> {
    await this.control.setTitle(await this.stepped.readTitle(this.lamps()));
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
