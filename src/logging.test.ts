import type { LogEntry } from "@elgato/utils/logging";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { RotatingFileTarget, type RotatingFileTargetOptions } from "./logging";

//* Fakes

let dest: string;

beforeEach(() => {
  dest = fs.mkdtempSync(path.join(os.tmpdir(), "litra-logging-test-"));
});

afterEach(() => {
  fs.rmSync(dest, { recursive: true, force: true });
});

/** A target writing to the test's folder, with each entry written as its message alone, so sizes are easy to count. */
function target(options: Partial<RotatingFileTargetOptions> = {}): RotatingFileTarget {
  return new RotatingFileTarget({
    dest,
    fileName: "litra",
    maxBytes: 20,
    backupCount: 2,
    format: ({ data }) => data.join(" "),
    ...options,
  });
}

function entry(message: string): LogEntry {
  return { level: "info", data: [message], scope: "" };
}

function read(name: string): string {
  return fs.readFileSync(path.join(dest, name), "utf8");
}

function files(): string[] {
  return fs.readdirSync(dest).sort();
}

//* Rotating file target

describe("RotatingFileTarget", () => {
  it("creates its folder on the first write", () => {
    const folder = path.join(dest, "logs");

    target({ dest: folder }).write(entry("first"));

    expect(fs.readFileSync(path.join(folder, "litra.log"), "utf8")).toBe("first\n");
  });

  it("writes nothing until something is logged", () => {
    target();

    expect(files()).toEqual([]);
  });

  it("appends each entry to the current file, one per line", () => {
    const log = target();

    log.write(entry("one"));
    log.write(entry("two"));

    expect(read("litra.log")).toBe("one\ntwo\n");
  });

  it("carries on the file an earlier run left, instead of starting a new one", () => {
    fs.writeFileSync(path.join(dest, "litra.log"), "earlier\n");

    target().write(entry("later"));

    expect(files()).toEqual(["litra.log"]);
    expect(read("litra.log")).toBe("earlier\nlater\n");
  });

  it("fills a file up to its size exactly", () => {
    const log = target();

    // 10 bytes each, newline included.
    log.write(entry("123456789"));
    log.write(entry("abcdefghi"));

    expect(files()).toEqual(["litra.log"]);
    expect(read("litra.log")).toBe("123456789\nabcdefghi\n");
  });

  it("moves a full file to .1 and starts a new one", () => {
    const log = target();

    log.write(entry("123456789"));
    log.write(entry("abcdefghi"));
    log.write(entry("next"));

    expect(files()).toEqual(["litra.1.log", "litra.log"]);
    expect(read("litra.1.log")).toBe("123456789\nabcdefghi\n");
    expect(read("litra.log")).toBe("next\n");
  });

  it("counts a file left by an earlier run towards its size", () => {
    fs.writeFileSync(path.join(dest, "litra.log"), "123456789\nabcdefghi\n");

    target().write(entry("next"));

    expect(read("litra.1.log")).toBe("123456789\nabcdefghi\n");
    expect(read("litra.log")).toBe("next\n");
  });

  it("counts bytes, not characters", () => {
    const log = target();

    // 10 characters and 11 bytes, newline included: together, one byte too many for one file.
    log.write(entry("ü12345678"));
    log.write(entry("abcdefghi"));

    expect(read("litra.1.log")).toBe("ü12345678\n");
    expect(read("litra.log")).toBe("abcdefghi\n");
  });

  it("moves every older file up one, and deletes the one past the last kept", () => {
    const log = target({ maxBytes: 5 });

    for (const message of ["aaaa", "bbbb", "cccc", "dddd"]) {
      log.write(entry(message));
    }

    expect(files()).toEqual(["litra.1.log", "litra.2.log", "litra.log"]);
    expect(read("litra.2.log")).toBe("bbbb\n");
    expect(read("litra.1.log")).toBe("cccc\n");
    expect(read("litra.log")).toBe("dddd\n");
  });

  it("writes an entry larger than a file to a file of its own", () => {
    const log = target({ maxBytes: 5 });

    log.write(entry("a"));
    log.write(entry("larger than a file"));
    log.write(entry("b"));

    expect(read("litra.2.log")).toBe("a\n");
    expect(read("litra.1.log")).toBe("larger than a file\n");
    expect(read("litra.log")).toBe("b\n");
  });

  it("drops an entry it can't write, instead of failing", () => {
    // A file where the folder should be.
    const blocked = path.join(dest, "logs");
    fs.writeFileSync(blocked, "");

    expect(() => target({ dest: blocked }).write(entry("lost"))).not.toThrow();
  });
});
