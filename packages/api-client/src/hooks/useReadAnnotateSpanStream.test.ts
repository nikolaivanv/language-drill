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
