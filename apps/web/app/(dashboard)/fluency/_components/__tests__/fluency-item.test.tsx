import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExerciseType, type ExerciseContent } from '@language-drill/shared';
import { FluencyItem } from '../fluency-item';

const cloze = {
  type: ExerciseType.CLOZE,
  instructions: 'x',
  sentence: 'Ahmet bugün ___ kalkar.',
  correctAnswer: 'erken',
  context: 'geniş zaman',
} as ExerciseContent;

const conjugation = {
  type: ExerciseType.CONJUGATION,
  instructions: 'x',
  lemma: 'gitmek',
  lemmaGloss: 'to go',
  featureBundle: 'geniş zaman · 1. tekil',
  targetForm: 'giderim',
  breakdown: 'git + er + im',
  exampleSentences: [],
} as ExerciseContent;

const noop = () => {};

describe('FluencyItem', () => {
  it('renders a cloze with its context eyebrow and an accent picker for TR', () => {
    render(
      <FluencyItem
        content={cloze}
        language="TR"
        elapsedMs={1200}
        verdict={null}
        onSubmit={noop}
        onNext={noop}
        isLast={false}
      />,
    );
    expect(screen.getByText('geniş zaman')).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'fill the blank' })).toBeInTheDocument();
    // accent picker exposes a shift toggle button
    expect(screen.getByRole('button', { name: 'uppercase' })).toBeInTheDocument();
  });

  it('renders a conjugation prompt (lemma + feature bundle), not an empty prompt', () => {
    render(
      <FluencyItem
        content={conjugation}
        language="TR"
        elapsedMs={0}
        verdict={null}
        onSubmit={noop}
        onNext={noop}
        isLast={false}
      />,
    );
    expect(screen.getByText('gitmek')).toBeInTheDocument();
    expect(screen.getByText('geniş zaman · 1. tekil')).toBeInTheDocument();
  });

  it('shows the verdict via FeedbackShell with the latency in the chip and the correct answer', () => {
    render(
      <FluencyItem
        content={cloze}
        language="TR"
        elapsedMs={4800}
        verdict={{ correct: false, correctAnswer: 'erken' }}
        onSubmit={noop}
        onNext={noop}
        isLast={false}
      />,
    );
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('not quite');
    expect(status).toHaveTextContent('4.8s');
    expect(status).toHaveTextContent('erken');
    expect(screen.getByRole('button', { name: 'next' })).toBeInTheDocument();
  });

  it('labels the advance button "finish" on the last item', () => {
    render(
      <FluencyItem
        content={cloze}
        language="TR"
        elapsedMs={1000}
        verdict={{ correct: true, correctAnswer: 'erken' }}
        onSubmit={noop}
        onNext={vi.fn()}
        isLast
      />,
    );
    expect(screen.getByRole('button', { name: 'finish' })).toBeInTheDocument();
  });
});

describe('FluencyItem — autofocus', () => {
  it('focuses the input when a fresh item is shown', () => {
    render(
      <FluencyItem
        content={cloze}
        language="TR"
        elapsedMs={0}
        verdict={null}
        onSubmit={noop}
        onNext={noop}
        isLast={false}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'fill the blank' })).toHaveFocus();
  });

  it('focuses the next item once it unlocks, even though the verdict lags by a render', () => {
    const cloze2 = {
      ...cloze,
      sentence: 'Bu film çok ___.',
      correctAnswer: 'uzun',
      context: 'sıfat',
    } as ExerciseContent;
    const correctVerdict = { correct: true, correctAnswer: 'erken' };

    const { rerender } = render(
      <FluencyItem
        content={cloze}
        language="TR"
        elapsedMs={0}
        verdict={null}
        onSubmit={noop}
        onNext={noop}
        isLast={false}
      />,
    );
    // Verdict for item 1.
    rerender(
      <FluencyItem
        content={cloze}
        language="TR"
        elapsedMs={1000}
        verdict={correctVerdict}
        onSubmit={noop}
        onNext={noop}
        isLast={false}
      />,
    );
    // Advance: item 2's content arrives while the old verdict still locks the
    // input (the runner clears the verdict one render later).
    rerender(
      <FluencyItem
        content={cloze2}
        language="TR"
        elapsedMs={1000}
        verdict={correctVerdict}
        onSubmit={noop}
        onNext={noop}
        isLast={false}
      />,
    );
    // Verdict clears; the input re-enables and should now receive focus.
    rerender(
      <FluencyItem
        content={cloze2}
        language="TR"
        elapsedMs={0}
        verdict={null}
        onSubmit={noop}
        onNext={noop}
        isLast={false}
      />,
    );
    expect(screen.getByRole('textbox', { name: 'fill the blank' })).toHaveFocus();
  });
});
