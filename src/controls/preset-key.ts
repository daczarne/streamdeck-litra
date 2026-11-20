import type { KeyAction } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import type { Logger } from "@elgato/utils/logging";
import type { OperationResult } from "../lamps/manager";
import type { LampSelection } from "../lamps/selection";
import { globalSettings } from "../settings/global-settings";
import type { CheckedLamps } from "../settings/schemas";
import { ActionInstance, type DeckControl, RoutingAction } from "./action-instance";
import { describeLamps } from "./describe-lamps";

/**
 * What a Set Brightness or Set Temperature key does: how it reads its preset and its lamps from its settings, the unit
 * its title and its log line give the preset in, whether the global settings have it turn its lamps on (#268), and how
 * it sets its lamps to it.
 */
export type Preset = {
  read: (
    settings: JsonObject,
    logger: Logger,
  ) => { preset: number; lamps: CheckedLamps; leftOutLamps: readonly string[] };
  unit: string;
  turnsLampsOn: () => boolean;
  set: (lamps: LampSelection, preset: number, turnOn: boolean) => Promise<OperationResult>;
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
 * A Set Brightness or Set Temperature key: it sets its lamps to its preset, and shows the preset as its title, which
 * the user can replace or hide. It keeps showing its preset whatever the lamps reach, so it follows no change.
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

  /** Shows the preset as the key appears. */
  override appear(): Promise<void> {
    return this.showPreset();
  }

  /** Shows the key's new preset. */
  override settingsChanged(): Promise<void> {
    return this.showPreset();
  }

  /**
   * Sets the key's lamps to its preset, turning them on first when the global settings say so (#268). The dials follow
   * through the lamp manager's notice, with what the lamps reached, which is less for a lamp at its cap, or a
   * temperature snapped to one it allows.
   */
  override async keyDown(): Promise<void> {
    const { preset } = this.config;
    const lamps = globalSettings.actionKeyLamps(this.control.id, this.config);
    const turnOn = this.preset.turnsLampsOn();
    const turning = turnOn ? ", turning lamps on" : "";
    this.logger.info(`Key pressed: preset ${preset}${this.preset.unit}, on ${describeLamps(lamps)}${turning}`);
    const result = await this.preset.set(lamps, preset, turnOn);
    if (!result.ok) {
      await this.control.showAlert();
    }
  }

  /** Writes the preset as the key's title, with its unit, as the step keys and the dials show their value. */
  private async showPreset(): Promise<void> {
    await this.control.setTitle(`${Math.round(this.config.preset)}${this.preset.unit}`);
  }
}
