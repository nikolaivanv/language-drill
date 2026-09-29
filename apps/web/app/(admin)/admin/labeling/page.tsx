'use client';

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  useLabelingQueue,
  useLabelingStats,
  useSaveLabel,
} from '@language-drill/api-client';
import {
  LABEL_TAGS,
  LABEL_STRATA,
  LABELABLE_EXERCISE_TYPES,
  type LabelTag,
  type LabelableExerciseType,
} from '@language-drill/shared';
import { SubmissionCard } from './_components/submission-card';
import { LabelBar, type LabelDraft } from './_components/label-bar';
import { FilterSelect } from '../../../../components/admin/filter-select';

const EMPTY_DRAFT: LabelDraft = { gradeOk: null, feedbackOk: null, tags: [], critique: '' };
// Per-keypress scroll distance for ArrowUp/ArrowDown over the card (see the
// canScrollDown/CARD_SCROLL_STEP usage in LabelingPage).
const CARD_SCROLL_STEP = 140;

// The endpoint's QueueQuerySchema.language enum — kept as a literal tuple
// (rather than importing from the lambda package, which the web app cannot
// depend on) so 'all' can be prepended as the unfiltered sentinel option.
const LANGUAGES = ['ES', 'DE', 'TR'] as const;
type LanguageFilter = 'all' | (typeof LANGUAGES)[number];
type TypeFilter = 'all' | LabelableExerciseType;
type HasErrorsFilter = 'all' | 'true';

