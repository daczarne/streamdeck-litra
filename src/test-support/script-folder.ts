import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The repository, where the scripts and the files they're tested against live.
const REPO = path.resolve(import.meta.dirname, "../..");

/** What a script did when it ran: its exit code, and what it printed. */
export type ScriptRun = { status: number | null; stdout: string; stderr: string };

/**
 * A temporary folder for the tests of a script in `scripts/`, which hold the files the script checks. The scripts read
 * those files relative to the folder they run in, so a test writes them here, runs the script here as CI runs it from
 * the repository, and checks its exit code and output. `remove` deletes the folder, in an `afterEach`.
 */
export function createScriptFolder(prefix: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));

  return {
    dir,

    /** Writes a file in the folder, creating its folders. */
    write(file: string, content: string | Buffer): void {
      const target = path.join(dir, file);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content);
    },

    /** Copies a file from the repository into the same place in the folder. */
    copyFromRepo(file: string): void {
      this.write(file, fs.readFileSync(path.join(REPO, file)));
    },

    /** Runs a script of the repository, such as `scripts/check-ui.mjs`, with Node, in the folder. */
    run(script: string): ScriptRun {
      const { status, stdout, stderr } = spawnSync(process.execPath, [path.join(REPO, script)], {
        cwd: dir,
        encoding: "utf8",
      });
      return { status, stdout, stderr };
    },

    /** Deletes the folder and everything in it. */
    remove(): void {
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

export type ScriptFolder = ReturnType<typeof createScriptFolder>;
