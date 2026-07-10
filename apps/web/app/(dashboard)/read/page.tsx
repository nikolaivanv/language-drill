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
import { useQueryClient } from '@tanstack/react-query';
import {
  createAuthenticatedFetch,
  useActiveReviewLemmas,
  useDeleteVocabularyCard,
  useLanguageProfiles,
  useReadAnnotateSpanStream,
  useReadAnnotateStream,
  useGenerateReadingText,
  useReadEntries,
  useReadEntry,
  useSaveReadEntry,
  useSaveVocabularyCard,
  useUpdateReadBank,
  type ReadEntryResponse,
  type SavedVocabItem,
} from '@language-drill/api-client';
import {
  CefrLevel,
  LANGUAGE_NATIVE_NAME,
  READING_IDEAS,
  ReadingTextLength,
  type DeepCard,
  type Language,
  type LearningLanguage,
  type ReadingIdea,
} from '@language-drill/shared';
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
import { GenerateView } from './_components/generate-view';
import { GeneratingView } from './_components/generating-view';
import { HistoryEmptyState } from './_components/history-empty-state';
import { HistoryView } from './_components/history-view';
import { InlineErrorToast } from './_components/inline-error-toast';
import { PasteView } from './_components/paste-view';
import { ReadTopBar } from './_components/read-top-bar';
import { SaveToast, VocabSaveToast } from './_components/save-toast';

const SAVE_TOAST_MS = 4000;
const INLINE_ERROR_MS = 3000;

