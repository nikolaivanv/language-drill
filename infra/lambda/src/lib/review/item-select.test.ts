import { describe, it, expect } from 'vitest';
import type {
  Occurrence,
  ReviewCard,
  VocabReviewStatus,
} from '@language-drill/shared';
import { pickOccurrence, pickItemType } from './item-select';

// --- fixtures --------------------------------------------------------------

function makeOcc(overrides: Partial<Occurrence> = {}): Occurrence {
  return {
    surface: 'gato',
    sentence: 'El gato duerme en el sofá.',
    contextualSense: 'cat',
    grammarPoints: [],
    ...overrides,
  };
}

function makeCard(
  overrides: {
    stability?: number;
    state?: VocabReviewStatus;
    isPhrase?: boolean;
    occurrences?: Occurrence[];
  } = {},
): ReviewCard {
  const {
    stability = 1,
    state = 'learning',
    isPhrase = false,
    occurrences = [makeOcc()],
  } = overrides;
  return {
    stateId: '00000000-0000-0000-0000-000000000000',
    lemma: 'gato',
    language: 'ES',
    gloss: 'cat',
    pos: 'noun',
    cefr: 'A1',
    freqRank: 500,
    isPhrase,
    occurrences,
    fsrs: {
      stability,
      difficulty: 5,
      reps: state === 'new' ? 0 : 2,
      lapses: 0,
      state,
      dueAt: '2026-01-01T00:00:00.000Z',
      lastReviewedAt: state === 'new' ? null : '2025-12-30T00:00:00.000Z',
    },
  };
}

// --- pickOccurrence --------------------------------------------------------

describe('pickOccurrence', () => {
  it('returns an occurrence whose sentence contains the surface', () => {
    const card = makeCard();
    expect(pickOccurrence(card)).toEqual(card.occurrences[0]);
  });

  it('is case-insensitive on the surface→sentence containment check', () => {
    const card = makeCard({
      occurrences: [makeOcc({ surface: 'Gato', sentence: 'EL GATO DUERME.' })],
    });
    expect(pickOccurrence(card)).not.toBeNull();
  });

  it('returns null when no occurrence has a usable sentence', () => {
    const card = makeCard({
      occurrences: [makeOcc({ surface: 'gato', sentence: 'Hola mundo.' })],
    });
    expect(pickOccurrence(card)).toBeNull();
  });

  it('returns null when there are no occurrences at all', () => {
    expect(pickOccurrence(makeCard({ occurrences: [] }))).toBeNull();
  });

  it('seed-selects across usable occurrences (different surface per session)', () => {
    const a = makeOcc({ surface: 'gato', sentence: 'El gato duerme.' });
    const b = makeOcc({ surface: 'gatos', sentence: 'Los gatos duermen.' });
    const card = makeCard({ occurrences: [a, b] });
    expect(pickOccurrence(card, 0)).toEqual(a);
    expect(pickOccurrence(card, 1)).toEqual(b);
    expect(pickOccurrence(card, 2)).toEqual(a); // wraps modulo
  });

  it('skips unusable occurrences when seeding over the usable subset', () => {
    const bad = makeOcc({ surface: 'gato', sentence: 'No surface here.' });
    const good = makeOcc({ surface: 'gato', sentence: 'El gato duerme.' });
    const card = makeCard({ occurrences: [bad, good] });
    // Only `good` is usable, so any seed resolves to it.
    expect(pickOccurrence(card, 0)).toEqual(good);
    expect(pickOccurrence(card, 1)).toEqual(good);
  });
});

// --- pickItemType: maturity → type ----------------------------------------

describe('pickItemType — maturity mapping', () => {
  it('prefers production (meaning) at stability ≥ 7d (Req 7.2)', () => {
    const card = makeCard({ stability: 7, state: 'mature' });
    expect(pickItemType(card, 0)).toBe('meaning');
    expect(pickItemType(card, 1)).toBe('meaning');
  });

  it('prefers production even when a usable occurrence exists', () => {
    const card = makeCard({ stability: 30, state: 'mature' });
    expect(pickItemType(card)).toBe('meaning');
  });

  it('uses cloze for a learning card with a usable sentence', () => {
    const card = makeCard({ stability: 2, state: 'learning' });
    expect(pickItemType(card)).toBe('cloze');
  });

  it('alternates recognition/cloze for a brand-new card with context (Req 7.4)', () => {
    const card = makeCard({ stability: 0, state: 'new' });
    expect(pickItemType(card, 0)).toBe('recognition');
    expect(pickItemType(card, 1)).toBe('cloze');
  });
});

// --- pickItemType: phrase exclusion (Req 2.6) ------------------------------

describe('pickItemType — phrase exclusion', () => {
  it('never emits cloze for a learning phrase card (falls back to meaning)', () => {
    const card = makeCard({ stability: 2, state: 'learning', isPhrase: true });
    expect(pickItemType(card, 0)).toBe('meaning');
    expect(pickItemType(card, 1)).toBe('meaning');
  });

  it('keeps a new phrase card on recognition (no cloze variation)', () => {
    const card = makeCard({ stability: 0, state: 'new', isPhrase: true });
    expect(pickItemType(card, 0)).toBe('recognition');
    expect(pickItemType(card, 1)).toBe('recognition');
  });
});

// --- pickItemType: occurrence fallback (Req 2.4) ---------------------------

describe('pickItemType — context fallback', () => {
  it('falls back to meaning for a learning card with no usable sentence', () => {
    const card = makeCard({
      stability: 2,
      state: 'learning',
      occurrences: [makeOcc({ surface: 'gato', sentence: 'Hola mundo.' })],
    });
    expect(pickItemType(card)).toBe('meaning');
  });

  it('falls back to recognition for a new card with no usable sentence', () => {
    const card = makeCard({
      stability: 0,
      state: 'new',
      occurrences: [],
    });
    expect(pickItemType(card, 0)).toBe('recognition');
    expect(pickItemType(card, 1)).toBe('recognition');
  });
});
