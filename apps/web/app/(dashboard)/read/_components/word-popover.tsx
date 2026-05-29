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
import { WordCardBody, DeepCardContent } from './word-card-body';
import type { DeepCardSlice } from '../_state/read-page-reducer';

const POPOVER_WIDTH = 320;

type Props = {
  /** The skim entry shown for a flagged word; omitted for a cold deep tap. */
  entry?: WordFlag | null;
  word: string;
  x: number;
  y: number;
  containerWidth: number;
  inBank: boolean;
  onSave: () => void;
  onSkip: () => void;
  onClose: () => void;
  /**
   * The deep-card lifecycle. When present and not `idle` it takes precedence
   * over `entry` and the chrome renders the skeleton / inline error / loaded
   * deep card by status (Req 9.3, 9.4). The chrome stays mounted across the
   * loading→loaded transition so it never tears down (Req 3.3).
   */
  deepCard?: DeepCardSlice;
  /** Re-run the deep annotation from the inline error state (Req 9.4). */
  onRetry?: () => void;
  /** Resolve a sentence-card grammar note to a Theory route (Req 5.3). */
  resolveTheoryHref?: (note: string) => string | null;
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
  deepCard,
  onRetry,
  resolveTheoryHref,
  autoFocus,
}: Props) {
  const skipRef = React.useRef<HTMLButtonElement>(null);
  const popoverRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (autoFocus) {
      skipRef.current?.focus();
    }
  }, [autoFocus]);

  React.useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (popoverRef.current?.contains(target)) return;
      if (target.closest('[data-word]')) return;
      onClose();
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const adjustedX = clampLeft(x, containerWidth);
  const pointerLeft = x - adjustedX - 6;

  return (
    <div
      ref={popoverRef}
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

      {deepCard?.status === 'loading' && entry ? (
        // Skim preview while the deep card resolves (Req 3.1) — same skim
        // body, with a footer indicator so the user knows a richer card is
        // incoming and the chrome isn't stuck.
        <WordCardBody
          entry={entry}
          inBank={inBank}
          onSave={onSave}
          onSkip={onSkip}
          skipRef={skipRef}
          loadingDeep
        />
      ) : deepCard && deepCard.status !== 'idle' ? (
        <DeepCardContent
          slice={deepCard}
          inBank={inBank}
          onSave={onSave}
          onSkip={onSkip}
          onClose={onClose}
          onRetry={onRetry ?? onClose}
          resolveTheoryHref={resolveTheoryHref}
          skipRef={skipRef}
        />
      ) : entry ? (
        <WordCardBody
          entry={entry}
          inBank={inBank}
          onSave={onSave}
          onSkip={onSkip}
          skipRef={skipRef}
        />
      ) : null}
    </div>
  );
}
