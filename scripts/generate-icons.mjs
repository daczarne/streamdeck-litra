#!/usr/bin/env node
/**
 * Generates the plugin's icons and the Litra icon pack. Each icon is drawn as SVG. The plugin's are rendered to the PNG
 * sizes Stream Deck requires (1x and @2x), while the pack ships the SVGs themselves, which Stream Deck scales.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

import { INK, TILES, WHITE } from "./icon-style.mjs";

const root = path.resolve("com.daczarne.litra.sdPlugin/imgs");
const packRoot = path.resolve("com.daczarne.litra.sdIconPack");

const COLORS = {
  bg: "#1A1A1A",
  muted: "#6B6B6B",
  warm: "#FFB347",
  on: "#F5C542",
};

function svgDoc(size, body) {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none">
    ${body}
    </svg>`;
}

function powerGlyph(size, { on, color }) {
  const cx = size / 2;
  const cy = size / 2;
  const stroke = color ?? (on ? COLORS.on : COLORS.muted);
  const sw = size * 0.07;
  const r = size * 0.22;
  const stemH = size * 0.2;
  return `<path d="M ${cx} ${cy - r - stemH * 0.15} V ${cy - stemH * 0.05}"
    stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"/>
    <path d="M ${cx - r * 0.85} ${cy - r * 0.35} A ${r} ${r} 0 1 0 ${cx + r * 0.85} ${cy - r * 0.35}"
    stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" fill="none"/>
    ${on ? `<circle cx="${cx}" cy="${cy + r * 0.15}" r="${size * 0.04}" fill="${color ?? COLORS.on}"/>` : ""}`;
}

function lampMark(size, { mono = false } = {}) {
  const cx = size / 2;
  const cy = size / 2;
  const stroke = mono ? "#FFFFFF" : COLORS.warm;
  const fill = mono ? "none" : COLORS.warm;
  const sw = Math.max(1.5, size * 0.08);
  const headR = size * 0.22;
  const stemH = size * 0.18;
  return `<path
    d="M ${cx - headR} ${cy - size * 0.02} A ${headR} ${headR * 0.85} 0 0 1 ${cx + headR} ${cy - size * 0.02}
    L ${cx + headR * 0.55} ${cy + size * 0.12} L ${cx - headR * 0.55} ${cy + size * 0.12} Z"
    fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>
    <line x1="${cx}" y1="${cy + size * 0.12}" x2="${cx}" y2="${cy + size * 0.12 + stemH}"
    stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"/>
    <line x1="${cx - size * 0.12}" y1="${cy + size * 0.12 + stemH}"
    x2="${cx + size * 0.12}" y2="${cy + size * 0.12 + stemH}"
    stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"/>`;
}

function marketplaceGlyph(size) {
  return `<rect width="${size}" height="${size}" rx="${size * 0.18}" fill="${COLORS.bg}"/> ${lampMark(size)}`;
}

function categoryGlyph(size) {
  // Monochrome white on transparent: the plugin's category, and the lamp of the icon pack
  return lampMark(size, { mono: true });
}

function actionIconPower(size) {
  const cx = size / 2;
  const cy = size / 2;
  const sw = Math.max(1.5, size * 0.12);
  const r = size * 0.28;
  return `<path
    d="M ${cx} ${cy - r - size * 0.08} V ${cy - size * 0.02}"
    stroke="#FFFFFF" stroke-width="${sw}" stroke-linecap="round"/>
    <path d="M ${cx - r * 0.85} ${cy - r * 0.25} A ${r} ${r} 0 1 0 ${cx + r * 0.85} ${cy - r * 0.25}"
    stroke="#FFFFFF" stroke-width="${sw}" stroke-linecap="round" fill="none"/>`;
}

function actionIconBrightness(size) {
  const cx = size / 2;
  const cy = size / 2;
  const core = size * 0.16;
  const rayIn = size * 0.28;
  const rayOut = size * 0.42;
  const sw = Math.max(1.5, size * 0.1);
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    return `<line x1="${cx + Math.cos(a) * rayIn}" y1="${cy + Math.sin(a) * rayIn}"
      x2="${cx + Math.cos(a) * rayOut}" y2="${cy + Math.sin(a) * rayOut}"
      stroke="#FFFFFF" stroke-width="${sw}" stroke-linecap="round"/>`;
  }).join("\n");
  return `<circle cx="${cx}" cy="${cy}" r="${core}" fill="#FFFFFF"/>\n${rays}`;
}

function actionIconTemperature(size) {
  const cx = size / 2;
  const sw = Math.max(1.5, size * 0.1);
  const bulbR = size * 0.16;
  const tubeW = size * 0.14;
  const top = size * 0.18;
  const bottom = size * 0.58;
  return `<rect x="${cx - tubeW / 2}" y="${top}" width="${tubeW}" height="${bottom - top}" rx="${tubeW / 2}"
    stroke="#FFFFFF" stroke-width="${sw}" fill="none"/>
    <circle cx="${cx}" cy="${bottom + bulbR * 0.35}" r="${bulbR}" fill="#FFFFFF"/>
    <line x1="${cx}" y1="${top + size * 0.12}" x2="${cx}" y2="${bottom}"
    stroke="#FFFFFF" stroke-width="${sw * 0.7}" stroke-linecap="round"/>`;
}

/**
 * Brightness and Temperature icons: white line art on transparent, like Stream Deck's own. Each is both the key image
 * and the dial icon, since Stream Deck's app pictures a dial with the key image.
 */
