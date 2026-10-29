import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";

// Fixed by the WebSocket protocol (RFC 6455): the server proves the handshake by hashing the client's key with it.
const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

// Stream Deck answers from another process, and on a slow machine, such as a CI runner, its answer reaches a page after
// the page has gone on. Holding the global settings back as long makes every run meet that, so a test that acts on a
// page before it has them fails here too, rather than only now and then in CI.
const GLOBAL_SETTINGS_DELAY_MS = 150;

export type StreamDeckMessage = { event: string; context?: string; payload?: Record<string, unknown> };

/** A lamp as the plugin lists it for a settings page (#20). */
export type ListedLamp = { id: string; label: string };

/**
 * Stands in for the WebSocket that Stream Deck opens for a settings page: it accepts the page's connection and
 * records the messages the page sends. It keeps the plugin's global settings, which it answers a page that asks for
 * them with, as Stream Deck does. It also stands in for the plugin behind it, answering a page that asks for the lamps
 * with {@link lamps}, as the plugin does. Node has a WebSocket client but no server, so this decodes the frames
 * itself, as far as the pages need: text frames from the client, and its close frame, and sends text frames back.
 */
export class FakeStreamDeck {
  readonly messages: StreamDeckMessage[] = [];
  /** The lamps the plugin finds, which a test sets before it opens a page. */
  lamps: ListedLamp[] = [];
  /** The plugin's global settings, which a test sets before it opens a page, and a page saves. */
  globalSettings: Record<string, unknown> = {};
  private readonly sockets = new Set<Socket>();
  private readonly waiters = new Set<() => void>();

  /** Answers the WebSocket handshake of every page that connects, and reads what it sends. Use `start`. */
  private constructor(private readonly server: Server) {
    server.on("upgrade", (request, socket: Socket) => {
      const accept = createHash("sha1")
        .update(request.headers["sec-websocket-key"] + WEBSOCKET_GUID)
        .digest("base64");
      socket.write(
        "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
          `Sec-WebSocket-Accept: ${accept}\r\n\r\n`,
      );
      this.sockets.add(socket);
      socket.on("close", () => this.sockets.delete(socket));
      // Closing a page resets its connection instead of closing it cleanly.
      socket.on("error", () => socket.destroy());
      let buffer: Buffer = Buffer.alloc(0);
      socket.on("data", (chunk: Buffer) => {
        buffer = this.readFrames(Buffer.concat([buffer, chunk]), socket);
      });
    });
  }

  /** Listens on a free port of `127.0.0.1`, the address the pages reach as `localhost`. */
  static async start(): Promise<FakeStreamDeck> {
    const server = createServer();
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    return new FakeStreamDeck(server);
  }

  /** The port the pages connect to, which Stream Deck passes them when it opens them. */
  get port(): number {
    return (this.server.address() as AddressInfo).port;
  }

  /** Resolves with the first message, received or still to come, that matches `predicate`. */
  waitFor(predicate: (message: StreamDeckMessage) => boolean, timeoutMs = 2000): Promise<StreamDeckMessage> {
    return new Promise((resolve, reject) => {
      const check = () => {
        const match = this.messages.find(predicate);
        if (!match) return false;
        this.waiters.delete(check);
        clearTimeout(timer);
        resolve(match);
        return true;
      };
      const timer = setTimeout(() => {
        this.waiters.delete(check);
        reject(new Error(`No matching message in ${timeoutMs} ms. Received: ${JSON.stringify(this.messages)}`));
      }, timeoutMs);
      if (!check()) this.waiters.add(check);
    });
  }

  /** Drops every page's connection and stops listening. */
  async close(): Promise<void> {
    for (const socket of this.sockets) socket.destroy();
    await new Promise((resolve) => this.server.close(resolve));
  }

  /**
   * Answers a page that asks for the global settings, a moment later, and keeps the ones it saves, as Stream Deck
   * does, and a page that asks the plugin for the lamps, as `src/actions/lamp-picker.ts` does.
   */
  private answer(message: StreamDeckMessage, socket: Socket): void {
    if (message.event === "getGlobalSettings") {
      const settings = this.globalSettings;
      setTimeout(
        () => this.send(socket, { event: "didReceiveGlobalSettings", payload: { settings } }),
        GLOBAL_SETTINGS_DELAY_MS,
      );
    } else if (message.event === "setGlobalSettings") {
      this.globalSettings = message.payload ?? {};
    } else if (message.event === "sendToPlugin" && message.payload?.event === "lamps") {
      this.send(socket, {
        event: "sendToPropertyInspector",
        ...(message.context === undefined ? {} : { context: message.context }),
        payload: { event: "lamps", lamps: this.lamps },
      });
    }
  }

  /** Sends a message to a page, in a text frame, which a server sends unmasked. */
  private send(socket: Socket, message: StreamDeckMessage): void {
    const payload = Buffer.from(JSON.stringify(message), "utf8");
    if (payload.length > 0xffff) throw new Error("Frames over 64 KiB aren't supported");
    const header =
      payload.length < 126
        ? Buffer.from([0x81, payload.length])
        : Buffer.from([0x81, 126, payload.length >> 8, payload.length & 0xff]);
    socket.write(Buffer.concat([header, payload]));
  }

  /** Decodes every complete frame at the start of `buffer`, and returns what is left of it. */
  private readFrames(buffer: Buffer, socket: Socket): Buffer {
    while (buffer.length >= 2) {
      const opcode = buffer.readUInt8(0) & 0x0f;
      let length = buffer.readUInt8(1) & 0x7f;
      let offset = 2;
      if (length === 126) {
        if (buffer.length < 4) break;
        length = buffer.readUInt16BE(2);
        offset = 4;
      } else if (length === 127) {
        throw new Error("Frames over 64 KiB aren't supported");
      }
      // Frames from a client are always masked, with a 4-byte key before the payload.
      if (buffer.length < offset + 4 + length) break;
      const mask = buffer.subarray(offset, offset + 4);
      const masked = buffer.subarray(offset + 4, offset + 4 + length);
      const payload = Buffer.from(masked.map((byte, i) => byte ^ mask.readUInt8(i % 4)));
      buffer = buffer.subarray(offset + 4 + length);

      if (opcode === 0x1) {
        const message: StreamDeckMessage = JSON.parse(payload.toString("utf8"));
        this.messages.push(message);
        this.answer(message, socket);
        for (const waiter of [...this.waiters]) waiter();
      } else if (opcode === 0x8) {
        socket.end(Buffer.from([0x88, 0x00]));
      }
    }
    return buffer;
  }
}
