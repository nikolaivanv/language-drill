import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import {
  ExerciseType,
  Language,
  type ConjugationContent,
} from '@language-drill/shared';
import {
  ConjugationExercise,
  type ConjugationExerciseProps,
  type SubmissionState,
} from '../conjugation-exercise';

const baseContent: ConjugationContent = {
  type: ExerciseType.CONJUGATION,
  instructions: 'Write the correct form.',
  lemma: 'ir',
  lemmaGloss: 'to go',
  featureBundle: 'condicional · 1ª persona del plural',
  targetForm: 'iríamos',
  breakdown: 'ir → iría- + -mos',
  exampleSentences: ['Iríamos al cine.'],
};

const evaluatedSubmission: SubmissionState = {
  kind: 'evaluated',
  result: {
    score: 0,
    grammarAccuracy: 0,
    vocabularyRange: 'B1',
    taskAchievement: 0,
    feedback: 'wrong person — you used the singular.',
    errors: [],
    estimatedCefrEvidence: 'B1',
  },
  meta: {},
};

function renderConj(overrides: Partial<ConjugationExerciseProps> = {}) {
  const props: ConjugationExerciseProps = {
    content: baseContent,
    language: Language.ES,
    submission: evaluatedSubmission,
    onSubmit: vi.fn(),
    onNext: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<ConjugationExercise {...props} />) };
}

describe('ConjugationExercise — answer draft', () => {
  beforeEach(() => window.sessionStorage.clear());
  it('restores a saved draft for its exercise id', () => {
    window.sessionStorage.setItem('drill:draft:ex-9', 'iríamos');
    renderConj({ exerciseId: 'ex-9', submission: { kind: 'idle' } });
    expect(screen.getByRole('textbox')).toHaveValue('iríamos');
  });
});

describe('ConjugationExercise — evaluated reveal', () => {
  it('reveals the target form and the evaluator feedback regardless of score', () => {
    renderConj();
    expect(screen.getByText('iríamos')).toBeInTheDocument();
    expect(
      screen.getByText('wrong person — you used the singular.'),
    ).toBeInTheDocument();
  });

  it('lists acceptable variants (excluding the target form) when present', () => {
    renderConj({
      content: {
        ...baseContent,
        targetForm: 'iríamos',
        acceptableForms: ['iríamos', 'iriamos'],
      },
    });
    expect(screen.getByText(/also accepted:/i)).toHaveTextContent(
      'also accepted: iriamos',
    );
  });

  it('omits the also-accepted line when there are no distinct variants', () => {
    renderConj({
      content: { ...baseContent, acceptableForms: ['iríamos'] },
    });
    expect(screen.queryByText(/also accepted:/i)).not.toBeInTheDocument();
  });
});

describe('ConjugationExercise — Enter submits', () => {
  it('submits on plain Enter in the input', () => {
    const onSubmit = vi.fn();
    renderConj({ onSubmit, submission: { kind: 'idle' } });
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'iríamos' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('iríamos', expect.anything());
  });
});
