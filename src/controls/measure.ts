import type { DialAction, FeedbackPayload, KeyAction } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import type { Logger } from "@elgato/utils/logging";
import { type OperationResult, type Stepping, toggleLamps } from "../lamps/manager";
import type { LampSelection } from "../lamps/selection";
import { globalSettings } from "../settings/global-settings";
import type { CheckedLamps } from "../settings/schemas";
import { ActionInstance, type DeckControl, RoutingAction } from "./action-instance";
import { createDebouncer } from "./debouncer";
import { describeLamps } from "./describe-lamps";
import { LampScreen } from "./lamp-screens";

// Where fewer lamps reach, a dial's bar fades from white towards this grey, never as far as the bar's own background,
// and light enough to read on the strip.
const FAINTEST_BAR_GREY = 0x80;

/**
 * The bar a Set Brightness or Set Temperature dial's main screen shows, in the $B1 layout's indicator, for each lamp's
 * place in its range, in %: filled up to the highest one, and banded by how many lamps reach each part of it (#59,
 * #229).
 */
export function bar(levels: readonly number[]): { value: number; bar_fill_c: string } {
  return { value: Math.max(0, ...levels), bar_fill_c: barFill(levels) };
}

/**
 * The fill of a dial's bar for each lamp's place in its range, in %: white up to the lowest one, then fainter for each
 * level fewer lamps reach, so the bar shows that only some lamps go that far (#59). A gradient's stops span the bar's
 * filled part, which ends at the highest level, so each level is placed as a share of that one. Two stops 0.001 apart
 * draw a sharp edge.
 */
export function barFill(levels: readonly number[]): string {
  const highest = Math.max(0, ...levels);
  const distinct = [...new Set(levels)].filter((level) => level > 0).sort((a, b) => a - b);
  if (distinct.length === 0 || (distinct.length === 1 && levels.every((level) => level === highest))) {
    return "white";
  }
  const offset = (share: number): number => Number(Math.min(1, share).toFixed(3));
  const stops: string[] = [];
  let start = 0;
  for (const level of distinct) {
    const reaching = levels.filter((other) => other >= level).length / levels.length;
    const grey = Math.round(FAINTEST_BAR_GREY + (0xff - FAINTEST_BAR_GREY) * reaching)
      .toString(16)
      .padStart(2, "0");
    const color = `#${grey}${grey}${grey}`;
    const end = level / highest;
    stops.push(`${offset(start)}:${color}`, `${offset(end)}:${color}`);
    start = end + 0.001;
  }
  return stops.join(",");
}

/**
 * What a Set Brightness or Set Temperature key does: how it reads its preset and its lamps from its settings, the unit
 * its title and its log line give the preset in, and how it sets its lamps to it.
 */
export type Preset = {
  read: (
    settings: JsonObject,
    logger: Logger,
  ) => { preset: number; lamps: CheckedLamps; leftOutLamps: readonly string[] };
  unit: string;
  set: (lamps: LampSelection, preset: number) => Promise<OperationResult>;
};

/**
 * What a Set Brightness or Set Temperature dial steps: what a turn adjusts, which describes a turn on a lamp screen,
 * how it reads its step from its settings, the unit its log line gives the step in, how the global settings step
 * several lamps (#145), how it moves the lamps by its step, and what its main screen shows of every lamp, its title
 * included.
 */
export type Measure = {
  adjusts: string;
  readStep: (settings: JsonObject, logger: Logger) => number;
  unit: string;
  stepping: () => Stepping;
  adjust: (lamps: LampSelection, ticks: number, step: number, stepping: Stepping) => Promise<OperationResult>;
  mainScreen: () => Promise<FeedbackPayload>;
};

/**
 * The Set Brightness or the Set Temperature action, which gives each key a {@link PresetKey} and each dial a
 * {@link MeasureDial}.
 */
export abstract class MeasureAction extends RoutingAction<PresetKey | MeasureDial> {
  /** Takes the action's logger, and what its keys set and its dials step. */
  constructor(
    private readonly logger: Logger,
    private readonly preset: Preset,
    private readonly measure: Measure,
  ) {
    super();
  }

  /**
   * A key that sets its preset, or a dial that steps the lamps: the manifest places the action on keys and dials alone.
   */
  protected override create(control: DeckControl, settings: JsonObject): PresetKey | MeasureDial | undefined {
    if (control.isKey()) {
      return new PresetKey(control, settings, this.logger, this.preset);
    }
    return control.isDial() ? new MeasureDial(control, settings, this.logger, this.measure) : undefined;
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
   * Sets the key's lamps to its preset. The dials follow through the lamp manager's notice, with what the lamps
   * reached, which is less for a lamp at its cap, or a temperature snapped to one it allows.
   */
  override async keyDown(): Promise<void> {
    const { preset } = this.config;
    const lamps = globalSettings.actionKeyLamps(this.control.id, this.config);
    this.logger.info(`Key pressed: preset ${preset}${this.preset.unit}, on ${describeLamps(lamps)}`);
    const result = await this.preset.set(lamps, preset);
    if (!result.ok) {
      await this.control.showAlert();
    }
  }

  /** Writes the preset as the key's title, with its unit, as the step keys and the dials show their value. */
  private async showPreset(): Promise<void> {
    await this.control.setTitle(`${Math.round(this.config.preset)}${this.preset.unit}`);
  }
}

/**
 * A Set Brightness or Set Temperature dial. On its main screen, it steps every lamp as it turns, toggles them when
 * pushed, and shows what they're at. Tapping its strip shows each lamp on its own screen, where turning and pushing it
 * act on that lamp alone, and holding the strip blinks it (#20). Its {@link LampScreen} draws it there, and tells which
 * lamp it shows.
 */
class MeasureDial extends ActionInstance<{ step: number }, DialAction<JsonObject>> {
  /** The ticks gathered for each lamp the dial turns, by its id, or "all" for its main screen. */
  private readonly queues = new Map<string, (ticks: number) => void>();
  /** The dial's lamp screens, which tell which lamp it shows, if any. */
  private readonly screen: LampScreen;

