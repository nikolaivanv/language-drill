import { describe, it, expect } from 'vitest';
import { Language } from '@language-drill/shared';
import type {
  ReviewItem,
  ReviewItemResult,
  StartReviewSessionResponse,
} from '@language-drill/api-client';
import {
  initialReviewSessionState,
  reviewSessionReducer,
  selectCurrentReviewItem,
  selectIsLastReviewItem,
  selectReviewProgressFraction,
  type ReviewSessionAction,
  type ReviewSessionState,
  type ReviewSubmissionMeta,
} from './review-session-reducer';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleItems: ReviewItem[] = [
  {
    stateId: '00000000-0000-0000-0000-0000000000a0',
    lemma: 'gehen',
    language: Language.DE,
    itemType: 'cloze',
    gloss: 'to go',
    pos: 'verb',
    cefr: 'A1',
    freqRank: 42,
    occurrence: null,
  },
  {
    stateId: '00000000-0000-0000-0000-0000000000a1',
    lemma: 'Haus',
    language: Language.DE,
    itemType: 'meaning',
    gloss: 'house',
    pos: 'noun',
    cefr: 'A1',
    freqRank: 88,
    occurrence: null,
  },
];

const sampleCreateResponse: StartReviewSessionResponse = {
  sessionId: '11111111-1111-1111-1111-111111111111',
  items: sampleItems,
};

const sampleResult: ReviewItemResult = {
  outcome: 'correct',
  correctAnswer: 'gehen',
  schedulerDelta: {
    intervalFrom: 0,
    intervalTo: 1,
    stabilityFrom: 0,
    stabilityTo: 2.5,
    stateFrom: 'new',
    stateTo: 'learning',
  },
  masteryDeltas: [],
};

const sampleMeta: ReviewSubmissionMeta = { answer: 'gehen', hintsUsed: 0 };

const inSessionState: ReviewSessionState = {
  kind: 'inSession',
  session: { id: sampleCreateResponse.sessionId },
  items: sampleItems,
  index: 0,
  perItemSubmission: { kind: 'idle' },
  skippedCount: 0,
};

// ---------------------------------------------------------------------------
// initialReviewSessionState
// ---------------------------------------------------------------------------

describe('initialReviewSessionState', () => {
  it('starts in idle', () => {
    expect(initialReviewSessionState).toEqual({ kind: 'idle' });
  });
});

// ---------------------------------------------------------------------------
// CREATE_REQUESTED
// ---------------------------------------------------------------------------

describe('reviewSessionReducer / CREATE_REQUESTED', () => {
  it('transitions idle → creating', () => {
    const next = reviewSessionReducer({ kind: 'idle' }, { type: 'CREATE_REQUESTED' });
    expect(next).toEqual({ kind: 'creating' });
  });

  it('transitions createError → creating (retry path)', () => {
    const next = reviewSessionReducer(
      { kind: 'createError', error: new Error('boom') },
      { type: 'CREATE_REQUESTED' },
    );
    expect(next).toEqual({ kind: 'creating' });
  });

  it('is a no-op from creating', () => {
    const start: ReviewSessionState = { kind: 'creating' };
    expect(reviewSessionReducer(start, { type: 'CREATE_REQUESTED' })).toBe(start);
  });

  it('is a no-op from inSession', () => {
    expect(reviewSessionReducer(inSessionState, { type: 'CREATE_REQUESTED' })).toBe(
      inSessionState,
    );
  });
});

// ---------------------------------------------------------------------------
// CREATE_SUCCEEDED
// ---------------------------------------------------------------------------

describe('reviewSessionReducer / CREATE_SUCCEEDED', () => {
  it('transitions creating → inSession at index 0, mapping sessionId → session.id', () => {
    const next = reviewSessionReducer(
      { kind: 'creating' },
      { type: 'CREATE_SUCCEEDED', session: sampleCreateResponse },
    );
    expect(next).toEqual({
      kind: 'inSession',
      session: { id: sampleCreateResponse.sessionId },
      items: sampleItems,
      index: 0,
      perItemSubmission: { kind: 'idle' },
      skippedCount: 0,
    });
  });

  it('is a no-op from idle', () => {
    const start: ReviewSessionState = { kind: 'idle' };
    expect(
      reviewSessionReducer(start, { type: 'CREATE_SUCCEEDED', session: sampleCreateResponse }),
    ).toBe(start);
  });
});

