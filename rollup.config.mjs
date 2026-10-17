import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";

import { copyRuntimeFiles, NATIVE_RUNTIME, packageRoot, thirdPartyNotices } from "./scripts/package-files.mjs";

const isWatching = !!process.env.ROLLUP_WATCH;
const sdPlugin = "com.daczarne.litra.sdPlugin";
const pluginNodeModules = path.join(sdPlugin, "node_modules");

/**
 * node-hid ships platform .node binaries that must not be bundled.
 * Copy the files of it (and its deps) that run into the plugin folder so
 * runtime `createRequire` / Node resolution can load them next to plugin.js.
 *
 * @returns {import('rollup').Plugin}
 */
function copyNativeRuntime() {
  return {
    name: "copy-native-runtime",
    writeBundle() {
      // node-hid 3.x loads its .node binary via `pkg-prebuilds/bindings`, not `bindings`.
      copyRuntimeFiles("node_modules", pluginNodeModules, NATIVE_RUNTIME);
    },
  };
}

/**
 * The bundle is minified, which drops the license notices of the packages in it, so the build writes them next to it:
 * the plugin's own LICENSE, and the notices of every package it ships, the bundled ones and the native runtime.
 *
 * @returns {import('rollup').Plugin}
 */
function licenses() {
  return {
    name: "licenses",
    generateBundle(_options, bundle) {
      const roots = Object.values(bundle)
        .flatMap((file) => (file.type === "chunk" ? Object.keys(file.modules) : []))
        .map(packageRoot)
        .filter((root) => root !== undefined);
      const native = Object.keys(NATIVE_RUNTIME).map((name) => path.resolve("node_modules", name));
      this.emitFile({ fileName: "LICENSE", source: readFileSync("LICENSE", "utf8"), type: "asset" });
      this.emitFile({
        fileName: "THIRD_PARTY_LICENSES.txt",
        source: thirdPartyNotices([...roots, ...native]),
        type: "asset",
      });
    },
  };
}

/**
 * @type {import('rollup').RollupOptions}
 */
const config = {
  input: "src/plugin.ts",
  output: {
    file: `${sdPlugin}/bin/plugin.js`,
    sourcemap: isWatching,
    sourcemapPathTransform: (relativeSourcePath, sourcemapPath) => {
      return url.pathToFileURL(path.resolve(path.dirname(sourcemapPath), relativeSourcePath)).href;
    },
  },
  external: ["node-hid"],
  plugins: [
    {
      name: "watch-externals",
      buildStart() {
        this.addWatchFile(`${sdPlugin}/manifest.json`);
      },
    },
    typescript({
      mapRoot: isWatching ? "./" : undefined,
    }),
    nodeResolve({
      browser: false,
      exportConditions: ["node"],
      preferBuiltins: true,
    }),
    commonjs(),
    !isWatching && terser(),
    {
      name: "emit-module-package-file",
      generateBundle() {
        this.emitFile({
          fileName: "package.json",
          source: `{ "type": "module" }`,
          type: "asset",
        });
      },
    },
    licenses(),
    copyNativeRuntime(),
  ],
};

export default config;
