'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  useLabelingQueue,
  useLabelingStats,
  useSaveLabel,
} from '@language-drill/api-client';
import { LABEL_TAGS, LABEL_STRATA, type LabelTag } from '@language-drill/shared';
import { SubmissionCard } from './_components/submission-card';
import { LabelBar, type LabelDraft } from './_components/label-bar';
import { FilterSelect } from '../../../../components/admin/filter-select';

const EMPTY_DRAFT: LabelDraft = { gradeOk: null, feedbackOk: null, tags: [], critique: '' };

export default function LabelingPage() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);

  const [stratum, setStratum] = useState<(typeof LABEL_STRATA)[number]>('random');
  const [index, setIndex] = useState(0);
  const [draft, setDraft] = useState<LabelDraft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  // True only while the end-of-page refetch (below) is in flight. Kept
  // separate from queue.isLoading, which only covers the initial fetch, so
  // that the last-labelled, already-saved card cannot linger on screen
  // looking actionable while its replacement page is being fetched.
  const [isRefetching, setIsRefetching] = useState(false);
  // True when the label saved but the follow-up end-of-page refetch failed.
  // While true, Enter retries the refetch instead of attempting a fresh
  // save — the row that would be "saved again" is the one that already
  // saved successfully, with an emptied draft, which would silently
  // overwrite the real label with a null verdict.
  const [refetchFailed, setRefetchFailed] = useState(false);
  const critiqueRef = useRef<HTMLTextAreaElement | null>(null);

  const queue = useLabelingQueue({ fetchFn, stratum });
  const stats = useLabelingStats({ fetchFn });
  const save = useSaveLabel({ fetchFn });

  const items = queue.data?.items ?? [];
  const item = items[index];

  const move = useCallback(
    (delta: number) => {
      setIndex((i) => Math.min(Math.max(i + delta, 0), Math.max(items.length - 1, 0)));
      setDraft(EMPTY_DRAFT);
      setError(null);
    },
    [items.length],
  );

  const commit = useCallback(async () => {
    // Re-entrancy guard: a save is already in flight, or we're mid-refetch
    // after the last item's save already succeeded. A second Enter landing
    // in that window (key-repeat from holding the key, or a habitual
    // double-press — both plausible over an hour of labelling) must not
    // re-enter: item/index/items haven't changed yet, draft has already
    // been cleared to EMPTY_DRAFT, and validation has no way to tell "no
    // verdict set yet" apart from "already saved, waiting on the refetch" —
    // so a second commit would silently re-save the just-labelled row with
    // a blank verdict, clobbering the real label the UI already reported
    // as saved.
    if (save.isPending || isRefetching) return;

    if (refetchFailed) {
      // The label itself already saved; only the follow-up page fetch
      // failed. Retry the fetch — never attempt a fresh save here, since
      // the current item/draft still describe the row that already saved.
      setIsRefetching(true);
      try {
        const res = await queue.refetch();
        if (res.isError) {
          setError('Label saved. The next page failed to load again — press Enter to retry loading it.');
        } else {
          setRefetchFailed(false);
          setError(null);
          setIndex(0);
        }
      } finally {
        setIsRefetching(false);
      }
      return;
    }

    if (!item) return;
    const hasFalse = draft.gradeOk === false || draft.feedbackOk === false;
    if (hasFalse && draft.critique.trim() === '') {
      setError('Say what was wrong — the critique is what makes this label usable later.');
      critiqueRef.current?.focus();
      return;
    }
    try {
      await save.mutateAsync({
        submissionId: item.submissionId,
        gradeOk: draft.gradeOk,
        feedbackOk: draft.feedbackOk,
        stratum,
        tags: draft.tags,
        critique: draft.critique.trim() === '' ? undefined : draft.critique.trim(),
      });

      if (index >= items.length - 1) {
        // We just labelled the last row on this page. The endpoint filters
        // out rows this labeler has already labelled, so a refetch is
        // naturally a fresh page — no client-side bookkeeping of which ids
        // to exclude needed. Clear the draft/error and hide the card while
        // the refetch is in flight so the just-labelled row never sits on
        // screen looking actionable with nowhere to advance to.
        setDraft(EMPTY_DRAFT);
        setError(null);
        setIsRefetching(true);
        try {
          const res = await queue.refetch();
          if (res.isError) {
            // useLabelingQueue has no throwOnError, so a failed refetch
            // resolves (rather than rejects) with an error result — it
            // never reaches the catch below. Surface it distinctly from a
            // save failure (the label is safely saved; only the next page
            // failed to load) and do NOT reset the index: landing on a
            // stale page's first row — itself already labelled — would be
            // a second, silent version of the same problem.
            setRefetchFailed(true);
            setError('Label saved. The next page failed to load — press Enter to retry loading it.');
          } else {
            setIndex(0);
          }
        } finally {
          setIsRefetching(false);
        }
      } else {
        move(1);
      }
    } catch {
      // Never silently lose a label: keep the row and the draft on screen.
      setError('Save failed — the label is still here. Press Enter to retry.');
    }
  }, [draft, index, item, items.length, move, queue, refetchFailed, save, stratum, isRefetching]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Re-entrancy guard, mirrored from commit(): while a save or the
      // end-of-page refetch is in flight, no shortcut (including Enter)
      // should be able to mutate the draft or re-trigger a commit.
      if (save.isPending || isRefetching) return;

      const target = e.target as HTMLElement | null;

      if (target === critiqueRef.current) {
        // Inside the critique box, every other key must type literally —
        // including '/', which types a slash; it is deliberately not
        // exempted the way it is outside the box, or a critique containing
        // a slash would be unwritable. Enter is the one exception: it
        // saves, matching the natural "press f, press /, type the
        // critique, press Enter" gesture that the verdicts requiring a
        // critique demand. Shift+Enter is left alone so the browser's
        // native textarea behavior inserts a newline instead.
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          void commit();
        }
        return;
      }

      // Outside the critique box, still don't let shortcuts fire while some
      // other form control (e.g. the stratum <select>) has focus.
      if (target && (target.tagName === 'INPUT' || target.tagName === 'SELECT')) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      switch (e.key) {
        case 'j': setDraft((d) => ({ ...d, gradeOk: true })); break;
        case 'f': setDraft((d) => ({ ...d, gradeOk: false })); break;
        case 'k': setDraft((d) => ({ ...d, feedbackOk: true })); break;
        case 'd': setDraft((d) => ({ ...d, feedbackOk: false })); break;
        case 'u': setDraft((d) => ({ ...d, gradeOk: null, feedbackOk: null })); break;
        case '/': e.preventDefault(); critiqueRef.current?.focus(); break;
        case 'Enter': e.preventDefault(); void commit(); break;
        case 'ArrowRight': move(1); break;
        case 'ArrowLeft': move(-1); break;
        default: {
          const n = Number(e.key);
          if (Number.isInteger(n) && n >= 1 && n <= LABEL_TAGS.length) {
            const tag = LABEL_TAGS[n - 1] as LabelTag;
            setDraft((d) => ({
              ...d,
              tags: d.tags.includes(tag) ? d.tags.filter((t) => t !== tag) : [...d.tags, tag],
            }));
          }
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commit, move, save.isPending, isRefetching]);

  const randomStratum = stats.data?.strata.find((s) => s.stratum === 'random');
  const dropped = queue.data?.dropped ?? 0;

  return (
    <div className="flex flex-col gap-4">
      <h1 className="font-display text-[24px] font-semibold text-ink">Label submissions</h1>

      <div className="flex flex-wrap items-center gap-3 text-[13px] text-ink-soft">
        <FilterSelect
          aria-label="stratum"
          value={stratum}
          onChange={(e) => {
            setStratum(e.target.value as (typeof LABEL_STRATA)[number]);
            setIndex(0);
            setDraft(EMPTY_DRAFT);
          }}
        >
          {LABEL_STRATA.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </FilterSelect>
        <span>{items.length === 0 ? 'nothing queued' : `${index + 1} / ${items.length} on this page`}</span>
        <span>· {queue.data?.remaining ?? 0} unlabelled in scope</span>
        <span>· {stats.data?.labeledToday ?? 0} labelled today</span>
        {dropped > 0 && <span>· {dropped} unrenderable, skipped</span>}
        {randomStratum && (
          <span>
            · random stratum: {randomStratum.count} labels, grade ok{' '}
            {(randomStratum.gradeOkRate * 100).toFixed(0)}%
          </span>
        )}
      </div>

      {queue.isLoading || isRefetching ? (
        <p className="text-[13px] text-ink-soft">Loading…</p>
      ) : queue.isError ? (
        <p className="text-[13px] text-ink-soft">Failed to load the queue.</p>
      ) : !item ? (
        <p className="text-[13px] text-ink-soft">Nothing left to label in this scope.</p>
      ) : (
        <>
          <SubmissionCard item={item} />
          <LabelBar
            draft={draft}
            onChange={setDraft}
            error={error}
            disabled={save.isPending}
            critiqueRef={critiqueRef}
          />
        </>
      )}
    </div>
  );
}
