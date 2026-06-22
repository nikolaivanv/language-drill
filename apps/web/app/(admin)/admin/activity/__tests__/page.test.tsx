import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ActivitySessionListItem } from '@language-drill/api-client';

vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: vi.fn() }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));

const mockSessions = vi.fn();
const mockDetail = vi.fn();

vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/api-client')>('@language-drill/api-client');
  return {
    ...actual,
    createAuthenticatedFetch: () => vi.fn(),
    useActivitySessions: (a: unknown) => mockSessions(a),
    useActivitySessionDetail: (a: unknown) => mockDetail(a),
  };
});

import ActivityPage from '../page';

const feed: ActivitySessionListItem[] = [
  { sessionId: 's-flag', userId: 'user_aaaaaaaa', language: 'ES', difficulty: 'B1',
    exerciseCount: 5, correctCount: 4, completedAt: '2026-06-22T11:00:00Z',
    startedAt: '2026-06-22T10:55:00Z', signals: ['flagged'], primarySignal: 'flagged' },
];

beforeEach(() => {
  mockSessions.mockReturnValue({ isLoading: false, isError: false, data: feed });
  mockDetail.mockReturnValue({ isLoading: false, isError: false, data: undefined });
});

describe('ActivityPage — Sessions tab', () => {
  it('renders the feed with a problem badge', () => {
    render(<ActivityPage />);
    expect(screen.getByRole('heading', { name: 'Activity' })).toBeInTheDocument();
    expect(screen.getByText(/flagged/i)).toBeInTheDocument();
    expect(screen.getByText(/4\s*\/\s*5/)).toBeInTheDocument();
  });

  it('selects a session on row click and requests its detail', () => {
    render(<ActivityPage />);
    fireEvent.click(screen.getByRole('button', { name: /s-flag/i }));
    // Detail hook called with the clicked sessionId
    expect(mockDetail).toHaveBeenCalledWith(expect.objectContaining({ sessionId: 's-flag' }));
  });
});
