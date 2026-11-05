import {
  type DialDownEvent,
  type DialRotateEvent,
  type DidReceiveSettingsEvent,
  type KeyDownEvent,
  SingletonAction,
  type TouchTapEvent,
  type WillAppearEvent,
  type WillDisappearEvent,
} from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import { globalSettings } from "../global-settings";
import { onLampsChanged } from "../litra-manager";

/** A key or a dial, as the SDK hands it to an action: what the plugin shows on it, and its alert. */
export type DeckControl = WillAppearEvent["action"];

/**
 * One key or dial of an action, from when it appears to when it disappears (#198). It holds the key or dial, as the SDK
 * hands it, and its settings as a `config`, read against their schema from what Stream Deck last sent, so no handler
 * reads them on its own: a setting that isn't valid is warned about once, as it arrives, not at every press. It also
 * holds what only matters while it's on screen, such as a press it still owes an alert for.
 *
 * Its action, a {@link RoutingAction}, creates it and hands it every event of its key or dial. Each method does nothing
 * unless the instance needs it.
 */
export abstract class ActionInstance<Config, Control extends DeckControl = DeckControl> {
  /** The settings as last read, as Stream Deck sent them, so they're read again only when they change. */
  private saved: string;
  /** The settings, as last read against their schema. */
  protected config: Config;

  /** Takes the key or dial, its settings as Stream Deck sent them, and how to read them against their schema. */
  protected constructor(
    readonly control: Control,
    settings: JsonObject,
    private readonly read: (settings: JsonObject) => Config,
  ) {
    this.saved = JSON.stringify(settings);
    this.config = read(settings);
  }

  /**
   * Takes the settings an event carries, which are the ones Stream Deck holds for the key or dial, and reads them again
   * if they changed.
   */
  take(settings: JsonObject): void {
    const saved = JSON.stringify(settings);
    if (saved !== this.saved) {
      this.saved = saved;
      this.config = this.read(settings);
    }
  }

  /** Draws the key or dial as it appears. */
  appear(): Promise<void> | void {}

  /** Lets go of what the key or dial holds, once it's no longer shown. */
  disappear(): Promise<void> | void {}

  /** Redraws the key or dial once its settings were changed on its settings page. */
  settingsChanged(): Promise<void> | void {}

  /** Redraws the key or dial once an operation changed the lamps, whichever key or dial asked for it. */
  lampsChanged(): Promise<void> | void {}

  /** Redraws the key or dial once a page changed the global settings. */
  globalSettingsChanged(): Promise<void> | void {}

  /** Acts on a key's press. */
  keyDown(): Promise<void> | void {}

  /** Acts on a dial's push. */
  dialDown(): Promise<void> | void {}

  /** Acts on a dial's turn, by its ticks: positive clockwise, negative counterclockwise. */
  dialRotate(_ticks: number): Promise<void> | void {}

  /** Acts on a tap on a dial's part of the touch strip, or on holding it. */
  touchTap(_hold: boolean): Promise<void> | void {}
}

/**
 * An action as the SDK registers it: one for each action type in the manifest, which gets the events of every key and
 * dial of that type (see `docs/elgato_sdk/actions.md`). It creates an {@link ActionInstance} for each key or dial as it
 * appears, drops it as it disappears, and hands it the key's or dial's events, with the settings they carry. The SDK
 * sends the events of the keys and dials on screen alone, so every event finds its instance.
 *
 * It also hands every instance the news that the lamps or the global settings changed, which it subscribes to once.
 */
export abstract class RoutingAction<Instance extends ActionInstance<unknown>> extends SingletonAction {
  private readonly instances = new Map<string, Instance>();

  /** Subscribes to every change made to the lamps, and to the global settings, for its instances. */
  constructor() {
    super();
    onLampsChanged(() => this.forEachInstance((instance) => instance.lampsChanged()));
    globalSettings.onChanged(() => this.forEachInstance((instance) => instance.globalSettingsChanged()));
  }

  /**
   * The instance for a key or dial that appears, with the settings Stream Deck holds for it, or undefined for a
   * controller the manifest doesn't list for the action, whose events are then ignored.
   */
  protected abstract create(control: DeckControl, settings: JsonObject): Instance | undefined;

  /** Creates the key's or dial's instance, and lets it draw itself. */
  override async onWillAppear(ev: WillAppearEvent): Promise<void> {
    const instance = this.create(ev.action, ev.payload.settings);
    if (instance === undefined) {
      return;
    }
    this.instances.set(ev.action.id, instance);
    await instance.appear();
  }

  /** Drops the key's or dial's instance, once it lets go of what it holds. */
  override async onWillDisappear(ev: WillDisappearEvent): Promise<void> {
    const instance = this.instances.get(ev.action.id);
    this.instances.delete(ev.action.id);
    await instance?.disappear();
  }

  /** Hands the key's or dial's instance its new settings, and lets it redraw. */
  override async onDidReceiveSettings(ev: DidReceiveSettingsEvent): Promise<void> {
    await this.take(ev)?.settingsChanged();
  }

  /** Hands a key's press to its instance. */
  override async onKeyDown(ev: KeyDownEvent): Promise<void> {
    await this.take(ev)?.keyDown();
  }

  /** Hands a dial's push to its instance. */
  override async onDialDown(ev: DialDownEvent): Promise<void> {
    await this.take(ev)?.dialDown();
  }

  /** Hands a dial's turn to its instance. */
  override async onDialRotate(ev: DialRotateEvent): Promise<void> {
    await this.take(ev)?.dialRotate(ev.payload.ticks);
  }

  /** Hands a tap on a dial's part of the touch strip, or holding it, to its instance. */
  override async onTouchTap(ev: TouchTapEvent): Promise<void> {
    await this.take(ev)?.touchTap(ev.payload.hold);
  }

  /** The instance of an event's key or dial, once it took the settings the event carries. */
  private take(ev: { action: { id: string }; payload: { settings: JsonObject } }): Instance | undefined {
    const instance = this.instances.get(ev.action.id);
    instance?.take(ev.payload.settings);
    return instance;
  }

  /** Runs something on every instance, one after the other. */
  private async forEachInstance(run: (instance: Instance) => Promise<void> | void): Promise<void> {
    for (const instance of [...this.instances.values()]) {
      await run(instance);
    }
  }
}