// ---------------------------------------------------------------------------
// CREATE_FAILED
// ---------------------------------------------------------------------------

describe('reviewSessionReducer / CREATE_FAILED', () => {
  it('transitions creating → createError carrying the error', () => {
    const error = new Error('network');
    const next = reviewSessionReducer({ kind: 'creating' }, { type: 'CREATE_FAILED', error });
    expect(next).toEqual({ kind: 'createError', error });
  });

  it('is a no-op from idle', () => {
    const start: ReviewSessionState = { kind: 'idle' };
    expect(reviewSessionReducer(start, { type: 'CREATE_FAILED', error: new Error('x') })).toBe(
      start,
    );
  });

  it('is a no-op from inSession', () => {
    expect(
      reviewSessionReducer(inSessionState, { type: 'CREATE_FAILED', error: new Error('x') }),
    ).toBe(inSessionState);
  });
});

// ---------------------------------------------------------------------------
// ITEM_SUBMITTING / ITEM_EVALUATED / ITEM_ERROR
// ---------------------------------------------------------------------------

describe('reviewSessionReducer / per-item actions', () => {
  it('ITEM_SUBMITTING from inSession sets perItemSubmission to submitting', () => {
    const next = reviewSessionReducer(inSessionState, { type: 'ITEM_SUBMITTING' });
    expect(next.kind).toBe('inSession');
    expect((next as typeof inSessionState).perItemSubmission).toEqual({ kind: 'submitting' });
  });

  it('ITEM_EVALUATED from inSession sets perItemSubmission to evaluated with result + meta', () => {
    const next = reviewSessionReducer(inSessionState, {
      type: 'ITEM_EVALUATED',
      result: sampleResult,
      meta: sampleMeta,
    });
    expect(next.kind).toBe('inSession');
    expect((next as typeof inSessionState).perItemSubmission).toEqual({
      kind: 'evaluated',
      result: sampleResult,
      meta: sampleMeta,
    });
  });

  it('ITEM_ERROR from inSession sets perItemSubmission to error with the underlying error', () => {
    const error = new Error('502 upstream');
    const next = reviewSessionReducer(inSessionState, { type: 'ITEM_ERROR', error });
    expect(next.kind).toBe('inSession');
    expect((next as typeof inSessionState).perItemSubmission).toEqual({ kind: 'error', error });
  });

  it('preserves index and skippedCount when updating perItemSubmission', () => {
    const start: ReviewSessionState = { ...inSessionState, index: 1, skippedCount: 2 };
    const next = reviewSessionReducer(start, { type: 'ITEM_SUBMITTING' });
    expect(next).toEqual({ ...start, perItemSubmission: { kind: 'submitting' } });
  });

  it.each<ReviewSessionAction>([
    { type: 'ITEM_SUBMITTING' },
    { type: 'ITEM_EVALUATED', result: sampleResult, meta: sampleMeta },
    { type: 'ITEM_ERROR', error: new Error('x') },
  ])('per-item action $type is a no-op when not in inSession', (action) => {
    const start: ReviewSessionState = { kind: 'idle' };
    expect(reviewSessionReducer(start, action)).toBe(start);
    const creating: ReviewSessionState = { kind: 'creating' };
    expect(reviewSessionReducer(creating, action)).toBe(creating);
  });
});

// ---------------------------------------------------------------------------
// ITEM_NEXT
// ---------------------------------------------------------------------------

