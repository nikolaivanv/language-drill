'use client';

// ---------------------------------------------------------------------------
// CollectBar — flagged/saved counts + save-text / add-to-vocabulary CTA
// ---------------------------------------------------------------------------
// Props: flaggedCount, savedCount, onSaveToLibrary, canSaveToLibrary,
//        onAddToVocabulary, saving
//
// The "save text" button keeps the *passage* in your reading library — it does
// NOT save the collected words (those are saved per-word from the cards). It's
// only actionable for an unsaved passage; once the text is in the library it's
// disabled so it isn't a confusing no-op (`canSaveToLibrary === false`).
//
// When savedCount === 0: single "save text" button.
// When savedCount > 0: ghost "save text" + primary "add N to vocabulary →".
// ---------------------------------------------------------------------------

import { Button } from '../../../../components/ui/button';

type Props = {
  flaggedCount: number;
  savedCount: number;
  onSaveToLibrary: () => void;
  /** False once the passage is already in the library (nothing left to save). */
  canSaveToLibrary?: boolean;
  onAddToVocabulary: () => void;
  saving?: boolean;
};

export function CollectBar({
  flaggedCount,
  savedCount,
  onSaveToLibrary,
  canSaveToLibrary = true,
  onAddToVocabulary,
  saving = false,
}: Props) {
  const saveTextLabel = canSaveToLibrary ? 'save text' : 'text saved';
  return (
    <div className="bg-paper-2 rounded-md p-s-4 flex items-center justify-between gap-[12px]">
      {/* Left: counts */}
      <span className="t-small text-ink-soft shrink-0">
        {flaggedCount} flagged · {savedCount} saved
      </span>

      {/* Right: actions */}
      <div className="flex items-center gap-[8px]">
        {savedCount > 0 ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              disabled={saving || !canSaveToLibrary}
              onClick={onSaveToLibrary}
            >
              {saveTextLabel}
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={saving}
              onClick={onAddToVocabulary}
            >
              add {savedCount} to vocabulary →
            </Button>
          </>
        ) : (
          <Button
            variant="primary"
            size="sm"
            disabled={saving || !canSaveToLibrary}
            onClick={onSaveToLibrary}
          >
            {saveTextLabel}
          </Button>
        )}
      </div>
    </div>
  );
}
