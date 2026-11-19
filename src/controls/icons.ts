import { svgDoc } from "@daczarne/streamdeck-icons";

/** A glyph of `@daczarne/streamdeck-icons` that takes a color: it draws itself filling a square canvas of a size. */
export type Glyph = (size: number, options: { color: string }) => string;

// The dials' icons, on their main screens and their lamp screens, are drawn at the size of the glyph@2x.png that
// Encoder.Icon in the manifest points at, as an SVG a layout's pixmap takes as a data URL (#153, #183).
const ICON_SIZE = 144;

const drawnIcons = new Map<Glyph, Map<string, string>>();

/**
 * A glyph drawn in a color, as `#rrggbb`, as a data URL, drawn the first time it's asked for and kept, by glyph and
 * color, since a dial redraws it each time its screen changes.
 */
export function iconOf(glyph: Glyph, color: string): string {
  let byColor = drawnIcons.get(glyph);
  if (byColor === undefined) {
    byColor = new Map();
    drawnIcons.set(glyph, byColor);
  }
  let icon = byColor.get(color);
  if (icon === undefined) {
    const svg = svgDoc(ICON_SIZE, glyph(ICON_SIZE, { color }));
    icon = `data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`;
    byColor.set(color, icon);
  }
  return icon;
}
