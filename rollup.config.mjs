import commonjs from "@rollup/plugin-commonjs";
import nodeResolve from "@rollup/plugin-node-resolve";
import terser from "@rollup/plugin-terser";
import typescript from "@rollup/plugin-typescript";
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const isWatching = !!process.env.ROLLUP_WATCH;
const sdPlugin = "com.daczarne.litra.sdPlugin";
const pluginNodeModules = path.join(sdPlugin, "node_modules");

/**
 * node-hid ships platform .node binaries that must not be bundled.
 * Copy the installed package (and its deps) into the plugin folder so
 * runtime `createRequire` / Node resolution can load them next to plugin.js.
 */
function copyNativeRuntime() {
  return {
    name: "copy-native-runtime",
    writeBundle() {
      const packages = ["node-hid", "node-addon-api", "bindings"];
      for (const name of packages) {
        const from = path.join("node_modules", name);
        const to = path.join(pluginNodeModules, name);
        if (!existsSync(from)) {
          continue;
        }
        rmSync(to, { recursive: true, force: true });
        mkdirSync(path.dirname(to), { recursive: true });
        cpSync(from, to, { recursive: true });
      }
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
    copyNativeRuntime(),
  ],
};

export default config;
