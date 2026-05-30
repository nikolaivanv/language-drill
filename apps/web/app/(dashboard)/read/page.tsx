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

import { useMemo, useReducer, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  useDeleteVocabularyCard,
  useLanguageProfiles,
  useReadAnnotateSpan,
  useReadAnnotateStream,
  useReadEntries,
  useReadEntry,
  useSaveReadEntry,
  useSaveVocabularyCard,
  useUpdateReadBank,
  type ReadEntryResponse,
} from '@language-drill/api-client';
import { CefrLevel, type DeepCard } from '@language-drill/shared';
import { useActiveLanguage } from '../../../components/shell/active-language-provider';
import { calibrationCopy } from './_lib/calibration-copy';
import {
  initialState,
  readPageReducer,
  selectActiveEntry,
  spanKey,
  type AnnotateError,
  type DeepSpan,
  type View,
} from './_state/read-page-reducer';
import {
  AnnotatedError,
  type AnnotatedErrorKind,
} from './_components/annotated-error';
import { AnnotatedSkeleton } from './_components/annotated-skeleton';
import { AnnotatedView } from './_components/annotated-view';
import { EmptyView } from './_components/empty-view';
import { HistoryEmptyState } from './_components/history-empty-state';
import { HistoryView } from './_components/history-view';
import { InlineErrorToast } from './_components/inline-error-toast';
import { PasteView } from './_components/paste-view';
import { ReadTopBar } from './_components/read-top-bar';
import { SaveToast, VocabSaveToast } from './_components/save-toast';

const SAVE_TOAST_MS = 4000;
const INLINE_ERROR_MS = 3000;

// Map a thrown `createAuthenticatedFetch` error (carries `.status` + `.body`)
// into the reducer's `AnnotateError` shape for the deep-card error slice. The
// card body keys retry-disable off `status === 429` and shows `message`.
function toAnnotateError(err: unknown): AnnotateError {
  const e = err as {
    message?: string;
    status?: number;
    body?: { code?: string } | null;
  };
  return {
    code: e.body?.code ?? 'DEEP_ANNOTATE_FAILED',
    message: e.message || 'something went wrong — try again',
    status: e.status,
  };
}

