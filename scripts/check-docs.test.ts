import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createScriptFolder, type ScriptFolder } from "../src/test-support/script-folder";

//* Fakes

let folder: ScriptFolder;

beforeEach(() => {
  folder = createScriptFolder("litra-check-docs-test-");
});

afterEach(() => {
  folder.remove();
});

/** Writes the folder's biome.json, whose `files.includes` lists the files the check covers. */
function covering(...includes: string[]): void {
  folder.write("biome.json", JSON.stringify({ files: { includes } }));
}

/** Writes a source file in the folder, from its lines. */
function source(file: string, ...lines: string[]): void {
  folder.write(file, `${lines.join("\n")}\n`);
}

/** Runs the check in the folder. */
function check() {
  return folder.run("scripts/check-docs.mjs");
}

//* Tests

describe("check-docs", () => {
  beforeEach(() => {
    covering("src/**/*.ts");
  });

  it("accepts every kind of declaration with a doc comment", () => {
    source(
      "src/lamp.ts",
      "/** Turns a lamp on. */",
      "export function turnOn(): void {}",
      "/** Turns a lamp off. */",
      "export const turnOff = (): void => {};",
      "/** Toggles a lamp. */",
      "export const toggle = function (): void {};",
      "/** A lamp. */",
      "export class Lamp {",
      "  /** A lamp, off. */",
      "  constructor() {}",
      "  /** Blinks the lamp. */",
      "  blink(): void {}",
      "  /** Whether the lamp is on. */",
      "  get on(): boolean { return true; }",
      "  /** Turns the lamp on or off. */",
      "  set on(_on: boolean) {}",
      "  /** Dims the lamp. */",
      "  dim = (): void => {};",
      "}",
    );

    const { status, stdout } = check();

    expect(status).toBe(0);
    expect(stdout).toContain("check-docs: OK (1 files)");
  });

  it.each([
    ["a function", ["export function turnOn(): void {}"], "turnOn"],
    ["an arrow function in a constant", ["export const turnOff = (): void => {};"], "turnOff"],
    ["a function expression in a constant", ["export const toggle = function (): void {};"], "toggle"],
    ["a class", ["export class Lamp {}"], "Lamp"],
    ["a constructor", ["/** A lamp. */", "export class Lamp {", "  constructor() {}", "}"], "Lamp.constructor"],
    ["a method", ["/** A lamp. */", "export class Lamp {", "  blink(): void {}", "}"], "Lamp.blink"],
    ["a getter", ["/** A lamp. */", "export class Lamp {", "  get on(): boolean { return true; }", "}"], "Lamp.on"],
    ["a setter", ["/** A lamp. */", "export class Lamp {", "  set on(_on: boolean) {}", "}"], "Lamp.on"],
    ["a function property", ["/** A lamp. */", "export class Lamp {", "  dim = (): void => {};", "}"], "Lamp.dim"],
  ])("refuses %s without a doc comment, naming it and its line", (_kind, lines, name) => {
    source("src/lamp.ts", ...lines);
    const line = lines.length === 1 ? 1 : 3;

    const { status, stderr } = check();

    expect(status).toBe(1);
    expect(stderr).toContain(`src/lamp.ts:${line}: ${name} has no doc comment`);
  });

  it("refuses a comment that isn't a doc comment", () => {
    source("src/lamp.ts", "// Turns a lamp on.", "export function turnOn(): void {}");

    expect(check().stderr).toContain("turnOn has no doc comment");
  });

  it("leaves alone what isn't declared at the top of a file or in a class there", () => {
    source(
      "src/lamp.ts",
      "/** Turns every lamp on. */",
      "export function turnOnAll(lamps: string[]): void {",
      "  const turnOn = (lamp: string): void => { void lamp; };",
      "  lamps.forEach(turnOn);",
      "}",
      "export const LAMPS = ['A1', 'B2'];",
      "/** A lamp. */",
      "export class Lamp {",
      "  serialNumber = 'A1';",
      "}",
    );

    expect(check().status).toBe(0);
  });

  it("accepts a class's doc comment above its decorator, as the style guide says", () => {
    source("src/lamp.ts", "/** A lamp. */", "@register", "export class Lamp {}");

    expect(check().status).toBe(0);
  });

  it("refuses a class's doc comment between its decorator and the class, where TypeScript doesn't attach it", () => {
    source("src/lamp.ts", "@register", "/** A lamp. */", "export class Lamp {}");

    expect(check().stderr).toContain("Lamp has no doc comment");
  });

  it("checks only the files biome.json covers, without the ones it excludes", () => {
    covering("src/**/*.ts", "!src/generated.ts");
    source("src/generated.ts", "export function generated(): void {}");
    source("other/lamp.ts", "export function elsewhere(): void {}");

    const { status, stdout } = check();

    expect(status).toBe(0);
    expect(stdout).toContain("check-docs: OK (0 files)");
  });

  it("reports every declaration without a doc comment, and how many", () => {
    source("src/lamp.ts", "export function turnOn(): void {}");
    source("src/dial.ts", "export function turn(): void {}");

    const { status, stderr } = check();

    expect(status).toBe(1);
    expect(stderr).toContain("src/lamp.ts:1: turnOn has no doc comment");
    expect(stderr).toContain("src/dial.ts:1: turn has no doc comment");
    expect(stderr).toContain("check-docs: 2 declarations without a doc comment");
  });
});
