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

const mockUseExercise = vi.fn();
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
});
