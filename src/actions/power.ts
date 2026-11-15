import { action, type KeyAction } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import { ActionInstance, type DeckControl, RoutingAction } from "../controls/action-instance";
import { describeLamps } from "../controls/describe-lamps";
import { areLampsOn } from "../controls/shown";
import { type OperationResult, toggleLamps, turnLampsOff, turnLampsOn } from "../lamps/manager";
import type { LampSelection } from "../lamps/selection";
import { logger as pluginLogger } from "../logging";
import { globalSettings } from "../settings/global-settings";
import { type Parsed, parseSettings, powerSettingsSchema } from "../settings/schemas";

const logger = pluginLogger.createScope("Power");

/** What a press does to the key's lamps, by the key's mode. */
const OPERATIONS = { on: turnLampsOn, off: turnLampsOff, toggle: toggleLamps } satisfies Record<
  Parsed<typeof powerSettingsSchema>["mode"],
  (lamps: LampSelection) => Promise<OperationResult>
>;

/** The Power action, which gives each Power key its {@link PowerKey}. */
@action({ UUID: "com.daczarne.litra.power" })
export class PowerAction extends RoutingAction<PowerKey> {
  /** A Power key, for a key: the manifest places the action on keys alone. */
  protected override create(control: DeckControl, settings: JsonObject): PowerKey | undefined {
    return control.isKey() ? new PowerKey(control, settings) : undefined;
  }
}

/**
 * A Power key: turns its lamps on or off, or toggles them, and shows whether they're all on. Every Power key follows
 * the lamps, whichever key or dial changed them, this one included (#57), and the global settings, which say whether it
 * takes in lamps added later (#147).
 */
class PowerKey extends ActionInstance<Parsed<typeof powerSettingsSchema>, KeyAction<JsonObject>> {
  // Whether the key's last press failed, which shows its alert once its state is redrawn.
  private owesAlert = false;

  /** Takes the key and its settings. */
  constructor(control: KeyAction<JsonObject>, settings: JsonObject) {
    super(control, settings, (saved) => parseSettings(saved, powerSettingsSchema, logger));
  }

  /** Shows its lamps' state as soon as the key is placed or shown. */
  override appear(): Promise<void> {
    return this.showState();
  }

  /** Shows the state of the lamps the key now has. */
  override settingsChanged(): Promise<void> {
    return this.showState();
  }

  /** Shows its lamps' state, then the alert the key owes, if any. */
  override async lampsChanged(): Promise<void> {
    await this.showState();
    if (this.owesAlert) {
      this.owesAlert = false;
      await this.control.showAlert();
    }
  }

  /** Shows the state of the lamps the key now has, which may take in lamps it didn't before. */
  override globalSettingsChanged(): Promise<void> {
    return this.showState();
  }

  /**
   * Turns the key's lamps on or off, or toggles them, as its mode says. The key follows through the lamp manager's
   * notice. When a lamp fails, the key's alert waits for that redraw (#132): a state set right after an alert covers
   * it, while an alert shown after the state stays. Every operation sends the notice, the failed ones included.
   */
  override async keyDown(): Promise<void> {
    const { mode } = this.config;
    const lamps = this.lamps();
    logger.info(`Key pressed: ${mode}, on ${describeLamps(lamps)}`);
    const result = await OPERATIONS[mode](lamps);

    // Before the key redraws: the lamp manager sends the notice once the operation is done, and the redraw first waits
    // for the operations queued.
    if (!result.ok) {
      this.owesAlert = true;
    }
  }

  /** The lamps the key acts on. */
  private lamps(): LampSelection {
    return globalSettings.actionKeyLamps(this.control.id, this.config);
  }

  /** Shows the key's state: on (1) only if there is a lamp among its own and every one is on. */
  private async showState(): Promise<void> {
    await this.control.setState((await areLampsOn(this.lamps())) ? 1 : 0);
  }
}
