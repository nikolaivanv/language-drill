import type { ProgressHeatmapResponse } from '@language-drill/api-client';
import { Card } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { HeatmapGrid } from './heatmap-grid';
import { HotColdSummary } from './hot-cold-summary';

// ---------------------------------------------------------------------------
// HeatmapTab — orchestrates the topic × day grid + hot/cold summary cards.
// States: error → error card; loading → spinner; topics.length < 3 →
// "build a topic history first" placeholder; otherwise → grid + summary.
// Design reference: design.md §"Component 6 — HeatmapTab"
// ---------------------------------------------------------------------------

const MIN_TOPICS_FOR_GRID = 3;

export type HeatmapTabProps = {
  data: ProgressHeatmapResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  onRetry?: () => void;
};

export function HeatmapTab({
  data,
  isLoading,
  error,
  onRetry,
}: HeatmapTabProps) {
  // Errors win over loading: a failed fetch leaves `data` undefined too.
  if (error) {
    return (
      <div style={{ marginTop: 28 }}>
        <Card padding="lg">
          <div className="t-display-s">couldn't load your heatmap</div>
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
            aria-label="Loading practice heatmap"
            className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-paper-2 border-t-ink"
          />
        </Card>
      </div>
    );
  }

  if (data.topics.length < MIN_TOPICS_FOR_GRID) {
    return (
      <div style={{ marginTop: 28 }}>
        <Card padding="lg" className="text-center">
          <div className="t-display-s">build a topic history first</div>
          <p className="t-small mt-s-2 text-ink-soft">
            do a handful of drills across different topics — the heatmap shows
            your last 30 days once you have at least three topics in play.
          </p>
          <div className="mt-s-3">
            <Button href="/drill" variant="primary" size="sm">
              start a drill →
            </Button>
          </div>
        </Card>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 28 }}>
      <Card padding="lg">
        <HeatmapGrid
          topics={data.topics}
          shadeThresholds={data.shadeThresholds}
        />
      </Card>
      <HotColdSummary topics={data.topics} />
    </div>
  );
}
