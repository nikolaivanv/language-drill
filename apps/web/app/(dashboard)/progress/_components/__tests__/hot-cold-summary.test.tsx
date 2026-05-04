import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { HeatmapTopic } from '@language-drill/api-client';
import { HotColdSummary } from '../hot-cold-summary';

function topic(overrides: Partial<HeatmapTopic> = {}): HeatmapTopic {
  return {
    topicId: 'subjunctive',
    name: 'subjunctive',
    mastery: 0.7,
    cells: new Array(30).fill(0),
    ...overrides,
  };
}

/** Build a 30-cell array with `count` placed at the given indices. */
function cellsWith(...indices: number[]): number[] {
  const cells = new Array(30).fill(0);
  for (const i of indices) cells[i] = 1;
  return cells;
}

describe('HotColdSummary', () => {
  it('renders nothing when topics is empty', () => {
    const { container } = render(<HotColdSummary topics={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('hides the hot card when no topic has any active days in the last 14', () => {
    // Single topic with attempts only outside the 14-day window
    render(
      <HotColdSummary
        topics={[
          topic({
            topicId: 'a',
            name: 'a',
            mastery: 0.7,
            // Indices 0..15 are outside the trailing 14-day window
            cells: cellsWith(0, 5, 10, 15),
          }),
        ]}
      />,
    );
    expect(screen.queryByText('🔥 hottest')).toBeNull();
    // The topic IS untouched ≥ 7 days (index 15 is 14 days ago) and mastery 0.7 → cold qualifies
    expect(screen.getByText('❄ coldest')).toBeDefined();
  });

  it('hides the cold card when every topic has been practised within 7 days', () => {
    render(
      <HotColdSummary
        topics={[
          topic({
            topicId: 'a',
            name: 'a',
            mastery: 0.7,
            cells: cellsWith(28, 29), // touched yesterday + today
          }),
        ]}
      />,
    );
    expect(screen.getByText('🔥 hottest')).toBeDefined();
    expect(screen.queryByText('❄ coldest')).toBeNull();
  });

  it('hides the cold card when no qualifying topic clears mastery > 0.4', () => {
    render(
      <HotColdSummary
        topics={[
          topic({
            topicId: 'a',
            name: 'a',
            mastery: 0.3, // below cold threshold
            cells: cellsWith(0), // untouched 29 days
          }),
        ]}
      />,
    );
    expect(screen.queryByText('❄ coldest')).toBeNull();
  });

  it('picks the topic with the most active days in the last 14 as hottest', () => {
    render(
      <HotColdSummary
        topics={[
          topic({
            topicId: 'cold-topic',
            name: 'preterite',
            mastery: 0.5,
            cells: cellsWith(20), // 1 active day in last 14
          }),
          topic({
            topicId: 'hot-topic',
            name: 'subjunctive',
            mastery: 0.7,
            // 9 of last 14 days
            cells: cellsWith(17, 18, 20, 22, 23, 25, 26, 28, 29),
          }),
        ]}
      />,
    );
    // Hot card shows the right topic name + the "X of last 14 days" line
    expect(screen.getByText('🔥 hottest')).toBeDefined();
    expect(
      screen.getByText('9 of last 14 days · paying off'),
    ).toBeDefined();
  });

  it('picks the topic with the largest gap as coldest, formatting "untouched N days"', () => {
    render(
      <HotColdSummary
        topics={[
          topic({
            topicId: 'a',
            name: 'fresh',
            mastery: 0.7,
            cells: cellsWith(28, 29), // 0 days untouched
          }),
          topic({
            topicId: 'b',
            name: 'kinda-cold',
            mastery: 0.7,
            cells: cellsWith(15), // 14 days untouched
          }),
          topic({
            topicId: 'c',
            name: 'icy',
            mastery: 0.7,
            cells: cellsWith(5), // 24 days untouched — winner
          }),
        ]}
      />,
    );
    expect(screen.getByText('❄ coldest')).toBeDefined();
    expect(screen.getByText('icy')).toBeDefined();
    expect(screen.getByText('untouched 24 days')).toBeDefined();
  });

  it('renders "untouched 30+ days" when a qualifying topic has no attempts in the 30-day window', () => {
    render(
      <HotColdSummary
        topics={[
          topic({
            topicId: 'a',
            name: 'forgotten',
            mastery: 0.7,
            cells: new Array(30).fill(0),
          }),
        ]}
      />,
    );
    expect(screen.getByText('❄ coldest')).toBeDefined();
    expect(screen.getByText('untouched 30+ days')).toBeDefined();
  });
});
