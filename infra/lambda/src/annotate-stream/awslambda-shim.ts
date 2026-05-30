/**
 * Dev-only `awslambda` runtime shim for the annotate-stream Function URL.
 *
 * The handler reads the `awslambda` global at module-init time
 * (`awslambda.streamifyResponse(...)`), so the stub MUST be installed before
 * `./handler` is first evaluated. This lives in its own module — imported
 * before the handler in `dev.ts` — because bundlers (tsx/esbuild) hoist all
 * `import` statements above top-level statements: a plain
 * `globalThis.awslambda = …` assignment placed above the handler import would
 * still run *after* the hoisted handler import and crash with
 * "awslambda is not defined". Side-effect imports, by contrast, run in source
 * order, so importing this first reliably wins the race.
 *
 * In production the AWS runtime provides the real global; tests install their
 * own stub via `vi.hoisted`. This shim is dev-server-only.
 */

import http from "node:http";
import type { Writable } from "node:stream";

// `streamifyResponse: (handler) => handler` is a pass-through — the AWS shim
// wraps the handler to expose the (event, responseStream, context) signature,
// which is already what our handler is written against, so no wrapping is
// needed locally.
//
// `HttpResponseStream.from` is the moment the handler commits to a status
// code + headers. The dev shim applies them to the `http.ServerResponse`
// (which is itself a Writable) and returns the same stream so subsequent
// writes flow straight to the socket.
(globalThis as unknown as { awslambda: unknown }).awslambda = {
  streamifyResponse: <T extends (...args: never[]) => unknown>(handler: T): T =>
    handler,
  HttpResponseStream: {
    from(
      underlyingStream: Writable,
      prelude: { statusCode: number; headers?: Record<string, string> },
    ): Writable {
      const res = underlyingStream as unknown as http.ServerResponse;
      // Guard: only the first `from(...)` per request gets to write headers.
      // `openSse()` and `errorJson()` are mutually exclusive in the handler
      // (only one branch ever fires), so this guard is defensive.
      if (!res.headersSent) {
        res.writeHead(prelude.statusCode, prelude.headers ?? {});
      }
      return underlyingStream;
    },
  },
};
