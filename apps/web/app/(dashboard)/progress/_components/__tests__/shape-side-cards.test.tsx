import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { RadarAxis, RadarAxisKey } from '@language-drill/api-client';
import {
  ObservationCard,
  LegendCard,
  RecommendedDrillCard,
  NotEnoughDataCard,
} from '../shape-side-cards';

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

describe('ObservationCard', () => {
  it('renders nothing when computeObservation returns null (balanced shape)', () => {
    // No axis has evidence — observation rules return null.
    const { container } = render(<ObservationCard axes={buildAxes({})} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the input-strong narrative when input avg ≥ 0.15 above output avg', () => {
    render(
      <ObservationCard
        axes={buildAxes({
          listening: { mastery: 0.85 },
          reading: { mastery: 0.85 },
          speaking: { mastery: 0.55 },
          writing: { mastery: 0.55 },
        })}
      />,
    );
    expect(screen.getByText('observation')).toBeDefined();
    expect(
      screen.getByText(/strong at input.*weaker at production/i),
    ).toBeDefined();
  });

  it('renders the weakest-drag narrative when an axis is below 0.4', () => {
    render(
      <ObservationCard
        axes={buildAxes({
          listening: { mastery: 0.65 },
          reading: { mastery: 0.65 },
          speaking: { mastery: 0.6 },
          writing: { mastery: 0.6 },
          grammar: { mastery: 0.3 },
        })}
      />,
    );
    expect(
      screen.getByText(/grammar is dragging the shape/i),
    ).toBeDefined();
  });
});

describe('LegendCard', () => {
  it('renders the "compare to" eyebrow and both swatches', () => {
    render(<LegendCard />);
    expect(screen.getByText('compare to')).toBeDefined();
    expect(screen.getByText('you · now')).toBeDefined();
    expect(screen.getByText('you · 30 days ago')).toBeDefined();
  });

  it('omits the prototype\'s "avg learner @ B2" line', () => {
    render(<LegendCard />);
    expect(screen.queryByText(/avg learner/i)).toBeNull();
  });
});

describe('RecommendedDrillCard', () => {
  const NOW = new Date('2026-04-30T12:00:00Z');

  it('returns null when every practised axis is ≥ 0.5', () => {
    const { container } = render(
      <RecommendedDrillCard
        axes={buildAxes({
          listening: { mastery: 0.7 },
          reading: { mastery: 0.65 },
          speaking: { mastery: 0.5 }, // exactly at threshold — does not qualify
          grammar: { mastery: 0.6 },
        })}
        now={NOW}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('returns null when no axis has any evidence', () => {
    const { container } = render(
      <RecommendedDrillCard axes={buildAxes({})} now={NOW} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('picks the lowest-mastery axis below 0.5 and links to /drill?focus=<key>', () => {
    render(
      <RecommendedDrillCard
        axes={[
          {
            key: 'speaking',
            label: 'speaking',
            currentMastery: 0.45,
            previousMastery: 0.45,
            lastPracticedAt: '2026-04-15T12:00:00.000Z',
            evidenceCount: 3,
          },
          {
            key: 'writing',
            label: 'writing',
            currentMastery: 0.3,
            previousMastery: 0.3,
            // 14 days ago at NOW
            lastPracticedAt: '2026-04-16T12:00:00.000Z',
            evidenceCount: 5,
          },
          // Strong axis above threshold — not eligible
          {
            key: 'grammar',
            label: 'grammar',
            currentMastery: 0.85,
            previousMastery: 0.85,
            lastPracticedAt: '2026-04-30T12:00:00.000Z',
            evidenceCount: 10,
          },
          // Untouched axis — not eligible
          {
            key: 'listening',
            label: 'listening',
            currentMastery: 0,
            previousMastery: 0,
            lastPracticedAt: null,
            evidenceCount: 0,
          },
          {
            key: 'reading',
            label: 'reading',
            currentMastery: 0,
            previousMastery: 0,
            lastPracticedAt: null,
            evidenceCount: 0,
          },
          {
            key: 'vocabulary',
            label: 'vocabulary',
            currentMastery: 0,
            previousMastery: 0,
            lastPracticedAt: null,
            evidenceCount: 0,
          },
        ]}
        now={NOW}
      />,
    );
    // Picks `writing` (lowest practised mastery)
    expect(screen.getByText('writing')).toBeDefined();
    expect(screen.queryByText('speaking')).toBeNull();
    const link = screen.getByRole('link', { name: /start drill/i });
    expect(link.getAttribute('href')).toBe('/drill?focus=writing');
    // 14 days between 2026-04-16 and 2026-04-30
    expect(screen.getByText(/last practised 14 days ago/)).toBeDefined();
  });
});

describe('NotEnoughDataCard', () => {
  it('renders the not-enough-data placeholder with a link to /drill', () => {
    render(<NotEnoughDataCard />);
    expect(screen.getByText('not enough data yet')).toBeDefined();
    const link = screen.getByRole('link', { name: /start a drill/i });
    expect(link.getAttribute('href')).toBe('/drill');
  });
});
