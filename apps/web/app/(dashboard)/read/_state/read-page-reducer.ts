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

import { CefrLevel, ReadingTextLength } from '@language-drill/shared';
import type {
  DeepCard,
  FlaggedMap,
  SpanAnnotations,
  WordFlag,
} from '@language-drill/shared';

export type View = 'empty' | 'pasting' | 'generating' | 'annotated' | 'history';

export type Intensity = 'subtle' | 'assertive';

export type ActiveWord = { word: string; x: number; y: number };

// ---------------------------------------------------------------------------
// Deep-annotation slice (reading-deep-annotation spec, Req 9.3, 9.4, 11.4)
// ---------------------------------------------------------------------------
// The on-demand deep card is a small state machine over a single active span.
// `OPEN_DEEP_CARD` arms it: a span already present in `spanAnnotations` renders
// instantly as `loaded` (Req 11.4); otherwise it opens `loading` while the page
// streams the card via `useReadAnnotateSpanStream` (Req 9.3). `DEEP_CARD_FIELD`
// fills the `loading` slice's `partial` field-by-field (Req 1.2);
// `DEEP_CARD_RESOLVED`/`DEEP_CARD_ERROR` settle it (Req 9.4, 1.3), and every
// resolve is merged into `spanAnnotations` so a re-tap within the session is
// served from cache with no new model call (Req 3.5). The span type is the
// client hint; the server is authoritative.

/** Span shapes a deep card can take — kept in lockstep with the shared union. */
export type SpanType = DeepCard['type'];

/** An active span: its character offsets, type, and container-relative anchor. */
export type DeepSpan = {
  start: number;
  end: number;
  type: SpanType;
  /** Anchor position relative to the rd-text container (mirrors ActiveWord). */
  x: number;
  y: number;
};

export type DeepCardSlice =
  | { status: 'idle' }
  // `loading` is the streaming state: the card opens immediately and fills in
  // field-by-field as `DEEP_CARD_FIELD` events arrive (Req 1.2). `partial` is
  // the progressively-built preview; the authoritative card lands via
  // `DEEP_CARD_RESOLVED` (Req 1.3).
  | { status: 'loading'; span: DeepSpan; partial: Partial<DeepCard> }
  | { status: 'loaded'; span: DeepSpan; card: DeepCard }
  | { status: 'error'; span: DeepSpan; error: AnnotateError };

/** Cache key for a span within `spanAnnotations` — matches the server's. */
export function spanKey(start: number, end: number): string {
  return `${start}:${end}`;
}

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
  /** Generate-launchpad form fields (reading text generation). */
  generate: {
    topic: string;
    length: ReadingTextLength;
    cefr: CefrLevel;
    language: 'ES' | 'DE' | 'TR';
  };
  /** `null` while the most-recent entry is still being resolved from the entries query. */
  activeEntryId: string | null;
  /** Local bank — diverges from the saved entry between explicit save events. */
  bank: string[];
  activeWord: ActiveWord | null;
  intensity: Intensity;
  saveToast: { count: number } | null;
  inlineError: { kind: 'save' | 'bank' } | null;
  annotateStream: AnnotateStreamSlice;
  /** On-demand deep-annotation card state machine (Req 9.3, 9.4). */
  deepCard: DeepCardSlice;
  /**
   * Resolved deep cards for the open passage, keyed by "start:end". Seeded from
   * a loaded saved entry (Req 11.3) and grown as spans resolve in-session
   * (Req 3.5); the `OPEN_DEEP_CARD` cache check reads it (Req 11.4).
   */
  spanAnnotations: SpanAnnotations;
};

export type Action =
  | { type: 'SET_VIEW'; view: View }
  | { type: 'PASTE_FIELD'; field: 'title' | 'source' | 'text'; value: string }
  | { type: 'PASTE_RESET' }
  | { type: 'GENERATE_FIELD'; field: 'topic' | 'length' | 'cefr' | 'language'; value: string }
  | { type: 'GENERATE_RESET' }
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
  | { type: 'ANNOTATE_RESET' }
  | { type: 'OPEN_DEEP_CARD'; span: DeepSpan }
  | { type: 'DEEP_CARD_FIELD'; span: DeepSpan; key: string; value: unknown }
  | { type: 'DEEP_CARD_RESOLVED'; span: DeepSpan; card: DeepCard }
  | { type: 'DEEP_CARD_ERROR'; span: DeepSpan; error: AnnotateError }
  | { type: 'DISMISS_DEEP_CARD' }
  | { type: 'SET_SPAN_ANNOTATIONS'; spanAnnotations: SpanAnnotations };

