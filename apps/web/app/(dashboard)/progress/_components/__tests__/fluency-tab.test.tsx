import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Language } from '@language-drill/shared';
import type { FluencyStatsResponse } from '@language-drill/api-client';
import { FluencyTab } from '../fluency-tab';

const stats: FluencyStatsResponse = {
  language: Language.ES,
  totalAttempts: 12,
  overallAccuracy: 0.92,
  overallMedianLatencyMs: 2400,
  weeks: [
    { weeksAgo: 1, attempts: 5, medianLatencyMs: 3000, accuracy: 0.8 },
    { weeksAgo: 0, attempts: 7, medianLatencyMs: 2400, accuracy: 1 },
  ],
};

describe('FluencyTab', () => {
  it('renders the empty state when there are no attempts', () => {
    render(
      <FluencyTab
        data={{ ...stats, language: Language.ES, totalAttempts: 0, overallMedianLatencyMs: null, weeks: [] }}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText(/no fluency drills yet/i)).toBeDefined();
  });

  it('renders the median latency headline when data exists', () => {
    render(<FluencyTab data={stats} isLoading={false} error={null} onRetry={vi.fn()} />);
    // 2400ms → 2.4s appears in both the headline and the weekly bar chart
    expect(screen.getAllByText(/2\.4s/).length).toBeGreaterThan(0);
    expect(screen.getByText(/12/)).toBeDefined(); // total attempts
  });
});
