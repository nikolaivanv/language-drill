import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Language } from '@language-drill/shared';
import type { ReviewItem } from '@language-drill/api-client';
import { ClozeItem, blankSentence, type ClozeItemProps } from '../cloze-item';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseItem: ReviewItem = {
  stateId: '00000000-0000-0000-0000-0000000000a0',
  lemma: 'ev',
  language: Language.TR,
  itemType: 'cloze',
  gloss: 'house',
  pos: 'noun',
  cefr: 'A1',
  freqRank: 42,
  occurrence: {
    surface: 'evlerinden',
    sentence: 'Çocuklar evlerinden erkenden çıkarlar.',
    translation: 'The children leave their houses early.',
    source: 'Yedi İklim A1',
    contextualSense: 'their houses (ablative)',
    grammarPoints: ['ablative case'],
    morphology: {
      root: 'ev',
      rootGloss: 'house',
      segments: [
        { morph: 'ler', function: 'plural' },
        { morph: 'i', function: '3rd-person possessive' },
        { morph: 'nden', function: 'ablative' },
      ],
      whyThisForm: 'ablative plural with 3rd-person possessive',
    },
  },
};

function renderCloze(overrides: Partial<ClozeItemProps> = {}) {
  const props: ClozeItemProps = {
    item: baseItem,
    isLocked: false,
    isSubmitting: false,
    onSubmit: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<ClozeItem {...props} />) };
}

// ---------------------------------------------------------------------------
// blankSentence helper
// ---------------------------------------------------------------------------

describe('blankSentence', () => {
  it('splits around an exact surface match', () => {
    expect(blankSentence('Çocuklar evlerinden çıkar.', 'evlerinden')).toEqual({
      before: 'Çocuklar ',
      after: ' çıkar.',
      found: true,
    });
  });

  it('falls back to a case-insensitive match', () => {
    expect(blankSentence('Evlerinden çıkar.', 'evlerinden')).toEqual({
      before: '',
      after: ' çıkar.',
      found: true,
    });
  });

  it('returns found:false when the surface is absent', () => {
    expect(blankSentence('Tamamen farklı bir cümle.', 'evlerinden')).toEqual({
      before: 'Tamamen farklı bir cümle.',
      after: '',
      found: false,
    });
  });
});

// ---------------------------------------------------------------------------
// Rendering (Req 5.1)
// ---------------------------------------------------------------------------

describe('ClozeItem rendering', () => {
  it('renders the source attribution and translation', () => {
    renderCloze();
    expect(screen.getByText(/Yedi İklim A1/)).toBeInTheDocument();
    expect(
      screen.getByText('The children leave their houses early.'),
    ).toBeInTheDocument();
  });

  it('renders the sentence around a blank (surface not shown verbatim)', () => {
    renderCloze();
    expect(screen.getByText(/Çocuklar/)).toBeInTheDocument();
    expect(screen.getByText(/çıkarlar\./)).toBeInTheDocument();
    // The blanked surface must not appear as static text in the prompt.
    expect(screen.queryByText('Çocuklar evlerinden erkenden çıkarlar.')).toBeNull();
  });

  it('shows the tracked lemma in the slot hint', () => {
    renderCloze();
    expect(screen.getByText('ev')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Morphology hint (Req 5.3) + hint cap
// ---------------------------------------------------------------------------

describe('ClozeItem morphology hint', () => {
  it('hides the morphology breakdown until requested', () => {
    renderCloze();
    expect(screen.queryByText('3rd-person possessive')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show morphology/i })).toBeInTheDocument();
  });

  it('reveals the morphology segments when toggled', () => {
    renderCloze();
    fireEvent.click(screen.getByRole('button', { name: /show morphology/i }));
    // Morph tokens render as their own text node inside each chip.
    expect(screen.getByText('ler')).toBeInTheDocument();
    expect(screen.getByText('nden')).toBeInTheDocument();
    expect(
      screen.getByText('ablative plural with 3rd-person possessive'),
    ).toBeInTheDocument();
  });

  it('does not offer a morphology toggle when the occurrence has none', () => {
    const noMorph: ReviewItem = {
      ...baseItem,
      occurrence: { ...baseItem.occurrence!, morphology: undefined },
    };
    renderCloze({ item: noMorph });
    expect(screen.queryByRole('button', { name: /morphology/i })).not.toBeInTheDocument();
  });

  it('passes hintsUsed:1 after the morphology hint was viewed (rating cap)', () => {
    const onSubmit = vi.fn();
    const { container } = renderCloze({ onSubmit });
    fireEvent.click(screen.getByRole('button', { name: /show morphology/i }));
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'evlerinden' } });
    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(onSubmit).toHaveBeenCalledWith('evlerinden', { hintsUsed: 1 });
  });
});

