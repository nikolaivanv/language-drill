import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock the SSE client BEFORE the SUT import — every test installs a fresh
// generator factory that yields the frames it wants the hook to see.
// ---------------------------------------------------------------------------

const { mockFetchSseImpl } = vi.hoisted(() => ({
  mockFetchSseImpl: { value: null as null | ((init: RequestInit) => AsyncIterable<{ type: string; data: string }>) },
}));

vi.mock('../sse-client', async () => {
  const actual = await vi.importActual<typeof import('../sse-client')>('../sse-client');
  return {
    ...actual,
    fetchSse: (_url: string, init: RequestInit = {}) => {
      if (!mockFetchSseImpl.value) {
        throw new Error('mockFetchSseImpl not set — test forgot to configure it');
      }
      return mockFetchSseImpl.value(init);
    },
  };
});

import { Language, type LearningLanguage } from '@language-drill/shared';
import { useReadAnnotateStream } from './useReadAnnotateStream';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ALDEA_FLAG_EVENT = {
  matchedForm: 'aldea',
  lemma: 'aldea',
  pos: 'noun',
  gloss: 'small village',
  example: 'Visitamos la aldea ayer.',
  freq: 4200,
  cefr: 'B2',
};
const INDIFERENCIA_FLAG_EVENT = {
  matchedForm: 'indiferencia',
  lemma: 'indiferencia',
  pos: 'noun',
  gloss: 'indifference',
  example: 'Su indiferencia me sorprendió.',
  freq: 5800,
  cefr: 'B2',
};

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

function makeOptions() {
  return {
    baseUrl: 'https://stub-fn-url/',
    getToken: vi.fn().mockResolvedValue('test-jwt'),
  };
}

const START_INPUT: { language: LearningLanguage; text: string } = {
  language: Language.ES,
  text: 'La aldea recibió al pintor.',
};

beforeEach(() => {
  mockFetchSseImpl.value = null;
});

afterEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('useReadAnnotateStream — happy path', () => {
  it('meta → 2× flag → done lands the hook in `complete` with both flags', async () => {
    mockFetchSseImpl.value = () =>
      gen([
        frame('meta', {
          calibration: { cefr: 'B1', top: 3000 },
          candidateCount: 2,
        }),
        frame('flag', ALDEA_FLAG_EVENT),
        frame('flag', INDIFERENCIA_FLAG_EVENT),
        frame('done', { flaggedCount: 2 }),
      ]);

    const { result } = renderHook(() => useReadAnnotateStream(makeOptions()));
    act(() => {
      result.current.start(START_INPUT);
    });

    await waitFor(() => expect(result.current.state.phase).toBe('complete'));
    if (result.current.state.phase !== 'complete') throw new Error('phase guard');

    expect(result.current.state.flaggedCount).toBe(2);
    expect(result.current.state.candidateCount).toBe(2);
    expect(result.current.state.calibration).toEqual({ cefr: 'B1', top: 3000 });
    expect(Object.keys(result.current.state.flaggedMap)).toEqual([
      'aldea',
      'indiferencia',
    ]);
    expect(result.current.state.flaggedMap.aldea.lemma).toBe('aldea');
    // matchedForm is stripped from the WordFlag value — it became the key.
    expect('matchedForm' in result.current.state.flaggedMap.aldea).toBe(false);
  });
});

