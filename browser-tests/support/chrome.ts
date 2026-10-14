import { type ChildProcess, spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Readable, Writable } from "node:stream";

const DEFAULT_CHROME: Partial<Record<NodeJS.Platform, string>> = {
  darwin: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  linux: "google-chrome",
};

type Message = {
  id?: number;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: { message: string };
  sessionId?: string | undefined;
};
type Listener = (params: unknown) => void;

/** The parts of the protocol's `Runtime.ExceptionDetails` that the tests read. */
export type ExceptionDetails = { text: string; exception?: { description?: string } };

/**
 * A headless Chrome, driven over the DevTools protocol through a pipe (`--remote-debugging-pipe`): Chrome reads
 * commands from file descriptor 3 and writes replies and events to 4, each message ending in a NUL byte. Unlike
 * `--remote-debugging-port`, this opens no TCP port that other processes could connect to.
 */
export class Chrome {
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void }>();
  private readonly listeners = new Map<string, Set<Listener>>();
  private buffer = "";
  private stderr = "";
  private readonly write: (message: Message) => void;

  private constructor(
    private readonly process: ChildProcess,
    private readonly profileDir: string,
  ) {
    const toChrome = process.stdio[3] as Writable;
    const fromChrome = process.stdio[4] as Readable;
    this.write = (message) => toChrome.write(`${JSON.stringify(message)}\0`);
    fromChrome.setEncoding("utf8");
    fromChrome.on("data", (chunk: string) => this.receive(chunk));
    process.stderr?.setEncoding("utf8");
    process.stderr?.on("data", (chunk: string) => (this.stderr = (this.stderr + chunk).slice(-4000)));
    process.on("exit", () => {
      for (const { reject } of this.pending.values()) reject(new Error(`Chrome exited:\n${this.stderr}`));
      this.pending.clear();
    });
  }

  /**
   * Starts Chrome from `CHROME_PATH`, or from where the platform usually installs it, and resolves once it answers
   * over the pipe, so the time it takes to start counts against the caller and not against the first command sent.
   */
  static async launch(): Promise<Chrome> {
    const executable = process.env.CHROME_PATH ?? DEFAULT_CHROME[process.platform];
    if (!executable) throw new Error(`No default Chrome on ${process.platform}: set CHROME_PATH`);
    const profileDir = mkdtempSync(path.join(tmpdir(), "litra-browser-tests-"));
    const child = spawn(
      executable,
      [
        "--headless",
        "--remote-debugging-pipe",
        `--user-data-dir=${profileDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        // Keep Chrome itself off the network while the tests run.
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-sync",
        "about:blank",
      ],
      { stdio: ["ignore", "ignore", "pipe", "pipe", "pipe"] },
    );
    await new Promise<void>((resolve, reject) => {
      child.once("spawn", resolve);
      child.once("error", (error) =>
        reject(new Error(`Can't start Chrome at ${executable} (set CHROME_PATH): ${error.message}`)),
      );
    });
    // A spawned Chrome isn't ready yet: on a cold machine, such as a CI runner, it takes seconds to start. Asking it
    // for something it can answer right away, without opening a page, waits for that here, so the start is timed
    // against the caller (the tests' setup and its long timeout) instead of against the first test.
    const chrome = new Chrome(child, profileDir);
    await chrome.send("Browser.getVersion");
    return chrome;
  }

  /**
   * Sends a command, to the browser or, with `sessionId`, to one page. The protocol's replies are untyped JSON, so the
   * caller states the shape of the result it reads.
   */
  send<Result = unknown>(method: string, params: object = {}, sessionId?: string): Promise<Result> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: (result) => resolve(result as Result), reject });
      this.write({ id, method, params, sessionId });
    });
  }

  /** Calls `listener` with the parameters of every `method` event from the given page, in the shape it states. */
  on<Params>(sessionId: string, method: string, listener: (params: Params) => void): void {
    const key = `${sessionId}:${method}`;
    let listeners = this.listeners.get(key);
    if (listeners === undefined) {
      listeners = new Set();
      this.listeners.set(key, listeners);
    }
    listeners.add((params) => listener(params as Params));
  }

  /** Opens a blank page and returns the session that drives it, with its page, console and network events on. */
  async newPage(): Promise<Page> {
    const { targetId } = await this.send<{ targetId: string }>("Target.createTarget", { url: "about:blank" });
    const { sessionId } = await this.send<{ sessionId: string }>("Target.attachToTarget", { targetId, flatten: true });
    const page = new Page(this, targetId, sessionId);
    await Promise.all(["Page", "Runtime", "Log", "Network"].map((domain) => page.send(`${domain}.enable`)));
    return page;
  }

  async close(): Promise<void> {
    const exited = new Promise((resolve) => this.process.once("exit", resolve));
    this.process.kill();
    await exited;
    rmSync(this.profileDir, { recursive: true, force: true });
  }

  private receive(chunk: string): void {
    this.buffer += chunk;
    for (let end = this.buffer.indexOf("\0"); end !== -1; end = this.buffer.indexOf("\0")) {
      const message: Message = JSON.parse(this.buffer.slice(0, end));
      this.buffer = this.buffer.slice(end + 1);
      if (message.id !== undefined) {
        const pending = this.pending.get(message.id);
        this.pending.delete(message.id);
        if (message.error) pending?.reject(new Error(message.error.message));
        else pending?.resolve(message.result);
      } else if (message.method) {
        for (const listener of this.listeners.get(`${message.sessionId}:${message.method}`) ?? []) {
          listener(message.params);
        }
      }
    }
  }
}

/** One page of a `Chrome`, with the commands the tests need. */
export class Page {
  constructor(
    private readonly chrome: Chrome,
    private readonly targetId: string,
    readonly sessionId: string,
  ) {}

  send<Result = unknown>(method: string, params: object = {}): Promise<Result> {
    return this.chrome.send<Result>(method, params, this.sessionId);
  }

  on<Params>(method: string, listener: (params: Params) => void): void {
    this.chrome.on(this.sessionId, method, listener);
  }

  /** Navigates to `url` and resolves once the page has loaded. */
  async goto(url: string): Promise<void> {
    const loaded = new Promise<void>((resolve) => this.on("Page.loadEventFired", () => resolve()));
    const { errorText } = await this.send<{ errorText?: string }>("Page.navigate", { url });
    if (errorText) throw new Error(`Can't load ${url}: ${errorText}`);
    await loaded;
  }

  /**
   * Runs `expression` in the page and returns its value, awaiting it if it is a promise. Code run this way isn't
   * subject to the page's Content-Security-Policy, but what it asks the page to load or connect to is.
   */
  async evaluate<T = unknown>(expression: string): Promise<T> {
    const { result, exceptionDetails } = await this.send<{
      result: { value?: unknown };
      exceptionDetails?: ExceptionDetails;
    }>("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value as T;
  }

  async close(): Promise<void> {
    await this.chrome.send("Target.closeTarget", { targetId: this.targetId });
  }
}
