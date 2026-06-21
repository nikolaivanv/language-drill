import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  CefrLevel,
  ExerciseType,
  Language,
  type LearningLanguage,
} from '@language-drill/shared';
import type {
  ProgressRadarResponse,
  RadarAxis,
  RadarAxisKey,
  TodayPlanItem,
  TodayPlanItemStatus,
  TodayPlanResponse,
} from '@language-drill/api-client';
import DashboardPage from './page';

// ---------------------------------------------------------------------------
// Lock the clock so the embedded GreetingBlock renders deterministically.
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 4, 4, 10, 0, 0));
});

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetToken = vi.fn().mockResolvedValue('test-token');
vi.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ getToken: mockGetToken }),
  useUser: () => ({ user: { firstName: 'juno' } }),
}));

const mockInvalidateQueries = vi.fn();
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
  };
});

const mockUseActiveLanguage = vi.fn<
  () => { activeLanguage: LearningLanguage; setActiveLanguage: () => void }
>();
vi.mock('../../../components/shell/active-language-provider', () => ({
  useActiveLanguage: () => mockUseActiveLanguage(),
}));

// Default to desktop so the existing assertions hold; the mobile test flips it.
const mockIsMobile = vi.fn(() => false);
vi.mock('../../../lib/responsive', () => ({
  useIsMobile: () => mockIsMobile(),
}));

const mockUseTodayPlan = vi.fn();
const mockUseProgressRadar = vi.fn();
const mockUseInsightsErrors = vi.fn();
const mockUseGetPreferences = vi.fn();
const mockUseUpdatePreferences = vi.fn();
const mockUseCurriculumMap = vi.fn();

