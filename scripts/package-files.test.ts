import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createScriptFolder, type ScriptFolder } from "../src/test-support/script-folder";
import { copyRuntimeFiles, packageRoot, thirdPartyNotices } from "./package-files.mjs";

//* Fakes

let folder: ScriptFolder;

beforeEach(() => {
  folder = createScriptFolder("litra-package-files-test-");
});

afterEach(() => {
  folder.remove();
});

/** Every file under a folder of the test's folder, relative to it, sorted. */
function filesIn(dir: string): string[] {
  const root = path.join(folder.dir, dir);
  return fs
    .readdirSync(root, { recursive: true, encoding: "utf8" })
    .filter((file) => fs.statSync(path.join(root, file)).isFile())
    .sort();
}

/** Writes a package in the test folder's `node_modules`, with a package.json and the files given. */
function writePackage(name: string, { version = "1.0.0", license = "MIT", files = {} as Record<string, string> } = {}) {
  folder.write(`node_modules/${name}/package.json`, JSON.stringify({ name, version, license }));
  for (const [file, content] of Object.entries(files)) {
    folder.write(`node_modules/${name}/${file}`, content);
  }
  return path.join(folder.dir, "node_modules", name);
}

//* Native runtime

describe("copyRuntimeFiles", () => {
  it("copies only the files and folders listed, a folder with everything in it", () => {
    writePackage("native", {
      files: {
        "index.js": "",
        "src/native.cc": "",
        "prebuilds/mac/native.node": "",
        "prebuilds/linux/native.node": "",
      },
    });

    copyRuntimeFiles(path.join(folder.dir, "node_modules"), path.join(folder.dir, "plugin"), {
      native: ["package.json", "index.js", "prebuilds/mac"],
    });

    expect(filesIn("plugin")).toEqual([
      path.join("native", "index.js"),
      path.join("native", "package.json"),
      path.join("native", "prebuilds", "mac", "native.node"),
    ]);
  });

  it("empties the target first, so a file or package dropped from the list goes too", () => {
    writePackage("native", { files: { "index.js": "" } });
    folder.write("plugin/native/old.js", "");
    folder.write("plugin/dropped/index.js", "");

    copyRuntimeFiles(path.join(folder.dir, "node_modules"), path.join(folder.dir, "plugin"), {
      native: ["index.js"],
    });

    expect(filesIn("plugin")).toEqual([path.join("native", "index.js")]);
  });

  it("stops, naming the package and the file, when a listed file is missing", () => {
    writePackage("native");

    expect(() =>
      copyRuntimeFiles(path.join(folder.dir, "node_modules"), path.join(folder.dir, "plugin"), {
        native: ["package.json", "moved.js"],
      }),
    ).toThrow("native: moved.js not found");
  });
});

//* Licenses

describe("packageRoot", () => {
  it.each([
    ["a package's module", "/repo/node_modules/ws/lib/index.js", "/repo/node_modules/ws"],
    [
      "a scoped package's module",
      "/repo/node_modules/@elgato/streamdeck/dist/index.js",
      "/repo/node_modules/@elgato/streamdeck",
    ],
    [
      "a nested dependency, by the last node_modules",
      "/repo/node_modules/a/node_modules/b/index.js",
      "/repo/node_modules/a/node_modules/b",
    ],
    [
      "an id with Rollup's \\0 and a query",
      "\0/repo/node_modules/ws/index.js?commonjs-module",
      "/repo/node_modules/ws",
    ],
    ["a Windows path", "C:\\repo\\node_modules\\ws\\index.js", "C:\\repo\\node_modules\\ws"],
  ])("finds the folder of %s", (_case, id, root) => {
    expect(packageRoot(id)).toBe(root);
  });

  it.each([
    ["the plugin's own sources", "/repo/src/plugin.ts"],
    ["a helper Rollup's plugins add", "\0commonjsHelpers.js"],
  ])("is undefined for %s", (_case, id) => {
    expect(packageRoot(id)).toBeUndefined();
  });
});

describe("thirdPartyNotices", () => {
  it("gives each package's name, version and license, then its license text", () => {
    const root = writePackage("ws", { version: "8.21.0", files: { LICENSE: "Copyright ws\n" } });

    const notices = thirdPartyNotices([root]);

    expect(notices).toContain("ws 8.21.0, license: MIT\n");
    expect(notices).toContain("\n\nCopyright ws\n");
  });

  it("lists every package once, sorted by name, however often it's given", () => {
    const zod = writePackage("zod", { files: { LICENSE: "zod's" } });
    const elgato = writePackage("@elgato/utils", { files: { "LICENSE.md": "elgato's" } });

    const notices = thirdPartyNotices([zod, elgato, zod]);

    expect(notices.match(/license: MIT/g)).toHaveLength(2);
    expect(notices.indexOf("@elgato/utils")).toBeLessThan(notices.indexOf("zod 1.0.0"));
  });

  it("includes every license file of a package, sorted by file name", () => {
    const root = writePackage("hidapi", {
      files: { "LICENSE-bsd.txt": "BSD", "LICENSE.txt": "pick one", COPYING: "GPL" },
    });

    const notices = thirdPartyNotices([root]);

    expect(notices).toContain("GPL\n\nBSD\n\npick one");
  });

  it("stops, naming the package, when a package has no license file", () => {
    const root = writePackage("unlicensed", { files: { "README.md": "" } });

    expect(() => thirdPartyNotices([root])).toThrow("unlicensed: no license file");
  });
});
