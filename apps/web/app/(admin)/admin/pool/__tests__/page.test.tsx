// apps/web/app/(admin)/admin/pool/__tests__/page.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { PoolStatusItem } from '@language-drill/api-client';

vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: vi.fn() }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));

const mockPoolStatus = vi.fn();
const mockGenStats = vi.fn();
const mockTheoryCoverage = vi.fn();
const mockCurriculum = vi.fn();
vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/api-client')>('@language-drill/api-client');
  return {
    ...actual,
    createAuthenticatedFetch: () => vi.fn(),
    usePoolStatus: (a: unknown) => mockPoolStatus(a),
    useGenerationStats: (a: unknown) => mockGenStats(a),
    useTheoryCoverage: (a: unknown) => mockTheoryCoverage(a),
    useCurriculum: (a: unknown) => mockCurriculum(a),
  };
});
// Render the rich cell detail as a stub so the test focuses on the page shell.
vi.mock('../_components/pool-cell-detail', () => ({
  PoolCellDetail: ({ item }: { item: PoolStatusItem }) => <div data-testid="cell-detail">{item.grammarPointKey}</div>,
}));

import PoolPage from '../page';

const poolItems: PoolStatusItem[] = [
  { language: 'TR', level: 'A1', type: 'cloze', grammarPointKey: 'tr-a1-ki-relativizer',
    approved: 5, flagged: 1, rejected: 2, lastRefilledAt: null, depletionRate7d: 1,
    targetSize: 50, generationTarget: 20, coverageDistribution: null },
  { language: 'ES', level: 'B1', type: 'translation', grammarPointKey: 'es-b1-ser-estar',
    approved: 30, flagged: 0, rejected: 1, lastRefilledAt: null, depletionRate7d: 2,
    targetSize: 75, generationTarget: 30, coverageDistribution: null },
];
const genStats = {
  costThisWeekUsd: 1, costThisMonthUsd: 2,
  jobsThisWeek: { succeeded: 1, failed: 0, running: 0, queued: 0 },
  approvalRates: [
    { language: 'TR', level: 'A1', type: 'cloze', approvedCount: 5, flaggedCount: 1, rejectedCount: 2, dedupGivenUpCount: 0, approvalRate: 0.71 },
    { language: 'ES', level: 'B1', type: 'translation', approvedCount: 30, flaggedCount: 0, rejectedCount: 1, dedupGivenUpCount: 0, approvalRate: 0.97 },
  ],
};

beforeEach(() => {
  mockPoolStatus.mockReset(); mockGenStats.mockReset();
  mockTheoryCoverage.mockReset(); mockCurriculum.mockReset();
  mockPoolStatus.mockReturnValue({ isLoading: false, isError: false, data: poolItems });
  mockGenStats.mockReturnValue({ isLoading: false, isError: false, data: genStats });
  mockTheoryCoverage.mockReturnValue({ isLoading: false, isError: false, data: { rows: [
    { language: 'TR', level: 'A1', approved: 26, flagged: 0, total: 26 },
  ] } });
  mockCurriculum.mockReturnValue({ isLoading: false, isError: false, data: { items: [
    { key: 'tr-a1-ki-relativizer', name: 'ki relativizer' },
    { key: 'es-b1-ser-estar', name: 'ser vs estar' },
  ] } });
});

describe('PoolPage', () => {
  it('renders the Exercises tab with both coverage rows and the quality table', () => {
    render(<PoolPage />);
    expect(screen.getByRole('heading', { name: 'Pool' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /tr-a1-ki-relativizer/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /es-b1-ser-estar/i })).toBeInTheDocument();
    // Generation quality (30d) section header present
    expect(screen.getByText(/generation quality/i)).toBeInTheDocument();
  });

  it('filters coverage rows by type client-side', () => {
    render(<PoolPage />);
    fireEvent.change(screen.getByLabelText('type'), { target: { value: 'cloze' } });
    expect(screen.getByRole('button', { name: /tr-a1-ki-relativizer/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /es-b1-ser-estar/i })).not.toBeInTheDocument();
  });

  it('switches to the Theory tab and shows the coverage matrix', () => {
    render(<PoolPage />);
    fireEvent.click(screen.getByRole('tab', { name: /theory/i }));
    // Matrix renders a TR row with the 26/26 cell
    expect(screen.getByText(/26\/26/)).toBeInTheDocument();
  });
});
