import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CefrLevel, ExerciseType, Language } from '@language-drill/shared';
import { ActiveLanguageProvider } from '../../../components/shell';
import PracticePage from './page';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetToken = vi.fn().mockResolvedValue('test-token');

vi.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ getToken: mockGetToken }),
}));

const mockPush = vi.fn();
const mockReplace = vi.fn();
let mockSearchParamsString = 'start=quick'; // existing tests run in auto-start mode
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
  useSearchParams: () => new URLSearchParams(mockSearchParamsString),
}));

// Default desktop (false); the mobile suite flips this per-test. Existing
// desktop assertions rely on the inline submit/next buttons.
const mockIsMobile = vi.fn(() => false);
vi.mock('../../../lib/responsive', () => ({
  useIsMobile: () => mockIsMobile(),
}));

const mockUseCreateSession = vi.fn();
const mockUseCompleteSession = vi.fn();
const mockUseSubmitAnswer = vi.fn();
const mockUseLanguageProfiles = vi.fn();
const mockUseResumeSession = vi.fn();
const mockUseInsightsErrors = vi.fn();

vi.mock('@language-drill/api-client', () => ({
  useCreateSession: (...args: unknown[]) => mockUseCreateSession(...args),
  useCompleteSession: (...args: unknown[]) => mockUseCompleteSession(...args),
  useSubmitAnswer: (...args: unknown[]) => mockUseSubmitAnswer(...args),
  useLanguageProfiles: (...args: unknown[]) => mockUseLanguageProfiles(...args),
  useResumeSession: (...args: unknown[]) => mockUseResumeSession(...args),
  useInsightsErrors: (...args: unknown[]) => mockUseInsightsErrors(...args),
  useTodayPlan: () => ({ data: undefined, isLoading: false, error: null }),
  createAuthenticatedFetch: vi.fn(() => vi.fn()),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeClozeExercise(index: number) {
  return {
    id: `ex-${index}`,
    type: 'cloze' as const,
    language: 'ES',
    difficulty: 'B1',
    contentJson: {
      type: ExerciseType.CLOZE,
      instructions: 'fill the blank',
      sentence: `sentence-${index} ___ end.`,
      correctAnswer: 'middle',
      options: ['middle', 'foo', 'bar'],
    },
  };
}

const SESSION_ID = '11111111-1111-1111-1111-111111111111';

const SAMPLE_MANIFEST = {
  id: SESSION_ID,
  exercises: [0, 1, 2, 3, 4].map(makeClozeExercise),
};

function mockEval(score: number, errors: unknown[] = []) {
  return {
    score,
    grammarAccuracy: score,
    vocabularyRange: 'B1',
    taskAchievement: score,
    feedback: 'feedback text',
    errors,
    estimatedCefrEvidence: 'B1',
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <ActiveLanguageProvider
        profiles={[{ language: Language.ES, proficiencyLevel: CefrLevel.B1 }]}
      >
        {ui}
      </ActiveLanguageProvider>
    </QueryClientProvider>,
  );
}

// Mutation handles. Re-created in beforeEach so call counts are isolated per
// test. Tests reach into these directly to assert mutate args / call count.
let createMutate: ReturnType<typeof vi.fn>;
let createReset: ReturnType<typeof vi.fn>;
let submitMutate: ReturnType<typeof vi.fn>;
let submitReset: ReturnType<typeof vi.fn>;
let completeMutate: ReturnType<typeof vi.fn>;

function setCreateMock(mutateImpl: (vars: unknown, opts: {
  onSuccess?: (data: unknown) => void;
  onError?: (err: Error) => void;
}) => void) {
  createMutate = vi.fn(mutateImpl);
  createReset = vi.fn();
  mockUseCreateSession.mockReturnValue({
    mutate: createMutate,
    reset: createReset,
    isPending: false,
    error: null,
  });
}

function setSubmitMock(mutateImpl: (vars: unknown, opts: {
  onSuccess?: (data: unknown) => void;
  onError?: (err: Error) => void;
}) => void) {
  submitMutate = vi.fn(mutateImpl);
  submitReset = vi.fn();
  mockUseSubmitAnswer.mockReturnValue({
    mutate: submitMutate,
    reset: submitReset,
    isPending: false,
    error: null,
  });
}

// ---------------------------------------------------------------------------
// Default mock setup — synchronous resolution so render() lands in inSession.
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchParamsString = 'start=quick';
  mockIsMobile.mockReturnValue(false);

  mockUseLanguageProfiles.mockReturnValue({
    data: {
      profiles: [
        { language: 'ES', proficiencyLevel: 'B1' },
        { language: 'DE', proficiencyLevel: 'A2' },
      ],
    },
    isLoading: false,
    error: null,
  });

  // Default create: synchronously fires onSuccess with the manifest.
  setCreateMock((_vars, opts) => opts.onSuccess?.(SAMPLE_MANIFEST));

  // Default submit: no-op so the page stays in `submitting` after click
  // unless a test stubs an outcome.
  setSubmitMock(() => {});

  // Stubbed but not exercised in 28a — 28b will re-stub for completion paths.
  completeMutate = vi.fn();
  mockUseCompleteSession.mockReturnValue({
    mutate: completeMutate,
    reset: vi.fn(),
    isPending: false,
    error: null,
  });

  // Default resume: disabled (no ?resume param in most tests).
  mockUseResumeSession.mockReturnValue({
    data: undefined,
    isLoading: false,
    isError: false,
    error: null,
  });

  // Default insights: no themes (canned coach message used).
  mockUseInsightsErrors.mockReturnValue({ data: { themes: [] } });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PracticePage', () => {
  // -------------------------------------------------------------------------
  describe('mount + creation', () => {
    it('mount with profiles → useCreateSession.mutate called once with the active filter', () => {
      mockUseLanguageProfiles.mockReturnValue({
        data: { profiles: [{ language: 'ES', proficiencyLevel: 'B1' }] },
        isLoading: false,
        error: null,
      });

      renderWithProviders(<PracticePage />);

      expect(createMutate).toHaveBeenCalledTimes(1);
      expect(createMutate).toHaveBeenCalledWith(
        { language: 'ES', difficulty: 'B1', exerciseCount: 5 },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }),
      );
    });

    it('shows manifest item 0 once create-session resolves', () => {
      renderWithProviders(<PracticePage />);
      expect(screen.getByText(/sentence-0/)).toBeInTheDocument();
    });

    it('reflects the new session id in the URL so a reload resumes it', () => {
      renderWithProviders(<PracticePage />);
      expect(mockReplace).toHaveBeenCalledWith(
        `/drill?resume=${SESSION_ID}`,
        { scroll: false },
      );
    });

    it('progress bar starts at 0 (idle, item 0)', () => {
      renderWithProviders(<PracticePage />);
      const progressBar = screen.getByRole('progressbar');
      expect(progressBar.getAttribute('aria-valuenow')).toBe('0');
    });
  });

  // -------------------------------------------------------------------------
  describe('per-item flow', () => {
    it('submit item 0 → verdict shown; progress bar reflects evaluated state (1/5 = 20)', () => {
      setSubmitMock((_vars, opts) => opts.onSuccess?.(mockEval(0.97)));
      renderWithProviders(<PracticePage />);

      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'middle' },
      });
      fireEvent.click(screen.getByRole('button', { name: /submit/i }));

      expect(screen.getByText('spot on')).toBeInTheDocument();
      expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(
        '20',
      );
    });

    it('submit threads sessionId through to the submit mutation', () => {
      setSubmitMock((_vars, opts) => opts.onSuccess?.(mockEval(0.97)));
      renderWithProviders(<PracticePage />);

      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'middle' },
      });
      fireEvent.click(screen.getByRole('button', { name: /submit/i }));

      expect(submitMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          exerciseId: 'ex-0',
          answer: 'middle',
          sessionId: SESSION_ID,
        }),
        expect.any(Object),
      );
    });

    it('click "next" after evaluation → exercise pane shows manifest item 1; progress reflects 1/5', () => {
      setSubmitMock((_vars, opts) => opts.onSuccess?.(mockEval(0.97)));
      renderWithProviders(<PracticePage />);

      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'middle' },
      });
      fireEvent.click(screen.getByRole('button', { name: /submit/i }));

      // The verdict-card "next" button (not "see results" — we're not on the
      // last item yet).
      fireEvent.click(screen.getByRole('button', { name: 'next' }));

      expect(screen.getByText(/sentence-1/)).toBeInTheDocument();
      expect(screen.queryByText(/sentence-0/)).not.toBeInTheDocument();
      // index=1, idle → 1/5 = 20
      expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe(
        '20',
      );
    });
  });

  // -------------------------------------------------------------------------
  describe('selector change', () => {
    it('changing difficulty dispatches RESET → useCreateSession.mutate fires again with the new difficulty', () => {
      renderWithProviders(<PracticePage />);

      // Initial create call uses the active language (ES) from the provider
      expect(createMutate).toHaveBeenCalledWith(
        { language: 'ES', difficulty: 'B1', exerciseCount: 5 },
        expect.any(Object),
      );
      const callsBefore = createMutate.mock.calls.length;

      fireEvent.change(screen.getByLabelText(/drill level/i), {
        target: { value: 'A2' },
      });

      expect(createMutate.mock.calls.length).toBeGreaterThan(callsBefore);
      const lastCallArgs =
        createMutate.mock.calls[createMutate.mock.calls.length - 1][0];
      expect(lastCallArgs).toEqual({
        language: 'ES',
        difficulty: 'A2',
        exerciseCount: 5,
      });
    });
  });

  // -------------------------------------------------------------------------
  describe('submission error (5xx)', () => {
    it('renders the error card with "try again" when submit fails with a generic 5xx', () => {
      setSubmitMock((_vars, opts) =>
        opts.onError?.(new Error('Bad gateway 502')),
      );
      renderWithProviders(<PracticePage />);

      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'middle' },
      });
      fireEvent.click(screen.getByRole('button', { name: /submit/i }));

      expect(
        screen.getByText('Failed to submit answer: Bad gateway 502'),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'try again' }),
      ).toBeInTheDocument();
    });

    it('"try again" re-submits the same answer (no second Submit click needed)', () => {
      // First submit errors; the retry re-fire succeeds.
      setSubmitMock((_vars, opts) => opts.onSuccess?.(mockEval(0.97)));
      submitMutate.mockImplementationOnce((_vars, opts) =>
        opts.onError?.(new Error('Bad gateway 502')),
      );
      renderWithProviders(<PracticePage />);

      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'middle' },
      });
      fireEvent.click(screen.getByRole('button', { name: /submit/i }));

      // Error card up; one submit so far.
      expect(submitMutate).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByRole('button', { name: 'try again' }));

      // Retry itself re-fires the mutation with the same answer — the user does
      // NOT have to click Submit again.
      expect(submitMutate).toHaveBeenCalledTimes(2);
      expect(submitMutate).toHaveBeenLastCalledWith(
        expect.objectContaining({ exerciseId: 'ex-0', answer: 'middle', sessionId: SESSION_ID }),
        expect.any(Object),
      );
      // Retry succeeded → verdict shown.
      expect(screen.getByText('spot on')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  describe('zero profiles', () => {
    it('renders the no-profiles placeholder; useCreateSession.mutate is NOT called', () => {
      mockUseLanguageProfiles.mockReturnValue({
        data: { profiles: [] },
        isLoading: false,
        error: null,
      });

      renderWithProviders(<PracticePage />);

      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        'practice',
      );
      expect(createMutate).not.toHaveBeenCalled();
      // No coach rail or progress bar in the zero-profiles placeholder
      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  describe('422 INSUFFICIENT_EXERCISES', () => {
    it('renders the "no exercises available" card when create-session fails with 422', () => {
      const err = new Error('Not enough exercises in the pool for this filter');
      (err as Error & { status?: number }).status = 422;
      (err as Error & { body?: { code?: string } }).body = {
        code: 'INSUFFICIENT_EXERCISES',
      };
      setCreateMock((_vars, opts) => opts.onError?.(err));

      renderWithProviders(<PracticePage />);

      expect(
        screen.getByText(/no exercises available for Spanish at B1/),
      ).toBeInTheDocument();
      expect(
        screen.getByText('try a different difficulty'),
      ).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Completion + session-aware error paths (Phase G — onSuccess routes to
  // /drill/debrief/[sessionId] instead of rendering an in-page summary).
  // -------------------------------------------------------------------------

  // Step through items 0..(stopAt-1) by submitting each and clicking "next".
  // Leaves the page on item `stopAt` with an idle textbox.
  function advanceToItem(stopAt: number) {
    for (let i = 0; i < stopAt; i++) {
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'middle' },
      });
      fireEvent.click(screen.getByRole('button', { name: /submit/i }));
      fireEvent.click(screen.getByRole('button', { name: 'next' }));
    }
  }

  describe('completion', () => {
    it('next-button label reads "see results" on the last item (after submit)', () => {
      setSubmitMock((_vars, opts) => opts.onSuccess?.(mockEval(0.97)));
      renderWithProviders(<PracticePage />);

      // Items 0..3: submit + next
      advanceToItem(4);

      // On item 4 (last): submit
      expect(screen.getByText(/sentence-4/)).toBeInTheDocument();
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'middle' },
      });
      fireEvent.click(screen.getByRole('button', { name: /submit/i }));

      expect(
        screen.getByRole('button', { name: 'see results' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'next' }),
      ).not.toBeInTheDocument();
    });

    it('clicking "see results" calls useCompleteSession.mutate and navigates to /drill/debrief/[sessionId]', () => {
      setSubmitMock((_vars, opts) => opts.onSuccess?.(mockEval(0.97)));
      // Phase G: onSuccess routes to the debrief page; no summary payload
      // is read by the page anymore, so passing `undefined` is fine.
      completeMutate.mockImplementation((_vars, opts) =>
        opts.onSuccess?.(undefined),
      );
      renderWithProviders(<PracticePage />);

      advanceToItem(4);
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'middle' },
      });
      fireEvent.click(screen.getByRole('button', { name: /submit/i }));
      fireEvent.click(screen.getByRole('button', { name: 'see results' }));

      expect(completeMutate).toHaveBeenCalledWith(
        { sessionId: SESSION_ID },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }),
      );
      expect(mockPush).toHaveBeenCalledWith(`/drill/debrief/${SESSION_ID}`);
    });
  });

  describe('rate-limit "end session early"', () => {
    it('clicking "end session early" calls useCompleteSession.mutate and navigates to /drill/debrief/[sessionId]', () => {
      setSubmitMock((_vars, opts) =>
        opts.onError?.(new Error('Request failed with status 429')),
      );
      completeMutate.mockImplementation((_vars, opts) =>
        opts.onSuccess?.(undefined),
      );
      renderWithProviders(<PracticePage />);

      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'middle' },
      });
      fireEvent.click(screen.getByRole('button', { name: /submit/i }));

      // Rate-limit card with the right buttons
      expect(
        screen.getByText(
          "You've reached your daily practice limit. Come back tomorrow!",
        ),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'end session early' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'skip item' }),
      ).not.toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'end session early' }));

      expect(completeMutate).toHaveBeenCalledWith(
        { sessionId: SESSION_ID },
        expect.any(Object),
      );
      expect(mockPush).toHaveBeenCalledWith(`/drill/debrief/${SESSION_ID}`);
    });
  });

  describe('5xx "skip item"', () => {
    it('"skip item" advances index; final "see results" navigates to debrief', () => {
      // Default impl: success. One-shot first call: error.
      setSubmitMock((_vars, opts) => opts.onSuccess?.(mockEval(0.97)));
      submitMutate.mockImplementationOnce((_vars, opts) =>
        opts.onError?.(new Error('Bad gateway 502')),
      );

      completeMutate.mockImplementation((_vars, opts) =>
        opts.onSuccess?.(undefined),
      );
      renderWithProviders(<PracticePage />);

      // Item 0: submit → 502 error
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'middle' },
      });
      fireEvent.click(screen.getByRole('button', { name: /submit/i }));

      // Both buttons present in the error card
      expect(
        screen.getByRole('button', { name: 'try again' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: 'skip item' }),
      ).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'end session early' }),
      ).not.toBeInTheDocument();

      // Skip → advance to item 1
      fireEvent.click(screen.getByRole('button', { name: 'skip item' }));
      expect(screen.getByText(/sentence-1/)).toBeInTheDocument();

      // Items 1..3: submit + next
      for (let i = 1; i < 4; i++) {
        fireEvent.change(screen.getByRole('textbox'), {
          target: { value: 'middle' },
        });
        fireEvent.click(screen.getByRole('button', { name: /submit/i }));
        fireEvent.click(screen.getByRole('button', { name: 'next' }));
      }
      // Item 4 (last): submit + see results → debrief navigation
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'middle' },
      });
      fireEvent.click(screen.getByRole('button', { name: /submit/i }));
      fireEvent.click(screen.getByRole('button', { name: 'see results' }));

      expect(mockPush).toHaveBeenCalledWith(`/drill/debrief/${SESSION_ID}`);
    });

    it('"skip item" on the LAST item completes the session (no stuck blank screen)', () => {
      setSubmitMock((_vars, opts) => opts.onSuccess?.(mockEval(0.97)));
      completeMutate.mockImplementation((_vars, opts) =>
        opts.onSuccess?.(undefined),
      );
      renderWithProviders(<PracticePage />);

      // Items 0..3: submit + next, to reach the last item (index 4).
      for (let i = 0; i < 4; i++) {
        fireEvent.change(screen.getByRole('textbox'), {
          target: { value: 'middle' },
        });
        fireEvent.click(screen.getByRole('button', { name: /submit/i }));
        fireEvent.click(screen.getByRole('button', { name: 'next' }));
      }
      expect(screen.getByText(/sentence-4/)).toBeInTheDocument();

      // Item 4 (last): submit fails → error card with "skip item".
      submitMutate.mockImplementationOnce((_vars, opts) =>
        opts.onError?.(new Error('Bad gateway 502')),
      );
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'middle' },
      });
      fireEvent.click(screen.getByRole('button', { name: /submit/i }));
      fireEvent.click(screen.getByRole('button', { name: 'skip item' }));

      // Skipping the last item must finalize the session and navigate to the
      // debrief — not advance index out of bounds into a blank screen.
      expect(completeMutate).toHaveBeenCalledTimes(1);
      expect(mockPush).toHaveBeenCalledWith(`/drill/debrief/${SESSION_ID}`);
    });
  });

  // -------------------------------------------------------------------------
  describe('desktop vs mobile chrome', () => {
    it('renders the coach rail (not a coach card) on desktop', () => {
      renderWithProviders(<PracticePage />);
      // CoachRail's "guiding this session" caption is unique to the rail.
      expect(screen.getByText('guiding this session')).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: /coach/i }),
      ).not.toBeInTheDocument();
    });

    it('renders the coach card, session dots, and a sticky action bar on mobile', () => {
      mockIsMobile.mockReturnValue(true);
      renderWithProviders(<PracticePage />);

      // Coach rail collapses into a collapsible card (a button) on mobile.
      expect(
        screen.getByRole('button', { name: /coach/i }),
      ).toBeInTheDocument();
      expect(screen.queryByText('guiding this session')).not.toBeInTheDocument();

      // Session dots above the prompt.
      expect(
        screen.getByRole('list', { name: /item 1 of 5/i }),
      ).toBeInTheDocument();

      // The submit CTA lives in the action bar (published, not inline).
      expect(
        screen.getByRole('button', { name: 'submit' }),
      ).toBeInTheDocument();
    });

    it('submit → next advances the cursor via the action bar on mobile', () => {
      mockIsMobile.mockReturnValue(true);
      setSubmitMock((_vars, opts) => opts.onSuccess?.(mockEval(0.97)));
      renderWithProviders(<PracticePage />);

      expect(screen.getByText(/sentence-0/)).toBeInTheDocument();

      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'middle' },
      });
      fireEvent.click(screen.getByRole('button', { name: 'submit' }));

      // Verdict shown; the action bar now carries "next".
      expect(screen.getByText('spot on')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'next' }));

      expect(screen.getByText(/sentence-1/)).toBeInTheDocument();
      expect(screen.queryByText(/sentence-0/)).not.toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  describe('coach headline — cross-session recurring error', () => {
    it('shows the lately · headline when insights returns a theme with count ≥ 2 and no session errors', () => {
      mockUseInsightsErrors.mockReturnValue({
        data: {
          themes: [
            {
              grammarPointKey: 'tr-a1-locative',
              grammarPointName: 'Locative case',
              errorType: 'grammar',
              count: 6,
              majorCount: 4,
              lastOccurredAt: '2026-06-19T00:00:00.000Z',
              sample: { wrongText: 'pazarda', correction: 'pazara' },
              score: 4,
            },
          ],
        },
      });
      renderWithProviders(<PracticePage />);
      // Page lands in-session (default mocks fire CREATE_SUCCEEDED synchronously)
      // with no session errors → cross-session headline wins.
      expect(
        screen.getByText('lately · Locative case: pazarda → pazara (6×)'),
      ).toBeInTheDocument();
    });

    it('shows the canned coach message when insights has no themes', () => {
      // Default beforeEach already sets mockUseInsightsErrors to { data: { themes: [] } }
      renderWithProviders(<PracticePage />);
      // Default in-session idle state → canned "guiding this session" caption visible.
      expect(screen.getByText('guiding this session')).toBeInTheDocument();
      // No lately headline.
      expect(screen.queryByText(/lately ·/)).not.toBeInTheDocument();
    });
  });
});

