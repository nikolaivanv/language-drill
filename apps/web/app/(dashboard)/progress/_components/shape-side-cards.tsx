import type { RadarAxis } from '@language-drill/api-client';
import { Card } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { computeObservation } from '../_lib/observation-rules';

const RECOMMEND_THRESHOLD = 0.5;
const MS_PER_DAY = 86_400_000;

// ---------------------------------------------------------------------------
// Shape-tab side cards (ObservationCard, LegendCard).
// RecommendedDrillCard / NotEnoughDataCard live here too — added in task 22b.
// Design reference: design.md §"Component 4 — ShapeTab" + §"Component side
// cards"
// ---------------------------------------------------------------------------

export type ObservationCardProps = {
  axes: readonly RadarAxis[];
};

/**
 * Renders a deterministic narrative ("input-strong", "output-strong",
 * "weakest-drag") when the rules table fires; returns `null` when the
 * shape is balanced enough to need no commentary.
 */
export function ObservationCard({ axes }: ObservationCardProps) {
  const result = computeObservation(axes);
  if (result === null) return null;

  return (
    <Card padding="md" className="bg-accent-soft border-accent-soft">
      <div className="t-micro" style={{ color: 'var(--color-accent-2)' }}>
        observation
      </div>
      <div className="t-body" style={{ marginTop: 6, color: 'var(--color-ink)' }}>
        {result.observation}
      </div>
    </Card>
  );
}

/**
 * Static legend explaining the two radar polygons. The prototype's
 * "avg learner @ B2" comparison line is intentionally omitted in v1
 * because no peer-comparison data exists yet.
 */
export function LegendCard() {
  return (
    <Card padding="md">
      <div className="t-micro">compare to</div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          marginTop: 10,
        }}
      >
        <span
          style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}
        >
          <span
            aria-hidden
            style={{
              width: 14,
              height: 14,
              borderRadius: 3,
              background: 'var(--color-accent)',
              opacity: 0.6,
            }}
          />
          you · now
        </span>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 13,
            color: 'var(--color-ink-soft)',
          }}
        >
          <span
            aria-hidden
            style={{
              width: 14,
              height: 14,
              borderRadius: 3,
              background: 'transparent',
              border: '1.5px dashed var(--color-ink-mute)',
            }}
          />
          you · 30 days ago
        </span>
      </div>
    </Card>
  );
}

export type RecommendedDrillCardProps = {
  axes: readonly RadarAxis[];
  /** Override "today" for deterministic rendering in tests. */
  now?: Date;
};

/**
 * Picks the lowest-mastery practised axis below 0.5 and links to a focused
 * drill. Renders `null` when every practised axis is already at or above
 * the recommend threshold (R5.4).
 */
export function RecommendedDrillCard({ axes, now }: RecommendedDrillCardProps) {
  const candidates = axes.filter(
    (a) => a.evidenceCount > 0 && a.currentMastery < RECOMMEND_THRESHOLD,
  );
  if (candidates.length === 0) return null;

  const weakest = candidates.reduce((w, a) =>
    a.currentMastery < w.currentMastery ? a : w,
  );

  const today = now ?? new Date();
  const daysSince = daysSincePracticed(weakest.lastPracticedAt, today);

  return (
    <Card padding="md">
      <div className="t-micro">recommended drill</div>
      <div className="t-display-s" style={{ marginTop: 6 }}>
        {weakest.label}
      </div>
      <div className="t-small" style={{ marginTop: 4 }}>
        weakest skill
        {daysSince === null
          ? ''
          : daysSince === 0
            ? ', last practised today'
            : daysSince === 1
              ? ', last practised yesterday'
              : `, last practised ${daysSince} days ago`}
        .
      </div>
      <div style={{ marginTop: 10 }}>
        <Button href="/drill?start=quick" variant="primary" size="sm">
          start drill →
        </Button>
      </div>
    </Card>
  );
}

/**
 * Shown on the Shape tab when the user has fewer than 5 evaluated
 * exercises in the active language (R5.5). Replaces the observation +
 * recommended-drill cards.
 */
export function NotEnoughDataCard() {
  return (
    <Card padding="md">
      <div className="t-micro">not enough data yet</div>
      <div className="t-display-s" style={{ marginTop: 6 }}>
        do a few more drills.
      </div>
      <div className="t-small" style={{ marginTop: 4 }}>
        the radar starts to mean something after ~5 graded attempts.
      </div>
      <div style={{ marginTop: 10 }}>
        <Button href="/drill?start=quick" variant="primary" size="sm">
          start a drill →
        </Button>
      </div>
    </Card>
  );
}

function daysSincePracticed(
  lastPracticedAt: string | null,
  now: Date,
): number | null {
  if (lastPracticedAt === null) return null;
  const last = new Date(lastPracticedAt).getTime();
  if (Number.isNaN(last)) return null;
  const diff = now.getTime() - last;
  if (diff < 0) return 0;
  return Math.floor(diff / MS_PER_DAY);
}
