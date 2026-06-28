import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CefrLevel, ExerciseType, Language } from '@language-drill/shared';
import { ActiveLanguageProvider } from '../../../../components/shell';
import ConjugationPage from './page';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetToken = vi.fn().mockResolvedValue('test-token');

vi.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ getToken: mockGetToken }),
}));

let mockSearchParamsString = '';
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(mockSearchParamsString),
}));

const mockUseExercise = vi.fn();
const mockUseSubmitAnswer = vi.fn();
const mockUseLanguageProfiles = vi.fn();
const mockUseFlagExercise = vi.fn();

vi.mock('@language-drill/api-client', () => ({
  useExercise: (...args: unknown[]) => mockUseExercise(...args),
  useSubmitAnswer: (...args: unknown[]) => mockUseSubmitAnswer(...args),
  useLanguageProfiles: (...args: unknown[]) => mockUseLanguageProfiles(...args),
  useFlagExercise: (...args: unknown[]) => mockUseFlagExercise(...args),
  createAuthenticatedFetch: vi.fn(() => vi.fn()),
}));

// Stub the theory surface: render a recognizable trigger button, no-op panel.
vi.mock('../../../../components/theory', () => ({
  TheoryTrigger: ({ topicId }: { topicId: string }) => (
    <button type="button">theory · {topicId}</button>
  ),
  TheoryPanel: () => null,
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const CONJUGATION_EXERCISE = {
  id: 'conj-exercise-001',
  type: ExerciseType.CONJUGATION,
  language: Language.ES,
  difficulty: CefrLevel.B1,
  grammarPointKey: 'es-b1-conditional',
  contentJson: {
    type: ExerciseType.CONJUGATION,
    instructions: 'Write the correct form.',
    lemma: 'ir',
    lemmaGloss: 'to go',
    featureBundle: 'condicional · 1ª persona del plural',
    features: [{ term: 'condicional', gloss: 'conditional' }],
    subject: { pronoun: 'nosotros', gloss: 'we' },
    targetForm: 'iríamos',
    breakdown: 'ir + íamos',
    exampleSentences: ['Iríamos al cine si tuviéramos tiempo.'],
  },
};

// A second, distinct exercise — what the backend returns on the *next* random
// pull. Used to prove the prompt swaps cleanly (different id + content).
const SECOND_EXERCISE = {
  ...CONJUGATION_EXERCISE,
  id: 'conj-exercise-002',
  grammarPointKey: 'es-b1-conditional',
  contentJson: {
    ...CONJUGATION_EXERCISE.contentJson,
    lemma: 'hablar',
    lemmaGloss: 'to speak',
    targetForm: 'hablaríamos',
    breakdown: 'hablar + íamos',
    exampleSentences: ['Hablaríamos más despacio.'],
  },
};

const SAMPLE_RESULT = {
  score: 1,
  grammarAccuracy: 1,
  vocabularyRange: 'n/a',
  taskAchievement: 1,
  feedback: 'Correct.',
  errors: [],
  estimatedCefrEvidence: 'B1',
  submissionId: '11111111-1111-4111-8111-111111111111',
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function providerWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <ActiveLanguageProvider
          profiles={[{ language: Language.ES, proficiencyLevel: CefrLevel.B1 }]}
        >
          {children}
        </ActiveLanguageProvider>
      </QueryClientProvider>
    );
  };
}

function renderWithProviders(ui: React.ReactElement) {
  // `wrapper` keeps the providers stable across `rerender`, so a test can swap
  // the mocked `useExercise` return value and re-render the same tree.
  return render(ui, { wrapper: providerWrapper() });
}

let submitMutateAsync: ReturnType<typeof vi.fn>;
let refetch: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mockSearchParamsString = '';

  mockUseLanguageProfiles.mockReturnValue({
    data: { profiles: [{ language: Language.ES, proficiencyLevel: CefrLevel.B1 }] },
    isLoading: false,
    error: null,
  });

  refetch = vi.fn();
  mockUseExercise.mockReturnValue({
    data: CONJUGATION_EXERCISE,
    isLoading: false,
    isError: false,
    error: null,
    refetch,
  });

  submitMutateAsync = vi.fn().mockResolvedValue(SAMPLE_RESULT);
  mockUseSubmitAnswer.mockReturnValue({
    mutateAsync: submitMutateAsync,
    isPending: false,
    error: null,
  });

  mockUseFlagExercise.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
    isError: false,
    isSuccess: false,
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConjugationPage', () => {
  it('renders the heading and the exercise prompt on load', () => {
    renderWithProviders(<ConjugationPage />);
    expect(screen.getByText(/conjugation warm-up/i)).toBeInTheDocument();
    expect(screen.getByText('ir')).toBeInTheDocument();
  });

  it('renders the pronoun badge and feature chips with glosses', () => {
    renderWithProviders(<ConjugationPage />);
    expect(screen.getByText('nosotros')).toBeInTheDocument();
    expect(screen.getByText('we')).toBeInTheDocument();
    expect(screen.getByText('condicional')).toBeInTheDocument();
    expect(screen.getByText('conditional')).toBeInTheDocument();
  });

  it('submits the typed answer WITHOUT a sessionId and shows feedback', async () => {
    renderWithProviders(<ConjugationPage />);

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'iríamos' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => {
      // The post-answer teaching surface shows the target form + breakdown.
      expect(screen.getByText('ir + íamos')).toBeInTheDocument();
    });

    expect(submitMutateAsync).toHaveBeenCalledWith({
      exerciseId: 'conj-exercise-001',
      answer: 'iríamos',
    });
    // No sessionId key in the submit payload.
    expect(submitMutateAsync.mock.calls[0][0]).not.toHaveProperty('sessionId');
  });

  it('advances to a fresh exercise via refetch on next', async () => {
    renderWithProviders(<ConjugationPage />);

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'iríamos' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));

    await waitFor(() => {
      expect(screen.getByText('ir + íamos')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /next/i }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('keeps the feedback pinned to the current exercise while the next one is still loading', async () => {
    // Regression: advancing reset submission to idle synchronously, but React
    // Query keeps the previous `data` in place while the refetch is in flight.
    // That produced a render of the OUTGOING exercise as a blank, unanswered
    // prompt before the new one arrived — a visible flash / double-load. The
    // feedback must stay pinned to its exercise until a different one lands.
    renderWithProviders(<ConjugationPage />);

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'iríamos' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => {
      expect(screen.getByText('ir + íamos')).toBeInTheDocument();
    });

    // Advance. `refetch` (mock) does not change `data`, mirroring the in-flight
    // window where React Query still returns the old exercise.
    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    expect(refetch).toHaveBeenCalledTimes(1);
    // The graded surface must NOT collapse back to a blank prompt.
    expect(screen.getByText('ir + íamos')).toBeInTheDocument();
  });

  it('swaps to a clean idle prompt once the next exercise resolves', async () => {
    const { rerender } = renderWithProviders(<ConjugationPage />);

    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'iríamos' },
    });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    await waitFor(() => {
      expect(screen.getByText('ir + íamos')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /next/i }));

    // Refetch resolves with a different random exercise.
    mockUseExercise.mockReturnValue({
      data: SECOND_EXERCISE,
      isLoading: false,
      isError: false,
      error: null,
      refetch,
    });
    rerender(<ConjugationPage />);

    // New prompt shown; the old feedback is gone and the field is ready for a
    // fresh answer — no stale-feedback flash for the new prompt.
    expect(screen.getByText('hablar')).toBeInTheDocument();
    expect(screen.queryByText('ir + íamos')).not.toBeInTheDocument();
  });

  it('shows a friendly empty-pool message on 404 NO_EXERCISES', () => {
    const err = new Error('No exercises found') as Error & {
      body?: { code?: string };
    };
    err.body = { code: 'NO_EXERCISES' };
    mockUseExercise.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: err,
      refetch: vi.fn(),
    });

    renderWithProviders(<ConjugationPage />);

    expect(
      screen.getByText(/no conjugation exercises yet/i),
    ).toBeInTheDocument();
  });

  it('shows a loading message while the exercise is not yet available', () => {
    mockUseExercise.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
      error: null,
      refetch: vi.fn(),
    });

    renderWithProviders(<ConjugationPage />);

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows a deep-link to conjugation fluency mode', () => {
    renderWithProviders(<ConjugationPage />);

    const link = screen.getByRole('link', { name: /drill these fast/i });
    expect(link).toHaveAttribute('href', '/fluency?type=conjugation');
  });

  it('renders the drill-level selector defaulting to the profile baseline', () => {
    renderWithProviders(<ConjugationPage />);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    expect(select.value).toBe(CefrLevel.B1);
  });

  it('changing the drill level refetches at the new CEFR level', () => {
    renderWithProviders(<ConjugationPage />);
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: CefrLevel.B2 },
    });
    expect(mockUseExercise).toHaveBeenLastCalledWith(
      expect.objectContaining({ difficulty: CefrLevel.B2 }),
    );
  });

  it('renders a theory link for a grammar point that maps to a topic', () => {
    renderWithProviders(<ConjugationPage />);
    // es-b1-conditional → topicId "b1-conditional" (lang prefix stripped).
    expect(
      screen.getByRole('button', { name: /theory · b1-conditional/i }),
    ).toBeInTheDocument();
  });

  it('shows the flag control after the answer is evaluated', async () => {
    renderWithProviders(<ConjugationPage />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'iríamos' } });
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    await waitFor(() => {
      expect(screen.getByText('ir + íamos')).toBeInTheDocument();
    });
    expect(
      screen.getByRole('button', { name: /flag this exercise/i }),
    ).toBeInTheDocument();
  });

  it('hides "finish session" until an answer is recorded', () => {
    renderWithProviders(<ConjugationPage />);
    expect(
      screen.queryByRole('button', { name: /finish session/i }),
    ).not.toBeInTheDocument();
  });

  it('finish session opens the review recap with accuracy + practice-more', async () => {
    renderWithProviders(<ConjugationPage />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'iríamos' } });
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    await waitFor(() => {
      expect(screen.getByText('ir + íamos')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /finish session/i }));

    // Reuses the real DebriefHeader summary line.
    expect(screen.getByText(/you got 1 of 1/i)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /practice more/i }),
    ).toBeInTheDocument();
    // The drill prompt is gone while reviewing.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('practice more returns to the drill from the review recap', async () => {
    renderWithProviders(<ConjugationPage />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'iríamos' } });
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    await waitFor(() => {
      expect(screen.getByText('ir + íamos')).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /finish session/i }));
    fireEvent.click(screen.getByRole('button', { name: /practice more/i }));

    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /finish session/i }),
    ).not.toBeInTheDocument();
  });
});

describe('ConjugationPage — grammarPoint targeting', () => {
  it('?grammarPoint=tr-a1-dili-past is passed to useExercise as grammarPointKey', () => {
    mockSearchParamsString = 'grammarPoint=tr-a1-dili-past';
    renderWithProviders(<ConjugationPage />);

    expect(mockUseExercise).toHaveBeenCalledWith(
      expect.objectContaining({ grammarPointKey: 'tr-a1-dili-past' }),
    );
  });

  it('no ?grammarPoint → useExercise is called WITHOUT grammarPointKey', () => {
    mockSearchParamsString = '';
    renderWithProviders(<ConjugationPage />);

    expect(mockUseExercise).toHaveBeenCalledWith(
      expect.not.objectContaining({ grammarPointKey: expect.anything() }),
    );
  });
});