// Build the word-bank panel row for a just-saved deep card. Mirrors the
// server's `savedVocab` projection (read.ts) so optimistic rows match a later
// refetch. Sentence cards aren't savable → null.
function vocabItemFromCard(id: string, card: DeepCard): SavedVocabItem | null {
  if (card.type === 'word') {
    return {
      id,
      word: card.surface,
      lemma: card.lemma,
      gloss: card.contextualSense,
      type: 'word',
      cefr: card.cefr as CefrLevel,
    };
  }
  if (card.type === 'phrase') {
    return {
      id,
      word: card.surface,
      lemma: card.citation ?? card.surface,
      gloss: card.idiomaticMeaning,
      type: 'phrase',
      cefr: null,
    };
  }
  return null;
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
  const queryClient = useQueryClient();

  const [state, dispatch] = useReducer(readPageReducer, initialState);

  // -------------------------------------------------------------------------
  // Network state
  // -------------------------------------------------------------------------

  // Native display name for the active language — shown in generate/result copy
  // and persisted-text tags ("…in español…"). `activeLanguage` is a learning
  // language ('ES'|'DE'|'TR'), all present in the native-name map.
  const languageLabel = LANGUAGE_NATIVE_NAME[activeLanguage as Language];

  const profiles = useLanguageProfiles({ fetchFn });
  const proficiencyLevel =
    (profiles.data?.profiles.find((p) => p.language === activeLanguage)
      ?.proficiencyLevel as CefrLevel | undefined) ?? null;

  const entriesQuery = useReadEntries({ fetchFn, language: activeLanguage });
  const entries = entriesQuery.data?.entries ?? [];

  // Words in the spaced-review rotation for the active language → the distinct
  // under-review highlight in the reader (Req 13.2). Lemma + surface sets are
  // lowercased once here; AnnotatedText matches each token against them.
  const activeReviewLemmas = useActiveReviewLemmas({ fetchFn, language: activeLanguage });
  const underReview = useMemo(
    () => ({
      lemmas: new Set((activeReviewLemmas.data?.lemmas ?? []).map((l) => l.toLowerCase())),
      surfaces: new Set((activeReviewLemmas.data?.surfaces ?? []).map((s) => s.toLowerCase())),
    }),
    [activeReviewLemmas.data],
  );

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
  const generateMutation = useGenerateReadingText({ fetchFn });
  // On-demand deep annotation — now streamed field-by-field (Req 1.1, 1.2). The
  // hook owns its own state machine; the effect below mirrors that into the
  // reducer's `deepCard` slice (DEEP_CARD_FIELD/RESOLVED/ERROR) so the annotated
  // view renders progressively. `onResolved` is the streaming counterpart of the
  // old mutation's `onSuccess`: for a SAVED span it writes the authoritative card
  // through into the `['readEntry', id]` cache's `spanAnnotations` (Req 2.8,
  // 11.4); the seeding effect below mirrors that back into the reducer so a
  // re-tap is an instant cache hit. Unsaved text carries no `entryId`, so its
  // cards live only in the reducer session map (via DEEP_CARD_RESOLVED).
  const annotateSpan = useReadAnnotateSpanStream({
    baseUrl: process.env.NEXT_PUBLIC_ANNOTATE_STREAM_URL ?? '',
    getToken,
    onResolved: (card, span) => {
      if (!span.entryId) return;
      const existing = queryClient.getQueryData<ReadEntryResponse>([
        'readEntry',
        span.entryId,
      ]);
      if (!existing) return;
      const key = `${span.start}:${span.end}`;
      queryClient.setQueryData<ReadEntryResponse>(['readEntry', span.entryId], {
        ...existing,
        spanAnnotations: {
          ...(existing.spanAnnotations ?? {}),
          [key]: card,
        },
      });
    },
  });
  // The span currently driving `annotateSpan` — carried in a ref so the
  // hook-state→reducer mirror effect has the full `DeepSpan` (type/x/y) to
  // dispatch with, matched by start/end to the open card.
  const openDeepSpanRef = useRef<DeepSpan | null>(null);
  // Latest "auto-save this resolved single word unless it's already saved"
  // closure, invoked by the deep-stream mirror effect on resolve. Held in a ref
  // so that effect stays keyed only on `spanStreamState` (fires once per
  // resolve) while still calling the current handler with fresh bank/saved
  // state. Default-add on lookup: a looked-up word lands in the bank; the user
  // removes rather than saves.
  const maybeAutoSaveWordRef = useRef<(card: DeepCard, span: DeepSpan) => void>(
    () => {},
  );
  // Deep card → vocabulary save + undo (Req 8.4, 8.5). Independent of the entry
  // bank and of entry `spanAnnotations` (Req 11.7).
  const saveVocab = useSaveVocabularyCard({ fetchFn });
  const deleteVocab = useDeleteVocabularyCard({ fetchFn });

  // Optimistically patch the open entry's saved-vocab list in the query cache,
  // so the word-bank panel reflects a save/unsave instantly (the deep-save and
  // unsave paths carry the vocab id; other writes reconcile on the next fetch).
  const patchSavedVocab = (
    entryId: string,
    fn: (items: SavedVocabItem[]) => SavedVocabItem[],
  ) => {
    queryClient.setQueryData<ReadEntryResponse>(['readEntry', entryId], (prev) =>
      prev ? { ...prev, savedVocab: fn(prev.savedVocab ?? []) } : prev,
    );
  };

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
  // entry cache changes — including `annotateSpan.onResolved`'s write-through —
  // so the reducer's session map stays in lockstep with the durable store. The
  // reducer MERGES, so cards resolved before the query settled survive.
  useEffect(() => {
    const data = entryQuery.data;
    if (!data) return;
    dispatch({
      type: 'SET_SPAN_ANNOTATIONS',
      spanAnnotations: data.spanAnnotations ?? {},
    });
  }, [entryQuery.data]);

  // Re-hydrate generation provenance when a saved entry loads, so reopening a
  // generated text restores the provenance header + adjust bar (adjust-from-
  // history). A generated entry carries `kind/category/cefr/length/prompt`;
  // pasted entries clear provenance to `null` (lean reader).
  useEffect(() => {
    const data = entryQuery.data;
    if (!data) return;
    if (data.kind === 'generated' && data.cefr && data.length) {
      dispatch({
        type: 'SET_PROVENANCE',
        provenance: {
          kind: 'generated',
          category: data.category ?? null,
          cefr: data.cefr,
          length: data.length,
          prompt: data.prompt ?? '',
          language: data.language,
        },
      });
    } else {
      dispatch({ type: 'SET_PROVENANCE', provenance: null });
    }
  }, [entryQuery.data]);

  // Mirror the deep-span stream hook's state into the reducer's `deepCard`
  // slice. `streaming` → DEEP_CARD_FIELD per completed field (the reducer
  // merges, so re-dispatching the full partial is idempotent); `complete` →
  // DEEP_CARD_RESOLVED (lands the card in the session map even for unsaved
  // text, which `onResolved` skips); `error` → DEEP_CARD_ERROR. The reducer's
  // start/end guards drop any dispatch that no longer matches the open span,
  // so a late frame from a superseded span is ignored.
  const spanStreamState = annotateSpan.state;
  useEffect(() => {
    const span = openDeepSpanRef.current;
    if (!span) return;
    if (spanStreamState.phase === 'streaming') {
      for (const [key, value] of Object.entries(spanStreamState.partial)) {
        dispatch({ type: 'DEEP_CARD_FIELD', span, key, value });
      }
    } else if (spanStreamState.phase === 'complete') {
      dispatch({ type: 'DEEP_CARD_RESOLVED', span, card: spanStreamState.card });
      // Default-add: bank the word the moment its lookup resolves.
      maybeAutoSaveWordRef.current(spanStreamState.card, span);
    } else if (spanStreamState.phase === 'error') {
      const error: AnnotateError = {
        code: spanStreamState.error.code,
        message: spanStreamState.error.message,
        status: spanStreamState.error.status,
      };
      dispatch({ type: 'DEEP_CARD_ERROR', span, error });
    }
  }, [spanStreamState]);

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
    if (view === 'generating') {
      // Drop any in-flight stream, then pre-fill the launchpad with the user's
      // tracked level + active language before opening it.
      annotate.abort();
      if (proficiencyLevel !== null) {
        dispatch({ type: 'GENERATE_FIELD', field: 'cefr', value: proficiencyLevel });
      }
      dispatch({ type: 'GENERATE_FIELD', field: 'language', value: activeLanguage });
      dispatch({ type: 'SET_VIEW', view: 'generating' });
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

  // Shared annotation kickoff for both the paste form and a freshly generated
  // text. Takes the text/title EXPLICITLY (rather than reading `state.paste`)
  // so callers that set the paste fields in the same tick — the generate
  // onSuccess does — start the stream against the new text, not the stale
  // pre-dispatch snapshot. The pasted/generated text is mirrored into
  // `state.paste` so the ephemeral entry renders it and the later save/bank
  // paths (which read `state.paste.title`/`.text`) stay consistent.
  const startAnnotation = (text: string, title: string) => {
    dispatch({ type: 'PASTE_FIELD', field: 'title', value: title });
    dispatch({ type: 'PASTE_FIELD', field: 'text', value: text });
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
    annotate.start({ language: activeLanguage, text });
  };

  const handleAnnotate = () => {
    startAnnotation(state.paste.text, state.paste.title);
  };

  // Open the generate launchpad from the empty view. Pre-fill the form's CEFR
  // and language from the user's tracked level + the shell's active language so
  // the defaults match what the rest of the page is already bound to (the
  // annotate/save pipeline runs against `activeLanguage`).
  // Both the empty-state CTA and the top-bar "+ generate" button route here via
  // handleViewChange('generating'), which applies the level/language defaults.
  const handleOpenGenerate = () => handleViewChange('generating');

  // Generation metadata persisted alongside a saved entry. Sourced from the
  // open passage's provenance: generated texts carry the full record so library
  // cards are rich + "adjust" works after reopening; pasted texts leave the
  // generation fields null (lean cards). Spread into every save payload.
  const provenanceMeta = () => ({
    kind: state.provenance?.kind ?? ('pasted' as const),
    category: state.provenance?.category ?? null,
    cefr: state.provenance?.cefr ?? null,
    length: state.provenance?.length ?? null,
    prompt: state.provenance?.prompt ?? null,
  });

  // Pick a popular-start / composer idea: prefill the composer's topic +
  // category, then open the launchpad (defaults CEFR + language). Works from
  // both the empty state and the composer's idea chips.
  const handlePickIdea = (idea: ReadingIdea) => {
    dispatch({ type: 'GENERATE_FIELD', field: 'topic', value: idea.prompt });
    dispatch({ type: 'GENERATE_FIELD', field: 'category', value: idea.category });
    handleViewChange('generating');
  };

  // Generate a passage, then feed it into the SAME annotate pipeline the paste
  // "Annotate" button uses: `startAnnotation` mirrors the text/title into
  // `state.paste` and fires the streaming annotate against `activeLanguage`.
  const handleGenerate = () => {
    const cefr = state.generate.cefr;
    const length = state.generate.length;
    const topic = state.generate.topic;
    const category = state.generate.category;
    generateMutation.mutate(
      {
        // Single source of truth: the request language is the shell's
        // `activeLanguage`, NOT a separate in-form picker. This guarantees the
        // generated text is in the same language the annotate/save/bank pipeline
        // (which all read `activeLanguage`) will score and persist it under.
        // `activeLanguage` is a `LearningLanguage` ('ES'|'DE'|'TR'), exactly
        // what the request schema expects.
        language: activeLanguage,
        cefr,
        length,
        topic,
      },
      {
        onSuccess: (data) => {
          // Record provenance so the reader mounts the provenance header +
          // adjust bar and a later save persists the generation metadata.
          dispatch({
            type: 'SET_PROVENANCE',
            provenance: {
              kind: 'generated',
              category,
              cefr,
              length,
              prompt: topic,
              language: activeLanguage,
            },
          });
          startAnnotation(data.text, data.title);
        },
      },
    );
  };

  // Adjust the open generated passage without retyping: regenerate from the
  // stored provenance with a tweaked parameter, then re-annotate. `easier` /
  // `harder` step the CEFR ±1 (clamped at A1/C2); `longer` steps the length +1
  // (clamped at LONG); `rewrite` keeps the same params but forces a fresh
  // variation via `noCache`. No-op when there's no generated provenance.
  const handleAdjust = (kind: 'easier' | 'harder' | 'longer' | 'rewrite') => {
    const prov = state.provenance;
    if (!prov || prov.kind !== 'generated') return;

    const cefrValues = Object.values(CefrLevel);
    const lengthValues = Object.values(ReadingTextLength);
    const cefrIdx = cefrValues.indexOf(prov.cefr);
    const lengthIdx = lengthValues.indexOf(prov.length);

    let nextCefr = prov.cefr;
    let nextLength = prov.length;
    if (kind === 'easier') {
      nextCefr = cefrValues[Math.max(0, cefrIdx - 1)];
    } else if (kind === 'harder') {
      nextCefr = cefrValues[Math.min(cefrValues.length - 1, cefrIdx + 1)];
    } else if (kind === 'longer') {
      nextLength = lengthValues[Math.min(lengthValues.length - 1, lengthIdx + 1)];
    }

    generateMutation.mutate(
      {
        // `prov.language` is a `'ES'|'DE'|'TR'` literal union (reducer slice);
        // the request schema's `language` is the nominal `LearningLanguage`
        // enum. The underlying string values are identical.
        language: prov.language as LearningLanguage,
        cefr: nextCefr,
        length: nextLength,
        topic: prov.prompt,
        noCache: kind === 'rewrite',
      },
      {
        onSuccess: (data) => {
          dispatch({
            type: 'SET_PROVENANCE',
            provenance: {
              ...prov,
              cefr: nextCefr,
              length: nextLength,
            },
          });
          startAnnotation(data.text, data.title);
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
    // Dismiss whichever card is open — the skim popover and/or the deep card.
    dispatch({ type: 'CLOSE_POPOVER' });
    dispatch({ type: 'DISMISS_DEEP_CARD' });
  };

  // Open the deep-span stream for a span (Req 1.1). Records the span in the ref
  // so the mirror effect can route streamed fields + the terminal card/error
  // back into the reducer's deep-card slice (Req 1.2, 1.3, 1.5). `entryId` is
  // sent only for a saved entry, so the server persists onto it (Req 11.1) and
  // skips the DB write for unsaved text (Req 11.2).
  const runSpanAnnotation = (span: DeepSpan) => {
    openDeepSpanRef.current = span;
    annotateSpan.start({
      language: activeLanguage,
      text: annotatedEntry?.text ?? state.paste.text,
      start: span.start,
      end: span.end,
      entryId: state.activeEntryId ?? undefined,
    });
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
            // Surface the save in the word-bank panel immediately (Req: show all
            // saved words, flagged or on-demand). Append to match the server's
            // oldest-first order; replace any prior row for the same surface.
            const item = vocabItemFromCard(id, card);
            if (item && sourceReadEntryId) {
              patchSavedVocab(sourceReadEntryId, (items) => [
                ...items.filter((v) => v.word.toLowerCase() !== item.word.toLowerCase()),
                item,
              ]);
            }
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
        ...provenanceMeta(),
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
    const entryId = state.activeEntryId;
    deleteVocab.mutate(vocabId, {
      onSuccess: () => {
        setDeepSaved(null);
        setVocabToast(null);
        // Mirror the unsave in the word-bank panel (the save optimistically
        // added this row).
        if (entryId) {
          patchSavedVocab(entryId, (items) => items.filter((v) => v.id !== vocabId));
        }
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

  // Everything saved from this passage (flagged-banked + on-demand), driving the
  // word-bank panel. Sourced from the entry query (which the save/unsave paths
  // patch optimistically), so it persists across reloads — unlike `state.bank`,
  // which only holds flagged words.
  const savedVocab = entryQuery.data?.savedVocab ?? [];

  // Surface forms shown with the "saved" style in the passage (Req 8.4) — every
  // saved single word, plus the just-saved one before the query settles.
  const savedWordKeys = useMemo(() => {
    const keys = new Set(
      savedVocab.filter((v) => v.type === 'word').map((v) => v.word.toLowerCase()),
    );
    if (deepSaved?.wordKey) keys.add(deepSaved.wordKey);
    return keys;
  }, [savedVocab, deepSaved]);

  // Default-add on lookup: auto-save a resolved single-word deep card to the
  // word bank. Words only — phrases/sentences keep their manual save button.
  // Only ever ADDS: an already-saved word (still shown saved, or a re-tap) is a
  // no-op, so a passive lookup never toggles a word back out. Reuses
  // handleSaveCard, so flagged-vs-non-flagged bank routing and lazy entry
  // creation are unchanged.
  maybeAutoSaveWordRef.current = (card, span) => {
    if (card.type !== 'word') return;
    if (savedWordKeys.has(card.surface.toLowerCase())) return;
    handleSaveCard(card, span);
  };

  // Unsave (✕) a row from the word-bank panel: delete the vocabulary record
  // (server also drops the now-orphaned FSRS review card), drop it from the
  // panel optimistically, clear the open card's "saved" state if it was this
  // row, and un-bank it if it was a flagged bank word (keeps `savedCount` and
  // the bank column honest).
  const handleUnsaveVocab = (item: SavedVocabItem) => {
    const entryId = state.activeEntryId;
    if (entryId) {
      patchSavedVocab(entryId, (items) => items.filter((v) => v.id !== item.id));
    }
    if (deepSaved?.vocabId === item.id) {
      setDeepSaved(null);
      setVocabToast(null);
    }
    const lower = item.word.toLowerCase();
    if (entryId !== null && state.bank.includes(lower)) {
      dispatch({ type: 'TOGGLE_BANK_WORD', word: lower });
      updateBank.mutate(
        {
          id: entryId,
          language: activeLanguage,
          bank: state.bank.filter((w) => w !== lower),
        },
        { onError: () => dispatch({ type: 'SHOW_INLINE_ERROR', kind: 'bank' }) },
      );
    }
    deleteVocab.mutate(item.id, {
      onError: () => {
        dispatch({ type: 'SHOW_INLINE_ERROR', kind: 'save' });
        if (entryId) {
          void queryClient.invalidateQueries({ queryKey: ['readEntry', entryId] });
        }
      },
    });
  };

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
    const lower = word.toLowerCase();

    // Un-bank == "unsave from this passage". Banking a flagged word materialises
    // a `user_vocabulary` row server-side (read.ts), and the word-bank panel is
    // driven by those rows — so undo it through the SAME delete path the panel's
    // ✕ uses, keeping the panel, the bank column, and the FSRS queue consistent.
    if (inBank) {
      const existing = savedVocab.find((v) => v.word.toLowerCase() === lower);
      if (existing) {
        handleUnsaveVocab(existing);
        return;
      }
      // No materialised vocab row to delete yet (e.g. a lazy entry that hasn't
      // persisted) — just drop the bank membership.
      dispatch({ type: 'TOGGLE_BANK_WORD', word });
      if (state.activeEntryId !== null) {
        updateBank.mutate(
          {
            id: state.activeEntryId,
            language: activeLanguage,
            bank: state.bank.filter((w) => w !== word),
          },
          { onError: () => dispatch({ type: 'SHOW_INLINE_ERROR', kind: 'bank' }) },
        );
      }
      return;
    }

    // Bank (add) a flagged word.
    const newBank = [...state.bank, word];
    dispatch({ type: 'TOGGLE_BANK_WORD', word });

    if (state.activeEntryId !== null) {
      const entryId = state.activeEntryId;
      updateBank.mutate(
        {
          id: entryId,
          language: activeLanguage,
          bank: newBank,
        },
        {
          // The PUT materialises a vocab row for the added word. Refetch the
          // entry so the word-bank panel surfaces it right away — without this,
          // flagged saves only appeared after a reload, while non-flagged
          // on-demand saves (patched optimistically in handleSaveCard) showed at
          // once. That divergence was the "depends on whether it's underlined"
          // inconsistency.
          onSuccess: () => {
            void queryClient.invalidateQueries({
              queryKey: ['readEntry', entryId],
            });
          },
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
        ...provenanceMeta(),
      },
      {
        onSuccess: (data) => {
          dispatch({ type: 'ENTRY_PERSISTED', entryId: data.id });
          // The POST materialised the banked word's vocab row, but the
          // write-through cache from useSaveReadEntry carries no `savedVocab`.
          // Refetch so the panel reflects the freshly-banked word.
          void queryClient.invalidateQueries({
            queryKey: ['readEntry', data.id],
          });
        },
        onError: () => {
          dispatch({ type: 'SHOW_INLINE_ERROR', kind: 'save' });
        },
      },
    );
  };

  // Save the open (unsaved) passage to the library, even with an empty bank —
  // the redesigned collect bar exposes an explicit "save text" that no longer
  // requires collecting a word first. When the entry already exists this is a
  // no-op (it's already in history) — the button is disabled in that state via
  // `canSaveToLibrary` so it never looks actionable. Persists provenance
  // metadata so the library card is rich for generated texts.
  const handleSaveToLibrary = () => {
    if (state.activeEntryId !== null) return;
    if (saveEntry.isPending) return;
    if (annotate.state.phase !== 'complete') return;
    saveEntry.mutate(
      {
        language: activeLanguage,
        title: state.paste.title,
        source: '',
        text: state.paste.text,
        flagged: annotate.state.flaggedMap,
        bank: state.bank,
        ...provenanceMeta(),
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

  // "Add N to vocabulary" — the same save path; the banked words are already in
  // `state.bank`, so persisting the entry pushes them into the vocabulary
  // pipeline (the server materializes vocab rows from the bank on save).
  const handleAddToVocabulary = () => {
    handleSaveToLibrary();
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
        onGenerate={handleOpenGenerate}
        onPickIdea={handlePickIdea}
        languageLabel={languageLabel}
      />
    );
  } else if (state.view === 'generating') {
    const generateRateLimited =
      (generateMutation.error as { status?: number } | null)?.status === 429;
    // While the generation POST is in flight, swap the composer for the calm
    // "calibrating" loader; otherwise render the composer.
    body = generateMutation.isPending ? (
      <GeneratingView
        languageLabel={languageLabel}
        provenance={{
          category: state.generate.category,
          cefr: state.generate.cefr,
          length: state.generate.length,
          prompt: state.generate.topic,
        }}
      />
    ) : (
      <GenerateView
        state={state.generate}
        ideas={READING_IDEAS}
        languageLabel={languageLabel}
        yourLevel={proficiencyLevel}
        onChange={(field, value) => {
          dispatch({
            type: 'GENERATE_FIELD',
            field,
            value: String(value),
          });
          // Free-text edits drop any picked-idea category (no category for
          // hand-written topics); idea picks set both via `handlePickIdea`.
          if (field === 'topic') {
            dispatch({ type: 'GENERATE_FIELD', field: 'category', value: '' });
          }
        }}
        onPickIdea={handlePickIdea}
        onGenerate={handleGenerate}
        onCancel={() => dispatch({ type: 'SET_VIEW', view: 'empty' })}
        isLoading={generateMutation.isPending}
        errorBody={generateRateLimited ? null : (generateMutation.error?.message ?? null)}
        rateLimited={generateRateLimited}
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
        <HistoryView
          entries={entries}
          onOpen={handleHistoryOpen}
          onGenerateNew={handleOpenGenerate}
        />
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
          savedVocab={savedVocab}
          onUnsaveVocab={handleUnsaveVocab}
          underReview={underReview}
          onBankToggle={handleBankToggle}
          onPasteNew={handlePasteNew}
          provenance={state.provenance}
          onAdjust={handleAdjust}
          adjustBusy={generateMutation.isPending}
          flaggedCount={Object.keys(annotatedEntry.flaggedWords).length}
          savedCount={savedVocab.length}
          onSaveToLibrary={handleSaveToLibrary}
          // The text can only be saved while it's an unsaved paste that's
          // finished annotating; an opened/persisted entry already lives in the
          // library, so the button disables instead of silently no-op'ing.
          canSaveToLibrary={
            state.activeEntryId === null &&
            annotate.state.phase === 'complete'
          }
          onAddToVocabulary={handleAddToVocabulary}
          saving={saveEntry.isPending}
          languageLabel={languageLabel}
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
