'use client';

import type { FreeWritingCriterion, FreeWritingRequiredElement } from '@language-drill/shared';

// ── CEFR badge ──────────────────────────────────────────────────────────────
// Band is derived from the first letter of the level string (a/b/c).
export function CEFRBadge({ level, lg }: { level: string; lg?: boolean }) {
  const band = (level || 'B').trim()[0].toLowerCase();
  return <span className={`fw-cefr ${band}${lg ? ' lg' : ''}`}>{level}</span>;
}

// ── Severity tag (high / med / low) ─────────────────────────────────────────
export function SevTag({ sev }: { sev: 'high' | 'med' | 'low' }) {
  const lab = ({ high: 'alta', med: 'media', low: 'baja' } as Record<string, string>)[sev] ?? sev;
  return <span className={`fw-sev ${sev}`}>{lab}</span>;
}

// ── Skill/drill-type icon ────────────────────────────────────────────────────
export function FwIcon({ kind, size = 18 }: { kind: string; size?: number }) {
  const c = {
    width: size,
    height: size,
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.6,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (kind === 'write')
    return (
      <svg {...c} viewBox="0 0 16 16">
        <path d="M11 2.5l2.5 2.5L6 12.5 3 13l.5-3z" />
        <path d="M9.5 4l2.5 2.5" />
      </svg>
    );
  if (kind === 'cloze')
    return (
      <svg {...c} viewBox="0 0 16 16">
        <path d="M2 8h3M11 8h3" />
        <rect x="5.5" y="5.5" width="5" height="5" rx="1" />
      </svg>
    );
  if (kind === 'conjug')
    return (
      <svg {...c} viewBox="0 0 16 16">
        <path d="M8 2v3M8 11v3M2 8h3M11 8h3M4 4l2 2M12 4l-2 2" />
        <circle cx="8" cy="8" r="2" />
      </svg>
    );
  if (kind === 'listen')
    return (
      <svg {...c} viewBox="0 0 16 16">
        <path d="M3 6v4h2l3 2.5v-9L5 6z" />
        <path d="M10.5 5.5a3.5 3.5 0 010 5" />
      </svg>
    );
  if (kind === 'read')
    return (
      <svg {...c} viewBox="0 0 16 16">
        <path d="M2.5 3.5h4a2 2 0 012 2v8a1.5 1.5 0 00-1.5-1.5h-4.5z" />
        <path d="M13.5 3.5h-4a2 2 0 00-2 2v8a1.5 1.5 0 011.5-1.5h4.5z" />
      </svg>
    );
  if (kind === 'speak')
    return (
      <svg {...c} viewBox="0 0 16 16">
        <rect x="6" y="2" width="4" height="8" rx="2" />
        <path d="M4 8a4 4 0 008 0M8 12v2" />
      </svg>
    );
  if (kind === 'spark')
    return (
      <svg {...c} viewBox="0 0 16 16">
        <path d="M8 2l1.4 3.6L13 7l-3.6 1.4L8 12l-1.4-3.6L3 7l3.6-1.4z" />
      </svg>
    );
  if (kind === 'list')
    return (
      <svg {...c} viewBox="0 0 16 16">
        <path d="M5 4h9M5 8h9M5 12h9M2 4h.01M2 8h.01M2 12h.01" />
      </svg>
    );
  if (kind === 'book')
    return (
      <svg {...c} viewBox="0 0 16 16">
        <path d="M3 2.5h6a2 2 0 012 2v9H5a2 2 0 00-2 2z" />
        <path d="M3 13.5a2 2 0 012-2h6" />
      </svg>
    );
  if (kind === 'clock')
    return (
      <svg {...c} viewBox="0 0 16 16">
        <circle cx="8" cy="8" r="6" />
        <path d="M8 4.5V8l2.5 1.5" />
      </svg>
    );
  if (kind === 'check')
    return (
      <svg {...c} viewBox="0 0 16 16">
        <path d="M3 8.5l3.5 3.5L13 4.5" />
      </svg>
    );
  return null;
}

// ── Criterion row (IELTS-style scorecard) ────────────────────────────────────
export function CriterionRow({ c }: { c: FreeWritingCriterion }) {
  const pct = Math.round(c.score * 100);
  const cls = c.score >= 0.85 ? 'hi' : c.score < 0.7 ? 'lo' : '';
  return (
    <div className="fw-crit">
      <div className="top">
        <span className="name">{c.label}</span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <span className="fw-score-num">{c.score.toFixed(2)}</span>
          <CEFRBadge level={c.cefr} />
        </span>
      </div>
      <div className="scorebar">
        <i className={cls} style={{ width: `${pct}%` }} />
      </div>
      <div className="note">{c.note}</div>
    </div>
  );
}

// ── Required-element checklist row ───────────────────────────────────────────
// In Phase 1 the checklist is static: `met` is a prop (default false).
// There is no live r.count / r.partial — those come from the prop only.
export function ReqRow({
  r,
  met = false,
  compact,
}: {
  r: FreeWritingRequiredElement;
  met?: boolean;
  compact?: boolean;
}) {
  const cls = met ? 'met' : '';
  return (
    <div className={`fw-req ${cls}`}>
      <span className="tick">{met ? '✓' : ''}</span>
      <div>
        <div className="label">{r.label}</div>
        {!compact && r.detail && <div className="meta">{r.detail}</div>}
      </div>
    </div>
  );
}

// ── Word counter with target zone bar ────────────────────────────────────────
export function WordCounter({
  count,
  min,
  max,
  showBar = true,
  unit = 'words',
}: {
  count: number;
  min: number;
  max: number;
  showBar?: boolean;
  unit?: string;
}) {
  const state = count < min ? 'under' : count > max ? 'over' : 'ok';
  const barMax = Math.max(max * 1.25, count * 1.1);
  return (
    <div>
      <div className="fw-counter">
        <span className={`n ${state}`}>{count}</span>
        <span className="range">
          / {min}–{max} {unit}
        </span>
      </div>
      {showBar && (
        <div className="fw-counter-bar" style={{ marginTop: 7, width: 200 }}>
          <span
            className="zone"
            style={{
              left: `${(min / barMax) * 100}%`,
              width: `${((max - min) / barMax) * 100}%`,
            }}
          />
          <i
            className={state === 'over' ? 'over' : state === 'ok' ? 'ok' : ''}
            style={{ width: `${Math.min(100, (count / barMax) * 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}
