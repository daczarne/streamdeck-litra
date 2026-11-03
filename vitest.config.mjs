import { defineConfig } from "vitest/config";

// The tests that run litra-manager on emulated lamps, which run once on Beams and once on Beam LXs (#100). The Beam LX
// differs where a Beam doesn't need the plugin's help, such as its serial number and how it turns on, so every
// scenario is checked on both. `src/integration/litra.test.ts` goes through every model on its own.
const ON_EMULATED_LAMPS = ["src/litra-manager.test.ts", "src/integration/actions.test.ts"];

export default defineConfig({
  // Oxc can't lower standard decorators yet, only TypeScript's legacy ones, and Node can't run them. The actions'
  // tests replace @action with a decorator that returns the class unchanged, which works the same either way. The
  // build compiles with tsc, which keeps the standard ones.
  oxc: { decorator: { legacy: true } },
  resolve: {
    // The plugin's bundle runs litra's ESM build, which Rollup takes from its `module` field, where Vitest would take
    // the CommonJS one from `main`. The tests run the same build, which is also the one whose import of node-hid
    // vi.mock can replace: the CommonJS build's require() is out of its reach.
    alias: [{ find: /^litra$/, replacement: "litra/dist/esm/driver.js" }],
  },
  test: {
    mockReset: true,
    projects: [
      {
        extends: true,
        // The plugin's tests, and the scripts' tests, which sit next to them.
        test: { name: "once", include: ["src/**/*.test.ts", "scripts/**/*.test.ts"], exclude: ON_EMULATED_LAMPS },
      },
      // The model each run's lamps are, which the tests take with `inject("model")`.
      { extends: true, test: { name: "Beam", include: ON_EMULATED_LAMPS, provide: { model: "Beam" } } },
      { extends: true, test: { name: "Beam LX", include: ON_EMULATED_LAMPS, provide: { model: "Beam LX" } } },
    ],
    // What npm run coverage measures: the plugin's code under the unit and integration tests. The settings pages'
    // scripts run in Chrome, under the browser tests, out of V8's reach here.
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/test-support/**"],
      // Every file in the table, even under an agent like Claude Code, for which Vitest leaves out the fully covered
      // ones.
      reporter: [["text", { skipFull: false }], "html"],
      reportsDirectory: "coverage",
    },
    server: {
      deps: {
        // Vitest leaves dependencies to Node, out of vi.mock's reach. Through Vitest, litra's import of node-hid gets
        // the fake one, so the integration tests run litra against emulated lamps rather than the ones plugged in.
        // Vitest already takes litra's ESM build in, since Node can't run it, but the tests' safety mustn't rest on it.
        inline: ["litra"],
      },
    },
  },
});
