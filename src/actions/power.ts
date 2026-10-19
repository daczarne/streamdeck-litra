import { action, type KeyDownEvent, SingletonAction, type WillAppearEvent } from "@elgato/streamdeck";

import { areLampsOn, onLampsChanged, toggleLamps, turnLampsOff, turnLampsOn } from "../litra-manager";
import { logger as pluginLogger } from "../logging";
import { parseSettings, powerSettings } from "./settings";

const logger = pluginLogger.createScope("Power");

/** The Power key: turns the lamps on or off, or toggles them, and shows whether they are all on. */
@action({ UUID: "com.daczarne.litra.power" })
export class PowerAction extends SingletonAction {
  // The keys whose press failed, which show their alert once their state is redrawn.
  private readonly owedAlerts = new Set<string>();

  /** Subscribes the keys to every change made to the lamps. */
  constructor() {
    super();
    // Every Power key follows the lamps, whichever key or dial changed them, this one included (#57).
    onLampsChanged(() => this.syncEveryKey());
  }

  /** Shows the lamps' state on a key as soon as it is placed or shown. */
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    if (ev.action.isKey()) {
      await ev.action.setState(await this.readState());
    }
  }

  /**
   * Turns the lamps on or off, or toggles them, as the key's mode says. The keys follow through the subscription. When a
   * lamp fails, the key's alert waits for that redraw (#132): a state set right after an alert covers it, while an alert
   * shown after the state stays. Every operation calls the subscription, the failed ones included.
   */
  override onKeyDown(ev: KeyDownEvent): void {
    const { mode } = parseSettings(ev.payload.settings, powerSettings, logger);
    logger.info(`Key pressed: ${mode}`);
    const result = mode === "on" ? turnLampsOn("all") : mode === "off" ? turnLampsOff("all") : toggleLamps("all");

    // Before the subscription runs, which litra-manager calls once the operation has returned.
    if (!result.ok) {
      this.owedAlerts.add(ev.action.id);
    }
  }

  /** Shows the lamps' state on every visible Power key, from one read, then the alert a key owes, if any. */
  private async syncEveryKey(): Promise<void> {
    const state = await this.readState();
    for (const action of this.actions) {
      if (action.isKey()) {
        await action.setState(state);
        if (this.owedAlerts.delete(action.id)) {
          await action.showAlert();
        }
      }
    }
  }

  /** The key's state: on (1) only if there is a lamp and every lamp is on. */
  private async readState(): Promise<0 | 1> {
    const { allOn, deviceCount } = await areLampsOn("all");
    return deviceCount > 0 && allOn ? 1 : 0;
  }
}
