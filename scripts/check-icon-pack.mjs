#!/usr/bin/env node
/**
 * Guards the icon pack against what Stream Deck's Icon Library would load wrong or not at all:
 * - manifest.json has the members Elgato requires, and its icon exists
 * - every icons.json entry has a path, a name and tags, and its file exists, at 144 × 144 px if it's an SVG
 * - every file in icons/ is listed in icons.json
 * - no file name is longer than Elgato's limit
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const packDir = path.resolve("com.daczarne.litra.sdIconPack");
const iconsDir = path.join(packDir, "icons");

// From Elgato's API glossary for icon packs and its icon guidelines.
const REQUIRED_MANIFEST_MEMBERS = ["Name", "Author", "Version", "Icon"];
const ICON_SIZE = 144;
const MAX_FILE_NAME_LENGTH = 80;

const SVG_SIZE = /<svg\b[^>]*\bwidth="([^"]*)"[^>]*\bheight="([^"]*)"/;

const errors = [];

function readJson(name) {
  try {
    return JSON.parse(readFileSync(path.join(packDir, name), "utf8"));
  } catch (error) {
    errors.push(`${name}: ${error.message}`);
    return undefined;
  }
}

const manifest = readJson("manifest.json");
if (manifest !== undefined) {
  for (const member of REQUIRED_MANIFEST_MEMBERS) {
    if (typeof manifest[member] !== "string" || manifest[member].trim() === "") {
      errors.push(`manifest.json: ${member} is required`);
    }
  }
  if (typeof manifest.Icon === "string" && !existsSync(path.join(packDir, manifest.Icon))) {
    errors.push(`manifest.json: Icon ${manifest.Icon} does not exist`);
  }
}

const icons = readJson("icons.json");
if (icons !== undefined && !Array.isArray(icons)) {
  errors.push("icons.json: not an array");
} else if (icons !== undefined) {
  icons.forEach((icon, i) => {
    const where = `icons.json[${i}]`;
    if (typeof icon.path !== "string" || icon.path === "") {
      errors.push(`${where}: path is required`);
      return;
    }
    if (typeof icon.name !== "string" || icon.name.trim() === "") {
      errors.push(`${where} (${icon.path}): name is required`);
    }
    if (!Array.isArray(icon.tags) || icon.tags.length === 0 || icon.tags.some((tag) => typeof tag !== "string")) {
      errors.push(`${where} (${icon.path}): tags must be a non-empty list of strings`);
    }
    const file = path.join(iconsDir, icon.path);
    if (!existsSync(file)) {
      errors.push(`${where}: icons/${icon.path} does not exist`);
      return;
    }
    if (icon.path.endsWith(".svg")) {
      const [, width, height] = readFileSync(file, "utf8").match(SVG_SIZE) ?? [];
      if (width !== String(ICON_SIZE) || height !== String(ICON_SIZE)) {
        errors.push(`icons/${icon.path}: ${width} × ${height} px, not ${ICON_SIZE} × ${ICON_SIZE} px`);
      }
    }
  });

  const listed = new Set(icons.map((icon) => icon.path));
  // Hidden files, such as the .DS_Store Finder leaves, are neither shipped nor listed.
  const files = existsSync(iconsDir) ? readdirSync(iconsDir).filter((name) => !name.startsWith(".")) : [];
  for (const name of files) {
    if (!listed.has(name)) {
      errors.push(`icons/${name}: not listed in icons.json`);
    }
    if (name.length > MAX_FILE_NAME_LENGTH) {
      errors.push(`icons/${name}: file name longer than ${MAX_FILE_NAME_LENGTH} characters`);
    }
  }
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log("check-icon-pack: OK (manifest complete, every icon listed, sized and present)");
