// ---------------------------------------------------------------------------
// read-page-reducer — page-level state machine for /read
// ---------------------------------------------------------------------------
// Coordinates the four views (empty / pasting / annotated / history), the
// transient popover + intensity state, the local bank between save events,
// and the two notification layers (save toast, inline error toast).
//
// Pure function — no side effects, no async work. The page binds it via
// `useReducer`; auto-dismiss timers and mutation invalidations live in the
// page component (Phase J task 33).
//
// Discriminated-union pattern matches `session-reducer.ts` in the drill
// vertical slice.
// ---------------------------------------------------------------------------

import type { FlaggedMap, WordFlag } from '@language-drill/shared';

export type View = 'empty' | 'pasting' | 'annotated' | 'history';

export type Intensity = 'subtle' | 'assertive';

export type ActiveWord = { word: string; x: number; y: number };

// ---------------------------------------------------------------------------
// Streaming-annotate slice (more-responsive-reading spec, Req 5.3–5.6)
// ---------------------------------------------------------------------------
// Mirrors `AnnotateStreamState` exposed by `useReadAnnotateStream`. The page
// owns this slice (rather than reading the hook's state directly) so that
// `flaggedMap` for the annotated view has a single source of truth —
// `selectFlaggedMap` below prefers this slice while a stream is in flight
// AND falls back to the persisted entry's `flaggedWords` when viewing
// history.

export type AnnotateCalibration = {
  cefr: 'A1' | 'A2' | 'B1' | 'B2' | 'C1' | 'C2';
  top: number;
};

export type AnnotateError = {
  code: string;
  message: string;
  status?: number;
};

export type AnnotateStreamSlice =
  | { phase: 'idle' }
  | {
      phase: 'streaming';
      candidateCount: number;
      flaggedMap: FlaggedMap;
      flaggedCount: number;
      calibration: AnnotateCalibration;
    }
  | {
      phase: 'complete';
      candidateCount: number;
      flaggedMap: FlaggedMap;
      flaggedCount: number;
      calibration: AnnotateCalibration;
    }
  | {
      phase: 'error';
      candidateCount?: number;
      flaggedMap: FlaggedMap;
      flaggedCount: number;
      calibration?: AnnotateCalibration;
      error: AnnotateError;
    };

export type ReadPageState = {
  view: View;
  paste: { title: string; source: string; text: string };
  /** `null` while the most-recent entry is still being resolved from the entries query. */
  activeEntryId: string | null;
  /** Local bank — diverges from the saved entry between explicit save events. */
  bank: string[];
  activeWord: ActiveWord | null;
  intensity: Intensity;
  saveToast: { count: number } | null;
  inlineError: { kind: 'save' | 'bank' } | null;
  annotateStream: AnnotateStreamSlice;
};

export type Action =
  | { type: 'SET_VIEW'; view: View }
  | { type: 'PASTE_FIELD'; field: 'title' | 'source' | 'text'; value: string }
  | { type: 'PASTE_RESET' }
  | { type: 'OPEN_POPOVER'; word: string; x: number; y: number }
  | { type: 'CLOSE_POPOVER' }
  | { type: 'SET_INTENSITY'; intensity: Intensity }
  | { type: 'TOGGLE_BANK_WORD'; word: string }
  | { type: 'CLEAR_BANK_LOCAL' }
  | { type: 'SET_BANK_FROM_ENTRY'; bank: string[] }
  | { type: 'SHOW_SAVE_TOAST'; count: number }
  | { type: 'DISMISS_SAVE_TOAST' }
  | { type: 'SHOW_INLINE_ERROR'; kind: 'save' | 'bank' }
  | { type: 'DISMISS_INLINE_ERROR' }
  | { type: 'LOAD_ENTRY'; entryId: string }
  | { type: 'ENTRY_PERSISTED'; entryId: string }
  | { type: 'ANNOTATE_START' }
  | { type: 'ANNOTATE_META'; calibration: AnnotateCalibration; candidateCount: number }
  | { type: 'ANNOTATE_FLAG'; matchedForm: string; flag: WordFlag }
  | { type: 'ANNOTATE_DONE'; flaggedCount: number }
  | { type: 'ANNOTATE_ERROR'; error: AnnotateError }
  | { type: 'ANNOTATE_RESET' };

