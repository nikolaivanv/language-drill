import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
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
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockUseExercise = vi.fn();
const mockMutate = vi.fn();
const mockReset = vi.fn();
const mockRefetch = vi.fn();
const mockUseSubmitAnswer = vi.fn();
const mockUseLanguageProfiles = vi.fn();

vi.mock('@language-drill/api-client', () => ({
  useExercise: (...args: unknown[]) => mockUseExercise(...args),
  useSubmitAnswer: (...args: unknown[]) => mockUseSubmitAnswer(...args),
  useLanguageProfiles: (...args: unknown[]) => mockUseLanguageProfiles(...args),
  createAuthenticatedFetch: vi.fn(() => vi.fn()),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// Cloze fixture intentionally OMITS topicHint so the theory trigger does not
// render — theory wiring is covered by component-level theory panel tests.
const clozeExercise = {
  id: 'ex-1',
  type: 'cloze' as const,
  language: 'ES',
  difficulty: 'B1',
  contentJson: {
    type: ExerciseType.CLOZE,
    instructions: 'fill the blank',
    sentence: 'Yo ___ pan.',
    correctAnswer: 'como',
    options: ['como', 'comes', 'come'],
  },
};

const translationExercise = {
  id: 'ex-2',
  type: 'translation' as const,
  language: 'ES',
  difficulty: 'B1',
  contentJson: {
    type: ExerciseType.TRANSLATION,
    instructions: 'translate to spanish',
    sourceText: 'I read books.',
    sourceLanguage: Language.EN,
    targetLanguage: Language.ES,
    referenceTranslation: 'Yo leo libros.',
  },
};

const vocabExercise = {
  id: 'ex-3',
  type: 'vocab_recall' as const,
  language: 'ES',
  difficulty: 'B1',
  contentJson: {
    type: ExerciseType.VOCAB_RECALL,
    instructions: 'what is the spanish word for:',
    prompt: 'butterfly',
    expectedWord: 'mariposa',
    hints: ['it flies'],
    exampleSentence: 'La mariposa es bonita.',
  },
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

function renderWithProviders(
  ui: React.ReactElement,
  options: { activeLanguage?: Language.ES | Language.DE | Language.TR } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const profileLang = options.activeLanguage ?? Language.ES;
  return render(
    <QueryClientProvider client={queryClient}>
      <ActiveLanguageProvider
        profiles={[{ language: profileLang, proficiencyLevel: CefrLevel.B1 }]}
      >
        {ui}
      </ActiveLanguageProvider>
    </QueryClientProvider>,
  );
}

/**
 * Stub `useSubmitAnswer` so that calling `mutate(vars, opts)` synchronously
 * invokes `opts.onSuccess(result)` — letting tests assert the evaluated UI
 * without needing async waits.
 */
function stubSubmitWithSuccess(result: unknown) {
  mockUseSubmitAnswer.mockReturnValue({
    mutate: vi.fn(
      (
        _vars: unknown,
        opts: { onSuccess: (data: unknown) => void; onError: (err: Error) => void },
      ) => {
        opts.onSuccess(result);
      },
    ),
    reset: mockReset,
    isPending: false,
    error: null,
  });
}

/**
 * Stub `useSubmitAnswer` so that calling `mutate(vars, opts)` synchronously
 * invokes `opts.onError(error)`.
 */
function stubSubmitWithError(error: Error) {
  mockUseSubmitAnswer.mockReturnValue({
    mutate: vi.fn(
      (
        _vars: unknown,
        opts: { onSuccess: (data: unknown) => void; onError: (err: Error) => void },
      ) => {
        opts.onError(error);
      },
    ),
    reset: mockReset,
    isPending: false,
    error: null,
  });
}

// ---------------------------------------------------------------------------
// Default mock setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
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
  mockUseSubmitAnswer.mockReturnValue({
    mutate: mockMutate,
    reset: mockReset,
    isPending: false,
    error: null,
  });
  mockUseExercise.mockReturnValue({
    data: clozeExercise,
    isLoading: false,
    error: null,
    refetch: mockRefetch,
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PracticePage', () => {
  // -------------------------------------------------------------------------
  describe('rendering', () => {
    it('renders the lowercase "practice" heading on the pre-selection screen', () => {
      // The heading only renders in the pre-language-selection branch
      // (profiles.length === 0). Once profiles are loaded the page returns
      // the DrillLayout, which has no h1.
      mockUseLanguageProfiles.mockReturnValue({
        data: { profiles: [] },
        isLoading: false,
        error: null,
      });
      mockUseExercise.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      });
      renderWithProviders(<PracticePage />);
      const heading = screen.getByRole('heading', { level: 1 });
      expect(heading).toHaveTextContent('practice');
    });

    it('renders both Language and Difficulty selectors', () => {
      renderWithProviders(<PracticePage />);
      expect(screen.getByLabelText(/Language/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Difficulty/)).toBeInTheDocument();
    });

    it('renders the loading skeleton (animate-pulse) while fetching', () => {
      mockUseExercise.mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
        refetch: mockRefetch,
      });
      const { container } = renderWithProviders(<PracticePage />);
      expect(container.querySelector('.animate-pulse')).toBeInTheDocument();
    });

    it('renders the rail (CoachRail) when an exercise is loaded', () => {
      renderWithProviders(<PracticePage />);
      // Rail content from CoachRail
      expect(screen.getByText('coach')).toBeInTheDocument();
      expect(screen.getByText('guiding this session')).toBeInTheDocument();
    });

    it('pre-language-selection: with no profiles, renders bare selectors and NO rail', () => {
      mockUseLanguageProfiles.mockReturnValue({
        data: { profiles: [] },
        isLoading: false,
        error: null,
      });
      mockUseExercise.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      });
      renderWithProviders(<PracticePage />);
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
        'practice',
      );
      expect(screen.getByLabelText(/Language/)).toBeInTheDocument();
      expect(screen.getByLabelText(/Difficulty/)).toBeInTheDocument();
      // Rail content must NOT be in the DOM (no DrillLayout rail)
      expect(screen.queryByText('coach')).not.toBeInTheDocument();
      expect(screen.queryByText('guiding this session')).not.toBeInTheDocument();
    });

    it('shows the 404 empty-state card when useExercise returns a 404 error', () => {
      mockUseExercise.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('Request failed with status 404'),
        refetch: mockRefetch,
      });
      renderWithProviders(<PracticePage />);
      expect(
        screen.getByText(/no exercises available for Spanish at B1/),
      ).toBeInTheDocument();
      expect(screen.getByText('try a different difficulty')).toBeInTheDocument();
    });

    it('shows the generic load-error card with the error message for non-404 errors', () => {
      mockUseExercise.mockReturnValue({
        data: undefined,
        isLoading: false,
        error: new Error('connection refused'),
        refetch: mockRefetch,
      });
      renderWithProviders(<PracticePage />);
      expect(screen.getByText('connection refused')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  describe('exercise dispatch', () => {
    it('renders the cloze input when content is cloze', () => {
      // Default beforeEach loads clozeExercise
      renderWithProviders(<PracticePage />);
      expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument();
      // The cloze sentence with blank is shown
      expect(screen.getByText(/Yo/)).toBeInTheDocument();
    });

    it('renders the translation textarea + "EN → ES" eyebrow when content is translation', () => {
      mockUseExercise.mockReturnValue({
        data: translationExercise,
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      });
      renderWithProviders(<PracticePage />);
      expect(screen.getByText(/EN\s*→\s*ES/)).toBeInTheDocument();
      // Source text appears glossed inline
      expect(screen.getByText(/I read books/)).toBeInTheDocument();
    });

    it('renders the vocab prompt when content is vocab_recall', () => {
      mockUseExercise.mockReturnValue({
        data: vocabExercise,
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      });
      renderWithProviders(<PracticePage />);
      expect(screen.getByText('butterfly')).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  describe('submission flow', () => {
    it('submit button is disabled when answer is empty', () => {
      renderWithProviders(<PracticePage />);
      expect(screen.getByRole('button', { name: /submit/i })).toBeDisabled();
    });

    it('submit button enables after typing and calls mutate with { exerciseId, answer }', () => {
      renderWithProviders(<PracticePage />);
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'como' } });

      const submitBtn = screen.getByRole('button', { name: /submit/i });
      expect(submitBtn).toBeEnabled();
      fireEvent.click(submitBtn);

      expect(mockMutate).toHaveBeenCalledWith(
        { exerciseId: 'ex-1', answer: 'como' },
        expect.objectContaining({
          onSuccess: expect.any(Function),
          onError: expect.any(Function),
        }),
      );
    });

    it('shows the spinner state on the submit button while submission is pending', () => {
      // Stub mutate as a no-op so the page stays in `submission.kind ==
      // 'submitting'` after click — neither onSuccess nor onError fires.
      mockUseSubmitAnswer.mockReturnValue({
        mutate: vi.fn(),
        reset: mockReset,
        isPending: false,
        error: null,
      });
      const { container } = renderWithProviders(<PracticePage />);
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'como' } });
      fireEvent.click(screen.getByRole('button', { name: /submit/i }));

      // Once loading=true the Button replaces its children with a Spinner,
      // so it no longer has an accessible name "submit". Query by aria-busy
      // attribute on the now-spinning button.
      const busyButton = container.querySelector('button[aria-busy="true"]');
      expect(busyButton).not.toBeNull();
      expect(busyButton).toBeDisabled();
      // The animated spinner SVG is in the DOM
      expect(container.querySelector('svg.animate-spin')).not.toBeNull();
    });

    it('on successful submit synchronously, FeedbackShell renders with the verdict label', () => {
      stubSubmitWithSuccess(mockEval(0.97));
      renderWithProviders(<PracticePage />);
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'como' } });
      fireEvent.click(screen.getByRole('button', { name: /submit/i }));

      expect(screen.getByText('spot on')).toBeInTheDocument();
      // The FeedbackShell exposes a "next" button
      expect(screen.getByRole('button', { name: 'next' })).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  describe('feedback tier mapping (one per band)', () => {
    function submitClozeWithScore(score: number) {
      stubSubmitWithSuccess(mockEval(score));
      renderWithProviders(<PracticePage />);
      const input = screen.getByRole('textbox');
      fireEvent.change(input, { target: { value: 'como' } });
      fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    }

    it('score=0.97 → sage tier ("spot on") with ok-soft background', () => {
      submitClozeWithScore(0.97);
      const verdict = screen.getByText('spot on');
      // FeedbackShell sets bg via the Card root — walk up to find the card
      const card = verdict.closest('[class*="bg-["]');
      expect(card).not.toBeNull();
      expect(card!.className).toContain('bg-[var(--color-ok-soft)]');
    });

    it('score=0.80 → yellow tier ("close") with hilite-soft background', () => {
      submitClozeWithScore(0.8);
      const verdict = screen.getByText('close');
      const card = verdict.closest('[class*="bg-["]');
      expect(card).not.toBeNull();
      expect(card!.className).toContain('bg-[var(--color-hilite-soft)]');
    });

    it('score=0.30 → terracotta tier ("wrong") with accent-soft background', () => {
      submitClozeWithScore(0.3);
      const verdict = screen.getByText('wrong');
      const card = verdict.closest('[class*="bg-["]');
      expect(card).not.toBeNull();
      expect(card!.className).toContain('bg-[var(--color-accent-soft)]');
    });
  });

  // -------------------------------------------------------------------------
  describe('error handling (submission)', () => {
    it('429 error → yellow tier soft background + verbatim rate-limit copy', () => {
      stubSubmitWithError(new Error('Request failed with status 429'));
      renderWithProviders(<PracticePage />);
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'como' },
      });
      fireEvent.click(screen.getByRole('button', { name: /submit/i }));

      const message = screen.getByText(
        "You've reached your daily practice limit. Come back tomorrow!",
      );
      expect(message).toBeInTheDocument();
      const card = message.closest('[class*="bg-["]');
      expect(card!.className).toContain('bg-[var(--color-hilite-soft)]');
      // try-again button is present
      expect(
        screen.getByRole('button', { name: /try again/i }),
      ).toBeInTheDocument();
    });

    it('502 generic error → terracotta tier soft background + verbatim "Failed to submit answer:" copy', () => {
      stubSubmitWithError(new Error('Bad gateway 502'));
      renderWithProviders(<PracticePage />);
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'como' },
      });
      fireEvent.click(screen.getByRole('button', { name: /submit/i }));

      const message = screen.getByText(
        'Failed to submit answer: Bad gateway 502',
      );
      expect(message).toBeInTheDocument();
      const card = message.closest('[class*="bg-["]');
      expect(card!.className).toContain('bg-[var(--color-accent-soft)]');
    });
  });

  // -------------------------------------------------------------------------
  describe('next clears state', () => {
    it('clicking "next" after evaluation calls reset() + refetch() and clears the FeedbackShell', () => {
      stubSubmitWithSuccess(mockEval(0.97));
      renderWithProviders(<PracticePage />);
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'como' },
      });
      fireEvent.click(screen.getByRole('button', { name: /submit/i }));

      // Verdict label is in the DOM
      expect(screen.getByText('spot on')).toBeInTheDocument();

      const nextBtn = screen.getByRole('button', { name: 'next' });
      fireEvent.click(nextBtn);

      // Mutation reset and exercise refetch were both invoked
      expect(mockReset).toHaveBeenCalled();
      expect(mockRefetch).toHaveBeenCalled();
      // FeedbackShell is gone (verdict label no longer in DOM)
      expect(screen.queryByText('spot on')).not.toBeInTheDocument();
      // Submit button reappears in idle state (the renderer is back to input mode)
      expect(screen.getByRole('button', { name: /submit/i })).toBeInTheDocument();
    });
  });

  // -------------------------------------------------------------------------
  // Req 1.6 — no gamification across the four page states.
  //
  // Forbidden tokens (with word boundaries to avoid false positives like
  // "today", "everyday", "Wednesday"):
  //   - /\bstreak\b/i
  //   - /\bxp\b/i
  //   - /\bday\b/i
  //   - /\blesson\b/i
  //   - /session\s+\d+\s+of\s+\d+/i  ← the literal "session N of M" pattern;
  //     bare "session" (e.g. "guiding this session" in CoachRail) is allowed.
  // -------------------------------------------------------------------------
  describe('no gamification (Req 1.6)', () => {
    const FORBIDDEN: ReadonlyArray<{ name: string; re: RegExp }> = [
      { name: 'streak', re: /\bstreak\b/i },
      { name: 'XP', re: /\bxp\b/i },
      { name: 'day (word-boundary)', re: /\bday\b/i },
      { name: 'lesson', re: /\blesson\b/i },
      { name: 'session N of M', re: /session\s+\d+\s+of\s+\d+/i },
    ];

    function expectNoGamification(label: string, container: HTMLElement) {
      const text = container.textContent ?? '';
      for (const { name, re } of FORBIDDEN) {
        if (re.test(text)) {
          throw new Error(
            `[${label}] forbidden gamification token "${name}" matched in rendered DOM. ` +
              `Body text:\n${text}`,
          );
        }
      }
    }

    it('sweeps the four states (loading, idle, evaluated, error) for forbidden tokens', () => {
      // ---- loading ----
      mockUseExercise.mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
        refetch: mockRefetch,
      });
      const loadingRender = renderWithProviders(<PracticePage />);
      expectNoGamification('loading', loadingRender.container);
      loadingRender.unmount();

      // ---- idle (default cloze, no submission) ----
      mockUseExercise.mockReturnValue({
        data: clozeExercise,
        isLoading: false,
        error: null,
        refetch: mockRefetch,
      });
      mockUseSubmitAnswer.mockReturnValue({
        mutate: mockMutate,
        reset: mockReset,
        isPending: false,
        error: null,
      });
      const idleRender = renderWithProviders(<PracticePage />);
      expectNoGamification('idle', idleRender.container);
      idleRender.unmount();

      // ---- evaluated (sync onSuccess) ----
      stubSubmitWithSuccess(mockEval(0.97));
      const evaluatedRender = renderWithProviders(<PracticePage />);
      const inputEl = within(evaluatedRender.container).getByRole('textbox');
      fireEvent.change(inputEl, { target: { value: 'como' } });
      fireEvent.click(
        within(evaluatedRender.container).getByRole('button', {
          name: /submit/i,
        }),
      );
      expectNoGamification('evaluated', evaluatedRender.container);
      evaluatedRender.unmount();

      // ---- error (sync onError) ----
      stubSubmitWithError(new Error('Bad gateway 502'));
      const errorRender = renderWithProviders(<PracticePage />);
      const errInput = within(errorRender.container).getByRole('textbox');
      fireEvent.change(errInput, { target: { value: 'como' } });
      fireEvent.click(
        within(errorRender.container).getByRole('button', { name: /submit/i }),
      );
      expectNoGamification('error', errorRender.container);
      errorRender.unmount();
    });
  });
});
