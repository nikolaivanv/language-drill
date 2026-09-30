'use client';

import * as React from 'react';
import Link from 'next/link';
import type { ConjugationContent } from '@language-drill/shared';
import { AccentPicker, Button, Input } from '../ui';
import { PublicCoordinatePrompt } from './public-coordinate-prompt';
import { conjugationVerdict } from '../../lib/drill/verdict-tier';
import { submitOnEnter } from '../../lib/drill/keyboard';

export type PublicVerdict = { correct: boolean } | null;

export interface PublicConjugationItemProps {
  content: ConjugationContent;
  language: 'ES' | 'DE' | 'TR';
  verdict: PublicVerdict;
  onSubmit: (answer: string) => void;
  onNext: () => void;
  isLast: boolean;
  /** 1-based position in the sitting. Rendered with the prompt it belongs to. */
  position?: { index: number; total: number };
}

/**
 * One item of the anonymous conjugation drill.
 *
 * Deliberately independent of the dashboard: `FeedbackShell` and `FluencyItem`
 * live under `app/(dashboard)/`, and a public page that imported them would
 * couple the signed-out surface to the authenticated shell's evolution.
 *
 * The prompt, the answer field and the result are ONE bordered surface rather
 * than a card with a separate input floating beneath it. The task is "produce
 * the form at these coordinates", so the field is the cell being filled — the
 * last row of the table, not a detached control. It also fixes the thing the
 * first screenshot made obvious: as its own full-width box, an empty input was
 * the loudest element on a page whose job is to be read first.
 */
export function PublicConjugationItem({
  content,
  language,
  verdict,
  onSubmit,
  onNext,
  isLast,
  position,
}: PublicConjugationItemProps) {
  const [answer, setAnswer] = React.useState('');
  const inputRef = React.useRef<HTMLInputElement | null>(null);
  const advanceRef = React.useRef<HTMLButtonElement | null>(null);
  const locked = verdict !== null;

  // Clear and refocus for each new item; this component is reused across items.
  React.useEffect(() => {
    setAnswer('');
  }, [content]);

  React.useEffect(() => {
    if (!locked) inputRef.current?.focus();
  }, [content, locked]);

  // Once graded, the input goes `disabled` and drops focus to <body>. Without
  // this, reaching the advance control means tabbing past the page's header,
  // level and language links — for a sitting that is nothing but repeated
  // typing, that's real friction. Focusing the button also gets Enter-to-
  // advance for free, since Enter activates a focused <button>.
  React.useEffect(() => {
    if (locked) advanceRef.current?.focus();
  }, [locked]);

  const submit = React.useCallback(() => {
    if (locked || !answer.trim()) return;
    onSubmit(answer);
  }, [answer, locked, onSubmit]);

  const tier = verdict ? conjugationVerdict(verdict.correct ? 1 : 0) : null;

  // The form the learner typed is still on screen in the cell above, so
  // repeating it as "the answer" when they got it exactly right says nothing.
  // It IS worth showing when they were wrong, and when they were right via an
  // accepted variant — there the canonical form is new information.
  const typed = answer.trim().toLowerCase();
  const showTarget =
    !verdict?.correct || typed !== content.targetForm.trim().toLowerCase();
  const alsoAccepted = (content.acceptableForms ?? []).filter(
    (f) => f.trim().toLowerCase() !== content.targetForm.trim().toLowerCase(),
  );

  return (
    <div className="flex flex-col gap-s-3">
      <div className="overflow-hidden rounded-lg border border-rule bg-card">
        <div className="px-s-4 pt-s-4 pb-s-3">
          <PublicCoordinatePrompt content={content} position={position} />
        </div>

        <div className="flex items-center gap-s-2 border-t border-rule px-s-4 py-s-2">
          <Input
            ref={inputRef}
            aria-label="your answer"
            value={answer}
            onChange={(e) => setAnswer(e.target.value)}
            onKeyDown={submitOnEnter(submit)}
            readOnly={locked}
            disabled={locked}
            placeholder={locked ? undefined : 'type the form'}
            className="font-display !border-0 !bg-transparent !px-0 !shadow-none focus:!shadow-none"
            style={{ fontSize: 22, paddingTop: 10, paddingBottom: 10 }}
          />
          {!locked && (
            <Button variant="primary" onClick={submit} disabled={!answer.trim()}>
              submit
            </Button>
          )}
        </div>

        {verdict && tier && (
          <div
            className="border-t-2 px-s-4 py-s-3"
            style={{
              borderTopColor: verdict.correct ? 'var(--color-ok)' : 'var(--color-accent)',
            }}
          >
            <div className="flex flex-col gap-s-3">
              <div className="flex flex-wrap items-baseline justify-between gap-s-2">
                {showTarget && (
                  <p className="font-display text-[26px] leading-[1.15] font-medium text-ink">
                    {content.targetForm}
                  </p>
                )}
                <p className="text-[13px] text-ink-mute">{tier.label}</p>
              </div>

              {alsoAccepted.length > 0 && (
                <p className="t-small text-ink-mute">
                  also accepted: {alsoAccepted.join(', ')}
                </p>
              )}

              <p className="t-body text-ink-soft">{content.breakdown}</p>

              {content.exampleSentences.length > 0 && (
                <ul className="m-0 flex list-none flex-col gap-[4px] p-0">
                  {content.exampleSentences.map((sentence) => (
                    // Target-language text, so it takes the display serif like
                    // every other target-language string on the page.
                    <li key={sentence} className="font-display text-[16px] leading-[1.45] text-ink-2">
                      {sentence}
                    </li>
                  ))}
                </ul>
              )}

              {/* The breakdown above explains this ONE form mechanically; the
                  rule it comes from is written up in full. Every grammar point
                  the public drill serves has an approved theory page (38 of 38,
                  checked), so this promises something that actually exists —
                  and the copy leads with "Sign up" because that is what the
                  link does. Placed after the teaching, where a learner has just
                  met the form and is most likely to want the rule, and kept a
                  text link so it never competes with `next`. */}
              <Link href="/sign-up" className="link-arrow self-start text-[13px]">
                Sign up to read the rule behind this form
                <span className="lk-arr" aria-hidden="true">
                  →
                </span>
              </Link>
            </div>
          </div>
        )}
      </div>

      {!locked && <AccentPicker language={language} targetRef={inputRef} disabled={locked} />}

      {verdict && (
        <div className="flex justify-end">
          <Button ref={advanceRef} variant="primary" onClick={onNext}>
            {isLast ? 'see results' : 'next'}
          </Button>
        </div>
      )}
    </div>
  );
}
