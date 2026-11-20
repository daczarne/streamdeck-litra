import type { FontWeight, SavedTextStyle, StartColor, TextStyleName } from "../settings/schemas";

/** A text's look on the lamp screens, as a layout's text slot takes it: its color, and its font's size and weight. */
export type TextStyle = { color: string; font: { size: number; weight: number } };

/** The lamp screens' text styles, by name (#153), as a layout's text slots take them. */
export type TextStyles = Record<TextStyleName, TextStyle>;

// The font weights the settings offer, as a layout's text takes them.
const FONT_WEIGHTS: Record<FontWeight, number> = { normal: 400, bold: 700 };

/** A text's look, as a layout's text slot takes it, from a color, a weight and a size as the settings keep them. */
export function textStyle({ color, weight, size }: SavedTextStyle): TextStyle {
  return { color, font: { size, weight: FONT_WEIGHTS[weight] } };
}

/** The lamp screens' text styles, as a layout's text slots take them, from the ones the settings keep (#153). */
export function textStylesOf(saved: Record<TextStyleName, SavedTextStyle>): TextStyles {
  return {
    primary: textStyle(saved.primary),
    secondary: textStyle(saved.secondary),
    accent: textStyle(saved.accent),
    alert: textStyle(saved.alert),
  };
}

// The colors a dial can show the lamp it starts on in, by the names its settings keep: bright enough to read on the
// strip's black at the lamp screens' sizes, at hues apart from one another and from the Alert and Accent styles'
// defaults. Gold and green are the icons' own, from @daczarne/streamdeck-icons' palette.
const START_COLOR_VALUES: Record<Exclude<StartColor, "default">, string> = {
  gold: "#f5c542",
  orange: "#ff9f43",
  green: "#4cbf68",
  blue: "#6fa8ff",
  violet: "#b39dff",
  magenta: "#e77bf0",
};

/**
 * The text styles with the Primary style in a dial's color, as the lamp it starts on shows them, or as they are for
 * "default". The other styles keep their colors, so what they set apart stays apart.
 */
export function withPrimaryIn(styles: TextStyles, color: StartColor): TextStyles {
  return color === "default" ? styles : { ...styles, primary: { ...styles.primary, color: START_COLOR_VALUES[color] } };
}
