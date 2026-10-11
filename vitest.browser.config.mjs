import { defineConfig } from "vitest/config";

// The browser tests drive a headless Chrome, so they run apart from the unit tests, which need nothing installed.
export default defineConfig({
  test: {
    include: ["browser-tests/**/*.test.ts"],
    // Starting Chrome and loading its first page take several seconds on a cold machine, and the setup waits for both.
    hookTimeout: 30_000,
  },
});
