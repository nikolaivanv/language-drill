import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { HeatmapTopic, ShadeThresholds } from '@language-drill/api-client';
import { HeatmapGrid, pickShade } from '../heatmap-grid';

const THRESHOLDS: ShadeThresholds = { paper2: 1, accentSoft: 2, accent: 4 };

const NOW = new Date('2026-04-30T12:00:00Z');
const DAY = 86_400_000;

function topic(overrides: Partial<HeatmapTopic> = {}): HeatmapTopic {
  return {
    topicId: 'subjunctive',
    name: 'subjunctive',
    mastery: 0.71,
    cells: new Array(30).fill(0),
    ...overrides,
  };
}

describe('pickShade', () => {
  it('returns transparent for 0', () => {
    expect(pickShade(0, THRESHOLDS)).toBe('transparent');
  });
  it('returns paper-2 at the paper2 threshold', () => {
    expect(pickShade(1, THRESHOLDS)).toBe('paper-2');
  });
  it('returns accent-soft at the accentSoft threshold', () => {
    expect(pickShade(2, THRESHOLDS)).toBe('accent-soft');
    expect(pickShade(3, THRESHOLDS)).toBe('accent-soft');
  });
  it('returns accent at the accent threshold', () => {
    expect(pickShade(4, THRESHOLDS)).toBe('accent');
    expect(pickShade(99, THRESHOLDS)).toBe('accent');
  });
});

describe('HeatmapGrid', () => {
  it('renders one row per topic with the topic name and mastery percent', () => {
    render(
      <HeatmapGrid
        topics={[
          topic({ topicId: 'subjunctive', name: 'subjunctive', mastery: 0.71 }),
          topic({ topicId: 'preterite', name: 'preterite', mastery: 0.58 }),
        ]}
        shadeThresholds={THRESHOLDS}
        now={NOW}
      />,
    );
    expect(screen.getByText('subjunctive')).toBeDefined();
    expect(screen.getByText('preterite')).toBeDefined();
    expect(screen.getByText('71%')).toBeDefined();
    expect(screen.getByText('58%')).toBeDefined();
  });

  it('renders 30 cells per topic row', () => {
    const { container } = render(
      <HeatmapGrid
        topics={[topic({})]}
        shadeThresholds={THRESHOLDS}
        now={NOW}
      />,
    );
    const cells = container.querySelectorAll('[data-shade]');
    expect(cells).toHaveLength(30);
  });

  it('paints cells with the shade matching the count and threshold', () => {
    const cells = new Array(30).fill(0);
    cells[29] = 5; // today, crosses accent threshold
    cells[28] = 2; // yesterday, accent-soft
    cells[27] = 1; // two days ago, paper-2
    const { container } = render(
      <HeatmapGrid
        topics={[topic({ cells })]}
        shadeThresholds={THRESHOLDS}
        now={NOW}
      />,
    );
    const dayCells = container.querySelectorAll('[data-shade]');
    expect(dayCells[29].getAttribute('data-shade')).toBe('accent');
    expect((dayCells[29] as HTMLElement).style.background).toContain(
      '--color-accent',
    );
    expect(dayCells[28].getAttribute('data-shade')).toBe('accent-soft');
    expect(dayCells[27].getAttribute('data-shade')).toBe('paper-2');
    expect(dayCells[0].getAttribute('data-shade')).toBe('transparent');
  });

  it("places today's title at index 29 and the 29-day-old title at index 0", () => {
    const cells = new Array(30).fill(0);
    cells[29] = 2;
    cells[0] = 3;
    const { container } = render(
      <HeatmapGrid
        topics={[topic({ cells })]}
        shadeThresholds={THRESHOLDS}
        now={NOW}
      />,
    );
    const dayCells = container.querySelectorAll('[data-shade]');
    expect(dayCells[29].getAttribute('title')).toBe('2026-04-30: 2 attempts');
    const oldestExpected = new Date(NOW.getTime() - 29 * DAY);
    const y = oldestExpected.getUTCFullYear();
    const m = `${oldestExpected.getUTCMonth() + 1}`.padStart(2, '0');
    const d = `${oldestExpected.getUTCDate()}`.padStart(2, '0');
    expect(dayCells[0].getAttribute('title')).toBe(
      `${y}-${m}-${d}: 3 attempts`,
    );
  });

  it("uses the singular 'attempt' for count 1", () => {
    const cells = new Array(30).fill(0);
    cells[29] = 1;
    const { container } = render(
      <HeatmapGrid
        topics={[topic({ cells })]}
        shadeThresholds={THRESHOLDS}
        now={NOW}
      />,
    );
    const dayCells = container.querySelectorAll('[data-shade]');
    expect(dayCells[29].getAttribute('title')).toBe('2026-04-30: 1 attempt');
  });

  it('squeezes day cells and left-aligns the label at mobile width (Req 9.3)', () => {
    const { container } = render(
      <HeatmapGrid
        topics={[topic({ name: 'subjunctive' })]}
        shadeThresholds={THRESHOLDS}
        now={NOW}
      />,
    );
    // Day cells: 22px desktop cap, 12px mobile cap.
    const cell = container.querySelector('[data-shade]')!;
    expect(cell).toHaveClass('max-h-[22px]', 'mobile:max-h-[12px]', 'aspect-square');
    // Topic label: 170px right-aligned desktop → narrower, left-aligned mobile.
    const label = screen.getByText('subjunctive');
    expect(label).toHaveClass('w-[170px]', 'text-right', 'mobile:w-[84px]', 'mobile:text-left');
  });

  it('renders a four-swatch shade legend', () => {
    const { container } = render(
      <HeatmapGrid
        topics={[topic({})]}
        shadeThresholds={THRESHOLDS}
        now={NOW}
      />,
    );
    const legend = container.querySelector('[aria-label="shade legend"]')!;
    expect(legend).toBeDefined();
    // Four swatches inside the legend (transparent, paper-2, accent-soft, accent).
    expect(legend.querySelectorAll('div')).toHaveLength(4);
  });
});