  /** Takes the dial, its settings, the action's logger, and what it steps. */
  constructor(
    control: DialAction<JsonObject>,
    settings: JsonObject,
    private readonly logger: Logger,
    private readonly measure: Measure,
  ) {
    super(control, settings, (saved) => ({ step: measure.readStep(saved, logger) }));
    this.screen = new LampScreen(control, { showMain: () => this.showMainScreen(), adjusts: measure.adjusts });
  }

  /** Starts the dial on its main screen, with what the lamps are at. */
  override async appear(): Promise<void> {
    await this.screen.appear();
    await this.showMainScreen();
  }

  /** Redraws the main screen, which the new step doesn't change, and leaves a lamp screen as it is. */
  override settingsChanged(): Promise<void> {
    return this.showMainScreen();
  }

  /**
   * Shows what the lamps are at, whichever key or dial changed them: every lamp on the main screen, or the lamp on
   * screen, which goes back to the main screen once it's no longer connected.
   */
  override lampsChanged(): Promise<void> {
    return this.screen.isShowing ? this.screen.refresh() : this.showMainScreen();
  }

  /** Redraws the lamp on screen, if any, whose cells and text styles are global settings (#153, #177). */
  override globalSettingsChanged(): Promise<void> {
    return this.screen.refresh();
  }

  /** Toggles every lamp from the main screen, or the lamp on screen from a lamp screen. */
  override async dialDown(): Promise<void> {
    const lamp = this.screen.lamp;
    this.logger.info(lamp === undefined ? "Dial pressed: toggle" : "Dial pressed on a lamp screen: toggle");
    const result = await toggleLamps(lamp === undefined ? "connected" : [lamp]);
    if (!result.ok) {
      await this.control.showAlert();
    }
  }

  /** Tapping the strip shows the lamps one by one, and holding it on a lamp screen blinks the lamp on screen. */
  override async touchTap(hold: boolean): Promise<void> {
    if (hold) {
      if (!this.screen.isShowing) {
        this.logger.info("Strip held on the main screen: nothing to do");
        return;
      }
      this.logger.info("Strip held: identify");
      await this.screen.identify();
      return;
    }
    this.logger.info("Strip tapped: next screen");
    await this.screen.tap();
  }

  /**
   * Steps by the dial's ticks, gathered for a moment so a quick turn moves the lamps once, by the step the dial has
   * when they're applied. Ticks go to what the dial showed as it turned: every lamp from the main screen, together or
   * each from its own as the global settings say (#145), or the lamp on screen, even when the strip is tapped before
   * they're applied, since each lamp gets its own queue. The dials follow through the lamp manager's notice.
   */
  override dialRotate(ticks: number): void {
    const lamp = this.screen.lamp;
    const queueId = lamp ?? "all";
    let queue = this.queues.get(queueId);
    if (queue === undefined) {
      queue = createDebouncer((gathered) => this.step(lamp, gathered), this.logger);
      this.queues.set(queueId, queue);
    }
    queue(ticks);
  }

  /** Moves every lamp, or the lamp of a lamp screen alone, by some ticks of the dial's step. */
  private async step(lamp: string | undefined, ticks: number): Promise<void> {
    const { step } = this.config;
    // A lamp screen turns its lamp alone, and the main screen every lamp, together or each from its own (#145).
    const stepping = lamp === undefined ? this.measure.stepping() : "together";
    const screen = lamp === undefined ? "" : " on a lamp screen";
    const each = stepping === "each" ? ", each lamp from its own" : "";
    const turned = `${ticks} ${Math.abs(ticks) === 1 ? "tick" : "ticks"} of ${step}${this.measure.unit}`;
    this.logger.info(`Dial turned${screen}: ${turned}${each}`);
    const result = await this.measure.adjust(lamp === undefined ? "connected" : [lamp], ticks, step, stepping);
    if (!result.ok) {
      await this.control.showAlert();
    }
  }

  /**
   * Fills the main screen's layout with what the lamps are at, unless the dial shows a lamp screen, which has another
   * layout, which its lamp screen draws. Nothing is worked out then.
   */
  private async showMainScreen(): Promise<void> {
    if (this.screen.isShowing) {
      return;
    }
    const feedback = await this.measure.mainScreen();
    // A tap may have shown a lamp screen while the main screen was worked out, after the operations queued.
    if (!this.screen.isShowing) {
      await this.control.setFeedback(feedback);
    }
  }
}
