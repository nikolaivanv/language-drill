import { describe, it, expect } from 'vitest';
import { CefrLevel, ReadingTextLength } from '@language-drill/shared';
import type { DeepCard, FlaggedMap, WordFlag } from '@language-drill/shared';
import {
  initialState,
  readPageReducer,
  selectActiveEntry,
  selectFlaggedMap,
  selectShouldShowAnnotatedSkeleton,
  selectShouldShowEmpty,
  spanKey,
  type DeepSpan,
  type ReadPageState,
} from './read-page-reducer';

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function withState(overrides: Partial<ReadPageState> = {}): ReadPageState {
  return { ...initialState, ...overrides };
}

// ---------------------------------------------------------------------------
// initial state
// ---------------------------------------------------------------------------

describe('initialState', () => {
  it('starts at the empty view with a clean paste form, no active entry, and no transient state', () => {
    expect(initialState).toEqual({
      view: 'empty',
      paste: { title: '', source: '', text: '' },
      activeEntryId: null,
      bank: [],
      activeWord: null,
      intensity: 'subtle',
      saveToast: null,
      inlineError: null,
      annotateStream: { phase: 'idle' },
      deepCard: { status: 'idle' },
      spanAnnotations: {},
      generate: { topic: '', length: ReadingTextLength.SHORT, cefr: CefrLevel.A2, language: 'TR' },
    });
  });
});

// ---------------------------------------------------------------------------
// SET_VIEW
// ---------------------------------------------------------------------------

describe('SET_VIEW', () => {
  it('switches the view and clears any open popover', () => {
    const before = withState({
      view: 'annotated',
      activeWord: { word: 'hola', x: 10, y: 20 },
    });
    const after = readPageReducer(before, { type: 'SET_VIEW', view: 'pasting' });
    expect(after.view).toBe('pasting');
    expect(after.activeWord).toBeNull();
  });

  it('does not touch the bank or save toast', () => {
    const before = withState({ bank: ['vale'], saveToast: { count: 1 } });
    const after = readPageReducer(before, { type: 'SET_VIEW', view: 'history' });
    expect(after.bank).toEqual(['vale']);
    expect(after.saveToast).toEqual({ count: 1 });
  });
});

// ---------------------------------------------------------------------------
// PASTE_FIELD / PASTE_RESET
// ---------------------------------------------------------------------------

describe('PASTE_FIELD', () => {
  it('updates only the named field', () => {
    const after = readPageReducer(initialState, {
      type: 'PASTE_FIELD',
      field: 'text',
      value: 'había una vez',
    });
    expect(after.paste).toEqual({ title: '', source: '', text: 'había una vez' });
  });

  it('preserves the other paste slots when one updates', () => {
    const before = withState({
      paste: { title: 'BBC', source: 'bbc.com', text: 'antes' },
    });
    const after = readPageReducer(before, {
      type: 'PASTE_FIELD',
      field: 'title',
      value: 'NYT',
    });
    expect(after.paste).toEqual({ title: 'NYT', source: 'bbc.com', text: 'antes' });
  });
});

describe('GENERATE slice', () => {
  it('switches to the generating view and edits generate fields', () => {
    let s = readPageReducer(initialState, { type: 'SET_VIEW', view: 'generating' });
    expect(s.view).toBe('generating');
    s = readPageReducer(s, { type: 'GENERATE_FIELD', field: 'topic', value: 'a cat' });
    expect(s.generate.topic).toBe('a cat');
  });
  it('resets generate state', () => {
    let s = readPageReducer(initialState, { type: 'GENERATE_FIELD', field: 'topic', value: 'x' });
    s = readPageReducer(s, { type: 'GENERATE_RESET' });
    expect(s.generate.topic).toBe('');
  });
});

describe('PASTE_RESET', () => {
  it('clears all three paste fields without touching the rest of the state', () => {
    const before = withState({
      paste: { title: 't', source: 's', text: 'x' },
      bank: ['hola'],
    });
    const after = readPageReducer(before, { type: 'PASTE_RESET' });
    expect(after.paste).toEqual({ title: '', source: '', text: '' });
    expect(after.bank).toEqual(['hola']);
  });
});

// ---------------------------------------------------------------------------
// OPEN_POPOVER / CLOSE_POPOVER
// ---------------------------------------------------------------------------

