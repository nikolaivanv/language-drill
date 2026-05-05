'use client';

// ---------------------------------------------------------------------------
// WordPopover — click-anchored word card (Requirement 7)
// ---------------------------------------------------------------------------
// 320px wide card that opens at the click coordinates of a flagged word.
// `left` is clamped to keep the card visible inside `containerWidth`; the
// pointer triangle re-anchors over the original click center so the
// connection between word and card stays visually obvious even when the
// card itself was pushed sideways by the clamp.
//
// `onClick={(e) => e.stopPropagation()}` keeps the parent's outside-click
// dismissal from firing on clicks inside the card. `Escape` calls
// `onClose` so a keyboard user can dismiss without hunting for the skip
// button. The skip button is auto-focused when `autoFocus` is set — used
// when the popover was opened via keyboard (`Enter` / `Space` on the word).
// ---------------------------------------------------------------------------

import * as React from 'react';
import type { WordFlag } from '@language-drill/shared';
import { Button } from '../../../../components/ui/button';

const POPOVER_WIDTH = 320;

type Props = {
  entry: WordFlag;
  word: string;
  x: number;
  y: number;
  containerWidth: number;
  inBank: boolean;
  onSave: () => void;
  onSkip: () => void;
  onClose: () => void;
  /** When true, focus moves to the skip button on mount — used for keyboard openings. */
  autoFocus?: boolean;
};

function clampLeft(x: number, containerWidth: number): number {
  return Math.max(
    8,
    Math.min(x - POPOVER_WIDTH / 2, containerWidth - POPOVER_WIDTH),
  );
}

export function WordPopover({
  entry,
  word,
  x,
  y,
  containerWidth,
  inBank,
  onSave,
  onSkip,
  onClose,
  autoFocus,
}: Props) {
  const skipRef = React.useRef<HTMLButtonElement>(null);

  React.useEffect(() => {
    if (autoFocus) {
      skipRef.current?.focus();
    }
  }, [autoFocus]);

  const adjustedX = clampLeft(x, containerWidth);
  const pointerLeft = x - adjustedX - 6;

  return (
    <div
      role="dialog"
      aria-label={`word card for ${word}`}
      data-testid="word-popover"
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
      style={{
        position: 'absolute',
        left: adjustedX,
        top: y,
        width: POPOVER_WIDTH,
        zIndex: 30,
        background: 'var(--color-card)',
        border: '1px solid var(--color-ink)',
        borderRadius: 'var(--r-md, 6px)',
        boxShadow: 'var(--shadow-3)',
        animation: 'fade .18s ease both',
      }}
    >
      {/* Pointer triangle, re-anchored over the click center */}
      <div
        aria-hidden
        style={{
          position: 'absolute',
          top: -7,
          left: pointerLeft,
          width: 12,
          height: 12,
          background: 'var(--color-card)',
          borderTop: '1px solid var(--color-ink)',
          borderLeft: '1px solid var(--color-ink)',
          transform: 'rotate(45deg)',
        }}
      />

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
          skip
        </Button>
        <Button
          variant={inBank ? 'accent' : 'primary'}
          size="sm"
          onClick={onSave}
        >
          {inBank ? '✓ saved · undo' : '+ save to bank'}
        </Button>
      </div>
    </div>
  );
}
