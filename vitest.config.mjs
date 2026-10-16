import { defineConfig } from "vitest/config";

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
    // Only our own tests: ref/ may hold local clones of upstream projects, with their own test suites.
    include: ["src/**/*.test.ts"],
    mockReset: true,
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
