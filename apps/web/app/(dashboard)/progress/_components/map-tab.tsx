'use client';

import { useState } from 'react';
import type { CurriculumMapResponse, CurriculumMapPoint, InsightsErrorTheme } from '@language-drill/api-client';
import { Card } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { WorkOnThese } from '../../_components/work-on-these';
import { collapseSolidRuns, type MapEntry } from '../_lib/collapse-solid-runs';

// ---------------------------------------------------------------------------
// MapTab — read-only curriculum spine for /progress.
// Mirrors ShapeTab's loading/error pattern and timeline-item.tsx's rail idiom.
// Phase 1: display-only (no detail sheet; no functional "add level" button).
// ---------------------------------------------------------------------------

export type MapTabProps = {
  data: CurriculumMapResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  onRetry?: () => void;
  errorThemes: InsightsErrorTheme[];
};

// ---------------------------------------------------------------------------
// Legend dot
// ---------------------------------------------------------------------------

function StateDot({ state }: { state: CurriculumMapPoint['state'] }) {
  const bg =
    state === 'solid'
      ? 'var(--color-ink)'
      : state === 'learning'
        ? 'var(--color-accent)'
        : 'var(--color-paper-3)';
  return (
    <span
      aria-hidden
      style={{
        display: 'inline-block',
        width: 10,
        height: 10,
        borderRadius: '50%',
        background: bg,
        border: state === 'not-started' ? '1.5px solid var(--color-rule)' : 'none',
        flexShrink: 0,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// Spine node circle
// ---------------------------------------------------------------------------

function SpineNode({
  state,
  order,
}: {
  state: CurriculumMapPoint['state'];
  order: number;
}) {
  const label = state === 'solid' ? '✓' : String(order).padStart(2, '0');
  const isSolid = state === 'solid';
  const isLearning = state === 'learning';

  return (
    <div
      aria-hidden
      style={{
        width: 30,
        height: 30,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 10,
        fontFamily: 'var(--font-mono, monospace)',
        fontWeight: 600,
        flexShrink: 0,
        background: isSolid
          ? 'var(--color-ink)'
          : isLearning
            ? 'var(--color-accent-soft)'
            : 'var(--color-paper-2)',
        color: isSolid
          ? 'var(--color-paper)'
          : isLearning
            ? 'var(--color-accent)'
            : 'var(--color-ink-soft)',
        border: isLearning
          ? '1.5px solid var(--color-accent)'
          : isSolid
            ? 'none'
            : '1.5px solid var(--color-rule)',
      }}
    >
      {label}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Mastery bar (locked refinement 1)
// ---------------------------------------------------------------------------

function MasteryBar({
  mastery,
  state,
}: {
  mastery: number | null;
  state: CurriculumMapPoint['state'];
}) {
  if (mastery === null) return null;
  const fill =
    state === 'solid' ? 'var(--color-ink)' : 'var(--color-accent)';
  return (
    <div
      style={{
        height: 5,
        background: 'var(--color-paper-3)',
        borderRadius: 3,
        overflow: 'hidden',
        marginTop: 4,
      }}
    >
      <div
        data-testid="mastery-bar"
        style={{
          width: `${Math.round(mastery * 100)}%`,
          height: '100%',
          background: fill,
          borderRadius: 3,
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single spine row
// ---------------------------------------------------------------------------

function SpineRow({
  point,
  isLast,
}: {
  point: CurriculumMapPoint;
  isLast: boolean;
}) {
  const { state, order, name, mastery, errorProne, recentErrorCount, prereqUnmet, prereqNames, lastPracticedAt } = point;
  const isNotStarted = state === 'not-started';
  const bodyOpacity = prereqUnmet && isNotStarted ? 0.6 : 1;

  // locked refinement 3: error-prone = hottest row — accent-tinted left border + bg
  const rowStyle: React.CSSProperties = errorProne
    ? {
        background: 'var(--color-accent-soft)',
        borderLeft: '3px solid var(--color-accent)',
        borderRadius: '0 6px 6px 0',
        padding: '6px 8px 6px 10px',
        margin: '-6px -8px -6px 0',
      }
    : {};

  let cueText = '';
  if (prereqUnmet && isNotStarted && prereqNames.length > 0) {
    cueText = `builds on ${prereqNames[0]}`;
  } else if (lastPracticedAt) {
    const ago = formatAgo(lastPracticedAt);
    cueText = `last practiced ${ago}`;
  } else if (!isNotStarted) {
    cueText = 'untouched';
  }

  const stateTagColor =
    state === 'not-started'
      ? 'var(--color-ink-mute)'
      : state === 'learning'
        ? 'var(--color-accent-2)'
        : 'var(--color-ok)';
  const stateTagLabel = state === 'not-started' ? '' : state;

  return (
    <li className="flex gap-[14px]">
      {/* Rail */}
      <div className="flex flex-shrink-0 flex-col items-center">
        <SpineNode state={state} order={order} />
        {!isLast && (
          <div
            style={{
              width: 1.5,
              flex: 1,
              minHeight: 16,
              marginTop: 4,
              marginBottom: 4,
              background: 'var(--color-rule)',
            }}
          />
        )}
      </div>

      {/* Body */}
      <div
        className="flex-1 pb-[14px]"
        style={{ opacity: bodyOpacity, ...rowStyle }}
      >
        {/* Name row */}
        <div className="flex flex-wrap items-center gap-x-[8px] gap-y-[2px]">
          <span className="t-display-s">{name}</span>
          {errorProne && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 600,
                color: 'var(--color-accent-2)',
                background: 'var(--color-accent-soft)',
                borderRadius: 4,
                padding: '1px 5px',
              }}
            >
              ⚠ {recentErrorCount}×
            </span>
          )}
          {stateTagLabel && (
            <span
              style={{
                fontSize: 10,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                color: stateTagColor,
                fontWeight: 500,
              }}
            >
              {stateTagLabel}
            </span>
          )}
        </div>

        {/* Mastery bar (locked refinement 1) */}
        <MasteryBar mastery={mastery} state={state} />

        {/* Cue */}
        {cueText && (
          <div
            className="t-micro"
            style={{ color: 'var(--color-ink-mute)', marginTop: 3 }}
          >
            {cueText}
          </div>
        )}
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Collapsed run row (locked refinement 2)
// ---------------------------------------------------------------------------

function CollapsedRunRow({
  entry,
  isLast,
  expanded,
  onToggle,
}: {
  entry: Extract<MapEntry, { kind: 'run' }>;
  isLast: boolean;
  expanded: boolean;
  onToggle: () => void;
}) {
  if (expanded) {
    return (
      <>
        {entry.points.map((pt, i) => (
          <SpineRow
            key={pt.key}
            point={pt}
            isLast={isLast && i === entry.points.length - 1}
          />
        ))}
        <li>
          <button
            type="button"
            onClick={onToggle}
            className="t-micro"
            style={{
              color: 'var(--color-ink-soft)',
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              padding: '2px 0 10px',
              textDecoration: 'underline',
            }}
          >
            collapse
          </button>
        </li>
      </>
    );
  }

  return (
    <li className="flex gap-[14px]">
      {/* Rail — placeholder node */}
      <div className="flex flex-shrink-0 flex-col items-center">
        <div
          aria-hidden
          style={{
            width: 30,
            height: 30,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 10,
            fontFamily: 'var(--font-mono, monospace)',
            fontWeight: 600,
            background: 'var(--color-ink)',
            color: 'var(--color-paper)',
            flexShrink: 0,
          }}
        >
          ✓
        </div>
        {!isLast && (
          <div
            style={{
              width: 1.5,
              flex: 1,
              minHeight: 16,
              marginTop: 4,
              marginBottom: 4,
              background: 'var(--color-rule)',
            }}
          />
        )}
      </div>

      {/* Body */}
      <div className="flex-1 pb-[14px] flex items-center">
        <button
          type="button"
          onClick={onToggle}
          className="t-small"
          style={{
            background: 'none',
            border: 'none',
            cursor: 'pointer',
            color: 'var(--color-ink-soft)',
            padding: 0,
            textDecoration: 'underline',
          }}
        >
          {entry.count} solid — show
        </button>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Readiness strip
// ---------------------------------------------------------------------------

function ReadinessStrip({
  level,
  solidCount,
  total,
  readyToAdvance,
}: {
  level: string;
  solidCount: number;
  total: number;
  readyToAdvance: boolean;
}) {
  const pct = total > 0 ? Math.round((solidCount / total) * 100) : 0;
  return (
    <div
      style={{
        background: readyToAdvance
          ? 'var(--color-accent-soft)'
          : 'var(--color-paper-2)',
        borderRadius: 10,
        padding: '14px 16px',
        marginBottom: 20,
      }}
    >
      <div className="t-micro" style={{ color: 'var(--color-ink-mute)' }}>
        {level} readiness
      </div>
      <div className="t-display-s" style={{ marginTop: 4 }}>
        <span className="t-mono">{solidCount}</span>
        {' of '}
        <span className="t-mono">{total}</span>
        {` ${level} grammar points solid.`}
      </div>
      <div
        style={{
          height: 8,
          background: 'var(--color-paper-3)',
          borderRadius: 4,
          overflow: 'hidden',
          marginTop: 8,
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            background: readyToAdvance
              ? 'var(--color-accent)'
              : 'var(--color-ink)',
            borderRadius: 4,
          }}
        />
      </div>
      {readyToAdvance && (
        <p
          className="t-body"
          style={{ marginTop: 10, color: 'var(--color-ink)' }}
        >
          you've made {level} solid — adding the next level widens your daily plan.
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

function Legend() {
  return (
    <div
      className="t-micro"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '10px 20px',
        color: 'var(--color-ink-soft)',
        marginBottom: 18,
      }}
    >
      <span className="flex items-center gap-[6px]">
        <StateDot state="not-started" /> not started
      </span>
      <span className="flex items-center gap-[6px]">
        <StateDot state="learning" /> learning
      </span>
      <span className="flex items-center gap-[6px]">
        <StateDot state="solid" /> solid
      </span>
      <span
        className="flex items-center gap-[6px]"
        style={{ color: 'var(--color-accent-2)' }}
      >
        ⚠ still generating errors
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MapTab
// ---------------------------------------------------------------------------

export function MapTab({
  data,
  isLoading,
  error,
  onRetry,
  errorThemes,
}: MapTabProps) {
  // Expanded run indices: Set<runIndex>
  const [expandedRuns, setExpandedRuns] = useState<Set<number>>(new Set());

  function toggleRun(idx: number) {
    setExpandedRuns((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }

  if (error) {
    return (
      <div style={{ marginTop: 28 }}>
        <Card padding="lg">
          <div className="t-display-s">couldn't load the curriculum map</div>
          <p className="t-small mt-s-2">{error.message}</p>
          {onRetry && (
            <div className="mt-s-3">
              <Button onClick={onRetry} variant="default" size="sm">
                retry
              </Button>
            </div>
          )}
        </Card>
      </div>
    );
  }

  if (isLoading || data === undefined) {
    return (
      <div style={{ marginTop: 28 }}>
        <Card padding="lg" className="text-center">
          <div
            role="status"
            aria-label="Loading curriculum map"
            className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-paper-2 border-t-ink"
          />
        </Card>
      </div>
    );
  }

  const activeLevel = data.levels.find(
    (l) => l.level === data.activeLevel && !l.isPreview,
  );
  const previewLevel = data.levels.find((l) => l.isPreview);

  return (
    <div style={{ marginTop: 28, maxWidth: 640 }}>
      {/* Readiness strip */}
      {activeLevel && (
        <ReadinessStrip
          level={activeLevel.level}
          solidCount={activeLevel.solidCount}
          total={activeLevel.total}
          readyToAdvance={activeLevel.readyToAdvance}
        />
      )}

      {/* Level head */}
      {activeLevel && (
        <div className="flex items-center gap-[10px] mb-[14px]">
          <span className="t-display-m">{activeLevel.level}</span>
          <span
            className="t-micro"
            style={{ color: 'var(--color-ink-mute)' }}
          >
            active level · curriculum order
          </span>
        </div>
      )}

      {/* Legend */}
      <Legend />

      {/* Spine list */}
      {activeLevel && (() => {
        const entries = collapseSolidRuns(activeLevel.points);
        let runCounter = -1;
        return (
          <ul
            style={{ listStyle: 'none', padding: 0, margin: '0 0 28px' }}
            aria-label={`${activeLevel.level} grammar points`}
          >
            {entries.map((entry, i) => {
              const isLast = i === entries.length - 1;
              if (entry.kind === 'point') {
                return (
                  <SpineRow key={entry.point.key} point={entry.point} isLast={isLast} />
                );
              }
              // run entry
              runCounter++;
              const runIdx = runCounter;
              return (
                <CollapsedRunRow
                  key={`run-${i}`}
                  entry={entry}
                  isLast={isLast}
                  expanded={expandedRuns.has(runIdx)}
                  onToggle={() => { toggleRun(runIdx); }}
                />
              );
            })}
          </ul>
        );
      })()}

      {/* Next-level preview */}
      {previewLevel && (
        <div
          style={{
            border: '1.5px dashed var(--color-rule)',
            borderRadius: 10,
            padding: '14px 16px',
            marginBottom: 28,
          }}
        >
          <div
            className="t-micro"
            style={{ color: 'var(--color-ink-mute)', marginBottom: 10 }}
          >
            next up · {previewLevel.level} preview
          </div>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {previewLevel.points.map((pt) => (
              <li
                key={pt.key}
                className="flex items-center gap-[8px]"
                style={{ opacity: 0.55, padding: '3px 0' }}
              >
                <span
                  aria-hidden
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: 'var(--color-ink-soft)',
                    flexShrink: 0,
                    display: 'inline-block',
                  }}
                />
                <span className="t-small">{pt.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Work on these */}
      {errorThemes.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <WorkOnThese themes={errorThemes} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatAgo(isoDate: string): string {
  const ms = Date.now() - new Date(isoDate).getTime();
  const days = Math.floor(ms / 86_400_000);
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}w ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}
