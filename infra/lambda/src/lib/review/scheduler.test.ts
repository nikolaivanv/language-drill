import { describe, it, expect } from 'vitest';
import { State } from 'ts-fsrs';
import {
  applyReview,
  deriveLifecycleState,
  initCard,
  LEECH_LAPSE_THRESHOLD,
  MATURE_STABILITY_DAYS,
  Rating,
  ratingFromOutcome,
  rehydrateCard,
  serializeCard,
  type FsrsCard,
} from './scheduler';

const NOW = new Date('2026-01-01T00:00:00.000Z');

describe('initCard', () => {
  it('creates a brand-new card due immediately', () => {
    const card = initCard(NOW);
    expect(card.reps).toBe(0);
    expect(card.lapses).toBe(0);
    expect(card.state).toBe(State.New);
    expect(card.due.getTime()).toBe(NOW.getTime());
    expect(deriveLifecycleState(card)).toBe('new');
  });
});

describe('deriveLifecycleState', () => {
  const base = initCard(NOW);

  it('maps a New card to "new"', () => {
    expect(deriveLifecycleState({ ...base, state: State.New })).toBe('new');
  });

  it('maps a Review card with stability >= threshold to "mature"', () => {
    const card: FsrsCard = {
      ...base,
      state: State.Review,
      stability: MATURE_STABILITY_DAYS + 0.1,
      lapses: 0,
    };
    expect(deriveLifecycleState(card)).toBe('mature');
  });

  it('maps a Review card below the maturity stability to "learning"', () => {
    const card: FsrsCard = {
      ...base,
      state: State.Review,
      stability: MATURE_STABILITY_DAYS - 1,
      lapses: 0,
    };
    expect(deriveLifecycleState(card)).toBe('learning');
  });

  it('maps any card at the leech lapse threshold to "leech" (leech wins over mature)', () => {
    const card: FsrsCard = {
      ...base,
      state: State.Review,
      stability: 30,
      lapses: LEECH_LAPSE_THRESHOLD,
    };
    expect(deriveLifecycleState(card)).toBe('leech');
  });

  it('maps a Learning card to "learning"', () => {
    expect(
      deriveLifecycleState({ ...base, state: State.Learning, lapses: 0 }),
    ).toBe('learning');
  });
});

describe('applyReview', () => {
  it('advances a new card on Good: reps increment, state new→learning, stability grows', () => {
    const card = initCard(NOW);
    const { next, delta } = applyReview(card, Rating.Good, NOW);
    expect(next.reps).toBe(1);
    expect(delta.stateFrom).toBe('new');
    expect(delta.stateTo).toBe('learning');
    expect(delta.stabilityTo).toBeGreaterThan(delta.stabilityFrom);
    expect(delta.intervalFrom).toBe(0);
  });

  it('is deterministic (enable_fuzz: false) — same input yields identical next state', () => {
    const card = initCard(NOW);
    const a = applyReview(card, Rating.Good, NOW);
    const b = applyReview(card, Rating.Good, NOW);
    expect(b.next.stability).toBe(a.next.stability);
    expect(b.next.difficulty).toBe(a.next.difficulty);
    expect(b.next.due.getTime()).toBe(a.next.due.getTime());
  });

  it('matures a card through repeated Good reviews (advancing now to each due date)', () => {
    let card = initCard(NOW);
    let t = NOW;
    let matured = false;
    for (let i = 0; i < 6; i++) {
      const { next } = applyReview(card, Rating.Good, t);
      card = next;
      t = new Date(card.due.getTime());
      if (deriveLifecycleState(card) === 'mature') {
        matured = true;
        break;
      }
    }
    expect(matured).toBe(true);
    expect(card.stability).toBeGreaterThanOrEqual(MATURE_STABILITY_DAYS);
  });

  it('records a lapse and drops out of mature when a matured card is forgotten', () => {
    // Graduate to a mature Review card first.
    let card = initCard(NOW);
    let t = NOW;
    for (let i = 0; i < 3; i++) {
      const { next } = applyReview(card, Rating.Good, t);
      card = next;
      t = new Date(card.due.getTime());
    }
    expect(card.state).toBe(State.Review);
    const lapsesBefore = card.lapses;

    const { next, delta } = applyReview(card, Rating.Again, t);
    expect(next.lapses).toBe(lapsesBefore + 1);
    expect(delta.stateFrom).toBe('mature');
    expect(delta.stateTo).toBe('learning');
  });
});

describe('ratingFromOutcome', () => {
  it('maps incorrect → Again', () => {
    expect(ratingFromOutcome('incorrect')).toBe(Rating.Again);
  });

  it('maps partial → Hard', () => {
    expect(ratingFromOutcome('partial')).toBe(Rating.Hard);
  });

  it('maps a clean correct (0 hints) → Good', () => {
    expect(ratingFromOutcome('correct')).toBe(Rating.Good);
    expect(ratingFromOutcome('correct', { hintsUsed: 0 })).toBe(Rating.Good);
  });

  it('caps a hint-assisted correct at Hard', () => {
    expect(ratingFromOutcome('correct', { hintsUsed: 1 })).toBe(Rating.Hard);
    expect(ratingFromOutcome('correct', { hintsUsed: 3 })).toBe(Rating.Hard);
  });
});

describe('serializeCard / rehydrateCard', () => {
  it('round-trips a card through JSON (dates survive)', () => {
    const { next } = applyReview(initCard(NOW), Rating.Good, NOW);
    const json = JSON.parse(JSON.stringify(serializeCard(next))) as Record<string, unknown>;
    const back = rehydrateCard(json);
    expect(back.due.getTime()).toBe(next.due.getTime());
    expect(back.last_review?.getTime()).toBe(next.last_review?.getTime());
    expect(back.stability).toBe(next.stability);
    expect(back.reps).toBe(next.reps);
  });

  it('rehydrates a null last_review as undefined', () => {
    const json = JSON.parse(JSON.stringify(serializeCard(initCard(NOW)))) as Record<
      string,
      unknown
    >;
    const back = rehydrateCard(json);
    expect(back.last_review).toBeUndefined();
  });
});
