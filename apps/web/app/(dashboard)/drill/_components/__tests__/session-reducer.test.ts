import { describe, it, expect } from 'vitest';
import type { EvaluationResult } from '@language-drill/shared';
import type {
  CreateSessionResponse,
  ExerciseResponse,
} from '@language-drill/api-client';
import {
  firstUnattemptedIndex,
  initialSessionState,
  selectCurrentItem,
  selectIsLastItem,
  selectProgressFraction,
  sessionReducer,
  type SessionAction,
  type SessionState,
} from '../session-reducer';
import type { SubmissionMeta } from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const sampleItems: ExerciseResponse[] = [
  {
    id: 'ex-0',
    type: 'cloze',
    language: 'EN',
    difficulty: 'B1',
    grammarPointKey: null,
    contentJson: { sentence: 'I ___ home', options: ['go', 'went'] },
  },
  {
    id: 'ex-1',
    type: 'cloze',
    language: 'EN',
    difficulty: 'B1',
    grammarPointKey: null,
    contentJson: { sentence: 'She ___ tired', options: ['is', 'are'] },
  },
];

const sampleCreateResponse: CreateSessionResponse = {
  id: '11111111-1111-1111-1111-111111111111',
  exercises: sampleItems,
};

const sampleResumeResponse = {
  id: sampleCreateResponse.id,
  exercises: sampleItems,
  attemptedExerciseIds: ['ex-0'],
  completedAt: null,
};

const sampleEvaluation: EvaluationResult = {
  score: 0.85,
  grammarAccuracy: 0.9,
  vocabularyRange: 'B1',
  taskAchievement: 0.8,
  feedback: 'good',
  errors: [],
  estimatedCefrEvidence: 'B1',
};

const sampleMeta: SubmissionMeta = { hintLevel: 0 };

const inSessionState: SessionState = {
  kind: 'inSession',
  session: { id: sampleCreateResponse.id },
  items: sampleItems,
  index: 0,
  perItemSubmission: { kind: 'idle' },
  skippedCount: 0,
};

// ---------------------------------------------------------------------------
// initialSessionState
// ---------------------------------------------------------------------------

describe('initialSessionState', () => {
  it('starts in idle', () => {
    expect(initialSessionState).toEqual({ kind: 'idle' });
  });
});

// ---------------------------------------------------------------------------
// CREATE_REQUESTED
// ---------------------------------------------------------------------------

describe('sessionReducer / CREATE_REQUESTED', () => {
  it('transitions idle → creating', () => {
    const next = sessionReducer({ kind: 'idle' }, { type: 'CREATE_REQUESTED' });
    expect(next).toEqual({ kind: 'creating' });
  });

  it('transitions createError → creating (retry path)', () => {
    const next = sessionReducer(
      { kind: 'createError', error: new Error('boom') },
      { type: 'CREATE_REQUESTED' },
    );
    expect(next).toEqual({ kind: 'creating' });
  });

  it('is a no-op from creating', () => {
    const start: SessionState = { kind: 'creating' };
    const next = sessionReducer(start, { type: 'CREATE_REQUESTED' });
    expect(next).toBe(start);
  });

  it('is a no-op from inSession', () => {
    const next = sessionReducer(inSessionState, { type: 'CREATE_REQUESTED' });
    expect(next).toBe(inSessionState);
  });
});

// ---------------------------------------------------------------------------
// CREATE_SUCCEEDED
// ---------------------------------------------------------------------------

describe('sessionReducer / CREATE_SUCCEEDED', () => {
  it('transitions creating → inSession at index 0 with idle per-item submission', () => {
    const next = sessionReducer(
      { kind: 'creating' },
      { type: 'CREATE_SUCCEEDED', session: sampleCreateResponse },
    );
    expect(next).toEqual({
      kind: 'inSession',
      session: { id: sampleCreateResponse.id },
      items: sampleItems,
      index: 0,
      perItemSubmission: { kind: 'idle' },
      skippedCount: 0,
    });
  });

  it('is a no-op from idle', () => {
    const start: SessionState = { kind: 'idle' };
    const next = sessionReducer(start, {
      type: 'CREATE_SUCCEEDED',
      session: sampleCreateResponse,
    });
    expect(next).toBe(start);
  });
});

// ---------------------------------------------------------------------------
// CREATE_FAILED
// ---------------------------------------------------------------------------

