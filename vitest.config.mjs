import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Only our own tests: ref/ may hold local clones of upstream projects, with their own test suites.
    include: ["src/**/*.test.ts"],
    mockReset: true,
  },
});
