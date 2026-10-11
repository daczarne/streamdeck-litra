/**
 * The style of the tiled icons: the colors of their tiles, glyphs and text, and their font. It was first drawn for the
 * monitor input switching keys, and colors are named by hue rather than by what they were first used for, since the
 * same palette serves every topic.
 */

/** The light ink of glyphs and text, on every tile except `grey`. */
export const WHITE = "#F2F2F2";

/** The dark ink of glyphs and text, on the `grey` tile. */
export const INK = "#24262B";

/** Tile backgrounds. The comments say what each was first used for, on the monitor keys. */
export const TILES = {
  teal: "#3F6E6E", // the left monitor
  blue: "#4C5F86", // the center monitor
  plum: "#6E4F70", // the top right monitor
  rust: "#8C5648", // the bottom right monitor
  slate: "#484C52", // every monitor
  green: "#3E6B4A", // desk mode, while it's off
  red: "#D64541", // desk mode, while it's on, framed in `ACCENTS.amber`
  // The lock key used one of #2E4A6B and #33517A: which one is to be read from its PNG.
  charcoal: "#2B2E33", // the dark neutral keys, with `WHITE` glyphs
  grey: "#9AA0A8", // the light neutral keys, the charcoal ones inverted, with `INK` glyphs
};

/** Colors that aren't tiles. */
export const ACCENTS = {
  amber: "#FFB020", // the frame of the desk mode key while it's on
  orange: "#E5892E", // the background of the dial's touch strip
};

/** The font of text on the tiles, in `WHITE` or `INK` like the glyphs. Google's Noto Sans, under the OFL. */
export const FONT_FAMILY = "Noto Sans";
