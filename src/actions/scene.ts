import { action, type KeyDownEvent, SingletonAction } from "@elgato/streamdeck";

import { setSceneAll } from "../litra-manager";
import { logger as pluginLogger } from "../logging";
import { parseSettings, sceneSettings } from "./settings";

const logger = pluginLogger.createScope("Scene");

/**
 * The Scene key: turns every lamp on at the key's brightness and temperature, in one press (#86). It shows only its
 * image, and the dials and Power keys follow the lamps through litra-manager's notice.
 */
@action({ UUID: "com.daczarne.litra.scene" })
export class SceneAction extends SingletonAction {
  /** Sets every lamp to the key's scene, and shows an alert when a lamp can't be set. */
  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const { presetPercentage, presetKelvin } = parseSettings(ev.payload.settings, sceneSettings, logger);
    logger.info(`Key pressed: scene ${presetPercentage}% at ${presetKelvin} K`);
    const result = await setSceneAll(presetPercentage, presetKelvin);
    if (!result.ok) {
      await ev.action.showAlert();
    }
  }
}
