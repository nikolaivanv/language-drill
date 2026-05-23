'use client';

// ---------------------------------------------------------------------------
// WordCardBody — shared word-card content (header / body / footer)
// ---------------------------------------------------------------------------
// Lifted out of `WordPopover` so the same lemma/POS/CEFR/gloss/example/freq +
// save/skip markup renders identically inside the desktop click-anchored
// popover and the mobile `WordSheet` (Requirement 8.2). The wrapping component
// owns positioning, the dialog role/aria-label, and dismissal — this piece is
// pure presentation + the two action callbacks.
//
// `skipRef` is forwarded onto the skip/close button so the popover can keep
// auto-focusing it for keyboard openings; the sheet omits it (BottomSheet's
// focus trap handles focus).
// ---------------------------------------------------------------------------

import * as React from 'react';
import type { WordFlag } from '@language-drill/shared';
import { Button } from '../../../../components/ui/button';

type Props = {
  entry: WordFlag;
  inBank: boolean;
  onSave: () => void;
  onSkip: () => void;
  /** Forwarded onto the skip/close button — used by the popover's autoFocus. */
  skipRef?: React.Ref<HTMLButtonElement>;
};

export function WordCardBody({ entry, inBank, onSave, onSkip, skipRef }: Props) {
  return (
    <>
      {/* Header */}
      <div className="border-b border-rule px-[16px] pt-[14px] pb-[10px]">
        <div className="flex items-baseline gap-[8px]">
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontSize: 22,
              fontWeight: 500,
              letterSpacing: '-0.2px',
            }}
          >
            {entry.lemma}
          </span>
          <span className="t-small italic">{entry.pos}</span>
          <span className="ml-auto" />
          <span className="t-mono text-[11px] text-accent">{entry.cefr}</span>
        </div>
        <p className="t-body text-ink-2 mt-[4px]">{entry.gloss}</p>
      </div>

      {/* Body */}
      <div className="px-[16px] py-[12px]">
        <div className="t-micro mb-[6px]">example</div>
        <p
          style={{
            fontFamily: 'var(--font-display)',
            fontSize: 15,
            lineHeight: 1.5,
          }}
        >
          {entry.example}
        </p>
      </div>

      {/* Footer */}
      <div className="flex items-center gap-[6px] border-t border-rule bg-paper-2 px-[12px] py-[10px]">
        <span className="t-mono flex-1 text-[10px] text-ink-mute">
          freq #{entry.freq.toLocaleString('en-US')}
        </span>
        <Button ref={skipRef} variant="ghost" size="sm" onClick={onSkip}>
          {inBank ? 'close' : 'skip'}
        </Button>
        <Button
          variant={inBank ? 'accent' : 'primary'}
          size="sm"
          onClick={onSave}
        >
          {inBank ? '✓ saved · undo' : '+ save to bank'}
        </Button>
      </div>
    </>
  );
}
