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
          await queue.refetch();
        } finally {
          setIndex(0);
          setIsRefetching(false);
        }
      } else {
        move(1);
      }
    } catch {
      // Never silently lose a label: keep the row and the draft on screen.
      setError('Save failed — the label is still here. Press Enter to retry.');
    }
  }, [draft, index, item, items.length, move, queue, save, stratum]);

  useEffect(() => {
    const isEditable = (el: HTMLElement | null): boolean =>
      !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' || el.tagName === 'SELECT');

    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      // Typing a critique must never trigger a verdict shortcut. Checking
      // only e.target misses the case where the key event is dispatched
      // against window directly (its target is then window, not the
      // textarea) while the textarea still holds focus, so also check
      // document.activeElement.
      if (isEditable(target) || isEditable(document.activeElement as HTMLElement | null)) {
        return;
      }
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
  }, [commit, move]);

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
