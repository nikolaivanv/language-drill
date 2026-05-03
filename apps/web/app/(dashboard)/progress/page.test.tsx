import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CefrLevel, Language } from '@language-drill/shared';
import type {
  ProgressRadarResponse,
  ProgressHeatmapResponse,
  RadarAxis,
  RadarAxisKey,
} from '@language-drill/api-client';
import { ActiveLanguageProvider } from '../../../components/shell';
import ProgressPage from './page';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetToken = vi.fn().mockResolvedValue('test-token');
vi.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ getToken: mockGetToken }),
}));

const mockReplace = vi.fn();
let mockSearchParams = new URLSearchParams();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: mockReplace }),
  useSearchParams: () => mockSearchParams,
}));

const mockUseProgressRadar = vi.fn();
const mockUseProgressHeatmap = vi.fn();
const mockUseLanguageProfiles = vi.fn();

vi.mock('@language-drill/api-client', () => ({
  useProgressRadar: (...args: unknown[]) => mockUseProgressRadar(...args),
  useProgressHeatmap: (...args: unknown[]) => mockUseProgressHeatmap(...args),
  useLanguageProfiles: (...args: unknown[]) => mockUseLanguageProfiles(...args),
  createAuthenticatedFetch: vi.fn(() => vi.fn()),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ALL_KEYS: RadarAxisKey[] = [
  'listening',
  'reading',
  'speaking',
  'writing',
  'grammar',
  'vocabulary',
];

function buildAxes(
  overrides: Partial<Record<RadarAxisKey, { mastery: number; evidence?: number }>>,
): RadarAxis[] {
  return ALL_KEYS.map((key) => {
    const o = overrides[key];
    return {
      key,
      label: key,
      currentMastery: o?.mastery ?? 0,
      previousMastery: o?.mastery ?? 0,
      lastPracticedAt: o ? '2026-04-30T12:00:00.000Z' : null,
      evidenceCount: o?.evidence ?? (o ? 1 : 0),
    };
  });
}

function radarResponse(axes: RadarAxis[]): ProgressRadarResponse {
  return { language: Language.ES, axes };
}

function heatmapResponse(): ProgressHeatmapResponse {
  return {
    language: Language.ES,
    days: 30,
    topics: [],
    shadeThresholds: { paper2: 1, accentSoft: 2, accent: 4 },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ActiveLanguageProvider
        profiles={[{ language: Language.ES, proficiencyLevel: CefrLevel.B2 }]}
      >
        <ProgressPage />
      </ActiveLanguageProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchParams = new URLSearchParams();
  mockUseLanguageProfiles.mockReturnValue({
    data: {
      profiles: [{ language: Language.ES, proficiencyLevel: CefrLevel.B2 }],
    },
    isLoading: false,
    error: null,
  });
  // Sensible defaults — individual tests override.
  mockUseProgressRadar.mockReturnValue({
    data: radarResponse(buildAxes({ grammar: { mastery: 0.6, evidence: 6 } })),
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseProgressHeatmap.mockReturnValue({
    data: heatmapResponse(),
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProgressPage', () => {
  it('renders the empty state when every axis has evidenceCount: 0', () => {
    mockUseProgressRadar.mockReturnValue({
      data: radarResponse(buildAxes({})),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    // Empty state copy is unique to ProgressEmptyState.
    expect(
      screen.getByText('do your first drill to build your shape.'),
    ).toBeDefined();
    // The header / tabs SHOULD NOT render.
    expect(screen.queryByRole('heading', { name: /your progress/i })).toBeNull();
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('renders the Shape tab by default with header and tablist', () => {
    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: /your progress/i }),
    ).toBeDefined();
    const tablist = screen.getByRole('tablist');
    expect(tablist).toBeDefined();
    const shapeTab = screen.getByRole('tab', { name: 'shape' });
    expect(shapeTab.getAttribute('aria-selected')).toBe('true');
    // Shape panel renders side cards (legend always shows when totalEvidence ≥ 5)
    expect(screen.getByText('compare to')).toBeDefined();
    expect(screen.queryByText(/topic × recency/i)).toBeNull();
  });

  it('clicking the Heatmap tab calls router.replace with ?tab=heatmap', () => {
    renderPage();

    fireEvent.click(screen.getByRole('tab', { name: 'practice heatmap' }));
    expect(mockReplace).toHaveBeenCalledWith('?tab=heatmap', { scroll: false });
  });

  it('renders the Heatmap panel when ?tab=heatmap is set in the URL', () => {
    mockSearchParams = new URLSearchParams('tab=heatmap');
    renderPage();
    // Heatmap empty placeholder is shown because topics: [] (< 3).
    expect(screen.getByText('build a topic history first')).toBeDefined();
    // Shape side cards are NOT rendered (only the active panel mounts).
    expect(screen.queryByText('compare to')).toBeNull();
  });

  it('renders the Shape error state when the radar query fails', () => {
    mockUseProgressRadar.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('radar offline'),
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText(/couldn['’]t load your shape/i)).toBeDefined();
    // Tablist still renders so the user can switch to a working tab.
    expect(screen.getByRole('tablist')).toBeDefined();
  });

  it('Heatmap tab is unaffected when the radar query fails (per-tab error boundary)', () => {
    mockUseProgressRadar.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('radar offline'),
      refetch: vi.fn(),
    });
    mockSearchParams = new URLSearchParams('tab=heatmap');

    renderPage();

    // Heatmap panel renders normally — even though the radar errored.
    expect(screen.getByText('build a topic history first')).toBeDefined();
    // The Shape error card does NOT render (only the active panel mounts).
    expect(screen.queryByText(/couldn['’]t load your shape/i)).toBeNull();
  });

  it('does not render any streak / XP-counter / lesson-count indicators (CLAUDE.md hard rule)', () => {
    const { container } = renderPage();
    const text = (container.textContent ?? '').toLowerCase();
    // The subtitle's anti-gamification disclaimer ("no XP, no levels") is
    // intentional — this test rejects *indicators* like "12 day streak".
    expect(text).not.toMatch(/\d+\s+day\s+streak/);
    expect(text).not.toMatch(/\d+\s+xp\b/);
    expect(text).not.toMatch(/\d+\s+lessons?\s+completed/);
    expect(text).not.toMatch(/🔥\s*streak/);
  });
});
