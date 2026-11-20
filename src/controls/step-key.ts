import type { KeyAction } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import type { Logger } from "@elgato/utils/logging";
import { adjustLampsBrightness, adjustLampsTemperature, type OperationResult, type Stepping } from "../lamps/manager";
import type { LampSelection } from "../lamps/selection";
import { globalSettings } from "../settings/global-settings";
import {
  brightnessStepSettingsSchema,
  type CheckedLamps,
  parseSettings,
  type STEP_KEY_TITLES,
  temperatureStepSettingsSchema,
} from "../settings/schemas";
import { ActionInstance, type DeckControl, RoutingAction } from "./action-instance";
import { createDebouncer } from "./debouncer";
import { describeLamps } from "./describe-lamps";
import {
  brightnessNext,
  brightnessShown,
  brightnessText,
  temperatureNext,
  temperatureShown,
  temperatureText,
} from "./shown";

/** A step key's settings: its step, its lamps, and what its title shows. */
type StepConfig = {
  step: number;
  lamps: CheckedLamps;
  leftOutLamps: readonly string[];
  title: (typeof STEP_KEY_TITLES)[number];
};

/**
 * What a step key moves: how it reads its settings, how the global settings step several lamps (#145), whether they
 * have a key that steps it up, or down, by its id, turn the lamps on (#268, #181), how it moves the lamps by its step,
 * and what its title shows of them: what they're at, or where some ticks of a step take them.
 */
type Stepped = {
  read: (settings: JsonObject, logger: Logger) => StepConfig;
  stepping: () => Stepping;
  turnsLampsOn: (direction: 1 | -1, keyId: string) => boolean;
  unit: string;
  adjust: (
    lamps: LampSelection,
    ticks: number,
    step: number,
    stepping: Stepping,
    turnOn: boolean,
  ) => Promise<OperationResult>;
  current: (lamps: LampSelection) => Promise<string>;
  next: (lamps: LampSelection, ticks: number, step: number, stepping: Stepping) => Promise<string>;
};

/**
 * The brightness, which a Brightness Up or Down key steps, and shows as the dials do: the brightest of its lamps shown,
 * in %, or a dash with none.
 */
export const BRIGHTNESS: Stepped = {
  read: (settings, logger) => {
    const { stepPercentage, stepKeyTitle, ...lamps } = parseSettings(settings, brightnessStepSettingsSchema, logger);
    return { step: stepPercentage, title: stepKeyTitle, ...lamps };
  },
  stepping: () => globalSettings.brightnessStepping,
  turnsLampsOn: (direction, keyId) =>
    globalSettings.turnsLampsOn(direction > 0 ? "brightnessUpKeys" : "brightnessDownKeys", keyId),
  unit: "%",
  adjust: adjustLampsBrightness,
  current: async (lamps) => brightnessText(await brightnessShown(lamps)),
  next: async (lamps, ticks, step, stepping) => brightnessText(await brightnessNext(lamps, ticks, step, stepping)),
};

/**
 * The temperature, which a Temperature Up or Down key steps, and shows as the dials do: the highest of its lamps
 * shown, in kelvin, or a dash with none (#229).
 */
export const TEMPERATURE: Stepped = {
  read: (settings, logger) => {
    const { stepKelvin, stepKeyTitle, ...lamps } = parseSettings(settings, temperatureStepSettingsSchema, logger);
    return { step: stepKelvin, title: stepKeyTitle, ...lamps };
  },
  stepping: () => globalSettings.temperatureStepping,
  turnsLampsOn: (direction, keyId) =>
    globalSettings.turnsLampsOn(direction > 0 ? "temperatureUpKeys" : "temperatureDownKeys", keyId),
  unit: " K",
  adjust: adjustLampsTemperature,
  current: async (lamps) => temperatureText(await temperatureShown(lamps)),
  next: async (lamps, ticks, step, stepping) => temperatureText(await temperatureNext(lamps, ticks, step, stepping)),
};

/**
 * The action of a step key, which gives each of its keys a {@link StepKey} that steps what it steps, in its direction.
 * Each of the four step actions, in `src/actions/`, is one of these, with its own logger, what it steps and which way.
 */
export abstract class StepKeyAction extends RoutingAction<StepKey> {
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
 * presses as quick as a dial's ticks are gathered into one move. A key's title shows what its lamps are at, where its
 * next press takes them, or its step, as its settings choose, and follows every change through the lamp manager's
 * notice, and the global settings, which choose its lamps (#147) and how they step (#145).
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
    this.presses = createDebouncer((presses) => this.step(presses), logger);
  }

  /** Shows its title as soon as the key is placed or shown. */
  override appear(): Promise<void> {
    return this.showTitle();
  }

  /** Shows the key's title, as its settings now choose, with the lamps and the step they now give it. */
  override settingsChanged(): Promise<void> {
    return this.showTitle();
  }

  /** Shows the key's title for where its lamps now are, whichever key or dial changed them. */
  override lampsChanged(): Promise<void> {
    return this.showTitle();
  }

  /** Shows the key's title for the lamps it now has, which may take in new ones, and for how they now step. */
  override globalSettingsChanged(): Promise<void> {
    return this.showTitle();
  }

  /** Gathers the press with the ones just before it. */
  override keyDown(): void {
    this.presses(1);
  }

  /**
   * Steps the lamps by the presses gathered, by the step the key has when they're applied, together or each from its
   * own as the global settings say then (#145), turning them on first when they say so too (#268). The keys follow
   * through the notice, and the key shows an alert when a lamp fails.
   */
  private async step(presses: number): Promise<void> {
    const { step } = this.config;
    const stepping = this.stepped.stepping();
    const turnOn = this.stepped.turnsLampsOn(this.direction, this.control.id);
    const lamps = this.lamps();
    const steps = `${presses} ${presses === 1 ? "step" : "steps"} of ${step}${this.stepped.unit}`;
    const each = stepping === "each" ? ", each lamp from its own" : "";
    const turning = turnOn ? ", turning lamps on" : "";
    this.logger.info(`Key pressed: ${steps}, on ${describeLamps(lamps)}${each}${turning}`);
    const result = await this.stepped.adjust(lamps, this.direction * presses, step, stepping, turnOn);
    if (!result.ok) {
      await this.control.showAlert();
    }
  }

  /** The lamps the key acts on. */
  private lamps(): LampSelection {
    return globalSettings.actionKeyLamps(this.control.id, this.config);
  }

  /**
   * Shows the key's title, as its settings choose: what its lamps are at, where a press takes them, with its step, as
   * the global settings step them, or its step, signed by its direction, with its unit.
   */
  private async showTitle(): Promise<void> {
    const { title, step } = this.config;
    const lamps = this.lamps();
    const shown =
      title === "step"
        ? `${this.direction > 0 ? "+" : "−"}${step}${this.stepped.unit}`
        : title === "next"
          ? await this.stepped.next(lamps, this.direction, step, this.stepped.stepping())
          : await this.stepped.current(lamps);
    await this.control.setTitle(shown);
  }
}
