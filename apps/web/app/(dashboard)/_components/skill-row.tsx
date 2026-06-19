// ---------------------------------------------------------------------------
// SkillRow — one row of the dashboard's skill snapshot grid
// ---------------------------------------------------------------------------
// Lowercased label, mono percentage (accent when below 50%), `<Bar>`, and the
// signed delta column. The delta uses a true minus character (U+2212) so the
// minus visually matches the plus.
//
// Mirrors the prototype layout in dashboard.jsx lines 94–103.
// ---------------------------------------------------------------------------

import type { RadarAxis } from '@language-drill/api-client';
import { Bar } from '../../../components/ui';
import { cn } from '../../../lib/cn';

const MINUS = '−'; // U+2212 MINUS SIGN — wider than ASCII '-'
const EM_DASH = '—'; // U+2014 — used when delta rounds to zero
const THIN_EVIDENCE_THRESHOLD = 5;

type Props = {
  axis: RadarAxis;
};

export function SkillRow({ axis }: Props) {
  const isWeak = axis.currentMastery < 0.5;
  const pct = Math.round(axis.currentMastery * 100);
  const deltaInt = Math.round((axis.currentMastery - axis.previousMastery) * 100);
  const { text: deltaText, colorClass: deltaColor } = formatDelta(deltaInt);

  return (
    <div className="flex items-center gap-s-3">
      <div className="flex-1">
        <div className="mb-s-1 flex items-baseline justify-between">
          <span className="text-[13px] font-medium">
            {axis.label.toLowerCase()}
          </span>
          <span className="flex items-baseline gap-s-1">
            <span
              className={cn(
                't-mono text-[12px]',
                isWeak ? 'text-accent' : 'text-ink-soft',
              )}
            >
              {pct}%
            </span>
            {axis.evidenceCount > 0 &&
              axis.evidenceCount < THIN_EVIDENCE_THRESHOLD && (
                <span className="t-mono text-[11px] text-ink-soft">
                  thin · {axis.evidenceCount}
                </span>
              )}
          </span>
        </div>
        <Bar value={pct} color={isWeak ? 'accent' : 'ink'} />
      </div>
      <span
        className={cn(
          't-mono w-[28px] text-right text-[11px]',
          deltaColor,
        )}
      >
        {deltaText}
      </span>
    </div>
  );
}

function formatDelta(deltaInt: number): {
  text: string;
  colorClass: string;
} {
  if (deltaInt === 0) return { text: EM_DASH, colorClass: 'text-ink-mute' };
  if (deltaInt > 0) return { text: `+${deltaInt}`, colorClass: 'text-ok' };
  return { text: `${MINUS}${Math.abs(deltaInt)}`, colorClass: 'text-accent' };
}
