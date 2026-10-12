#!/usr/bin/env node
/**
 * Generates the plugin's icons and the Litra icon pack. Each icon is drawn as SVG. The plugin's are rendered to the PNG
 * sizes Stream Deck requires (1x and @2x), while the pack ships the SVGs themselves, which Stream Deck scales.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

import { ACCENTS, INK, TILES, WHITE } from "./icon-style.mjs";

const root = path.resolve("com.daczarne.litra.sdPlugin/imgs");
const packRoot = path.resolve("com.daczarne.litra.sdIconPack");

const COLORS = {
  bg: "#1A1A1A",
  muted: "#6B6B6B",
  warm: "#FFB347",
  on: ACCENTS.gold,
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

/** A thermometer whose bar fills `level` of the tube, from the bulb up: all of it unless a glyph says otherwise. */
function temperatureGlyph(size, { color = "#FFFFFF", level = 1 } = {}) {
  const cx = size / 2;
  const sw = size * 0.065;
  const tubeHalf = size * 0.08;
  const top = size * 0.12;
  const bulbR = size * 0.15;
  const bulbCy = size * 0.72;
  // Where the tube's sides meet the bulb.
  const joinY = bulbCy - Math.sqrt(bulbR ** 2 - tubeHalf ** 2);
  const barTop = top + size * 0.16;
  return `<path
    d="M ${cx - tubeHalf} ${top + tubeHalf}
    A ${tubeHalf} ${tubeHalf} 0 0 1 ${cx + tubeHalf} ${top + tubeHalf}
    V ${joinY}
    A ${bulbR} ${bulbR} 0 1 1 ${cx - tubeHalf} ${joinY} Z"
    stroke="${color}" stroke-width="${sw}" stroke-linejoin="round"/>
    <circle cx="${cx}" cy="${bulbCy}" r="${bulbR * 0.45}" fill="${color}"/>
    <line x1="${cx}" y1="${bulbCy - (bulbCy - barTop) * level}" x2="${cx}" y2="${bulbCy}"
    stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`;
}

/** The sun outlined rather than filled, for a lower brightness, with the rays of {@link brightnessGlyph}. */
function dimGlyph(size, { color = "#FFFFFF" } = {}) {
  const cx = size / 2;
  const cy = size / 2;
  const sw = size * 0.065;
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    return `<line x1="${cx + Math.cos(a) * size * 0.27}" y1="${cy + Math.sin(a) * size * 0.27}"
      x2="${cx + Math.cos(a) * size * 0.4}" y2="${cy + Math.sin(a) * size * 0.4}"
      stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`;
  }).join("\n");
  return `<circle cx="${cx}" cy="${cy}" r="${size * 0.16}" stroke="${color}" stroke-width="${sw}"/>\n${rays}`;
}

/**
 * Where a thermometer and its badge (a snowflake or a sun) sit side by side, as shares of the canvas: the
 * thermometer's center, and the badge's center and radius. Together they span the canvas as the thermometer alone does.
 */
const BADGE = { thermometerX: 0.28, x: 0.71, y: 0.34, r: 0.18 };

/** The thermometer of {@link temperatureGlyph}, moved left, with a badge drawn by `badge` at its upper right. */
function thermometerWith(size, color, level, badge) {
  const sw = size * 0.038;
  const shift = size * (BADGE.thermometerX - 0.5);
  return `<g transform="translate(${shift} 0)">${temperatureGlyph(size, { color, level })}</g>
    ${badge(size * BADGE.x, size * BADGE.y, size * BADGE.r, sw, color)}`;
}

