import fs from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createScriptFolder, type ScriptFolder } from "../src/test-support/script-folder";

//* Fakes

const UI = "com.daczarne.litra.sdPlugin/ui";
const VENDORED = `${UI}/vendor/sdpi-components.js`;

// The policy every settings page declares, as the README's "Settings pages" section explains it.
const POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "connect-src ws://localhost:*",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

let folder: ScriptFolder;

beforeEach(() => {
  folder = createScriptFolder("litra-check-ui-test-");
  folder.copyFromRepo(VENDORED);
});

afterEach(() => {
  folder.remove();
});

/**
 * A settings page with the plugin's policy and the vendored components, and the lines given added to its head and
 * body. The head's own line is line 6.
 */
function page({ head = "", body = "", policy = POLICY }: { head?: string; body?: string; policy?: string } = {}) {
  return [
    "<!DOCTYPE html>",
    "<html>",
    "  <head>",
    `    <meta http-equiv="Content-Security-Policy" content="${policy}" />`,
    '    <script src="vendor/sdpi-components.js"></script>',
    head,
    "  </head>",
    "  <body>",
    body,
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}

/** Writes a settings page in the folder's plugin folder. */
function writePage(name: string, html: string): void {
  folder.write(`${UI}/${name}`, html);
}

/** Runs the check in the folder. */
function check() {
  return folder.run("scripts/check-ui.mjs");
}

//* Tests

describe("check-ui", () => {
  it("accepts the plugin's own settings pages", () => {
    for (const name of fs.readdirSync(UI).filter((file) => file.endsWith(".html"))) {
      folder.copyFromRepo(`${UI}/${name}`);
    }

    const { status, stdout } = check();

    expect(status).toBe(0);
    expect(stdout).toContain("check-ui: OK");
  });

  it("accepts a page that loads only the plugin's own files", () => {
    writePage("page.html", page({ head: '    <script src="page.js"></script>', body: '    <img src="data:," />' }));

    expect(check().status).toBe(0);
  });

  it.each([
    ["a script", '    <script src="https://example.com/page.js"></script>'],
    ["a stylesheet", '    <link rel="stylesheet" href="https://example.com/page.css" />'],
    ["an address without its scheme", '    <img src="//example.com/image.png" />'],
    ["an address without quotes", "    <script src=http://example.com/page.js></script>"],
    ["an attribute in capitals", '    <script SRC="https://example.com/page.js"></script>'],
  ])("refuses a remote resource: %s", (_name, line) => {
    writePage("page.html", page({ head: line }));

    const { status, stderr } = check();

    expect(status).toBe(1);
    expect(stderr).toContain("ui/page.html:6: remote resource");
  });

  it("refuses an inline script, which the policy would block", () => {
    writePage("page.html", page({ head: "    <script>document.title = 'x';</script>" }));

    const { status, stderr } = check();

    expect(status).toBe(1);
    expect(stderr).toContain("ui/page.html:6: inline script");
  });

  it("refuses a page without a policy", () => {
    writePage("page.html", page().replace(/^.*Content-Security-Policy.*$/m, ""));

    const { status, stderr } = check();

    expect(status).toBe(1);
    expect(stderr).toContain("ui/page.html: no Content-Security-Policy");
  });

  it("refuses a policy that differs from the plugin's", () => {
    writePage("page.html", page({ policy: POLICY.replace("script-src 'self'", "script-src 'self' https:") }));

    const { status, stderr } = check();

    expect(status).toBe(1);
    expect(stderr).toContain("ui/page.html: Content-Security-Policy");
    expect(stderr).toContain("does not match");
  });

  it("accepts the policy written one directive per line, as the pages write it", () => {
    writePage("page.html", page({ policy: `\n        ${POLICY.split("; ").join(";\n        ")}\n      ` }));

    expect(check().status).toBe(0);
  });

  it("refuses a vendored sdpi-components that doesn't match its pinned hash", () => {
    writePage("page.html", page());
    folder.write(VENDORED, `${fs.readFileSync(VENDORED, "utf8")}\n// changed`);

    const { status, stderr } = check();

    expect(status).toBe(1);
    expect(stderr).toContain("vendor/sdpi-components.js: sha256");
  });

  it("reports every problem it finds, not only the first", () => {
    writePage("first.html", page({ head: '    <script src="https://example.com/page.js"></script>' }));
    writePage("second.html", page().replace(/^.*Content-Security-Policy.*$/m, ""));

    const { status, stderr } = check();

    expect(status).toBe(1);
    expect(stderr).toContain("ui/first.html:6: remote resource");
    expect(stderr).toContain("ui/second.html: no Content-Security-Policy");
  });

  // check-ui reads each page one line at a time, so it misses a tag split across lines (#111).
  it.fails("refuses an inline script whose tag spans several lines (#111)", () => {
    writePage("page.html", page({ head: "    <script\n      type=\"module\">document.title = 'x';</script>" }));

    expect(check().status).toBe(1);
  });

  it.fails("refuses a remote resource whose address is on the line after its attribute (#111)", () => {
    writePage("page.html", page({ head: '    <script src=\n      "https://example.com/page.js"></script>' }));

    expect(check().status).toBe(1);
  });
});
