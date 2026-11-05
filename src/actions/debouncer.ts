import type { Logger } from "@elgato/utils/logging";

const DIAL_DEBOUNCE_MS = 60;

/**
 * Gathers a dial's ticks, or a step key's presses, for a short window, then flushes them once, so a quick turn moves
 * the lamps once. A flush waits for the previous one to finish, since both would use the lamps, and takes every tick
 * received until it starts. A flush that fails is logged with the logger of the key or dial it gathers for, and the next
 * one runs as usual (#46).
 */
export function createDialDebouncer(
  flush: (ticks: number) => void | Promise<void>,
  logger: Pick<Logger, "error">,
  delayMs = DIAL_DEBOUNCE_MS,
): (ticks: number) => void {
  let pending = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();

  const run = async (): Promise<void> => {
    const batch = pending;
    pending = 0;
    // A flush that was still running when this one was due has already taken these ticks.
    if (batch === 0) {
      return;
    }
    await flush(batch);
  };

  return (ticks: number) => {
    pending += ticks;
    if (timer !== undefined) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      timer = undefined;
      running = running.then(run).catch((error: unknown) => {
        logger.error("Dial flush failed", error);
      });
    }, delayMs);
  };
}