function errorKindFromCode(code: string): AnnotatedErrorKind {
  switch (code) {
    case 'RATE_LIMIT_EXCEEDED':
      return 'rateLimit';
    case 'UNSUPPORTED_LANGUAGE':
      return 'unsupported';
    case 'AI_UNAVAILABLE':
      return 'aiUnavailable';
    case 'VALIDATION_ERROR':
      return 'validation';
    default:
      return 'other';
  }
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

  // Streaming SSE annotation hook (Phase J task 38). The hook owns its own
  // state machine; the page reads `annotate.state.phase` and `flaggedMap`
  // directly rather than mirroring into the reducer. The reducer's
  // `annotateStream` slice (task 36) is reserved for future selector consumers
  // and stays dormant here.
  const annotate = useReadAnnotateStream({
    baseUrl: process.env.NEXT_PUBLIC_ANNOTATE_STREAM_URL ?? '',
    getToken,
  });
  const saveEntry = useSaveReadEntry({ fetchFn });
  const updateBank = useUpdateReadBank({ fetchFn });
  // On-demand deep annotation (Sonnet). Writes resolved cards through into the
  // `['readEntry', id]` cache's spanAnnotations when the span belongs to a
  // saved entry (Req 11.4); the seeding effect below mirrors that back into the
  // reducer so a re-tap is an instant cache hit.
  const annotateSpan = useReadAnnotateSpan({ fetchFn });
  // Deep card → vocabulary save + undo (Req 8.4, 8.5). Independent of the entry
  // bank and of entry `spanAnnotations` (Req 11.7).
  const saveVocab = useSaveVocabularyCard({ fetchFn });
  const deleteVocab = useDeleteVocabularyCard({ fetchFn });

  // The just-saved deep card: its span (so the open card reflects the "saved"
  // footer), the vocabulary record id (for undo), and the surface key (so the
  // in-passage token flips to the `.saved` style for word saves). `null` until
  // a save lands; cleared on undo or when a different span is saved.
  const [deepSaved, setDeepSaved] = useState<{
    start: number;
    end: number;
    vocabId: string;
    wordKey: string | null;
    /** This save added `wordKey` to the entry bank — so undo should remove it. */
    banked: boolean;
  } | null>(null);
  const [vocabToast, setVocabToast] = useState<{ label: string } | null>(null);

  // -------------------------------------------------------------------------
  // Effects (per task 33's "Required useEffects" list)
  // -------------------------------------------------------------------------

  // 1. Resolve most-recent entry on first load / language change — once per
  //    language, NOT a perpetual "if activeEntryId is null, grab the most
  //    recent". The paste-new and fresh-annotation flows deliberately run with
  //    `activeEntryId === null` (so the ephemeral pasted text renders); a
  //    perpetual auto-resolver would hijack them — bouncing a fresh paste back
  //    to the old text, or kicking the user out of the paste form. The ref
  //    fires the auto-resolve exactly once after each language's list loads.
  const autoResolvedLangRef = useRef<string | null>(null);
  useEffect(() => {
    if (!entriesQuery.data) return;
    if (autoResolvedLangRef.current === activeLanguage) return;
    autoResolvedLangRef.current = activeLanguage;
    const list = entriesQuery.data.entries;
    if (state.activeEntryId === null && list.length >= 1) {
      dispatch({ type: 'LOAD_ENTRY', entryId: list[0].id });
    }
  }, [entriesQuery.data, activeLanguage, state.activeEntryId]);

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

  // 4. Vocab-save toast auto-dismiss (4 s). The saved record (and the card's
  // "saved" footer + in-passage style) persists; only the toast fades.
  useEffect(() => {
    if (vocabToast === null) return;
    const t = setTimeout(() => setVocabToast(null), SAVE_TOAST_MS);
    return () => clearTimeout(t);
  }, [vocabToast]);

  // 5. Drop the deep-save badge + toast when the open passage changes — the
  // saved span no longer maps to what's on screen.
  useEffect(() => {
    setDeepSaved(null);
    setVocabToast(null);
  }, [state.activeEntryId]);

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

  // Seed the open entry's persisted deep cards into the reducer (Req 11.3), so
  // a reopened saved text renders its stored spans with no model call and a tap
  // on a stored span is an instant cache hit (Req 11.4). Re-fires when the
  // entry cache changes — including `useReadAnnotateSpan`'s write-through — so
  // the reducer's session map stays in lockstep with the durable store. The
  // reducer MERGES, so cards resolved before the query settled survive.
  useEffect(() => {
    const data = entryQuery.data;
    if (!data) return;
    dispatch({
      type: 'SET_SPAN_ANNOTATIONS',
      spanAnnotations: data.spanAnnotations ?? {},
    });
  }, [entryQuery.data]);

  // -------------------------------------------------------------------------
  // Derived view data
  // -------------------------------------------------------------------------

  const calibration = useMemo(
    () => calibrationCopy(proficiencyLevel),
    [proficiencyLevel],
  );

  const persistedEntry: ReadEntryResponse | null = entryQuery.data ?? null;
  // The hook's reducer always exposes a `flaggedMap` in non-idle phases
  // (streaming/complete/error retain partials — see hook docstring & Req 5.10).
  const streamingFlaggedMap =
    annotate.state.phase === 'streaming' ||
    annotate.state.phase === 'complete' ||
    annotate.state.phase === 'error'
      ? annotate.state.flaggedMap
      : null;
  const ephemeralEntry =
    state.activeEntryId === null && streamingFlaggedMap !== null
      ? {
          text: state.paste.text,
          title: state.paste.title,
          source: '',
          flaggedWords: streamingFlaggedMap,
        }
      : null;
  const annotatedEntry = persistedEntry ?? ephemeralEntry;

  const annotateError =
    annotate.state.phase === 'error'
      ? {
          body:
            annotate.state.error.message || 'something went wrong — try again',
          rateLimited:
            annotate.state.error.code === 'RATE_LIMIT_EXCEEDED' ||
            annotate.state.error.status === 429,
          kind: errorKindFromCode(annotate.state.error.code),
        }
      : null;

  // Streaming progress + zero-flagged signal for <CalibrationStrip /> (task 37).
  const streamingProgress =
    annotate.state.phase === 'streaming'
      ? {
          flaggedCount: annotate.state.flaggedCount,
          candidateCount: annotate.state.candidateCount,
        }
      : undefined;

  const noAboveLevelWords =
    annotate.state.phase === 'complete' && annotate.state.flaggedCount === 0;

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
      // Req 5.7: abort any in-flight stream when leaving the annotated view.
      // `abort()` is a no-op when no controller is active.
      annotate.abort();
      dispatch({ type: 'PASTE_RESET' });
      annotate.reset();
      dispatch({ type: 'ANNOTATE_RESET' });
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
    // history / empty — also drop any in-flight stream (Req 5.7).
    annotate.abort();
    dispatch({ type: 'SET_VIEW', view });
  };

  const handlePasteFieldChange = (
    field: 'title' | 'source' | 'text',
    value: string,
  ) => {
    dispatch({ type: 'PASTE_FIELD', field, value });
  };

  const handlePasteCancel = () => {
    // Cancelling the paste form drops any in-flight stream as well (Req 5.7).
    annotate.abort();
    if (entries.length >= 1 || annotatedEntry !== null) {
      dispatch({ type: 'SET_VIEW', view: 'annotated' });
    } else {
      dispatch({ type: 'SET_VIEW', view: 'empty' });
    }
  };

  const handleAnnotate = () => {
    // Req 5.1: switch to the annotated view IMMEDIATELY with the raw text
    // before any network response. Compose existing reducer actions instead of
    // adding a single `PASTE_SUBMIT` action — the visible effects we need are
    // "ephemeral bank empty" + "view = annotated".
    dispatch({ type: 'SET_BANK_FROM_ENTRY', bank: [] });
    dispatch({ type: 'SET_VIEW', view: 'annotated' });
    // Keep the reducer's annotateStream slice in sync for any selector
    // consumer (selectFlaggedMap, etc.); runtime rendering reads from
    // `annotate.state` directly so this dispatch is presently advisory.
    dispatch({ type: 'ANNOTATE_START' });
    annotate.start({ language: activeLanguage, text: state.paste.text });
  };

  const handleIntensityChange = (intensity: 'subtle' | 'assertive') => {
    dispatch({ type: 'SET_INTENSITY', intensity });
  };

  const handlePopoverOpen = (word: string, x: number, y: number) => {
    dispatch({ type: 'OPEN_POPOVER', word, x, y });
  };

  const handlePopoverClose = () => {
    // Dismiss whichever card is open — the skim popover and/or the deep card.
    dispatch({ type: 'CLOSE_POPOVER' });
    dispatch({ type: 'DISMISS_DEEP_CARD' });
  };

  // Fire the deep-annotation request for a span and route the result into the
  // reducer's deep-card state machine (Req 3.4, 9.4). `entryId` is sent only
  // for a saved entry, so the server persists onto it (Req 11.1) and skips the
  // DB write for unsaved text (Req 11.2).
  const runSpanAnnotation = (span: DeepSpan) => {
    annotateSpan.mutate(
      {
        language: activeLanguage,
        text: annotatedEntry?.text ?? state.paste.text,
        start: span.start,
        end: span.end,
        entryId: state.activeEntryId ?? undefined,
      },
      {
        onSuccess: (card) =>
          dispatch({ type: 'DEEP_CARD_RESOLVED', span, card }),
        onError: (err) =>
          dispatch({ type: 'DEEP_CARD_ERROR', span, error: toAnnotateError(err) }),
      },
    );
  };

  // Tap/drag on any span. A span already in `spanAnnotations` (seeded from the
  // saved entry or resolved earlier this session) renders instantly from cache
  // — no endpoint, no model (Req 3.5, 11.4). Otherwise open `loading` and fire.
  const handleSpanSelect = (span: DeepSpan) => {
    const cached = state.spanAnnotations[spanKey(span.start, span.end)];
    dispatch({ type: 'OPEN_DEEP_CARD', span });
    if (cached) return;
    runSpanAnnotation(span);
  };

  // Retry from the inline error state (Req 9.4): re-arm loading + re-fire for
  // the still-open span.
  const handleDeepRetry = () => {
    if (state.deepCard.status === 'idle') return;
    const { span } = state.deepCard;
    dispatch({ type: 'OPEN_DEEP_CARD', span });
    runSpanAnnotation(span);
  };

  // Save a resolved word/phrase deep card (Req 8.4). One save does everything a
  // user expects from "save this word": it goes to the spaced-repetition
  // vocabulary AND, for a word card, to the passage's word bank — which lazy-
  // creates the read entry so the text lands in history (matching the bank-save
  // path) and lets the vocab record link back to it via `sourceReadEntryId`.
  // The FK requires the entry to exist first, so on a fresh paste we POST the
  // entry, then save the linked vocab in its onSuccess. Sentence cards are not
  // savable (Req 5.4/8.6) — guarded here and server-side.
  const handleSaveCard = (card: DeepCard, span: DeepSpan) => {
    if (card.type === 'sentence') return;
    const word = card.type === 'word' ? card.surface.toLowerCase() : null;

    // A deep card can resolve ANY tapped word, not just the auto-flagged ones.
    // The passage word bank, however, only holds flagged words: the server
    // rejects a bank containing a non-flagged word (bank ⊆ flagged, enforced on
    // both POST /read/entries and PUT .../bank) and the WordBankRail can't even
    // render one (it resolves each entry through `flaggedMap`). So a non-flagged
    // word still saves to vocabulary, but it must NOT be added to the bank —
    // otherwise the bank write 400s and the user sees a spurious
    // "couldn't update — try again" alongside the successful vocab save.
    const flaggedWords = annotatedEntry?.flaggedWords ?? {};
    const bankableWord =
      word !== null &&
      Object.prototype.hasOwnProperty.call(flaggedWords, word)
        ? word
        : null;

    const saveVocabLinked = (sourceReadEntryId: string | undefined, banked: boolean) => {
      saveVocab.mutate(
        { language: activeLanguage, card, sourceReadEntryId },
        {
          onSuccess: ({ id }) => {
            setDeepSaved({ start: span.start, end: span.end, vocabId: id, wordKey: word, banked });
            setVocabToast({ label: card.surface });
          },
          onError: () => dispatch({ type: 'SHOW_INLINE_ERROR', kind: 'save' }),
        },
      );
    };

    // Already-persisted entry: bank the word (PUT) if it's a flagged word that's
    // new to the bank, then link vocab.
    if (state.activeEntryId !== null) {
      const banked = bankableWord !== null && !state.bank.includes(bankableWord);
      if (banked) {
        dispatch({ type: 'TOGGLE_BANK_WORD', word: bankableWord });
        updateBank.mutate(
          { id: state.activeEntryId, language: activeLanguage, bank: [...state.bank, bankableWord] },
          { onError: () => dispatch({ type: 'SHOW_INLINE_ERROR', kind: 'bank' }) },
        );
      }
      saveVocabLinked(state.activeEntryId, banked);
      return;
    }

    // Fresh paste: persist the source FIRST (so the vocab FK can link), banking
    // the word, then save the linked vocab. If the stream hasn't completed or a
    // POST is already in flight, fall back to an unlinked vocab save so the
    // user's action isn't dropped (the source just won't be linked this time).
    if (annotate.state.phase !== 'complete' || saveEntry.isPending) {
      saveVocabLinked(undefined, false);
      return;
    }
    if (bankableWord !== null) dispatch({ type: 'TOGGLE_BANK_WORD', word: bankableWord });
    saveEntry.mutate(
      {
        language: activeLanguage,
        title: state.paste.title,
        source: '',
        text: state.paste.text,
        flagged: annotate.state.flaggedMap,
        bank: bankableWord !== null ? [...state.bank, bankableWord] : state.bank,
      },
      {
        onSuccess: (data) => {
          dispatch({ type: 'ENTRY_PERSISTED', entryId: data.id });
          saveVocabLinked(data.id, bankableWord !== null);
        },
        onError: () => {
          dispatch({ type: 'SHOW_INLINE_ERROR', kind: 'save' });
          saveVocabLinked(undefined, false);
        },
      },
    );
  };

  // Undo the just-saved card (Req 8.5): delete the vocab record, revert the
  // "saved" footer/style + toast, and — if this save added the word to the bank
  // — remove it again (PUT). The history entry itself stays; un-banking never
  // deletes entries.
  const handleUndoCard = () => {
    if (!deepSaved) return;
    const { vocabId, wordKey, banked } = deepSaved;
    deleteVocab.mutate(vocabId, {
      onSuccess: () => {
        setDeepSaved(null);
        setVocabToast(null);
        if (banked && wordKey && state.activeEntryId !== null && state.bank.includes(wordKey)) {
          dispatch({ type: 'TOGGLE_BANK_WORD', word: wordKey });
          updateBank.mutate(
            {
              id: state.activeEntryId,
              language: activeLanguage,
              bank: state.bank.filter((w) => w !== wordKey),
            },
            { onError: () => dispatch({ type: 'SHOW_INLINE_ERROR', kind: 'bank' }) },
          );
        }
      },
      onError: () => dispatch({ type: 'SHOW_INLINE_ERROR', kind: 'save' }),
    });
  };

  // Surface forms shown with the "saved" style in the passage (Req 8.4).
  const savedWordKeys = useMemo(
    () => (deepSaved?.wordKey ? new Set([deepSaved.wordKey]) : new Set<string>()),
    [deepSaved],
  );

  // Bank toggle from the popover / sheet. Two paths:
  //   - Existing History entry → PUT /read/entries/:id/bank to sync the new
  //     bank list (immediate persistence).
  //   - Brand-new pasted passage → lazy-create the entry on the FIRST save:
  //     POST /read/entries with the current bank. Subsequent saves use the
  //     PUT path once `activeEntryId` is set. (Replaces the previous explicit
  //     "Save N to bank →" footer button, which has been removed.)
  //
  // If the user toggles another word while the lazy-POST is in flight, that
  // toggle updates local state only; the next toggle after `ENTRY_PERSISTED`
  // lights up the PUT path and syncs. The race window is the POST's RTT — a
  // worst-case ~200ms — and the user can always re-tap to recover.
  const handleBankToggle = (word: string) => {
    const inBank = state.bank.includes(word);
    const newBank = inBank
      ? state.bank.filter((w) => w !== word)
      : [...state.bank, word];
    dispatch({ type: 'TOGGLE_BANK_WORD', word });

    if (state.activeEntryId !== null) {
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
      return;
    }

    // Lazy-create path.
    if (saveEntry.isPending) return;
    if (annotate.state.phase !== 'complete') return;
    if (newBank.length === 0) return;
    saveEntry.mutate(
      {
        language: activeLanguage,
        title: state.paste.title,
        source: '',
        text: state.paste.text,
        flagged: annotate.state.flaggedMap,
        bank: newBank,
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
    // Req 5.7: abort any in-flight stream before resetting paste form.
    annotate.abort();
    dispatch({ type: 'PASTE_RESET' });
    annotate.reset();
    dispatch({ type: 'ANNOTATE_RESET' });
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
        isLoading={annotate.state.phase === 'streaming'}
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
    } else if (
      // When the stream errors mid-flight on a fresh paste (no persisted
      // entry, no partial flags yet), surface the inline error card so the
      // user can edit or retry. Req 5.10: when partial flags ARE present we
      // prefer to leave them visible (handled by falling through to
      // AnnotatedView below).
      state.activeEntryId === null &&
      annotateError !== null &&
      (annotatedEntry === null ||
        Object.keys(annotatedEntry.flaggedWords).length === 0)
    ) {
      body = (
        <AnnotatedError
          body={annotateError.body}
          kind={annotateError.kind}
          onEditText={handlePasteNew}
          onTryAgain={() => {
            // Re-fire the stream with the current paste text.
            annotate.start({
              language: activeLanguage,
              text: state.paste.text,
            });
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
          deepCard={state.deepCard}
          calibration={{
            eyebrow: calibration.eyebrow,
            explanation: calibration.explanation,
          }}
          annotateStreaming={streamingProgress}
          noAboveLevelWords={noAboveLevelWords}
          onIntensityChange={handleIntensityChange}
          onPopoverOpen={handlePopoverOpen}
          onPopoverClose={handlePopoverClose}
          onSpanSelect={handleSpanSelect}
          onDeepRetry={handleDeepRetry}
          onSaveCard={handleSaveCard}
          onUndoCard={handleUndoCard}
          savedSpan={
            deepSaved ? { start: deepSaved.start, end: deepSaved.end } : null
          }
          savedWordKeys={savedWordKeys}
          onBankToggle={handleBankToggle}
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
      {vocabToast !== null && (
        <VocabSaveToast
          label={vocabToast.label}
          onUndo={handleUndoCard}
          onDismiss={() => setVocabToast(null)}
        />
      )}
    </div>
  );
}
