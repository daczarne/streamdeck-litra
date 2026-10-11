#!/usr/bin/env node
/**
 * Generates Litra plugin icons (SVG masters + PNG sizes required by Stream Deck).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";

const root = path.resolve("com.daczarne.litra.sdPlugin/imgs");

const COLORS = {
  bg: "#1A1A1A",
  fg: "#FFFFFF",
  muted: "#6B6B6B",
  warm: "#FFB347",
  cool: "#7EC8FF",
  on: "#F5C542",
  accent: "#E8E8E8",
};

function svgDoc(size, body) {
	return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" fill="none">
${body}
</svg>`;
}

/** Key / encoder tile background */
function keyBg(size = 72) {
  const r = Math.round(size * 0.18);
  return `<rect width="${size}" height="${size}" rx="${r}" fill="${COLORS.bg}"/>`;
}

function powerGlyph(size, { on }) {
  const cx = size / 2;
  const cy = size / 2;
  const stroke = on ? COLORS.on : COLORS.muted;
  const sw = size * 0.07;
  const r = size * 0.22;
  const stemH = size * 0.2;
  return `
  ${keyBg(size)}
  <path d="M ${cx} ${cy - r - stemH * 0.15} V ${cy - stemH * 0.05}"
        stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"/>
  <path d="M ${cx - r * 0.85} ${cy - r * 0.35}
           A ${r} ${r} 0 1 0 ${cx + r * 0.85} ${cy - r * 0.35}"
        stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round" fill="none"/>
  ${on ? `<circle cx="${cx}" cy="${cy + r * 0.15}" r="${size * 0.04}" fill="${COLORS.on}"/>` : ""}`;
}

function brightnessGlyph(size) {
  const cx = size / 2;
  const cy = size / 2 - size * 0.02;
  const core = size * 0.12;
  const rayIn = size * 0.2;
  const rayOut = size * 0.3;
  const sw = size * 0.055;
  const rays = Array.from({ length: 8 }, (_, i) => {
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    const x1 = cx + Math.cos(a) * rayIn;
    const y1 = cy + Math.sin(a) * rayIn;
    const x2 = cx + Math.cos(a) * rayOut;
    const y2 = cy + Math.sin(a) * rayOut;
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${COLORS.warm}" stroke-width="${sw}" stroke-linecap="round"/>`;
  }).join("\n");
  return `
  ${keyBg(size)}
  <circle cx="${cx}" cy="${cy}" r="${core}" fill="${COLORS.warm}"/>
  ${rays}`;
}

function temperatureGlyph(size) {
  const cx = size / 2;
  const cy = size / 2;
  const sw = size * 0.055;
  // Soft warm→cool bar + thermometer
  const barW = size * 0.42;
  const barH = size * 0.1;
  const barX = cx - barW / 2;
  const barY = cy + size * 0.22;
  const bulbR = size * 0.09;
  const tubeW = size * 0.08;
  const tubeTop = cy - size * 0.28;
  const tubeBottom = cy + size * 0.08;
  return `
  ${keyBg(size)}
  <defs>
    <linearGradient id="tempGrad" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${COLORS.warm}"/>
      <stop offset="100%" stop-color="${COLORS.cool}"/>
    </linearGradient>
  </defs>
  <rect x="${cx - tubeW / 2}" y="${tubeTop}" width="${tubeW}" height="${tubeBottom - tubeTop}" rx="${tubeW / 2}" fill="${COLORS.accent}"/>
  <circle cx="${cx}" cy="${tubeBottom + bulbR * 0.55}" r="${bulbR}" fill="${COLORS.warm}"/>
  <rect x="${cx - tubeW * 0.28}" y="${tubeTop + size * 0.08}" width="${tubeW * 0.56}" height="${tubeBottom - tubeTop - size * 0.02}" rx="${tubeW * 0.28}" fill="${COLORS.warm}"/>
  <rect x="${barX}" y="${barY}" width="${barW}" height="${barH}" rx="${barH / 2}" fill="url(#tempGrad)"/>`;
}

