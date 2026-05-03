import type { HeatmapTopic } from '@language-drill/api-client';
import { Card } from '../../../../components/ui/card';

// ---------------------------------------------------------------------------
// HotColdSummary — two summary cards under the heatmap grid:
//   🔥 hottest  → topic with the most active days in the last 14 days
//   ❄ coldest   → topic above 0.4 mastery left untouched ≥ 7 days
// Either card hides when no topic qualifies (R6.5). Both cards hide when
// the topics array is empty.
// Design reference: design.md §"Component 6 — HeatmapTab" (HotColdSummary)
// ---------------------------------------------------------------------------

const HOT_WINDOW_DAYS = 14;
const COLD_GAP_DAYS = 7;
const COLD_MIN_MASTERY = 0.4;

export type HotColdSummaryProps = {
  topics: readonly HeatmapTopic[];
};

export function HotColdSummary({ topics }: HotColdSummaryProps) {
  const hot = pickHottest(topics);
  const cold = pickColdest(topics);

  if (hot === null && cold === null) return null;

  return (
    <div
      style={{
        marginTop: 16,
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 14,
      }}
    >
      {hot !== null && (
        <Card padding="md" className="bg-hilite-soft border-hilite-soft">
          <div className="t-micro">🔥 hottest</div>
          <div className="t-display-s" style={{ marginTop: 4 }}>
            {hot.topic.name}
          </div>
          <div className="t-small" style={{ marginTop: 2 }}>
            {hot.activeDays} of last {HOT_WINDOW_DAYS} days · paying off
          </div>
        </Card>
      )}
      {cold !== null && (
        <Card padding="md" className="bg-accent-soft border-accent-soft">
          <div className="t-micro" style={{ color: 'var(--color-accent-2)' }}>
            ❄ coldest
          </div>
          <div className="t-display-s" style={{ marginTop: 4 }}>
            {cold.topic.name}
          </div>
          <div className="t-small" style={{ marginTop: 2 }}>
            {coldSubtitle(cold.daysUntouched)}
          </div>
        </Card>
      )}
    </div>
  );
}

function pickHottest(
  topics: readonly HeatmapTopic[],
): { topic: HeatmapTopic; activeDays: number } | null {
  let best: { topic: HeatmapTopic; activeDays: number } | null = null;
  for (const topic of topics) {
    const recent = topic.cells.slice(-HOT_WINDOW_DAYS);
    const activeDays = recent.reduce(
      (sum, count) => sum + (count > 0 ? 1 : 0),
      0,
    );
    if (activeDays === 0) continue;
    if (best === null || activeDays > best.activeDays) {
      best = { topic, activeDays };
    }
  }
  return best;
}

function pickColdest(
  topics: readonly HeatmapTopic[],
): { topic: HeatmapTopic; daysUntouched: number } | null {
  const days = 30; // matches HeatmapTopic.cells.length
  let best: { topic: HeatmapTopic; daysUntouched: number } | null = null;

  for (const topic of topics) {
    if (topic.mastery <= COLD_MIN_MASTERY) continue;

    // Walk from today backwards, find most recent non-zero day.
    let lastIdx = -1;
    for (let i = topic.cells.length - 1; i >= 0; i -= 1) {
      if (topic.cells[i] > 0) {
        lastIdx = i;
        break;
      }
    }
    // If never practised in the 30-day window, treat as "≥ days untouched".
    const daysUntouched =
      lastIdx === -1 ? days : topic.cells.length - 1 - lastIdx;
    if (daysUntouched < COLD_GAP_DAYS) continue;

    if (best === null || daysUntouched > best.daysUntouched) {
      best = { topic, daysUntouched };
    }
  }
  return best;
}

function coldSubtitle(daysUntouched: number): string {
  if (daysUntouched >= 30) return 'untouched 30+ days';
  return `untouched ${daysUntouched} days`;
}