describe('sessionReducer / CREATE_FAILED', () => {
  it('transitions creating → createError carrying the error', () => {
    const error = new Error('network');
    const next = sessionReducer({ kind: 'creating' }, { type: 'CREATE_FAILED', error });
    expect(next).toEqual({ kind: 'createError', error });
  });

  it('is a no-op from idle', () => {
    const start: SessionState = { kind: 'idle' };
    const next = sessionReducer(start, { type: 'CREATE_FAILED', error: new Error('x') });
    expect(next).toBe(start);
  });

  it('is a no-op from inSession', () => {
    const next = sessionReducer(inSessionState, {
      type: 'CREATE_FAILED',
      error: new Error('x'),
    });
    expect(next).toBe(inSessionState);
  });
});

// ---------------------------------------------------------------------------
// ITEM_SUBMITTING / ITEM_EVALUATED / ITEM_ERROR
// ---------------------------------------------------------------------------

describe('sessionReducer / per-item actions', () => {
  it('ITEM_SUBMITTING from inSession sets perItemSubmission to submitting', () => {
    const next = sessionReducer(inSessionState, { type: 'ITEM_SUBMITTING' });
    expect(next.kind).toBe('inSession');
    expect((next as typeof inSessionState).perItemSubmission).toEqual({ kind: 'submitting' });
  });

  it('ITEM_EVALUATED from inSession sets perItemSubmission to evaluated with result + meta', () => {
    const next = sessionReducer(inSessionState, {
      type: 'ITEM_EVALUATED',
      result: sampleEvaluation,
      meta: sampleMeta,
    });
    expect(next.kind).toBe('inSession');
    expect((next as typeof inSessionState).perItemSubmission).toEqual({
      kind: 'evaluated',
      result: sampleEvaluation,
      meta: sampleMeta,
    });
  });

  it('ITEM_ERROR from inSession sets perItemSubmission to error with the underlying error', () => {
    const error = new Error('502 upstream');
    const next = sessionReducer(inSessionState, { type: 'ITEM_ERROR', error });
    expect(next.kind).toBe('inSession');
    expect((next as typeof inSessionState).perItemSubmission).toEqual({
      kind: 'error',
      error,
    });
  });

  it('preserves index and skippedCount when updating perItemSubmission', () => {
    const start: SessionState = {
      ...inSessionState,
      index: 1,
      skippedCount: 2,
    };
    const next = sessionReducer(start, { type: 'ITEM_SUBMITTING' });
    expect(next).toEqual({ ...start, perItemSubmission: { kind: 'submitting' } });
  });

  it.each<SessionAction>([
    { type: 'ITEM_SUBMITTING' },
    { type: 'ITEM_EVALUATED', result: sampleEvaluation, meta: sampleMeta },
    { type: 'ITEM_ERROR', error: new Error('x') },
  ])('per-item action $type is a no-op when not in inSession', (action) => {
    const start: SessionState = { kind: 'idle' };
    expect(sessionReducer(start, action)).toBe(start);
    const creating: SessionState = { kind: 'creating' };
    expect(sessionReducer(creating, action)).toBe(creating);
  });
});

// ---------------------------------------------------------------------------
// ITEM_NEXT
// ---------------------------------------------------------------------------

describe('sessionReducer / ITEM_NEXT', () => {
  it('advances index and resets perItemSubmission to idle (mid-session, evaluated)', () => {
    const start: SessionState = {
      ...inSessionState,
      perItemSubmission: { kind: 'evaluated', result: sampleEvaluation, meta: sampleMeta },
    };
    const next = sessionReducer(start, { type: 'ITEM_NEXT' });
    expect(next).toEqual({
      ...inSessionState,
      index: 1,
      perItemSubmission: { kind: 'idle' },
    });
  });

  it.each([
    { kind: 'idle' as const },
    { kind: 'submitting' as const },
    { kind: 'error' as const, error: new Error('x') },
  ])('is a no-op from inSession when perItemSubmission is $kind', (perItem) => {
    const start: SessionState = { ...inSessionState, perItemSubmission: perItem };
    expect(sessionReducer(start, { type: 'ITEM_NEXT' })).toBe(start);
  });

  it('does NOT advance at the last index even when evaluated', () => {
    const start: SessionState = {
      ...inSessionState,
      index: sampleItems.length - 1,
      perItemSubmission: { kind: 'evaluated', result: sampleEvaluation, meta: sampleMeta },
    };
    expect(sessionReducer(start, { type: 'ITEM_NEXT' })).toBe(start);
  });

  it('is a no-op when not in inSession', () => {
    const start: SessionState = { kind: 'idle' };
    expect(sessionReducer(start, { type: 'ITEM_NEXT' })).toBe(start);
  });
});

