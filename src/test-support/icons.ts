import { svgDoc } from "@daczarne/streamdeck-icons";

/**
 * An icon as the dials send it, on their main screens and their lamp screens: a glyph drawn in a color, white by
 * default, at 144 px, as an SVG data URL (#153, #183). It's built here on its own, so a test doesn't take the plugin's
 * drawing for granted.
 */
export function iconIn(glyph: (size: number, options: { color: string }) => string, color = "#ffffff"): string {
  return `data:image/svg+xml;base64,${Buffer.from(svgDoc(144, glyph(144, { color }))).toString("base64")}`;
}
