/**
 * Local dev server for the annotate-stream Lambda.
 *
 * Mirrors the convention in `infra/lambda/src/dev.ts`: stubs the
 * `awslambda` runtime global, serves the handler over plain Node http, and
 * honors `DEV_USER_ID` to skip Clerk JWT verification (the bypass lives in
 * `./jwt.ts`).
 *
 * Serves BOTH endpoints the Function URL handler dispatches by path: the skim
 * pass (`POST /read/annotate` and the bare base URL) and the deep-span stream
 * (`POST /read/annotate-span`). `synthesizeEvent` sets `requestContext.http
 * .path` from the request URL, which is what the handler's path dispatch
 * branches on; the `DEV_USER_ID` bypass in `./jwt.ts` runs before any path
 * logic, so it applies to both flows identically.
 *
 * Usage:
 *   DATABASE_URL=... ANTHROPIC_API_KEY=... DEV_USER_ID=dev_user_001 \
 *     npx tsx --watch src/annotate-stream/dev.ts
 */

// IMPORTANT: the `awslambda` stub MUST be installed before `./handler` is
// evaluated (the handler reads the global at module init). Bundlers hoist all
// `import` statements above top-level statements, so the stub can't be a plain
// assignment here — it lives in `./awslambda-shim` and is imported FIRST.
// Side-effect imports run in source order, so this reliably wins the race.
import './awslambda-shim';

import http from 'node:http';
import type { Writable } from 'node:stream';
import type { LambdaFunctionURLEvent } from 'aws-lambda';

// The handler import deliberately comes AFTER the `awslambda-shim` import above
// — it reads the global at module-init time.
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
 * `requestContext.http.method` + `.path` (method gate + skim/deep path
 * dispatch), `headers` (auth), `body` (parsing).
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
