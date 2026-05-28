'use client';

// ---------------------------------------------------------------------------
// SentenceCardBody — the on-demand sentence card (Req 5.2, 5.3, 5.4)
// ---------------------------------------------------------------------------
// Renders a resolved `DeepSentenceCard`: the sentence, its translation, a
// chunked breakdown (each chunk with a grammatical role tag and a one-line
// note), and the grammar topics it exemplifies as chips.
//
// Grammar chips (Req 5.3): a topic MAY deep-link into the Theory section, but
// `grammarNotes` are free-text strings, not `grammar_point_key`s, so there is
// usually no resolvable target. The optional `resolveTheoryHref` is the seam
// for a caller that *can* resolve a note to a Theory route; when it returns a
// non-null href the chip renders as a link, otherwise it stays non-interactive
// text — never a broken link.
//
// A sentence card has NO save-to-vocabulary action (Req 5.4). The "add to
// translation drills" action is out of scope for Part 1, so it is rendered as a
// disabled affordance pending a separate decision. Unlike the word/phrase
// bodies there is no `onSave`; `skipRef` forwards onto the close button so the
// popover can keep auto-focusing it.
// ---------------------------------------------------------------------------

import * as React from 'react';
import Link from 'next/link';
import type { DeepSentenceCard } from '@language-drill/shared';
import { Button } from '../../../../components/ui/button';

export function SentenceCardBody({
  card,
  onClose,
  skipRef,
  resolveTheoryHref,
}: {
  card: DeepSentenceCard;
  onClose: () => void;
  /** Forwarded onto the close button — used by the popover's autoFocus. */
  skipRef?: React.Ref<HTMLButtonElement>;
  /** Resolve a grammar note to a Theory route; null ⇒ render as plain text. */
  resolveTheoryHref?: (note: string) => string | null;
}) {
  return (
    <>
      {/* Header */}
      <div className="border-b border-rule px-[16px] pt-[14px] pb-[10px]">
        <span className="t-mono rounded-[4px] border border-rule bg-paper-2 px-[6px] py-[2px] text-[9px] uppercase tracking-wide text-ink-mute">
          sentence
        </span>
      </div>

      {/* Body */}
      <div className="px-[16px] py-[12px]">
        {/* Sentence + translation (Req 5.2) */}
        <p
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 16,
            lineHeight: 1.5,
          }}
        >
          “{card.surface}”
        </p>
        <p className="t-body text-ink-2 mt-[6px]">{card.translation}</p>

        {/* Chunked breakdown — role tag + one-line note per chunk (Req 5.2) */}
        <div className="mt-[14px]">
          <div className="t-micro mb-[6px]">breakdown</div>
          <div className="space-y-[8px]">
            {card.breakdown.map((c, i) => (
              <div key={i} className="border-l-2 border-rule pl-[8px]">
                <div className="flex items-baseline gap-[8px]">
                  <span className="t-small font-medium">{c.chunk}</span>
                  <span className="t-mono text-[9px] uppercase tracking-wide text-accent">
                    {c.role}
                  </span>
                </div>
                <p className="t-small text-ink-mute">{c.note}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Grammar topics — deep-link when resolvable, else plain text (Req 5.3) */}
        {card.grammarNotes.length > 0 && (
          <div className="mt-[14px]">
            <div className="t-micro mb-[6px]">grammar covered</div>
            <div className="flex flex-wrap gap-[4px]">
              {card.grammarNotes.map((g, i) => {
                const href = resolveTheoryHref?.(g) ?? null;
                const chipClass =
                  'rounded-[4px] border border-rule bg-paper-2 px-[8px] py-[3px] t-small';
                return href ? (
                  <Link
                    key={i}
                    href={href}
                    className={`${chipClass} text-accent transition-colors hover:text-ink`}
                  >
                    {g}
                  </Link>
                ) : (
                  <span key={i} className={`${chipClass} text-ink-2`}>
                    {g}
                  </span>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Footer — no save (Req 5.4); translation-drills action is out of scope */}
      <div className="flex items-center gap-[6px] border-t border-rule bg-paper-2 px-[12px] py-[10px]">
        <span className="flex-1" />
        <Button ref={skipRef} variant="ghost" size="sm" onClick={onClose}>
          close
        </Button>
        <Button variant="primary" size="sm" disabled title="coming soon">
          + add to translation drills
        </Button>
      </div>
    </>
  );
}
