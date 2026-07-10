import { Suspense } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { act, render, screen, fireEvent, type RenderResult } from '@testing-library/react';
import type { VocabTopicDetail, VocabWord } from '@language-drill/api-client';
import VocabDetailPage from './page';

// The route's `params` prop is a Promise, unwrapped via React's `use()`. Real
// Next.js App Router pages always render inside a Suspense boundary (the
// framework provides one), and `use()` relies on that boundary's `.then()`
// retry to re-render once the promise settles. Since `Promise.resolve()`
// settles on the microtask queue, the render + retry must be wrapped in
// `act(async () => …)` — a bare synchronous `render()` never observes the
// retry and the test hangs until timeout.
async function renderPage(
  paramsPromise: Promise<{ umbrellaKey: string }>,
): Promise<RenderResult> {
  let result!: RenderResult;
  await act(async () => {
    result = render(
      <Suspense fallback={<span role="status">loading…</span>}>
        <VocabDetailPage params={paramsPromise} />
      </Suspense>,
    );
  });
  return result;
}

async function rerenderPage(
  rerender: RenderResult['rerender'],
  paramsPromise: Promise<{ umbrellaKey: string }>,
): Promise<void> {
  await act(async () => {
    rerender(
      <Suspense fallback={<span role="status">loading…</span>}>
        <VocabDetailPage params={paramsPromise} />
      </Suspense>,
    );
  });
}

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetToken = vi.fn().mockResolvedValue('test-token');
vi.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ getToken: mockGetToken }),
}));

const mockRefetch = vi.fn();
const mockUseVocabTopicDetail = vi.fn();
vi.mock('@language-drill/api-client', () => ({
  createAuthenticatedFetch: vi.fn(() => vi.fn()),
  useVocabTopicDetail: (args: unknown) => mockUseVocabTopicDetail(args),
}));

// next/link → plain anchor (jsdom).
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const WORD: VocabWord = {
  lemma: 'manzana',
  displayForm: 'la manzana',
  gloss: 'apple',
  exampleSentence: 'Como una manzana.',
  freqRank: 800,
  tier: 'core',
  state: 'untested',
};

function detail(o: Partial<VocabTopicDetail> = {}): VocabTopicDetail {
  return {
    umbrellaKey: 'es-a1-vocab-food-drink',
    name: 'Food and drink (A1)',
    cefrLevel: 'A1',
    words: [WORD],
    ...o,
  };
}

function loaded(data: VocabTopicDetail) {
  return { data, isLoading: false, isError: false, refetch: mockRefetch };
}

// `params` is a fresh Promise each call — mirrors the real Next.js contract
// (a distinct params object per navigation).
function params(umbrellaKey = 'es-a1-vocab-food-drink') {
  return Promise.resolve({ umbrellaKey });
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('VocabDetailPage', () => {
  it('renders words and a drill-this-topic link', async () => {
    mockUseVocabTopicDetail.mockReturnValue(
      loaded(detail({ words: [{ ...WORD, state: 'practiced-strong' }] })),
    );
    await renderPage(params());

    expect(screen.getByText('la manzana')).toBeInTheDocument();

    const drill = screen.getByRole('link', { name: /drill this topic/i });
    expect(drill).toHaveAttribute(
      'href',
      '/drill?start=quick&grammarPoint=es-a1-vocab-food-drink&exerciseType=vocab_recall',
    );
  });

  it('links back to the vocab topic list', async () => {
    mockUseVocabTopicDetail.mockReturnValue(loaded(detail()));
    await renderPage(params());

    const back = screen.getByRole('link', { name: /back to vocabulary coverage/i });
    expect(back).toHaveAttribute('href', '/vocab');
  });

  it('hides the gloss until tapped', async () => {
    mockUseVocabTopicDetail.mockReturnValue(loaded(detail()));
    await renderPage(params());

    expect(screen.queryByText('apple')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /la manzana/i }));
    expect(screen.getByText('apple')).toBeInTheDocument();
  });

  it('hides the drill-this-topic link when no word is drillable', async () => {
    mockUseVocabTopicDetail.mockReturnValue(
      loaded(detail({ words: [{ ...WORD, state: 'not-yet' }] })),
    );
    await renderPage(params());

    expect(screen.queryByRole('link', { name: /drill this topic/i })).not.toBeInTheDocument();
  });

  it('shows loading and error states', async () => {
    mockUseVocabTopicDetail.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      refetch: mockRefetch,
    });
    const { rerender } = await renderPage(params());
    expect(screen.getByRole('status')).toBeInTheDocument();

    mockUseVocabTopicDetail.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      refetch: mockRefetch,
    });
    await rerenderPage(rerender, params());
    expect(screen.getByText(/couldn't load/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('decodes an encoded umbrellaKey route param', async () => {
    mockUseVocabTopicDetail.mockReturnValue(loaded(detail()));
    await renderPage(params('es-a1-vocab-food%20drink'));

    expect(mockUseVocabTopicDetail).toHaveBeenCalledWith(
      expect.objectContaining({ umbrellaKey: 'es-a1-vocab-food drink' }),
    );
    expect(screen.getByText('Food and drink (A1)')).toBeInTheDocument();
  });
});