// ---------------------------------------------------------------------------
// ITEM_SKIP
// ---------------------------------------------------------------------------

describe('sessionReducer / ITEM_SKIP', () => {
  it('advances index, resets perItemSubmission to idle, and increments skippedCount', () => {
    const start: SessionState = {
      ...inSessionState,
      perItemSubmission: { kind: 'error', error: new Error('502') },
    };
    const next = sessionReducer(start, { type: 'ITEM_SKIP' });
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
    {
      kind: 'evaluated' as const,
      result: sampleEvaluation,
      meta: sampleMeta,
    },
  ])('is a no-op when perItemSubmission is $kind (not error)', (perItem) => {
    const start: SessionState = { ...inSessionState, perItemSubmission: perItem };
    expect(sessionReducer(start, { type: 'ITEM_SKIP' })).toBe(start);
  });

  it('is a no-op when not in inSession', () => {
    const start: SessionState = { kind: 'idle' };
    expect(sessionReducer(start, { type: 'ITEM_SKIP' })).toBe(start);
  });
});

// ---------------------------------------------------------------------------
// ITEM_RETRY
// ---------------------------------------------------------------------------

describe('sessionReducer / ITEM_RETRY', () => {
  it('resets perItemSubmission from error → idle, preserving index and skippedCount', () => {
    const start: SessionState = {
      ...inSessionState,
      index: 1,
      skippedCount: 1,
      perItemSubmission: { kind: 'error', error: new Error('502') },
    };
    const next = sessionReducer(start, { type: 'ITEM_RETRY' });
    expect(next).toEqual({
      ...start,
      perItemSubmission: { kind: 'idle' },
    });
  });

  it.each([
    { kind: 'idle' as const },
    { kind: 'submitting' as const },
    {
      kind: 'evaluated' as const,
      result: sampleEvaluation,
      meta: sampleMeta,
    },
  ])('is a no-op when perItemSubmission is $kind (not error)', (perItem) => {
    const start: SessionState = { ...inSessionState, perItemSubmission: perItem };
    expect(sessionReducer(start, { type: 'ITEM_RETRY' })).toBe(start);
  });

  it('is a no-op when not in inSession', () => {
    const start: SessionState = { kind: 'idle' };
    expect(sessionReducer(start, { type: 'ITEM_RETRY' })).toBe(start);
  });
});

// ---------------------------------------------------------------------------
// COMPLETE_REQUESTED / COMPLETE_SUCCEEDED / COMPLETE_FAILED
// ---------------------------------------------------------------------------

describe('sessionReducer / COMPLETE_REQUESTED', () => {
  it('transitions inSession → completing carrying session+items+index+perItemSubmission+skippedCount', () => {
    const start: SessionState = {
      ...inSessionState,
      index: 1,
      skippedCount: 2,
      perItemSubmission: {
        kind: 'evaluated',
        result: sampleEvaluation,
        meta: sampleMeta,
      },
    };
    const next = sessionReducer(start, { type: 'COMPLETE_REQUESTED' });
    expect(next).toEqual({ ...start, kind: 'completing' });
  });

  it('is a no-op from idle', () => {
    const start: SessionState = { kind: 'idle' };
    expect(sessionReducer(start, { type: 'COMPLETE_REQUESTED' })).toBe(start);
  });
});

describe('sessionReducer / COMPLETE_SUCCEEDED removal', () => {
  // Phase G replaces the COMPLETE_SUCCEEDED action + `summary` state with a
  // navigation to /drill/debrief/[sessionId]. Asserting at the type level
  // that the action is no longer part of `SessionAction` keeps anyone from
  // reintroducing it without thinking about the page-level routing.
  it('COMPLETE_SUCCEEDED is no longer a valid SessionAction (type-level guard)', () => {
    // @ts-expect-error — COMPLETE_SUCCEEDED was removed in Phase G
    const invalidAction: SessionAction = { type: 'COMPLETE_SUCCEEDED' };
    expect(invalidAction).toBeDefined();
  });
});