export const initialState: ReadPageState = {
  view: 'empty',
  paste: { title: '', source: '', text: '' },
  activeEntryId: null,
  bank: [],
  activeWord: null,
  intensity: 'subtle',
  saveToast: null,
  inlineError: null,
  annotateStream: { phase: 'idle' },
};

// Streaming starts with empty accumulators and a placeholder calibration —
// META overwrites the placeholder before any flag arrives.
const STREAMING_PLACEHOLDER: Extract<AnnotateStreamSlice, { phase: 'streaming' }> = {
  phase: 'streaming',
  candidateCount: 0,
  flaggedMap: {},
  flaggedCount: 0,
  calibration: { cefr: 'B1', top: 0 },
};

export function readPageReducer(state: ReadPageState, action: Action): ReadPageState {
  switch (action.type) {
    case 'SET_VIEW':
      return { ...state, view: action.view, activeWord: null };

    case 'PASTE_FIELD':
      return {
        ...state,
        paste: { ...state.paste, [action.field]: action.value },
      };

    case 'PASTE_RESET':
      return {
        ...state,
        paste: { title: '', source: '', text: '' },
      };

    case 'OPEN_POPOVER':
      return {
        ...state,
        activeWord: { word: action.word, x: action.x, y: action.y },
      };

    case 'CLOSE_POPOVER':
      return { ...state, activeWord: null };

    case 'SET_INTENSITY':
      return { ...state, intensity: action.intensity };

    case 'TOGGLE_BANK_WORD': {
      const has = state.bank.includes(action.word);
      const bank = has
        ? state.bank.filter((w) => w !== action.word)
        : [...state.bank, action.word];
      return { ...state, bank };
    }

    case 'CLEAR_BANK_LOCAL':
      return { ...state, bank: [] };

    case 'SET_BANK_FROM_ENTRY':
      // Rollback action: replaces local bank with the snapshot the page held
      // before an optimistic update. Never touches view / popover / toasts.
      return { ...state, bank: action.bank };

    case 'SHOW_SAVE_TOAST':
      return {
        ...state,
        saveToast: { count: action.count },
        inlineError: null,
      };

    case 'DISMISS_SAVE_TOAST':
      return { ...state, saveToast: null };

    case 'SHOW_INLINE_ERROR':
      return { ...state, inlineError: { kind: action.kind } };

    case 'DISMISS_INLINE_ERROR':
      return { ...state, inlineError: null };

    case 'LOAD_ENTRY':
      // A freshly-loaded entry should land in a clean state: clear popover,
      // pending save toast, and any prior inline error.
      return {
        ...state,
        view: 'annotated',
        activeEntryId: action.entryId,
        activeWord: null,
        saveToast: null,
        inlineError: null,
      };

    case 'ENTRY_PERSISTED':
      // Post-`POST /read/entries` success: bind the new id so subsequent bank
      // toggles fire `PUT /read/entries/:id/bank`, AND raise the save toast in
      // the same step (so the page does not need a follow-up dispatch). The
      // toast count comes from the bank length at the moment the request
      // resolved — every banked word landed in the persisted row.
      return {
        ...state,
        activeEntryId: action.entryId,
        saveToast: { count: state.bank.length },
        inlineError: null,
      };

    case 'ANNOTATE_START':
      // Aborts the slice's prior accumulators; the next META/FLAG fills it in.
      return { ...state, annotateStream: STREAMING_PLACEHOLDER };

    case 'ANNOTATE_META':
      // Ignored outside `streaming` — defensive against an out-of-order
      // sync from the hook's useEffect.
      if (state.annotateStream.phase !== 'streaming') return state;
      return {
        ...state,
        annotateStream: {
          ...state.annotateStream,
          calibration: action.calibration,
          candidateCount: action.candidateCount,
        },
      };

    case 'ANNOTATE_FLAG':
      if (state.annotateStream.phase !== 'streaming') return state;
      return {
        ...state,
        annotateStream: {
          ...state.annotateStream,
          flaggedMap: {
            ...state.annotateStream.flaggedMap,
            [action.matchedForm]: action.flag,
          },
          flaggedCount: state.annotateStream.flaggedCount + 1,
        },
      };

    case 'ANNOTATE_DONE':
      if (state.annotateStream.phase !== 'streaming') return state;
      return {
        ...state,
        annotateStream: {
          phase: 'complete',
          candidateCount: state.annotateStream.candidateCount,
          flaggedMap: state.annotateStream.flaggedMap,
          flaggedCount: action.flaggedCount,
          calibration: state.annotateStream.calibration,
        },
      };

    case 'ANNOTATE_ERROR': {
      // Carry the streaming accumulators (`flaggedMap`, calibration, etc.)
      // into the error state so partial flags stay visible (Req 5.10).
      const prev = state.annotateStream;
      const carry =
        prev.phase === 'streaming' || prev.phase === 'complete'
          ? {
              candidateCount: prev.candidateCount,
              flaggedMap: prev.flaggedMap,
              flaggedCount: prev.flaggedCount,
              calibration: prev.calibration,
            }
          : { flaggedMap: {} as FlaggedMap, flaggedCount: 0 };
      return {
        ...state,
        annotateStream: { phase: 'error', ...carry, error: action.error },
      };
    }

    case 'ANNOTATE_RESET':
      return { ...state, annotateStream: { phase: 'idle' } };

    default: {
      const _exhaustive: never = action;
      throw new Error(`unknown read action: ${String(_exhaustive)}`);
    }
  }
}

