// apps/web/app/(admin)/admin/pool/__tests__/page.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { DiversityCell, DiversityPoint, PoolStatusItem } from '@language-drill/api-client';

vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: vi.fn() }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));

const mockPoolStatus = vi.fn();
const mockGenStats = vi.fn();
const mockTheoryCoverage = vi.fn();
const mockCurriculum = vi.fn();
const mockTheoryPool = vi.fn();
const mockDiversity = vi.fn();
vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/api-client')>('@language-drill/api-client');
  return {
    ...actual,
    createAuthenticatedFetch: () => vi.fn(),
    usePoolStatus: (a: unknown) => mockPoolStatus(a),
    useGenerationStats: (a: unknown) => mockGenStats(a),
    useTheoryCoverage: (a: unknown) => mockTheoryCoverage(a),
    useCurriculum: (a: unknown) => mockCurriculum(a),
    useTheoryPoolStatus: (a: unknown) => mockTheoryPool(a),
    useDiversity: (a: unknown) => mockDiversity(a),
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
    targetSize: 50, generationTarget: 20, coverageDistribution: null,
    status: 'active', lastJob: null },
  { language: 'ES', level: 'B1', type: 'translation', grammarPointKey: 'es-b1-ser-estar',
    approved: 30, flagged: 0, rejected: 1, lastRefilledAt: null, depletionRate7d: 2,
    targetSize: 75, generationTarget: 30, coverageDistribution: null,
    status: 'target-reached', lastJob: null },
];
// One diversity cell per pool row above. The TR row declares NEITHER family
// (the case the missing-* filters exist to find); the ES row declares both.
function cell(overrides: Partial<DiversityCell>): DiversityCell {
  return {
    cellKey: 'x', type: 'cloze', level: 'A1', approved: 5, target: 20,
    atTarget: false, axes: [], seed: { kind: 'none' }, shortfalls: [],
    provenIssues: 0, unknowns: 0,
    ...overrides,
  };
}
const diversityPoints: DiversityPoint[] = [
  {
    key: 'tr-a1-ki-relativizer', name: 'ki relativizer', language: 'TR',
    cefrLevel: 'A1', kind: 'grammar', targetOverride: null,
    provenIssues: 0, unknowns: 0,
    cells: [cell({ cellKey: 'tr:a1:cloze:tr-a1-ki-relativizer' })],
  },
  {
    key: 'es-b1-ser-estar', name: 'ser vs estar', language: 'ES',
    cefrLevel: 'B1', kind: 'grammar', targetOverride: null,
    provenIssues: 2, unknowns: 0,
    cells: [
      cell({
        cellKey: 'es:b1:translation:es-b1-ser-estar',
        type: 'translation',
        level: 'B1',
        provenIssues: 2,
        axes: [{ name: 'person', role: 'controlled', values: [{ value: '3sg', count: 4, floor: 6 }], untagged: 0 }],
        seed: { kind: 'frequency-band', band: 'verb', rankMax: 2000, distinctSeeds: 12, unlabelledRows: 0 },
      }),
    ],
  },
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
  mockTheoryPool.mockReset(); mockDiversity.mockReset();
  mockDiversity.mockReturnValue({ isLoading: false, isError: false, data: { items: diversityPoints } });
  mockTheoryPool.mockReturnValue({ isLoading: false, isError: false, data: [
    { language: 'TR', level: 'A1', grammarPointKey: 'tr-a1-approved', name: 'approved pt', hasApprovedPage: true, flaggedCount: 0, lastGeneratedAt: null },
    { language: 'TR', level: 'A1', grammarPointKey: 'tr-a1-flagged', name: 'flagged pt', hasApprovedPage: false, flaggedCount: 3, lastGeneratedAt: null },
    { language: 'TR', level: 'A1', grammarPointKey: 'tr-a1-missing', name: 'missing pt', hasApprovedPage: false, flaggedCount: 0, lastGeneratedAt: null },
  ] });
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

describe('PoolPage — diversity mechanisms', () => {
  it('renders a mechanism chip per row, joining on the lowercased cell key', () => {
    render(<PoolPage />);
    // Two rows → two spec chips. A broken (unlowercased) join would silently
    // render '—' for every row instead.
    const specChips = screen.getAllByTestId('mechanism-spec');
    expect(specChips).toHaveLength(2);
    expect(specChips.map((c) => c.textContent)).toEqual(
      expect.arrayContaining([expect.stringContaining('spec —'), expect.stringContaining('spec 1ax')]),
    );
  });

  it('narrows to the rows with no mechanism at all', () => {
    render(<PoolPage />);
    fireEvent.change(screen.getByLabelText('diversity'), { target: { value: 'missing-all' } });
    expect(screen.getByRole('button', { name: /tr-a1-ki-relativizer/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /es-b1-ser-estar/i })).not.toBeInTheDocument();
  });

  it('narrows to the rows with proven issues', () => {
    render(<PoolPage />);
    fireEvent.change(screen.getByLabelText('diversity'), { target: { value: 'proven-issues' } });
    expect(screen.getByRole('button', { name: /es-b1-ser-estar/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /tr-a1-ki-relativizer/i })).not.toBeInTheDocument();
  });

  it('filters positively by seed kind', () => {
    render(<PoolPage />);
    fireEvent.change(screen.getByLabelText('diversity'), { target: { value: 'has-frequency-band' } });
    expect(screen.getByRole('button', { name: /es-b1-ser-estar/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /tr-a1-ki-relativizer/i })).not.toBeInTheDocument();
  });

  // Filtering on an unresolved response would hide every row and read as
  // "nothing is missing a mechanism" — the opposite of the truth.
  it('says it is still loading rather than reporting an empty result', () => {
    mockDiversity.mockReturnValue({ isLoading: true, isError: false, data: undefined });
    render(<PoolPage />);
    fireEvent.change(screen.getByLabelText('diversity'), { target: { value: 'missing-all' } });
    expect(screen.getByText(/loading diversity data/i)).toBeInTheDocument();
    expect(screen.queryByText(/no matching cells/i)).not.toBeInTheDocument();
  });
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

  it('Theory tab lists grammar points with status badges and deeplinks', () => {
    render(<PoolPage />);
    fireEvent.click(screen.getByRole('tab', { name: /theory/i }));

    // Missing point shows a missing badge, no view link.
    expect(screen.getByText('tr-a1-missing')).toBeInTheDocument();
    expect(screen.getByText(/✗ missing/i)).toBeInTheDocument();

    // Approved point has a deeplink into the content theory tab.
    const links = screen.getAllByRole('link', { name: /view/i });
    const approved = links.find((l) => l.getAttribute('href')?.includes('tr-a1-approved'));
    expect(approved).toHaveAttribute(
      'href',
      '/admin/content?tab=theory&language=TR&level=A1&grammarPoint=tr-a1-approved',
    );

    // Flagged point shows its flagged count.
    expect(screen.getByText(/3 flagged/i)).toBeInTheDocument();
  });
});
