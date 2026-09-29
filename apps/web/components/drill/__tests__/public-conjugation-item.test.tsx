import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExerciseType, type ConjugationContent } from '@language-drill/shared';
import { PublicConjugationItem } from '../public-conjugation-item';

const content: ConjugationContent = {
  type: ExerciseType.CONJUGATION,
  instructions: 'Write the correct form.',
  lemma: 'gitmek',
  lemmaGloss: 'to go',
  featureBundle: 'geçmiş zaman · 3. tekil',
  targetForm: 'gitti',
  breakdown: 'git- + -ti',
  exampleSentences: ['Dün okula gitti.'],
};

function setup(overrides: Partial<React.ComponentProps<typeof PublicConjugationItem>> = {}) {
  const onSubmit = vi.fn();
  const onNext = vi.fn();
  render(
    <PublicConjugationItem
      content={content}
      language="TR"
      verdict={null}
      onSubmit={onSubmit}
      onNext={onNext}
      isLast={false}
      {...overrides}
    />,
  );
  return { onSubmit, onNext };
}

describe('PublicConjugationItem', () => {
  it('shows the lemma and its gloss', () => {
    setup();
    expect(screen.getByText('gitmek')).toBeInTheDocument();
    expect(screen.getByText('to go')).toBeInTheDocument();
  });

  it('does not reveal the target form before an answer', () => {
    setup();
    expect(screen.queryByText('gitti')).not.toBeInTheDocument();
  });

  it('submits the typed answer', async () => {
    const { onSubmit } = setup();
    await userEvent.type(screen.getByRole('textbox'), 'gitti');
    await userEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(onSubmit).toHaveBeenCalledWith('gitti');
  });

  it('will not submit an empty answer', async () => {
    const { onSubmit } = setup();
    await userEvent.click(screen.getByRole('button', { name: /submit/i }));
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('reveals the form, breakdown and examples once graded', () => {
    setup({ verdict: { correct: false } });
    expect(screen.getByText('gitti')).toBeInTheDocument();
    expect(screen.getByText('git- + -ti')).toBeInTheDocument();
    expect(screen.getByText('Dün okula gitti.')).toBeInTheDocument();
  });

  it('offers "see results" on the last item and "next" otherwise', () => {
    setup({ verdict: { correct: true }, isLast: true });
    expect(screen.getByRole('button', { name: /see results/i })).toBeInTheDocument();
  });
});
