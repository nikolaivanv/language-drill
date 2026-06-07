'use client';

// ---------------------------------------------------------------------------
// AdjustBar — make easier / harder / longer / rewrite controls
// ---------------------------------------------------------------------------
// Props: cefr, length, onAdjust, busy
// Renders an ADJUST label + 4 ghost-sm buttons. Edge states: A1 disables
// "easier", C2 disables "harder", LONG disables "longer". All disabled when busy.
// ---------------------------------------------------------------------------

import { CefrLevel, ReadingTextLength } from '@language-drill/shared';
import { Button } from '../../../../components/ui/button';

type AdjustKind = 'easier' | 'harder' | 'longer' | 'rewrite';

type Props = {
  cefr: CefrLevel;
  length: ReadingTextLength;
  onAdjust: (kind: AdjustKind) => void;
  busy?: boolean;
};

const CEFR_VALUES = Object.values(CefrLevel);
const LENGTH_VALUES = Object.values(ReadingTextLength);

export function AdjustBar({ cefr, length, onAdjust, busy = false }: Props) {
  const isAtLowestCefr = CEFR_VALUES[0] === cefr;
  const isAtHighestCefr = CEFR_VALUES[CEFR_VALUES.length - 1] === cefr;
  const isAtLongest = LENGTH_VALUES[LENGTH_VALUES.length - 1] === length;

  return (
    <div className="flex items-center gap-[8px] flex-wrap">
      <span className="t-micro text-ink-mute shrink-0">ADJUST</span>

      <Button
        variant="ghost"
        size="sm"
        disabled={busy || isAtLowestCefr}
        onClick={() => onAdjust('easier')}
        aria-label="make easier"
      >
        − make easier
      </Button>

      <Button
        variant="ghost"
        size="sm"
        disabled={busy || isAtHighestCefr}
        onClick={() => onAdjust('harder')}
        aria-label="make harder"
      >
        + make harder
      </Button>

      <Button
        variant="ghost"
        size="sm"
        disabled={busy || isAtLongest}
        onClick={() => onAdjust('longer')}
        aria-label="longer"
      >
        ↔ longer
      </Button>

      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => onAdjust('rewrite')}
        aria-label="rewrite"
      >
        ↻ rewrite
      </Button>
    </div>
  );
}
