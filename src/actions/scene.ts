import { action, type KeyAction } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import { ActionInstance, type DeckControl, RoutingAction } from "../controls/action-instance";
import { describeLamps } from "../controls/describe-lamps";
import { type SceneGroup, setLampsScene } from "../lamps/manager";
import type { KeyLampSelection, LampSelection } from "../lamps/selection";
import { logger as pluginLogger } from "../logging";
import { globalSettings } from "../settings/global-settings";
import { type Parsed, parseSettings, sceneGroupSettingsSchema, sceneSettingsSchema } from "../settings/schemas";

const logger = pluginLogger.createScope("Scene");

/** The Scene action, which gives each Scene key its {@link SceneKey}. */
@action({ UUID: "com.daczarne.litra.scene" })
export class SceneAction extends RoutingAction<SceneKey> {
  /** A Scene key, for a key: the manifest places the action on keys alone. */
  protected override create(control: DeckControl, settings: JsonObject): SceneKey | undefined {
    return control.isKey() ? new SceneKey(control, settings) : undefined;
  }
}

/** A scene's settings: its first group's, the key's own, and the groups added after it, each read on its own. */
type SceneConfig = {
  first: Omit<Parsed<typeof sceneSettingsSchema>, "addedGroups">;
  added: Parsed<typeof sceneGroupSettingsSchema>[];
};

/** Reads a scene's settings, and each of its added groups, against their schemas. */
function readScene(settings: JsonObject): SceneConfig {
  const { addedGroups, ...first } = parseSettings(settings, sceneSettingsSchema, logger);
  return { first, added: addedGroups.map((group) => parseSettings(group, sceneGroupSettingsSchema, logger)) };
}

/**
 * A Scene key: sets its lamps to its scene, in one press (#86). A scene is made of groups, each of which turns its
 * lamps off, or on at its own brightness and temperature (#174). The first group takes the lamps the key picks, but
 * the ones the groups added after it check. It shows only its image, and the dials and Power keys follow the lamps
 * through the lamp manager's notice.
 */
class SceneKey extends ActionInstance<SceneConfig, KeyAction<JsonObject>> {
  /** Takes the key and its settings. */
  constructor(control: KeyAction<JsonObject>, settings: JsonObject) {
    super(control, settings, readScene);
  }

  /** Sets the key's lamps to its scene, and shows an alert when a lamp can't be set. */
  override async keyDown(): Promise<void> {
    const { first, added } = this.config;
    const taken = added.flatMap((group) => group.lamps);
    const groups = [
      sceneGroup({ ...first, lamps: without(globalSettings.actionKeyLamps(this.control.id, first), taken) }),
      ...added.map(sceneGroup),
    ];
    logger.info(`Key pressed: scene ${groups.map(describeGroup).join("; ")}`);
    const result = await setLampsScene(groups);
    if (!result.ok) {
      await this.control.showAlert();
    }
  }
}

/** A group as the lamp manager takes it, from its settings. */
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
function without(lamps: KeyLampSelection, ids: readonly string[]): KeyLampSelection {
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