describe('reviewSessionReducer / ITEM_NEXT', () => {
  it('advances index and resets perItemSubmission to idle (mid-session, evaluated)', () => {
    const start: ReviewSessionState = {
      ...inSessionState,
      perItemSubmission: { kind: 'evaluated', result: sampleResult, meta: sampleMeta },
    };
    const next = reviewSessionReducer(start, { type: 'ITEM_NEXT' });
    expect(next).toEqual({ ...inSessionState, index: 1, perItemSubmission: { kind: 'idle' } });
  });

  it.each([
    { kind: 'idle' as const },
    { kind: 'submitting' as const },
    { kind: 'error' as const, error: new Error('x') },
  ])('is a no-op from inSession when perItemSubmission is $kind', (perItem) => {
    const start: ReviewSessionState = { ...inSessionState, perItemSubmission: perItem };
    expect(reviewSessionReducer(start, { type: 'ITEM_NEXT' })).toBe(start);
  });

  it('does NOT advance at the last index even when evaluated', () => {
    const start: ReviewSessionState = {
      ...inSessionState,
      index: sampleItems.length - 1,
      perItemSubmission: { kind: 'evaluated', result: sampleResult, meta: sampleMeta },
    };
    expect(reviewSessionReducer(start, { type: 'ITEM_NEXT' })).toBe(start);
  });

  it('is a no-op when not in inSession', () => {
    const start: ReviewSessionState = { kind: 'idle' };
    expect(reviewSessionReducer(start, { type: 'ITEM_NEXT' })).toBe(start);
  });
});

// ---------------------------------------------------------------------------
// ITEM_SKIP
// ---------------------------------------------------------------------------

describe('reviewSessionReducer / ITEM_SKIP', () => {
  it('advances index, resets perItemSubmission to idle, and increments skippedCount', () => {
    const start: ReviewSessionState = {
      ...inSessionState,
      perItemSubmission: { kind: 'error', error: new Error('502') },
    };
    const next = reviewSessionReducer(start, { type: 'ITEM_SKIP' });
    expect(next).toEqual({
      ...inSessionState,
      index: 1,
      perItemSubmission: { kind: 'idle' },
      skippedCount: 1,
    });
  });

  it.each([
    { kind: 'idle' as const },
    { kind: 'submitting' as const },
    { kind: 'evaluated' as const, result: sampleResult, meta: sampleMeta },
  ])('is a no-op when perItemSubmission is $kind (not error)', (perItem) => {
    const start: ReviewSessionState = { ...inSessionState, perItemSubmission: perItem };
    expect(reviewSessionReducer(start, { type: 'ITEM_SKIP' })).toBe(start);
  });

  it('is a no-op when not in inSession', () => {
    const start: ReviewSessionState = { kind: 'idle' };
    expect(reviewSessionReducer(start, { type: 'ITEM_SKIP' })).toBe(start);
  });
});

// ---------------------------------------------------------------------------
// ITEM_RETRY
// ---------------------------------------------------------------------------

describe('reviewSessionReducer / ITEM_RETRY', () => {
  it('resets perItemSubmission from error → idle, preserving index and skippedCount', () => {
    const start: ReviewSessionState = {
      ...inSessionState,
      index: 1,
      skippedCount: 1,
      perItemSubmission: { kind: 'error', error: new Error('502') },
    };
    const next = reviewSessionReducer(start, { type: 'ITEM_RETRY' });
    expect(next).toEqual({ ...start, perItemSubmission: { kind: 'idle' } });
  });

  it.each([
    { kind: 'idle' as const },
    { kind: 'submitting' as const },
    { kind: 'evaluated' as const, result: sampleResult, meta: sampleMeta },
  ])('is a no-op when perItemSubmission is $kind (not error)', (perItem) => {
    const start: ReviewSessionState = { ...inSessionState, perItemSubmission: perItem };
    expect(reviewSessionReducer(start, { type: 'ITEM_RETRY' })).toBe(start);
  });

  it('is a no-op when not in inSession', () => {
    const start: ReviewSessionState = { kind: 'idle' };
    expect(reviewSessionReducer(start, { type: 'ITEM_RETRY' })).toBe(start);
  });
});

// ---------------------------------------------------------------------------
// COMPLETE_REQUESTED / COMPLETE_FAILED
// ---------------------------------------------------------------------------

