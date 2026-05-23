'use client';

// ---------------------------------------------------------------------------
// WordBankSheet — word bank as a bottom sheet (mobile, Requirement 8.1 / 8.3)
// ---------------------------------------------------------------------------
// At phone width the sticky right-rail word bank is replaced by a toolbar chip
// that opens this sheet. It reuses `WordBankRail` for the bank rows and hosts
// the highlight-intensity toggle in the sheet header (Req 8.3). `BottomSheet`
// supplies the scrim, slide-up, focus trap, scroll lock, and dismissal.
// ---------------------------------------------------------------------------

import type { FlaggedMap } from '@language-drill/shared';
import { BottomSheet } from '../../../../components/ui/bottom-sheet';
import { IntensityToggle } from './intensity-toggle';
import { WordBankRail } from './word-bank-rail';
import type { Intensity } from '../_state/read-page-reducer';

type Props = {
  open: boolean;
  onClose: () => void;
  bank: string[];
  flaggedMap: FlaggedMap;
  intensity: Intensity;
  onIntensityChange: (intensity: Intensity) => void;
  onRemove: (word: string) => void;
};

export function WordBankSheet({
  open,
  onClose,
  bank,
  flaggedMap,
  intensity,
  onIntensityChange,
  onRemove,
}: Props) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      ariaLabel="word bank"
      title={
        <div className="flex items-center gap-[8px]">
          <span className="t-micro text-ink-mute">highlight</span>
          <IntensityToggle value={intensity} onChange={onIntensityChange} />
        </div>
      }
    >
      <WordBankRail bank={bank} flaggedMap={flaggedMap} onRemove={onRemove} />
    </BottomSheet>
  );
}
