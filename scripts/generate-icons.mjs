#!/usr/bin/env node
/**
 * Generates the plugin's icons, rendered to the PNG sizes Stream Deck requires (1x and `@2x`). The glyphs come from
 * `@daczarne/streamdeck-icons`, which also builds the Litra icon pack: this script only decides which glyph goes where,
 * and at what size.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import {
  actionIconBrightness,
  actionIconPower,
  actionIconScene,
  actionIconTemperature,
  brightnessGlyph,
  categoryGlyph,
  marketplaceGlyph,
  powerGlyph,
  sceneGlyph,
  svgDoc,
  temperatureGlyph,
} from "@daczarne/streamdeck-icons";
import sharp from "sharp";

const root = path.resolve("com.daczarne.litra.sdPlugin/imgs");

/**
 * Renders a glyph to a square PNG, creating its folder if needed.
 *
 * @param {string} filePath where to write the PNG
 * @param {string} svg the glyph's SVG elements, without the document around them
 * @param {number} size the PNG's width and height, in pixels
 * @returns {Promise<void>}
 */
async function writePng(filePath, svg, size) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  await sharp(Buffer.from(svgDoc(size, svg)))
    .png()
    .toFile(filePath);
  console.log("wrote", filePath);
}

/**
 * Renders a glyph at the size Stream Deck asks for and at twice that size, for high-density screens.
 *
 * @param {string} basePathNoExt the path of the PNGs, without `.png` or `@2x.png`
 * @param {(size: number) => string} svgAt1x draws the glyph's SVG elements at a size
 * @param {number} size1x the smaller PNG's width and height, in pixels
 * @returns {Promise<void>}
 */
async function writePair(basePathNoExt, svgAt1x, size1x) {
  await writePng(`${basePathNoExt}.png`, svgAt1x(size1x), size1x);
  await writePng(`${basePathNoExt}@2x.png`, svgAt1x(size1x * 2), size1x * 2);
}

/**
 * Renders every icon the plugin uses, at the sizes Stream Deck asks for each.
 *
 * @returns {Promise<void>}
 */
async function main() {
  // Power key states (72 / 144)
  await writePair(path.join(root, "actions/power/key-off"), (s) => powerGlyph(s, { on: false }), 72);
  await writePair(path.join(root, "actions/power/key-on"), (s) => powerGlyph(s, { on: true }), 72);

  // Brightness and Temperature glyphs (72 / 144), shown on the keys, on the touch strip and in the app's dial canvas
  await writePair(path.join(root, "actions/brightness/glyph"), (s) => brightnessGlyph(s), 72);
  await writePair(path.join(root, "actions/temperature/glyph"), (s) => temperatureGlyph(s), 72);

  // Scene key (72 / 144)
  await writePair(path.join(root, "actions/scene/key"), (s) => sceneGlyph(s), 72);

  // Action list icons (20 / 40) — monochrome white
  await writePair(path.join(root, "actions/power/icon"), (s) => actionIconPower(s), 20);
  await writePair(path.join(root, "actions/brightness/icon"), (s) => actionIconBrightness(s), 20);
  await writePair(path.join(root, "actions/temperature/icon"), (s) => actionIconTemperature(s), 20);
  await writePair(path.join(root, "actions/scene/icon"), (s) => actionIconScene(s), 20);

  // Category (28 / 56)
  await writePair(path.join(root, "plugin/category-icon"), (s) => categoryGlyph(s), 28);

  // Marketplace (256 / 512)
  await writePair(path.join(root, "plugin/marketplace"), (s) => marketplaceGlyph(s), 256);

  console.log("Icons generated.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
