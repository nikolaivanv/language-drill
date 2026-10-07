import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Language } from '@language-drill/shared';
import { FwHistoryList } from './fw-history-list';

const mockUseFreeWritingHistory = vi.fn();

vi.mock('@language-drill/api-client', () => ({
  useFreeWritingHistory: (...args: unknown[]) => mockUseFreeWritingHistory(...args),
}));

const item = {
  id: 'sub-1',
  exerciseId: 'ex-1',
  evaluatedAt: '2026-10-03T10:00:00.000Z',
  language: 'ES',
  difficulty: 'B1',
  title: 'El teletrabajo',
  score: 0.72,
  overallCefr: 'B2',
  headline: 'Clear argument, shaky agreement',
  wordCount: 182,
};

function historyState(overrides: Record<string, unknown> = {}) {
  return {
    data: { pages: [{ items: [item], nextCursor: null }] },
    isPending: false,
    isError: false,
    hasNextPage: false,
    isFetchingNextPage: false,
    fetchNextPage: vi.fn(),
    ...overrides,
  };
}

const fetchFn = vi.fn();

beforeEach(() => {
  mockUseFreeWritingHistory.mockReset();
});

describe('FwHistoryList', () => {
  it('requests the active language and links each attempt to its page', () => {
    mockUseFreeWritingHistory.mockReturnValue(historyState());
    render(<FwHistoryList language={Language.ES} fetchFn={fetchFn} />);

    expect(mockUseFreeWritingHistory).toHaveBeenCalledWith({ language: Language.ES, fetchFn });
    const row = screen.getByRole('link', { name: /El teletrabajo/ });
    expect(row).toHaveAttribute('href', '/drill/free-writing/history/sub-1');
    expect(screen.getByText('Clear argument, shaky agreement')).toBeInTheDocument();
    expect(screen.getByText('B2')).toBeInTheDocument();
    expect(screen.getByText('0.72')).toBeInTheDocument();
    expect(screen.getByText(/182 words/)).toBeInTheDocument();
  });

  it('falls back gracefully for a row missing its stored fields', () => {
    mockUseFreeWritingHistory.mockReturnValue(
      historyState({
        data: {
          pages: [
            {
              items: [
                { ...item, title: null, headline: null, overallCefr: null, score: null, wordCount: null },
              ],
              nextCursor: null,
            },
          ],
        },
      }),
    );
    render(<FwHistoryList language={Language.ES} fetchFn={fetchFn} />);
    expect(screen.getByText('Untitled prompt')).toBeInTheDocument();
  });

  it('shows an empty state with a link to write one', () => {
    mockUseFreeWritingHistory.mockReturnValue(
      historyState({ data: { pages: [{ items: [], nextCursor: null }] } }),
    );
    render(<FwHistoryList language={Language.ES} fetchFn={fetchFn} />);
    expect(screen.getByText(/No graded essays/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /write one/ })).toHaveAttribute(
      'href',
      '/drill/free-writing',
    );
  });

  it('loads older attempts on demand', () => {
    const state = historyState({ hasNextPage: true });
    mockUseFreeWritingHistory.mockReturnValue(state);
    render(<FwHistoryList language={Language.ES} fetchFn={fetchFn} />);
    fireEvent.click(screen.getByRole('button', { name: /load older attempts/ }));
    expect(state.fetchNextPage).toHaveBeenCalled();
  });

  it('shows loading and error states', () => {
    mockUseFreeWritingHistory.mockReturnValue(historyState({ data: undefined, isPending: true }));
    const { rerender } = render(<FwHistoryList language={Language.ES} fetchFn={fetchFn} />);
    expect(screen.getByText('loading…')).toBeInTheDocument();

    mockUseFreeWritingHistory.mockReturnValue(historyState({ data: undefined, isError: true }));
    rerender(<FwHistoryList language={Language.ES} fetchFn={fetchFn} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/Couldn.t load your past attempts/);
  });
});
