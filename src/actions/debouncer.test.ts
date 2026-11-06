import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { logger } from "../logging";
import { createDialDebouncer } from "./debouncer";

//* Fakes

// The real logger writes to a logs/ folder.
vi.mock("../logging", () => import("../test-support/fake-logging"));

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
});

afterEach(() => {
  vi.useRealTimers();
});

//* Tests

/** What a dial action gives the debouncer to run with the ticks it gathered. */
type Flush = (ticks: number) => void | Promise<void>;

// The two ways a flush fails: an async flush rejects, and one that isn't async throws before returning anything.
const failedFlushes: [string, (error: Error) => Flush][] = [
  ["rejects", (error) => () => Promise.reject(error)],
  [
    "throws",
    (error) => () => {
      throw error;
    },
  ],
];

describe("createDialDebouncer", () => {
  it("flushes once, 60 ms after the last tick", async () => {
    const flush = vi.fn();
    const debounce = createDialDebouncer(flush, logger);

    debounce(1);
    await vi.advanceTimersByTimeAsync(59);
    expect(flush).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(flush).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledWith(1);
  });

  it("sums the ticks received within the window", async () => {
    const flush = vi.fn();
    const debounce = createDialDebouncer(flush, logger);

    debounce(1);
    debounce(2);
    debounce(-1);
    await vi.advanceTimersByTimeAsync(60);

    expect(flush).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledWith(2);
  });

  it("restarts the window on every tick", async () => {
    const flush = vi.fn();
    const debounce = createDialDebouncer(flush, logger);

    debounce(1);
    await vi.advanceTimersByTimeAsync(50);
    debounce(1);
    await vi.advanceTimersByTimeAsync(50);
    expect(flush).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10);
    expect(flush).toHaveBeenCalledOnce();
    expect(flush).toHaveBeenCalledWith(2);
  });

  it("starts counting from zero after a flush", async () => {
    const flush = vi.fn();
    const debounce = createDialDebouncer(flush, logger);

    debounce(3);
    await vi.advanceTimersByTimeAsync(60);
    debounce(1);
    await vi.advanceTimersByTimeAsync(60);

    expect(flush.mock.calls).toEqual([[3], [1]]);
  });

  it("uses the given delay", async () => {
    const flush = vi.fn();
    const debounce = createDialDebouncer(flush, logger, 200);

    debounce(1);
    await vi.advanceTimersByTimeAsync(199);
    expect(flush).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(flush).toHaveBeenCalledOnce();
  });

  it("waits for a running flush, then flushes every tick received meanwhile at once", async () => {
    const flush = vi.fn(() => new Promise<void>((resolve) => setTimeout(resolve, 300)));
    const debounce = createDialDebouncer(flush, logger);

    debounce(1);
    await vi.advanceTimersByTimeAsync(60);
    debounce(2);
    await vi.advanceTimersByTimeAsync(100);
    debounce(3);
    await vi.advanceTimersByTimeAsync(100);
    expect(flush.mock.calls).toEqual([[1]]);

    await vi.advanceTimersByTimeAsync(100);
    expect(flush.mock.calls).toEqual([[1], [5]]);

    await vi.advanceTimersByTimeAsync(1000);
    expect(flush.mock.calls).toEqual([[1], [5]]);
  });

  it.each(failedFlushes)("keeps flushing after a flush that %s (#46)", async (_how, failing) => {
    const flush = vi.fn<Flush>().mockImplementationOnce(failing(new Error("HID write failed")));
    const debounce = createDialDebouncer(flush, logger);

    debounce(1);
    await vi.advanceTimersByTimeAsync(60);
    debounce(1);
    await vi.advanceTimersByTimeAsync(60);

    expect(flush).toHaveBeenCalledTimes(2);
  });

  it.each(failedFlushes)("logs a dial flush that %s with its error, for the stack (#46)", async (_how, failing) => {
    const error = new Error("flush broke");
    const debounce = createDialDebouncer(failing(error), logger);

    debounce(1);
    await vi.advanceTimersByTimeAsync(60);

    expect(logger.error).toHaveBeenCalledExactlyOnceWith(expect.any(String), error);
  });
});
