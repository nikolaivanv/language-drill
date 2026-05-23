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
import { WordCardBody } from './word-card-body';

type Props = {
  open: boolean;
  /** The flagged entry for the active word; `null` when none is selected. */
  entry: WordFlag | null;
  word: string;
  inBank: boolean;
  onSave: () => void;
  onSkip: () => void;
  onClose: () => void;
};

export function WordSheet({
  open,
  entry,
  word,
  inBank,
  onSave,
  onSkip,
  onClose,
}: Props) {
  return (
    <BottomSheet
      open={open && entry !== null}
      onClose={onClose}
      ariaLabel={`word card for ${word}`}
      maxHeight="50vh"
      title={<span className="t-micro">word</span>}
    >
      {entry && (
        <WordCardBody
          entry={entry}
          inBank={inBank}
          onSave={onSave}
          onSkip={onSkip}
        />
      )}
    </BottomSheet>
  );
}
