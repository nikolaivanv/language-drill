import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Language } from '@language-drill/shared';
import type { ReviewItem } from '@language-drill/api-client';
import { MeaningItem, maskSurface, type MeaningItemProps } from '../meaning-item';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseItem: ReviewItem = {
  stateId: '00000000-0000-0000-0000-0000000000b0',
  lemma: 'apenas',
  language: Language.ES,
  itemType: 'meaning',
  gloss: 'barely, hardly',
  pos: 'adverb',
  cefr: 'B1',
  freqRank: 1840,
  occurrence: {
    surface: 'Apenas',
    sentence: 'Apenas podía oírlo sobre el ruido.',
    translation: 'He could barely hear it over the noise.',
    source: 'saved card',
    contextualSense: 'scarcely / only just',
    grammarPoints: [],
  },
};

// Context-independent variant: no usable occurrence (item-select fallback).
const noOccurrenceItem: ReviewItem = { ...baseItem, occurrence: null };

function renderMeaning(overrides: Partial<MeaningItemProps> = {}) {
  const props: MeaningItemProps = {
    item: baseItem,
    isLocked: false,
    isSubmitting: false,
    onSubmit: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<MeaningItem {...props} />) };
}

// ---------------------------------------------------------------------------
// maskSurface helper
// ---------------------------------------------------------------------------

describe('maskSurface', () => {
  it('blanks every case-insensitive occurrence of the surface', () => {
    expect(maskSurface('Apenas podía; apenas más.', 'apenas')).toBe('___ podía; ___ más.');
  });

  it('returns the sentence unchanged when surface is empty', () => {
    expect(maskSurface('sin cambios.', '')).toBe('sin cambios.');
  });
});

// ---------------------------------------------------------------------------
// Rendering (Req 6.1)
// ---------------------------------------------------------------------------

describe('MeaningItem rendering', () => {
  it('shows the contextual sense as the prompt', () => {
    renderMeaning();
    expect(screen.getByText(/scarcely \/ only just/)).toBeInTheDocument();
  });

  it('falls back to the dictionary gloss when there is no occurrence', () => {
    renderMeaning({ item: noOccurrenceItem });
    expect(screen.getByText(/barely, hardly/)).toBeInTheDocument();
  });

  it('renders POS · CEFR · frequency', () => {
    renderMeaning();
    expect(screen.getByText('adverb · B1 · freq #1840')).toBeInTheDocument();
  });

  it('does not reveal the target word before any hint', () => {
    renderMeaning();
    // The lemma must not be shown as a static node up front.
    expect(screen.queryByText('apenas')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Progressive hints (Req 6.3)
// ---------------------------------------------------------------------------

describe('MeaningItem progressive hints', () => {
  it('reveals first letter, then letter count, then blanked example in order', () => {
    renderMeaning();

    // Level 1 — first letter
    fireEvent.click(screen.getByRole('button', { name: /first letter/i }));
    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.queryByText('6 letters')).not.toBeInTheDocument();

    // Level 2 — letter count
    fireEvent.click(screen.getByRole('button', { name: /letter count/i }));
    expect(screen.getByText('6 letters')).toBeInTheDocument();

    // Level 3 — blanked example (surface masked)
    fireEvent.click(screen.getByRole('button', { name: /blanked example/i }));
    expect(screen.getByText('___ podía oírlo sobre el ruido.')).toBeInTheDocument();
  });

  it('caps hints at letter count (level 2) when there is no example sentence', () => {
    renderMeaning({ item: noOccurrenceItem });
    fireEvent.click(screen.getByRole('button', { name: /first letter/i }));
    fireEvent.click(screen.getByRole('button', { name: /letter count/i }));
    // No further hint button once level 2 is reached without an example.
    expect(screen.queryByRole('button', { name: /hint/i })).not.toBeInTheDocument();
  });

  it('passes the reached hint level as hintsUsed on submit', () => {
    const onSubmit = vi.fn();
    const { container } = renderMeaning({ onSubmit });
    fireEvent.click(screen.getByRole('button', { name: /first letter/i }));
    fireEvent.click(screen.getByRole('button', { name: /letter count/i }));
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'apenas' } });
    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(onSubmit).toHaveBeenCalledWith('apenas', { hintsUsed: 2 });
  });
});

// ---------------------------------------------------------------------------
// Submission (Req 6.2, 6.5)
// ---------------------------------------------------------------------------

describe('MeaningItem submission', () => {
  it('disables the check button until something is typed', () => {
    renderMeaning();
    expect(screen.getByRole('button', { name: /check/i })).toBeDisabled();
  });

  it('submits the typed answer with hintsUsed:0 when no hint was used', () => {
    const onSubmit = vi.fn();
    const { container } = renderMeaning({ onSubmit });
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'apenas' } });
    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(onSubmit).toHaveBeenCalledWith('apenas', { hintsUsed: 0 });
  });

  it('submits on Enter when an answer is present', () => {
    const onSubmit = vi.fn();
    const { container } = renderMeaning({ onSubmit });
    const input = container.querySelector('input') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'apenas' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('apenas', { hintsUsed: 0 });
  });

  it('"i don\'t know · reveal" submits an empty answer (graded Again)', () => {
    const onSubmit = vi.fn();
    renderMeaning({ onSubmit });
    fireEvent.click(screen.getByRole('button', { name: /i don't know/i }));
    expect(onSubmit).toHaveBeenCalledWith('', { hintsUsed: 0 });
  });
});

// ---------------------------------------------------------------------------
// Accent picker (Req 6.4) + locked state
// ---------------------------------------------------------------------------

describe('MeaningItem accent picker & locked state', () => {
  it('renders the accent picker for the language', () => {
    renderMeaning();
    expect(screen.getByRole('button', { name: /insert á/i })).toBeInTheDocument();
  });

  it('renders the input read-only and dimmed when locked', () => {
    const { container } = renderMeaning({ isLocked: true });
    const input = container.querySelector('input') as HTMLInputElement;
    expect(input).toHaveAttribute('readonly');
    expect(input).toBeDisabled();
    expect(input).toHaveClass('opacity-60');
  });

  it('disables actions when locked', () => {
    renderMeaning({ isLocked: true });
    expect(screen.getByRole('button', { name: /check/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /i don't know/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /first letter/i })).toBeDisabled();
  });

  it('shows a loading spinner on the check button while submitting', () => {
    const { container } = renderMeaning({ isSubmitting: true });
    const checkBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-busy') === 'true',
    );
    expect(checkBtn).toBeDefined();
    expect(checkBtn?.querySelector('svg.animate-spin')).not.toBeNull();
  });
});
