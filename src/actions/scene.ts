import { action, type KeyDownEvent, SingletonAction } from "@elgato/streamdeck";

import { globalSettings } from "../global-settings";
import { type LampSelection, type SceneGroup, setLampsScene } from "../litra-manager";
import { logger as pluginLogger } from "../logging";
import { describeLamps, parseSettings, sceneGroupSettings, sceneSettings } from "./settings";

const logger = pluginLogger.createScope("Scene");

/**
 * The Scene key: sets its lamps to its scene, in one press (#86). A scene is made of groups, each of which turns its
 * lamps off, or on at its own brightness and temperature (#174). The first group takes the lamps the key picks, but
 * the ones the groups added after it check. It shows only its image, and the dials and Power keys follow the lamps
 * through litra-manager's notice.
 */
@action({ UUID: "com.daczarne.litra.scene" })
export class SceneAction extends SingletonAction {
  /** Sets the key's lamps to its scene, and shows an alert when a lamp can't be set. */
  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    const { addedGroups, ...first } = parseSettings(ev.payload.settings, sceneSettings, logger);
    const added = addedGroups.map((group) => parseSettings(group, sceneGroupSettings, logger));
    const taken = added.flatMap((group) => group.lamps);
    const groups = [
      sceneGroup({ ...first, lamps: without(globalSettings.actionKeyLamps(ev.action.id, first), taken) }),
      ...added.map(sceneGroup),
    ];
    logger.info(`Key pressed: scene ${groups.map(describeGroup).join("; ")}`);
    const result = await setLampsScene(groups);
    if (!result.ok) {
      await ev.action.showAlert();
    }
  }
}

/** A group as litra-manager takes it, from its settings. */
function sceneGroup(settings: {
  power: "on" | "off";
  presetPercentage: number;
  presetKelvin: number;
  lamps: LampSelection;
}): SceneGroup {
  return {
    lamps: settings.lamps,
    on: settings.power === "on",
    percentage: settings.presetPercentage,
    kelvin: settings.presetKelvin,
  };
}

/** A selection of lamps but the ones with these ids. */
function without(lamps: LampSelection, ids: readonly string[]): LampSelection {
  if (ids.length === 0) {
    return lamps;
  }
  if (lamps === "all") {
    return { except: ids };
  }
  if ("except" in lamps) {
    return { except: [...new Set([...lamps.except, ...ids])] };
  }
  return lamps.filter((id) => !ids.includes(id));
}

/** A group as the log line tells it: what it sets its lamps to, and which lamps. */
function describeGroup(group: SceneGroup): string {
  const setting = group.on ? `${group.percentage}% at ${group.kelvin} K` : "off";
  return `${setting} on ${describeLamps(group.lamps)}`;
}
