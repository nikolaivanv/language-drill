// ---------------------------------------------------------------------------
// CalibrationStrip — pure presentational chip + explanation + "adjust"
// ---------------------------------------------------------------------------
// Both strings are pre-computed by `calibrationCopy(level)` (task 20). The
// "adjust" button is a no-op visual element in v1 (Requirement 6.11) — the
// real calibration UI lands in a future phase.
//
// Streaming state (task 37): when `streaming` is set, the strip swaps to a
// mono "annotating · M / N" line with a determinate progress bar instead of
// the eyebrow/explanation/adjust composition. Once annotation completes the
// caller drops `streaming` back to undefined and the eyebrow returns; if
// zero words were flagged, the caller passes `noAboveLevelWords` so the
// explanation slot reads "· no above-level words" (Req §NFR Usability).
// ---------------------------------------------------------------------------

import { Button } from '../../../../components/ui/button';
import { Chip } from '../../../../components/ui/chip';

type Props = {
  eyebrow: string;
  explanation: string;
  /**
   * When set, renders the streaming progress UI (mono text + determinate
   * progress bar) INSTEAD OF the eyebrow/explanation/adjust composition.
   */
  streaming?: { flaggedCount: number; candidateCount: number };
  /**
   * When true AND not streaming, replaces the explanation with
   * "· no above-level words" (Req §NFR Usability — zero-flag completion).
   */
  noAboveLevelWords?: boolean;
};

export function CalibrationStrip({
  eyebrow,
  explanation,
  streaming,
  noAboveLevelWords,
}: Props) {
  if (streaming) {
    const { flaggedCount, candidateCount } = streaming;
    const pct =
      candidateCount > 0 ? (flaggedCount / candidateCount) * 100 : 0;
    return (
      <div className="flex items-center gap-[10px]">
        <span className="t-mono text-ink-soft">
          annotating · {flaggedCount} / {candidateCount}
        </span>
        <div
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={candidateCount}
          aria-valuenow={flaggedCount}
          aria-label="annotation progress"
          className="flex-1 h-[2px] bg-rule rounded-full overflow-hidden"
        >
          <div
            className="h-full bg-accent transition-[width] duration-150"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-[10px]">
      <Chip>{eyebrow}</Chip>
      <span className="t-small text-ink-soft flex-1">
        {noAboveLevelWords ? '· no above-level words' : explanation}
      </span>
      <Button variant="ghost" size="sm">
        adjust
      </Button>
    </div>
  );
}
