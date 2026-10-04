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
/**
 * The card both states share. It carries the weight that stops this block
 * reading as one more paragraph: a rule and a wide top margin to break it off
 * the prose, an eyebrow naming what it is, and a raised surface.
 */
function QuickCheckShell({ children }: { children: React.ReactNode }) {
  return (
    <section
      aria-label="Quick check"
      className="mt-s-6 border-t border-rule pt-s-6"
      data-quick-check
    >
      <div className="t-mono mb-s-2 text-[11px] tracking-[1.6px] text-accent-2 uppercase">
        Quick check
      </div>
      <p className="t-small mt-0 mb-s-3 text-ink-mute">
        Three sentences, graded here. Nothing is saved and no account is needed.
      </p>
      <div className="rounded-lg border border-rule bg-card p-s-5 shadow-[var(--shadow-2)]">
        {children}
      </div>
    </section>
  );
}

/** ✓ / ✗ as inline SVG — no icon dependency, inherits the verdict colour. */
function VerdictIcon({ correct }: { correct: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      width="22"
      height="22"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.25"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="shrink-0"
    >
      {correct ? <path d="M4 10.5l4 4 8-8.5" /> : <path d="M5 5l10 10M15 5L5 15" />}
    </svg>
  );
}

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
      <QuickCheckShell>
        <p className="t-display-s m-0 text-ink">{correct} of {items.length} right.</p>
        <p className="t-small text-ink-soft">
          {correct === items.length
            ? 'Solid. Lock it in with a longer set.'
            : 'Worth another round.'}
        </p>
        <div className="flex flex-wrap items-center gap-s-3">
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
      </QuickCheckShell>
    );
  }

  const lastResult = results[results.length - 1];

  return (
    <QuickCheckShell>
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
        <div>
          {/*
            The verdict reads at a glance: icon plus heading in the verdict
            colour. Below it, BOTH answers are always named — without echoing
            what the reader typed, a wrong verdict showed only the correct form
            and left them to remember what they had written.
          */}
          <div
            className={`flex items-center gap-s-2 ${lastResult ? 'text-ok' : 'text-accent-2'}`}
            role="status"
          >
            <VerdictIcon correct={lastResult} />
            <span className="t-display-s">{lastResult ? 'Right' : 'Not quite'}</span>
          </div>

          <dl className="mt-s-3 mb-0 grid grid-cols-[auto_1fr] gap-x-s-3 gap-y-[4px]">
            <dt className="t-mono text-[11px] tracking-[1px] text-ink-mute uppercase">
              You wrote
            </dt>
            <dd
              className={`t-body m-0 font-medium ${lastResult ? 'text-ink' : 'text-accent-2'}`}
            >
              {typed.trim()}
            </dd>
            {!lastResult && (
              <>
                <dt className="t-mono text-[11px] tracking-[1px] text-ink-mute uppercase">
                  Correct
                </dt>
                <dd className="t-body m-0 font-medium text-ok">{item!.correctAnswer}</dd>
              </>
            )}
          </dl>

          <button type="button" onClick={advance} className="link-arrow mt-s-4">
            {index === items.length - 1 ? 'See result' : 'Next'}
          </button>
        </div>
      )}
    </QuickCheckShell>
  );
}
