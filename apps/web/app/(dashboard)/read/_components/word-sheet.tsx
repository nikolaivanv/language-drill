'use client';

// ---------------------------------------------------------------------------
// WordSheet — word card as a bottom sheet (mobile, Requirement 8.2 / 8.7)
// ---------------------------------------------------------------------------
// At phone width a flagged-word tap opens this sheet instead of the click-
// anchored `WordPopover`. It wraps the shared `WordCardBody` (same lemma/POS/
// CEFR/gloss/example/freq + save/skip) in the reusable `BottomSheet`, which
// supplies the scrim, slide-up, focus trap, background-scroll lock, and the
// scrim/close-button/Escape dismissal (Req 8.7).
// ---------------------------------------------------------------------------

import type { WordFlag } from '@language-drill/shared';
import { BottomSheet } from '../../../../components/ui/bottom-sheet';
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
  return (
    <BottomSheet
      open={open && (deepActive || entry !== null)}
      onClose={onClose}
      ariaLabel={`word card for ${word}`}
      maxHeight="50vh"
      title={<span className="t-micro">{sheetTitle(deepCard)}</span>}
    >
      {deepCard?.status === 'loading' && entry ? (
        // Skim preview while the deep card resolves (Req 3.1); the inline
        // footer indicator + the sheet's "looking up" eyebrow together signal
        // the background fetch.
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
    </BottomSheet>
  );
}
