import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { LabelQueueItem } from '@language-drill/api-client';
import { SubmissionCard } from '../_components/submission-card';

const base: LabelQueueItem = {
  submissionId: '11111111-1111-4111-8111-111111111111',
  exerciseId: '22222222-2222-4222-8222-222222222222',
  language: 'ES',
  cefrLevel: 'B1',
  exerciseType: 'cloze',
  grammarPointKey: 'es.b1.preterite-vs-imperfect',
  learnerView: 'Fill the blank\nAyer ___ al mercado.',
  referenceAnswers: { correctAnswer: 'fui', acceptableAnswers: ['me fui'] },
  userAnswer: 'iba',
  evaluation: {
    score: 0.4,
    grammarAccuracy: 0.3,
    taskAchievement: 0.5,
    vocabularyRange: 0.8,
    feedback: 'iba is the imperfect; the adverbial forces the preterite.',
    errors: [{ type: 'grammar', grammarPointKey: 'es.b1.preterite-vs-imperfect', explanation: 'wrong aspect' }],
  },
  score: 0.4,
  evaluatedAt: '2026-09-20T12:00:00.000Z',
  optionsRevealed: false,
};

describe('SubmissionCard', () => {
  it('shows the stimulus, the answer, the reference and the evaluation', () => {
    render(<SubmissionCard item={base} />);
    expect(screen.getByText(/Ayer ___ al mercado/)).toBeInTheDocument();
    expect(screen.getByText('iba')).toBeInTheDocument();
    // Exact string match (not /fui/) — a regex would also match the
    // acceptableAnswers span ("me fui"), which contains "fui" as a substring,
    // and getByText would then throw for finding two elements.
    expect(screen.getByText('fui')).toBeInTheDocument();
    expect(screen.getByText(/the adverbial forces the preterite/)).toBeInTheDocument();
    // The grammar point key legitimately renders twice (header badge + the
    // per-error attribution), so assert presence via getAllByText rather than
    // getByText, which throws on more than one match.
    expect(screen.getAllByText(/es\.b1\.preterite-vs-imperfect/).length).toBeGreaterThan(0);
  });

  it('renders an evaluation with no errors without crashing', () => {
    render(<SubmissionCard item={{ ...base, evaluation: { score: 1, feedback: 'Correct.', errors: [] } }} />);
    expect(screen.getByText('Correct.')).toBeInTheDocument();
  });

  it('renders when the evaluation is missing entirely', () => {
    render(<SubmissionCard item={{ ...base, evaluation: null }} />);
    expect(screen.getByText(/no evaluation/i)).toBeInTheDocument();
  });

  it('marks a row where the learner revealed the options', () => {
    render(<SubmissionCard item={{ ...base, optionsRevealed: true }} />);
    expect(screen.getByText(/options revealed/i)).toBeInTheDocument();
  });
});
