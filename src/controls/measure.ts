import type { DialAction, FeedbackPayload } from "@elgato/streamdeck";
import type { JsonObject } from "@elgato/utils";
import type { Logger } from "@elgato/utils/logging";
import { type OperationResult, type Stepping, toggleLamps } from "../lamps/manager";
import type { LampSelection } from "../lamps/selection";
import { globalSettings } from "../settings/global-settings";
import { ActionInstance, type DeckControl, RoutingAction } from "./action-instance";
import { createDebouncer } from "./debouncer";
import { type Glyph, iconOf } from "./icons";
import { LampScreen } from "./lamp-screens";

// Where fewer lamps reach, a dial's bar fades its color, keeping this share of its distance from the end it fades
// towards, out of 0xff: a light color fades towards black, so white fades to a mid-grey, as it did before the bar took
// a text style's color (#59, #183), and a dark color fades towards white, since black has nothing darker to fade to,
// and a dark grey would get darker where fewer lamps reach. Either way, the color chosen is where every lamp reaches.
const FAINTEST_BAR_SHARE = 0x80;

/**
 * The bar a Brightness or Temperature dial's main screen shows, in its layout's indicator, for each lamp's
 * place in its range, in %: filled up to the highest one, in a color as `#rrggbb`, and banded by how many lamps reach
 * each part of it (#59, #183, #229).
 */
export function bar(levels: readonly number[], color: string): { value: number; bar_fill_c: string } {
  return { value: Math.max(0, ...levels), bar_fill_c: barFill(levels, color) };
}

/**
 * The fill of a dial's bar for each lamp's place in its range, in %: its color, as `#rrggbb`, up to the lowest one,
 * then fainter for each level fewer lamps reach, so the bar shows that only some lamps go that far (#59, #183). A
 * gradient's stops span the bar's filled part, which ends at the highest level, so each level is placed as a share of
 * that one. Two stops 0.001 apart draw a sharp edge.
 */
export function barFill(levels: readonly number[], color: string): string {
  const highest = Math.max(0, ...levels);
  const distinct = [...new Set(levels)].filter((level) => level > 0).sort((a, b) => a - b);
  if (distinct.length === 0 || (distinct.length === 1 && levels.every((level) => level === highest))) {
    return color;
  }
  const offset = (share: number): number => Number(Math.min(1, share).toFixed(3));
  const stops: string[] = [];
  let start = 0;
  for (const level of distinct) {
    const reaching = levels.filter((other) => other >= level).length / levels.length;
    const faded = fade(color, FAINTEST_BAR_SHARE + (0xff - FAINTEST_BAR_SHARE) * reaching);
    const end = level / highest;
    stops.push(`${offset(start)}:${faded}`, `${offset(end)}:${faded}`);
    start = end + 0.001;
  }
  return stops.join(",");
}

/**
 * A color, as `#rrggbb`, faded towards black when it's light, and towards white when it's dark, as its brightness, by
 * Rec. 709's weights of its channels, falls above or below the middle: each channel keeps a share of its distance from
 * that end, out of 0xff, rounded, so white at a share of 0xc0 is `#c0c0c0`, and black `#3f3f3f`.
 */
function fade(color: string, share: number): string {
  const channels = [1, 3, 5].map((start) => Number.parseInt(color.slice(start, start + 2), 16));
  const [red = 0, green = 0, blue = 0] = channels;
  const towards = 0.2126 * red + 0.7152 * green + 0.0722 * blue < 0x80 ? 0xff : 0;
  const faded = channels.map((channel) =>
    Math.round(towards + ((channel - towards) * share) / 0xff)
      .toString(16)
      .padStart(2, "0"),
  );
  return `#${faded.join("")}`;
}

/**
 * What a Brightness or Temperature dial's main screen shows of every lamp, in the slots of its layout, a copy of $B1:
 * the title the plugin settings give its action's dials, which a dial with a title of its own shows instead (#181), the
 * value as text, and each lamp's place in its range, in %, which the bar under it shows, before the dial gives them
 * their colors (#183).
 */
export type MainScreen = { title: string; value: string; levels: readonly number[] };

/**
 * What a Brightness or Temperature dial steps: what a turn adjusts, which describes a turn on a lamp screen, how it
 * reads its step and its own title from its settings, an empty one when it has none (#181), the unit its log line gives
 * the step in, how the global settings step several lamps (#145), whether they have a turn on its main screen or on a
 * lamp screen turn the lamps on, for the dial, by its id (#268, #181), how it moves the lamps by its step, the glyph
 * its main screen's icon is drawn from, and what its main screen shows of every lamp, its title included.
 */
