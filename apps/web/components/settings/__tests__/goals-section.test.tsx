import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { PreferencesResponse } from '@language-drill/api-client';
import { Language } from '@language-drill/shared';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockGetToken = vi.fn().mockResolvedValue('test-token');
vi.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ getToken: mockGetToken }),
}));

const mockUseGetPreferences = vi.fn();
const mockUseUpdatePreferences = vi.fn();

vi.mock('@language-drill/api-client', () => ({
  useGetPreferences: (...args: unknown[]) => mockUseGetPreferences(...args),
  useUpdatePreferences: (...args: unknown[]) => mockUseUpdatePreferences(...args),
  createAuthenticatedFetch: vi.fn(() => vi.fn()),
}));

// Static import must come after vi.mock declarations (hoisting handles order)
import { GoalsSection } from '../goals-section';

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

function renderGoals(
  prefs: PreferencesResponse,
  mutate: ReturnType<typeof vi.fn> = vi.fn(),
) {
  mockUseGetPreferences.mockReturnValue({
    data: prefs,
    isLoading: false,
    error: null,
  });
  mockUseUpdatePreferences.mockReturnValue({ mutate });

  return render(<GoalsSection />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockUseGetPreferences.mockReset();
  mockUseUpdatePreferences.mockReset();
});

describe('GoalsSection', () => {
  it('autosaves the chosen daily target', () => {
    const mutate = vi.fn();
    renderGoals({ goals: ['grammar'], dailyMinutes: 10, dailyGoal: 'medium', gentleNudges: true, notes: '', primaryLanguage: Language.ES }, mutate);
    fireEvent.click(screen.getByRole('radio', { name: /long/i }));
    expect(mutate).toHaveBeenCalledWith({ dailyGoal: 'long' });
  });

  it('toggling a reason autosaves the new goals array', () => {
    const mutate = vi.fn();
    renderGoals({ goals: ['grammar'], dailyMinutes: 10, dailyGoal: 'medium', gentleNudges: true, notes: '', primaryLanguage: Language.ES }, mutate);
    fireEvent.click(screen.getByRole('checkbox', { name: /vocabulary/i }));
    expect(mutate).toHaveBeenCalledWith({ goals: ['grammar', 'vocab'] });
  });

  it('toggling gentle nudges autosaves', () => {
    const mutate = vi.fn();
    renderGoals({ goals: [], dailyMinutes: 10, dailyGoal: 'quick', gentleNudges: true, notes: '', primaryLanguage: Language.ES }, mutate);
    fireEvent.click(screen.getByRole('switch', { name: /gentle nudges/i }));
    expect(mutate).toHaveBeenCalledWith({ gentleNudges: false });
  });
});
