'use client';

import * as React from 'react';
import { CefrLevel } from '@language-drill/shared';

const ORDER = Object.values(CefrLevel) as CefrLevel[];

export interface DrillMetaProps {
  /** The level this session is drilling at (the session-scoped intent). */
  level: CefrLevel;
  /**
   * The learner's recorded baseline for the active language (the identity).
   * Drift signal + reset only render when this is known and differs from
   * `level`. Null when the active language has no profile yet.
   */
  baseline: CefrLevel | null;
  onLevelChange: (level: CefrLevel) => void;
  /**
   * Optional read-only context to sit on the same baseline as the level
   * control (e.g. the theory topic trigger). Rendered after a separator.
   */
  topic?: React.ReactNode;
}

/**
 * The drill meta row — one aligned baseline carrying the session's contextual
 * controls. The level is the single writable control (a pill, framed as an
 * override: "drill level", not "difficulty"); identity (the baseline level)
 * lives once in the global nav and is only echoed here as a quiet drift signal
 * when the session is off-baseline. See DRILL-UI-GUIDELINES §4.
 */
export function DrillMeta({
  level,
  baseline,
  onLevelChange,
  topic,
}: DrillMetaProps) {
  const drift =
    baseline !== null ? ORDER.indexOf(level) - ORDER.indexOf(baseline) : 0;

  return (
    <div className="flex flex-wrap items-center gap-s-3 text-ink-mute">
      <span className="inline-flex flex-wrap items-center gap-s-2">
        <span className="t-micro" id="drill-level-label">
          drill level
        </span>
        <span className="inline-flex items-center gap-[6px] rounded-r-pill border border-rule bg-card px-[10px] py-[4px] transition-colors hover:border-ink-soft">
          <select
            aria-labelledby="drill-level-label"
            value={level}
            onChange={(e) => onLevelChange(e.target.value as CefrLevel)}
            className="cursor-pointer appearance-none border-0 bg-transparent p-0 pr-[2px] font-mono text-[13px] font-medium text-ink outline-none"
          >
            {ORDER.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <span aria-hidden="true" className="pointer-events-none text-[9px] text-ink-mute">
            ▾
          </span>
        </span>

        {drift !== 0 && baseline !== null && (
          <span className="inline-flex items-center gap-s-2 text-[11px] tracking-[0.4px] text-accent-2">
            <span>
              {drift > 0 ? '↑ above' : '↓ below'} your {baseline} baseline
            </span>
            <button
              type="button"
              onClick={() => onLevelChange(baseline)}
              className="cursor-pointer border-0 bg-transparent p-0 text-[11px] text-ink-mute underline underline-offset-2 transition-colors hover:text-ink"
            >
              reset
            </button>
          </span>
        )}
      </span>

      {topic && (
        <>
          <span aria-hidden="true" className="text-rule">
            ·
          </span>
          {topic}
        </>
      )}
    </div>
  );
}
