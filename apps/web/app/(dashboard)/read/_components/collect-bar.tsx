'use client';

// ---------------------------------------------------------------------------
// CollectBar — flagged/saved counts + a single "save text" CTA
// ---------------------------------------------------------------------------
// The "save text" button keeps the *passage* in your reading library. Words are
// NOT collected here: each looked-up word auto-saves to your vocabulary the
// moment its card resolves (that's what `savedCount` tallies), so there's no
// batch "add N to vocabulary" step — the words are already in.
//
// "save text" is only actionable for an unsaved passage; once the text is in
// the library (or auto-persisted by the first word save) it disables and reads
// "text saved" so it isn't a confusing no-op (`canSaveToLibrary === false`).
// ---------------------------------------------------------------------------

import { Button } from '../../../../components/ui/button';

type Props = {
  flaggedCount: number;
  savedCount: number;
  onSaveToLibrary: () => void;
  /** False once the passage is already in the library (nothing left to save). */
  canSaveToLibrary?: boolean;
  saving?: boolean;
};

export function CollectBar({
  flaggedCount,
  savedCount,
  onSaveToLibrary,
  canSaveToLibrary = true,
  saving = false,
}: Props) {
  const saveTextLabel = canSaveToLibrary ? 'save text' : 'text saved';
  return (
    <div className="bg-paper-2 rounded-md p-s-4 flex items-center justify-between gap-[12px]">
      {/* Left: counts */}
      <span className="t-small text-ink-soft shrink-0">
        {flaggedCount} flagged · {savedCount} saved
      </span>

      {/* Right: save the passage to the library (words save themselves). */}
      <Button
        variant="primary"
        size="sm"
        disabled={saving || !canSaveToLibrary}
        onClick={onSaveToLibrary}
      >
        {saveTextLabel}
      </Button>
    </div>
  );
}