function strokeLine(x1, y1, x2, y2, sw, color) {
  return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"
    stroke="${color}" stroke-width="${sw}" stroke-linecap="round"/>`;
}

/** A snowflake of radius `r`: six arms, each with a pair of branches pointing outward. */
function snowflake(cx, cy, r, sw, color) {
  return Array.from({ length: 6 }, (_, i) => {
    const a = (i * Math.PI) / 3 - Math.PI / 2;
    const at = (d, angle = a) => [cx + Math.cos(angle) * d, cy + Math.sin(angle) * d];
    const [bx, by] = at(r * 0.62);
    const branch = (turn) => {
      const angle = a + turn;
      return strokeLine(bx, by, bx + Math.cos(angle) * r * 0.3, by + Math.sin(angle) * r * 0.3, sw, color);
    };
    return [strokeLine(cx, cy, ...at(r), sw, color), branch(Math.PI / 4), branch(-Math.PI / 4)].join("\n");
  }).join("\n");
}

/** A small sun of radius `r`, filled like {@link brightnessGlyph}'s. */
function smallSun(cx, cy, r, sw, color) {
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    const [c, s] = [Math.cos(a), Math.sin(a)];
    return strokeLine(cx + c * r * 0.68, cy + s * r * 0.68, cx + c * r, cy + s * r, sw, color);
  }).join("\n");
  return `<circle cx="${cx}" cy="${cy}" r="${r * 0.42}" fill="${color}"/>\n${rays}`;
}

/**
 * A flame of half-height `r`, a tenth taller than the other badges since it's narrower: a rounded base, a main tongue
 * leaning right and a smaller one on the left, with a teardrop cut out of its base. The cut-out keeps a margin of `sw`.
 */
function flame(cx, cy, badgeR, sw, color) {
  const r = badgeR * 1.1;
  const at = (x, y) => `${cx + x * r} ${cy + y * r}`;
  const outer = `M ${at(0, 1)}
    C ${at(-0.72, 1)} ${at(-0.85, 0.4)} ${at(-0.58, -0.05)}
    C ${at(-0.46, -0.25)} ${at(-0.46, -0.45)} ${at(-0.52, -0.64)}
    C ${at(-0.24, -0.5)} ${at(-0.14, -0.32)} ${at(-0.12, -0.16)}
    C ${at(-0.06, -0.55)} ${at(0.18, -0.78)} ${at(0.08, -1)}
    C ${at(0.52, -0.72)} ${at(0.82, -0.22)} ${at(0.68, 0.35)}
    C ${at(0.58, 0.8)} ${at(0.3, 1)} ${at(0, 1)} Z`;
  const [ix, iy, ir] = [cx, cy + r * 0.5, r * 0.48 - sw / 2];
  const inner = `M ${ix} ${iy + ir}
    C ${ix - ir * 0.78} ${iy + ir} ${ix - ir * 0.78} ${iy} ${ix} ${iy - ir}
    C ${ix + ir * 0.78} ${iy} ${ix + ir * 0.78} ${iy + ir} ${ix} ${iy + ir} Z`;
  return `<path d="${outer} ${inner}" fill="${color}" fill-rule="evenodd"/>`;
}

/** The thermometer with its bar low and a snowflake, for a cool temperature. */
function coolGlyph(size, { color = "#FFFFFF" } = {}) {
  return thermometerWith(size, color, 0.25, snowflake);
}

/** The thermometer with a sun, for a warm temperature. */
function warmGlyph(size, { color = "#FFFFFF" } = {}) {
  return thermometerWith(size, color, 1, smallSun);
}

/** The thermometer with its bar full and a flame, for a hot temperature. */
function hotGlyph(size, { color = "#FFFFFF" } = {}) {
  return thermometerWith(size, color, 1, flame);
}

/**
 * The tiled schemes: a glyph in `ink` on a `tile` that fills the icon, like the monitor keys. The Deck's keys round the
 * corners themselves, so the tile doesn't. Besides its `ink`, each tile has its own shade of the glyphs' other tones,
 * readable on it: `lit` for lights that are on, and `red`.
 */
const TILE_SCHEMES = [
  { name: "charcoal", tile: TILES.charcoal, ink: WHITE, lit: ACCENTS.gold, red: ACCENTS.scarlet },
  { name: "grey", tile: TILES.grey, ink: INK, lit: ACCENTS.ochre, red: ACCENTS.crimson },
];

/**
 * The pack's glyphs, each drawn by `draw(size, { color })`. Every glyph comes plain, in its default colors on
 * transparent, and on every tile of {@link TILE_SCHEMES}, at the same size in all of them.
 *
 * `span` is how much of its own canvas a glyph covers at its widest or tallest, strokes included, and `packSpan` how
 * much of a pack icon it covers. The suns match the suns of the monitor keys, and the others are sized to look as
 * large: a thin thermometer needs more room, and the heavy power symbol less. That's smaller than the plugin draws them
 * on its own keys, where a glyph fills the key, and leaves the room around the glyph that the tiles need. On a tile,
 * `tone` draws a glyph in the tile's shade of that tone rather than in its ink, and `fade` marks the off state, drawn
 * in an ink faded toward the tile.
 */
const PACK_GLYPHS = [
  { id: "brightness", name: "Brightness", tags: ["sun", "light"], draw: brightnessGlyph, span: 0.865, packSpan: 0.57 },
  { id: "brightness-low", name: "Brightness low", tags: ["sun", "dim"], draw: dimGlyph, span: 0.865, packSpan: 0.57 },
  {
    id: "temperature",
    name: "Temperature",
    tags: ["thermometer", "kelvin"],
    draw: temperatureGlyph,
    span: 0.815,
    packSpan: 0.62,
  },
  {
    id: "temperature-cool",
    name: "Temperature cool",
    tags: ["thermometer", "kelvin", "snowflake", "cold"],
    draw: coolGlyph,
    span: 0.815,
    packSpan: 0.62,
  },
  {
    id: "temperature-warm",
    name: "Temperature warm",
    tags: ["thermometer", "kelvin", "sun", "warm"],
    draw: warmGlyph,
    span: 0.815,
    packSpan: 0.62,
  },
  {
    id: "temperature-hot",
    name: "Temperature hot",
    tags: ["thermometer", "kelvin", "flame", "hot"],
    draw: hotGlyph,
    span: 0.815,
    packSpan: 0.62,
  },
  {
    id: "power-on",
    name: "Power on",
    tags: ["power"],
    draw: (size, options) => powerGlyph(size, { ...options, on: true }),
    span: 0.54,
    packSpan: 0.52,
    tone: "lit",
  },
  {
    id: "power-off",
    name: "Power off",
    tags: ["power"],
    draw: (size, options) => powerGlyph(size, { ...options, on: false }),
    span: 0.54,
    packSpan: 0.52,
    fade: true,
  },
  {
    id: "power-red",
    name: "Power red",
    tags: ["power", "off", "red"],
    // Off's shape, without the dot that marks lights that are on. Plain, it's the palette's own red.
    draw: (size, options) => powerGlyph(size, { color: TILES.red, ...options, on: false }),
    span: 0.54,
    packSpan: 0.52,
    tone: "red",
  },
];

// How far an off glyph fades toward its tile: dimmer than an on one, and still readable.
const OFF_FADE = 0.5;

/** A glyph drawn at `size`, scaled about the center from its own span to its span in the pack. */
function scaled(size, glyph, span, packSpan) {
  const c = size / 2;
  return `<g transform="translate(${c} ${c}) scale(${packSpan / span}) translate(${-c} ${-c})">${glyph}</g>`;
}

/** The color `share` of the way from `from` to `to`, both as six-digit hex colors. */
function mix(from, to, share) {
  const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  const [a, b] = [channels(from), channels(to)];
  return `#${a.map((v, i) => Math.round(v + (b[i] - v) * share).toString(16).padStart(2, "0")).join("").toUpperCase()}`;
}

