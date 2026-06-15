import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const mockUseBrainstorm = vi.fn();
const mockUseVocabBoost = vi.fn();
vi.mock('@language-drill/api-client', () => ({
  useBrainstorm: (...a: unknown[]) => mockUseBrainstorm(...a),
  useVocabBoost: (...a: unknown[]) => mockUseVocabBoost(...a),
}));

import { FwUnstuck } from './fw-unstuck';

const idle = { data: undefined, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() };

beforeEach(() => {
  vi.clearAllMocks();
  mockUseBrainstorm.mockReturnValue(idle);
  mockUseVocabBoost.mockReturnValue(idle);
});

const fetchFn = vi.fn();

describe('FwUnstuck', () => {
  it('renders brainstorm + vocab buttons enabled, start-my-paragraph disabled', () => {
    render(<FwUnstuck exerciseId="fw-1" fetchFn={fetchFn} />);
    expect(screen.getByRole('button', { name: /brainstorm/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /vocabulary boost/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /start my paragraph/i })).toBeDisabled();
  });

  it('opening brainstorm enables the hook and renders groups', () => {
    mockUseBrainstorm.mockReturnValue({
      ...idle,
      data: { groups: [{ label: 'For', points: ['flexibility'] }] },
    });
    render(<FwUnstuck exerciseId="fw-1" fetchFn={fetchFn} />);
    fireEvent.click(screen.getByRole('button', { name: /brainstorm/i }));
    expect(screen.getByText('For')).toBeInTheDocument();
    expect(screen.getByText('flexibility')).toBeInTheDocument();
    expect(mockUseBrainstorm).toHaveBeenLastCalledWith(
      expect.objectContaining({ exerciseId: 'fw-1', enabled: true }),
    );
  });

  it('shows a loading state while fetching', () => {
    mockUseBrainstorm.mockReturnValue({ ...idle, isLoading: true, isFetching: true });
    render(<FwUnstuck exerciseId="fw-1" fetchFn={fetchFn} />);
    fireEvent.click(screen.getByRole('button', { name: /brainstorm/i }));
    expect(screen.getByText(/thinking/i)).toBeInTheDocument();
  });

  it('shows an error state with a retry that calls refetch', () => {
    const refetch = vi.fn();
    mockUseBrainstorm.mockReturnValue({ ...idle, isError: true, refetch });
    render(<FwUnstuck exerciseId="fw-1" fetchFn={fetchFn} />);
    fireEvent.click(screen.getByRole('button', { name: /brainstorm/i }));
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(refetch).toHaveBeenCalled();
  });

  it('regenerate calls refetch on the active helper', () => {
    const refetch = vi.fn();
    mockUseVocabBoost.mockReturnValue({
      ...idle,
      data: { items: [{ term: 'la flexibilidad', gloss: 'flexibility' }] },
      refetch,
    });
    render(<FwUnstuck exerciseId="fw-1" fetchFn={fetchFn} />);
    fireEvent.click(screen.getByRole('button', { name: /vocabulary boost/i }));
    expect(screen.getByText('la flexibilidad')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));
    expect(refetch).toHaveBeenCalled();
  });
});
