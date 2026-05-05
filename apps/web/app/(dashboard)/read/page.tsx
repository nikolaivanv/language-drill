'use client';

// ---------------------------------------------------------------------------
// /read page — Phase J entry point
// ---------------------------------------------------------------------------
// Single client component that composes:
//   - <ReadTopBar />            — view switcher (constant across views)
//   - <EmptyView />              — first-launch landing
//   - <PasteView />              — title + textarea form
//   - <AnnotatedView />          — reader pane + sticky bank rail
//   - <HistoryView />            — list of past passages
//   - <SaveToast />              — fixed bottom-center, post-save
//   - <InlineErrorToast />       — fixed bottom-right, bank/save failures
//
// The reducer (`read-page-reducer`) owns view + ephemeral UI state. All
// network state lives in TanStack Query / mutation hooks. The page wires
// the two together.
// ---------------------------------------------------------------------------

import { useMemo, useReducer, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  useLanguageProfiles,
  useReadAnnotate,
  useReadEntries,
  useReadEntry,
  useSaveReadEntry,
  useUpdateReadBank,
  type ReadEntryResponse,
} from '@language-drill/api-client';
import { CefrLevel } from '@language-drill/shared';
import { useActiveLanguage } from '../../../components/shell/active-language-provider';
import { calibrationCopy } from './_lib/calibration-copy';
import {
  initialState,
  readPageReducer,
  selectActiveEntry,
  type View,
} from './_state/read-page-reducer';
import { AnnotatedError } from './_components/annotated-error';
import { AnnotatedSkeleton } from './_components/annotated-skeleton';
import { AnnotatedView } from './_components/annotated-view';
import { EmptyView } from './_components/empty-view';
import { HistoryEmptyState } from './_components/history-empty-state';
import { HistoryView } from './_components/history-view';
import { InlineErrorToast } from './_components/inline-error-toast';
import { PasteView } from './_components/paste-view';
import { ReadTopBar } from './_components/read-top-bar';
import { SaveToast } from './_components/save-toast';

const SAVE_TOAST_MS = 4000;
const INLINE_ERROR_MS = 3000;

function annotationErrorKind(err: unknown): {
  body: string;
  rateLimited: boolean;
} | null {
  if (!err) return null;
  if (!(err instanceof Error)) {
    return { body: 'something went wrong — try again', rateLimited: false };
  }
  const status = (err as Error & { status?: number }).status;
  return {
    body: err.message || 'something went wrong — try again',
    rateLimited: status === 429,
  };
}