vi.mock('@language-drill/api-client', () => ({
  useTodayPlan: (...args: unknown[]) => mockUseTodayPlan(...args),
  useProgressRadar: (...args: unknown[]) => mockUseProgressRadar(...args),
  useInsightsErrors: (...args: unknown[]) => mockUseInsightsErrors(...args),
  useGetPreferences: (...args: unknown[]) => mockUseGetPreferences(...args),
  useUpdatePreferences: (...args: unknown[]) => mockUseUpdatePreferences(...args),
  useCurriculumMap: (...args: unknown[]) => mockUseCurriculumMap(...args),
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

function makeItem(
  index: number,
  status: TodayPlanItemStatus,
): TodayPlanItem {
  const isCloze = index === 1 || index === 2 || index === 5;
  return {
    index,
    type: isCloze
      ? ExerciseType.CLOZE
      : index === 3
        ? ExerciseType.TRANSLATION
        : ExerciseType.VOCAB_RECALL,
    topicHint: 'pronoun placement',
    grammarPointKey: null,
    grammarPointName: null,
    difficulty: CefrLevel.B1,
    itemCount: 4,
    estimatedMinutes: 3,
    status,
    reason: null,
  };
}

function planResponse(
  items: TodayPlanItem[],
  overrides: Partial<TodayPlanResponse> = {},
): TodayPlanResponse {
  return {
    language: Language.ES,
    generatedAt: '2026-05-04T10:00:00.000Z',
    totalEstimatedMinutes: items.reduce(
      (sum, it) => sum + it.estimatedMinutes,
      0,
    ),
    items,
    summary: null,
    code: null,
    freeWriting: null,
    resumeSessionId: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Defaults — individual tests override
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockIsMobile.mockReturnValue(false);
  // WorkOnThese self-hides when there are no themes; default to empty so the
  // existing assertions (which predate the block) are unaffected.
  mockUseInsightsErrors.mockReturnValue({ data: { themes: [] } });
  mockUseActiveLanguage.mockReturnValue({
    activeLanguage: Language.ES,
    setActiveLanguage: () => {},
  });
  mockUseTodayPlan.mockReturnValue({
    data: planResponse([1, 2, 3, 4, 5].map((i) => makeItem(i, 'queued'))),
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseGetPreferences.mockReturnValue({
    data: { dailyMinutes: 10, goals: [], gentleNudges: true },
    isLoading: false,
    error: null,
  });
  mockUseUpdatePreferences.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });
  mockUseProgressRadar.mockReturnValue({
    data: radarResponse(
      buildAxes({
        grammar: { mastery: 0.42, evidence: 5 },
        vocabulary: { mastery: 0.7, evidence: 5 },
        reading: { mastery: 0.55, evidence: 5 },
        speaking: { mastery: 0.6, evidence: 5 },
        writing: { mastery: 0.65, evidence: 5 },
        listening: { mastery: 0.75, evidence: 5 },
      }),
    ),
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
  // Default: no curriculum data → cue is hidden so existing tests are unaffected.
  mockUseCurriculumMap.mockReturnValue({ data: undefined, isLoading: false, error: null });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('DashboardPage — happy path', () => {
  it('renders header, timeline (5 items), snapshot grid (6 rows), and Read & Collect', () => {
    render(<DashboardPage />);

    // Header — greeting heading is from GreetingBlock (clock locked above)
    expect(
      screen.getByRole('heading', { level: 1, name: 'good morning, juno.' }),
    ).toBeInTheDocument();
    expect(screen.getByText("here's today's plan.")).toBeInTheDocument();

    // Timeline — 5 list items, each has an aria-label starting with its index
    const items = screen.getAllByRole('listitem');
    // 5 visible TimelineItem <li>s + 5 sr-only summary <li>s = 10 listitems
    // Filter to the visible aria-labelled rail items.
    const rail = items.filter((li) => li.getAttribute('aria-label'));
    expect(rail).toHaveLength(5);

    // Snapshot grid — 6 rows. The "see full progress" link confirms the section.
    const fullProgress = screen.getByRole('link', {
      name: /see full progress/,
    });
    expect(fullProgress).toHaveAttribute('href', '/progress');

    // Read & Collect — the heading is unique to this card
    expect(
      screen.getByRole('heading', { name: 'reading something this week?' }),
    ).toBeInTheDocument();
  });

  it("renders the header's total minutes from todayPlan.data.totalEstimatedMinutes", () => {
    mockUseTodayPlan.mockReturnValue({
      data: planResponse([1, 2, 3, 4, 5].map((i) => makeItem(i, 'queued')), {
        totalEstimatedMinutes: 22,
      }),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<DashboardPage />);
    expect(screen.getByText('~22 min planned')).toBeInTheDocument();
  });
});

describe('DashboardPage — mobile "next up" CTA (Req 4.2)', () => {
  it('renders the NextUpCard under the greeting on mobile, routing to the drill', () => {
    mockIsMobile.mockReturnValue(true);
    render(<DashboardPage />);
    const cta = screen.getByRole('link', { name: /next up/i });
    expect(cta).toHaveAttribute('href', '/drill?start=quick');
  });

  it('does not render the NextUpCard on desktop', () => {
    mockIsMobile.mockReturnValue(false);
    render(<DashboardPage />);
    expect(screen.queryByRole('link', { name: /next up/i })).toBeNull();
  });
});

describe('DashboardPage — partial failures (per-section error boundaries)', () => {
  it('timeline errors: TimelineErrorCard renders; snapshot grid still renders rows', () => {
    mockUseTodayPlan.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('today api down'),
      refetch: vi.fn(),
    });
    render(<DashboardPage />);

    // Timeline error
    expect(screen.getByText('today api down')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /retry/ }),
    ).toBeInTheDocument();

    // Snapshot grid still renders — the section header is always present.
    expect(
      screen.getByRole('link', { name: /see full progress/ }),
    ).toBeInTheDocument();
    // Read & Collect still renders.
    expect(
      screen.getByRole('heading', { name: 'reading something this week?' }),
    ).toBeInTheDocument();
  });

  it('radar errors: timeline still renders; snapshot grid renders an error card', () => {
    mockUseProgressRadar.mockReturnValue({
      data: undefined,
      isLoading: false,
      error: new Error('radar offline'),
      refetch: vi.fn(),
    });
    render(<DashboardPage />);

    // Timeline still renders 5 items.
    const rail = screen
      .getAllByRole('listitem')
      .filter((li) => li.getAttribute('aria-label'));
    expect(rail).toHaveLength(5);

    // Snapshot grid renders the error message + retry.
    expect(screen.getByText('radar offline')).toBeInTheDocument();
  });
});

describe('DashboardPage — all-done plan', () => {
  it('renders AllDoneCard in place of the timeline', () => {
    mockUseTodayPlan.mockReturnValue({
      data: planResponse(
        [1, 2, 3, 4, 5].map((i) => makeItem(i, 'done')),
        { summary: { itemCount: 5, correctCount: 4, durationMinutes: 18 } },
      ),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<DashboardPage />);

    expect(screen.getByText("you're done for today.")).toBeInTheDocument();
    expect(screen.getByText('5 of 5 · 18 minutes')).toBeInTheDocument();
    // No timeline rail aria-labelled <li>s in this branch.
    const rail = screen
      .queryAllByRole('listitem')
      .filter((li) => li.getAttribute('aria-label'));
    expect(rail).toHaveLength(0);
  });
});

describe('DashboardPage — insufficient pool', () => {
  it('renders PoolNotReadyCard in place of the timeline', () => {
    mockUseTodayPlan.mockReturnValue({
      data: planResponse([], { code: 'INSUFFICIENT_POOL' }),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<DashboardPage />);

    expect(
      screen.getByText(/your spanish pool isn't ready yet/),
    ).toBeInTheDocument();
  });
});

describe('DashboardPage — empty radar', () => {
  it('renders EmptySnapshotCard in place of the snapshot grid', () => {
    mockUseProgressRadar.mockReturnValue({
      data: radarResponse(buildAxes({})),
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    render(<DashboardPage />);

    expect(
      screen.getByText(
        /practice a few exercises and your skill snapshot will appear here\./,
      ),
    ).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /start a session/ });
    expect(link).toHaveAttribute('href', '/drill?start=quick');
  });
});

// ---------------------------------------------------------------------------
// CLAUDE.md no-streak invariant
// ---------------------------------------------------------------------------

describe('DashboardPage — no streak / XP / lesson copy', () => {
  it('renders no streak / XP / lesson-count text anywhere on the page', () => {
    const { container } = render(<DashboardPage />);
    const text = (container.textContent ?? '').toLowerCase();
    expect(text).not.toMatch(/\d+\s+day\s+streak/);
    expect(text).not.toMatch(/\d+\s+xp\b/);
    expect(text).not.toMatch(/\d+\s+lessons?\s+completed/);
    expect(text).not.toMatch(/🔥\s*streak/);
    // Also reject the simpler keywords as a defence-in-depth check.
    expect(text).not.toMatch(/streak|xp|lesson/);
  });
});

// ---------------------------------------------------------------------------
// Language switching → both queries are called with the new language
// ---------------------------------------------------------------------------

describe('DashboardPage — language switching (Req 1.3, 11.2)', () => {
  it('changes both useTodayPlan and useProgressRadar language args when activeLanguage flips ES → DE', () => {
    const { rerender } = render(<DashboardPage />);

    // First render — ES.
    expect(mockUseTodayPlan).toHaveBeenLastCalledWith(
      expect.objectContaining({ language: Language.ES }),
    );
    expect(mockUseProgressRadar).toHaveBeenLastCalledWith(
      expect.objectContaining({ language: Language.ES }),
    );

    // Flip the active language to DE.
    mockUseActiveLanguage.mockReturnValue({
      activeLanguage: Language.DE,
      setActiveLanguage: () => {},
    });
    rerender(<DashboardPage />);

    expect(mockUseTodayPlan).toHaveBeenLastCalledWith(
      expect.objectContaining({ language: Language.DE }),
    );
    expect(mockUseProgressRadar).toHaveBeenLastCalledWith(
      expect.objectContaining({ language: Language.DE }),
    );
  });
});

// ---------------------------------------------------------------------------
// DailyLoadControl wiring — preferences mutation + today-plan invalidation
// ---------------------------------------------------------------------------

describe('DashboardPage — DailyLoadControl wiring', () => {
  it('renders the DailyLoadControl with current dailyMinutes from preferences', () => {
    render(<DashboardPage />);
    // The radiogroup is present
    expect(
      screen.getByRole('radiogroup', { name: "today's load" }),
    ).toBeInTheDocument();
    // The 10-min option (our mocked prefs.dailyMinutes) is selected
    const options = screen.getAllByRole('radio');
    const checked = options.filter(
      (el) => el.getAttribute('aria-checked') === 'true',
    );
    expect(checked).toHaveLength(1);
    expect(checked[0]).toHaveTextContent('10 min');
  });

  it('fires useUpdatePreferences.mutate with new dailyMinutes when an option is clicked', () => {
    const mutateMock = vi.fn();
    mockUseUpdatePreferences.mockReturnValue({
      mutate: mutateMock,
      isPending: false,
    });

    render(<DashboardPage />);
    fireEvent.click(screen.getByText('20 min'));

    expect(mutateMock).toHaveBeenCalledWith(
      { dailyMinutes: 20 },
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });

  it('invalidates todayPlan query on successful preference update', () => {
    let capturedOnSuccess: (() => void) | undefined;
    const mutateMock = vi.fn(
      (_: unknown, opts: { onSuccess?: () => void }) => {
        capturedOnSuccess = opts.onSuccess;
      },
    );
    mockUseUpdatePreferences.mockReturnValue({
      mutate: mutateMock,
      isPending: false,
    });

    render(<DashboardPage />);
    fireEvent.click(screen.getByText('30 min'));

    // Trigger the onSuccess callback
    expect(capturedOnSuccess).toBeDefined();
    capturedOnSuccess!();

    expect(mockInvalidateQueries).toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: ['todayPlan', Language.ES] }),
    );
  });
});

// ---------------------------------------------------------------------------
// DashboardPage — linear-path cue wiring
// ---------------------------------------------------------------------------

function makeCurriculumMapData() {
  return {
    language: Language.ES,
    activeLevel: 'A1',
    levels: [
      {
        level: 'A1',
        solidCount: 3,
        total: 9,
        readyToAdvance: false,
        isPreview: false,
        points: [
          { key: 'p1', name: 'Present tense', cefrLevel: 'A1', order: 1, state: 'solid' as const, errorProne: false, mastery: null, confidence: null, evidenceCount: 0, lastPracticedAt: null, recentErrorCount: 0, prereqKeys: [], prereqNames: [], prereqUnmet: false, compatibleTypes: [], hasTheory: false, errorSample: null },
          { key: 'p2', name: 'Ser vs Estar', cefrLevel: 'A1', order: 2, state: 'solid' as const, errorProne: false, mastery: null, confidence: null, evidenceCount: 0, lastPracticedAt: null, recentErrorCount: 0, prereqKeys: [], prereqNames: [], prereqUnmet: false, compatibleTypes: [], hasTheory: false, errorSample: null },
          { key: 'p3', name: 'Articles', cefrLevel: 'A1', order: 3, state: 'learning' as const, errorProne: false, mastery: null, confidence: null, evidenceCount: 0, lastPracticedAt: null, recentErrorCount: 0, prereqKeys: [], prereqNames: [], prereqUnmet: false, compatibleTypes: [], hasTheory: false, errorSample: null },
          { key: 'p4', name: 'Plural formation', cefrLevel: 'A1', order: 4, state: 'not-started' as const, errorProne: false, mastery: null, confidence: null, evidenceCount: 0, lastPracticedAt: null, recentErrorCount: 0, prereqKeys: [], prereqNames: [], prereqUnmet: false, compatibleTypes: [], hasTheory: false, errorSample: null },
          { key: 'p5', name: 'Gender agreement', cefrLevel: 'A1', order: 5, state: 'not-started' as const, errorProne: false, mastery: null, confidence: null, evidenceCount: 0, lastPracticedAt: null, recentErrorCount: 0, prereqKeys: [], prereqNames: [], prereqUnmet: false, compatibleTypes: [], hasTheory: false, errorSample: null },
        ],
      },
    ],
  };
}

describe('DashboardPage — linear-path cue', () => {
  it('renders the position label, next point name, and a /progress link', () => {
    mockUseCurriculumMap.mockReturnValue({
      data: makeCurriculumMapData(),
      isLoading: false,
      error: null,
    });
    render(<DashboardPage />);

    // "point 3 of A1" — 3 touched points (solid: 2, learning: 1)
    expect(screen.getByText(/point 3 of A1/)).toBeInTheDocument();
    // "next: Plural formation" — lowest-order not-started
    expect(screen.getByText(/Plural formation/)).toBeInTheDocument();
    // "see the map →" link → /progress
    const mapLink = screen.getByRole('link', { name: /see the map/ });
    expect(mapLink).toHaveAttribute('href', '/progress');
  });

  it('hides the cue entirely when useCurriculumMap returns no data', () => {
    mockUseCurriculumMap.mockReturnValue({
      data: undefined,
      isLoading: true,
      error: null,
    });
    render(<DashboardPage />);
    expect(screen.queryByText(/you're around/)).toBeNull();
    expect(screen.queryByRole('link', { name: /see the map/ })).toBeNull();
  });

  it('omits the "next:" clause when all points are touched', () => {
    const allTouched = makeCurriculumMapData();
    allTouched.levels[0].points = allTouched.levels[0].points.map((p) => ({
      ...p,
      state: 'solid' as const,
    }));
    mockUseCurriculumMap.mockReturnValue({
      data: allTouched,
      isLoading: false,
      error: null,
    });
    render(<DashboardPage />);
    expect(screen.getByText(/point 5 of A1/)).toBeInTheDocument();
    expect(screen.queryByText(/next:/)).toBeNull();
    // "see the map →" link is still present
    expect(screen.getByRole('link', { name: /see the map/ })).toBeInTheDocument();
  });
});
