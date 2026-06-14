import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { CefrLevel, ExerciseType, Language } from '@language-drill/shared';
import { ActiveLanguageProvider } from '../../../../components/shell';
import FreeWritingPage from './page';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetToken = vi.fn().mockResolvedValue('test-token');

vi.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ getToken: mockGetToken }),
}));

const mockUseExercise = vi.fn();
const mockUseSubmitFreeWriting = vi.fn();
const mockUseLanguageProfiles = vi.fn();

vi.mock('@language-drill/api-client', () => ({
  useExercise: (...args: unknown[]) => mockUseExercise(...args),
  useSubmitFreeWriting: (...args: unknown[]) => mockUseSubmitFreeWriting(...args),
  useLanguageProfiles: (...args: unknown[]) => mockUseLanguageProfiles(...args),
  createAuthenticatedFetch: vi.fn(() => vi.fn()),
}));

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const FREE_WRITING_EXERCISE = {
  id: 'fw-exercise-001',
  type: ExerciseType.FREE_WRITING,
  language: Language.ES,
  difficulty: CefrLevel.B1,
  contentJson: {
    type: ExerciseType.FREE_WRITING,
    instructions: 'Write an opinion essay.',
    title: 'El teletrabajo: ¿avance o aislamiento?',
    task: 'Escribe un ensayo de opinión sobre el teletrabajo.',
    domain: 'opinión · argumentación',
    register: 'formal' as const,
    minWords: 10,
    maxWords: 300,
    suggestedMinutes: 20,
    requiredElements: [
      { id: 're-1', label: 'Introduce the topic clearly' },
      { id: 're-2', label: 'State your opinion' },
    ],
  },
};

const SAMPLE_EVALUATION = {
  overallScore: 0.78,
  overallCefr: 'B1',
  headline: 'Solid B1 writing with clear argument',
  summary: 'Your essay demonstrates solid B1 proficiency.',
  criteria: [
    { name: 'Task Achievement', score: 0.8, cefr: 'B1', feedback: 'Good.' },
    { name: 'Coherence', score: 0.75, cefr: 'B1', feedback: 'Mostly coherent.' },
  ],
  errors: [],
  goodSpans: ['buen trabajo'],
  improved: { text: 'Improved version here.', upgrades: [] },
  wordCount: 150,
  improvedWordCount: 160,
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

beforeEach(() => {
  vi.clearAllMocks();

  mockUseLanguageProfiles.mockReturnValue({
    data: {
      profiles: [{ language: Language.ES, proficiencyLevel: CefrLevel.B1 }],
    },
    isLoading: false,
    error: null,
  });

  mockUseExercise.mockReturnValue({
    data: FREE_WRITING_EXERCISE,
    isLoading: false,
    error: null,
  });

  submitMutateAsync = vi.fn().mockResolvedValue(SAMPLE_EVALUATION);
  mockUseSubmitFreeWriting.mockReturnValue({
    mutateAsync: submitMutateAsync,
    isPending: false,
    error: null,
  });
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('FreeWritingPage', () => {
  describe('step 1: brief stage', () => {
    it('shows the exercise title in the brief on load', () => {
      renderWithProviders(<FreeWritingPage />);
      expect(
        screen.getByText('El teletrabajo: ¿avance o aislamiento?'),
      ).toBeInTheDocument();
    });
  });

  describe('step 2: brief → composer transition', () => {
    it('clicking "begin writing" shows the composer textarea', () => {
      renderWithProviders(<FreeWritingPage />);

      fireEvent.click(screen.getByRole('button', { name: /begin writing/i }));

      expect(screen.getByRole('textbox')).toBeInTheDocument();
    });
  });

  describe('step 3: composer → results after grading', () => {
    it('typing enough words and clicking grade → results headline shown after mutation resolves', async () => {
      renderWithProviders(<FreeWritingPage />);

      // Go to composer
      fireEvent.click(screen.getByRole('button', { name: /begin writing/i }));

      // Type enough words (minWords = 10)
      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, {
        target: {
          value:
            'El teletrabajo tiene ventajas claras para los trabajadores modernos que buscan flexibilidad laboral.',
        },
      });

      // Click grade
      fireEvent.click(
        screen.getByRole('button', { name: /grade my writing/i }),
      );

      // Wait for mutation to resolve and results to show
      await waitFor(() => {
        expect(
          screen.getByText('Solid B1 writing with clear argument'),
        ).toBeInTheDocument();
      });

      expect(submitMutateAsync).toHaveBeenCalledWith({
        exerciseId: 'fw-exercise-001',
        answer:
          'El teletrabajo tiene ventajas claras para los trabajadores modernos que buscan flexibilidad laboral.',
      });
    });
  });

  describe('step 4: results → corrections → compare navigation', () => {
    async function renderAtResults() {
      renderWithProviders(<FreeWritingPage />);

      fireEvent.click(screen.getByRole('button', { name: /begin writing/i }));

      const textarea = screen.getByRole('textbox');
      fireEvent.change(textarea, {
        target: {
          value:
            'El teletrabajo tiene ventajas claras para los trabajadores modernos que buscan flexibilidad.',
        },
      });

      fireEvent.click(
        screen.getByRole('button', { name: /grade my writing/i }),
      );

      await waitFor(() => {
        expect(
          screen.getByText('Solid B1 writing with clear argument'),
        ).toBeInTheDocument();
      });
    }

    it('clicking "see corrections" shows the corrections surface', async () => {
      await renderAtResults();

      fireEvent.click(
        screen.getByRole('button', { name: /see corrections/i }),
      );

      // FwCorrections renders — verify the title or corrections surface shows
      // (no specific text to assert, but results headline should be gone)
      expect(
        screen.queryByText('Solid B1 writing with clear argument'),
      ).not.toBeInTheDocument();
    });

    it('clicking "compare improved version" from results shows compare surface', async () => {
      await renderAtResults();

      fireEvent.click(
        screen.getByRole('button', { name: /compare improved version/i }),
      );

      expect(
        screen.queryByText('Solid B1 writing with clear argument'),
      ).not.toBeInTheDocument();
    });
  });

  describe('loading state', () => {
    it('shows loading message when exercise is not yet available', () => {
      mockUseExercise.mockReturnValue({
        data: undefined,
        isLoading: true,
        error: null,
      });

      renderWithProviders(<FreeWritingPage />);

      expect(screen.getByText(/loading/i)).toBeInTheDocument();
    });
  });
});