describe('reviewSessionReducer / COMPLETE_REQUESTED', () => {
  it('transitions inSession → completing carrying all in-progress fields', () => {
    const start: ReviewSessionState = {
      ...inSessionState,
      index: 1,
      skippedCount: 2,
      perItemSubmission: { kind: 'evaluated', result: sampleResult, meta: sampleMeta },
    };
    const next = reviewSessionReducer(start, { type: 'COMPLETE_REQUESTED' });
    expect(next).toEqual({ ...start, kind: 'completing' });
  });

  it('is a no-op from idle', () => {
    const start: ReviewSessionState = { kind: 'idle' };
    expect(reviewSessionReducer(start, { type: 'COMPLETE_REQUESTED' })).toBe(start);
  });
});

describe('reviewSessionReducer / COMPLETE_FAILED', () => {
  it('transitions completing → inSession with prior per-item state preserved', () => {
    const start: ReviewSessionState = {
      kind: 'completing',
      session: { id: sampleCreateResponse.sessionId },
      items: sampleItems,
      index: 1,
      skippedCount: 1,
      perItemSubmission: { kind: 'evaluated', result: sampleResult, meta: sampleMeta },
    };
    const next = reviewSessionReducer(start, { type: 'COMPLETE_FAILED', error: new Error('boom') });
    expect(next).toEqual({
      kind: 'inSession',
      session: { id: sampleCreateResponse.sessionId },
      items: sampleItems,
      index: 1,
      skippedCount: 1,
      perItemSubmission: { kind: 'evaluated', result: sampleResult, meta: sampleMeta },
    });
  });

  it('is a no-op when not in completing', () => {
    const start: ReviewSessionState = { kind: 'idle' };
    expect(reviewSessionReducer(start, { type: 'COMPLETE_FAILED', error: new Error('x') })).toBe(
      start,
    );
  });
});

// ---------------------------------------------------------------------------
// RESET
// ---------------------------------------------------------------------------

describe('reviewSessionReducer / RESET', () => {
  it.each<{ name: string; from: ReviewSessionState }>([
    { name: 'idle', from: { kind: 'idle' } },
    { name: 'creating', from: { kind: 'creating' } },
    { name: 'createError', from: { kind: 'createError', error: new Error('x') } },
    { name: 'inSession', from: inSessionState },
    { name: 'completing', from: { ...inSessionState, kind: 'completing' } },
  ])('returns to idle from $name', ({ from }) => {
    expect(reviewSessionReducer(from, { type: 'RESET' })).toEqual({ kind: 'idle' });
  });
});

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

describe('selectCurrentReviewItem', () => {
  it('returns items[index] when in inSession', () => {
    expect(selectCurrentReviewItem(inSessionState)).toBe(sampleItems[0]);
    expect(selectCurrentReviewItem({ ...inSessionState, index: 1 })).toBe(sampleItems[1]);
  });

  it.each<{ name: string; state: ReviewSessionState }>([
    { name: 'idle', state: { kind: 'idle' } },
    { name: 'creating', state: { kind: 'creating' } },
    { name: 'createError', state: { kind: 'createError', error: new Error('x') } },
    { name: 'completing', state: { ...inSessionState, kind: 'completing' } },
  ])('returns null when state is $name', ({ state }) => {
    expect(selectCurrentReviewItem(state)).toBeNull();
  });
});

