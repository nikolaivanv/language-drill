/**
 * Local dev server for the annotate-stream Lambda.
 *
 * Mirrors the convention in `infra/lambda/src/dev.ts`: stubs the
 * `awslambda` runtime global, serves the handler over plain Node http, and
 * honors `DEV_USER_ID` to skip Clerk JWT verification (the bypass lives in
 * `./jwt.ts`).
 *
 * Usage:
 *   DATABASE_URL=... ANTHROPIC_API_KEY=... DEV_USER_ID=dev_user_001 \
 *     npx tsx --watch src/annotate-stream/dev.ts
 */

import http from 'node:http';
import type { Writable } from 'node:stream';
import type { LambdaFunctionURLEvent } from 'aws-lambda';

// IMPORTANT: stub `awslambda` BEFORE importing the handler — the handler reads
// it at module init via `awslambda.streamifyResponse(...)`. Any import that
// transitively loads `./handler` before this stub is installed will crash.
//
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

// The handler import deliberately comes AFTER the `awslambda` stub above —
// it reads the global at module-init time.
import { handler } from './handler';

const PORT = parseInt(process.env['STREAM_PORT'] ?? '3002', 10);
const DEV_USER_ID = process.env['DEV_USER_ID'] ?? 'dev_user_001';

// Make sure the handler's JWT verifier sees DEV_USER_ID even when the caller
// didn't set it explicitly. The verifier short-circuits to this value.
if (!process.env['DEV_USER_ID']) {
  process.env['DEV_USER_ID'] = DEV_USER_ID;
}

/**
 * Build a synthetic Lambda Function URL event from an incoming Node request.
 * Only the fields the handler actually reads are populated meaningfully —
 * `requestContext.http.method` (routing), `headers` (auth), `body` (parsing).
 */
function synthesizeEvent(
  req: http.IncomingMessage,
  body: string,
): LambdaFunctionURLEvent {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);

  const queryStringParameters: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    queryStringParameters[k] = v;
  });

  const headers: Record<string, string> = {};
  for (const [k, v] of Object.entries(req.headers)) {
    if (typeof v === 'string') headers[k.toLowerCase()] = v;
    else if (Array.isArray(v)) headers[k.toLowerCase()] = v.join(', ');
  }

  return {
    version: '2.0',
    routeKey: '$default',
    rawPath: url.pathname,
    rawQueryString: url.search.slice(1),
    headers,
    queryStringParameters: Object.keys(queryStringParameters).length
      ? queryStringParameters
      : undefined,
    requestContext: {
      accountId: 'anonymous',
      apiId: 'local',
      domainName: `localhost:${PORT}`,
      domainPrefix: 'local',
      http: {
        method: req.method ?? 'GET',
        path: url.pathname,
        protocol: 'HTTP/1.1',
        sourceIp: req.socket.remoteAddress ?? '127.0.0.1',
        userAgent: headers['user-agent'] ?? '',
      },
      requestId: `local-${Date.now()}`,
      routeKey: '$default',
      stage: '$default',
      time: new Date().toISOString(),
      timeEpoch: Date.now(),
    },
    body: body || undefined,
    isBase64Encoded: false,
  } as LambdaFunctionURLEvent;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const body = await readBody(req);
    const event = synthesizeEvent(req, body);
    // The `responseStream` argument to the handler is the http.ServerResponse,
    // which already extends Writable and emits `'close'` on socket close —
    // so the handler's client-disconnect detection (Req 4.9) works out of the
    // box without extra wiring.
    await handler(event, res as unknown as Writable, {});
  } catch (err) {
    console.error('[annotate-stream/dev] handler threw', err);
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('Internal Server Error');
    } else {
      res.end();
    }
  }
});

server.listen(PORT, () => {
  console.log(`Annotate-stream dev server running at http://localhost:${PORT}`);
  console.log(`  Auth bypassed — userId: ${process.env['DEV_USER_ID']}`);
  console.log(
    `  DATABASE_URL: ${process.env['DATABASE_URL'] ? '(set)' : '(NOT SET)'}`,
  );
  console.log(
    `  ANTHROPIC_API_KEY: ${
      process.env['ANTHROPIC_API_KEY'] ? '(set)' : '(NOT SET)'
    }`,
  );
});
