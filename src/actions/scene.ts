import { action, type KeyDownEvent, SingletonAction } from "@elgato/streamdeck";

import { setLampsScene } from "../litra-manager";
import { logger as pluginLogger } from "../logging";
import { keyLamps } from "./global-settings";
import { describeLamps, parseSettings, sceneSettings } from "./settings";

const logger = pluginLogger.createScope("Scene");

/**
 * The Scene key: turns its lamps on at the key's brightness and temperature, in one press (#86). It shows only its
 * image, and the dials and Power keys follow the lamps through litra-manager's notice.
 */
@action({ UUID: "com.daczarne.litra.scene" })
export class SceneAction extends SingletonAction {
  /** Sets the key's lamps to its scene, and shows an alert when a lamp can't be set. */
  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const { presetPercentage, presetKelvin, ...saved } = parseSettings(ev.payload.settings, sceneSettings, logger);
    const lamps = keyLamps(ev.action.id, saved);
    logger.info(`Key pressed: scene ${presetPercentage}% at ${presetKelvin} K, on ${describeLamps(lamps)}`);
    const result = await setLampsScene(lamps, presetPercentage, presetKelvin);
    if (!result.ok) {
      await ev.action.showAlert();
    }
  }
}