// ---------------------------------------------------------------------------
// Selectors
// ---------------------------------------------------------------------------

/**
 * EmptyView renders when the user has explicitly navigated to the empty view
 * OR when the page wants to show annotated content but the user has zero
 * entries for the active language (defensive — covers race between mount and
 * the entries query resolving).
 */
export function selectShouldShowEmpty(
  state: ReadPageState,
  entriesCount: number,
): boolean {
  if (state.view === 'empty') return true;
  if (state.view === 'annotated' && entriesCount === 0 && state.activeEntryId === null) {
    return true;
  }
  return false;
}

/**
 * The annotated skeleton renders while a previously-saved entry is being
 * fetched (history click, language switch). Initial annotation stays in the
 * pasting view until the mutation resolves, so this selector only fires on
 * `useReadEntry` loads.
 */
export function selectShouldShowAnnotatedSkeleton(
  state: ReadPageState,
  entryQuery: { isLoading: boolean },
): boolean {
  return (
    state.view === 'annotated' &&
    state.activeEntryId !== null &&
    entryQuery.isLoading
  );
}

/**
 * Resolve the entry the annotated view should render. Falls back to
 * `mostRecent` (the head of the entries list) when no explicit entry is
 * pinned — the auto-resolution case from Requirement 1.4.
 */
export function selectActiveEntry<T extends { id: string }>(
  state: ReadPageState,
  entries: readonly T[],
  mostRecent: T | null,
): T | null {
  if (state.activeEntryId !== null) {
    return entries.find((e) => e.id === state.activeEntryId) ?? null;
  }
  return mostRecent;
}

/**
 * Resolve the `flaggedMap` for the annotated view. Prefers the live stream
 * slice while a stream is in flight (any phase other than `idle`); falls
 * back to the persisted entry's `flaggedWords` when viewing history.
 *
 * more-responsive-reading Req 5.3 / 5.5 (live render during streaming) +
 * Req 5.10 (partial flags retained on error).
 */
export function selectFlaggedMap(
  state: ReadPageState,
  persistedFlaggedWords: FlaggedMap | null | undefined,
): FlaggedMap {
  if (state.annotateStream.phase !== 'idle') {
    return state.annotateStream.flaggedMap;
  }
  return persistedFlaggedWords ?? {};
}
