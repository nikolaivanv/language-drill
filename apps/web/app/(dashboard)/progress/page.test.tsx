import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CefrLevel, Language } from '@language-drill/shared';
import type {
  ProgressRadarResponse,
  RadarAxis,
  RadarAxisKey,
  CurriculumMapResponse,
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
const mockUseGetPreferences = vi.fn();
const mockUseUpdateLanguages = vi.fn();
const mockUseVocabTopics = vi.fn();

vi.mock('@language-drill/api-client', () => ({
  useProgressRadar: (...args: unknown[]) => mockUseProgressRadar(...args),
  useLanguageProfiles: (...args: unknown[]) => mockUseLanguageProfiles(...args),
  useFluencyStats: (...args: unknown[]) => mockUseFluencyStats(...args),
  useErrorTrends: (...args: unknown[]) => mockUseErrorTrends(...args),
  useCurriculumMap: (...args: unknown[]) => mockUseCurriculumMap(...args),
  useInsightsErrors: (...args: unknown[]) => mockUseInsightsErrors(...args),
  useGetPreferences: (...args: unknown[]) => mockUseGetPreferences(...args),
  useUpdateLanguages: (...args: unknown[]) => mockUseUpdateLanguages(...args),
  useVocabTopics: (...args: unknown[]) => mockUseVocabTopics(...args),
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

function renderPageTR() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return { queryClient, ...render(
    <QueryClientProvider client={queryClient}>
      <ActiveLanguageProvider
        profiles={[
          { language: Language.TR, proficiencyLevel: CefrLevel.A1 },
          { language: Language.ES, proficiencyLevel: CefrLevel.B1 },
        ]}
      >
        <ProgressPage />
      </ActiveLanguageProvider>
    </QueryClientProvider>,
  ) };
}

function buildCurriculumReadyFixture(): CurriculumMapResponse {
  const basePoint = {
    cefrLevel: 'A1' as const,
    state: 'solid' as const,
    errorProne: false,
    mastery: null,
    confidence: null,
    evidenceCount: 0,
    lastPracticedAt: null,
    recentErrorCount: 0,
    prereqKeys: [],
    prereqNames: [],
    prereqUnmet: false,
    compatibleTypes: [],
    hasTheory: false,
    errorSample: null,
  };
  return {
    language: Language.TR,
    activeLevel: 'A1',
    levels: [
      {
        level: 'A1',
        solidCount: 3,
        total: 3,
        readyToAdvance: true,
        isPreview: false,
        points: [
          { ...basePoint, key: 'tr-a1-p1', name: 'Point 1', order: 1 },
          { ...basePoint, key: 'tr-a1-p2', name: 'Point 2', order: 2 },
          { ...basePoint, key: 'tr-a1-p3', name: 'Point 3', order: 3 },
        ],
      },
      {
        level: 'A2',
        solidCount: 0,
        total: 2,
        readyToAdvance: false,
        isPreview: true,
        points: [
          { ...basePoint, cefrLevel: 'A2', state: 'not-started', key: 'tr-a2-p1', name: 'A2 Point 1', order: 1 },
          { ...basePoint, cefrLevel: 'A2', state: 'not-started', key: 'tr-a2-p2', name: 'A2 Point 2', order: 2 },
        ],
      },
    ],
  };
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
  mockUseGetPreferences.mockReturnValue({
    data: { primaryLanguage: Language.ES },
    isLoading: false,
    error: null,
  });
  mockUseUpdateLanguages.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
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
  mockUseVocabTopics.mockReturnValue({
    data: { topics: [] },
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProgressPage', () => {
  it('still renders the header, tabs, and Map for a zero-evidence user', () => {
    mockUseProgressRadar.mockReturnValue({
      data: radarResponse(buildAxes({})),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();

    // No more full-page "do your first drill" short-circuit — the curriculum
    // Map renders regardless of evidence so new users can see their path.
    expect(
      screen.queryByText('do your first drill to build your shape.'),
    ).toBeNull();
    expect(
      screen.getByRole('heading', { level: 1, name: /your progress/i }),
    ).toBeDefined();
    const tablist = screen.getByRole('tablist');
    expect(tablist).toBeDefined();
    // Map is the default tab and stays selected.
    const mapTab = screen.getByRole('tab', { name: 'map' });
    expect(mapTab.getAttribute('aria-selected')).toBe('true');
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

  // ---------------------------------------------------------------------------
  // Advance action: wiring
  // ---------------------------------------------------------------------------

  it('clicking "add A2 →" calls update.mutate with TR@A2 + correct primaryLanguage', () => {
    // Arrange: TR as active language, A1 readyToAdvance, A2 preview
    const mutate = vi.fn();
    mockUseUpdateLanguages.mockReturnValue({ mutate, isPending: false });
    mockUseLanguageProfiles.mockReturnValue({
      data: {
        profiles: [
          { language: Language.TR, proficiencyLevel: CefrLevel.A1 },
          { language: Language.ES, proficiencyLevel: CefrLevel.B1 },
        ],
      },
      isLoading: false,
      error: null,
    });
    mockUseGetPreferences.mockReturnValue({
      data: { primaryLanguage: Language.TR },
      isLoading: false,
      error: null,
    });
    mockUseCurriculumMap.mockReturnValue({
      data: buildCurriculumReadyFixture(),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    // Need radar data to pass the empty-state guard
    mockUseProgressRadar.mockReturnValue({
      data: radarResponse(buildAxes({ grammar: { mastery: 0.6, evidence: 6 } })),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPageTR();

    // The advance button should render
    const btn = screen.getByRole('button', { name: /add A2 →/i });
    expect(btn).toBeDefined();

    fireEvent.click(btn);

    // mutate should be called once with TR leveled to A2
    expect(mutate).toHaveBeenCalledTimes(1);
    const [payload] = mutate.mock.calls[0] as [{ profiles: Array<{ language: Language; proficiencyLevel: CefrLevel }>; primaryLanguage: Language }];
    expect(payload.primaryLanguage).toBe(Language.TR);
    // TR should be A2 now
    const trProfile = payload.profiles.find((p) => p.language === Language.TR);
    expect(trProfile?.proficiencyLevel).toBe(CefrLevel.A2);
    // ES should remain unchanged
    const esProfile = payload.profiles.find((p) => p.language === Language.ES);
    expect(esProfile?.proficiencyLevel).toBe(CefrLevel.B1);
  });

  it('onSuccess callback invalidates curriculumMap + languageProfiles + todayPlan + progressRadar', () => {
    // Arrange: same setup as above
    let capturedOnSuccess: (() => void) | undefined;
    const mutate = vi.fn((_payload: unknown, opts?: { onSuccess?: () => void }) => {
      capturedOnSuccess = opts?.onSuccess;
    });
    mockUseUpdateLanguages.mockReturnValue({ mutate, isPending: false });
    mockUseLanguageProfiles.mockReturnValue({
      data: {
        profiles: [
          { language: Language.TR, proficiencyLevel: CefrLevel.A1 },
          { language: Language.ES, proficiencyLevel: CefrLevel.B1 },
        ],
      },
      isLoading: false,
      error: null,
    });
    mockUseGetPreferences.mockReturnValue({
      data: { primaryLanguage: Language.TR },
      isLoading: false,
      error: null,
    });
    mockUseCurriculumMap.mockReturnValue({
      data: buildCurriculumReadyFixture(),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    mockUseProgressRadar.mockReturnValue({
      data: radarResponse(buildAxes({ grammar: { mastery: 0.6, evidence: 6 } })),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    const { queryClient } = renderPageTR();
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');

    fireEvent.click(screen.getByRole('button', { name: /add A2 →/i }));

    expect(capturedOnSuccess).toBeDefined();
    capturedOnSuccess!();

    // Should have invalidated all four query keys
    const keys = invalidateSpy.mock.calls.map((call) => (call[0] as { queryKey: unknown[] }).queryKey);
    expect(keys).toContainEqual(['languageProfiles']);
    expect(keys).toContainEqual(['curriculumMap', Language.TR]);
    expect(keys).toContainEqual(['todayPlan', Language.TR]);
    expect(keys).toContainEqual(['progressRadar', Language.TR]);
  });

  it('renders the words (vocab coverage) tab with topic rows when ?tab=words', () => {
    mockSearchParams = new URLSearchParams('tab=words');
    mockUseVocabTopics.mockReturnValue({
      data: {
        topics: [
          {
            umbrellaKey: 'es-a1-vocab-food-drink',
            name: 'Food and drink (A1)',
            cefrLevel: 'A1',
            wordCount: 30,
            available: 12,
            practiced: 5,
          },
        ],
      },
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    renderPage();

    const wordsTab = screen.getByRole('tab', { name: 'words' });
    expect(wordsTab.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByText('Food and drink (A1)')).toBeInTheDocument();
  });
});
