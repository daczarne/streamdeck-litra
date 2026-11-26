import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createScriptFolder, type ScriptFolder } from "../src/test-support/script-folder";

//* Fakes

let folder: ScriptFolder;

beforeEach(() => {
  folder = createScriptFolder("check-docs-test-");
  covering("src/**/*.ts", "scripts/**/*.mjs", "ui/*.js", "ui/*.css");
});

afterEach(() => {
  folder.remove();
});

/** Writes the folder's biome.json, whose `files.includes` lists the files the check covers. */
function covering(...includes: string[]): void {
  folder.write("biome.json", JSON.stringify({ files: { includes } }));
}

/** Writes a file in the folder, from its lines. */
function source(file: string, ...lines: string[]): void {
  folder.write(file, `${lines.join("\n")}\n`);
}

/** Runs the check in the folder. */
function check() {
  return folder.run("scripts/check-docs.mjs");
}

//* Tests

describe("check-docs", () => {
  describe("which declarations need a doc comment", () => {
    it("accepts every kind of declaration with a doc comment", () => {
      source(
        "src/module.ts",
        "/** A function. */",
        "export function run(): void {}",
        "/** An arrow function in a constant. */",
        "export const arrow = (): number => 1;",
        "/** A function expression in a constant. */",
        "export const expression = function (): void {};",
        "/** A class. */",
        "export class Thing {",
        "  /** Its constructor. */",
        "  constructor() {}",
        "  /** A method. */",
        "  method(): number {",
        "    return arrow();",
        "  }",
        "  /** A getter. */",
        "  get on(): boolean {",
        "    return true;",
        "  }",
        "  /** A setter. */",
        "  set on(_on: boolean) {}",
        "  /** A property set to a function. */",
        "  handle = (): void => {};",
        "}",
      );

      const { status, stdout } = check();

      expect(status).toBe(0);
      expect(stdout).toContain("check-docs: OK (1 files)");
    });

    it.each([
      ["a function", ["export function run(): void {}"], "function run"],
      ["an arrow function in a constant", ["export const run = (): void => {};"], "function run"],
      ["a function expression in a constant", ["export const run = function (): void {};"], "function run"],
      [
        "a function wrapped in satisfies",
        ["export const run = ((): void => {}) satisfies () => void;"],
        "function run",
      ],
      ["a function exported as the default", ["export default (): void => {};"], "function (default)"],
      ["a class", ["export class Thing {}"], "class Thing"],
      ["a class with no name", ["export default class {}"], "class (anonymous)"],
      ["a class in a constant", ["export const Thing = class {};"], "class Thing"],
    ])("refuses %s without a doc comment, naming it and its line", (_kind, lines, declaration) => {
      source("src/module.ts", ...lines);

      const { status, stderr } = check();

      expect(status).toBe(1);
      expect(stderr).toContain(`src/module.ts:1: ${declaration} has no doc comment`);
    });

    it.each([
      ["its constructor", "  constructor() {}", "constructor Thing"],
      ["a method", "  method(): void {}", "method Thing.method"],
      ["a getter", "  get on(): boolean {\n    return true;\n  }", "getter Thing.on"],
      ["a setter", "  set on(_on: boolean) {}", "setter Thing.on"],
      ["a property set to a function", "  handle = (): void => {};", "method Thing.handle"],
    ])("refuses %s of a class without a doc comment", (_name, member, declaration) => {
      source("src/module.ts", "/** A class. */", "export class Thing {", member, "}");

      const { status, stderr } = check();

      expect(status).toBe(1);
      expect(stderr).toContain(`src/module.ts:3: ${declaration} has no doc comment`);
    });

    it("names a member of a class with no name after a stand-in", () => {
      source("src/module.ts", "/** A class. */", "export default class {", "  method(): void {}", "}");

      expect(check().stderr).toContain("src/module.ts:3: method (anonymous).method has no doc comment");
    });

    it("refuses the members of a class in a constant without a doc comment", () => {
      source("src/module.ts", "/** A class. */", "export const Thing = class {", "  method(): void {}", "};");

      expect(check().stderr).toContain("src/module.ts:3: method Thing.method has no doc comment");
    });

    it("refuses a function declared after another in the same statement, which TypeScript doesn't give the comment", () => {
      source(
        "src/module.ts",
        "/** The first. */",
        "export const first = (): number => 1,",
        "  second = (): number => 2;",
      );

      const { status, stderr } = check();

      expect(status).toBe(1);
      expect(stderr).toContain("src/module.ts:3: function second has no doc comment");
      expect(stderr).not.toContain("function first");
    });

    it("refuses a doc comment between a class's decorator and the class, where TypeScript doesn't attach it", () => {
      source("src/module.ts", "@decorated", "/** A class. */", "export class Thing {}");

      const { status, stderr } = check();

      expect(status).toBe(1);
      expect(stderr).toContain("src/module.ts:1: class Thing has no doc comment");
    });

    it("accepts a doc comment above a class's decorator", () => {
      source("src/module.ts", "/** A class. */", "@decorated", "export class Thing {}");

      expect(check().status).toBe(0);
    });

    it("refuses a comment that isn't a doc comment", () => {
      source("src/module.ts", "// A function.", "export function run(): void {}");

      expect(check().stderr).toContain("src/module.ts:2: function run has no doc comment");
    });

    it("leaves alone what isn't declared at the top of a file or in a class there", () => {
      source(
        "src/module.ts",
        "/** A function. */",
        "export function run(): number {",
        "  function inner(): number {",
        "    return 1;",
        "  }",
        "  const arrow = () => inner();",
        "  return arrow();",
        "}",
        "export const LIMIT = 3;",
        "export const handler = makeHandler(() => {});",
        "export const steps = {",
        "  next: (): number => 1,",
        "  back(): number {",
        "    return -1;",
        "  },",
        "};",
        "/** A class. */",
        "export class Thing {",
        "  serialNumber = 'A1';",
        "}",
      );

      expect(check().status).toBe(0);
    });

    it.each([
      ["an arrow function", "(() => {", "})();"],
      ["a function expression", "(function () {", "})();"],
      ["an async function whose promise is ignored", "void (async () => {", "})();"],
    ])("checks what a file declares in %s that wraps it and runs at once", (_name, open, close) => {
      source(
        "ui/page.js",
        open,
        "  /** A class. */",
        "  class Field extends HTMLElement {",
        "    connectedCallback() {}",
        "  }",
        "  function render() {}",
        close,
      );

      const { status, stderr } = check();

      expect(status).toBe(1);
      expect(stderr).toContain("ui/page.js:4: method Field.connectedCallback has no doc comment");
      expect(stderr).toContain("ui/page.js:6: function render has no doc comment");
      expect(stderr).not.toContain("class Field has no doc comment");
    });
  });

  describe("which files it checks", () => {
    it("checks the TypeScript and JavaScript files biome.json covers, without the ones it excludes", () => {
      covering("src/**/*.ts", "ui/*.js", "!src/generated.ts", "!!src/forced.ts");
      source("src/generated.ts", "export function generated(): void {}");
      source("src/forced.ts", "export function forced(): void {}");
      source("other/module.ts", "export function elsewhere(): void {}");
      source("ui/page.js", "/**", " * A page's script.", " *", " * @returns {void}", " */", "function render() {}");

      const { status, stdout } = check();

      expect(status).toBe(0);
      expect(stdout).toContain("check-docs: OK (1 files)");
    });

    it("doesn't read a stylesheet biome.json covers as code", () => {
      source("ui/settings.css", ".class {", "  color: red;", "}", ".function {", "  color: blue;", "}");

      const { status, stdout } = check();

      expect(status).toBe(0);
      expect(stdout).toContain("check-docs: OK (0 files)");
    });

    it.each([
      ["a test", "src/module.test.ts"],
      ["a script", "scripts/script.mjs"],
      ["a probe", "scripts/probes/probe.mjs"],
      ["a settings page's script", "ui/page.js"],
    ])("checks %s", (_name, file) => {
      source(file, "export function run() {}");

      expect(check().stderr).toContain(`${file}:1: function run has no doc comment`);
    });
  });

  describe("the tags of a JavaScript doc comment", () => {
    it("accepts a typed @param for each parameter and a typed @returns", () => {
      source(
        "scripts/script.mjs",
        "/**",
        " * Adds two numbers.",
        " *",
        " * @param {number} a the first",
        " * @param {{ b: number }} options the second, by name",
        " * @param {number} options.b the second",
        " * @param {...number} rest the others",
        " * @returns {number}",
        " */",
        "function add(a, { b }, ...rest) {",
        "  return a + b + rest.length;",
        "}",
      );

      expect(check().status).toBe(0);
    });

    it("refuses a doc comment without a @param for a parameter, or a @returns", () => {
      source("scripts/script.mjs", "/** Adds two numbers. */", "function add(a, b = 1) {", "  return a + b;", "}");

      expect(check().stderr).toContain(
        "scripts/script.mjs:2: function add: its doc comment lacks a @param for a, a @param for b, a @returns",
      );
    });

    it("names a destructured parameter without a @param by its place", () => {
      source(
        "scripts/script.mjs",
        "/**",
        " * Adds.",
        " *",
        " * @param {number} a the first",
        " * @returns {number}",
        " */",
        "function add(a, { b }) {",
        "  return a + b;",
        "}",
      );

      expect(check().stderr).toContain("its doc comment lacks a @param for parameter 2");
    });

    it("refuses a @param or @returns without its type", () => {
      source(
        "scripts/script.mjs",
        "/**",
        " * Doubles.",
        " *",
        " * @param a the number",
        " * @returns",
        " */",
        "function double(a) {}",
      );

      expect(check().stderr).toContain(
        "scripts/script.mjs:7: function double: its doc comment lacks a type in the @param for a, a type in its @returns",
      );
    });

    it("doesn't ask a constructor or a setter for a @returns", () => {
      source(
        "scripts/script.mjs",
        "/** A class. */",
        "class Thing {",
        "  /**",
        "   * Its constructor.",
        "   *",
        "   * @param {number} value the start",
        "   */",
        "  constructor(value) {",
        "    this._value = value;",
        "  }",
        "",
        "  /**",
        "   * Sets the value.",
        "   *",
        "   * @param {number} value the new one",
        "   */",
        "  set value(value) {",
        "    this._value = value;",
        "  }",
        "}",
      );

      expect(check().status).toBe(0);
    });

    it("accepts a @type that types the whole function in place of its @param and @returns", () => {
      source(
        "scripts/script.mjs",
        "/** @typedef {(a: number) => number} Step */",
        "",
        "/**",
        " * Doubles.",
        " *",
        " * @type {Step}",
        " */",
        "function double(a) {",
        "  return a * 2;",
        "}",
        "",
        "/** @type {Step} */",
        "export const halve = (a) => a / 2;",
      );

      expect(check().status).toBe(0);
    });
  });

  describe("the tags of a TypeScript doc comment", () => {
    it("accepts a doc comment without @param or @returns, or with them untyped", () => {
      source(
        "src/module.ts",
        "/** Adds two numbers. */",
        "export function add(a: number, b: number): number {",
        "  return a + b;",
        "}",
        "/**",
        " * Doubles.",
        " *",
        " * @param a the number to double",
        " * @returns twice the number",
        " */",
        "export function double(a: number): number {",
        "  return a * 2;",
        "}",
      );

      expect(check().status).toBe(0);
    });

    it("refuses a type in a @param or a @returns, which the signature holds", () => {
      source(
        "src/module.ts",
        "/**",
        " * Doubles.",
        " *",
        " * @param {number} a the number",
        " * @returns {number} twice the number",
        " */",
        "export function double(a: number): number {",
        "  return a * 2;",
        "}",
      );

      expect(check().stderr).toContain(
        "src/module.ts:7: function double: its doc comment gives a type in its @param for a, its @returns, " +
          "which the signature holds",
      );
    });
  });

  it("reports every problem it finds, and how many", () => {
    source("src/first.ts", "export function one(): void {}");
    source("src/second.ts", "export class Two {}");

    const { status, stderr } = check();

    expect(status).toBe(1);
    expect(stderr).toContain("src/first.ts:1: function one has no doc comment");
    expect(stderr).toContain("src/second.ts:1: class Two has no doc comment");
    expect(stderr).toContain("check-docs: 2 problems with doc comments");
  });
});
