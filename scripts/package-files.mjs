/**
 * What the build puts in the plugin folder besides the bundle: the native runtime the bundle loads, and the licenses of
 * everything it ships. `rollup.config.mjs` runs both, so a linked plugin and a packaged one carry the same files.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from "node:fs";
import path from "node:path";

// The files node-hid needs at runtime, and their licenses, by package. Everything else in them (C sources, build
// files, the binaries for the platforms the manifest leaves out) is only needed to compile. node-hid's own dependency,
// node-addon-api, is one of those: a set of headers, which nothing loads at runtime. node-hid's binary has hidapi
// compiled in, hence hidapi's licenses. A path missing after an upgrade stops the build.
export const NATIVE_RUNTIME = {
  "node-hid": [
    "package.json",
    "nodehid.js",
    "binding-options.js",
    "LICENSE-bsd.txt",
    "hidapi/LICENSE.txt",
    "hidapi/LICENSE-bsd.txt",
    "hidapi/LICENSE-gpl3.txt",
    "hidapi/LICENSE-orig.txt",
    "prebuilds/HID-darwin-arm64",
    "prebuilds/HID-darwin-x64",
  ],
  "pkg-prebuilds": ["package.json", "bindings.js", "lib/prebuild.js", "LICENSE"],
};

const LICENSE_FILE = /^(?:license|licence|copying)(?:[.-]|$)/i;
const NODE_MODULES = /[\\/]node_modules[\\/]((?:@[^\\/]+[\\/])?[^\\/]+)/g;

//* Native runtime

/**
 * Copies the listed files of each package from one `node_modules` into another, which it empties first: the target
 * is build output, so it holds only what the list names, and a file or package dropped from the list goes too.
 *
 * @param {string} from the `node_modules` to copy from
 * @param {string} to the `node_modules` to copy into
 * @param {Record<string, string[]>} files the paths to copy, by package, relative to the package's folder
 * @returns {void}
 */
export function copyRuntimeFiles(from, to, files) {
  rmSync(to, { recursive: true, force: true });
  for (const [name, paths] of Object.entries(files)) {
    for (const file of paths) {
      const source = path.join(from, name, file);
      if (!existsSync(source)) {
        throw new Error(`${name}: ${file} not found in ${from}, though the plugin needs it at runtime`);
      }
      const target = path.join(to, name, file);
      mkdirSync(path.dirname(target), { recursive: true });
      cpSync(source, target, { recursive: true });
    }
  }
}

//* Licenses

/**
 * The folder of the package a module belongs to, or undefined for a module outside `node_modules`, such as the
 * plugin's own sources or a helper Rollup's plugins add. Rollup's ids can start with `\0` and end with a query, which
 * the path ignores.
 *
 * @param {string} moduleId a module's id, as Rollup gives it
 * @returns {string | undefined}
 */
export function packageRoot(moduleId) {
  const id = moduleId.replace(/^\0/, "").replace(/\?.*$/, "");
  // The last node_modules in the path, which is the one a nested dependency sits in.
  const last = [...id.matchAll(NODE_MODULES)].at(-1);
  return last === undefined ? undefined : id.slice(0, last.index + last[0].length);
}

/**
 * The notices for the packages given: each one's name, version and license, followed by its license files, sorted by
 * name. A package without a license file stops the build, so a new dependency can't ship without its license.
 *
 * @param {Iterable<string>} roots the packages' folders, each listed once however often it's given
 * @returns {string}
 */
export function thirdPartyNotices(roots) {
  const packages = [...new Set(roots)].map((root) => {
    const manifest = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
    const files = readdirSync(root)
      .filter((file) => LICENSE_FILE.test(file))
      .sort();
    if (files.length === 0) {
      throw new Error(`${manifest.name}: no license file in ${root}`);
    }
    const texts = files.map((file) => readFileSync(path.join(root, file), "utf8").trim());
    return {
      name: manifest.name,
      heading: `${manifest.name} ${manifest.version}, license: ${manifest.license}`,
      texts,
    };
  });
  packages.sort((a, b) => a.name.localeCompare(b.name));

  const rule = "=".repeat(80);
  const sections = packages.map(({ heading, texts }) => [rule, heading, rule, "", texts.join("\n\n")].join("\n"));
  return `The Litra plugin ships code from the packages below, under the licenses that follow each one.\n\n${sections.join("\n\n")}\n`;
}
