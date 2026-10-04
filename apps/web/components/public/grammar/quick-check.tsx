'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { gradeFluencyAnswer, type ExerciseContent } from '@language-drill/shared';
import type { QuickCheckItem } from '@language-drill/api-client';

/**
 * Three cloze sentences from the approved pool, graded in the browser — no LLM
 * call, no account, nothing stored.
 *
 * Grading delegates to `gradeFluencyAnswer`, the same pure function the public
 * conjugation drill and the authenticated fluency mode use. Writing a
 * `toLowerCase() === ` comparison here would silently disagree with the rest of
 * the product on diacritics and on Turkish İ/I.
 */
export function QuickCheck({
  items,
  drillHref,
}: {
  items: QuickCheckItem[];
  drillHref: string | null;
}) {
  const [index, setIndex] = useState(0);
  const [typed, setTyped] = useState('');
  const [results, setResults] = useState<boolean[]>([]);
  const [showFeedback, setShowFeedback] = useState(false);
  // `setShowFeedback(true)` only takes effect on the next render, which is
  // exactly the window a held Enter key (or Enter racing a click on Check)
  // lives in: both handlers can call `check()` against the same `item` and
  // `typed` before React re-renders, double-appending to `results`. A ref
  // flips synchronously, inside the same tick as the first call, so the
  // second call is rejected before it reads anything.
  const submittingRef = useRef(false);

  // 97 of 312 topics have no usable quick-check rows (72 with no option-free
  // cloze rows at all, 25 with only one or two) — the section must be absent
  // from the page entirely, not an empty bordered box.
  if (items.length === 0) return null;

  const done = index >= items.length;
  const item = done ? null : items[index];

  function check() {
    // First line, before any other guard: synchronous and effective within
    // the same tick, unlike `showFeedback` (see the ref's declaration above).
    if (submittingRef.current) return;
    if (!item || !typed.trim()) return;
    submittingRef.current = true;
    // Minimal object carrying only the two fields the cloze branch of
    // `gradeFluencyAnswer` reads (`content.type` is the dispatch field it
    // switches on; `correctAnswer`/`acceptableAnswers` are what that branch
    // consumes) — the double cast is safe because nothing else is read.
    const content = {
      type: 'cloze',
      correctAnswer: item.correctAnswer,
      acceptableAnswers: item.acceptableAnswers,
    } as unknown as ExerciseContent;
    setResults((prev) => [...prev, gradeFluencyAnswer(content, typed)]);
    setShowFeedback(true);
  }

  function advance() {
    submittingRef.current = false; // released only once the next item is shown
    setShowFeedback(false);
    setTyped('');
    setIndex((i) => i + 1);
  }

  if (done) {
    const correct = results.filter(Boolean).length;
    return (
      <section aria-label="Quick check" className="rounded-lg border border-rule bg-card p-s-4">
        <p className="t-display-s m-0 text-ink">{correct} of {items.length} right.</p>
        <p className="t-small text-ink-soft">
          {correct === items.length
            ? 'Solid. Lock it in with a longer set.'
            : 'Worth another round.'}
        </p>
        <div className="flex flex-wrap gap-s-3">
          {drillHref && (
            <Link href={drillHref} className="link-arrow">
              Continue in the conjugation drill
            </Link>
          )}
          <button
            type="button"
            onClick={() => {
              // Defensive: every path that reaches this "done" screen already
              // ran through `advance()`, which releases the ref — but resetting
              // it explicitly here means a second sitting can never start
              // frozen even if that invariant changes later.
              submittingRef.current = false;
              setIndex(0);
              setResults([]);
              setTyped('');
              setShowFeedback(false);
            }}
            className="t-small text-ink-mute underline underline-offset-2"
          >
            Try again
          </button>
        </div>
      </section>
    );
  }

  const lastResult = results[results.length - 1];

  return (
    <section aria-label="Quick check" className="rounded-lg border border-rule bg-card p-s-4">
      <div className="t-mono text-[11px] text-ink-mute">{index + 1} / {items.length}</div>
      <p className="t-display-s m-0 text-ink">{item!.sentence}</p>
      <p className="t-small text-ink-mute">{item!.instructions}</p>
      {!showFeedback ? (
        <div className="flex gap-s-3">
          <input
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') check(); }}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            aria-label="Your answer"
            className="flex-1 rounded-md border border-rule bg-paper px-s-3 py-s-2 text-ink"
          />
          <button
            type="button"
            onClick={check}
            disabled={!typed.trim()}
            className="rounded-md bg-ink px-s-4 py-s-2 text-paper disabled:opacity-50"
          >
            Check
          </button>
        </div>
      ) : (
        <div className={lastResult ? 'text-ok' : 'text-accent-2'}>
          <p className="t-body m-0">{lastResult ? 'Right.' : 'Not quite.'}</p>
          {!lastResult && <p className="t-body m-0 text-ink">{item!.correctAnswer}</p>}
          <button type="button" onClick={advance} className="link-arrow mt-s-3">
            {index === items.length - 1 ? 'See result' : 'Next'}
          </button>
        </div>
      )}
    </section>
  );
}
