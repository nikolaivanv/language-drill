import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CefrLevel, Language } from '@language-drill/shared';
import type { ReviewSummary } from '@language-drill/api-client';
import { ActiveLanguageProvider } from '../../../../../components/shell';
import ReviewSummaryPage from './page';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetToken = vi.fn().mockResolvedValue('test-token');
vi.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ getToken: mockGetToken }),
}));

const mockPush = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockUseReviewSummary = vi.fn();
vi.mock('@language-drill/api-client', () => ({
  createAuthenticatedFetch: vi.fn(() => vi.fn()),
  useReviewSummary: (...args: unknown[]) => mockUseReviewSummary(...args),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const SESSION_ID = '11111111-1111-1111-1111-111111111111';

const summary: ReviewSummary = {
  total: 4,
  correct: 2,
  partial: 1,
  missed: 1,
  promoted: ['aprovechar'],
  lapsed: ['imprescindible'],
  newCards: 2,
  items: [
    { lemma: 'ev', surface: 'evler', itemType: 'cloze', outcome: 'correct' },
    { lemma: 'apenas', surface: null, itemType: 'meaning', outcome: 'partial' },
    { lemma: 'imprescindible', surface: null, itemType: 'recognition', outcome: 'incorrect' },
    { lemma: 'aprovechar', surface: 'aproveché', itemType: 'cloze', outcome: 'correct' },
  ],
  grammarDeltas: [
    { grammarPoint: 'ablative case', from: 0.62, to: 0.71 },
    { grammarPoint: 'preterite', from: 0.5, to: 0.46 },
  ],
  nextDueAt: '2026-06-01T09:00:00.000Z',
  durationSeconds: 195,
};

// React `use()` reads a fulfilled-thenable synchronously (no Suspense in jsdom).
function fulfilledThenable<T>(value: T): Promise<T> {
  const t = Promise.resolve(value) as Promise<T> & { status?: string; value?: T };
  t.status = 'fulfilled';
  t.value = value;
  return t;
}

function renderSummary() {
  return render(
    <ActiveLanguageProvider
      profiles={[{ language: Language.ES, proficiencyLevel: CefrLevel.B1 }]}
    >
      <ReviewSummaryPage params={fulfilledThenable({ sessionId: SESSION_ID })} />
    </ActiveLanguageProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseReviewSummary.mockReturnValue({
    isLoading: false,
    error: null,
    data: summary,
    refetch: vi.fn(),
  });
});

// ---------------------------------------------------------------------------
// Loading / error
// ---------------------------------------------------------------------------

describe('ReviewSummaryPage states', () => {
  it('renders a skeleton while loading', () => {
    mockUseReviewSummary.mockReturnValue({ isLoading: true, error: null, data: undefined });
    const { container } = renderSummary();
    expect(container.querySelector('.animate-pulse')).not.toBeNull();
  });

  it('renders an error card with retry on failure', () => {
    mockUseReviewSummary.mockReturnValue({
      isLoading: false,
      error: new Error('boom'),
      data: undefined,
      refetch: vi.fn(),
    });
    renderSummary();
    expect(screen.getByText(/couldn't load this session summary/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
  });

  it('queries with the sessionId from params', () => {
    renderSummary();
    expect(mockUseReviewSummary).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: SESSION_ID }),
    );
  });
});

// ---------------------------------------------------------------------------
// Counts + promoted/lapsed/new (Req 11.1)
// ---------------------------------------------------------------------------

describe('ReviewSummaryPage counts', () => {
  it('shows clean/partial/missed counts', () => {
    renderSummary();
    expect(screen.getByText('2 of 4 clean.')).toBeInTheDocument();
    expect(screen.getByText(/1 partial · 1 missed/)).toBeInTheDocument();
  });

  it('shows promoted, lapsed, and new-card cards with chips', () => {
    renderSummary();
    expect(screen.getByText('promoted')).toBeInTheDocument();
    expect(screen.getByText('lapsed')).toBeInTheDocument();
    expect(screen.getByText('new cards added')).toBeInTheDocument();
    // Chips list the promoted/lapsed lemmas (also appear in the per-item recap).
    expect(screen.getAllByText('aprovechar').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('imprescindible').length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Per-item recap + next-due (Req 11.3)
// ---------------------------------------------------------------------------

describe('ReviewSummaryPage per-item recap', () => {
  it('lists each item with its surface and type', () => {
    renderSummary();
    expect(screen.getByText('ev')).toBeInTheDocument();
    expect(screen.getByText('as evler')).toBeInTheDocument();
    // Outcome ticks are labelled for accessibility.
    expect(screen.getAllByLabelText('correct')).toHaveLength(2);
    expect(screen.getByLabelText('partial')).toBeInTheDocument();
    expect(screen.getByLabelText('incorrect')).toBeInTheDocument();
  });

  it('shows when the next batch is due', () => {
    renderSummary();
    expect(screen.getByText(/next batch due/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Grammar deltas (Req 11.2)
// ---------------------------------------------------------------------------

describe('ReviewSummaryPage grammar deltas', () => {
  it('renders before→after for each grammar point', () => {
    renderSummary();
    expect(screen.getByText('ablative case')).toBeInTheDocument();
    expect(screen.getByText('62% → 71% (+9)')).toBeInTheDocument();
    expect(screen.getByText('preterite')).toBeInTheDocument();
    expect(screen.getByText('50% → 46% (-4)')).toBeInTheDocument();
  });

  it('shows an empty-state when no grammar points moved', () => {
    mockUseReviewSummary.mockReturnValue({
      isLoading: false,
      error: null,
      data: { ...summary, grammarDeltas: [] },
      refetch: vi.fn(),
    });
    renderSummary();
    expect(screen.getByText(/no grammar points carried evidence/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// No gamification (Req 11.4)
// ---------------------------------------------------------------------------

describe('ReviewSummaryPage tone', () => {
  it('never shows streak / XP / points', () => {
    renderSummary();
    expect(screen.queryByText(/streak/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/\bxp\b/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/great job/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Next actions (Req 11.5, 13.3)
// ---------------------------------------------------------------------------

describe('ReviewSummaryPage next actions', () => {
  it('deep-links to the existing progress radar (Req 13.3)', () => {
    renderSummary();
    fireEvent.click(screen.getByRole('button', { name: /see full radar/i }));
    expect(mockPush).toHaveBeenCalledWith('/progress');
  });

  it('routes to the bank and back to the hub', () => {
    renderSummary();
    fireEvent.click(screen.getByRole('button', { name: /browse bank/i }));
    expect(mockPush).toHaveBeenCalledWith('/review/bank');
    fireEvent.click(screen.getByRole('button', { name: /done/i }));
    expect(mockPush).toHaveBeenCalledWith('/review');
  });
});
