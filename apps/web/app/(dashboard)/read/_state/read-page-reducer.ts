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

export type View = 'empty' | 'pasting' | 'annotated' | 'history';

export type Intensity = 'subtle' | 'assertive';

export type ActiveWord = { word: string; x: number; y: number };

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
  | { type: 'ENTRY_PERSISTED'; entryId: string };

export const initialState: ReadPageState = {
  view: 'empty',
  paste: { title: '', source: '', text: '' },
  activeEntryId: null,
  bank: [],
  activeWord: null,
  intensity: 'subtle',
  saveToast: null,
  inlineError: null,
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