export const initialState: ReadPageState = {
  view: 'empty',
  paste: { title: '', source: '', text: '' },
  generate: { topic: '', length: ReadingTextLength.SHORT, cefr: CefrLevel.A2, language: 'TR' },
  activeEntryId: null,
  bank: [],
  activeWord: null,
  intensity: 'subtle',
  saveToast: null,
  inlineError: null,
  annotateStream: { phase: 'idle' },
  deepCard: { status: 'idle' },
  spanAnnotations: {},
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

    case 'GENERATE_FIELD':
      // `value` arrives as a string from the form; the enum-typed fields
      // (length/cefr/language) carry string values, so the cast is safe.
      return {
        ...state,
        generate: { ...state.generate, [action.field]: action.value },
      };

    case 'GENERATE_RESET':
      return { ...state, generate: initialState.generate };

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
      // pending save toast, and any prior inline error. The deep-card slice and
      // the prior entry's span annotations are reset too — the page re-seeds
      // `spanAnnotations` from the newly-loaded entry via SET_SPAN_ANNOTATIONS.
      return {
        ...state,
        view: 'annotated',
        activeEntryId: action.entryId,
        activeWord: null,
        saveToast: null,
        inlineError: null,
        deepCard: { status: 'idle' },
        spanAnnotations: {},
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
      // A new annotation is a brand-new passage, so the deep-card slice and any
      // session span annotations from the prior passage are cleared.
      //
      // Detach from any persisted/most-recent entry (`activeEntryId: null`): a
      // freshly pasted text has no row yet, and the page renders the ephemeral
      // entry (the pasted text + streaming flags) only while `activeEntryId` is
      // null. Without this, a prior history entry stays bound and wins the
      // `persistedEntry ?? ephemeralEntry` render, so Annotate would open the
      // old text instead of the pasted one. ENTRY_PERSISTED re-binds the id
      // once the text is saved.
      return {
        ...state,
        activeEntryId: null,
        annotateStream: STREAMING_PLACEHOLDER,
        deepCard: { status: 'idle' },
        spanAnnotations: {},
      };

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

    case 'OPEN_DEEP_CARD': {
      // Cache hit (Req 11.4): a span already resolved this session (or seeded
      // from the saved entry) renders instantly, bypassing the endpoint.
      // Otherwise open `loading` (Req 9.3) — the page fires the mutation.
      const cached = state.spanAnnotations[spanKey(action.span.start, action.span.end)];
      return {
        ...state,
        deepCard: cached
          ? { status: 'loaded', span: action.span, card: cached }
          : { status: 'loading', span: action.span, partial: {} },
      };
    }

    case 'DEEP_CARD_FIELD': {
      // Merge a streamed field into the open card's partial preview (Req 1.2).
      // Only while still `loading` AND the field belongs to the open span — a
      // stale field for a dismissed/replaced span is ignored (mirrors the
      // RESOLVED/ERROR stale guards).
      const current = state.deepCard;
      if (
        current.status !== 'loading' ||
        current.span.start !== action.span.start ||
        current.span.end !== action.span.end
      ) {
        return state;
      }
      return {
        ...state,
        deepCard: {
          ...current,
          partial: {
            ...current.partial,
            [action.key]: action.value,
          } as Partial<DeepCard>,
        },
      };
    }

    case 'DEEP_CARD_RESOLVED': {
      // Always cache the resolved card into the session map (Req 3.5) — even if
      // the user already dismissed or moved to another span, a later re-tap is
      // then instant. Only swap the visible card when the resolve still matches
      // the open span (guards against a stale/out-of-order resolve).
      const key = spanKey(action.span.start, action.span.end);
      const spanAnnotations = { ...state.spanAnnotations, [key]: action.card };
      const current = state.deepCard;
      const matchesOpen =
        current.status !== 'idle' &&
        current.span.start === action.span.start &&
        current.span.end === action.span.end;
      return {
        ...state,
        spanAnnotations,
        deepCard: matchesOpen
          ? { status: 'loaded', span: action.span, card: action.card }
          : state.deepCard,
      };
    }

    case 'DEEP_CARD_ERROR': {
      // Only surface the error if it still matches the open span (Req 9.4);
      // a stale failure for a dismissed/replaced span is ignored.
      const current = state.deepCard;
      const matchesOpen =
        current.status !== 'idle' &&
        current.span.start === action.span.start &&
        current.span.end === action.span.end;
      if (!matchesOpen) return state;
      return {
        ...state,
        deepCard: { status: 'error', span: action.span, error: action.error },
      };
    }

    case 'DISMISS_DEEP_CARD':
      return { ...state, deepCard: { status: 'idle' } };

    case 'SET_SPAN_ANNOTATIONS':
      // Seed/merge the open entry's persisted deep cards (Req 11.3). Merge (not
      // replace) so any cards resolved before the entry query settled survive;
      // LOAD_ENTRY already cleared the prior entry's map, so on a fresh load
      // this is effectively a replace.
      return {
        ...state,
        spanAnnotations: { ...state.spanAnnotations, ...action.spanAnnotations },
      };

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
