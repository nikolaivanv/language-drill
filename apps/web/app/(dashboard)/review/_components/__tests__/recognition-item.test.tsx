import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Language } from '@language-drill/shared';
import type { ReviewItem } from '@language-drill/api-client';
import {
  RecognitionItem,
  buildRecognitionChoices,
  type RecognitionItemProps,
} from '../recognition-item';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseItem: ReviewItem = {
  stateId: '00000000-0000-0000-0000-0000000000c0',
  lemma: 'imprescindible',
  language: Language.ES,
  itemType: 'recognition',
  gloss: 'essential',
  pos: 'adjective',
  cefr: 'B2',
  freqRank: 4200,
  occurrence: null,
};

const distractors = ['unavoidable', 'temporary', 'expensive', 'rare'];

function renderRecognition(overrides: Partial<RecognitionItemProps> = {}) {
  const props: RecognitionItemProps = {
    item: baseItem,
    distractors,
    isLocked: false,
    isSubmitting: false,
    onSubmit: vi.fn(),
    ...overrides,
  };
  return { props, ...render(<RecognitionItem {...props} />) };
}

// ---------------------------------------------------------------------------
// buildRecognitionChoices
// ---------------------------------------------------------------------------

describe('buildRecognitionChoices', () => {
  it('always includes the correct gloss and caps at four options', () => {
    const choices = buildRecognitionChoices('essential', distractors, 'seed');
    expect(choices).toContain('essential');
    expect(choices).toHaveLength(4); // 1 correct + 3 distractors
  });

  it('drops distractors equal to the correct gloss and dedupes', () => {
    const choices = buildRecognitionChoices(
      'essential',
      ['essential', 'unavoidable', 'unavoidable', 'rare'],
      'seed',
    );
    expect(choices.filter((c) => c === 'essential')).toHaveLength(1);
    expect(choices.filter((c) => c === 'unavoidable')).toHaveLength(1);
  });

  it('is deterministic for a given seed but varies across seeds', () => {
    const a1 = buildRecognitionChoices('essential', distractors, 'seedA');
    const a2 = buildRecognitionChoices('essential', distractors, 'seedA');
    expect(a1).toEqual(a2);
    // Same membership regardless of seed.
    const b = buildRecognitionChoices('essential', distractors, 'seedZ');
    expect([...a1].sort()).toEqual([...b].sort());
  });

  it('degrades to just the correct gloss when no distractors exist', () => {
    expect(buildRecognitionChoices('essential', [], 'seed')).toEqual(['essential']);
  });
});

// ---------------------------------------------------------------------------
// Rendering (Req 7.1)
// ---------------------------------------------------------------------------

describe('RecognitionItem rendering', () => {
  it('shows the word and POS · CEFR', () => {
    renderRecognition();
    expect(screen.getByText('imprescindible')).toBeInTheDocument();
    expect(screen.getByText('adjective · B2')).toBeInTheDocument();
  });

  it('renders the correct gloss plus distractors as radio options', () => {
    renderRecognition();
    const radios = screen.getAllByRole('radio');
    expect(radios).toHaveLength(4);
    expect(screen.getByText('essential')).toBeInTheDocument();
    expect(screen.getByText('unavoidable')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Selection + submission (Req 7.1, 7.3)
// ---------------------------------------------------------------------------

describe('RecognitionItem selection & submission', () => {
  it('disables check until an option is selected', () => {
    renderRecognition();
    expect(screen.getByRole('button', { name: /check/i })).toBeDisabled();
  });

  it('marks the clicked option as selected (aria-checked)', () => {
    renderRecognition();
    const option = screen.getByText('essential').closest('button')!;
    fireEvent.click(option);
    expect(option).toHaveAttribute('aria-checked', 'true');
  });

  it('submits the selected gloss with hintsUsed:0', () => {
    const onSubmit = vi.fn();
    renderRecognition({ onSubmit });
    fireEvent.click(screen.getByText('essential').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(onSubmit).toHaveBeenCalledWith('essential', { hintsUsed: 0 });
  });

  it('submits the selected distractor verbatim (server grades it incorrect)', () => {
    const onSubmit = vi.fn();
    renderRecognition({ onSubmit });
    fireEvent.click(screen.getByText('temporary').closest('button')!);
    fireEvent.click(screen.getByRole('button', { name: /check/i }));
    expect(onSubmit).toHaveBeenCalledWith('temporary', { hintsUsed: 0 });
  });

  it('"i don\'t know · reveal" submits an empty answer (graded Again)', () => {
    const onSubmit = vi.fn();
    renderRecognition({ onSubmit });
    fireEvent.click(screen.getByRole('button', { name: /i don't know/i }));
    expect(onSubmit).toHaveBeenCalledWith('', { hintsUsed: 0 });
  });
});

// ---------------------------------------------------------------------------
// Locked / submitting state
// ---------------------------------------------------------------------------

describe('RecognitionItem locked state', () => {
  it('disables actions when locked', () => {
    renderRecognition({ isLocked: true });
    expect(screen.getByRole('button', { name: /check/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /i don't know/i })).toBeDisabled();
  });

  it('shows a loading spinner on the check button while submitting', () => {
    const { container } = renderRecognition({ isSubmitting: true });
    const checkBtn = Array.from(container.querySelectorAll('button')).find(
      (b) => b.getAttribute('aria-busy') === 'true',
    );
    expect(checkBtn).toBeDefined();
    expect(checkBtn?.querySelector('svg.animate-spin')).not.toBeNull();
  });
});
