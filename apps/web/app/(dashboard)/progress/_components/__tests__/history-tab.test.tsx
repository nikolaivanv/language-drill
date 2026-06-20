import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { ErrorTrendTheme, ErrorTrendsResponse } from '@language-drill/api-client';
import { HistoryTab } from '../history-tab';

const theme = (over: Partial<ErrorTrendTheme> = {}): ErrorTrendTheme => ({
  grammarPointKey: 'tr-a1-locative', grammarPointName: 'Locative case', errorType: 'grammar',
  sample: { wrongText: 'pazarda', correction: 'pazara' },
  firstSeen: '2026-05-20T00:00:00.000Z', lastSeen: '2026-06-18T00:00:00.000Z',
  totalErrors: 6, weeklyErrors: [0, 1, 2, 1, 1, 0, 1, 0],
  status: 'recurring', lastSeenDaysAgo: 2, fromRatePct: null, toRatePct: null, quietWeeks: null,
  ...over,
});
const resp = (themes: ErrorTrendTheme[]): ErrorTrendsResponse => ({ themes });
const noop = () => {};

describe('HistoryTab', () => {
  it('renders a recurring theme with the slip and status', () => {
    render(<HistoryTab data={resp([theme()])} isLoading={false} error={null} onRetry={noop} />);
    expect(screen.getByText('Locative case')).toBeInTheDocument();
    expect(screen.getByText(/pazarda/)).toBeInTheDocument();
    expect(screen.getByText(/pazara/)).toBeInTheDocument();
    expect(screen.getByText(/still recurring/i)).toBeInTheDocument();
  });

  it('renders the improving status with the rate delta', () => {
    render(<HistoryTab data={resp([theme({ status: 'improving', fromRatePct: 60, toRatePct: 12 })])} isLoading={false} error={null} onRetry={noop} />);
    expect(screen.getByText(/improving/i)).toBeInTheDocument();
    expect(screen.getByText(/60%/)).toBeInTheDocument();
    expect(screen.getByText(/12%/)).toBeInTheDocument();
  });

  it('renders the quiet status with pluralized weeks', () => {
    render(<HistoryTab data={resp([theme({ status: 'quiet', quietWeeks: 3 })])} isLoading={false} error={null} onRetry={noop} />);
    expect(screen.getByText(/quiet · no slips in 3 weeks/i)).toBeInTheDocument();
  });

  it('uses the singular "week" for a 1-week quiet streak', () => {
    render(<HistoryTab data={resp([theme({ status: 'quiet', quietWeeks: 1 })])} isLoading={false} error={null} onRetry={noop} />);
    expect(screen.getByText(/no slips in 1 week\b/i)).toBeInTheDocument();
  });

  it('shows an empty state when there are no themes', () => {
    render(<HistoryTab data={resp([])} isLoading={false} error={null} onRetry={noop} />);
    expect(screen.getByText(/no recurring errors/i)).toBeInTheDocument();
  });
});
