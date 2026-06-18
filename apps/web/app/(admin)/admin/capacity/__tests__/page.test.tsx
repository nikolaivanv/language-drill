import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: vi.fn() }) }));

const mockUseCapacity = vi.fn();
const mockUseGenerationStats = vi.fn();
vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/api-client')>('@language-drill/api-client');
  return {
    ...actual,
    createAuthenticatedFetch: () => vi.fn(),
    useCapacity: (args: unknown) => mockUseCapacity(args),
    useGenerationStats: (args: unknown) => mockUseGenerationStats(args),
  };
});

import CapacityPage from '../page';

const genStatsData = {
  costThisWeekUsd: 53.2479,
  costThisMonthUsd: 108.7432,
  jobsThisWeek: { succeeded: 297, failed: 12, running: 0, queued: 0 },
  approvalRates: [],
};
const emptyCapacity = {
  isLoading: false, isError: false,
  data: { killSwitch: false, globalDailyCap: null, usage24h: { total: 0, byEventType: [] }, topConsumers: [] },
};

beforeEach(() => {
  mockUseCapacity.mockReset();
  mockUseGenerationStats.mockReset();
  mockUseGenerationStats.mockReturnValue({ isLoading: false, isError: false, data: genStatsData });
});

describe('UsageCostPage', () => {
  it('renders the cost & generation block (spend + job counts)', () => {
    mockUseCapacity.mockReturnValue(emptyCapacity);
    render(<CapacityPage />);
    expect(screen.getByText('$53.25')).toBeInTheDocument();
    expect(screen.getByText('$108.74')).toBeInTheDocument();
    expect(screen.getByText(/✓ 297/)).toBeInTheDocument();
    expect(screen.getByText(/✗ 12/)).toBeInTheDocument();
  });

  it('renders kill-switch on, cap, usage total/percent, and the breakdown + consumers', () => {
    mockUseCapacity.mockReturnValue({
      isLoading: false, isError: false,
      data: {
        killSwitch: true, globalDailyCap: 5000,
        usage24h: { total: 992, byEventType: [{ eventType: 'ai_evaluation', count: 612 }] },
        topConsumers: [{ userId: 'u1', count: 210 }],
      },
    });
    render(<CapacityPage />);
    expect(screen.getByText('On')).toBeInTheDocument();
    expect(screen.getByText(/992 \/ 5000/)).toBeInTheDocument();
    expect(screen.getByText(/20%/)).toBeInTheDocument();
    expect(screen.getByText('ai_evaluation')).toBeInTheDocument();
    expect(screen.getByText('u1')).toBeInTheDocument();
  });

  it('renders "no cap" and an off kill-switch', () => {
    mockUseCapacity.mockReturnValue(emptyCapacity);
    render(<CapacityPage />);
    expect(screen.getAllByText(/no cap/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Off')).toBeInTheDocument();
  });

  it('shows the empty states for breakdown and consumers', () => {
    mockUseCapacity.mockReturnValue(emptyCapacity);
    render(<CapacityPage />);
    expect(screen.getByText(/no usage in the last 24h/i)).toBeInTheDocument();
    expect(screen.getByText(/no consumers in the last 24h/i)).toBeInTheDocument();
  });

  it('shows the capacity loading state', () => {
    mockUseCapacity.mockReturnValue({ isLoading: true, isError: false, data: undefined });
    render(<CapacityPage />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows the capacity error state', () => {
    mockUseCapacity.mockReturnValue({ isLoading: false, isError: true, data: undefined });
    render(<CapacityPage />);
    expect(screen.getByText(/failed to load capacity/i)).toBeInTheDocument();
  });

  it('shows a cost-block error without breaking the capacity blocks', () => {
    mockUseGenerationStats.mockReturnValue({ isLoading: false, isError: true, data: undefined });
    mockUseCapacity.mockReturnValue(emptyCapacity);
    render(<CapacityPage />);
    expect(screen.getByText(/failed to load generation stats/i)).toBeInTheDocument();
    expect(screen.getByText('Off')).toBeInTheDocument();
  });
});