export type Measure = {
  adjusts: string;
  readSettings: (settings: JsonObject, logger: Logger) => DialSettings;
  unit: string;
  stepping: () => Stepping;
  turnsLampsOn: (screen: "main" | "lamp", dialId: string) => boolean;
  adjust: (
    lamps: LampSelection,
    ticks: number,
    step: number,
    stepping: Stepping,
    turnOn: boolean,
  ) => Promise<OperationResult>;
  glyph: Glyph;
  mainScreen: () => Promise<MainScreen>;
};

/** What a Brightness or Temperature dial's settings hold: its step, and its own title, or an empty one (#181). */
export type DialSettings = { step: number; title: string };

/** The Brightness or the Temperature dial action, which gives each dial a {@link MeasureDial}. */
export abstract class MeasureAction extends RoutingAction<MeasureDial> {
  /** Takes the action's logger, and what its dials step. */
  constructor(
    private readonly logger: Logger,
    private readonly measure: Measure,
  ) {
    super();
  }

  /** A dial that steps the lamps: the manifest places the action on dials alone. */
  protected override create(control: DeckControl, settings: JsonObject): MeasureDial | undefined {
    return control.isDial() ? new MeasureDial(control, settings, this.logger, this.measure) : undefined;
  }
}

/**
 * A Brightness or Temperature dial. On its main screen, it steps every lamp as it turns, toggles them when
 * pushed, and shows what they're at. Tapping its strip shows each lamp on its own screen, where turning and pushing it
 * act on that lamp alone, and holding the strip blinks it (#20). Its {@link LampScreen} draws it there, and tells which
 * lamp it shows.
 */
class MeasureDial extends ActionInstance<DialSettings, DialAction<JsonObject>> {
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
    super(control, settings, (saved) => measure.readSettings(saved, logger));
    this.screen = new LampScreen(control, { showMain: () => this.showMainScreen(), adjusts: measure.adjusts });
  }

  /** Starts the dial on its main screen, with what the lamps are at. */
  override async appear(): Promise<void> {
    await this.screen.appear();
    await this.showMainScreen();
  }

  /** Redraws the main screen, whose title may have changed (#181), and leaves a lamp screen as it is. */
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

  /**
   * Redraws the lamp on screen, whose cells and text styles are global settings (#153, #177), or the main screen, whose
   * colors are too (#183).
   */
  override globalSettingsChanged(): Promise<void> {
    return this.screen.isShowing ? this.screen.refresh() : this.showMainScreen();
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
   * Whether a turn also turns the lamps on is the global settings', for the main screen and the lamp screens apart
   * (#268).
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
    const turnOn = this.measure.turnsLampsOn(lamp === undefined ? "main" : "lamp", this.control.id);
    const screen = lamp === undefined ? "" : " on a lamp screen";
    const each = stepping === "each" ? ", each lamp from its own" : "";
    const turning = turnOn ? ", turning lamps on" : "";
    const turned = `${ticks} ${Math.abs(ticks) === 1 ? "tick" : "ticks"} of ${step}${this.measure.unit}`;
    this.logger.info(`Dial turned${screen}: ${turned}${each}${turning}`);
    const lamps = lamp === undefined ? "connected" : [lamp];
    const result = await this.measure.adjust(lamps, ticks, step, stepping, turnOn);
    if (!result.ok) {
      await this.control.showAlert();
    }
  }

  /**
   * Fills the main screen's layout with the dial's own title, or its action's when it has none (#181), and what the
   * lamps are at, its title, its icon, its value and its bar each in the color of the text style the global settings
   * give it (#183), unless the dial shows a lamp screen, which has another layout, which its lamp screen draws. Nothing
   * is worked out then.
   */
  private async showMainScreen(): Promise<void> {
    if (this.screen.isShowing) {
      return;
    }
    const { title, value, levels } = await this.measure.mainScreen();
    const colors = globalSettings.mainScreenColors;
    const feedback: FeedbackPayload = {
      heading: { value: this.config.title === "" ? title : this.config.title, color: colors.title },
      icon: iconOf(this.measure.glyph, colors.icon),
      value: { value, color: colors.value },
      indicator: bar(levels, colors.bar),
    };
    // A tap may have shown a lamp screen while the main screen was worked out, after the operations queued.
    if (!this.screen.isShowing) {
      await this.control.setFeedback(feedback);
    }
  }
}
