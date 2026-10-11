import { defineConfig } from "vitest/config";

export default defineConfig({
  // Oxc can't lower standard decorators yet, only TypeScript's legacy ones, and Node can't run them. The actions'
  // tests replace @action with a decorator that returns the class unchanged, which works the same either way. The
  // build compiles with tsc, which keeps the standard ones.
  oxc: { decorator: { legacy: true } },
  test: {
    // Only our own tests: ref/ may hold local clones of upstream projects, with their own test suites.
    include: ["src/**/*.test.ts"],
    mockReset: true,
  },
});
