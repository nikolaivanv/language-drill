import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: vi.fn() }) }));

const mockUseCapacity = vi.fn();
vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/api-client')>('@language-drill/api-client');
  return { ...actual, createAuthenticatedFetch: () => vi.fn(), useCapacity: (args: unknown) => mockUseCapacity(args) };
});

import CapacityPage from '../page';

beforeEach(() => {
  mockUseCapacity.mockReset();
});

describe('CapacityPage', () => {
  it('renders kill-switch on, cap, usage total/percent, and the breakdown + consumers', () => {
    mockUseCapacity.mockReturnValue({
      isLoading: false,
      isError: false,
      data: {
        killSwitch: true,
        globalDailyCap: 5000,
        usage24h: { total: 992, byEventType: [{ eventType: 'ai_evaluation', count: 612 }] },
        topConsumers: [{ userId: 'u1', count: 210 }],
      },
    });
    render(<CapacityPage />);
    expect(screen.getByText('On')).toBeInTheDocument();
    expect(screen.getByText(/992 \/ 5000/)).toBeInTheDocument();
    expect(screen.getByText(/20%/)).toBeInTheDocument(); // 992/5000 ≈ 20%
    expect(screen.getByText('ai_evaluation')).toBeInTheDocument();
    expect(screen.getByText('u1')).toBeInTheDocument();
  });

  it('renders "no cap" and an off kill-switch', () => {
    mockUseCapacity.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { killSwitch: false, globalDailyCap: null, usage24h: { total: 0, byEventType: [] }, topConsumers: [] },
    });
    render(<CapacityPage />);
    expect(screen.getAllByText(/no cap/i).length).toBeGreaterThan(0);
    expect(screen.getByText('Off')).toBeInTheDocument();
  });

  it('shows the empty states for breakdown and consumers', () => {
    mockUseCapacity.mockReturnValue({
      isLoading: false,
      isError: false,
      data: { killSwitch: false, globalDailyCap: null, usage24h: { total: 0, byEventType: [] }, topConsumers: [] },
    });
    render(<CapacityPage />);
    expect(screen.getByText(/no usage in the last 24h/i)).toBeInTheDocument();
    expect(screen.getByText(/no consumers in the last 24h/i)).toBeInTheDocument();
  });

  it('shows the loading state', () => {
    mockUseCapacity.mockReturnValue({ isLoading: true, isError: false, data: undefined });
    render(<CapacityPage />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows the error state', () => {
    mockUseCapacity.mockReturnValue({ isLoading: false, isError: true, data: undefined });
    render(<CapacityPage />);
    expect(screen.getByText(/failed to load capacity/i)).toBeInTheDocument();
  });
});