describe('PracticePage — targeted quick drill', () => {
  it('?start=quick&grammarPoint=tr-a1-locative passes grammarPointKey into the create-session mutation', () => {
    mockSearchParamsString = 'start=quick&grammarPoint=tr-a1-locative';
    renderWithProviders(<PracticePage />);

    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({ grammarPointKey: 'tr-a1-locative' }),
      expect.anything(),
    );
  });

  it('?start=quick without grammarPoint does NOT include grammarPointKey', () => {
    mockSearchParamsString = 'start=quick';
    renderWithProviders(<PracticePage />);

    expect(createMutate).toHaveBeenCalledWith(
      expect.not.objectContaining({ grammarPointKey: expect.anything() }),
      expect.anything(),
    );
  });
});

describe('PracticePage — hub (no start intent)', () => {
  it('renders the launcher hub instead of auto-starting when there is no ?start', () => {
    mockSearchParamsString = '';
    renderWithProviders(<PracticePage />);

    expect(createMutate).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: /quick drill/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /dictation/i }),
    ).toBeInTheDocument();
  });

  it('tapping "quick drill" starts a 5-item mixed session', () => {
    mockSearchParamsString = '';
    renderWithProviders(<PracticePage />);
    fireEvent.click(screen.getByRole('button', { name: /quick drill/i }));
    expect(createMutate).toHaveBeenCalledWith(
      { language: 'ES', difficulty: 'B1', exerciseCount: 5 },
      expect.any(Object),
    );
  });

  it('tapping "dictation" starts a dictation-only run', () => {
    mockSearchParamsString = '';
    renderWithProviders(<PracticePage />);
    fireEvent.click(screen.getByRole('button', { name: /dictation/i }));
    expect(createMutate).toHaveBeenCalledWith(
      {
        language: 'ES',
        difficulty: 'B1',
        exerciseCount: 4,
        exerciseType: ExerciseType.DICTATION,
      },
      expect.any(Object),
    );
  });
});