describe('selectReviewProgressFraction', () => {
  it.each<{ name: string; state: ReviewSessionState }>([
    { name: 'idle', state: { kind: 'idle' } },
    { name: 'creating', state: { kind: 'creating' } },
    { name: 'createError', state: { kind: 'createError', error: new Error('x') } },
  ])('returns 0 for $name', ({ state }) => {
    expect(selectReviewProgressFraction(state)).toBe(0);
  });

  it('returns index / count when in inSession with non-evaluated submission', () => {
    expect(selectReviewProgressFraction(inSessionState)).toBe(0); // index 0, idle
    expect(selectReviewProgressFraction({ ...inSessionState, index: 1 })).toBe(0.5); // 1 / 2
  });

  it('boosts the fraction when perItemSubmission is evaluated', () => {
    const state: ReviewSessionState = {
      ...inSessionState,
      perItemSubmission: { kind: 'evaluated', result: sampleResult, meta: sampleMeta },
    };
    expect(selectReviewProgressFraction(state)).toBe(0.5); // index 0 + 1 boost over 2
    expect(selectReviewProgressFraction({ ...state, index: 1 })).toBe(1); // last item evaluated
  });

  it.each<{ kind: 'submitting' | 'error' }>([{ kind: 'submitting' }, { kind: 'error' }])(
    'does not boost for perItemSubmission kind %s',
    (perItem) => {
      const state: ReviewSessionState = {
        ...inSessionState,
        index: 1,
        perItemSubmission:
          perItem.kind === 'error'
            ? { kind: 'error', error: new Error('x') }
            : { kind: 'submitting' },
      };
      expect(selectReviewProgressFraction(state)).toBe(0.5); // 1 / 2, no boost
    },
  );

  it('returns 1 in completing', () => {
    const state: ReviewSessionState = { ...inSessionState, kind: 'completing' };
    expect(selectReviewProgressFraction(state)).toBe(1);
  });

  it('clamps to [0, 1]', () => {
    const state: ReviewSessionState = {
      ...inSessionState,
      index: 10,
      perItemSubmission: { kind: 'evaluated', result: sampleResult, meta: sampleMeta },
    };
    expect(selectReviewProgressFraction(state)).toBe(1);
  });
});

describe('selectIsLastReviewItem', () => {
  it('returns true when in inSession at the last index', () => {
    expect(selectIsLastReviewItem({ ...inSessionState, index: sampleItems.length - 1 })).toBe(
      true,
    );
  });

  it('returns false when in inSession at a non-last index', () => {
    expect(selectIsLastReviewItem(inSessionState)).toBe(false);
  });

  it.each<{ name: string; state: ReviewSessionState }>([
    { name: 'idle', state: { kind: 'idle' } },
    { name: 'creating', state: { kind: 'creating' } },
    { name: 'createError', state: { kind: 'createError', error: new Error('x') } },
    {
      name: 'completing',
      state: { ...inSessionState, kind: 'completing', index: sampleItems.length - 1 },
    },
  ])('returns false when state is $name', ({ state }) => {
    expect(selectIsLastReviewItem(state)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Full happy-path sequence
// ---------------------------------------------------------------------------

describe('reviewSessionReducer / full sequence', () => {
  it('runs create → submit → evaluate → next … → complete → completing → reset → idle', () => {
    let state: ReviewSessionState = initialReviewSessionState;

    state = reviewSessionReducer(state, { type: 'CREATE_REQUESTED' });
    expect(state.kind).toBe('creating');

    state = reviewSessionReducer(state, {
      type: 'CREATE_SUCCEEDED',
      session: sampleCreateResponse,
    });
    expect(state.kind).toBe('inSession');
    expect((state as { index: number }).index).toBe(0);

    // Item 0: submit → evaluate → next
    state = reviewSessionReducer(state, { type: 'ITEM_SUBMITTING' });
    state = reviewSessionReducer(state, {
      type: 'ITEM_EVALUATED',
      result: sampleResult,
      meta: sampleMeta,
    });
    state = reviewSessionReducer(state, { type: 'ITEM_NEXT' });
    expect((state as { index: number }).index).toBe(1);
    expect((state as { perItemSubmission: { kind: string } }).perItemSubmission.kind).toBe('idle');

    // Item 1 (last): submit → evaluate → complete (no next dispatched)
    state = reviewSessionReducer(state, { type: 'ITEM_SUBMITTING' });
    state = reviewSessionReducer(state, {
      type: 'ITEM_EVALUATED',
      result: sampleResult,
      meta: sampleMeta,
    });
    const beforeNext = state;
    state = reviewSessionReducer(state, { type: 'ITEM_NEXT' });
    expect(state).toBe(beforeNext); // last-index next is a no-op

    state = reviewSessionReducer(state, { type: 'COMPLETE_REQUESTED' });
    expect(state.kind).toBe('completing');

    state = reviewSessionReducer(state, { type: 'RESET' });
    expect(state).toEqual({ kind: 'idle' });
  });
});
