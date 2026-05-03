import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Language } from '@language-drill/shared';
import type {
  HeatmapTopic,
  ProgressHeatmapResponse,
} from '@language-drill/api-client';
import { HeatmapTab } from '../heatmap-tab';

function topic(overrides: Partial<HeatmapTopic> = {}): HeatmapTopic {
  return {
    topicId: 'subjunctive',
    name: 'subjunctive',
    mastery: 0.7,
    cells: new Array(30).fill(0),
    ...overrides,
  };
}

function buildResponse(
  topics: HeatmapTopic[] = [],
): ProgressHeatmapResponse {
  return {
    language: Language.ES,
    days: 30,
    topics,
    shadeThresholds: { paper2: 1, accentSoft: 2, accent: 4 },
  };
}

describe('HeatmapTab', () => {
  it('renders a loading spinner while isLoading is true', () => {
    render(
      <HeatmapTab data={undefined} isLoading={true} error={null} />,
    );
    expect(screen.getByRole('status')).toBeDefined();
  });

  it('renders the error card with the message and retry button when error is set', () => {
    const onRetry = vi.fn();
    render(
      <HeatmapTab
        data={undefined}
        isLoading={false}
        error={new Error('heatmap unavailable')}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByText(/couldn['’]t load your heatmap/i)).toBeDefined();
    expect(screen.getByText('heatmap unavailable')).toBeDefined();
    fireEvent.click(screen.getByRole('button', { name: /retry/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('renders the empty placeholder when topics.length < 3', () => {
    render(
      <HeatmapTab
        data={buildResponse([
          topic({ topicId: 'a', name: 'a' }),
          topic({ topicId: 'b', name: 'b' }),
        ])}
        isLoading={false}
        error={null}
      />,
    );
    expect(screen.getByText('build a topic history first')).toBeDefined();
    const link = screen.getByRole('link', { name: /start a drill/i });
    expect(link.getAttribute('href')).toBe('/drill');
  });

  it('renders the grid + hot/cold summary when topics.length ≥ 3', () => {
    const cellsHot = new Array(30).fill(0);
    cellsHot[28] = 1;
    cellsHot[29] = 1;
    const cellsCold = new Array(30).fill(0);
    cellsCold[5] = 1; // 24 days untouched

    render(
      <HeatmapTab
        data={buildResponse([
          topic({
            topicId: 'a',
            name: 'subjunctive',
            mastery: 0.7,
            cells: cellsHot,
          }),
          topic({
            topicId: 'b',
            name: 'preterite',
            mastery: 0.55,
            cells: cellsCold,
          }),
          topic({
            topicId: 'c',
            name: 'conditional',
            mastery: 0.6,
            cells: new Array(30).fill(0),
          }),
        ])}
        isLoading={false}
        error={null}
      />,
    );

    // Grid header from HeatmapGrid renders.
    expect(
      screen.getByText(/topic × recency · last 30 days/i),
    ).toBeDefined();
    // Hot card and cold card both render (two of three topics qualify).
    expect(screen.getByText('🔥 hottest')).toBeDefined();
    expect(screen.getByText('❄ coldest')).toBeDefined();
    // Empty placeholder is NOT shown.
    expect(screen.queryByText('build a topic history first')).toBeNull();
  });
});
