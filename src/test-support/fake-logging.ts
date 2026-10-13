import { vi } from "vitest";

/**
 * Stands in for `src/logging.ts`, mocked with `vi.mock("./logging", () => import("./test-support/fake-logging"))`,
 * so the tests can inspect what is logged. The real logger writes to a logs/ folder.
 */
export const logger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  trace: vi.fn(),
  // Every scope logs to the same fake, so a test needn't know which scope a message comes from.
  createScope: () => logger,
};
