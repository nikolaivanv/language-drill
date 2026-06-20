import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CefrLevel, Language } from '@language-drill/shared';
import type {
  ProgressRadarResponse,
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
const mockUseLanguageProfiles = vi.fn();
const mockUseFluencyStats = vi.fn();
const mockUseErrorTrends = vi.fn();
const mockUseCurriculumMap = vi.fn();
const mockUseInsightsErrors = vi.fn();

vi.mock('@language-drill/api-client', () => ({
  useProgressRadar: (...args: unknown[]) => mockUseProgressRadar(...args),
  useLanguageProfiles: (...args: unknown[]) => mockUseLanguageProfiles(...args),
  useFluencyStats: (...args: unknown[]) => mockUseFluencyStats(...args),
  useErrorTrends: (...args: unknown[]) => mockUseErrorTrends(...args),
  useCurriculumMap: (...args: unknown[]) => mockUseCurriculumMap(...args),
  useInsightsErrors: (...args: unknown[]) => mockUseInsightsErrors(...args),
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
  mockUseFluencyStats.mockReturnValue({
    data: undefined,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseErrorTrends.mockReturnValue({
    data: { themes: [] },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseCurriculumMap.mockReturnValue({
    data: undefined,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseInsightsErrors.mockReturnValue({
    data: { themes: [] },
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

  it('renders the Map tab by default with header and tablist', () => {
    renderPage();

    expect(
      screen.getByRole('heading', { level: 1, name: /your progress/i }),
    ).toBeDefined();
    const tablist = screen.getByRole('tablist');
    expect(tablist).toBeDefined();
    // Map is the new default tab (Phase 1 change).
    const mapTab = screen.getByRole('tab', { name: 'map' });
    expect(mapTab.getAttribute('aria-selected')).toBe('true');
    // Shape tab exists but is not selected.
    const shapeTab = screen.getByRole('tab', { name: 'shape' });
    expect(shapeTab.getAttribute('aria-selected')).toBe('false');
    // Heatmap tab no longer exists.
    expect(screen.queryByRole('tab', { name: 'practice heatmap' })).toBeNull();
  });

  it('renders the Shape error state when the radar query fails', () => {
    // Navigate to the shape tab explicitly (map is now the default).
    mockSearchParams = new URLSearchParams('tab=shape');
    mockUseProgressRadar.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('radar offline'),
      refetch: vi.fn(),
    });

    renderPage();

    expect(screen.getByText(/couldn['']t load your shape/i)).toBeDefined();
    // Tablist still renders so the user can switch to a working tab.
    expect(screen.getByRole('tablist')).toBeDefined();
  });

  it('stale ?tab=heatmap URL falls back to the map tab', () => {
    mockSearchParams = new URLSearchParams('tab=heatmap');
    renderPage();
    // Falls back to map — the heatmap tab no longer exists and map is the default.
    const mapTab = screen.getByRole('tab', { name: 'map' });
    expect(mapTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.queryByRole('tab', { name: 'practice heatmap' })).toBeNull();
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