function brightnessGlyph(size, { color = "#FFFFFF" } = {}) {
  const cx = size / 2;
  const cy = size / 2;
  const sw = size * 0.065;
  const core = size * 0.16;
  const rayIn = size * 0.27;
  const rayOut = size * 0.4;
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    return `<line x1="${cx + Math.cos(a) * rayIn}" y1="${cy + Math.sin(a) * rayIn}"
      x2="${cx + Math.cos(a) * rayOut}" y2="${cy + Math.sin(a) * rayOut}"
      stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`;
  }).join("\n");
  // Filled, as large as the outlined circle was: an outline was hard to make out at the strip's sizes.
  return `<circle cx="${cx}" cy="${cy}" r="${core + sw / 2}" fill="${color}"/>\n${rays}`;
}

function temperatureGlyph(size, { color = "#FFFFFF" } = {}) {
  const cx = size / 2;
  const sw = size * 0.065;
  const tubeHalf = size * 0.08;
  const top = size * 0.12;
  const bulbR = size * 0.15;
  const bulbCy = size * 0.72;
  // Where the tube's sides meet the bulb.
  const joinY = bulbCy - Math.sqrt(bulbR ** 2 - tubeHalf ** 2);
  return `<path
    d="M ${cx - tubeHalf} ${top + tubeHalf}
    A ${tubeHalf} ${tubeHalf} 0 0 1 ${cx + tubeHalf} ${top + tubeHalf}
    V ${joinY}
    A ${bulbR} ${bulbR} 0 1 1 ${cx - tubeHalf} ${joinY} Z"
    stroke="${color}" stroke-width="${sw}" stroke-linejoin="round"/>
    <circle cx="${cx}" cy="${bulbCy}" r="${bulbR * 0.45}" fill="${color}"/>
    <line x1="${cx}" y1="${top + size * 0.16}" x2="${cx}" y2="${bulbCy}"
    stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`;
}

/**
 * The tiled schemes: a glyph in `ink` on a `tile` that fills the icon, like the monitor keys. The Deck's keys round the
 * corners themselves, so the tile doesn't.
 */
const TILE_SCHEMES = [
  { name: "charcoal", tile: TILES.charcoal, ink: WHITE },
  { name: "grey", tile: TILES.grey, ink: INK },
];

/**
 * For each glyph, how much of its own canvas it spans at its widest or tallest, strokes included, and how much of a
 * tile it spans once on one. The sun spans as much as the suns on the monitor keys. The others are sized to look as
 * large as it: the thin thermometer needs more room, and the heavy power symbol less.
 */
const TILED_GLYPHS = {
  brightness: { span: 0.865, onTile: 0.57 },
  temperature: { span: 0.815, onTile: 0.62 },
  power: { span: 0.54, onTile: 0.52 },
};

// How far an off glyph fades toward its tile: dimmer than an on one, and still readable.
const OFF_FADE = 0.5;

