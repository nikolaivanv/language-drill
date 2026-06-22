import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ActivitySessionListItem } from '@language-drill/api-client';

vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: vi.fn() }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));

const mockSessions = vi.fn();
const mockDetail = vi.fn();
const mockFailures = vi.fn();
const mockRoster = vi.fn();
const resolveMutate = vi.fn();

vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/api-client')>('@language-drill/api-client');
  return {
    ...actual,
    createAuthenticatedFetch: () => vi.fn(),
    useActivitySessions: (a: unknown) => mockSessions(a),
    useActivitySessionDetail: (a: unknown) => mockDetail(a),
    useActivityFailures: (a: unknown) => mockFailures(a),
    useActivityRoster: (a: unknown) => mockRoster(a),
    useResolveContentExercise: () => ({ mutate: resolveMutate, isPending: false }),
  };
});

import ActivityPage from '../page';

const feed: ActivitySessionListItem[] = [
  { sessionId: 's-flag', userId: 'user_aaaaaaaa', firstName: 'Ada', lastName: 'Lovelace', email: 'ada@x.com',
    language: 'ES', difficulty: 'B1', exerciseCount: 5, correctCount: 4,
    completedAt: '2026-06-22T11:00:00Z', startedAt: '2026-06-22T10:55:00Z', signals: ['flagged'] },
];

const failRows = [{
  exerciseId: 'e1', language: 'TR', difficulty: 'A2', type: 'cloze', grammarPointKey: 'tr-a2-x',
  attempts: 10, distinctUsers: 6, failRate: 0.7, avgScore: 0.31, qualityScore: 0.8, openFlags: 1,
}];

const rosterRows = [{
  userId: 'user_bbbbbbbb', lastActiveAt: '2026-06-22T10:00:00Z', sessions7d: 3, sessions30d: 9,
  drills7d: 20, drills30d: 75, languages: ['TR'], avgScore30d: 0.62, aiEvents7d: 21,
}];

beforeEach(() => {
  mockSessions.mockReturnValue({ isLoading: false, isError: false, data: { items: feed, total: 1 } });
  mockDetail.mockReturnValue({ isLoading: false, isError: false, data: undefined });
  mockFailures.mockReturnValue({ isLoading: false, isError: false, data: failRows });
  mockRoster.mockReturnValue({ isLoading: false, isError: false, data: rosterRows });
});

describe('ActivityPage — Sessions tab', () => {
  it('renders a row with the user name, score, and risk badge', () => {
    render(<ActivityPage />);
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText(/4\s*\/\s*5/)).toBeInTheDocument();
    expect(screen.getAllByText(/flagged/i).length).toBeGreaterThan(0);
  });

  it('toggling a risk chip re-queries with risk', () => {
    render(<ActivityPage />);
    fireEvent.click(screen.getByRole('button', { name: /^abandoned$/i }));
    expect(mockSessions).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ risk: ['abandoned'] }) }),
    );
  });

  it('expands the session detail inline on row click', () => {
    render(<ActivityPage />);
    fireEvent.click(screen.getByRole('button', { name: /Ada Lovelace/i }));
    expect(mockDetail).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's-flag' }));
  });
});

describe('ActivityPage — Failures tab', () => {
  it('shows failure rows with distinct-user count and a demote action', () => {
    render(<ActivityPage />);
    fireEvent.click(screen.getByRole('button', { name: 'failures' }));
    expect(screen.getByText(/tr-a2-x/)).toBeInTheDocument();
    expect(screen.getByText(/6 users/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /demote/i }));
    expect(resolveMutate).toHaveBeenCalledWith(expect.objectContaining({ id: 'e1', action: 'demote' }));
  });

  it('changing the language select calls the hook with the chosen language', () => {
    render(<ActivityPage />);
    fireEvent.click(screen.getByRole('button', { name: 'failures' }));
    fireEvent.change(screen.getByRole('combobox', { name: /language/i }), {
      target: { value: 'TR' },
    });
    expect(mockFailures).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ language: 'TR' }) }),
    );
  });
});

describe('ActivityPage — Roster tab', () => {
  it('lists users with drill counts', () => {
    render(<ActivityPage />);
    fireEvent.click(screen.getByRole('button', { name: 'roster' }));
    expect(screen.getByText(/user_bbbb/i)).toBeInTheDocument();
    expect(screen.getByText('75')).toBeInTheDocument();
  });
});
