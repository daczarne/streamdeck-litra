#!/usr/bin/env node
/**
 * Guards the Property Inspector pages against remote code:
 * - no `src` / `href` in ui/*.html may point at a remote URL, even in a tag split across lines
 * - every ui/*.html must declare the Content-Security-Policy below, and have no inline script or style it would block
 * - every ui/*.html must link the pages' stylesheet, ui/settings.css (#247)
 * - the vendored sdpi-components build must match its pinned sha256
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const uiDir = path.resolve("com.daczarne.litra.sdPlugin/ui");

// sdpi-components v4.0.1 — dist/sdpi-components.js at GeekyEggo/sdpi-components@06185f1452.
// Update together with the "Third-party code" section of README.md.
const VENDORED = {
  file: "vendor/sdpi-components.js",
  sha256: "f6c0dfd2ed68e18084b9952842b86e3850cf837d674704700c2a0718e0a24f6b",
};

// The stylesheet every page links, which holds every style of the pages (#247).
const STYLESHEET = "settings.css";

// The <style> element sdpi-components adds to every page, whose text is the CSS of a template in the vendored file,
// fixed by its pinned hash. The policy allows that element alone among the inline styles, by the hash of its text. A
// template with an escape or an interpolation isn't matched, since the element's text would differ from the file's.
const SDPI_STYLE = /document\.createElement\("style"\);[\w$]+\.innerHTML=[\w$]+`([^`\\$]*)`\.cssText/g;

const REMOTE_ATTR = /\b(?:src|href)\s*=\s*["']?\s*(?:[a-z][a-z0-9+.-]*:)?\/\//gi;
const CSP_META = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i;
const INLINE_SCRIPT = /<script\b(?![^>]*\bsrc\s*=)[^>]*>/gi;
const INLINE_STYLE = /<style\b[^>]*>/gi;
const STYLE_ATTR = /<[a-z][^>]*\sstyle\s*=[^>]*>/gi;
const STYLESHEET_LINK = new RegExp(`<link\\s+rel="stylesheet"\\s+href="${STYLESHEET.replace(".", "\\.")}"\\s*/?>`, "i");

const errors = [];

/**
 * The CSP source that allows the <style> element sdpi-components adds, the base64 sha256 of its text, or undefined,
 * with an error, when the vendored file has no such element, or more than one.
 *
 * @returns {string | undefined}
 */
function sdpiStyleSource() {
  const vendored = readFileSync(path.join(uiDir, VENDORED.file), "utf8");
  const styles = [...vendored.matchAll(SDPI_STYLE)];
  const text = styles[0]?.[1];
  if (styles.length !== 1 || text === undefined) {
    errors.push(
      `ui/${VENDORED.file}: ${styles.length} <style> elements found where sdpi-components adds one, not 1: ` +
        "update SDPI_STYLE in scripts/check-ui.mjs to find it",
    );
    return undefined;
  }
  return `'sha256-${createHash("sha256").update(text, "utf8").digest("base64")}'`;
}

// The policy each page declares in its <meta>, compared with the whitespace collapsed, so the page can list one
// directive per line. Update together with every page and the "Settings pages" section of README.md.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  `style-src 'self' ${sdpiStyleSource() ?? "<the hash of sdpi-components' style>"}`,
  "img-src data:",
  "connect-src ws://localhost:*",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

/**
 * The line a position in a page falls on, counted from 1.
 *
 * @param {string} html the page
 * @param {number} index the position, in characters from the start
 * @returns {number}
 */
function lineAt(html, index) {
  return html.slice(0, index).split("\n").length;
}

/**
 * The tag around a position in a page, with its whitespace collapsed, since a tag may span several lines.
 *
 * @param {string} html the page
 * @param {number} index a position inside the tag
 * @returns {string}
 */
function tagAt(html, index) {
  const start = html.lastIndexOf("<", index);
  const end = html.indexOf(">", index);
  return html.slice(start, end === -1 ? undefined : end + 1).replace(/\s+/g, " ");
}

for (const name of readdirSync(uiDir).filter((f) => f.endsWith(".html"))) {
  const html = readFileSync(path.join(uiDir, name), "utf8");
  // Matched against the whole page, so that a tag split across lines is checked like one on a single line.
  for (const { index } of html.matchAll(REMOTE_ATTR)) {
    errors.push(`ui/${name}:${lineAt(html, index)}: remote resource: ${tagAt(html, index)}`);
  }
  for (const { index } of html.matchAll(INLINE_SCRIPT)) {
    const tag = tagAt(html, index);
    errors.push(`ui/${name}:${lineAt(html, index)}: inline script, which the Content-Security-Policy blocks: ${tag}`);
  }
  for (const { index } of [...html.matchAll(INLINE_STYLE), ...html.matchAll(STYLE_ATTR)]) {
    const tag = tagAt(html, index);
    errors.push(
      `ui/${name}:${lineAt(html, index)}: inline style, which the Content-Security-Policy blocks: ${tag}, ` +
        `belongs in ui/${STYLESHEET}`,
    );
  }
  if (!STYLESHEET_LINK.test(html)) {
    errors.push(`ui/${name}: doesn't link the pages' stylesheet, <link rel="stylesheet" href="${STYLESHEET}" />`);
  }

  const policy = html.match(CSP_META)?.[1]?.trim().replace(/\s+/g, " ");
  if (policy === undefined) {
    errors.push(`ui/${name}: no Content-Security-Policy <meta>`);
  } else if (policy !== CSP) {
    errors.push(`ui/${name}: Content-Security-Policy "${policy}" does not match "${CSP}"`);
  }
}

if (!existsSync(path.join(uiDir, STYLESHEET))) {
  errors.push(`ui/${STYLESHEET}: missing, though every page links it`);
}

const actual = createHash("sha256")
  .update(readFileSync(path.join(uiDir, VENDORED.file)))
  .digest("hex");
if (actual !== VENDORED.sha256) {
  errors.push(`ui/${VENDORED.file}: sha256 ${actual} does not match pinned ${VENDORED.sha256}`);
}

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.log(
  "check-ui: OK (no remote resources, CSP on every page, the stylesheet linked from every page, " +
    "vendored sdpi-components matches pinned hash)",
);
