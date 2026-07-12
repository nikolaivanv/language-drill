import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@clerk/nextjs', () => ({ useAuth: () => ({ getToken: vi.fn() }) }));

const mockUseQueue = vi.fn();
const mockResolveMutate = vi.fn();
vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/api-client')>('@language-drill/api-client');
  return {
    ...actual,
    createAuthenticatedFetch: () => vi.fn(),
    useUserFlagsQueue: (args: unknown) => mockUseQueue(args),
    useResolveUserFlag: () => ({ mutate: mockResolveMutate, isPending: false }),
  };
});

import FlagsPage from '../page';

const sampleFlag = {
  id: 'f1', status: 'open', category: 'wrong_answer', note: 'reference looks wrong',
  createdAt: '2026-06-18T00:00:00.000Z', resolvedAt: null, exerciseId: 'ex1', submissionId: 'h1', sessionId: 's1',
  exercise: { language: 'ES', level: 'B1', type: 'cloze', grammarPointKey: 'es-b1-x', reviewStatus: 'auto-approved', contentJson: { type: 'cloze', prompt: 'Yo ___ feliz', answer: 'soy' } },
  userAnswer: 'estoy', evaluation: { score: 0, feedback: 'Not quite' },
};

beforeEach(() => { mockUseQueue.mockReset(); mockResolveMutate.mockReset(); });

describe('FlagsPage', () => {
  it('renders a flag card with the answer and the evaluator feedback', () => {
    mockUseQueue.mockReturnValue({ isLoading: false, isError: false, data: { items: [sampleFlag], total: 1 } });
    render(<FlagsPage />);
    expect(screen.getByText(/reference looks wrong/i)).toBeInTheDocument();
    expect(screen.getByText(/estoy/)).toBeInTheDocument();
    expect(screen.getByText(/not quite/i)).toBeInTheDocument();
  });

  it('renders copyable session, exercise, and evaluation ids', () => {
    mockUseQueue.mockReturnValue({ isLoading: false, isError: false, data: { items: [sampleFlag], total: 1 } });
    render(<FlagsPage />);
    expect(screen.getByRole('button', { name: /copy session id/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy exercise id/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy eval id/i })).toBeInTheDocument();
  });

  it('omits the session id chip when there is no session', () => {
    mockUseQueue.mockReturnValue({ isLoading: false, isError: false, data: { items: [{ ...sampleFlag, sessionId: null }], total: 1 } });
    render(<FlagsPage />);
    expect(screen.queryByRole('button', { name: /copy session id/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /copy exercise id/i })).toBeInTheDocument();
  });

  it('calls reject', () => {
    mockUseQueue.mockReturnValue({ isLoading: false, isError: false, data: { items: [sampleFlag], total: 1 } });
    render(<FlagsPage />);
    fireEvent.click(screen.getByRole('button', { name: /reject exercise/i }));
    expect(mockResolveMutate).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1', action: 'reject' }));
  });

  it('calls dismiss', () => {
    mockUseQueue.mockReturnValue({ isLoading: false, isError: false, data: { items: [sampleFlag], total: 1 } });
    render(<FlagsPage />);
    fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
    expect(mockResolveMutate).toHaveBeenCalledWith(expect.objectContaining({ id: 'f1', action: 'dismiss' }));
  });

  it('shows the empty state', () => {
    mockUseQueue.mockReturnValue({ isLoading: false, isError: false, data: { items: [], total: 0 } });
    render(<FlagsPage />);
    expect(screen.getByText(/no open flags/i)).toBeInTheDocument();
  });
});
