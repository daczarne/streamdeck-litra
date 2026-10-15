import fs from "node:fs";
import path from "node:path";
import { type LogEntry, type LogEntryFormatter, Logger, type LogTarget, stringFormatter } from "@elgato/utils/logging";

export type RotatingFileTargetOptions = {
  /** The folder the files are written to, created on the first write. */
  dest: string;
  /** The current file is `<fileName>.log`, and the older ones `<fileName>.1.log`, `<fileName>.2.log`, … */
  fileName: string;
  /** The size in bytes a file stays within, unless a single entry is larger. */
  maxBytes: number;
  /** How many older files are kept besides the current one. */
  backupCount: number;
  format: LogEntryFormatter;
};

/**
 * Writes log entries to a file that is kept across restarts, and rotated only once it's full, like Python's
 * RotatingFileHandler (#41). The SDK's own file target starts a new file every time the plugin starts, so a few
 * restarts while chasing a bug would push out the run that showed it.
 *
 * When the next entry would take the current file past its size, the file becomes `.1`, every older file moves up one,
 * and the one past the last kept is deleted. A write that fails is dropped, so logging never fails a lamp operation.
 */
export class RotatingFileTarget implements LogTarget {
  private readonly options: RotatingFileTargetOptions;

  /** Takes where to write and how much to keep. Nothing is written until the first entry. */
  constructor(options: RotatingFileTargetOptions) {
    this.options = options;
  }

  /** Appends an entry to the current file, rotating the files first if it wouldn't fit. */
  write(entry: LogEntry): void {
    const line = `${this.options.format(entry)}\n`;
    try {
      fs.mkdirSync(this.options.dest, { recursive: true });
      // Read from the file rather than counted, so a file left by an earlier run counts in full.
      const size = this.currentSize();
      if (size > 0 && size + Buffer.byteLength(line) > this.options.maxBytes) {
        this.rotate();
      }
      fs.appendFileSync(this.filePath(0), line);
    } catch {
      // nowhere left to report it
    }
  }

  /** The path of the current file (0) or of a rotated one (1 and up, oldest last). */
  private filePath(index: number): string {
    const suffix = index === 0 ? "" : `.${index}`;
    return path.join(this.options.dest, `${this.options.fileName}${suffix}.log`);
  }

  /** The size of the current file, 0 when there is none yet. */
  private currentSize(): number {
    try {
      return fs.statSync(this.filePath(0)).size;
    } catch {
      return 0;
    }
  }

  /** Moves every file up one, dropping the oldest, so the current file starts empty. */
  private rotate(): void {
    fs.rmSync(this.filePath(this.options.backupCount), { force: true });
    for (let index = this.options.backupCount - 1; index >= 0; index -= 1) {
      if (fs.existsSync(this.filePath(index))) {
        fs.renameSync(this.filePath(index), this.filePath(index + 1));
      }
    }
  }
}

/**
 * The plugin's logger, which every module logs through. Stream Deck starts the plugin from its folder, so the files
 * land in the plugin folder's logs/, next to the SDK's own.
 */
export const logger = new Logger({
  level: "info",
  targets: [
    new RotatingFileTarget({
      dest: path.join(process.cwd(), "logs"),
      fileName: "litra",
      maxBytes: 1024 * 1024,
      backupCount: 4,
      format: stringFormatter(),
    }),
  ],
});
