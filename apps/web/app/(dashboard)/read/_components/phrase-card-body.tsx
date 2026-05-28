'use client';

// ---------------------------------------------------------------------------
// PhraseCardBody — the rich on-demand phrase card (Req 4.2)
// ---------------------------------------------------------------------------
// Renders a resolved `DeepPhraseCard` (an idiom or fixed expression explained
// as a unit). Shows the citation/surface form as the headword, the idiomatic
// meaning ("what it means"), the literal word-by-word rendering, the register,
// an example, and (when present) synonymous expressions. A phrase is savable to
// vocabulary, so it shares the chrome contract of `WordCardBody` (footer
// save/skip + `skipRef`) and drops into the same `WordPopover` / `WordSheet`
// wrappers. Absent optional fields (citation, example, synonyms) render nothing
// — no empty blocks, mirroring the word card's discipline.
// ---------------------------------------------------------------------------

import * as React from 'react';
import type { DeepPhraseCard } from '@language-drill/shared';
import { Button } from '../../../../components/ui/button';

export function PhraseCardBody({
  card,
  inBank,
  onSave,
  onSkip,
  skipRef,
}: {
  card: DeepPhraseCard;
  inBank: boolean;
  onSave: () => void;
  onSkip: () => void;
  /** Forwarded onto the skip/close button — used by the popover's autoFocus. */
  skipRef?: React.Ref<HTMLButtonElement>;
}) {
  return (
    <>
      {/* Header — citation/surface form is the headword (Req 4.2) */}
      <div className="border-b border-rule px-[16px] pt-[14px] pb-[10px]">
        <div className="flex items-baseline gap-[8px]">
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 20,
              fontWeight: 500,
              letterSpacing: '-0.2px',
            }}
          >
            {card.citation ?? card.surface}
          </span>
          <span className="ml-auto t-mono rounded-[4px] border border-rule bg-paper-2 px-[6px] py-[2px] text-[9px] uppercase tracking-wide text-ink-mute">
            phrase
          </span>
        </div>
        <div className="t-small mt-[4px] italic text-ink-mute">
          idiom · {card.register}
        </div>
      </div>

      {/* Body */}
      <div className="px-[16px] py-[12px]">
        {/* Idiomatic meaning — "what it means" (Req 4.2) */}
        <div>
          <span className="t-micro">means</span>
          <p className="t-body text-ink-2 mt-[2px]">“{card.idiomaticMeaning}”</p>
        </div>

        {/* Literal word-by-word rendering (Req 4.2) */}
        <div className="mt-[12px]">
          <div className="t-micro">literal</div>
          <p
            className="mt-[2px] italic"
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 15,
              lineHeight: 1.5,
            }}
          >
            {card.literal}
          </p>
        </div>

        {/* Example (Req 4.2) — omitted cleanly when absent */}
        {card.example && (
          <div className="mt-[12px]">
            <div className="t-micro mb-[2px]">example</div>
            <p
              style={{
                fontFamily: 'var(--font-display)',
                fontSize: 15,
                lineHeight: 1.5,
              }}
            >
              {card.example.tl}
            </p>
            <p className="t-small mt-[2px] text-ink-mute">{card.example.en}</p>
          </div>
        )}

        {/* Synonymous expressions (Req 4.2) — omitted cleanly when absent */}
        {card.synonyms && card.synonyms.length > 0 && (
          <div className="mt-[14px]">
            <div className="t-micro mb-[6px]">synonymous expressions</div>
            <ul className="space-y-[4px]">
              {card.synonyms.map((s, i) => (
                <li key={i} className="t-small">
                  <span className="font-medium">{s.phrase}</span>
                  <span className="text-ink-mute"> — {s.note}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Footer — save posts the resolved card to vocabulary (task 29) */}
      <div className="flex items-center gap-[6px] border-t border-rule bg-paper-2 px-[12px] py-[10px]">
        <span className="flex-1" />
        <Button ref={skipRef} variant="ghost" size="sm" onClick={onSkip}>
          {inBank ? 'close' : 'skip'}
        </Button>
        <Button variant={inBank ? 'accent' : 'primary'} size="sm" onClick={onSave}>
          {inBank ? '✓ saved · undo' : '+ save phrase'}
        </Button>
      </div>
    </>
  );
}