export default function LabelingPage() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);

  const [stratum, setStratum] = useState<(typeof LABEL_STRATA)[number]>('random');
  const [language, setLanguage] = useState<LanguageFilter>('all');
  const [type, setType] = useState<TypeFilter>('all');
  const [hasErrors, setHasErrors] = useState<HasErrorsFilter>('all');
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
  // Synchronous re-entrancy guard. `isRefetching` / `save.isPending` only
  // reach commit()'s (and the keydown listener's) closures after a render
  // commits, so a second Enter fired in the SAME tick — before either state
  // update has been observed — would read stale `false` values and slip
  // through both. This ref is set at the very top of commit(), before any
  // `await`, and is what actually closes that window; the state checks stay
  // in place too, since they're what drive the disabled UI.
  const committingRef = useRef(false);

  // Shared by the stratum select and every filter select: switching to a
  // different query means the current index/draft/error/retry state all
  // describe a row from the OLD query and must never ride onto the new one
  // — a missed reset here is exactly how a draft has leaked onto the wrong
  // submission before on this page (see committingRef's own history). Pulled
  // into one function rather than duplicated at each onChange so a fifth
  // filter added later can't reintroduce that gap by copy-paste omission.
  const resetForNewQuery = useCallback(() => {
    setIndex(0);
    setDraft(EMPTY_DRAFT);
    setError(null);
    setRefetchFailed(false);
  }, []);

  const filters = useMemo(
    () => ({
      language: language === 'all' ? undefined : language,
      type: type === 'all' ? undefined : type,
      hasErrors: hasErrors === 'all' ? undefined : true,
    }),
    [language, type, hasErrors],
  );

  const queue = useLabelingQueue({ fetchFn, stratum, filters });
  const stats = useLabelingStats({ fetchFn });
  const save = useSaveLabel({ fetchFn });

  const items = queue.data?.items ?? [];
  const item = items[index];

  // Measures the sticky LabelBar's own rendered height so the scrollable
  // card above it can reserve exactly that much bottom space. The bar's
  // height itself varies (tag rows wrap, the error line appears/disappears,
  // the critique textarea can grow) so a hardcoded pixel guess would drift;
  // ResizeObserver keeps this exact across every submission and window size.
  const barRef = useRef<HTMLDivElement | null>(null);
  const [barHeight, setBarHeight] = useState(0);
  useEffect(() => {
    const el = barRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setBarHeight(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [item]);
  // Reserving bottom PADDING on the card for the bar's height (tried first)
  // does not work: the card's own content is already laid out — trailing
  // space added after it can never pull an earlier line up out from behind
  // a bar that is pinned to the viewport bottom for the entire scrollable
  // range whenever total content exceeds one viewport (verified empirically
  // — the feedback text stayed cut off with that approach). The only way to
  // guarantee the card's real content never renders under the bar is to cap
  // the card's own box to the space actually available above the bar and
  // let IT scroll internally, so the outer column never needs the bar's
  // sticky clamp to engage at all. `cardWrapperRef.getBoundingClientRect().top`
  // already reflects every ancestor's padding (including AdminShell's
  // `<main>` py-[36px], which this page reads but does not touch), so no
  // other magic number is needed for the top side; ADMIN_MAIN_BOTTOM_PADDING
  // mirrors that same `<main>` padding for the bottom side, since nothing
  // below the card measures it for us.
  //
  // Keyed on `item` too (not just `barHeight`): the card wrapper and its ref
  // don't exist in the DOM until the first item has loaded, so the very
  // first measurement has to be retried once that mount actually happens —
  // a `barHeight`-only dependency would fire once against a null ref (while
  // the queue was still loading) and never again.
  const ADMIN_MAIN_BOTTOM_PADDING = 36;
  const CARD_TO_BAR_GAP = 16; // matches the flex column's own `gap-4`.
  const cardWrapperRef = useRef<HTMLDivElement | null>(null);
  const [cardMaxHeight, setCardMaxHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    function recompute() {
      const el = cardWrapperRef.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top;
      const available =
        window.innerHeight - top - CARD_TO_BAR_GAP - barHeight - ADMIN_MAIN_BOTTOM_PADDING;
      // Never collapse below a usable minimum — an extreme window size
      // should degrade to "mostly scrolled" rather than an unusable sliver.
      setCardMaxHeight(Math.max(available, 160));
    }
    recompute();
    window.addEventListener('resize', recompute);
    return () => window.removeEventListener('resize', recompute);
  }, [barHeight, item]);
  // A clipped-but-not-labelled card is worse than no clipping at all: a
  // labeler who never learns the feedback continues will grade `feedbackOk`
  // against a partial read, silently corrupting the very ground truth this
  // page exists to collect. `canScrollDown` drives a visible "↓ more" marker
  // (rendered only while true, so it never becomes noise on a short
  // submission that already fits) and is recomputed on scroll, on layout
  // changes (paired with the cardMaxHeight effect above, which changes the
  // DOM height this reads), and once more per item in case a new submission
  // starts already scrolled to a stale position.
  const [canScrollDown, setCanScrollDown] = useState(false);
  const recomputeScrollAffordance = useCallback(() => {
    const el = cardWrapperRef.current;
    if (!el) {
      setCanScrollDown(false);
      return;
    }
    setCanScrollDown(el.scrollHeight - el.scrollTop - el.clientHeight > 1);
  }, []);
  useLayoutEffect(() => {
    recomputeScrollAffordance();
  }, [recomputeScrollAffordance, cardMaxHeight, item]);
  useEffect(() => {
    const el = cardWrapperRef.current;
    if (!el) return;
    el.addEventListener('scroll', recomputeScrollAffordance);
    return () => el.removeEventListener('scroll', recomputeScrollAffordance);
  }, [recomputeScrollAffordance, item]);

  const move = useCallback(
    (delta: number) => {
      setIndex((i) => Math.min(Math.max(i + delta, 0), Math.max(items.length - 1, 0)));
      setDraft(EMPTY_DRAFT);
      setError(null);
    },
    [items.length],
  );

  const commit = useCallback(async () => {
    // Synchronous guard first: closes the same-tick race the state-based
    // checks below cannot (see the committingRef comment above).
    if (committingRef.current) return;
    committingRef.current = true;
    try {
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
            // The draft was typed (if at all) while looking at the OLD,
            // already-saved item during the retry window — never let it
            // ride onto the fresh items[0], a submission it was never
            // reviewed against.
            setDraft(EMPTY_DRAFT);
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
    } finally {
      committingRef.current = false;
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
        // The card wrapper carries no `tabIndex` (adding one would steal
        // Tab-order focus on a page that is otherwise entirely
        // keydown-shortcut-driven), so it can never receive focus and a
        // native arrow key would never scroll it — these two are the only
        // way to reach a submission's remaining feedback from the keyboard.
        case 'ArrowDown':
          e.preventDefault();
          cardWrapperRef.current?.scrollBy({ top: CARD_SCROLL_STEP });
          break;
        case 'ArrowUp':
          e.preventDefault();
          cardWrapperRef.current?.scrollBy({ top: -CARD_SCROLL_STEP });
          break;
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
            resetForNewQuery();
          }}
        >
          {LABEL_STRATA.map((s) => (
            <option key={s} value={s}>{s}</option>
          ))}
        </FilterSelect>
        <FilterSelect
          aria-label="language"
          value={language}
          onChange={(e) => {
            setLanguage(e.target.value as LanguageFilter);
            resetForNewQuery();
          }}
        >
          <option value="all">all languages</option>
          {LANGUAGES.map((l) => (
            <option key={l} value={l}>{l}</option>
          ))}
        </FilterSelect>
        <FilterSelect
          aria-label="type"
          value={type}
          onChange={(e) => {
            setType(e.target.value as TypeFilter);
            resetForNewQuery();
          }}
        >
          <option value="all">all types</option>
          {LABELABLE_EXERCISE_TYPES.map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </FilterSelect>
        <FilterSelect
          aria-label="hasErrors"
          value={hasErrors}
          onChange={(e) => {
            setHasErrors(e.target.value as HasErrorsFilter);
            resetForNewQuery();
          }}
        >
          <option value="all">all rows</option>
          <option value="true">only rows with errors</option>
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
          {/* Bounded + independently scrollable: caps the card's own box to
              whatever space is actually free above the sticky bar (see the
              cardMaxHeight effect above) so a long stimulus + Claude
              feedback scrolls WITHIN this box, with its own visible
              scrollbar, and never renders underneath the bar's opaque
              panel. The "↓ more" marker (canScrollDown) is the only cue that
              a submission continues past the fold — without it, a labeler
              can grade `feedbackOk` having read only part of the feedback,
              which corrupts the ground truth this page exists to collect —
              so it is load-bearing, not decoration. */}
          <div className="relative min-h-0">
            <div
              ref={cardWrapperRef}
              className="min-h-0 overflow-y-auto"
              style={cardMaxHeight !== null ? { maxHeight: cardMaxHeight } : undefined}
            >
              <SubmissionCard item={item} />
            </div>
            {canScrollDown && (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center pb-2">
                <span className="rounded-full border border-rule bg-paper px-3 py-1 text-[11px] font-medium text-ink-soft shadow-[0_1px_4px_rgba(0,0,0,0.12)]">
                  ↓ more — ↑/↓ to scroll
                </span>
              </div>
            )}
          </div>
          <LabelBar
            draft={draft}
            onChange={setDraft}
            error={error}
            disabled={save.isPending || refetchFailed}
            critiqueRef={critiqueRef}
            rootRef={barRef}
          />
        </>
      )}
    </div>
  );
}
