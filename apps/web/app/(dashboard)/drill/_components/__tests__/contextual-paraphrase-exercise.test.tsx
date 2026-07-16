import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExerciseType, Language, type ContextualParaphraseContent } from '@language-drill/shared';
import {
  ContextualParaphraseExercise,
  type ContextualParaphraseExerciseProps,
  type SubmissionState,
} from '../contextual-paraphrase-exercise';

const baseContent: ContextualParaphraseContent = {
  type: ExerciseType.CONTEXTUAL_PARAPHRASE,
  instructions: 'Rewrite the sentence.',
  sourceText: 'Me gusta mucho el café.',
  constraintKind: 'avoid',
  bannedTerms: ['gustar'],
  constraintLabel: 'Say this without using «gustar».',
  referenceParaphrases: ['Disfruto mucho del café.', 'Adoro el café.'],
};

const idle: SubmissionState = { kind: 'idle' };
const evaluated: SubmissionState = {
  kind: 'evaluated',
  result: { score: 0.8, grammarAccuracy: 0.8, vocabularyRange: 'B1', taskAchievement: 0.8, feedback: 'good', errors: [], estimatedCefrEvidence: 'B1' },
  meta: {},
};

function renderEx(overrides: Partial<ContextualParaphraseExerciseProps> = {}) {
  const props: ContextualParaphraseExerciseProps = {
    content: baseContent, language: Language.ES, submission: idle,
    onSubmit: vi.fn(), onNext: vi.fn(), ...overrides,
  };
  return { props, ...render(<ContextualParaphraseExercise {...props} />) };
}

describe('ContextualParaphraseExercise', () => {
  it('renders the source sentence and the constraint label', () => {
    renderEx();
    expect(screen.getByText('Me gusta mucho el café.')).toBeInTheDocument();
    expect(screen.getByText(/Say this without using/)).toBeInTheDocument();
  });
  it('shows banned terms for an avoid constraint', () => {
    renderEx();
    expect(screen.getByText('gustar')).toBeInTheDocument();
  });
  it('submits the typed paraphrase with hintCount 0', () => {
    const onSubmit = vi.fn();
    renderEx({ onSubmit });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'Adoro el café.' } });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(onSubmit).toHaveBeenCalledWith('Adoro el café.', expect.objectContaining({ hintCount: 0 }));
  });
  it('reveals a reference paraphrase and submits with hintCount 1', () => {
    const onSubmit = vi.fn();
    renderEx({ onSubmit });
    fireEvent.click(screen.getByRole('button', { name: /show an example/i }));
    expect(screen.getByText(/Disfruto mucho del café\./)).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(onSubmit).toHaveBeenCalledWith('x', expect.objectContaining({ hintCount: 1 }));
  });
  it('renders score + reference paraphrases when evaluated', () => {
    renderEx({ submission: evaluated });
    expect(screen.getByText('80%')).toBeInTheDocument();
    expect(screen.getByText('Disfruto mucho del café.')).toBeInTheDocument();
  });
});
