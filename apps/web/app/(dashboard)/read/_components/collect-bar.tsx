'use client';

// ---------------------------------------------------------------------------
// CollectBar — flagged/saved counts + save-to-library / add-to-vocabulary CTA
// ---------------------------------------------------------------------------
// Props: flaggedCount, savedCount, onSaveToLibrary, onAddToVocabulary, saving
//
// When savedCount === 0: single primary "save to library" button.
// When savedCount > 0: ghost "save to library" + primary "add N to vocabulary →".
// ---------------------------------------------------------------------------

import { Button } from '../../../../components/ui/button';

type Props = {
  flaggedCount: number;
  savedCount: number;
  onSaveToLibrary: () => void;
  onAddToVocabulary: () => void;
  saving?: boolean;
};

export function CollectBar({
  flaggedCount,
  savedCount,
  onSaveToLibrary,
  onAddToVocabulary,
  saving = false,
}: Props) {
  return (
    <div className="bg-paper-2 rounded-r-md p-s-4 flex items-center justify-between gap-[12px]">
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
              disabled={saving}
              onClick={onSaveToLibrary}
            >
              save to library
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
            disabled={saving}
            onClick={onSaveToLibrary}
          >
            save to library
          </Button>
        )}
      </div>
    </div>
  );
}