// ---------------------------------------------------------------------------
// Submission (Req 5.2, 5.4)
// ---------------------------------------------------------------------------

describe('ClozeItem submission', () => {
  it('disables the check button until something is typed', () => {
    renderCloze();
    expect(screen.getByRole('button', { name: /check/i })).toBeDisabled();
  });

  it('submits the typed answer with hintsUsed:0 when no hint was used', () => {
    const onSubmit = vi.fn();
    const { container } = renderCloze({ onSubmit });
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'evlerinden' } });
    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(onSubmit).toHaveBeenCalledWith('evlerinden', { hintsUsed: 0 });
  });

  it('submits on Enter when an answer is present', () => {
    const onSubmit = vi.fn();
    const { container } = renderCloze({ onSubmit });
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'evler' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('evler', { hintsUsed: 0 });
  });

  it('does not submit on Enter when the field is empty', () => {
    const onSubmit = vi.fn();
    const { container } = renderCloze({ onSubmit });
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('"i don\'t know · reveal" submits an empty answer (graded Again)', () => {
    const onSubmit = vi.fn();
    renderCloze({ onSubmit });
    fireEvent.click(screen.getByRole('button', { name: /i don't know/i }));
    expect(onSubmit).toHaveBeenCalledWith('', { hintsUsed: 0 });
  });
});

// ---------------------------------------------------------------------------
// Locked / submitting state (Req 5.5 hand-off to feedback)
// ---------------------------------------------------------------------------

describe('ClozeItem locked state', () => {
  it('renders the input read-only and dimmed when locked', () => {
    const { container } = renderCloze({ isLocked: true });
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input).toHaveAttribute('readonly');
    expect(input).toBeDisabled();
    expect(input).toHaveClass('opacity-60');
  });

  it('disables both actions when locked', () => {
    renderCloze({ isLocked: true });
    expect(screen.getByRole('button', { name: /check/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /i don't know/i })).toBeDisabled();
  });

  it('shows a loading spinner on the check button while submitting', () => {
    const { container } = renderCloze({ isSubmitting: true });
    const checkBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-busy') === 'true',
    );
    expect(checkBtn).toBeDefined();
    expect(checkBtn?.querySelector('svg.animate-spin')).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Degraded occurrence (design error scenario 2)
// ---------------------------------------------------------------------------

describe('ClozeItem degraded occurrence', () => {
  it('renders a bare prompt when the surface is not found in the sentence', () => {
    const mismatched: ReviewItem = {
      ...baseItem,
      occurrence: {
        ...baseItem.occurrence!,
        surface: 'notinhere',
        morphology: undefined,
      },
    };
    renderCloze({ item: mismatched });
    // The full sentence is shown as-is rather than a broken blank.
    expect(screen.getByText('Çocuklar evlerinden erkenden çıkarlar.')).toBeInTheDocument();
  });

  it('renders accent picker for the language', () => {
    renderCloze();
    expect(
      screen.getByRole('button', { name: /insert ç/i }),
    ).toBeInTheDocument();
  });
});
