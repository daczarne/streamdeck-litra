import { defineConfig } from "vitest/config";

// The browser tests drive a headless Chrome, so they run apart from the unit tests, which need nothing installed.
export default defineConfig({
  test: {
    include: ["browser-tests/**/*.test.ts"],
    // Starting Chrome takes a few seconds on a cold machine.
    hookTimeout: 30_000,
  },
});