/** A glyph drawn at `size` on a tile of that size, scaled from its own span to its span on the tile. */
function onTile(size, tile, glyph, { span, onTile }) {
  const c = size / 2;
  return `<rect width="${size}" height="${size}" fill="${tile}"/>
    <g transform="translate(${c} ${c}) scale(${onTile / span}) translate(${-c} ${-c})">${glyph}</g>`;
}

/** The color `share` of the way from `from` to `to`, both as six-digit hex colors. */
function mix(from, to, share) {
  const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [a, b] = [channels(from), channels(to)];
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * share).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** The tiled icons of one scheme. Power off is the on glyph without its dot, in an ink faded toward the tile. */
function tiledIcons({ name, tile, ink }) {
  const off = mix(ink, tile, OFF_FADE);
  const tags = ["litra", "tile", name];
  return [
    {
      path: `brightness-${name}.svg`,
      name: `Brightness on ${name}`,
      tags: [...tags, "sun", "light"],
      draw: (s) => onTile(s, tile, brightnessGlyph(s, { color: ink }), TILED_GLYPHS.brightness),
    },
    {
      path: `temperature-${name}.svg`,
      name: `Temperature on ${name}`,
      tags: [...tags, "thermometer", "kelvin"],
      draw: (s) => onTile(s, tile, temperatureGlyph(s, { color: ink }), TILED_GLYPHS.temperature),
    },
    {
      path: `power-on-${name}.svg`,
      name: `Power on, on ${name}`,
      tags: [...tags, "power"],
      draw: (s) => onTile(s, tile, powerGlyph(s, { on: true, color: ink }), TILED_GLYPHS.power),
    },
    {
      path: `power-off-${name}.svg`,
      name: `Power off, on ${name}`,
      tags: [...tags, "power"],
      draw: (s) => onTile(s, tile, powerGlyph(s, { on: false, color: off }), TILED_GLYPHS.power),
    },
  ];
}

/**
 * The icon pack's icons, in the order the Icon Library shows them. Every icon is tagged "litra", so a search for it
 * finds the whole pack. The pack's own icon is the lamp, like the plugin's category.
 */
const PACK_ICONS = [
  { path: "brightness.svg", name: "Brightness", tags: ["litra", "sun", "light"], draw: brightnessGlyph },
  { path: "temperature.svg", name: "Temperature", tags: ["litra", "thermometer", "kelvin"], draw: temperatureGlyph },
  { path: "power-on.svg", name: "Power on", tags: ["litra", "power"], draw: (s) => powerGlyph(s, { on: true }) },
  { path: "power-off.svg", name: "Power off", tags: ["litra", "power"], draw: (s) => powerGlyph(s, { on: false }) },
  { path: "lamp.svg", name: "Lamp", tags: ["litra", "light"], draw: categoryGlyph },
  ...TILE_SCHEMES.flatMap(tiledIcons),
];

// The size Elgato asks for an icon in a pack, and the one it recommends for the pack's own icon.
const PACK_ICON_SIZE = 144;
const PACK_LOGO_SIZE = 56;

function writeSvg(filePath, svg, size) {
  mkdirSync(path.dirname(filePath), { recursive: true });
  // The templates leave trailing spaces on some lines, such as where an optional element is left out.
  writeFileSync(filePath, `${svgDoc(size, svg).replace(/[ \t]+$/gm, "")}\n`);
  console.log("wrote", filePath);
}

/** Writes the pack's icons and `icons.json` from {@link PACK_ICONS}, so every icon has its entry and the reverse. */
function writeIconPack() {
  // Rewritten from scratch, so an icon removed from the list doesn't linger.
  rmSync(path.join(packRoot, "icons"), { recursive: true, force: true });
  for (const icon of PACK_ICONS) {
    writeSvg(path.join(packRoot, "icons", icon.path), icon.draw(PACK_ICON_SIZE), PACK_ICON_SIZE);
  }
  const entries = PACK_ICONS.map(({ path, name, tags }) => ({ path, name, tags }));
  writeFileSync(path.join(packRoot, "icons.json"), `${JSON.stringify(entries, null, 2)}\n`);
  console.log("wrote", path.join(packRoot, "icons.json"));
  writeSvg(path.join(packRoot, "icon.svg"), categoryGlyph(PACK_LOGO_SIZE), PACK_LOGO_SIZE);
}

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

  // The Litra icon pack (144, and 56 for the pack's own icon)
  writeIconPack();

  console.log("Icons generated.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
