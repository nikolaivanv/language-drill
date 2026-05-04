import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExerciseType } from '@language-drill/shared';
import type { DebriefItem } from '@language-drill/api-client';
import { ReviewItemCard } from '../review-item-card';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleEvaluation = {
  score: 0.85,
  grammarAccuracy: 0.9,
  vocabularyRange: 'B1',
  taskAchievement: 0.8,
  feedback: 'Past hypothetical takes imperfect subjunctive.',
  errors: [],
  estimatedCefrEvidence: 'B1',
};

function clozeItem(overrides: Partial<DebriefItem> = {}): DebriefItem {
  return {
    exerciseId: '11111111-1111-4111-8111-111111111111',
    type: ExerciseType.CLOZE,
    contentJson: {
      type: ExerciseType.CLOZE,
      instructions: 'Fill in the blank',
      sentence: 'Si yo ___ más tiempo, viajaría a Japón.',
      correctAnswer: 'tuviera',
      topicHint: 'subjunctive',
    },
    status: 'incorrect',
    userAnswer: 'tenía',
    score: 0.4,
    evaluation: sampleEvaluation,
    ...overrides,
  };
}

function correctClozeItem(overrides: Partial<DebriefItem> = {}): DebriefItem {
  return clozeItem({
    status: 'correct',
    userAnswer: 'tuviera',
    score: 0.95,
    ...overrides,
  });
}

function skippedClozeItem(overrides: Partial<DebriefItem> = {}): DebriefItem {
  return clozeItem({
    status: 'skipped',
    userAnswer: null,
    score: null,
    evaluation: null,
    ...overrides,
  });
}

// ---------------------------------------------------------------------------
// Header chrome (Req 5.1)
// ---------------------------------------------------------------------------

