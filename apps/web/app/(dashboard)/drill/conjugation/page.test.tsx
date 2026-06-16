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
    targetForm: 'iríamos',
    breakdown: 'ir + íamos',
    exampleSentences: ['Iríamos al cine si tuviéramos tiempo.'],
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
    expect(
      screen.getByText('condicional · 1ª persona del plural'),
    ).toBeInTheDocument();
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
});
