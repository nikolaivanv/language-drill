'use client';

// ---------------------------------------------------------------------------
// WordSheet — word card as a draggable bottom sheet (mobile, Req 8.2 / 8.7)
// ---------------------------------------------------------------------------
// At phone width a flagged-word tap opens this sheet instead of the click-
// anchored `WordPopover`. It wraps the shared `WordCardBody` / deep-card body
// in a `vaul` drawer with two snap points: a half-height *peek* and a
// near-full *expanded* state. Drag the handle up to expand, down to collapse;
// dragging below the peek (or scrim / × / Escape) dismisses it (Req 8.7).
//
// Content scroll is gated on the expanded snap so the drag gesture resizes the
// sheet at peek and only scrolls once fully open — the standard vaul pattern
// that keeps the drag-to-expand and scroll-content gestures from fighting.
//
// Only the word card uses this draggable variant; the language switcher,
// theory, and word-bank sheets keep the fixed-height `BottomSheet`.
// ---------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import { Drawer } from 'vaul';
import type { WordFlag } from '@language-drill/shared';
import { WordCardBody, DeepCardContent } from './word-card-body';
import type { DeepCardSlice } from '../_state/read-page-reducer';

type Props = {
  open: boolean;
  /** The flagged entry for the active word; `null` when none is selected. */
  entry: WordFlag | null;
  word: string;
  inBank: boolean;
  onSave: () => void;
  onSkip: () => void;
  onClose: () => void;
  /**
   * The deep-card lifecycle. When present and not `idle` the sheet renders the
   * skeleton / inline error / loaded deep card by status (Req 9.3, 9.4),
   * taking precedence over the skim `entry`.
   */
  deepCard?: DeepCardSlice;
  /** Re-run the deep annotation from the inline error state (Req 9.4). */
  onRetry?: () => void;
  /** Resolve a sentence-card grammar note to a Theory route (Req 5.3). */
  resolveTheoryHref?: (note: string) => string | null;
};

// Peek (half the viewport) → expanded (near-full). Snap points are fractions
// of the viewport height, not CSS lengths: vaul treats any *string* snap point
// as raw pixels (`parseInt`), so `'50vh'` would collapse to 50px — `0.5` is the
// correct way to say "half height". `1` is full (capped at 97% by the panel
// `max-h`). Dragging below the peek dismisses.
const SNAP_POINTS: (number | string)[] = [0.5, 1];
const PEEK = SNAP_POINTS[0];
const EXPANDED = SNAP_POINTS[SNAP_POINTS.length - 1];

// `t-micro` eyebrow for the sheet header — reflects what the body is showing.
function sheetTitle(deepCard: DeepCardSlice | undefined): string {
  if (!deepCard || deepCard.status === 'idle') return 'word';
  if (deepCard.status === 'loaded') return deepCard.card.type;
  if (deepCard.status === 'error') return 'error';
  return 'looking up';
}

export function WordSheet({
  open,
  entry,
  word,
  inBank,
  onSave,
  onSkip,
  onClose,
  deepCard,
  onRetry,
  resolveTheoryHref,
}: Props) {
  const deepActive = deepCard != null && deepCard.status !== 'idle';
  const isOpen = open && (deepActive || entry !== null);

  const [snap, setSnap] = useState<number | string | null>(PEEK);

  // Always (re)open at the peek detent; a fresh tap shouldn't inherit the
  // previous card's expanded state.
  useEffect(() => {
    if (isOpen) setSnap(PEEK);
  }, [isOpen]);

  const expanded = snap === EXPANDED;

  return (
    <Drawer.Root
      open={isOpen}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      snapPoints={SNAP_POINTS}
      activeSnapPoint={snap}
      setActiveSnapPoint={setSnap}
      // Keep the scrim at full strength across both detents (default fades it
      // in only as you approach the last snap point).
      fadeFromIndex={0}
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-[90] bg-[rgba(26,22,18,0.42)]" />
        <Drawer.Content
          aria-label={`word card for ${word}`}
          // No separate description region — silence the radix dialog warning.
          aria-describedby={undefined}
          className="fixed inset-x-0 bottom-0 z-[90] mx-auto flex h-full max-h-[97%] w-full flex-col rounded-t-[24px] bg-paper shadow-3 outline-none"
        >
          {/* Drag handle — now a real grabber: drag up to expand, down to
           *  collapse/dismiss. */}
          <Drawer.Handle className="!mx-auto !my-[10px] !h-[4px] !w-[36px] shrink-0 !rounded-r-pill !bg-rule-strong" />

          <header className="flex flex-none items-start justify-between gap-s-3 px-[18px] pb-s-3">
            <Drawer.Title className="t-micro min-w-0">{sheetTitle(deepCard)}</Drawer.Title>
            <button
              type="button"
              className="-mr-[6px] -mt-[2px] flex h-[44px] w-[44px] flex-none items-center justify-center text-[22px] leading-none text-ink-soft transition-colors hover:text-ink"
              onClick={onClose}
              aria-label="close"
            >
              ×
            </button>
          </header>

          <div
            className={`min-h-0 flex-1 px-[18px] pb-[18px] ${expanded ? 'overflow-y-auto' : 'overflow-hidden'}`}
          >
            {deepCard?.status === 'loading' && entry ? (
              // Skim preview while the deep card resolves (Req 3.1); the inline
              // footer indicator + the "looking up" eyebrow signal the fetch.
              <WordCardBody
                entry={entry}
                inBank={inBank}
                onSave={onSave}
                onSkip={onSkip}
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
              />
            ) : entry ? (
              <WordCardBody
                entry={entry}
                inBank={inBank}
                onSave={onSave}
                onSkip={onSkip}
              />
            ) : null}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