describe('ReviewItemCard — header chrome', () => {
  it('renders the index as #N (1-based)', () => {
    render(<ReviewItemCard index={4} item={clozeItem()} />);
    expect(screen.getByText('#5')).toBeDefined();
  });

  it('renders the topic chip when topicHint is present', () => {
    render(<ReviewItemCard index={0} item={clozeItem()} />);
    expect(screen.getByText('subjunctive')).toBeDefined();
  });

  it('omits the topic chip when topicHint is missing', () => {
    const item = clozeItem({
      contentJson: {
        type: ExerciseType.CLOZE,
        instructions: 'Fill in',
        sentence: 'a ___ b',
        correctAnswer: 'foo',
      },
    });
    render(<ReviewItemCard index={0} item={item} />);
    expect(screen.queryByText('subjunctive')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Status chips (Req 5.2, 5.3, 5.4)
// ---------------------------------------------------------------------------

describe('ReviewItemCard — status chip', () => {
  it('renders sage "✓ correct" chip for status === correct', () => {
    render(<ReviewItemCard index={0} item={correctClozeItem()} />);
    expect(screen.getByText('✓ correct')).toBeDefined();
  });

  it('renders terracotta "✗ missed" chip for status === incorrect', () => {
    render(<ReviewItemCard index={0} item={clozeItem()} />);
    expect(screen.getByText('✗ missed')).toBeDefined();
  });

  it('renders paper "skipped" chip for status === skipped', () => {
    render(<ReviewItemCard index={0} item={skippedClozeItem()} />);
    expect(screen.getByText('skipped')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Default expand state (Req 5.9)
// ---------------------------------------------------------------------------

describe('ReviewItemCard — default expand state', () => {
  it('correct items collapse by default (no body content)', () => {
    render(<ReviewItemCard index={0} item={correctClozeItem()} />);
    // The body would render a "your answer" cell when expanded.
    expect(screen.queryByText('your answer')).toBeNull();
  });

  it('incorrect items expand by default', () => {
    render(<ReviewItemCard index={0} item={clozeItem()} />);
    expect(screen.getByText('your answer')).toBeDefined();
    expect(screen.getByText('corrected')).toBeDefined();
  });

  it('skipped items expand by default with the no-submission caption', () => {
    render(<ReviewItemCard index={0} item={skippedClozeItem()} />);
    expect(screen.getByText('skipped — no submission')).toBeDefined();
  });

  it('button has aria-expanded=false on a correct item', () => {
    render(<ReviewItemCard index={0} item={correctClozeItem()} />);
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
  });

  it('button has aria-expanded=true on an incorrect item', () => {
    render(<ReviewItemCard index={0} item={clozeItem()} />);
    expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('true');
  });
});

// ---------------------------------------------------------------------------
// Toggle expanded on click (Req 5.9)
// ---------------------------------------------------------------------------

describe('ReviewItemCard — toggle expanded on click', () => {
  it('clicking the header on a correct item expands the card', () => {
    render(<ReviewItemCard index={0} item={correctClozeItem()} />);
    expect(screen.queryByText('your answer')).toBeNull();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.getByText('your answer')).toBeDefined();
  });

  it('clicking the header on an incorrect item collapses the card', () => {
    render(<ReviewItemCard index={0} item={clozeItem()} />);
    expect(screen.getByText('your answer')).toBeDefined();
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByText('your answer')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Expand state does NOT persist across remounts (Req 5.9)
// ---------------------------------------------------------------------------

describe('ReviewItemCard — expand state lifetime', () => {
  it('expand state resets to initial when the component remounts', () => {
    // First mount of an incorrect item: starts expanded. Toggle to collapsed.
    const { unmount } = render(<ReviewItemCard index={0} item={clozeItem()} />);
    fireEvent.click(screen.getByRole('button'));
    expect(screen.queryByText('your answer')).toBeNull();
    unmount();

    // Re-mount: should re-derive initial state from props (incorrect → expanded).
    render(<ReviewItemCard index={0} item={clozeItem()} />);
    expect(screen.getByText('your answer')).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Cloze body — incorrect (Req 5.3, 5.5)
// ---------------------------------------------------------------------------

describe('ReviewItemCard — cloze incorrect body', () => {
  it('renders the user answer with strike-through styling', () => {
    const { container } = render(
      <ReviewItemCard index={0} item={clozeItem()} />,
    );
    // The user's fill is wrapped in a span with line-through textDecoration.
    const userFills = container.querySelectorAll(
      'span[style*="line-through"]',
    );
    expect(userFills.length).toBeGreaterThanOrEqual(1);
    // The user's answer text appears
    expect(container.textContent).toContain('tenía');
  });

  it('renders the reference answer in the corrected cell', () => {
    const { container } = render(
      <ReviewItemCard index={0} item={clozeItem()} />,
    );
    expect(container.textContent).toContain('tuviera');
    expect(screen.getByText('corrected')).toBeDefined();
  });

  it('renders the Claude evaluation feedback below the cells', () => {
    render(<ReviewItemCard index={0} item={clozeItem()} />);
    expect(
      screen.getByText('Past hypothetical takes imperfect subjunctive.'),
    ).toBeDefined();
  });

  it('renders both sentence parts (before and after the blank)', () => {
    const { container } = render(
      <ReviewItemCard index={0} item={clozeItem()} />,
    );
    expect(container.textContent).toContain('Si yo');
    expect(container.textContent).toContain('más tiempo, viajaría a Japón.');
  });
});

// ---------------------------------------------------------------------------
// Cloze body — correct (Req 5.2, 5.5)
// ---------------------------------------------------------------------------

describe('ReviewItemCard — cloze correct body', () => {
  it('renders the user fill in a sage tint without strike-through (when expanded)', () => {
    const { container } = render(
      <ReviewItemCard index={0} item={correctClozeItem()} />,
    );
    // Correct items collapse by default — click to expand.
    fireEvent.click(screen.getByRole('button'));
    // Look for a fill with sage background (--color-ok-soft)
    const fills = container.querySelectorAll(
      'span[style*="--color-ok-soft"]',
    );
    expect(fills.length).toBeGreaterThanOrEqual(1);
    // No strike-through styling on the correct fill
    const struckFills = container.querySelectorAll(
      'span[style*="line-through"]',
    );
    expect(struckFills.length).toBe(0);
  });

  it('shows "why it works" label instead of "corrected"', () => {
    render(<ReviewItemCard index={0} item={correctClozeItem()} />);
    fireEvent.click(screen.getByRole('button')); // expand
    expect(screen.getByText('why it works')).toBeDefined();
    expect(screen.queryByText('corrected')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Skipped body (Req 5.4)
// ---------------------------------------------------------------------------

describe('ReviewItemCard — skipped body', () => {
  it('renders the prompt sentence (with the blank as ___)', () => {
    render(<ReviewItemCard index={0} item={skippedClozeItem()} />);
    expect(
      screen.getByText('Si yo ___ más tiempo, viajaría a Japón.'),
    ).toBeDefined();
  });

  it('renders the "skipped — no submission" caption', () => {
    render(<ReviewItemCard index={0} item={skippedClozeItem()} />);
    expect(screen.getByText('skipped — no submission')).toBeDefined();
  });

  it('does NOT render the two-cell diff layout for skipped items', () => {
    render(<ReviewItemCard index={0} item={skippedClozeItem()} />);
    expect(screen.queryByText('your answer')).toBeNull();
    expect(screen.queryByText('corrected')).toBeNull();
    expect(screen.queryByText('why it works')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Theory trigger NOT rendered (Req 5.8)
// ---------------------------------------------------------------------------

describe('ReviewItemCard — no theory trigger', () => {
  it('does not render a theory trigger button anywhere in the card', () => {
    const { container } = render(
      <ReviewItemCard index={0} item={clozeItem()} />,
    );
    // The theory trigger uses a `theory-trigger` class and emits "show me theory" copy.
    expect(container.querySelector('.theory-trigger')).toBeNull();
    expect(container.textContent?.toLowerCase()).not.toContain('show me theory');
    expect(container.textContent?.toLowerCase()).not.toContain('show theory');
  });
});

// ---------------------------------------------------------------------------
// Translation body fixtures + tests (Req 5.6)
// ---------------------------------------------------------------------------

function translationItem(overrides: Partial<DebriefItem> = {}): DebriefItem {
  return {
    exerciseId: '22222222-2222-4222-8222-222222222222',
    type: ExerciseType.TRANSLATION,
    contentJson: {
      type: ExerciseType.TRANSLATION,
      instructions: 'Translate to Spanish',
      sourceText: "I'm starving",
      sourceLanguage: 'EN',
      targetLanguage: 'ES',
      referenceTranslation: 'tengo hambre',
    },
    status: 'incorrect',
    userAnswer: 'tengo hombre',
    score: 0.45,
    evaluation: {
      ...sampleEvaluation,
      feedback: 'Close — "hambre" not "hombre".',
    },
    ...overrides,
  };
}

describe('ReviewItemCard — translation body', () => {
  it('renders the source text as an italic prompt', () => {
    render(<ReviewItemCard index={0} item={translationItem()} />);
    expect(screen.getByText(/I'm starving/)).toBeDefined();
  });

  it('renders the user translation in the "your translation" cell', () => {
    render(<ReviewItemCard index={0} item={translationItem()} />);
    expect(screen.getByText('your translation')).toBeDefined();
    expect(screen.getByText('tengo hombre')).toBeDefined();
  });

  it('renders the reference translation with the "reference" label on incorrect', () => {
    render(<ReviewItemCard index={0} item={translationItem()} />);
    expect(screen.getByText('reference')).toBeDefined();
    expect(screen.getByText('tengo hambre')).toBeDefined();
  });

  it('renders the "one accepted form" label and no strike-through on correct', () => {
    const correct = translationItem({
      status: 'correct',
      userAnswer: 'tengo hambre',
      score: 0.95,
    });
    render(<ReviewItemCard index={0} item={correct} />);
    fireEvent.click(screen.getByRole('button')); // expand (correct collapses by default)
    expect(screen.getByText('one accepted form')).toBeDefined();
    expect(screen.queryByText('reference')).toBeNull();
  });

  it('renders Claude evaluation feedback below the cells when incorrect', () => {
    render(<ReviewItemCard index={0} item={translationItem()} />);
    expect(screen.getByText('Close — "hambre" not "hombre".')).toBeDefined();
  });

  it('user translation is strike-through on incorrect', () => {
    const { container } = render(
      <ReviewItemCard index={0} item={translationItem()} />,
    );
    const struck = container.querySelectorAll('div[style*="line-through"]');
    expect(struck.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Vocab body fixtures + tests (Req 5.7)
// ---------------------------------------------------------------------------

function vocabItem(overrides: Partial<DebriefItem> = {}): DebriefItem {
  return {
    exerciseId: '33333333-3333-4333-8333-333333333333',
    type: ExerciseType.VOCAB_RECALL,
    contentJson: {
      type: ExerciseType.VOCAB_RECALL,
      instructions: 'Recall the Spanish word',
      prompt: 'kitchen item, used for frying',
      expectedWord: 'sartén',
      hints: [],
      exampleSentence: 'Pongo el aceite en la sartén.',
    },
    status: 'incorrect',
    userAnswer: 'olla',
    score: 0.3,
    evaluation: {
      ...sampleEvaluation,
      feedback: '"olla" is a pot — sartén is a frying pan.',
    },
    ...overrides,
  };
}

describe('ReviewItemCard — vocab body', () => {
  it('renders the prompt definition as an italic line', () => {
    render(<ReviewItemCard index={0} item={vocabItem()} />);
    expect(screen.getByText(/kitchen item, used for frying/)).toBeDefined();
  });

  it('renders "you typed" cell with the user\'s answer', () => {
    render(<ReviewItemCard index={0} item={vocabItem()} />);
    expect(screen.getByText('you typed')).toBeDefined();
    expect(screen.getByText('olla')).toBeDefined();
  });

  it('renders "target word" cell with expectedWord and the example sentence', () => {
    render(<ReviewItemCard index={0} item={vocabItem()} />);
    expect(screen.getByText('target word')).toBeDefined();
    expect(screen.getByText('sartén')).toBeDefined();
    expect(screen.getByText('Pongo el aceite en la sartén.')).toBeDefined();
  });

  it('renders Claude evaluation feedback below the cells when incorrect', () => {
    render(<ReviewItemCard index={0} item={vocabItem()} />);
    expect(
      screen.getByText('"olla" is a pot — sartén is a frying pan.'),
    ).toBeDefined();
  });

  it('user word is shown without strike-through on correct', () => {
    const correct = vocabItem({
      status: 'correct',
      userAnswer: 'sartén',
      score: 0.95,
    });
    const { container } = render(<ReviewItemCard index={0} item={correct} />);
    fireEvent.click(screen.getByRole('button')); // expand
    const struck = container.querySelectorAll('div[style*="line-through"]');
    expect(struck.length).toBe(0);
  });

  it('omits the example sentence when exampleSentence is empty', () => {
    const item = vocabItem({
      contentJson: {
        type: ExerciseType.VOCAB_RECALL,
        instructions: 'Recall',
        prompt: 'kitchen item',
        expectedWord: 'sartén',
        hints: [],
        exampleSentence: '',
      },
    });
    const { container } = render(<ReviewItemCard index={0} item={item} />);
    // Empty example should not render
    expect(container.textContent).not.toContain('Pongo el aceite');
  });
});