/** The pack entry of a glyph on one tile, which fills the icon. */
function tiledIcon({ id, name, tags, draw, span, packSpan, tone, fade }, scheme) {
  const { name: tileName, tile, ink } = scheme;
  const color = tone ? scheme[tone] : fade ? mix(ink, tile, OFF_FADE) : ink;
  return {
    path: `${id}-${tileName}.svg`,
    name: `${name} (${tileName})`,
    tags: ["litra", "tile", tileName, ...tags],
    draw: (size) => `<rect width="${size}" height="${size}" fill="${tile}"/>
      ${scaled(size, draw(size, { color }), span, packSpan)}`,
  };
}

/**
 * The icon pack's icons, in the order the Icon Library shows them: the plain glyphs and the lamp, then each tile's set.
 * Every icon is tagged "litra", so a search for it finds the whole pack. The pack's own icon is the lamp, like the
 * plugin's category.
 */
const PACK_ICONS = [
  ...PACK_GLYPHS.map(({ id, name, tags, draw, span, packSpan }) => ({
    path: `${id}.svg`,
    name,
    tags: ["litra", ...tags],
    draw: (size) => scaled(size, draw(size), span, packSpan),
  })),
  { path: "lamp.svg", name: "Lamp", tags: ["litra", "light"], draw: categoryGlyph },
  ...TILE_SCHEMES.flatMap((scheme) => PACK_GLYPHS.map((glyph) => tiledIcon(glyph, scheme))),
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
