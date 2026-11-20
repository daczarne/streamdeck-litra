#!/usr/bin/env node
/**
 * Generates the plugin's icons, rendered to the PNG sizes Stream Deck requires (1x and `@2x`), and the README's, one for
 * each of GitHub's light and dark themes. The glyphs come from `@daczarne/streamdeck-icons`, which also builds the Litra
 * icon pack: this script only decides which glyph goes where, and at what size.
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import {
  actionIconBrightness,
  actionIconBrightnessStep,
  actionIconPower,
  actionIconScene,
  actionIconTemperature,
  actionIconTemperatureStep,
  brightnessGlyph,
  brightnessStepGlyph,
  categoryGlyph,
  marketplaceGlyph,
  powerGlyph,
  sceneGlyph,
  svgDoc,
  temperatureGlyph,
  temperatureStepGlyph,
} from "@daczarne/streamdeck-icons";
import sharp from "sharp";

const root = path.resolve("com.daczarne.litra.sdPlugin/imgs");
// The README's images live outside the plugin folder, so the package leaves them out.
const readmeRoot = path.resolve("docs/images/actions");

/**
 * The README's actions table shows each action's outlined glyph, as its keys and dials draw it, in the color of
 * GitHub's text in each theme, with a link ending that GitHub reads to show only one of them: white for the dark theme,
 * and GitHub's near-black for the light one, on which a white icon would vanish.
 */
const README_THEMES = { dark: "#FFFFFF", light: "#1F2328" };

/** The size of the README's images, in pixels, as GitHub shows them, which is the size of the action list's `@2x`. */
const README_SIZE = 40;

/**
 * How much of its canvas each glyph covers as drawn (`span`), and how much of an icon it covers in the Litra icon pack
 * (`packSpan`), as `scripts/packs/litra.mjs` of `@daczarne/streamdeck-icons` sizes them. The keys take the pack's
 * sizes, so they match the pack's icons and leave room for a title, which Stream Deck draws over the image (#130). The
 * dials' icons on the touch strip keep the glyphs' full size.
 */
const ON_A_KEY = {
  brightness: { span: 0.865, packSpan: 0.57 },
  temperature: { span: 0.815, packSpan: 0.62 },
  scene: { span: 0.865, packSpan: 0.62 },
  power: { span: 0.54, packSpan: 0.52 },
};

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
 * A glyph drawn at `size`, scaled about its center by `factor`.
 *
 * @param {number} size
 * @param {string} glyph its markup
 * @param {number} factor
 * @returns {string}
 */
function scaledAbout(size, glyph, factor) {
  const c = size / 2;
  return `<g transform="translate(${c} ${c}) scale(${factor}) translate(${-c} ${-c})">${glyph}</g>`;
}

/**
 * A glyph drawn at `size`, scaled about the center from its own span to its span in the pack, as the pack scales it.
 *
 * @param {number} size
 * @param {string} glyph its markup
 * @param {{ span: number, packSpan: number }} spans
 * @returns {string}
 */
function onAKey(size, glyph, { span, packSpan }) {
  return scaledAbout(size, glyph, packSpan / span);
}

/**
 * Renders every icon the plugin uses, at the sizes Stream Deck asks for each.
 *
 * @returns {Promise<void>}
 */
async function main() {
  // Key images (72 / 144), at the pack's sizes. Stream Deck's app also pictures a dial with its action's key image.
  await writePair(
    path.join(root, "actions/power/key-off"),
    (s) => onAKey(s, powerGlyph(s, { on: false }), ON_A_KEY.power),
    72,
  );
  await writePair(
    path.join(root, "actions/power/key-on"),
    (s) => onAKey(s, powerGlyph(s, { on: true }), ON_A_KEY.power),
    72,
  );
  await writePair(
    path.join(root, "actions/brightness/key"),
    (s) => onAKey(s, brightnessGlyph(s), ON_A_KEY.brightness),
    72,
  );
  await writePair(
    path.join(root, "actions/temperature/key"),
    (s) => onAKey(s, temperatureGlyph(s), ON_A_KEY.temperature),
    72,
  );
  await writePair(path.join(root, "actions/scene/key"), (s) => onAKey(s, sceneGlyph(s), ON_A_KEY.scene), 72);
  // The step keys' glyphs are the sun and the thermometer with a sign, the same size as on the other keys.
  for (const step of /** @type {const} */ (["up", "down"])) {
    await writePair(
      path.join(root, `actions/brightness-${step}/key`),
      (s) => onAKey(s, brightnessStepGlyph(s, { step }), ON_A_KEY.brightness),
      72,
    );
    await writePair(
      path.join(root, `actions/temperature-${step}/key`),
      (s) => onAKey(s, temperatureStepGlyph(s, { step }), ON_A_KEY.temperature),
      72,
    );
  }

  // Brightness and Temperature glyphs (72 / 144) at full size, the dials' icons on the touch strip and the lamp
  // screens'
  await writePair(path.join(root, "actions/brightness/glyph"), (s) => brightnessGlyph(s), 72);
  await writePair(path.join(root, "actions/temperature/glyph"), (s) => temperatureGlyph(s), 72);

  // Action list icons (20 / 40) — monochrome white
  await writePair(path.join(root, "actions/power/icon"), (s) => actionIconPower(s), 20);
  await writePair(path.join(root, "actions/brightness/icon"), (s) => actionIconBrightness(s), 20);
  await writePair(path.join(root, "actions/temperature/icon"), (s) => actionIconTemperature(s), 20);
  await writePair(path.join(root, "actions/scene/icon"), (s) => actionIconScene(s), 20);
  for (const step of /** @type {const} */ (["up", "down"])) {
    await writePair(
      path.join(root, `actions/brightness-${step}/icon`),
      (s) => actionIconBrightnessStep(s, { step }),
      20,
    );
    await writePair(
      path.join(root, `actions/temperature-${step}/icon`),
      (s) => actionIconTemperatureStep(s, { step }),
      20,
    );
  }

  // Category (28 / 56)
  await writePair(path.join(root, "plugin/category-icon"), (s) => categoryGlyph(s), 28);

  // Marketplace (256 / 512)
  await writePair(path.join(root, "plugin/marketplace"), (s) => marketplaceGlyph(s), 256);

  // The README's actions table (40), in each of GitHub's themes. The power glyph, drawn smaller than the others, is
  // scaled up to the sun's span, so every icon in the table is about the same size.
  const powerToSun = ON_A_KEY.brightness.span / ON_A_KEY.power.span;
  /** @type {[string, (size: number, color: string) => string][]} */
  const readmeIcons = [
    ["power", (s, color) => scaledAbout(s, powerGlyph(s, { on: true, color }), powerToSun)],
    ["scene", (s, color) => sceneGlyph(s, { color })],
    ["brightness", (s, color) => brightnessGlyph(s, { color })],
    ["brightness-up", (s, color) => brightnessStepGlyph(s, { step: "up", color })],
    ["brightness-down", (s, color) => brightnessStepGlyph(s, { step: "down", color })],
    ["temperature", (s, color) => temperatureGlyph(s, { color })],
    ["temperature-up", (s, color) => temperatureStepGlyph(s, { step: "up", color })],
    ["temperature-down", (s, color) => temperatureStepGlyph(s, { step: "down", color })],
  ];
  for (const [theme, color] of Object.entries(README_THEMES)) {
    for (const [name, draw] of readmeIcons) {
      await writePng(path.join(readmeRoot, theme, `${name}.png`), draw(README_SIZE, color), README_SIZE);
    }
  }

  console.log("Icons generated.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
