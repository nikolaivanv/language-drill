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

// A distinct content object (different lemma/target) for the "new item"
// re-render test — must not be reference-equal to `content`.
const secondContent: ConjugationContent = {
  type: ExerciseType.CONJUGATION,
  instructions: 'Write the correct form.',
  lemma: 'gelmek',
  lemmaGloss: 'to come',
  featureBundle: 'geçmiş zaman · 3. tekil',
  targetForm: 'geldi',
  breakdown: 'gel- + -di',
  exampleSentences: ['Dün eve geldi.'],
};

function setup(overrides: Partial<React.ComponentProps<typeof PublicConjugationItem>> = {}) {
  const onSubmit = vi.fn();
  const onNext = vi.fn();
  const utils = render(
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
  return { onSubmit, onNext, ...utils };
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

  it('offers "see results" on the last item', () => {
    setup({ verdict: { correct: true }, isLast: true });
    expect(screen.getByRole('button', { name: /see results/i })).toBeInTheDocument();
  });

  it('offers "next" when it is not the last item', () => {
    setup({ verdict: { correct: true }, isLast: false });
    expect(screen.getByRole('button', { name: /^next$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /see results/i })).not.toBeInTheDocument();
  });

  it('has an accessible name on the answer input, reachable via its label', () => {
    setup();
    // Queries by accessible name (aria-label), not by role alone — a stranger
    // landing on the public page with a screen reader has no other context.
    const input = screen.getByLabelText(/answer/i);
    expect(input).toBeInTheDocument();
    expect(input).toBe(screen.getByRole('textbox'));
  });

  it('submits the typed answer on Enter', async () => {
    const { onSubmit } = setup();
    await userEvent.type(screen.getByRole('textbox'), 'gitti{Enter}');
    expect(onSubmit).toHaveBeenCalledWith('gitti');
  });

  it('locks the input once graded', () => {
    setup({ verdict: { correct: false } });
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('focuses the advance control once graded, so keyboard flow continues without tabbing', () => {
    // The parent flips `locked` by passing a new `verdict` prop — `locked` is
    // derived, not local state — so a rerender with a graded verdict is what
    // the real grading flow produces.
    const { rerender } = setup({ verdict: null });

    rerender(
      <PublicConjugationItem
        content={content}
        language="TR"
        verdict={{ correct: true }}
        onSubmit={vi.fn()}
        onNext={vi.fn()}
        isLast={false}
      />,
    );

    expect(screen.getByRole('button', { name: /^next$/i })).toHaveFocus();
  });

  it('clears the answer and refocuses the input for a new item', async () => {
    const { rerender } = setup();
    const input = screen.getByRole('textbox') as HTMLInputElement;
    await userEvent.type(input, 'partial');
    expect(input).toHaveValue('partial');

    // Move focus elsewhere first. The same <input> DOM node persists across
    // the rerender (React reconciles it in place), so if we didn't blur here,
    // this assertion would pass trivially just because nothing ever moved
    // focus away — it wouldn't distinguish "the effect refocused it" from
    // "focus was never disturbed". Blurring makes the refocus observable.
    const elsewhere = document.createElement('button');
    document.body.appendChild(elsewhere);
    elsewhere.focus();
    expect(input).not.toHaveFocus();

    rerender(
      <PublicConjugationItem
        content={secondContent}
        language="TR"
        verdict={null}
        onSubmit={vi.fn()}
        onNext={vi.fn()}
        isLast={false}
      />,
    );

    expect(input).toHaveValue('');
    expect(document.activeElement).toBe(input);
    expect(input).toHaveFocus();
    elsewhere.remove();
  });

  // The typed form is still visible in the cell, so restating it as "the
  // answer" when it matched exactly is noise. It stays for a wrong answer, and
  // for a right one reached via an accepted variant, where the canonical form
  // is genuinely new information.
  it('does not repeat the target form when the typed answer matched it exactly', async () => {
    const onSubmit = vi.fn();
    const { rerender } = render(
      <PublicConjugationItem
        content={content}
        language="TR"
        verdict={null}
        onSubmit={onSubmit}
        onNext={vi.fn()}
        isLast={false}
      />,
    );
    await userEvent.type(screen.getByRole('textbox'), 'gitti');
    await userEvent.click(screen.getByRole('button', { name: /submit/i }));

    rerender(
      <PublicConjugationItem
        content={content}
        language="TR"
        verdict={{ correct: true }}
        onSubmit={onSubmit}
        onNext={vi.fn()}
        isLast={false}
      />,
    );
    // The breakdown and example still appear; only the duplicated form is gone.
    expect(screen.getByText('git- + -ti')).toBeInTheDocument();
    expect(screen.queryByText('gitti')).not.toBeInTheDocument();
  });

  it('still shows the target form when the answer was wrong', async () => {
    render(
      <PublicConjugationItem
        content={content}
        language="TR"
        verdict={{ correct: false }}
        onSubmit={vi.fn()}
        onNext={vi.fn()}
        isLast={false}
      />,
    );
    expect(screen.getByText('gitti')).toBeInTheDocument();
  });
});