describe('sessionReducer / COMPLETE_FAILED', () => {
  it('transitions completing → inSession with prior per-item state preserved', () => {
    const start: SessionState = {
      kind: 'completing',
      session: { id: sampleCreateResponse.id },
      items: sampleItems,
      index: 1,
      skippedCount: 1,
      perItemSubmission: {
        kind: 'evaluated',
        result: sampleEvaluation,
        meta: sampleMeta,
      },
    };
    const next = sessionReducer(start, {
      type: 'COMPLETE_FAILED',
      error: new Error('boom'),
    });
    expect(next).toEqual({
      kind: 'inSession',
      session: { id: sampleCreateResponse.id },
      items: sampleItems,
      index: 1,
      skippedCount: 1,
      perItemSubmission: {
        kind: 'evaluated',
        result: sampleEvaluation,
        meta: sampleMeta,
      },
    });
  });

  it('is a no-op when not in completing', () => {
    const start: SessionState = { kind: 'idle' };
    expect(
      sessionReducer(start, { type: 'COMPLETE_FAILED', error: new Error('x') }),
    ).toBe(start);
  });
});

// ---------------------------------------------------------------------------
// RESET
// ---------------------------------------------------------------------------

describe('sessionReducer / RESET', () => {
  it.each<{ name: string; from: SessionState }>([
    { name: 'idle', from: { kind: 'idle' } },
    { name: 'creating', from: { kind: 'creating' } },
    {
      name: 'createError',
      from: { kind: 'createError', error: new Error('x') },
    },
    { name: 'inSession', from: inSessionState },
    {
      name: 'completing',
      from: { ...inSessionState, kind: 'completing' },
    },
  ])('returns to idle from $name', ({ from }) => {
    expect(sessionReducer(from, { type: 'RESET' })).toEqual({ kind: 'idle' });
  });
});

// ---------------------------------------------------------------------------
// Full happy-path sequence
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

describe('selectCurrentItem', () => {
  it('returns items[index] when in inSession', () => {
    expect(selectCurrentItem(inSessionState)).toBe(sampleItems[0]);
    expect(
      selectCurrentItem({ ...inSessionState, index: 1 }),
    ).toBe(sampleItems[1]);
  });

  it.each<{ name: string; state: SessionState }>([
    { name: 'idle', state: { kind: 'idle' } },
    { name: 'creating', state: { kind: 'creating' } },
    {
      name: 'createError',
      state: { kind: 'createError', error: new Error('x') },
    },
    {
      name: 'completing',
      state: { ...inSessionState, kind: 'completing' },
    },
  ])('returns null when state is $name', ({ state }) => {
    expect(selectCurrentItem(state)).toBeNull();
  });
});

describe('selectProgressFraction', () => {
  it.each<{ name: string; state: SessionState }>([
    { name: 'idle', state: { kind: 'idle' } },
    { name: 'creating', state: { kind: 'creating' } },
    {
      name: 'createError',
      state: { kind: 'createError', error: new Error('x') },
    },
  ])('returns 0 for $name', ({ state }) => {
    expect(selectProgressFraction(state)).toBe(0);
  });

  it('returns index / count when in inSession with non-evaluated submission', () => {
    expect(selectProgressFraction(inSessionState)).toBe(0); // index 0, idle
    expect(
      selectProgressFraction({ ...inSessionState, index: 1 }),
    ).toBe(0.5); // 1 / 2
  });

  it('boosts the fraction when perItemSubmission is evaluated', () => {
    const state: SessionState = {
      ...inSessionState,
      perItemSubmission: {
        kind: 'evaluated',
        result: sampleEvaluation,
        meta: sampleMeta,
      },
    };
    // index 0 + 1 boost over 2 items => 0.5
    expect(selectProgressFraction(state)).toBe(0.5);
    expect(selectProgressFraction({ ...state, index: 1 })).toBe(1); // last item evaluated
  });

  it.each<{ kind: 'submitting' | 'error' }>([
    { kind: 'submitting' },
    { kind: 'error' },
  ])('does not boost for perItemSubmission kind %s', (perItem) => {
    const state: SessionState = {
      ...inSessionState,
      index: 1,
      perItemSubmission:
        perItem.kind === 'error'
          ? { kind: 'error', error: new Error('x') }
          : { kind: 'submitting' },
    };
    expect(selectProgressFraction(state)).toBe(0.5); // 1 / 2, no boost
  });

  it('returns 1 in completing', () => {
    const state: SessionState = { ...inSessionState, kind: 'completing' };
    expect(selectProgressFraction(state)).toBe(1);
  });

  it('clamps to [0, 1]', () => {
    // Construct an out-of-bounds inSession state to confirm the clamp.
    const state: SessionState = {
      ...inSessionState,
      index: 10,
      perItemSubmission: {
        kind: 'evaluated',
        result: sampleEvaluation,
        meta: sampleMeta,
      },
    };
    expect(selectProgressFraction(state)).toBe(1);
  });
});

