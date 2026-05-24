// ---------------------------------------------------------------------------
// AnnotatedFooter — footer summary row beneath the reader
// ---------------------------------------------------------------------------
// One row, paper-2 fill: mono "N flagged · N saved · M skipped" tally
// (M = flagged − saved) on the left, ghost "clear bank" + primary
// "save N to bank →" on the right. Empty-bank state disables both
// action buttons; in-flight save disables the save button (Requirement
// 8.1, 8.7).
//
// `ZeroFlaggedStrip` is the alternate footer for passages that came back
// with zero flagged words (Requirement 6.9). Sage strip + ghost CTA
// pointing at the pasting view.
// ---------------------------------------------------------------------------

import { Button } from '../../../../components/ui/button';

type FooterProps = {
  flaggedCount: number;
  savedCount: number;
  onClearBank: () => void;
  onSave: () => void;
  isSaving: boolean;
};

export function AnnotatedFooter({
  flaggedCount,
  savedCount,
  onClearBank,
  onSave,
  isSaving,
}: FooterProps) {
  const skippedCount = Math.max(0, flaggedCount - savedCount);
  const noBank = savedCount === 0;
  return (
    <div className="mt-[28px] flex flex-wrap items-center gap-[14px] rounded-r-md bg-paper-2 px-[18px] py-[14px]">
      <span className="t-mono text-[11px] text-ink-mute">
        {flaggedCount} flagged · {savedCount} saved · {skippedCount} skipped
      </span>
      {/* ml-auto right-aligns the action group on desktop and lets it wrap to
          its own line on mobile; shrink-0 keeps the buttons at full label
          width so "save N to bank →" isn't clipped. */}
      <div className="ml-auto flex shrink-0 items-center gap-[14px]">
        <Button
          variant="ghost"
          size="sm"
          onClick={onClearBank}
          disabled={noBank}
        >
          clear bank
        </Button>
        <Button
          variant="primary"
          onClick={onSave}
          disabled={noBank || isSaving}
        >
          {isSaving ? 'saving…' : `save ${savedCount} to bank →`}
        </Button>
      </div>
    </div>
  );
}

type ZeroFlaggedStripProps = {
  onPasteNew: () => void;
};

export function ZeroFlaggedStrip({ onPasteNew }: ZeroFlaggedStripProps) {
  return (
    <div
      role="status"
      className="mt-[28px] flex items-center gap-[14px] rounded-r-md px-[18px] py-[14px]"
      style={{ background: 'var(--color-ok-soft)' }}
    >
      <span className="t-small text-ink-2 flex-1">
        this passage is well within your level — nice.
      </span>
      <Button variant="ghost" size="sm" onClick={onPasteNew}>
        paste something harder?
      </Button>
    </div>
  );
}