describe('useReadAnnotateStream — rate limit (429)', () => {
  it('429 thrown from fetchSse → state error, status 429, empty flaggedMap', async () => {
    mockFetchSseImpl.value = () => {
      const err: Error & { status?: number; body?: unknown } = new Error('Slow down');
      err.status = 429;
      err.body = { code: 'RATE_LIMIT_EXCEEDED', message: 'Slow down' };
      throw err;
    };

    const { result } = renderHook(() => useReadAnnotateStream(makeOptions()));
    act(() => {
      result.current.start(START_INPUT);
    });

    await waitFor(() => expect(result.current.state.phase).toBe('error'));
    if (result.current.state.phase !== 'error') throw new Error('phase guard');

    expect(result.current.state.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(result.current.state.error.status).toBe(429);
    expect(result.current.state.flaggedMap).toEqual({});
    expect(result.current.state.flaggedCount).toBe(0);
  });
});

describe('useReadAnnotateStream — mid-stream error (Req 5.10 partial-flag retention)', () => {
  it('meta + 1 flag then server `error` frame → state error, partial flag retained', async () => {
    mockFetchSseImpl.value = () =>
      gen([
        frame('meta', { calibration: { cefr: 'B1', top: 3000 }, candidateCount: 5 }),
        frame('flag', ALDEA_FLAG_EVENT),
        frame('error', { code: 'AI_UNAVAILABLE', message: 'Evaluation temporarily unavailable' }),
      ]);

    const { result } = renderHook(() => useReadAnnotateStream(makeOptions()));
    act(() => {
      result.current.start(START_INPUT);
    });

    await waitFor(() => expect(result.current.state.phase).toBe('error'));
    if (result.current.state.phase !== 'error') throw new Error('phase guard');

    expect(result.current.state.error.code).toBe('AI_UNAVAILABLE');
    expect(Object.keys(result.current.state.flaggedMap)).toEqual(['aldea']);
    expect(result.current.state.flaggedCount).toBe(1);
    expect(result.current.state.calibration).toEqual({ cefr: 'B1', top: 3000 });
    expect(result.current.state.candidateCount).toBe(5);
  });
});

describe('useReadAnnotateStream — body closed without done/error (Req 5.10)', () => {
  it('iterator ends silently after meta + 1 flag → state error with code AI_UNAVAILABLE, partial flag retained', async () => {
    mockFetchSseImpl.value = () =>
      gen([
        frame('meta', { calibration: { cefr: 'B1', top: 3000 }, candidateCount: 3 }),
        frame('flag', ALDEA_FLAG_EVENT),
        // No done, no error — iterator ends.
      ]);

    const { result } = renderHook(() => useReadAnnotateStream(makeOptions()));
    act(() => {
      result.current.start(START_INPUT);
    });

    await waitFor(() => expect(result.current.state.phase).toBe('error'));
    if (result.current.state.phase !== 'error') throw new Error('phase guard');

    expect(result.current.state.error.code).toBe('AI_UNAVAILABLE');
    // Partial flag still visible to the user.
    expect(Object.keys(result.current.state.flaggedMap)).toEqual(['aldea']);
    expect(result.current.state.flaggedCount).toBe(1);
  });
});

describe('useReadAnnotateStream — abort', () => {
  it('abort cancels the underlying stream (signal.aborted === true on the init passed to fetchSse)', async () => {
    let capturedSignal: AbortSignal | undefined;
    // Iterator that waits forever — only abort can end it.
    mockFetchSseImpl.value = (init) => {
      capturedSignal = init.signal ?? undefined;
      return (async function* () {
        await new Promise(() => {
          // never resolves
        });
        // The yield is unreachable in this test but lets TS infer the
        // generator's yield type correctly.
        yield frame('done', { flaggedCount: 0 });
      })();
    };

    const { result } = renderHook(() => useReadAnnotateStream(makeOptions()));
    act(() => {
      result.current.start(START_INPUT);
    });

    // Wait one tick for the iterator's first read to subscribe to the signal.
    await waitFor(() => expect(capturedSignal).toBeDefined());

    act(() => {
      result.current.abort();
    });

    expect(capturedSignal?.aborted).toBe(true);
    // Abort doesn't transition state — the page keeps whatever phase it
    // had (here: `streaming` since META never arrived).
    expect(result.current.state.phase).toBe('streaming');
  });

  it('reset() returns the hook to idle and aborts any in-flight stream', async () => {
    let capturedSignal: AbortSignal | undefined;
    mockFetchSseImpl.value = (init) => {
      capturedSignal = init.signal ?? undefined;
      return (async function* () {
        await new Promise(() => {
          // never resolves
        });
        yield frame('done', { flaggedCount: 0 });
      })();
    };

    const { result } = renderHook(() => useReadAnnotateStream(makeOptions()));
    act(() => {
      result.current.start(START_INPUT);
    });
    await waitFor(() => expect(capturedSignal).toBeDefined());

    act(() => {
      result.current.reset();
    });

    expect(capturedSignal?.aborted).toBe(true);
    expect(result.current.state.phase).toBe('idle');
  });
});

describe('useReadAnnotateStream — start() twice in a row', () => {
  it('the second start aborts the first controller', async () => {
    const signals: AbortSignal[] = [];
    mockFetchSseImpl.value = (init) => {
      if (init.signal) signals.push(init.signal);
      return (async function* () {
        await new Promise(() => {
          // never resolves
        });
        yield frame('done', { flaggedCount: 0 });
      })();
    };

    const { result } = renderHook(() => useReadAnnotateStream(makeOptions()));
    act(() => {
      result.current.start(START_INPUT);
    });
    await waitFor(() => expect(signals).toHaveLength(1));

    act(() => {
      result.current.start(START_INPUT);
    });
    await waitFor(() => expect(signals).toHaveLength(2));

    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });
});
