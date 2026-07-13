import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the SSE client BEFORE the SUT import — every test installs a fresh
// generator factory that yields the frames it wants the hook to see.
// ---------------------------------------------------------------------------

const { mockFetchSseImpl, lastUrl } = vi.hoisted(() => ({
  mockFetchSseImpl: {
    value: null as
      | null
      | ((init: RequestInit) => AsyncIterable<{ type: string; data: string }>),
  },
  lastUrl: { value: undefined as string | undefined },
}));

vi.mock('../sse-client', async () => {
  const actual = await vi.importActual<typeof import('../sse-client')>('../sse-client');
  return {
    ...actual,
    fetchSse: (url: string, init: RequestInit = {}) => {
      lastUrl.value = url;
      if (!mockFetchSseImpl.value) {
        throw new Error('mockFetchSseImpl not set — test forgot to configure it');
      }
      return mockFetchSseImpl.value(init);
    },
  };
});

import { Language } from '@language-drill/shared';
import type { DeepCard } from '@language-drill/shared';
import {
  useReadAnnotateSpanStream,
  type Span,
} from './useReadAnnotateSpanStream';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORD_CARD: DeepCard = {
  type: 'word',
  surface: 'aldea',
  lemma: 'aldea',
  pos: 'noun',
  contextualSense: 'small village (here: the rural settlement)',
  definition: 'pueblo pequeño',
  definitionLabel: 'Español',
  cefr: 'B2',
  freq: 4200,
};

const SPAN: Span = {
  language: Language.ES,
  text: 'La aldea recibió al pintor.',
  start: 3,
  end: 8,
};

const SAVED_SPAN: Span = { ...SPAN, entryId: '11111111-1111-1111-1111-111111111111' };

function frame(type: string, payload: unknown): { type: string; data: string } {
  return { type, data: JSON.stringify(payload) };
}

function gen(
  frames: Array<{ type: string; data: string }>,
): AsyncIterable<{ type: string; data: string }> {
  return (async function* () {
    for (const f of frames) yield f;
  })();
}

/** A generator that yields the given frames then hangs (never terminates),
 * letting a test observe the streaming `partial` without a terminal event. */
function genThenHang(
  frames: Array<{ type: string; data: string }>,
): AsyncIterable<{ type: string; data: string }> {
  return (async function* () {
    for (const f of frames) yield f;
    await new Promise(() => {
      // never resolves
    });
  })();
}

/** A hand-driven SSE channel: an async iterable whose frames are pushed on
 * demand via `emit`, and which ends when `close` is called. Lets a test
 * interleave two concurrent streams (start word1, start word2, then complete
 * word1 late) with deterministic ordering. */
function makeChannel(): {
  iterable: AsyncIterable<{ type: string; data: string }>;
  emit: (f: { type: string; data: string }) => void;
  close: () => void;
} {
  const queue: Array<{ type: string; data: string }> = [];
  let wake: (() => void) | null = null;
  let closed = false;
  const iterable = (async function* () {
    while (true) {
      while (queue.length > 0) yield queue.shift()!;
      if (closed) return;
      await new Promise<void>((resolve) => {
        wake = resolve;
      });
    }
  })();
  return {
    iterable,
    emit(f) {
      queue.push(f);
      wake?.();
      wake = null;
    },
    close() {
      closed = true;
      wake?.();
      wake = null;
    },
  };
}

/** Flush pending micro- + macro-tasks so a hand-driven channel's generator
 * body advances past an `emit`, letting a test assert on the *absence* of a
 * state change (a superseded stream's frame must be a reducer no-op). */
async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

const SPAN1: Span = { language: Language.ES, text: 'La aldea grande.', start: 3, end: 8 };
const SPAN2: Span = { language: Language.ES, text: 'La aldea grande.', start: 9, end: 15 };

const WORD1_CARD: DeepCard = { ...WORD_CARD, surface: 'aldea', lemma: 'aldea' };
const WORD2_CARD: DeepCard = { ...WORD_CARD, surface: 'grande', lemma: 'grande' };

