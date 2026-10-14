import { action, type KeyDownEvent, SingletonAction, type WillAppearEvent } from "@elgato/streamdeck";

import { isOnAll, onLampsChanged, toggleAll, turnOffAll, turnOnAll } from "../litra-manager";
import { logger as pluginLogger } from "../logging";
import { parseSettings, powerSettings } from "./settings";

const logger = pluginLogger.createScope("Power");

@action({ UUID: "com.daczarne.litra.power" })
export class PowerAction extends SingletonAction {
  constructor() {
    super();
    // Every Power key follows the lamps, whichever key or dial changed them, this one included (#57).
    onLampsChanged(() => this.syncEveryKey());
  }

  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    if (ev.action.isKey()) {
      await ev.action.setState(await this.readState());
    }
  }

  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const { mode } = parseSettings(ev.payload.settings, powerSettings, logger);
    logger.info(`Key pressed: ${mode}`);
    const result = mode === "on" ? turnOnAll() : mode === "off" ? turnOffAll() : toggleAll();

    if (!result.ok) {
      await ev.action.showAlert();
    }
  }

  /** Shows the lamps' state on every visible Power key, from one read. */
  private async syncEveryKey(): Promise<void> {
    const state = await this.readState();
    for (const action of this.actions) {
      if (action.isKey()) {
        await action.setState(state);
      }
    }
  }

  /** The key's state: on (1) only if there is a lamp and every lamp is on. */
  private async readState(): Promise<0 | 1> {
    const { allOn, deviceCount } = await isOnAll();
    return deviceCount > 0 && allOn ? 1 : 0;
  }
}
