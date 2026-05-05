// ---------------------------------------------------------------------------
// CalibrationStrip — pure presentational chip + explanation + "adjust"
// ---------------------------------------------------------------------------
// Both strings are pre-computed by `calibrationCopy(level)` (task 20). The
// "adjust" button is a no-op visual element in v1 (Requirement 6.11) — the
// real calibration UI lands in a future phase.
// ---------------------------------------------------------------------------

import { Button } from '../../../../components/ui/button';
import { Chip } from '../../../../components/ui/chip';

type Props = {
  eyebrow: string;
  explanation: string;
};

export function CalibrationStrip({ eyebrow, explanation }: Props) {
  return (
    <div className="flex items-center gap-[10px]">
      <Chip>{eyebrow}</Chip>
      <span className="t-small text-ink-soft flex-1">{explanation}</span>
      <Button variant="ghost" size="sm">
        adjust
      </Button>
    </div>
  );
}
