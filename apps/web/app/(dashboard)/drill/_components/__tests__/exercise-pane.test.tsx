import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExerciseType, Language, type ConjugationContent } from '@language-drill/shared';
import type { ExerciseResponse } from '@language-drill/api-client';
import { ExercisePane } from '../exercise-pane';
import type { SubmissionState } from '../types';

// ConjugationExercise uses the drill-action context; stub it so we don't need
// a full provider in this dispatcher-level test.
vi.mock('../drill-action-context', () => ({
  useDrillAction: () => ({ active: false, setPrimaryAction: vi.fn(), primaryAction: null }),
}));

const conjugationContent: ConjugationContent = {
  type: ExerciseType.CONJUGATION,
  instructions: 'Write the correct form.',
  lemma: 'ir',
  lemmaGloss: 'to go',
  featureBundle: 'condicional · 1ª persona del plural',
  targetForm: 'iríamos',
  breakdown: 'ir + íamos',
  exampleSentences: ['Si pudiéramos, iríamos contigo.'],
};

const conjugationExercise: ExerciseResponse = {
  id: 'ex-conj-1',
  type: ExerciseType.CONJUGATION,
  language: Language.ES,
  difficulty: 'B1',
  grammarPointKey: 'es-b1-conditional',
  contentJson: conjugationContent,
};

const idleSubmission: SubmissionState = { kind: 'idle' };

describe('ExercisePane — conjugation dispatch', () => {
  it('renders ConjugationExercise (lemma visible) when content type is conjugation', () => {
    render(
      <ExercisePane
        exercise={conjugationExercise}
        language={Language.ES}
        submission={idleSubmission}
        onSubmit={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    // ConjugationExercise renders the lemma in a display-s paragraph
    expect(screen.getByText('ir')).toBeInTheDocument();
    // Feature bundle is also shown
    expect(
      screen.getByText('condicional · 1ª persona del plural'),
    ).toBeInTheDocument();
  });

  it('does NOT render the unknown-exercise fallback for conjugation content', () => {
    render(
      <ExercisePane
        exercise={conjugationExercise}
        language={Language.ES}
        submission={idleSubmission}
        onSubmit={vi.fn()}
        onNext={vi.fn()}
      />,
    );
    expect(screen.queryByText('unknown exercise type')).not.toBeInTheDocument();
  });
});
