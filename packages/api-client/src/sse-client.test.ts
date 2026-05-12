import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { fetchSse, type FetchSseError, type SseFrame } from './sse-client';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a `Response` whose body streams the given chunks (pre-encoded UTF-8)
 * one at a time. Each chunk lands in `TextDecoderStream` in order, matching
 * the real-world arrival of network packets.
 */
function streamingResponse(
  chunks: string[],
  init: ResponseInit & { contentType?: string } = {},
): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  const headers = new Headers(init.headers);
  if (!headers.has('content-type')) {
    headers.set(
      'content-type',
      init.contentType ?? 'text/event-stream; charset=utf-8',
    );
  }
  return new Response(stream, { ...init, headers });
}

async function collect(iter: AsyncIterable<SseFrame>): Promise<SseFrame[]> {
  const frames: SseFrame[] = [];
  for await (const f of iter) frames.push(f);
  return frames;
}

// ---------------------------------------------------------------------------
// fetch mock
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;
const mockFetch = vi.fn<typeof fetch>();

beforeEach(() => {
  mockFetch.mockReset();
  globalThis.fetch = mockFetch as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('fetchSse — frame parsing', () => {
  it('(a) two events in one chunk', async () => {
    mockFetch.mockResolvedValueOnce(
      streamingResponse([
        'event: meta\ndata: {"a":1}\n\nevent: flag\ndata: {"b":2}\n\n',
      ]),
    );

    const frames = await collect(fetchSse('https://stub/'));

    expect(frames).toEqual([
      { type: 'meta', data: '{"a":1}' },
      { type: 'flag', data: '{"b":2}' },
    ]);
  });

  it('(b) one event split across two chunks', async () => {
    mockFetch.mockResolvedValueOnce(
      streamingResponse(['event: meta\ndata: {"a":', '1}\n\n']),
    );

    const frames = await collect(fetchSse('https://stub/'));

    expect(frames).toEqual([{ type: 'meta', data: '{"a":1}' }]);
  });

  it('(c) blank/heartbeat frame between events is ignored', async () => {
    mockFetch.mockResolvedValueOnce(
      streamingResponse([
        'event: meta\ndata: {"a":1}\n\n',
        ': heartbeat\n\n',
        'event: flag\ndata: {"b":2}\n\n',
      ]),
    );

    const frames = await collect(fetchSse('https://stub/'));

    expect(frames).toEqual([
      { type: 'meta', data: '{"a":1}' },
      { type: 'flag', data: '{"b":2}' },
    ]);
  });

  it('(d) malformed lines inside a frame are ignored, but the frame still yields', async () => {
    mockFetch.mockResolvedValueOnce(
      streamingResponse([
        'event: flag\nnotacolonpair\ndata: {"ok":true}\nid: 42\n\n',
      ]),
    );

    const frames = await collect(fetchSse('https://stub/'));

    expect(frames).toEqual([{ type: 'flag', data: '{"ok":true}' }]);
  });

  it('defaults the event type to "message" when no event: line is present', async () => {
    mockFetch.mockResolvedValueOnce(
      streamingResponse(['data: hello\n\n']),
    );

    const frames = await collect(fetchSse('https://stub/'));

    expect(frames).toEqual([{ type: 'message', data: 'hello' }]);
  });
});

describe('fetchSse — error branches', () => {
  it('(e) non-text/event-stream content-type throws', async () => {
    mockFetch.mockResolvedValueOnce(
      streamingResponse(['{"some":"json"}'], {
        contentType: 'application/json',
      }),
    );

    let caught: unknown;
    try {
      await collect(fetchSse('https://stub/'));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/text\/event-stream/);
  });

  it('(f) 429 response throws with status + body attached', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(
        JSON.stringify({ code: 'RATE_LIMIT_EXCEEDED', message: 'Slow down' }),
        {
          status: 429,
          headers: { 'content-type': 'application/json' },
        },
      ),
    );

    let caught: FetchSseError | undefined;
    try {
      await collect(fetchSse('https://stub/'));
    } catch (err) {
      caught = err as FetchSseError;
    }

    expect(caught).toBeDefined();
    expect(caught?.status).toBe(429);
    expect(caught?.body).toEqual({
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Slow down',
    });
    // Message prefers the body's `message` field over the generic fallback.
    expect(caught?.message).toBe('Slow down');
  });

  it('401 with non-JSON body still throws with status attached', async () => {
    mockFetch.mockResolvedValueOnce(
      new Response('not json', {
        status: 401,
        headers: { 'content-type': 'text/plain' },
      }),
    );

    let caught: FetchSseError | undefined;
    try {
      await collect(fetchSse('https://stub/'));
    } catch (err) {
      caught = err as FetchSseError;
    }

    expect(caught?.status).toBe(401);
    expect(caught?.body).toBeNull();
    expect(caught?.message).toBe('Request failed: 401');
  });
});

describe('fetchSse — abort propagation', () => {
  it('(g) AbortController.abort() propagates through fetch', async () => {
    const controller = new AbortController();

    // `fetch` is called and immediately rejects with the abort error — the
    // browser/runtime does this when `signal.aborted` is already true at
    // request time, OR when `abort()` lands mid-flight.
    mockFetch.mockImplementationOnce(async (_url, init) => {
      const signal = (init as RequestInit | undefined)?.signal;
      if (signal) {
        return new Promise<Response>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        });
      }
      throw new Error('No signal passed through');
    });

    const promise = collect(fetchSse('https://stub/', { signal: controller.signal }));
    controller.abort();

    await expect(promise).rejects.toThrow();
  });

  it('passes the AbortSignal through to fetch', async () => {
    const controller = new AbortController();
    mockFetch.mockResolvedValueOnce(streamingResponse(['event: meta\ndata: {}\n\n']));

    await collect(fetchSse('https://stub/', { signal: controller.signal }));

    expect(mockFetch).toHaveBeenCalledWith(
      'https://stub/',
      expect.objectContaining({ signal: controller.signal }),
    );
  });
});
