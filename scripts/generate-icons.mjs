#!/usr/bin/env node
/**
 * Generates the plugin's icons, rendered to the PNG sizes Stream Deck requires (1x and @2x). The glyphs come from
 * `@daczarne/streamdeck-icons`, which also builds the Litra icon pack: this script only decides which glyph goes where,
 * and at what size.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import {
  actionIconBrightness,
  actionIconPower,
  actionIconTemperature,
  brightnessGlyph,
  categoryGlyph,
  marketplaceGlyph,
  powerGlyph,
  svgDoc,
  temperatureGlyph,
} from "@daczarne/streamdeck-icons";
import sharp from "sharp";

const root = path.resolve("com.daczarne.litra.sdPlugin/imgs");

async function writePng(filePath, svg, size) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  await sharp(Buffer.from(svgDoc(size, svg)))
    .png()
    .toFile(filePath);
  console.log("wrote", filePath);
}

async function writePair(basePathNoExt, svgAt1x, size1x) {
  await writePng(`${basePathNoExt}.png`, svgAt1x(size1x), size1x);
  await writePng(`${basePathNoExt}@2x.png`, svgAt1x(size1x * 2), size1x * 2);
}

async function main() {
  // Power key states (72 / 144)
  await writePair(path.join(root, "actions/power/key-off"), (s) => powerGlyph(s, { on: false }), 72);
  await writePair(path.join(root, "actions/power/key-on"), (s) => powerGlyph(s, { on: true }), 72);

  // Brightness and Temperature glyphs (72 / 144), shown on the keys, on the touch strip and in the app's dial canvas
  await writePair(path.join(root, "actions/brightness/glyph"), (s) => brightnessGlyph(s), 72);
  await writePair(path.join(root, "actions/temperature/glyph"), (s) => temperatureGlyph(s), 72);

  // Action list icons (20 / 40) — monochrome white
  await writePair(path.join(root, "actions/power/icon"), (s) => actionIconPower(s), 20);
  await writePair(path.join(root, "actions/brightness/icon"), (s) => actionIconBrightness(s), 20);
  await writePair(path.join(root, "actions/temperature/icon"), (s) => actionIconTemperature(s), 20);

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
