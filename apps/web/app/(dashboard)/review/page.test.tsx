import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CefrLevel, Language } from '@language-drill/shared';
import type { HubOverview } from '@language-drill/api-client';
import { ActiveLanguageProvider } from '../../../components/shell';
import ReviewHubPage from './page';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetToken = vi.fn().mockResolvedValue('test-token');
vi.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ getToken: mockGetToken }),
}));

const mockUseReviewOverview = vi.fn();
vi.mock('@language-drill/api-client', () => ({
  createAuthenticatedFetch: vi.fn(() => vi.fn()),
  useReviewOverview: (...args: unknown[]) => mockUseReviewOverview(...args),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const queueOverview: HubOverview = {
  breakdown: {
    due: 8,
    new: 3,
    leech: 1,
    total: 12,
    mix: { cloze: 6, meaning: 4, recognition: 2 },
  },
  estimatedMinutes: 7,
  nextDueAt: null,
};

const emptyOverview: HubOverview = {
  breakdown: { due: 0, new: 0, leech: 0, total: 0, mix: { cloze: 0, meaning: 0, recognition: 0 } },
  estimatedMinutes: 0,
  nextDueAt: '2026-08-01T09:00:00.000Z',
};

function renderHub() {
  return render(
    <ActiveLanguageProvider
      profiles={[{ language: Language.ES, proficiencyLevel: CefrLevel.B1 }]}
    >
      <ReviewHubPage />
    </ActiveLanguageProvider>,
  );
}

describe('ReviewHubPage', () => {
  beforeEach(() => {
    mockUseReviewOverview.mockReset();
  });

  it('links to the vocabulary bank from the QUEUE state (non-empty queue)', () => {
    mockUseReviewOverview.mockReturnValue({ data: queueOverview, isLoading: false, error: null });
    renderHub();
    // The queue view renders (start review is present)…
    expect(screen.getByRole('link', { name: /start review/i })).toBeInTheDocument();
    // …and the persistent bank link is reachable even with a waiting queue.
    const bank = screen.getByRole('link', { name: /browse vocabulary/i });
    expect(bank).toHaveAttribute('href', '/review/bank');
  });

  it('still links to the vocabulary bank from the EMPTY state', () => {
    mockUseReviewOverview.mockReturnValue({ data: emptyOverview, isLoading: false, error: null });
    renderHub();
    expect(screen.getByText(/queue empty/i)).toBeInTheDocument();
    expect(
      screen.getByRole('link', { name: /browse vocabulary/i }),
    ).toHaveAttribute('href', '/review/bank');
  });
});
