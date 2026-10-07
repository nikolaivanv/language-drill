import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FwAttempt } from './fw-attempt';

const mockUseFreeWritingAttempt = vi.fn();
const mockPush = vi.fn();

vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/api-client')>(
    '@language-drill/api-client',
  );
  return {
    parseStoredFreeWritingEvaluation: actual.parseStoredFreeWritingEvaluation,
    useFreeWritingAttempt: (...args: unknown[]) => mockUseFreeWritingAttempt(...args),
  };
});

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush }),
}));

const evaluation = {
  overallScore: 0.72,
  overallCefr: 'B1',
  headline: 'Clear argument, shaky agreement',
  summary: 'Good structure overall.',
  criteria: [
    { id: 'task', label: 'Task achievement', score: 0.8, cefr: 'B2', note: 'On task.' },
    { id: 'grammar', label: 'Grammatical range & accuracy', score: 0.6, cefr: 'B1', note: 'Agreement slips.' },
  ],
  errors: [
    { n: 1, severity: 'high', type: 'Concordancia', original: 'los casa', correction: 'las casas', note: 'Gender and number.' },
  ],
  goodSpans: [],
  improved: { text: 'Las casas son grandes.' },
  wordCount: 4,
  improvedWordCount: 4,
};

const attempt = {
  id: 'sub-1',
  exerciseId: 'ex-1',
  evaluatedAt: '2026-10-03T10:00:00.000Z',
  language: 'ES',
  difficulty: 'B1',
  content: { title: 'El teletrabajo', task: 'Escribe un ensayo.' },
  userAnswer: 'Los casa son grandes.',
  evaluation,
};

function attemptState(overrides: Record<string, unknown> = {}) {
  return { data: attempt, isPending: false, isError: false, error: null, ...overrides };
}

const fetchFn = vi.fn();

beforeEach(() => {
  mockUseFreeWritingAttempt.mockReset();
  mockPush.mockReset();
});

describe('FwAttempt', () => {
  it('shows the prompt and the stored results, and walks to the corrections', () => {
    mockUseFreeWritingAttempt.mockReturnValue(attemptState());
    render(<FwAttempt submissionId="sub-1" fetchFn={fetchFn} />);

    expect(mockUseFreeWritingAttempt).toHaveBeenCalledWith({ submissionId: 'sub-1', fetchFn });
    expect(screen.getByText('El teletrabajo')).toBeInTheDocument();
    expect(screen.getByText('Escribe un ensayo.')).toBeInTheDocument();
    expect(screen.getByText('Clear argument, shaky agreement')).toBeInTheDocument();
    expect(screen.getByText('Agreement slips.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /see corrections/i }));
    expect(screen.getByText(/1 things to fix/)).toBeInTheDocument();
    expect(screen.getByText('Gender and number.')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /← back/ }));
    expect(screen.getByText('Clear argument, shaky agreement')).toBeInTheDocument();
  });

  it('returns to the history list from the results exit button', () => {
    mockUseFreeWritingAttempt.mockReturnValue(attemptState());
    render(<FwAttempt submissionId="sub-1" fetchFn={fetchFn} />);
    fireEvent.click(screen.getByRole('button', { name: 'back to past attempts' }));
    expect(mockPush).toHaveBeenCalledWith('/drill/free-writing/history');
  });

  it('degrades to the raw essay when the stored evaluation is in an outdated shape', () => {
    mockUseFreeWritingAttempt.mockReturnValue(
      attemptState({ data: { ...attempt, evaluation: { ...evaluation, improved: '{"text":"x"}' } } }),
    );
    render(<FwAttempt submissionId="sub-1" fetchFn={fetchFn} />);
    expect(screen.getByText(/older version of the evaluator/)).toBeInTheDocument();
    expect(screen.getByText('Los casa son grandes.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /see corrections/i })).toBeNull();
  });

  it('says the attempt was not found on a 404', () => {
    mockUseFreeWritingAttempt.mockReturnValue(
      attemptState({ data: undefined, isError: true, error: Object.assign(new Error('nf'), { status: 404 }) }),
    );
    render(<FwAttempt submissionId="sub-x" fetchFn={fetchFn} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/wasn.t found/);
    expect(screen.getByRole('link', { name: /past attempts/ })).toHaveAttribute(
      'href',
      '/drill/free-writing/history',
    );
  });

  it('shows a generic error for other failures', () => {
    mockUseFreeWritingAttempt.mockReturnValue(
      attemptState({ data: undefined, isError: true, error: Object.assign(new Error('boom'), { status: 500 }) }),
    );
    render(<FwAttempt submissionId="sub-1" fetchFn={fetchFn} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/Couldn.t load this attempt/);
  });
});
