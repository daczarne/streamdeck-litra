import type { KeyAction } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import type { Logger } from "@elgato/utils/logging";
import type { OperationResult } from "../lamps/manager";
import type { LampSelection } from "../lamps/selection";
import { globalSettings } from "../settings/global-settings";
import type { CheckedLamps, SET_KEY_TITLES } from "../settings/schemas";
import { ActionInstance, type DeckControl, RoutingAction } from "./action-instance";
import { describeLamps } from "./describe-lamps";

/**
 * What a Set Brightness or Set Temperature key does: how it reads its preset and its lamps from its settings, the unit
 * its title and its log line give the preset in, whether the global settings have the key, by its id, turn its lamps on
 * (#268, #181), how it sets its lamps to it, and what its lamps are at, as its title shows them when its settings
 * choose it.
 */
export type Preset = {
  read: (
    settings: JsonObject,
    logger: Logger,
  ) => {
    preset: number;
    lamps: CheckedLamps;
    leftOutLamps: readonly string[];
    title: (typeof SET_KEY_TITLES)[number];
  };
  unit: string;
  turnsLampsOn: (keyId: string) => boolean;
  set: (lamps: LampSelection, preset: number, turnOn: boolean) => Promise<OperationResult>;
  current: (lamps: LampSelection) => Promise<string>;
};

/** The Set Brightness or the Set Temperature key action, which gives each key a {@link PresetKey}. */
export abstract class PresetKeyAction extends RoutingAction<PresetKey> {
  /** Takes the action's logger, and what its keys set. */
  constructor(
    private readonly logger: Logger,
    private readonly preset: Preset,
  ) {
    super();
  }

  /** A key that sets its preset: the manifest places the action on keys alone. */
  protected override create(control: DeckControl, settings: JsonObject): PresetKey | undefined {
    return control.isKey() ? new PresetKey(control, settings, this.logger, this.preset) : undefined;
  }
}

/**
 * A Set Brightness or Set Temperature key: it sets its lamps to its preset, and shows as its title either its preset,
 * whatever the lamps reach, or what its lamps are at, as a step key shows them, following every change, as its settings
 * choose. The user can replace the title or hide it.
 */
class PresetKey extends ActionInstance<ReturnType<Preset["read"]>, KeyAction<JsonObject>> {
  /** Takes the key, its settings, the action's logger and what the key sets. */
  constructor(
    control: KeyAction<JsonObject>,
    settings: JsonObject,
    private readonly logger: Logger,
    private readonly preset: Preset,
  ) {
    super(control, settings, (saved) => preset.read(saved, logger));
  }

  /** Shows its title as the key appears. */
  override appear(): Promise<void> {
    return this.showTitle();
  }

  /** Shows the key's title, as its settings now choose, with the preset and the lamps they now give it. */
  override settingsChanged(): Promise<void> {
    return this.showTitle();
  }

  /** Shows what its lamps are now at, whichever key or dial changed them, when its title shows them. */
  override async lampsChanged(): Promise<void> {
    if (this.config.title === "current") {
      await this.showTitle();
    }
  }

  /** Shows what the lamps it now has are at, which may take in lamps it didn't before, when its title shows them. */
  override async globalSettingsChanged(): Promise<void> {
    if (this.config.title === "current") {
      await this.showTitle();
    }
  }

  /**
   * Sets the key's lamps to its preset, turning them on first when the global settings say so (#268). The dials follow
   * through the lamp manager's notice, with what the lamps reached, which is less for a lamp at its cap, or a
   * temperature snapped to one it allows.
   */
  override async keyDown(): Promise<void> {
    const { preset } = this.config;
    const lamps = globalSettings.actionKeyLamps(this.control.id, this.config);
    const turnOn = this.preset.turnsLampsOn(this.control.id);
    const turning = turnOn ? ", turning lamps on" : "";
    this.logger.info(`Key pressed: preset ${preset}${this.preset.unit}, on ${describeLamps(lamps)}${turning}`);
    const result = await this.preset.set(lamps, preset, turnOn);
    if (!result.ok) {
      await this.control.showAlert();
    }
  }

  /**
   * Shows the key's title, as its settings choose: its preset, with its unit, as the step keys and the dials show their
   * value, or what its lamps are at.
   */
  private async showTitle(): Promise<void> {
    const shown =
      this.config.title === "current"
        ? await this.preset.current(globalSettings.actionKeyLamps(this.control.id, this.config))
        : `${Math.round(this.config.preset)}${this.preset.unit}`;
    await this.control.setTitle(shown);
  }
}