describe('OPEN_POPOVER', () => {
  it('records the word, x, and y of the click anchor', () => {
    const after = readPageReducer(initialState, {
      type: 'OPEN_POPOVER',
      word: 'aldea',
      x: 120,
      y: 240,
    });
    expect(after.activeWord).toEqual({ word: 'aldea', x: 120, y: 240 });
  });

  it('replaces a previously open popover (no stack)', () => {
    const before = withState({ activeWord: { word: 'a', x: 0, y: 0 } });
    const after = readPageReducer(before, {
      type: 'OPEN_POPOVER',
      word: 'b',
      x: 1,
      y: 2,
    });
    expect(after.activeWord).toEqual({ word: 'b', x: 1, y: 2 });
  });
});

describe('CLOSE_POPOVER', () => {
  it('clears the active word', () => {
    const before = withState({ activeWord: { word: 'aldea', x: 1, y: 2 } });
    const after = readPageReducer(before, { type: 'CLOSE_POPOVER' });
    expect(after.activeWord).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SET_INTENSITY
// ---------------------------------------------------------------------------

describe('SET_INTENSITY', () => {
  it('toggles between subtle and assertive', () => {
    const a = readPageReducer(initialState, {
      type: 'SET_INTENSITY',
      intensity: 'assertive',
    });
    expect(a.intensity).toBe('assertive');
    const b = readPageReducer(a, { type: 'SET_INTENSITY', intensity: 'subtle' });
    expect(b.intensity).toBe('subtle');
  });
});

// ---------------------------------------------------------------------------
// TOGGLE_BANK_WORD / CLEAR_BANK_LOCAL / SET_BANK_FROM_ENTRY
// ---------------------------------------------------------------------------

describe('TOGGLE_BANK_WORD', () => {
  it('adds a word that is not yet in the bank', () => {
    const after = readPageReducer(initialState, {
      type: 'TOGGLE_BANK_WORD',
      word: 'aldea',
    });
    expect(after.bank).toEqual(['aldea']);
  });

  it('removes a word that is already in the bank', () => {
    const before = withState({ bank: ['aldea', 'pueblo'] });
    const after = readPageReducer(before, {
      type: 'TOGGLE_BANK_WORD',
      word: 'aldea',
    });
    expect(after.bank).toEqual(['pueblo']);
  });

  it('preserves existing bank order when adding', () => {
    const before = withState({ bank: ['a', 'b'] });
    const after = readPageReducer(before, {
      type: 'TOGGLE_BANK_WORD',
      word: 'c',
    });
    expect(after.bank).toEqual(['a', 'b', 'c']);
  });
});

describe('CLEAR_BANK_LOCAL', () => {
  it('empties the bank without touching anything else', () => {
    const before = withState({
      bank: ['a', 'b'],
      activeWord: { word: 'a', x: 1, y: 2 },
      view: 'annotated',
    });
    const after = readPageReducer(before, { type: 'CLEAR_BANK_LOCAL' });
    expect(after.bank).toEqual([]);
    expect(after.activeWord).toEqual({ word: 'a', x: 1, y: 2 });
    expect(after.view).toBe('annotated');
  });
});

describe('SET_BANK_FROM_ENTRY', () => {
  it('replaces the bank with a snapshot (rollback path)', () => {
    const before = withState({ bank: ['a', 'b', 'c'] });
    const after = readPageReducer(before, {
      type: 'SET_BANK_FROM_ENTRY',
      bank: ['a', 'b'],
    });
    expect(after.bank).toEqual(['a', 'b']);
  });

  it('does not raise an inline error or touch view state on its own', () => {
    const before = withState({ bank: ['a'], view: 'annotated' });
    const after = readPageReducer(before, {
      type: 'SET_BANK_FROM_ENTRY',
      bank: [],
    });
    expect(after.inlineError).toBeNull();
    expect(after.view).toBe('annotated');
  });
});

// ---------------------------------------------------------------------------
// SHOW_SAVE_TOAST / DISMISS_SAVE_TOAST
// ---------------------------------------------------------------------------

describe('SHOW_SAVE_TOAST', () => {
  it('records the count and clears any prior inline error', () => {
    const before = withState({ inlineError: { kind: 'save' } });
    const after = readPageReducer(before, {
      type: 'SHOW_SAVE_TOAST',
      count: 3,
    });
    expect(after.saveToast).toEqual({ count: 3 });
    expect(after.inlineError).toBeNull();
  });
});

describe('DISMISS_SAVE_TOAST', () => {
  it('clears the toast', () => {
    const before = withState({ saveToast: { count: 3 } });
    const after = readPageReducer(before, { type: 'DISMISS_SAVE_TOAST' });
    expect(after.saveToast).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// SHOW_INLINE_ERROR / DISMISS_INLINE_ERROR
// ---------------------------------------------------------------------------

describe('SHOW_INLINE_ERROR', () => {
  it('records a save-kind error', () => {
    const after = readPageReducer(initialState, {
      type: 'SHOW_INLINE_ERROR',
      kind: 'save',
    });
    expect(after.inlineError).toEqual({ kind: 'save' });
  });

  it('records a bank-kind error', () => {
    const after = readPageReducer(initialState, {
      type: 'SHOW_INLINE_ERROR',
      kind: 'bank',
    });
    expect(after.inlineError).toEqual({ kind: 'bank' });
  });
});

describe('DISMISS_INLINE_ERROR', () => {
  it('clears the inline error', () => {
    const before = withState({ inlineError: { kind: 'bank' } });
    const after = readPageReducer(before, { type: 'DISMISS_INLINE_ERROR' });
    expect(after.inlineError).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// LOAD_ENTRY
// ---------------------------------------------------------------------------

describe('LOAD_ENTRY', () => {
  it('switches to the annotated view and pins the entry id', () => {
    const after = readPageReducer(initialState, {
      type: 'LOAD_ENTRY',
      entryId: 'e1',
    });
    expect(after.view).toBe('annotated');
    expect(after.activeEntryId).toBe('e1');
  });

  it('clears popover, save toast, and inline error in one step', () => {
    const before = withState({
      view: 'history',
      activeWord: { word: 'aldea', x: 1, y: 2 },
      saveToast: { count: 4 },
      inlineError: { kind: 'bank' },
    });
    const after = readPageReducer(before, {
      type: 'LOAD_ENTRY',
      entryId: 'e2',
    });
    expect(after.activeWord).toBeNull();
    expect(after.saveToast).toBeNull();
    expect(after.inlineError).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ENTRY_PERSISTED
// ---------------------------------------------------------------------------

describe('ENTRY_PERSISTED', () => {
  it('sets the active entry id and raises the save toast with the bank count in one step', () => {
    const before = withState({ bank: ['a', 'b', 'c'], activeEntryId: null });
    const after = readPageReducer(before, {
      type: 'ENTRY_PERSISTED',
      entryId: 'new-id',
    });
    expect(after.activeEntryId).toBe('new-id');
    expect(after.saveToast).toEqual({ count: 3 });
  });

  it('clears any prior inline save error', () => {
    const before = withState({
      bank: ['a'],
      inlineError: { kind: 'save' },
    });
    const after = readPageReducer(before, {
      type: 'ENTRY_PERSISTED',
      entryId: 'id',
    });
    expect(after.inlineError).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

describe('selectShouldShowEmpty', () => {
  it('returns true when the view is "empty"', () => {
    expect(selectShouldShowEmpty(initialState, 0)).toBe(true);
    expect(selectShouldShowEmpty(initialState, 5)).toBe(true);
  });

  it('returns true when the view is "annotated" but no entries exist and no entry is pinned', () => {
    const state = withState({ view: 'annotated', activeEntryId: null });
    expect(selectShouldShowEmpty(state, 0)).toBe(true);
  });

  it('returns false when the view is "annotated" and an entry is pinned', () => {
    const state = withState({ view: 'annotated', activeEntryId: 'e1' });
    expect(selectShouldShowEmpty(state, 0)).toBe(false);
  });

  it('returns false on the pasting and history views regardless of count', () => {
    expect(selectShouldShowEmpty(withState({ view: 'pasting' }), 0)).toBe(false);
    expect(selectShouldShowEmpty(withState({ view: 'history' }), 0)).toBe(false);
  });
});

describe('selectShouldShowAnnotatedSkeleton', () => {
  it('returns true while a pinned entry is loading on the annotated view', () => {
    const state = withState({ view: 'annotated', activeEntryId: 'e1' });
    expect(selectShouldShowAnnotatedSkeleton(state, { isLoading: true })).toBe(true);
  });

  it('returns false when the query has resolved', () => {
    const state = withState({ view: 'annotated', activeEntryId: 'e1' });
    expect(selectShouldShowAnnotatedSkeleton(state, { isLoading: false })).toBe(false);
  });

  it('returns false when no entry is pinned (initial annotation path)', () => {
    const state = withState({ view: 'annotated', activeEntryId: null });
    expect(selectShouldShowAnnotatedSkeleton(state, { isLoading: true })).toBe(false);
  });

  it('returns false on non-annotated views', () => {
    const state = withState({ view: 'pasting', activeEntryId: 'e1' });
    expect(selectShouldShowAnnotatedSkeleton(state, { isLoading: true })).toBe(false);
  });
});

describe('selectActiveEntry', () => {
  const a = { id: 'a', label: 'first' };
  const b = { id: 'b', label: 'second' };

  it('returns the entry matching activeEntryId when set', () => {
    const state = withState({ activeEntryId: 'b' });
    expect(selectActiveEntry(state, [a, b], a)).toEqual(b);
  });

  it('returns null when activeEntryId points at a missing id', () => {
    const state = withState({ activeEntryId: 'missing' });
    expect(selectActiveEntry(state, [a, b], a)).toBeNull();
  });

  it('falls back to mostRecent when activeEntryId is null', () => {
    const state = withState({ activeEntryId: null });
    expect(selectActiveEntry(state, [a, b], a)).toEqual(a);
  });

  it('returns null when no entries and no most-recent fallback', () => {
    const state = withState({ activeEntryId: null });
    expect(selectActiveEntry(state, [], null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Streaming-annotate slice + ANNOTATE_* actions
// ---------------------------------------------------------------------------

const ALDEA_FLAG: WordFlag = {
  lemma: 'aldea',
  pos: 'noun',
  gloss: 'small village',
  example: 'Visitamos la aldea ayer.',
  freq: 4200,
  cefr: 'B2',
};
const INDIFERENCIA_FLAG: WordFlag = {
  lemma: 'indiferencia',
  pos: 'noun',
  gloss: 'indifference',
  example: 'Su indiferencia me sorprendió.',
  freq: 5800,
  cefr: 'B2',
};

describe('ANNOTATE_START', () => {
  it('transitions the slice from idle to streaming with empty accumulators', () => {
    const after = readPageReducer(initialState, { type: 'ANNOTATE_START' });

    expect(after.annotateStream).toEqual({
      phase: 'streaming',
      candidateCount: 0,
      flaggedMap: {},
      flaggedCount: 0,
      calibration: { cefr: 'B1', top: 0 },
    });
  });

  it('discards prior accumulators when called from complete or error', () => {
    const before = withState({
      annotateStream: {
        phase: 'complete',
        candidateCount: 5,
        flaggedMap: { aldea: ALDEA_FLAG },
        flaggedCount: 1,
        calibration: { cefr: 'B2', top: 5000 },
      },
    });
    const after = readPageReducer(before, { type: 'ANNOTATE_START' });

    expect(after.annotateStream.phase).toBe('streaming');
    if (after.annotateStream.phase !== 'streaming') throw new Error('phase');
    expect(after.annotateStream.flaggedMap).toEqual({});
    expect(after.annotateStream.flaggedCount).toBe(0);
  });

  it('detaches from a previously loaded entry so a fresh paste renders ephemerally', () => {
    // Regression: pasting a new text and clicking Annotate while a history
    // entry was open used to keep `activeEntryId` bound, so the persisted entry
    // won the render and the old text reopened instead of the pasted one.
    const before = withState({ activeEntryId: 'history-entry-1' });
    const after = readPageReducer(before, { type: 'ANNOTATE_START' });
    expect(after.activeEntryId).toBeNull();
  });
});

describe('ANNOTATE_META', () => {
  it('fills in calibration + candidateCount on a streaming slice', () => {
    const started = readPageReducer(initialState, { type: 'ANNOTATE_START' });
    const after = readPageReducer(started, {
      type: 'ANNOTATE_META',
      calibration: { cefr: 'B1', top: 3000 },
      candidateCount: 12,
    });

    expect(after.annotateStream.phase).toBe('streaming');
    if (after.annotateStream.phase !== 'streaming') throw new Error('phase');
    expect(after.annotateStream.calibration).toEqual({ cefr: 'B1', top: 3000 });
    expect(after.annotateStream.candidateCount).toBe(12);
  });

  it('is a no-op when the slice is not in `streaming`', () => {
    const before = withState({ annotateStream: { phase: 'idle' } });
    const after = readPageReducer(before, {
      type: 'ANNOTATE_META',
      calibration: { cefr: 'B1', top: 3000 },
      candidateCount: 12,
    });
    expect(after.annotateStream).toEqual({ phase: 'idle' });
  });
});

describe('ANNOTATE_FLAG', () => {
  it('appends to flaggedMap and increments flaggedCount', () => {
    let state = readPageReducer(initialState, { type: 'ANNOTATE_START' });
    state = readPageReducer(state, {
      type: 'ANNOTATE_META',
      calibration: { cefr: 'B1', top: 3000 },
      candidateCount: 2,
    });
    state = readPageReducer(state, {
      type: 'ANNOTATE_FLAG',
      matchedForm: 'aldea',
      flag: ALDEA_FLAG,
    });

    if (state.annotateStream.phase !== 'streaming') throw new Error('phase');
    expect(state.annotateStream.flaggedMap).toEqual({ aldea: ALDEA_FLAG });
    expect(state.annotateStream.flaggedCount).toBe(1);

    state = readPageReducer(state, {
      type: 'ANNOTATE_FLAG',
      matchedForm: 'indiferencia',
      flag: INDIFERENCIA_FLAG,
    });
    if (state.annotateStream.phase !== 'streaming') throw new Error('phase');
    expect(Object.keys(state.annotateStream.flaggedMap)).toEqual([
      'aldea',
      'indiferencia',
    ]);
    expect(state.annotateStream.flaggedCount).toBe(2);
  });

  it('is a no-op when the slice is not in `streaming`', () => {
    const before = withState({ annotateStream: { phase: 'idle' } });
    const after = readPageReducer(before, {
      type: 'ANNOTATE_FLAG',
      matchedForm: 'aldea',
      flag: ALDEA_FLAG,
    });
    expect(after.annotateStream).toEqual({ phase: 'idle' });
  });
});

describe('ANNOTATE_DONE', () => {
  it('transitions streaming → complete, preserving accumulators', () => {
    let state = readPageReducer(initialState, { type: 'ANNOTATE_START' });
    state = readPageReducer(state, {
      type: 'ANNOTATE_META',
      calibration: { cefr: 'B1', top: 3000 },
      candidateCount: 3,
    });
    state = readPageReducer(state, {
      type: 'ANNOTATE_FLAG',
      matchedForm: 'aldea',
      flag: ALDEA_FLAG,
    });
    state = readPageReducer(state, { type: 'ANNOTATE_DONE', flaggedCount: 1 });

    expect(state.annotateStream).toEqual({
      phase: 'complete',
      candidateCount: 3,
      flaggedMap: { aldea: ALDEA_FLAG },
      flaggedCount: 1,
      calibration: { cefr: 'B1', top: 3000 },
    });
  });

  it('is a no-op when the slice is not in `streaming`', () => {
    const before = withState({ annotateStream: { phase: 'idle' } });
    const after = readPageReducer(before, { type: 'ANNOTATE_DONE', flaggedCount: 0 });
    expect(after.annotateStream).toEqual({ phase: 'idle' });
  });
});

describe('ANNOTATE_ERROR', () => {
  it('preserves the streaming accumulators (Req 5.10 partial-flag retention)', () => {
    let state = readPageReducer(initialState, { type: 'ANNOTATE_START' });
    state = readPageReducer(state, {
      type: 'ANNOTATE_META',
      calibration: { cefr: 'B1', top: 3000 },
      candidateCount: 4,
    });
    state = readPageReducer(state, {
      type: 'ANNOTATE_FLAG',
      matchedForm: 'aldea',
      flag: ALDEA_FLAG,
    });
    state = readPageReducer(state, {
      type: 'ANNOTATE_ERROR',
      error: { code: 'AI_UNAVAILABLE', message: 'Evaluation temporarily unavailable' },
    });

    expect(state.annotateStream.phase).toBe('error');
    if (state.annotateStream.phase !== 'error') throw new Error('phase');
    expect(state.annotateStream.flaggedMap).toEqual({ aldea: ALDEA_FLAG });
    expect(state.annotateStream.flaggedCount).toBe(1);
    expect(state.annotateStream.calibration).toEqual({ cefr: 'B1', top: 3000 });
    expect(state.annotateStream.candidateCount).toBe(4);
    expect(state.annotateStream.error.code).toBe('AI_UNAVAILABLE');
  });

  it('produces empty accumulators when the slice was idle (e.g. pre-stream 429)', () => {
    const after = readPageReducer(initialState, {
      type: 'ANNOTATE_ERROR',
      error: { code: 'RATE_LIMIT_EXCEEDED', message: 'Slow down', status: 429 },
    });
    expect(after.annotateStream.phase).toBe('error');
    if (after.annotateStream.phase !== 'error') throw new Error('phase');
    expect(after.annotateStream.flaggedMap).toEqual({});
    expect(after.annotateStream.flaggedCount).toBe(0);
    expect(after.annotateStream.error.status).toBe(429);
  });
});

describe('ANNOTATE_RESET', () => {
  it('returns the slice to idle from any phase', () => {
    const before = withState({
      annotateStream: {
        phase: 'complete',
        candidateCount: 2,
        flaggedMap: { aldea: ALDEA_FLAG },
        flaggedCount: 1,
        calibration: { cefr: 'B1', top: 3000 },
      },
    });
    const after = readPageReducer(before, { type: 'ANNOTATE_RESET' });
    expect(after.annotateStream).toEqual({ phase: 'idle' });
  });
});

// ---------------------------------------------------------------------------
// selectFlaggedMap
// ---------------------------------------------------------------------------

describe('selectFlaggedMap', () => {
  const persisted: FlaggedMap = { historical: ALDEA_FLAG };
  const live: FlaggedMap = { aldea: ALDEA_FLAG };

  it('falls back to the persisted entry while the slice is idle', () => {
    const state = withState({ annotateStream: { phase: 'idle' } });
    expect(selectFlaggedMap(state, persisted)).toEqual(persisted);
  });

  it('returns the live slice during streaming', () => {
    const state = withState({
      annotateStream: {
        phase: 'streaming',
        candidateCount: 1,
        flaggedMap: live,
        flaggedCount: 1,
        calibration: { cefr: 'B1', top: 3000 },
      },
    });
    expect(selectFlaggedMap(state, persisted)).toEqual(live);
  });

  it('returns the live slice on complete (post-stream, pre-history)', () => {
    const state = withState({
      annotateStream: {
        phase: 'complete',
        candidateCount: 1,
        flaggedMap: live,
        flaggedCount: 1,
        calibration: { cefr: 'B1', top: 3000 },
      },
    });
    expect(selectFlaggedMap(state, persisted)).toEqual(live);
  });

  it('returns the live (partial) slice on error', () => {
    const state = withState({
      annotateStream: {
        phase: 'error',
        flaggedMap: live,
        flaggedCount: 1,
        error: { code: 'AI_UNAVAILABLE', message: 'x' },
      },
    });
    expect(selectFlaggedMap(state, persisted)).toEqual(live);
  });

  it('returns {} when both the slice is idle and the persisted entry is null', () => {
    const state = withState({ annotateStream: { phase: 'idle' } });
    expect(selectFlaggedMap(state, null)).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// deep-card slice (Req 9.3, 9.4, 11.4)
// ---------------------------------------------------------------------------

const WORD_SPAN: DeepSpan = { start: 3, end: 7, type: 'word', x: 10, y: 20 };

const WORD_CARD: DeepCard = {
  type: 'word',
  surface: 'casa',
  lemma: 'casa',
  pos: 'noun',
  contextualSense: 'house',
  definition: 'edificio para vivir',
  definitionLabel: 'Español',
  cefr: 'A1',
  freq: 120,
};

describe('initialState — deep card', () => {
  it('starts idle with empty span annotations', () => {
    expect(initialState.deepCard).toEqual({ status: 'idle' });
    expect(initialState.spanAnnotations).toEqual({});
  });
});

describe('OPEN_DEEP_CARD', () => {
  it('opens `loading` for an uncached span (Req 9.3)', () => {
    const state = readPageReducer(initialState, {
      type: 'OPEN_DEEP_CARD',
      span: WORD_SPAN,
    });
    expect(state.deepCard).toEqual({ status: 'loading', span: WORD_SPAN, partial: {} });
  });

  it('opens `loaded` instantly from cache for a span already in spanAnnotations (Req 11.4)', () => {
    const seeded = withState({
      spanAnnotations: { [spanKey(3, 7)]: WORD_CARD },
    });
    const state = readPageReducer(seeded, {
      type: 'OPEN_DEEP_CARD',
      span: WORD_SPAN,
    });
    expect(state.deepCard).toEqual({
      status: 'loaded',
      span: WORD_SPAN,
      card: WORD_CARD,
    });
  });
});

describe('DEEP_CARD_FIELD', () => {
  it('merges a streamed field into the open loading card partial (Req 1.2)', () => {
    const loading = withState({
      deepCard: { status: 'loading', span: WORD_SPAN, partial: {} },
    });
    const state = readPageReducer(loading, {
      type: 'DEEP_CARD_FIELD',
      span: WORD_SPAN,
      key: 'definition',
      value: 'edificio para vivir',
    });
    expect(state.deepCard).toEqual({
      status: 'loading',
      span: WORD_SPAN,
      partial: { definition: 'edificio para vivir' },
    });
  });

  it('accumulates multiple fields in order', () => {
    let state = withState({
      deepCard: { status: 'loading', span: WORD_SPAN, partial: {} },
    });
    state = readPageReducer(state, {
      type: 'DEEP_CARD_FIELD',
      span: WORD_SPAN,
      key: 'type',
      value: 'word',
    });
    state = readPageReducer(state, {
      type: 'DEEP_CARD_FIELD',
      span: WORD_SPAN,
      key: 'definition',
      value: 'edificio',
    });
    expect(state.deepCard).toEqual({
      status: 'loading',
      span: WORD_SPAN,
      partial: { type: 'word', definition: 'edificio' },
    });
  });

  it('ignores a field for a span that is not the open one', () => {
    const otherSpan: DeepSpan = { start: 9, end: 15, type: 'word', x: 0, y: 0 };
    const loading = withState({
      deepCard: { status: 'loading', span: otherSpan, partial: {} },
    });
    const state = readPageReducer(loading, {
      type: 'DEEP_CARD_FIELD',
      span: WORD_SPAN,
      key: 'definition',
      value: 'edificio',
    });
    expect(state.deepCard).toEqual({
      status: 'loading',
      span: otherSpan,
      partial: {},
    });
  });

  it('ignores a field when the slice is not loading (e.g. already loaded)', () => {
    const loaded = withState({
      deepCard: { status: 'loaded', span: WORD_SPAN, card: WORD_CARD },
    });
    const state = readPageReducer(loaded, {
      type: 'DEEP_CARD_FIELD',
      span: WORD_SPAN,
      key: 'definition',
      value: 'overwrite',
    });
    expect(state.deepCard).toEqual({
      status: 'loaded',
      span: WORD_SPAN,
      card: WORD_CARD,
    });
  });
});

describe('DEEP_CARD_RESOLVED', () => {
  it('sets `loaded` and caches the card when it matches the open span (Req 3.5)', () => {
    const loading = withState({ deepCard: { status: 'loading', span: WORD_SPAN, partial: {} } });
    const state = readPageReducer(loading, {
      type: 'DEEP_CARD_RESOLVED',
      span: WORD_SPAN,
      card: WORD_CARD,
    });
    expect(state.deepCard).toEqual({
      status: 'loaded',
      span: WORD_SPAN,
      card: WORD_CARD,
    });
    expect(state.spanAnnotations[spanKey(3, 7)]).toEqual(WORD_CARD);
  });

  it('still caches but does not replace the visible card for a non-matching span', () => {
    const otherSpan: DeepSpan = { start: 9, end: 15, type: 'word', x: 0, y: 0 };
    const loading = withState({ deepCard: { status: 'loading', span: otherSpan, partial: {} } });
    const state = readPageReducer(loading, {
      type: 'DEEP_CARD_RESOLVED',
      span: WORD_SPAN,
      card: WORD_CARD,
    });
    // Cached for a future tap…
    expect(state.spanAnnotations[spanKey(3, 7)]).toEqual(WORD_CARD);
    // …but the open card (a different span) is untouched.
    expect(state.deepCard).toEqual({ status: 'loading', span: otherSpan, partial: {} });
  });

  it('caches a resolve that arrives after dismissal (idle), without reopening', () => {
    const state = readPageReducer(initialState, {
      type: 'DEEP_CARD_RESOLVED',
      span: WORD_SPAN,
      card: WORD_CARD,
    });
    expect(state.spanAnnotations[spanKey(3, 7)]).toEqual(WORD_CARD);
    expect(state.deepCard).toEqual({ status: 'idle' });
  });
});

describe('DEEP_CARD_ERROR', () => {
  it('sets `error` when it matches the open span (Req 9.4)', () => {
    const loading = withState({ deepCard: { status: 'loading', span: WORD_SPAN, partial: {} } });
    const error = { code: 'AI_UNAVAILABLE', message: 'boom' };
    const state = readPageReducer(loading, {
      type: 'DEEP_CARD_ERROR',
      span: WORD_SPAN,
      error,
    });
    expect(state.deepCard).toEqual({ status: 'error', span: WORD_SPAN, error });
  });

  it('ignores an error for a span that is no longer open', () => {
    const otherSpan: DeepSpan = { start: 9, end: 15, type: 'word', x: 0, y: 0 };
    const loading = withState({ deepCard: { status: 'loading', span: otherSpan, partial: {} } });
    const state = readPageReducer(loading, {
      type: 'DEEP_CARD_ERROR',
      span: WORD_SPAN,
      error: { code: 'AI_UNAVAILABLE', message: 'boom' },
    });
    expect(state.deepCard).toEqual({ status: 'loading', span: otherSpan, partial: {} });
  });
});

describe('DISMISS_DEEP_CARD', () => {
  it('returns the slice to idle', () => {
    const loaded = withState({
      deepCard: { status: 'loaded', span: WORD_SPAN, card: WORD_CARD },
    });
    const state = readPageReducer(loaded, { type: 'DISMISS_DEEP_CARD' });
    expect(state.deepCard).toEqual({ status: 'idle' });
  });
});

describe('SET_SPAN_ANNOTATIONS', () => {
  it('merges the loaded entry annotations into state (Req 11.3)', () => {
    const seeded = withState({ spanAnnotations: { [spanKey(3, 7)]: WORD_CARD } });
    const otherCard: DeepCard = { ...WORD_CARD, surface: 'grande', lemma: 'grande' };
    const state = readPageReducer(seeded, {
      type: 'SET_SPAN_ANNOTATIONS',
      spanAnnotations: { [spanKey(9, 15)]: otherCard },
    });
    expect(state.spanAnnotations).toEqual({
      [spanKey(3, 7)]: WORD_CARD,
      [spanKey(9, 15)]: otherCard,
    });
  });
});

describe('deep-card reset on new passage', () => {
  it('LOAD_ENTRY clears the deep card and the prior entry span annotations', () => {
    const dirty = withState({
      deepCard: { status: 'loaded', span: WORD_SPAN, card: WORD_CARD },
      spanAnnotations: { [spanKey(3, 7)]: WORD_CARD },
    });
    const state = readPageReducer(dirty, { type: 'LOAD_ENTRY', entryId: 'e1' });
    expect(state.deepCard).toEqual({ status: 'idle' });
    expect(state.spanAnnotations).toEqual({});
  });

  it('ANNOTATE_START clears the deep card and span annotations for the new passage', () => {
    const dirty = withState({
      deepCard: { status: 'loading', span: WORD_SPAN, partial: {} },
      spanAnnotations: { [spanKey(3, 7)]: WORD_CARD },
    });
    const state = readPageReducer(dirty, { type: 'ANNOTATE_START' });
    expect(state.deepCard).toEqual({ status: 'idle' });
    expect(state.spanAnnotations).toEqual({});
  });
});
