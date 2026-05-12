/**
 * Minimal POST-then-SSE fetch helper.
 *
 * The browser's `EventSource` only supports GET, so the streaming-annotate
 * endpoint (POST `/read/annotate`) needs a bespoke client. This helper:
 *
 *  1. Issues a single `fetch(url, init)` — the body, headers, and signal
 *     come from the caller (so the hook can attach the Bearer JWT and the
 *     AbortController without this helper knowing about Clerk).
 *  2. Treats any `response.status >= 400` as a thrown Error, with the
 *     parsed JSON body attached as `.body` and the status as `.status` —
 *     matches the existing `fetchClient.ts` error shape so the hook reducer
 *     can branch on `err.status` / `err.body.code` uniformly.
 *  3. Refuses to start streaming if `content-type` isn't `text/event-stream`
 *     — protects against a backend that returns 200 + JSON on a degraded
 *     path (which would otherwise look like a single garbled SSE frame).
 *  4. Decodes `response.body` via `TextDecoderStream` + line buffer, splits
 *     on the SSE frame separator (`\n\n`), and yields each
 *     `{ type, data }` to the caller. Unparsed lines are ignored
 *     (per the SSE spec — robust against future header lines like
 *     `id:` / `retry:`).
 */

export type SseFrame = {
  /** The `event:` line value. Defaults to `"message"` when omitted (SSE spec). */
  type: string;
  /** The `data:` line value. Empty string when the frame has no `data:` line. */
  data: string;
};

/**
 * Error thrown by `fetchSse` when the HTTP layer or the SSE preamble check
 * fails. The shape matches `createAuthenticatedFetch`'s error so the hook
 * reducer doesn't need two branches.
 */
export type FetchSseError = Error & {
  status?: number;
  body?: unknown;
};

const FRAME_SEPARATOR = "\n\n";
const SSE_CONTENT_TYPE = "text/event-stream";

export async function* fetchSse(
  url: string,
  init: RequestInit = {},
): AsyncIterable<SseFrame> {
  const response = await fetch(url, init);

  // Non-2xx → parse body, throw with the same error shape as fetchClient.ts.
  if (!response.ok) {
    let errorBody: unknown = null;
    try {
      errorBody = await response.json();
    } catch {
      errorBody = null;
    }
    const message =
      errorBody && typeof errorBody === "object" && "message" in errorBody
        ? String((errorBody as { message: unknown }).message)
        : `Request failed: ${response.status}`;
    const err: FetchSseError = new Error(message);
    err.status = response.status;
    err.body = errorBody;
    throw err;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith(SSE_CONTENT_TYPE)) {
    const err: FetchSseError = new Error(
      `Expected ${SSE_CONTENT_TYPE} response, got: ${contentType}`,
    );
    err.status = response.status;
    throw err;
  }

  if (!response.body) {
    const err: FetchSseError = new Error("Response has no body");
    err.status = response.status;
    throw err;
  }

  // Walk the stream: decode UTF-8, accumulate into a buffer, split on the
  // SSE frame separator, yield each complete frame.
  const reader = response.body
    .pipeThrough(new TextDecoderStream())
    .getReader();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;

      let separatorIdx = buffer.indexOf(FRAME_SEPARATOR);
      while (separatorIdx !== -1) {
        const rawFrame = buffer.slice(0, separatorIdx);
        buffer = buffer.slice(separatorIdx + FRAME_SEPARATOR.length);
        const parsed = parseFrame(rawFrame);
        if (parsed !== null) yield parsed;
        separatorIdx = buffer.indexOf(FRAME_SEPARATOR);
      }
    }
  } finally {
    // Releasing the lock lets `AbortController.abort()` (which cancels the
    // body) finish synchronously; without this, an aborted iterator can
    // leave the underlying ReadableStream locked.
    try {
      reader.releaseLock();
    } catch {
      // Reader was already cancelled — nothing to release.
    }
  }
}

function parseFrame(rawFrame: string): SseFrame | null {
  if (rawFrame.length === 0) return null;

  let type = "message"; // SSE default per spec.
  let data = "";

  for (const line of rawFrame.split("\n")) {
    if (line.length === 0 || line.startsWith(":")) continue; // SSE comment / blank.
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;

    const field = line.slice(0, colonIdx);
    // Per spec: a single leading space after the colon is ignored.
    const rawValue = line.slice(colonIdx + 1);
    const value = rawValue.startsWith(" ") ? rawValue.slice(1) : rawValue;

    if (field === "event") type = value;
    else if (field === "data") data = data.length === 0 ? value : `${data}\n${value}`;
    // Ignore `id:`, `retry:`, and any unrecognised fields.
  }

  // A frame with neither `event:` nor `data:` is noise — drop it.
  if (type === "message" && data === "") return null;
  return { type, data };
}
