import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { EmailPreferences } from '@language-drill/api-client';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetToken = vi.fn().mockResolvedValue('test-token');
vi.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ getToken: mockGetToken }),
}));

const mockUseEmailPreferences = vi.fn();
const mockUseUpdateWeeklySummary = vi.fn();

vi.mock('@language-drill/api-client', () => ({
  useEmailPreferences: (...args: unknown[]) => mockUseEmailPreferences(...args),
  useUpdateWeeklySummary: (...args: unknown[]) => mockUseUpdateWeeklySummary(...args),
  createAuthenticatedFetch: vi.fn(() => vi.fn()),
}));

// Static import after vi.mock (hoisting handles order)
import { EmailSection } from '../email-section';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function renderEmail(
  prefs: EmailPreferences,
  mutate: ReturnType<typeof vi.fn> = vi.fn(),
) {
  mockUseEmailPreferences.mockReturnValue({
    data: prefs,
    isLoading: false,
    error: null,
  });
  mockUseUpdateWeeklySummary.mockReturnValue({ mutate, isPending: false });

  return render(<EmailSection />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockUseEmailPreferences.mockReset();
  mockUseUpdateWeeklySummary.mockReset();
});

describe('EmailSection', () => {
  it('shows switch unchecked when status is off', () => {
    renderEmail({ weeklySummary: 'off' });
    const sw = screen.getByRole('switch', { name: /weekly summary/i });
    expect(sw).toHaveAttribute('aria-checked', 'false');
  });

  it('shows switch checked when status is pending', () => {
    renderEmail({ weeklySummary: 'pending' });
    const sw = screen.getByRole('switch', { name: /weekly summary/i });
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it('shows switch checked when status is confirmed', () => {
    renderEmail({ weeklySummary: 'confirmed' });
    const sw = screen.getByRole('switch', { name: /weekly summary/i });
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it('shows pending hint when status is pending', () => {
    renderEmail({ weeklySummary: 'pending' });
    expect(screen.getByText(/check your inbox to confirm/i)).toBeInTheDocument();
  });

  it('shows recap hint when status is off or confirmed', () => {
    renderEmail({ weeklySummary: 'off' });
    expect(screen.getByText(/a short recap of your week/i)).toBeInTheDocument();
  });

  it('calls mutate with enabled:true when toggling on', () => {
    const mutate = vi.fn();
    renderEmail({ weeklySummary: 'off' }, mutate);
    fireEvent.click(screen.getByRole('switch', { name: /weekly summary/i }));
    expect(mutate).toHaveBeenCalledWith({ enabled: true });
  });

  it('calls mutate with enabled:false when toggling off', () => {
    const mutate = vi.fn();
    renderEmail({ weeklySummary: 'confirmed' }, mutate);
    fireEvent.click(screen.getByRole('switch', { name: /weekly summary/i }));
    expect(mutate).toHaveBeenCalledWith({ enabled: false });
  });

  it('does not call mutate while loading', () => {
    const mutate = vi.fn();
    mockUseEmailPreferences.mockReturnValue({ data: { weeklySummary: 'off' }, isLoading: true });
    mockUseUpdateWeeklySummary.mockReturnValue({ mutate, isPending: false });
    render(<EmailSection />);
    fireEvent.click(screen.getByRole('switch', { name: /weekly summary/i }));
    expect(mutate).not.toHaveBeenCalled();
  });

  it('does not call mutate while mutation is pending', () => {
    const mutate = vi.fn();
    mockUseEmailPreferences.mockReturnValue({ data: { weeklySummary: 'off' }, isLoading: false });
    mockUseUpdateWeeklySummary.mockReturnValue({ mutate, isPending: true });
    render(<EmailSection />);
    fireEvent.click(screen.getByRole('switch', { name: /weekly summary/i }));
    expect(mutate).not.toHaveBeenCalled();
  });
});