function makeOptions(onResolved = vi.fn()) {
  return {
    baseUrl: 'https://stub-fn-url/',
    getToken: vi.fn().mockResolvedValue('test-jwt'),
    onResolved,
  };
}

beforeEach(() => {
  mockFetchSseImpl.value = null;
  lastUrl.value = undefined;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useReadAnnotateSpanStream — progressive partial (Req 1.2)', () => {
  it('merges each `field` event into the streaming partial card', async () => {
    mockFetchSseImpl.value = () =>
      genThenHang([
        frame('field', { key: 'type', value: 'word' }),
        frame('field', { key: 'definition', value: 'pueblo pequeño' }),
      ]);

    const { result } = renderHook(() => useReadAnnotateSpanStream(makeOptions()));
    act(() => {
      result.current.start(SPAN);
    });

    // `partial` is a discriminated-union `Partial<DeepCard>`; read it through a
    // record view for assertions on individual preview fields.
    const partialOf = (): Record<string, unknown> => {
      if (result.current.state.phase !== 'streaming') throw new Error('not streaming');
      return result.current.state.partial as Record<string, unknown>;
    };

    await waitFor(() => {
      expect(partialOf().definition).toBe('pueblo pequeño');
    });
    expect(partialOf()).toMatchObject({ type: 'word', definition: 'pueblo pequeño' });
    if (result.current.state.phase !== 'streaming') throw new Error('phase guard');
    expect(result.current.state.span).toEqual(SPAN);
  });
});

describe('useReadAnnotateSpanStream — happy path (Req 1.3)', () => {
  it('field → field → done lands `complete` with the card and fires onResolved once', async () => {
    const onResolved = vi.fn();
    mockFetchSseImpl.value = () =>
      gen([
        frame('field', { key: 'type', value: 'word' }),
        frame('field', { key: 'definition', value: 'pueblo pequeño' }),
        frame('done', { card: WORD_CARD }),
      ]);

    const { result } = renderHook(() =>
      useReadAnnotateSpanStream(makeOptions(onResolved)),
    );
    act(() => {
      result.current.start(SAVED_SPAN);
    });

    await waitFor(() => expect(result.current.state.phase).toBe('complete'));
    if (result.current.state.phase !== 'complete') throw new Error('phase guard');

    expect(result.current.state.card).toEqual(WORD_CARD);
    expect(result.current.state.span).toEqual(SAVED_SPAN);
    // onResolved fires exactly once with the authoritative card + span.
    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(onResolved).toHaveBeenCalledWith(WORD_CARD, SAVED_SPAN);
  });
});

describe('useReadAnnotateSpanStream — mid-stream error (Req 1.5)', () => {
  it('field then server `error` frame → error phase, partial discarded, onResolved NOT fired', async () => {
    const onResolved = vi.fn();
    mockFetchSseImpl.value = () =>
      gen([
        frame('field', { key: 'type', value: 'word' }),
        frame('error', { code: 'AI_UNAVAILABLE', message: 'Annotation temporarily unavailable' }),
      ]);

    const { result } = renderHook(() =>
      useReadAnnotateSpanStream(makeOptions(onResolved)),
    );
    act(() => {
      result.current.start(SPAN);
    });

    await waitFor(() => expect(result.current.state.phase).toBe('error'));
    if (result.current.state.phase !== 'error') throw new Error('phase guard');

    expect(result.current.state.error.code).toBe('AI_UNAVAILABLE');
    expect(result.current.state.span).toEqual(SPAN);
    // The error phase carries no `partial`/`card` — the preview is discarded.
    expect('partial' in result.current.state).toBe(false);
    expect('card' in result.current.state).toBe(false);
    expect(onResolved).not.toHaveBeenCalled();
  });
});