export default function ReadPage() {
  const { activeLanguage } = useActiveLanguage();
  const { getToken } = useAuth();
  const router = useRouter();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);

  const [state, dispatch] = useReducer(readPageReducer, initialState);

  // -------------------------------------------------------------------------
  // Network state
  // -------------------------------------------------------------------------

  const profiles = useLanguageProfiles({ fetchFn });
  const proficiencyLevel =
    (profiles.data?.profiles.find((p) => p.language === activeLanguage)
      ?.proficiencyLevel as CefrLevel | undefined) ?? null;

  const entriesQuery = useReadEntries({ fetchFn, language: activeLanguage });
  const entries = entriesQuery.data?.entries ?? [];

  const entryQuery = useReadEntry({
    fetchFn,
    id: state.activeEntryId,
    enabled: state.activeEntryId !== null,
  });

  const annotate = useReadAnnotate({ fetchFn });
  const saveEntry = useSaveReadEntry({ fetchFn });
  const updateBank = useUpdateReadBank({ fetchFn });

  // -------------------------------------------------------------------------
  // Effects (per task 33's "Required useEffects" list)
  // -------------------------------------------------------------------------

  // 1. Resolve most-recent entry on first load / language change.
  useEffect(() => {
    if (!entriesQuery.data) return;
    const list = entriesQuery.data.entries;
    if (state.activeEntryId === null && list.length >= 1) {
      dispatch({ type: 'LOAD_ENTRY', entryId: list[0].id });
    }
  }, [entriesQuery.data, state.activeEntryId]);

  // 2. Save-toast auto-dismiss (4 s).
  useEffect(() => {
    if (state.saveToast === null) return;
    const t = setTimeout(
      () => dispatch({ type: 'DISMISS_SAVE_TOAST' }),
      SAVE_TOAST_MS,
    );
    return () => clearTimeout(t);
  }, [state.saveToast]);

  // 3. Inline-error-toast auto-dismiss (3 s).
  useEffect(() => {
    if (state.inlineError === null) return;
    const t = setTimeout(
      () => dispatch({ type: 'DISMISS_INLINE_ERROR' }),
      INLINE_ERROR_MS,
    );
    return () => clearTimeout(t);
  }, [state.inlineError]);

  // Sync local bank to the persisted entry's bank when it loads. Also covers
  // optimistic-update rollback: when `useUpdateReadBank.onError` calls
  // `setQueryData(previousEntry)`, this effect fires with the rolled-back
  // bank.
  const lastSyncedBankIdRef = useRef<string | null>(null);
  useEffect(() => {
    const data = entryQuery.data;
    if (!data) return;
    if (lastSyncedBankIdRef.current === data.id) {
      // Same entry already synced — accept the cache as the source of truth
      // (covers rollback writes by useUpdateReadBank.onError).
      dispatch({ type: 'SET_BANK_FROM_ENTRY', bank: data.bank });
      return;
    }
    lastSyncedBankIdRef.current = data.id;
    dispatch({ type: 'SET_BANK_FROM_ENTRY', bank: data.bank });
  }, [entryQuery.data]);

  // -------------------------------------------------------------------------
  // Derived view data
  // -------------------------------------------------------------------------

  const calibration = useMemo(
    () => calibrationCopy(proficiencyLevel),
    [proficiencyLevel],
  );

  const persistedEntry: ReadEntryResponse | null = entryQuery.data ?? null;
  const ephemeralEntry =
    state.activeEntryId === null && annotate.data
      ? {
          text: state.paste.text,
          title: state.paste.title,
          source: '',
          flaggedWords: annotate.data.flagged,
        }
      : null;
  const annotatedEntry = persistedEntry ?? ephemeralEntry;

  const annotateError = annotationErrorKind(annotate.error);

  // selectActiveEntry is exercised by reducer tests; not strictly needed here
  // since we resolve the persisted entry via TanStack Query, but referencing
  // it keeps the reducer's selector public surface in use.
  const _activeSummary = selectActiveEntry(
    state,
    entries,
    entries[0] ?? null,
  );
  void _activeSummary;

  // -------------------------------------------------------------------------
  // Handlers
  // -------------------------------------------------------------------------

  const handleViewChange = (view: View) => {
    if (view === 'pasting') {
      dispatch({ type: 'PASTE_RESET' });
      annotate.reset();
      dispatch({ type: 'SET_VIEW', view: 'pasting' });
      return;
    }
    if (view === 'annotated') {
      const target =
        annotatedEntry !== null
          ? 'annotated'
          : entries.length >= 1
            ? 'annotated'
            : 'empty';
      dispatch({ type: 'SET_VIEW', view: target });
      return;
    }
    dispatch({ type: 'SET_VIEW', view });
  };

  const handlePasteFieldChange = (
    field: 'title' | 'source' | 'text',
    value: string,
  ) => {
    dispatch({ type: 'PASTE_FIELD', field, value });
  };

  const handlePasteCancel = () => {
    if (entries.length >= 1 || annotatedEntry !== null) {
      dispatch({ type: 'SET_VIEW', view: 'annotated' });
    } else {
      dispatch({ type: 'SET_VIEW', view: 'empty' });
    }
  };

  const handleAnnotate = () => {
    annotate.mutate(
      {
        language: activeLanguage,
        text: state.paste.text,
      },
      {
        onSuccess: () => {
          // Ephemeral state: no activeEntryId yet, bank starts empty.
          dispatch({ type: 'SET_BANK_FROM_ENTRY', bank: [] });
          dispatch({ type: 'SET_VIEW', view: 'annotated' });
        },
      },
    );
  };

  const handleIntensityChange = (intensity: 'subtle' | 'assertive') => {
    dispatch({ type: 'SET_INTENSITY', intensity });
  };

  const handlePopoverOpen = (word: string, x: number, y: number) => {
    dispatch({ type: 'OPEN_POPOVER', word, x, y });
  };

  const handlePopoverClose = () => {
    dispatch({ type: 'CLOSE_POPOVER' });
  };

  const handleBankToggle = (word: string) => {
    if (state.activeEntryId === null) {
      dispatch({ type: 'TOGGLE_BANK_WORD', word });
      return;
    }
    const inBank = state.bank.includes(word);
    const newBank = inBank
      ? state.bank.filter((w) => w !== word)
      : [...state.bank, word];
    dispatch({ type: 'TOGGLE_BANK_WORD', word });
    updateBank.mutate(
      {
        id: state.activeEntryId,
        language: activeLanguage,
        bank: newBank,
      },
      {
        onError: () => {
          // The bank-sync effect picks up `setQueryData(previousEntry)` from
          // useUpdateReadBank.onError and rolls the reducer's bank back.
          dispatch({ type: 'SHOW_INLINE_ERROR', kind: 'bank' });
        },
      },
    );
  };

  const handleClearBank = () => {
    if (state.activeEntryId === null) {
      dispatch({ type: 'CLEAR_BANK_LOCAL' });
      return;
    }
    dispatch({ type: 'CLEAR_BANK_LOCAL' });
    updateBank.mutate(
      {
        id: state.activeEntryId,
        language: activeLanguage,
        bank: [],
      },
      {
        onError: () => {
          dispatch({ type: 'SHOW_INLINE_ERROR', kind: 'bank' });
        },
      },
    );
  };

  const handleSave = () => {
    if (state.bank.length === 0) return;
    if (state.activeEntryId !== null) return; // already persisted
    if (!annotate.data) return; // no flagged map
    saveEntry.mutate(
      {
        language: activeLanguage,
        title: state.paste.title,
        source: '',
        text: state.paste.text,
        flagged: annotate.data.flagged,
        bank: state.bank,
      },
      {
        onSuccess: (data) => {
          dispatch({ type: 'ENTRY_PERSISTED', entryId: data.id });
        },
        onError: () => {
          dispatch({ type: 'SHOW_INLINE_ERROR', kind: 'save' });
        },
      },
    );
  };

  const handleHistoryOpen = (entryId: string) => {
    dispatch({ type: 'LOAD_ENTRY', entryId });
  };

  const handleSeeNextSession = () => {
    dispatch({ type: 'DISMISS_SAVE_TOAST' });
    router.push('/drill');
  };

  const handlePasteNew = () => {
    dispatch({ type: 'PASTE_RESET' });
    annotate.reset();
    dispatch({ type: 'SET_VIEW', view: 'pasting' });
  };

  // -------------------------------------------------------------------------
  // View body
  // -------------------------------------------------------------------------

  let body: React.ReactNode;
  if (state.view === 'empty') {
    body = (
      <EmptyView
        onPaste={handlePasteNew}
        cefrToken={proficiencyLevel}
      />
    );
  } else if (state.view === 'pasting') {
    body = (
      <PasteView
        paste={state.paste}
        onChange={handlePasteFieldChange}
        onCancel={handlePasteCancel}
        onAnnotate={handleAnnotate}
        isLoading={annotate.isPending}
        errorBody={annotateError?.body ?? null}
        rateLimited={annotateError?.rateLimited ?? false}
      />
    );
  } else if (state.view === 'history') {
    body =
      entries.length === 0 ? (
        <HistoryEmptyState onPasteNew={handlePasteNew} />
      ) : (
        <HistoryView entries={entries} onOpen={handleHistoryOpen} />
      );
  } else {
    // 'annotated'
    if (state.activeEntryId !== null && entryQuery.isLoading) {
      body = <AnnotatedSkeleton />;
    } else if (state.activeEntryId !== null && entryQuery.error) {
      body = (
        <AnnotatedError
          body="couldn't load that passage — try again."
          kind="other"
          onEditText={handlePasteNew}
          onTryAgain={() => {
            void entryQuery.refetch();
          }}
        />
      );
    } else if (annotatedEntry) {
      body = (
        <AnnotatedView
          entry={annotatedEntry}
          bank={state.bank}
          intensity={state.intensity}
          activeWord={state.activeWord}
          calibration={{
            eyebrow: calibration.eyebrow,
            explanation: calibration.explanation,
          }}
          isSaving={saveEntry.isPending}
          onIntensityChange={handleIntensityChange}
          onPopoverOpen={handlePopoverOpen}
          onPopoverClose={handlePopoverClose}
          onBankToggle={handleBankToggle}
          onClearBank={handleClearBank}
          onSave={handleSave}
          onPasteNew={handlePasteNew}
        />
      );
    } else {
      // Annotated view with no entry yet (initial load, awaiting entries query).
      body = <AnnotatedSkeleton />;
    }
  }

  return (
    <div className="space-y-s-6">
      <ReadTopBar
        view={state.view}
        onChange={handleViewChange}
        historyCount={entriesQuery.data ? entries.length : undefined}
      />
      {body}
      {state.saveToast !== null && (
        <SaveToast
          count={state.saveToast.count}
          onSeeNextSession={handleSeeNextSession}
          onDismiss={() => dispatch({ type: 'DISMISS_SAVE_TOAST' })}
        />
      )}
      {state.inlineError !== null && (
        <InlineErrorToast
          kind={state.inlineError.kind}
          onDismiss={() => dispatch({ type: 'DISMISS_INLINE_ERROR' })}
        />
      )}
    </div>
  );
}
