import type { FontWeight, SavedTextStyle, TextStyleName } from "../settings/schema";

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
