#!/usr/bin/env node
/**
 * Guards the Property Inspector pages against remote code:
 * - no `src` / `href` in ui/*.html may point at a remote URL
 * - every ui/*.html must declare the Content-Security-Policy below, and have no inline script it would block
 * - the vendored sdpi-components build must match its pinned sha256
 */
import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const uiDir = path.resolve("com.daczarne.litra.sdPlugin/ui");

// sdpi-components v4.0.1 — dist/sdpi-components.js at GeekyEggo/sdpi-components@06185f1452.
// Update together with the "Third-party code" section of README.md.
const VENDORED = {
  file: "vendor/sdpi-components.js",
  sha256: "f6c0dfd2ed68e18084b9952842b86e3850cf837d674704700c2a0718e0a24f6b",
};

// The policy each page declares in its <meta>, compared with the whitespace collapsed, so the page can list one
// directive per line. Update together with every page and the "Settings pages" section of README.md.
const CSP = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "connect-src ws://localhost:*",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const REMOTE_ATTR = /\b(?:src|href)\s*=\s*["']?\s*(?:[a-z][a-z0-9+.-]*:)?\/\//gi;
const CSP_META = /<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i;
const INLINE_SCRIPT = /<script\b(?![^>]*\bsrc\s*=)[^>]*>/i;

const errors = [];

for (const name of readdirSync(uiDir).filter((f) => f.endsWith(".html"))) {
  const html = readFileSync(path.join(uiDir, name), "utf8");
  html.split("\n").forEach((line, i) => {
    if (REMOTE_ATTR.test(line)) {
      errors.push(`ui/${name}:${i + 1}: remote resource: ${line.trim()}`);
    }
    REMOTE_ATTR.lastIndex = 0;
    if (INLINE_SCRIPT.test(line)) {
      errors.push(`ui/${name}:${i + 1}: inline script, which the Content-Security-Policy blocks: ${line.trim()}`);
    }
  });

  const policy = html.match(CSP_META)?.[1]?.trim().replace(/\s+/g, " ");
  if (policy === undefined) {
    errors.push(`ui/${name}: no Content-Security-Policy <meta>`);
  } else if (policy !== CSP) {
    errors.push(`ui/${name}: Content-Security-Policy "${policy}" does not match "${CSP}"`);
  }
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
console.log("check-ui: OK (no remote resources, CSP on every page, vendored sdpi-components matches pinned hash)");
