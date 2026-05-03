import type { LearningLanguage } from '@language-drill/shared';
import type { ProgressRadarResponse } from '@language-drill/api-client';
import { Card } from '../../../../components/ui/card';
import { Button } from '../../../../components/ui/button';
import { RadarChart } from './radar-chart';
import {
  ObservationCard,
  LegendCard,
  RecommendedDrillCard,
  NotEnoughDataCard,
} from './shape-side-cards';

// ---------------------------------------------------------------------------
// ShapeTab — orchestrates the radar + side cards.
// Shape: 2-column grid (1fr / 320px). Loading → centered spinner.
// Error → error card with retry. < 5 evidence → radar + NotEnoughDataCard
// only (R5.5). Otherwise → radar + Observation + Legend + RecommendedDrill.
// Design reference: design.md §"Component 4 — ShapeTab"
// ---------------------------------------------------------------------------

const NOT_ENOUGH_EVIDENCE_THRESHOLD = 5;

export type ShapeTabProps = {
  language: LearningLanguage;
  data: ProgressRadarResponse | undefined;
  isLoading: boolean;
  error: Error | null;
  totalEvidence: number;
  onRetry?: () => void;
};

export function ShapeTab({
  language,
  data,
  isLoading,
  error,
  totalEvidence,
  onRetry,
}: ShapeTabProps) {
  // Errors win over loading: a failed fetch leaves `data` undefined too.
  if (error) {
    return (
      <div style={{ marginTop: 28 }}>
        <Card padding="lg">
          <div className="t-display-s">couldn't load your shape</div>
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
            aria-label="Loading skill radar"
            className="mx-auto h-8 w-8 animate-spin rounded-full border-4 border-paper-2 border-t-ink"
          />
        </Card>
      </div>
    );
  }

  const showNotEnoughData = totalEvidence < NOT_ENOUGH_EVIDENCE_THRESHOLD;

  return (
    <div
      style={{
        marginTop: 28,
        display: 'grid',
        gridTemplateColumns: '1fr 320px',
        gap: 32,
      }}
    >
      <Card padding="lg">
        <RadarChart language={language} axes={data.axes} />
      </Card>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {showNotEnoughData ? (
          <NotEnoughDataCard />
        ) : (
          <>
            <ObservationCard axes={data.axes} />
            <LegendCard />
            <RecommendedDrillCard axes={data.axes} />
          </>
        )}
      </div>
    </div>
  );
}