describe('selectIsLastItem', () => {
  it('returns true when in inSession at the last index', () => {
    expect(
      selectIsLastItem({ ...inSessionState, index: sampleItems.length - 1 }),
    ).toBe(true);
  });

  it('returns false when in inSession at a non-last index', () => {
    expect(selectIsLastItem(inSessionState)).toBe(false);
  });

  it.each<{ name: string; state: SessionState }>([
    { name: 'idle', state: { kind: 'idle' } },
    { name: 'creating', state: { kind: 'creating' } },
    {
      name: 'createError',
      state: { kind: 'createError', error: new Error('x') },
    },
    {
      name: 'completing',
      state: {
        ...inSessionState,
        kind: 'completing',
        index: sampleItems.length - 1,
      },
    },
  ])('returns false when state is $name', ({ state }) => {
    expect(selectIsLastItem(state)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// firstUnattemptedIndex
// ---------------------------------------------------------------------------

describe('firstUnattemptedIndex', () => {
  it('firstUnattemptedIndex returns the first item not in the attempted set', () => {
    expect(firstUnattemptedIndex(sampleItems, new Set(['ex-0']))).toBe(1);
    expect(firstUnattemptedIndex(sampleItems, new Set())).toBe(0);
    expect(firstUnattemptedIndex(sampleItems, new Set(['ex-0', 'ex-1']))).toBe(-1);
  });
});

// ---------------------------------------------------------------------------
// RESUME_SUCCEEDED
// ---------------------------------------------------------------------------

describe('sessionReducer / RESUME_SUCCEEDED', () => {
  it('enters inSession at the given startIndex from creating', () => {
    const creating: SessionState = { kind: 'creating' };
    const next = sessionReducer(creating, {
      type: 'RESUME_SUCCEEDED',
      session: sampleResumeResponse,
      startIndex: 1,
    });
    expect(next.kind).toBe('inSession');
    if (next.kind !== 'inSession') throw new Error('expected inSession');
    expect(next.index).toBe(1);
    expect(next.items).toEqual(sampleItems);
    expect(next.session.id).toBe(sampleResumeResponse.id);
  });

  it('is ignored when not in creating', () => {
    const next = sessionReducer(inSessionState, {
      type: 'RESUME_SUCCEEDED',
      session: sampleResumeResponse,
      startIndex: 1,
    });
    expect(next).toBe(inSessionState);
  });
});

describe('sessionReducer / full sequence', () => {
  // Phase G: `completing` is now the terminal state in-reducer. On
  // useCompleteSession success the page navigates to /drill/debrief/[id] and
  // the page (with its reducer) unmounts. RESET still returns to idle for
  // the in-place selector-change retry path.
  it('runs create → submit → evaluate → next … → complete → completing → reset → idle', () => {
    let state: SessionState = initialSessionState;

    state = sessionReducer(state, { type: 'CREATE_REQUESTED' });
    expect(state.kind).toBe('creating');

    state = sessionReducer(state, {
      type: 'CREATE_SUCCEEDED',
      session: sampleCreateResponse,
    });
    expect(state.kind).toBe('inSession');
    expect((state as { index: number }).index).toBe(0);

    // Item 0: submit → evaluate → next
    state = sessionReducer(state, { type: 'ITEM_SUBMITTING' });
    expect(state.kind).toBe('inSession');
    state = sessionReducer(state, {
      type: 'ITEM_EVALUATED',
      result: sampleEvaluation,
      meta: sampleMeta,
    });
    state = sessionReducer(state, { type: 'ITEM_NEXT' });
    expect((state as { index: number }).index).toBe(1);
    expect((state as { perItemSubmission: { kind: string } }).perItemSubmission.kind).toBe(
      'idle',
    );

    // Item 1 (last): submit → evaluate → complete (no next dispatched)
    state = sessionReducer(state, { type: 'ITEM_SUBMITTING' });
    state = sessionReducer(state, {
      type: 'ITEM_EVALUATED',
      result: sampleEvaluation,
      meta: sampleMeta,
    });
    // Last-index next is a no-op
    const beforeNext = state;
    state = sessionReducer(state, { type: 'ITEM_NEXT' });
    expect(state).toBe(beforeNext);

    state = sessionReducer(state, { type: 'COMPLETE_REQUESTED' });
    expect(state.kind).toBe('completing');

    state = sessionReducer(state, { type: 'RESET' });
    expect(state).toEqual({ kind: 'idle' });
  });
});
