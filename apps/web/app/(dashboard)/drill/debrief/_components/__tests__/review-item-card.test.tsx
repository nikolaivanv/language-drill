import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ExerciseType } from '@language-drill/shared';
import type { DebriefItem } from '@language-drill/api-client';

const mockMutate = vi.fn();
const mockUseFlagExercise = vi.fn((_args?: unknown) => ({
  mutate: mockMutate,
  isPending: false,
  isSuccess: false,
  isError: false,
}));
vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/api-client')>('@language-drill/api-client');
  return { ...actual, useFlagExercise: (args: unknown) => mockUseFlagExercise(args) };
});

import { ReviewItemCard } from '../review-item-card';

const fetchFn = vi.fn();

beforeEach(() => {
  mockMutate.mockReset();
  mockUseFlagExercise.mockClear();
});

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
    submissionId: '99999999-1111-4111-8111-111111111111',
    type: ExerciseType.CLOZE,
    grammarPointKey: null,
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
    submissionId: null,
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

  it('omits the second cell on a correct answer (no empty "corrected"/"why it works" box)', () => {
    render(<ReviewItemCard index={0} item={correctClozeItem()} />);
    fireEvent.click(screen.getByRole('button')); // expand
    expect(screen.queryByText('corrected')).toBeNull();
    expect(screen.queryByText('why it works')).toBeNull();
    // The explanation still appears as the evaluator's feedback prose below.
    expect(
      screen.getByText('Past hypothetical takes imperfect subjunctive.'),
    ).toBeInTheDocument();
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
// Canonical breakpoint reconciliation (Req 7.4, 1.6)
// ---------------------------------------------------------------------------

describe('ReviewItemCard — diff grid uses the canonical breakpoint', () => {
  it('renders the two-cell diff at 1-col ≤760 / 2-col above (no ad-hoc md:)', () => {
    const { container } = render(
      <ReviewItemCard index={0} item={clozeItem()} />,
    );
    // The incorrect cloze body is expanded by default and holds the diff grid.
    const grid = container.querySelector('.grid');
    expect(grid).not.toBeNull();
    expect(grid).toHaveClass('grid-cols-2', 'mobile:grid-cols-1');
    expect(grid).not.toHaveClass('md:grid-cols-2');
  });
});

// ---------------------------------------------------------------------------
// Translation body fixtures + tests (Req 5.6)
// ---------------------------------------------------------------------------

function translationItem(overrides: Partial<DebriefItem> = {}): DebriefItem {
  return {
    exerciseId: '22222222-2222-4222-8222-222222222222',
    submissionId: '22222222-2222-4222-8222-aaaaaaaaaaaa',
    type: ExerciseType.TRANSLATION,
    grammarPointKey: null,
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
    submissionId: '33333333-3333-4333-8333-aaaaaaaaaaaa',
    type: ExerciseType.VOCAB_RECALL,
    grammarPointKey: null,
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

// ---------------------------------------------------------------------------
// Sentence construction body fixtures + tests (Req 5.10)
// ---------------------------------------------------------------------------

function sentenceConstructionItem(overrides: Partial<DebriefItem> = {}): DebriefItem {
  return {
    exerciseId: '44444444-4444-4444-8444-444444444444',
    submissionId: '44444444-4444-4444-8444-aaaaaaaaaaaa',
    type: ExerciseType.SENTENCE_CONSTRUCTION,
    grammarPointKey: null,
    contentJson: {
      type: ExerciseType.SENTENCE_CONSTRUCTION,
      instructions: 'Write a sentence using the given words',
      promptMode: 'keywords',
      prompt: 'Use: correr, parque, mañana',
      keywords: ['correr', 'parque', 'mañana'],
      modelAnswers: [
        'Voy a correr en el parque mañana.',
        'Mañana correré en el parque.',
      ],
      topicHint: 'future tense',
    },
    status: 'incorrect',
    userAnswer: 'Yo correr en parque mañana.',
    score: 0.4,
    evaluation: {
      ...sampleEvaluation,
      feedback: 'Use the conjugated verb form, not the infinitive.',
    },
    ...overrides,
  };
}

describe('ReviewItemCard — sentence construction body', () => {
  it('renders the prompt as an italic line', () => {
    render(<ReviewItemCard index={0} item={sentenceConstructionItem()} />);
    expect(screen.getByText(/Use: correr, parque, mañana/)).toBeDefined();
  });

  it('renders the "your sentence" cell with the user\'s answer', () => {
    render(<ReviewItemCard index={0} item={sentenceConstructionItem()} />);
    expect(screen.getByText('your sentence')).toBeDefined();
    expect(screen.getByText('Yo correr en parque mañana.')).toBeDefined();
  });

  it('renders the first model answer in the reference cell on incorrect', () => {
    render(<ReviewItemCard index={0} item={sentenceConstructionItem()} />);
    expect(screen.getByText('reference')).toBeDefined();
    expect(screen.getByText('Voy a correr en el parque mañana.')).toBeDefined();
  });

  it('renders additional model answers in the "e.g. …" muted line', () => {
    const { container } = render(
      <ReviewItemCard index={0} item={sentenceConstructionItem()} />,
    );
    expect(container.textContent).toContain('e.g. Mañana correré en el parque.');
  });

  it('renders "one accepted form" label on correct instead of "reference"', () => {
    const correct = sentenceConstructionItem({
      status: 'correct',
      userAnswer: 'Voy a correr en el parque mañana.',
      score: 0.95,
    });
    render(<ReviewItemCard index={0} item={correct} />);
    fireEvent.click(screen.getByRole('button')); // expand (correct collapses by default)
    expect(screen.getByText('one accepted form')).toBeDefined();
    expect(screen.queryByText('reference')).toBeNull();
  });

  it('renders Claude evaluation feedback below the cells when incorrect', () => {
    render(<ReviewItemCard index={0} item={sentenceConstructionItem()} />);
    expect(
      screen.getByText('Use the conjugated verb form, not the infinitive.'),
    ).toBeDefined();
  });

  it('user sentence is strike-through on incorrect', () => {
    const { container } = render(
      <ReviewItemCard index={0} item={sentenceConstructionItem()} />,
    );
    const struck = container.querySelectorAll('div[style*="line-through"]');
    expect(struck.length).toBeGreaterThanOrEqual(1);
  });

  it('user sentence has no strike-through on correct (when expanded)', () => {
    const correct = sentenceConstructionItem({
      status: 'correct',
      userAnswer: 'Voy a correr en el parque mañana.',
      score: 0.95,
    });
    const { container } = render(<ReviewItemCard index={0} item={correct} />);
    fireEvent.click(screen.getByRole('button')); // expand
    const struck = container.querySelectorAll('div[style*="line-through"]');
    expect(struck.length).toBe(0);
  });

  it('omits the "e.g." line when there is only one model answer', () => {
    const item = sentenceConstructionItem({
      contentJson: {
        type: ExerciseType.SENTENCE_CONSTRUCTION,
        instructions: 'Write a sentence',
        promptMode: 'keywords',
        prompt: 'Use: correr, parque',
        keywords: ['correr', 'parque'],
        modelAnswers: ['Corro en el parque.'],
      },
    });
    const { container } = render(<ReviewItemCard index={0} item={item} />);
    expect(container.textContent).not.toContain('e.g.');
  });
});

// ---------------------------------------------------------------------------
// Conjugation body — target form + acceptable variants
// ---------------------------------------------------------------------------

function conjugationItem(acceptableForms?: string[]): DebriefItem {
  return {
    exerciseId: '55555555-5555-4555-8555-aaaaaaaaaaaa',
    submissionId: '66666666-6666-4666-8666-aaaaaaaaaaaa',
    type: ExerciseType.CONJUGATION,
    grammarPointKey: null,
    contentJson: {
      type: ExerciseType.CONJUGATION,
      instructions: 'Write the correct form.',
      lemma: 'ir',
      lemmaGloss: 'to go',
      featureBundle: 'condicional · 1ª persona del plural',
      targetForm: 'iríamos',
      breakdown: 'ir → iría- + -mos',
      exampleSentences: ['Iríamos al cine.'],
      ...(acceptableForms ? { acceptableForms } : {}),
    },
    status: 'incorrect',
    userAnswer: 'iría',
    score: 0,
    evaluation: sampleEvaluation,
  };
}

describe('ReviewItemCard — conjugation body', () => {
  it('lists acceptable variants (excluding the target form) when present', () => {
    render(
      <ReviewItemCard
        index={0}
        item={conjugationItem(['iríamos', 'iriamos'])}
      />,
    );
    expect(screen.getByText(/also accepted:/i)).toHaveTextContent(
      'also accepted: iriamos',
    );
  });

  it('omits the also-accepted line when there are no distinct variants', () => {
    render(<ReviewItemCard index={0} item={conjugationItem(['iríamos'])} />);
    expect(screen.queryByText(/also accepted:/i)).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Conjugation body — inline structured feature bundle (Task 6)
// ---------------------------------------------------------------------------

function structuredConjugationItem(overrides: Partial<DebriefItem> = {}): DebriefItem {
  return {
    exerciseId: '55555555-5555-4555-8555-555555555555',
    submissionId: '55555555-5555-4555-8555-bbbbbbbbbbbb',
    type: ExerciseType.CONJUGATION,
    grammarPointKey: 'tr-b1-past-simple',
    contentJson: {
      type: ExerciseType.CONJUGATION,
      instructions: 'Write the correct form.',
      lemma: 'içmek',
      lemmaGloss: 'to drink',
      featureBundle: 'geçmiş zaman · olumlu · o',
      features: [
        { term: 'geçmiş zaman', gloss: 'past' },
        { term: 'olumlu', gloss: 'affirmative' },
      ],
      subject: { pronoun: 'o', gloss: 'he / she / it' },
      targetForm: 'içti',
      breakdown: 'iç + ti',
      exampleSentences: ['O su içti.'],
    },
    status: 'incorrect',
    userAnswer: 'içdi',
    score: 0.3,
    evaluation: {
      ...sampleEvaluation,
      feedback: 'The past tense suffix is -ti after voiceless consonants.',
    },
    ...overrides,
  };
}

describe('ReviewItemCard — conjugation body (inline feature bundle)', () => {
  it('renders the inline glossed string with pronoun and features', () => {
    render(<ReviewItemCard index={0} item={structuredConjugationItem()} />);
    // The ConjugationFeatureBundle inline variant renders: "o (he / she / it) · geçmiş zaman (past) · …"
    expect(
      screen.getByText(/o \(he \/ she \/ it\) · geçmiş zaman \(past\)/),
    ).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Dictation body — clip replay + stored diff / score / criteria
// ---------------------------------------------------------------------------

describe('ReviewItemCard — dictation body', () => {
  const dictContent = {
    type: 'dictation',
    title: 'El tiempo',
    referenceText: 'el tiempo lo cura todo',
    sentences: ['el tiempo lo cura todo'],
    accent: 'es',
    voiceId: 'Sergio',
    tested: ['sinalefa'],
    durationSec: 6,
    waveform: [0.5, 0.6],
    audioUrl: 'https://signed/clip.mp3',
  };
  const dictEval = {
    kind: 'dictation',
    score: 0.82,
    grammarAccuracy: 0.82,
    vocabularyRange: 'B1',
    taskAchievement: 0.9,
    feedback: 'f',
    errors: [],
    estimatedCefrEvidence: 'B1',
    rawCharAccuracy: 0.8,
    adjustedCharAccuracy: 0.82,
    wordAccuracy: 0.9,
    listeningCefr: 'B1',
    headline: 'Casi',
    summary: 's',
    diff: [{ kind: 'match', text: 'el tiempo' }],
    differences: [
      { id: 1, kind: 'error', category: 'word boundary', severity: 'high', got: 'locura', expected: 'lo cura', note: 'n' },
    ],
    criteria: [{ id: 'phon', label: 'Phoneme discrimination', score: 0.8, cefr: 'B1', note: 'n' }],
  };
  const dictItem = (over = {}) => ({
    exerciseId: '11111111-1111-1111-1111-111111111111',
    type: ExerciseType.DICTATION,
    grammarPointKey: 'es-b1-dictation',
    contentJson: dictContent,
    status: 'incorrect',
    userAnswer: 'el tiempo locura todo',
    score: 0.82,
    evaluation: dictEval,
    ...over,
  });

  it('renders the dictation body: diff/criteria + an audio element', () => {
    const { container } = render(<ReviewItemCard index={0} item={dictItem() as never} />);
    expect(screen.getByText('Casi')).toBeInTheDocument(); // result headline surfaced
    expect(screen.getByText('word boundary')).toBeInTheDocument();
    expect(screen.getByText('Phoneme discrimination')).toBeInTheDocument();
    expect(container.querySelector('audio')).not.toBeNull(); // AudioPlayer rendered
  });

  it('degrades gracefully when evaluation is null', () => {
    render(<ReviewItemCard index={0} item={dictItem({ evaluation: null, status: 'incorrect' }) as never} />);
    expect(screen.getByText(/el tiempo lo cura todo/)).toBeInTheDocument(); // reference text shown
    expect(screen.getByText(/no result recorded/i)).toBeInTheDocument();
  });

  it('omits the audio player when audioUrl is absent', () => {
    const noAudio = { ...dictContent, audioUrl: undefined };
    const { container } = render(<ReviewItemCard index={0} item={dictItem({ contentJson: noAudio }) as never} />);
    expect(container.querySelector('audio')).toBeNull();
    expect(screen.getByText('Phoneme discrimination')).toBeInTheDocument(); // body still renders
  });

  it('a skipped dictation item still shows the skipped body', () => {
    render(
      <ReviewItemCard
        index={0}
        item={dictItem({ status: 'skipped', evaluation: null, userAnswer: null, score: null }) as never}
      />,
    );
    expect(screen.getByText(/skipped — no submission/i)).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Flag control — lets the user flag a reviewed exercise (mirrors /drill)
// ---------------------------------------------------------------------------

describe('ReviewItemCard — flag control', () => {
  it('renders a flag control for an attempted item when fetchFn is provided', () => {
    // clozeItem() is incorrect → expanded by default, so the body (and the
    // flag control) is visible without clicking.
    render(<ReviewItemCard index={0} item={clozeItem()} fetchFn={fetchFn} />);
    expect(
      screen.getByRole('button', { name: /flag this exercise/i }),
    ).toBeInTheDocument();
  });

  it('does not render a flag control for a skipped item (no submission to flag)', () => {
    render(<ReviewItemCard index={0} item={skippedClozeItem()} fetchFn={fetchFn} />);
    expect(
      screen.queryByRole('button', { name: /flag this exercise/i }),
    ).not.toBeInTheDocument();
  });

  it('does not render a flag control when no fetchFn is provided', () => {
    render(<ReviewItemCard index={0} item={clozeItem()} />);
    expect(
      screen.queryByRole('button', { name: /flag this exercise/i }),
    ).not.toBeInTheDocument();
  });

  it('hides the flag control behind the collapsed body for a correct item until expanded', () => {
    render(<ReviewItemCard index={0} item={correctClozeItem()} fetchFn={fetchFn} />);
    // Correct items collapse by default → no body, no flag control.
    expect(
      screen.queryByRole('button', { name: /flag this exercise/i }),
    ).not.toBeInTheDocument();
    // Expand via the header toggle.
    fireEvent.click(screen.getByRole('button', { name: /#1/ }));
    expect(
      screen.getByRole('button', { name: /flag this exercise/i }),
    ).toBeInTheDocument();
  });

  it('passes exerciseId + submissionId through to the flag mutation', () => {
    render(<ReviewItemCard index={0} item={clozeItem()} fetchFn={fetchFn} />);
    fireEvent.click(screen.getByRole('button', { name: /flag this exercise/i }));
    fireEvent.click(screen.getByRole('button', { name: /submit flag/i }));
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        exerciseId: '11111111-1111-4111-8111-111111111111',
        submissionId: '99999999-1111-4111-8111-111111111111',
      }),
      expect.anything(),
    );
  });
});
