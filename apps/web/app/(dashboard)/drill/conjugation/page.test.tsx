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

const mockUseExerciseSet = vi.fn();
const mockUseSubmitAnswer = vi.fn();
const mockUseLanguageProfiles = vi.fn();
const mockUseFlagExercise = vi.fn();

vi.mock('@language-drill/api-client', () => ({
  useExerciseSet: (...args: unknown[]) => mockUseExerciseSet(...args),
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

// The second item in the set — distinct id + content, used to prove the page
// steps to the next loaded prompt on "next" (no refetch).
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

// Build a set-hook return value from a list of exercises.
function setReturn(
  exercises: unknown[],
  overrides: Record<string, unknown> = {},
) {
  return {
    data: { exercises, available: exercises.length },
    isLoading: false,
    isError: false,
    error: null,
    refetch,
    ...overrides,
  };
}

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
  // Default: a single-item set.
  mockUseExerciseSet.mockReturnValue(setReturn([CONJUGATION_EXERCISE]));

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
  it('renders the heading and the first item of the set on load', () => {
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
      expect(screen.getByText('ir + íamos')).toBeInTheDocument();
    });

    expect(submitMutateAsync).toHaveBeenCalledWith({
      exerciseId: 'conj-exercise-001',
      answer: 'iríamos',
    });
    expect(submitMutateAsync.mock.calls[0][0]).not.toHaveProperty('sessionId');
  });

  it('steps to the next item in the set on "next" (no refetch)', async () => {
    mockUseExerciseSet.mockReturnValue(
      setReturn([CONJUGATION_EXERCISE, SECOND_EXERCISE]),
    );
    renderWithProviders(<ConjugationPage />);

    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'iríamos' } });
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    await waitFor(() => {
      expect(screen.getByText('ir + íamos')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /^next$/i }));

    // Second prompt shown; previous feedback cleared. No refetch — the items
    // were pre-loaded in the set.
    expect(screen.getByText('hablar')).toBeInTheDocument();
    expect(screen.queryByText('ir + íamos')).not.toBeInTheDocument();
    expect(refetch).not.toHaveBeenCalled();
  });

  it('labels the last item of the set "see results"', async () => {
    // Single-item set → the only item is the last item.
    renderWithProviders(<ConjugationPage />);
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'iríamos' } });
    fireEvent.click(screen.getByRole('button', { name: /^submit$/i }));
    await waitFor(() => {
      expect(screen.getByText('ir + íamos')).toBeInTheDocument();
    });
    expect(
      screen.getByRole('button', { name: /see results/i }),
    ).toBeInTheDocument();
  });

  it('shows a friendly empty-pool message when the set is empty', () => {
    mockUseExerciseSet.mockReturnValue(setReturn([]));
    renderWithProviders(<ConjugationPage />);
    expect(
      screen.getByText(/no conjugation exercises yet/i),
    ).toBeInTheDocument();
  });

  it('shows a loading message while the set is not yet available', () => {
    mockUseExerciseSet.mockReturnValue(
      setReturn([], { data: undefined, isLoading: true }),
    );
    renderWithProviders(<ConjugationPage />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows an error message when the set fails to load', () => {
    mockUseExerciseSet.mockReturnValue(
      setReturn([], { data: undefined, isError: true, error: new Error('boom') }),
    );
    renderWithProviders(<ConjugationPage />);
    expect(screen.getByText(/could not load conjugation exercises/i)).toBeInTheDocument();
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

  it('changing the drill level re-composes the set at the new CEFR level', () => {
    renderWithProviders(<ConjugationPage />);
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: CefrLevel.B2 },
    });
    expect(mockUseExerciseSet).toHaveBeenLastCalledWith(
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
    expect(refetch).toHaveBeenCalledTimes(1);
    expect(
      screen.queryByRole('button', { name: /finish session/i }),
    ).not.toBeInTheDocument();
  });
});

describe('ConjugationPage — grammarPoint targeting', () => {
  it('?grammarPoint=tr-a1-dili-past is passed to useExerciseSet as grammarPointKey', () => {
    mockSearchParamsString = 'grammarPoint=tr-a1-dili-past';
    renderWithProviders(<ConjugationPage />);

    expect(mockUseExerciseSet).toHaveBeenCalledWith(
      expect.objectContaining({ grammarPointKey: 'tr-a1-dili-past' }),
    );
  });

  it('no ?grammarPoint → useExerciseSet is called WITHOUT grammarPointKey', () => {
    mockSearchParamsString = '';
    renderWithProviders(<ConjugationPage />);

    expect(mockUseExerciseSet).toHaveBeenCalledWith(
      expect.not.objectContaining({ grammarPointKey: expect.anything() }),
    );
  });

  it('shows a server re-leveled difficulty in the level display WITHOUT re-feeding the query (cross-level theory-page launch)', () => {
    // Profile baseline is ES/B1 (see providerWrapper); a grammarPoint targeting
    // an A2 point must re-level the DISPLAY to A2 while the query input stays
    // B1 — feeding the effective level back into useExerciseSet would change
    // its query key, resetting `data` to undefined mid-refetch and unmounting
    // the exercise pane (discarding any in-progress typed answer).
    mockSearchParamsString = 'grammarPoint=es-a2-ser-vs-estar';
    mockUseExerciseSet.mockReturnValue(
      setReturn([CONJUGATION_EXERCISE], {
        data: { exercises: [CONJUGATION_EXERCISE], available: 1, difficulty: CefrLevel.A2 },
      }),
    );

    renderWithProviders(<ConjugationPage />);

    // (1) Display reflects the level the set was ACTUALLY pulled at.
    expect(screen.getByRole('combobox')).toHaveValue(CefrLevel.A2);
    // (2) The query input did NOT change — every call kept the requested B1.
    expect(mockUseExerciseSet.mock.calls.length).toBeGreaterThan(0);
    for (const [args] of mockUseExerciseSet.mock.calls) {
      expect(args).toMatchObject({ difficulty: CefrLevel.B1 });
    }
  });
});
