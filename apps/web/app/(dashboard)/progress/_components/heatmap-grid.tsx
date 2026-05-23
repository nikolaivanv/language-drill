import type { HeatmapTopic, ShadeThresholds } from '@language-drill/api-client';

// ---------------------------------------------------------------------------
// HeatmapGrid — topic × day grid (CSS Grid + flex), no SVG, no library.
// Cell shade is picked client-side from the server's threshold table so
// the API stays the single source of truth on what "warm" means.
// Design reference: design.md §"Component 7 — HeatmapGrid"
// ---------------------------------------------------------------------------

const DAYS = 30;
const MS_PER_DAY = 86_400_000;

type Shade = 'transparent' | 'paper-2' | 'accent-soft' | 'accent';

const SHADE_BG: Record<Shade, string> = {
  transparent: 'transparent',
  'paper-2': 'var(--color-paper-2)',
  'accent-soft': 'var(--color-accent-soft)',
  accent: 'var(--color-accent)',
};

const SHADE_ORDER: readonly Shade[] = [
  'transparent',
  'paper-2',
  'accent-soft',
  'accent',
];

export function pickShade(count: number, t: ShadeThresholds): Shade {
  if (count >= t.accent) return 'accent';
  if (count >= t.accentSoft) return 'accent-soft';
  if (count >= t.paper2) return 'paper-2';
  return 'transparent';
}

export type HeatmapGridProps = {
  topics: readonly HeatmapTopic[];
  shadeThresholds: ShadeThresholds;
  /** Override "today" for deterministic rendering in tests. */
  now?: Date;
};

export function HeatmapGrid({
  topics,
  shadeThresholds,
  now,
}: HeatmapGridProps) {
  const today = now ?? new Date();

  return (
    <div>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          marginBottom: 18,
        }}
      >
        <div>
          <div className="t-display-s">topic × recency · last 30 days</div>
          <div className="t-small">darker = more recent and intense</div>
        </div>
        <div
          aria-label="shade legend"
          style={{ display: 'flex', alignItems: 'center', gap: 8 }}
        >
          <span className="t-small">less</span>
          {SHADE_ORDER.map((shade) => (
            <div
              key={shade}
              style={{
                width: 14,
                height: 14,
                background: SHADE_BG[shade],
                border: '1px solid var(--color-rule)',
                borderRadius: 2,
              }}
            />
          ))}
          <span className="t-small">more</span>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        {topics.map((topic) => (
          <div
            key={topic.topicId}
            style={{ display: 'flex', alignItems: 'center', gap: 12 }}
          >
            <div
              // Desktop: 170px right-aligned label. Mobile (≤760px): narrower,
              // left-aligned, smaller font so the day cells get room without
              // clipping the topic name (Req 9.3).
              className="w-[170px] text-right text-[12px] mobile:w-[84px] mobile:text-left mobile:text-[11px] mobile:leading-tight"
            >
              {topic.name}
            </div>
            <div style={{ display: 'flex', gap: 2, flex: 1 }}>
              {topic.cells.map((count, dayIdx) => {
                const shade = pickShade(count, shadeThresholds);
                const offset = DAYS - 1 - dayIdx; // 0 = today, 29 = oldest
                const cellDate = new Date(today.getTime() - offset * MS_PER_DAY);
                const dateLabel = formatUtcDate(cellDate);
                const title = `${dateLabel}: ${count} ${count === 1 ? 'attempt' : 'attempts'}`;
                return (
                  <div
                    key={dayIdx}
                    title={title}
                    data-shade={shade}
                    // Square day cell, capped at 22px desktop / 12px mobile so
                    // 30 columns fit a phone width (Req 9.3). Shade stays inline
                    // (dynamic from the server threshold table).
                    className="flex-1 aspect-square max-h-[22px] mobile:max-h-[12px] rounded-[3px] border border-[rgba(26,22,18,0.08)]"
                    style={{ background: SHADE_BG[shade] }}
                  />
                );
              })}
            </div>
            <div
              className="t-mono"
              style={{
                fontSize: 11,
                color: 'var(--color-ink-mute)',
                width: 36,
              }}
            >
              {Math.round(clamp01(topic.mastery) * 100)}%
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function formatUtcDate(date: Date): string {
  const y = date.getUTCFullYear();
  const m = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const d = `${date.getUTCDate()}`.padStart(2, '0');
  return `${y}-${m}-${d}`;
}
