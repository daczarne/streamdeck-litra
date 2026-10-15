import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo, Socket } from "node:net";

// Fixed by the WebSocket protocol (RFC 6455): the server proves the handshake by hashing the client's key with it.
const WEBSOCKET_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

export type StreamDeckMessage = { event: string; context?: string; payload?: Record<string, unknown> };

/**
 * Stands in for the WebSocket that Stream Deck opens for a settings page: it accepts the page's connection and
 * records the messages the page sends. Node has a WebSocket client but no server, so this decodes the frames itself,
 * as far as the pages need: text frames from the client, and its close frame.
 */
export class FakeStreamDeck {
  readonly messages: StreamDeckMessage[] = [];
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
        this.messages.push(JSON.parse(payload.toString("utf8")));
        for (const waiter of [...this.waiters]) waiter();
      } else if (opcode === 0x8) {
        socket.end(Buffer.from([0x88, 0x00]));
      }
    }
    return buffer;
  }
}
