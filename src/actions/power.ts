import {
  action,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  SingletonAction,
  type WillAppearEvent,
} from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";

import {
  areLampsOn,
  type LampSelection,
  onLampsChanged,
  toggleLamps,
  turnLampsOff,
  turnLampsOn,
} from "../litra-manager";
import { logger as pluginLogger } from "../logging";
import { keyLamps, onGlobalSettingsChanged } from "./global-settings";
import { describeLamps, lampSettings, parseSettings, powerSettings } from "./settings";

const logger = pluginLogger.createScope("Power");

/** The Power key: turns its lamps on or off, or toggles them, and shows whether they are all on. */
@action({ UUID: "com.daczarne.litra.power" })
export class PowerAction extends SingletonAction {
  // The keys whose press failed, which show their alert once their state is redrawn.
  private readonly owedAlerts = new Set<string>();
  private readonly latestSettings = new Map<string, JsonObject>();

  /** Subscribes the keys to every change made to the lamps, and to the global settings, which choose their lamps. */
  constructor() {
    super();
    // Every Power key follows the lamps, whichever key or dial changed them, this one included (#57), and whether it
    // adds new lamps (#147).
    onLampsChanged(() => this.syncEveryKey());
    onGlobalSettingsChanged(() => this.syncEveryKey());
  }

  /** Shows its lamps' state on a key as soon as it is placed or shown. */
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    this.latestSettings.set(ev.action.id, ev.payload.settings);
    if (ev.action.isKey()) {
      await ev.action.setState(await this.readState(this.lampsOf(ev.action.id)));
    }
  }

  /** Takes the settings changed on the settings page, and shows the state of the lamps the key now has. */
  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent): Promise<void> {
    this.latestSettings.set(ev.action.id, ev.payload.settings);
    if (ev.action.isKey()) {
      await ev.action.setState(await this.readState(this.lampsOf(ev.action.id)));
    }
  }

  /**
   * Turns the key's lamps on or off, or toggles them, as its mode says. The keys follow through the subscription. When a
   * lamp fails, the key's alert waits for that redraw (#132): a state set right after an alert covers it, while an alert
   * shown after the state stays. Every operation calls the subscription, the failed ones included.
   */
  override onKeyDown(ev: KeyDownEvent): void {
    this.latestSettings.set(ev.action.id, ev.payload.settings);
    const { mode, ...saved } = parseSettings(ev.payload.settings, powerSettings, logger);
    const lamps = keyLamps(ev.action.id, saved);
    logger.info(`Key pressed: ${mode}, on ${describeLamps(lamps)}`);
    const result = mode === "on" ? turnLampsOn(lamps) : mode === "off" ? turnLampsOff(lamps) : toggleLamps(lamps);

    // Before the subscription runs, which litra-manager calls once the operation has returned.
    if (!result.ok) {
      this.owedAlerts.add(ev.action.id);
    }
  }

  /**
   * Shows its lamps' state on every visible Power key, from one read for each set of lamps the keys have, then the alert
   * a key owes, if any.
   */
  private async syncEveryKey(): Promise<void> {
    const states = new Map<string, 0 | 1>();
    for (const action of this.actions) {
      if (action.isKey()) {
        const lamps = this.lampsOf(action.id);
        const selection = JSON.stringify(lamps);
        let state = states.get(selection);
        if (state === undefined) {
          state = await this.readState(lamps);
          states.set(selection, state);
        }
        await action.setState(state);
        if (this.owedAlerts.delete(action.id)) {
          await action.showAlert();
        }
      }
    }
  }

  /** The lamps a key acts on, from the settings it was last seen with. */
  private lampsOf(id: string): LampSelection {
    return keyLamps(id, parseSettings(this.latestSettings.get(id) ?? {}, lampSettings, logger));
  }

  /** A key's state: on (1) only if there is a lamp among its own and every one is on. */
  private async readState(lamps: LampSelection): Promise<0 | 1> {
    const { allOn, deviceCount } = await areLampsOn(lamps);
    return deviceCount > 0 && allOn ? 1 : 0;
  }
}