function lampMark(size, { mono = false } = {}) {
  const cx = size / 2;
  const cy = size / 2;
  const stroke = mono ? "#FFFFFF" : COLORS.warm;
  const fill = mono ? "none" : COLORS.warm;
  const sw = Math.max(1.5, size * 0.08);
  const headR = size * 0.22;
  const stemH = size * 0.18;
  return `
  <path d="M ${cx - headR} ${cy - size * 0.02}
           A ${headR} ${headR * 0.85} 0 0 1 ${cx + headR} ${cy - size * 0.02}
           L ${cx + headR * 0.55} ${cy + size * 0.12}
           L ${cx - headR * 0.55} ${cy + size * 0.12} Z"
        fill="${fill}" stroke="${stroke}" stroke-width="${sw}" stroke-linejoin="round"/>
  <line x1="${cx}" y1="${cy + size * 0.12}" x2="${cx}" y2="${cy + size * 0.12 + stemH}"
        stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"/>
  <line x1="${cx - size * 0.12}" y1="${cy + size * 0.12 + stemH}" x2="${cx + size * 0.12}" y2="${cy + size * 0.12 + stemH}"
        stroke="${stroke}" stroke-width="${sw}" stroke-linecap="round"/>`;
}

function marketplaceGlyph(size) {
  return `
  <rect width="${size}" height="${size}" rx="${size * 0.18}" fill="${COLORS.bg}"/>
  ${lampMark(size)}`;
}

function categoryGlyph(size) {
  // Monochrome white on transparent for category / action list
  return lampMark(size, { mono: true });
}

function actionIconPower(size) {
  const cx = size / 2;
  const cy = size / 2;
  const sw = Math.max(1.5, size * 0.12);
  const r = size * 0.28;
  return `
  <path d="M ${cx} ${cy - r - size * 0.08} V ${cy - size * 0.02}"
        stroke="#FFFFFF" stroke-width="${sw}" stroke-linecap="round"/>
  <path d="M ${cx - r * 0.85} ${cy - r * 0.25}
           A ${r} ${r} 0 1 0 ${cx + r * 0.85} ${cy - r * 0.25}"
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
  return `
  <rect x="${cx - tubeW / 2}" y="${top}" width="${tubeW}" height="${bottom - top}" rx="${tubeW / 2}"
        stroke="#FFFFFF" stroke-width="${sw}" fill="none"/>
  <circle cx="${cx}" cy="${bottom + bulbR * 0.35}" r="${bulbR}" fill="#FFFFFF"/>
  <line x1="${cx}" y1="${top + size * 0.12}" x2="${cx}" y2="${bottom}"
        stroke="#FFFFFF" stroke-width="${sw * 0.7}" stroke-linecap="round"/>`;
}

/** Dial icons: white line art on transparent, like the icons of Stream Deck's own dials. */
function encoderIconBrightness(size) {
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
                      stroke="#FFFFFF" stroke-width="${sw}" stroke-linecap="round"/>`;
  }).join("\n");
  // Filled, as large as the outlined circle was: an outline was hard to make out at the strip's sizes.
  return `<circle cx="${cx}" cy="${cy}" r="${core + sw / 2}" fill="#FFFFFF"/>\n${rays}`;
}

function encoderIconTemperature(size) {
  const cx = size / 2;
  const sw = size * 0.065;
  const tubeHalf = size * 0.08;
  const top = size * 0.12;
  const bulbR = size * 0.15;
  const bulbCy = size * 0.72;
  // Where the tube's sides meet the bulb.
  const joinY = bulbCy - Math.sqrt(bulbR ** 2 - tubeHalf ** 2);
  return `
  <path d="M ${cx - tubeHalf} ${top + tubeHalf}
           A ${tubeHalf} ${tubeHalf} 0 0 1 ${cx + tubeHalf} ${top + tubeHalf}
           V ${joinY}
           A ${bulbR} ${bulbR} 0 1 1 ${cx - tubeHalf} ${joinY} Z"
        stroke="#FFFFFF" stroke-width="${sw}" stroke-linejoin="round"/>
  <circle cx="${cx}" cy="${bulbCy}" r="${bulbR * 0.45}" fill="#FFFFFF"/>
  <line x1="${cx}" y1="${top + size * 0.16}" x2="${cx}" y2="${bulbCy}"
        stroke="#FFFFFF" stroke-width="${sw}" stroke-linecap="round"/>`;
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
  // Key tiles (72 / 144)
  await writePair(path.join(root, "actions/power/key-off"), (s) => powerGlyph(s, { on: false }), 72);
  await writePair(path.join(root, "actions/power/key-on"), (s) => powerGlyph(s, { on: true }), 72);
  await writePair(path.join(root, "actions/brightness/key"), (s) => brightnessGlyph(s), 72);
  await writePair(path.join(root, "actions/temperature/key"), (s) => temperatureGlyph(s), 72);

  // Encoder icons (72 / 144), shown on the touch strip and in the app's dial canvas
  await writePair(path.join(root, "actions/brightness/encoder"), (s) => encoderIconBrightness(s), 72);
  await writePair(path.join(root, "actions/temperature/encoder"), (s) => encoderIconTemperature(s), 72);

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
