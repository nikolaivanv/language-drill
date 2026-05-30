/**
 * SSE / response-stream writer for the annotate-stream Lambda.
 *
 * Owns three concerns the handler shouldn't have to think about:
 *  1. Header framing for the SSE branch (`openSse`), the JSON-error branch
 *     (`errorJson`), and the OPTIONS-preflight branch (`cors200`).
 *  2. SSE event encoding (`event: <type>\ndata: <json>\n\n`).
 *  3. The "at most one terminal event" wire-protocol invariant (Req 3.3).
 *     `writeTerminal` flips an internal flag; a second call throws
 *     synchronously so the handler can't accidentally emit `done` + `error`
 *     or two `done`s. The flag is also the single source of truth the
 *     handler reads to decide whether to emit `error` after a Claude failure
 *     mid-stream.
 */

import type { Writable } from "node:stream";

// The `awslambda` runtime global is declared in `./awslambda.d.ts`.

// Public type — the handler accepts a Writable-shaped stream.
export type ResponseStream = Writable;

// Standard SSE response preamble (Req 3.1). `no-transform` blocks
// intermediaries from gzip-buffering the stream; `X-Accel-Buffering: no` is
// the nginx-family hint (harmless elsewhere) that disables proxy buffering.
const SSE_HEADERS = {
  "content-type": "text/event-stream; charset=utf-8",
  "cache-control": "no-cache, no-transform",
  connection: "keep-alive",
  "x-accel-buffering": "no",
} as const;

// Conservative permissive CORS for the OPTIONS fallback. The Function URL
// CORS config (CDK task 27) is the real preflight handler; this branch just
// guarantees a 2xx if the request reaches the handler.
const CORS_PREFLIGHT_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "Authorization, Content-Type",
  "access-control-max-age": "3600",
} as const;

// `field` carries one completed top-level key of a deep-card object as it
// streams (Req 1.1); `meta`/`flag` are the skim path's non-terminal events.
export type SseEventType = "meta" | "flag" | "field";
export type SseTerminalType = "done" | "error";

export type SseWriter = {
  openSse(): void;
  writeEvent<T>(type: SseEventType, payload: T): void;
  writeTerminal<T>(type: SseTerminalType, payload: T): void;
  /**
   * Closes the JSON-error branch. Returns a Promise that resolves once the
   * underlying response stream has fully flushed — the caller MUST await it
   * before returning from the Lambda handler, otherwise the AWS runtime can
   * close the socket while the final write is still buffered (see `close`).
   */
  errorJson(status: number, body: object): Promise<void>;
  /**
   * Closes the OPTIONS-preflight branch. See `errorJson` for why callers
   * must await.
   */
  cors200(): Promise<void>;
  /**
   * Flushes any buffered writes and waits for the underlying response stream
   * to emit `'finish'` before resolving. The Lambda handler MUST await this
   * before returning — otherwise AWS's response-streaming runtime closes the
   * socket on handler-resolve and any bytes still queued in userspace
   * (typically the last `done`/`error` frame) are silently dropped on the
   * client side. Earlier writes (`meta`, then a slow Claude call) make it
   * because the kernel drains the buffer during that wait; the final write
   * doesn't have that grace window.
   */
  close(): Promise<void>;
  readonly terminated: boolean;
};

export function createSseWriter(responseStream: ResponseStream): SseWriter {
  let stream: Writable = responseStream;
  let terminated = false;
  let opened = false;

  function writeFrame(type: string, payload: unknown): void {
    stream.write(`event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`);
  }

  return {
    openSse() {
      stream = awslambda.HttpResponseStream.from(responseStream, {
        statusCode: 200,
        headers: { ...SSE_HEADERS },
      });
      opened = true;
    },
    writeEvent(type, payload) {
      if (!opened) {
        throw new Error(
          `[sse] writeEvent('${type}') called before openSse()`,
        );
      }
      if (terminated) {
        throw new Error(
          `[sse] writeEvent('${type}') called after terminal event`,
        );
      }
      writeFrame(type, payload);
    },
    writeTerminal(type, payload) {
      if (!opened) {
        throw new Error(
          `[sse] writeTerminal('${type}') called before openSse()`,
        );
      }
      if (terminated) {
        throw new Error(
          `[sse] writeTerminal('${type}') called after stream was already terminated`,
        );
      }
      writeFrame(type, payload);
      terminated = true;
    },
    errorJson(status, body) {
      const errorStream = awslambda.HttpResponseStream.from(responseStream, {
        statusCode: status,
        headers: { "content-type": "application/json" },
      });
      errorStream.write(JSON.stringify(body));
      return new Promise<void>((resolve) => {
        errorStream.end(resolve);
      });
    },
    cors200() {
      const corsStream = awslambda.HttpResponseStream.from(responseStream, {
        statusCode: 204,
        headers: { ...CORS_PREFLIGHT_HEADERS },
      });
      return new Promise<void>((resolve) => {
        corsStream.end(resolve);
      });
    },
    close() {
      return new Promise<void>((resolve) => {
        stream.end(resolve);
      });
    },
    get terminated() {
      return terminated;
    },
  };
}