describe('useReadAnnotateSpanStream — rate limit (429)', () => {
  it('429 thrown from fetchSse → error with RATE_LIMIT_EXCEEDED + status 429', async () => {
    mockFetchSseImpl.value = () => {
      const err: Error & { status?: number; body?: unknown } = new Error('Slow down');
      err.status = 429;
      err.body = { code: 'RATE_LIMIT_EXCEEDED', message: 'Daily span-annotation limit exceeded' };
      throw err;
    };

    const { result } = renderHook(() => useReadAnnotateSpanStream(makeOptions()));
    act(() => {
      result.current.start(SPAN);
    });

    await waitFor(() => expect(result.current.state.phase).toBe('error'));
    if (result.current.state.phase !== 'error') throw new Error('phase guard');

    expect(result.current.state.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(result.current.state.error.status).toBe(429);
  });
});

describe('useReadAnnotateSpanStream — body closed without done/error (Req 1.5)', () => {
  it('iterator ends silently after a field → error with AI_UNAVAILABLE', async () => {
    mockFetchSseImpl.value = () =>
      gen([frame('field', { key: 'type', value: 'word' })]);

    const { result } = renderHook(() => useReadAnnotateSpanStream(makeOptions()));
    act(() => {
      result.current.start(SPAN);
    });

    await waitFor(() => expect(result.current.state.phase).toBe('error'));
    if (result.current.state.phase !== 'error') throw new Error('phase guard');
    expect(result.current.state.error.code).toBe('AI_UNAVAILABLE');
  });
});

describe('useReadAnnotateSpanStream — abort', () => {
  it('abort cancels the stream silently (no error phase, onResolved not fired)', async () => {
    const onResolved = vi.fn();
    let capturedSignal: AbortSignal | undefined;
    mockFetchSseImpl.value = (init) => {
      capturedSignal = init.signal ?? undefined;
      return genThenHang([frame('field', { key: 'type', value: 'word' })]);
    };

    const { result } = renderHook(() =>
      useReadAnnotateSpanStream(makeOptions(onResolved)),
    );
    act(() => {
      result.current.start(SPAN);
    });
    await waitFor(() => expect(capturedSignal).toBeDefined());

    act(() => {
      result.current.abort();
    });

    expect(capturedSignal?.aborted).toBe(true);
    // Abort doesn't transition to error — state stays in `streaming`.
    expect(result.current.state.phase).toBe('streaming');
    expect(onResolved).not.toHaveBeenCalled();
  });

  it('reset() returns the hook to idle and aborts any in-flight stream', async () => {
    let capturedSignal: AbortSignal | undefined;
    mockFetchSseImpl.value = (init) => {
      capturedSignal = init.signal ?? undefined;
      return genThenHang([]);
    };

    const { result } = renderHook(() => useReadAnnotateSpanStream(makeOptions()));
    act(() => {
      result.current.start(SPAN);
    });
    await waitFor(() => expect(capturedSignal).toBeDefined());

    act(() => {
      result.current.reset();
    });

    expect(capturedSignal?.aborted).toBe(true);
    expect(result.current.state.phase).toBe('idle');
  });
});

describe('useReadAnnotateSpanStream — switch mid-stream detaches (does not abort)', () => {
  it('starting a second stream leaves the first running; both fire onResolved, state follows the second', async () => {
    const onResolved = vi.fn();
    const ch1 = makeChannel();
    const ch2 = makeChannel();
    const signals: Array<AbortSignal | undefined> = [];
    let call = 0;
    mockFetchSseImpl.value = (init) => {
      signals.push(init.signal ?? undefined);
      call += 1;
      return call === 1 ? ch1.iterable : ch2.iterable;
    };

    const { result } = renderHook(() =>
      useReadAnnotateSpanStream(makeOptions(onResolved)),
    );

    // Open word1 and let it stream a field.
    act(() => {
      result.current.start(SPAN1);
    });
    await waitFor(() => expect(signals.length).toBe(1));
    act(() => ch1.emit(frame('field', { key: 'type', value: 'word' })));

    // Switch to word2 before word1 completes.
    act(() => {
      result.current.start(SPAN2);
    });
    await waitFor(() => expect(signals.length).toBe(2));

    // The first stream must NOT have been aborted — it stays alive to complete.
    expect(signals[0]?.aborted).toBe(false);

    // Visible state follows word2.
    act(() => ch2.emit(frame('field', { key: 'definition', value: 'W2DEF' })));
    await waitFor(() => {
      if (result.current.state.phase !== 'streaming') throw new Error('not streaming');
      expect(result.current.state.span).toEqual(SPAN2);
    });

    // A stray late field from the superseded word1 must not pollute word2's
    // partial. (Snapshot into a fresh local at each checkpoint so TS re-widens
    // the union — `result.current.state` narrowing would otherwise leak across
    // the phase transitions below.)
    act(() => ch1.emit(frame('field', { key: 'definition', value: 'W1STALE' })));
    await flush();
    const afterStale = result.current.state;
    if (afterStale.phase !== 'streaming') throw new Error('not streaming');
    expect((afterStale.partial as Record<string, unknown>).definition).toBe('W2DEF');
    expect(afterStale.span).toEqual(SPAN2);

    // word1 completes LATE: onResolved fires for word1, but the visible state is
    // NOT overwritten (still streaming word2).
    act(() => {
      ch1.emit(frame('done', { card: WORD1_CARD }));
      ch1.close();
    });
    await waitFor(() => expect(onResolved).toHaveBeenCalledWith(WORD1_CARD, SPAN1));
    const afterWord1Done = result.current.state;
    expect(afterWord1Done.phase).toBe('streaming');
    if (afterWord1Done.phase === 'streaming') {
      expect(afterWord1Done.span).toEqual(SPAN2);
    }

    // word2 completes: state → complete with word2's card; onResolved fires for word2.
    act(() => {
      ch2.emit(frame('done', { card: WORD2_CARD }));
      ch2.close();
    });
    await waitFor(() => expect(result.current.state.phase).toBe('complete'));
    const finalState = result.current.state;
    if (finalState.phase !== 'complete') throw new Error('phase guard');
    expect(finalState.card).toEqual(WORD2_CARD);
    expect(onResolved).toHaveBeenCalledWith(WORD2_CARD, SPAN2);
    expect(onResolved).toHaveBeenCalledTimes(2);
  });

  it('abort() cancels BOTH the detached and the active stream', async () => {
    const onResolved = vi.fn();
    const ch1 = makeChannel();
    const ch2 = makeChannel();
    const signals: Array<AbortSignal | undefined> = [];
    let call = 0;
    mockFetchSseImpl.value = (init) => {
      signals.push(init.signal ?? undefined);
      call += 1;
      return call === 1 ? ch1.iterable : ch2.iterable;
    };

    const { result } = renderHook(() =>
      useReadAnnotateSpanStream(makeOptions(onResolved)),
    );
    act(() => {
      result.current.start(SPAN1);
    });
    await waitFor(() => expect(signals.length).toBe(1));
    act(() => {
      result.current.start(SPAN2);
    });
    await waitFor(() => expect(signals.length).toBe(2));

    act(() => {
      result.current.abort();
    });

    expect(signals[0]?.aborted).toBe(true);
    expect(signals[1]?.aborted).toBe(true);
    expect(onResolved).not.toHaveBeenCalled();
  });
});

describe('useReadAnnotateSpanStream — POST target', () => {
  it('appends /read/annotate-span to the base URL (trailing slash trimmed)', async () => {
    mockFetchSseImpl.value = () => gen([frame('done', { card: WORD_CARD })]);

    const { result } = renderHook(() => useReadAnnotateSpanStream(makeOptions()));
    act(() => {
      result.current.start(SPAN);
    });

    await waitFor(() => expect(result.current.state.phase).toBe('complete'));
    // Base URL `https://stub-fn-url/` → trailing slash trimmed + deep path.
    expect(lastUrl.value).toBe('https://stub-fn-url/read/annotate-span');
  });
});
