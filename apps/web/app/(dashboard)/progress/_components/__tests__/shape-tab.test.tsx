import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Language } from '@language-drill/shared';
import type {
  ProgressRadarResponse,
  RadarAxis,
  RadarAxisKey,
} from '@language-drill/api-client';
import { ShapeTab } from '../shape-tab';

const ALL_KEYS: RadarAxisKey[] = [
  'listening',
  'reading',
  'speaking',
  'writing',
  'grammar',
  'vocabulary',
];

function buildAxes(
  overrides: Partial<Record<RadarAxisKey, { mastery: number; evidence?: number }>>,
): RadarAxis[] {
  return ALL_KEYS.map((key) => {
    const o = overrides[key];
    return {
      key,
      label: key,
      currentMastery: o?.mastery ?? 0,
      previousMastery: o?.mastery ?? 0,
      lastPracticedAt: o ? '2026-04-30T12:00:00.000Z' : null,
      evidenceCount: o?.evidence ?? (o ? 1 : 0),
    };
  });
}

function buildResponse(
  axes: RadarAxis[] = buildAxes({}),
): ProgressRadarResponse {
  return { language: Language.ES, axes };
}

describe('ShapeTab', () => {
  it('renders a loading spinner while isLoading is true', () => {
    render(
      <ShapeTab
        language={Language.ES}
        data={undefined}
        isLoading={true}
        error={null}
        totalEvidence={0}
      />,
    );
    expect(screen.getByRole('status')).toBeDefined();
  });

  it('renders the error card with the message and retry button when error is set', () => {
    const onRetry = vi.fn();
    render(
      <ShapeTab
        language={Language.ES}
        data={undefined}
        isLoading={false}
        error={new Error('network down')}
        totalEvidence={0}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText(/couldn['’]t load your shape/i)).toBeDefined();
    expect(screen.getByText('network down')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('shows NotEnoughDataCard when totalEvidence < 5', () => {
    render(
      <ShapeTab
        language={Language.ES}
        data={buildResponse(buildAxes({ grammar: { mastery: 0.6, evidence: 3 } }))}
        isLoading={false}
        error={null}
        totalEvidence={3}
      />,
    );
    expect(screen.getByText('not enough data yet')).toBeDefined();
    // The other side cards should NOT render.
    expect(screen.queryByText('observation')).toBeNull();
    expect(screen.queryByText('compare to')).toBeNull();
    expect(screen.queryByText('recommended drill')).toBeNull();
  });

  it('renders Observation, Legend, RecommendedDrill cards when totalEvidence ≥ 5', () => {
    // Input-strong shape so ObservationCard renders.
    render(
      <ShapeTab
        language={Language.ES}
        data={buildResponse(
          buildAxes({
            listening: { mastery: 0.85, evidence: 4 },
            reading: { mastery: 0.85, evidence: 4 },
            speaking: { mastery: 0.4, evidence: 2 },
            writing: { mastery: 0.4, evidence: 2 },
          }),
        )}
        isLoading={false}
        error={null}
        totalEvidence={12}
      />,
    );
    expect(screen.getByText('compare to')).toBeDefined(); // LegendCard always renders here
    expect(screen.getByText('observation')).toBeDefined(); // input-strong fires
    expect(screen.getByText('recommended drill')).toBeDefined(); // weakest below 0.5
    expect(screen.queryByText('not enough data yet')).toBeNull();
  });

  it('stacks the radar + side cards into a single column at mobile (Req 9.2, 9.4)', () => {
    const { container } = render(
      <ShapeTab
        language={Language.ES}
        data={buildResponse(
          buildAxes({ grammar: { mastery: 0.6, evidence: 6 } }),
        )}
        isLoading={false}
        error={null}
        totalEvidence={12}
      />,
    );
    const grid = container.querySelector('.grid')!;
    expect(grid).toHaveClass('grid-cols-[1fr_320px]', 'mobile:grid-cols-1');
  });

  it('hides ObservationCard when computeObservation returns null but still shows Legend and Recommend', () => {
    // Balanced shape with one axis dragging — only weakest-drag observation
    // would fire. Use balanced + no axis below 0.4 → null observation, but
    // keep at least one practised axis below 0.5 so RecommendedDrill still shows.
    render(
      <ShapeTab
        language={Language.ES}
        data={buildResponse(
          buildAxes({
            listening: { mastery: 0.6, evidence: 3 },
            reading: { mastery: 0.6, evidence: 3 },
            speaking: { mastery: 0.55, evidence: 3 },
            writing: { mastery: 0.45, evidence: 3 }, // below 0.5 → recommend
          }),
        )}
        isLoading={false}
        error={null}
        totalEvidence={12}
      />,
    );
    expect(screen.queryByText('observation')).toBeNull();
    expect(screen.getByText('compare to')).toBeDefined();
    expect(screen.getByText('recommended drill')).toBeDefined();
  });
});
