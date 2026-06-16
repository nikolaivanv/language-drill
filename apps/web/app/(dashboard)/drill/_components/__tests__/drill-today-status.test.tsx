import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Language } from '@language-drill/shared';

const mockUseTodayPlan = vi.fn();
vi.mock('@language-drill/api-client', () => ({
  useTodayPlan: (...args: unknown[]) => mockUseTodayPlan(...args),
  createAuthenticatedFetch: vi.fn(() => vi.fn()),
}));
vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: vi.fn() }) }));
vi.mock('../../../../../components/shell', () => ({
  useActiveLanguage: () => ({ activeLanguage: Language.ES }),
}));

import { DrillTodayStatus } from '../drill-today-status';

function setPlan(data: unknown) {
  mockUseTodayPlan.mockReturnValue({ data, isLoading: false, error: null });
}

describe('DrillTodayStatus', () => {
  it('shows the quick drill as done when today summary is present, linking to today', () => {
    setPlan({
      language: 'ES',
      generatedAt: '2026-05-04T10:00:00.000Z',
      totalEstimatedMinutes: 12,
      items: [],
      summary: { itemCount: 5, correctCount: 4, durationMinutes: 18 },
      code: null,
      freeWriting: null,
    });
    render(<DrillTodayStatus />);
    expect(screen.getByText(/today/i)).toBeInTheDocument();
    expect(screen.getByText(/done/i)).toBeInTheDocument();
    const link = screen.getByRole('link');
    expect(link).toHaveAttribute('href', '/home');
  });

  it('shows the quick drill as not finished when there is no summary', () => {
    setPlan({
      language: 'ES',
      generatedAt: '2026-05-04T10:00:00.000Z',
      totalEstimatedMinutes: 12,
      items: [],
      summary: null,
      code: null,
      freeWriting: null,
    });
    render(<DrillTodayStatus />);
    expect(screen.getByText(/not finished/i)).toBeInTheDocument();
  });

  it('renders nothing while the plan is loading', () => {
    mockUseTodayPlan.mockReturnValue({ data: undefined, isLoading: true, error: null });
    const { container } = render(<DrillTodayStatus />);
    expect(container).toBeEmptyDOMElement();
  });
});
