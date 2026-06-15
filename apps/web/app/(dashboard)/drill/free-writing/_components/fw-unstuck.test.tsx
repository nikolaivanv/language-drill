import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const mockUseBrainstorm = vi.fn();
const mockUseVocabBoost = vi.fn();
const mockUseStartMyParagraph = vi.fn();
vi.mock('@language-drill/api-client', () => ({
  useBrainstorm: (...a: unknown[]) => mockUseBrainstorm(...a),
  useVocabBoost: (...a: unknown[]) => mockUseVocabBoost(...a),
  useStartMyParagraph: (...a: unknown[]) => mockUseStartMyParagraph(...a),
}));

import { FwUnstuck } from './fw-unstuck';

const idle = { data: undefined, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() };

function startIdle(over: Record<string, unknown> = {}) {
  return { mutateAsync: vi.fn().mockResolvedValue({ opener: 'Opener.' }), isPending: false, isError: false, reset: vi.fn(), ...over };
}

const fetchFn = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockUseBrainstorm.mockReturnValue(idle);
  mockUseVocabBoost.mockReturnValue(idle);
  mockUseStartMyParagraph.mockReturnValue(startIdle());
});

// Stateful harness: the composer owns value/onChange in production, so we mimic
// it here to observe inserts/regenerates/removes.
function Harness({ initial = 'my draft' }: { initial?: string }) {
  const [v, setV] = React.useState(initial);
  return (
    <>
      <div data-testid="val">{v}</div>
      <FwUnstuck exerciseId="fw-1" fetchFn={fetchFn} value={v} onChange={setV} />
    </>
  );
}

describe('FwUnstuck', () => {
  it('renders all three helper buttons enabled', () => {
    render(<FwUnstuck exerciseId="fw-1" fetchFn={fetchFn} value="" onChange={() => {}} />);
    expect(screen.getByRole('button', { name: /brainstorm/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /vocabulary boost/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /start my paragraph/i })).toBeEnabled();
  });

  it('reworded hint copy replaces the old penalty wording', () => {
    render(<FwUnstuck exerciseId="fw-1" fetchFn={fetchFn} value="" onChange={() => {}} />);
    expect(screen.getByText(/ideas and words are yours to shape/i)).toBeInTheDocument();
    expect(screen.queryByText(/counts less toward your score/i)).not.toBeInTheDocument();
  });

  it('clicking start my paragraph prepends the opener', async () => {
    mockUseStartMyParagraph.mockReturnValue(startIdle({ mutateAsync: vi.fn().mockResolvedValue({ opener: 'AAA' }) }));
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /start my paragraph/i }));
    await waitFor(() => expect(screen.getByTestId('val').textContent).toBe('AAA\n\nmy draft'));
    expect(screen.getByText(/opener added/i)).toBeInTheDocument();
  });

  it('regenerate replaces the opener rather than appending', async () => {
    const mutateAsync = vi.fn().mockResolvedValueOnce({ opener: 'AAA' }).mockResolvedValueOnce({ opener: 'BBB' });
    mockUseStartMyParagraph.mockReturnValue(startIdle({ mutateAsync }));
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /start my paragraph/i }));
    await waitFor(() => expect(screen.getByTestId('val').textContent).toBe('AAA\n\nmy draft'));
    fireEvent.click(screen.getByRole('button', { name: /regenerate/i }));
    await waitFor(() => expect(screen.getByTestId('val').textContent).toBe('BBB\n\nmy draft'));
    expect(screen.getByTestId('val').textContent).not.toMatch(/AAA/);
  });

  it('remove strips the opener and clears the chip', async () => {
    mockUseStartMyParagraph.mockReturnValue(startIdle({ mutateAsync: vi.fn().mockResolvedValue({ opener: 'AAA' }) }));
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /start my paragraph/i }));
    await waitFor(() => expect(screen.getByText(/opener added/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /remove/i }));
    await waitFor(() => expect(screen.getByTestId('val').textContent).toBe('my draft'));
    expect(screen.queryByText(/opener added/i)).not.toBeInTheDocument();
  });

  it('an empty opener result shows the error state and inserts nothing', async () => {
    mockUseStartMyParagraph.mockReturnValue(startIdle({ mutateAsync: vi.fn().mockResolvedValue({ opener: '' }) }));
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: /start my paragraph/i }));
    await waitFor(() => expect(screen.getByText(/couldn't add an opener/i)).toBeInTheDocument());
    expect(screen.getByTestId('val').textContent).toBe('my draft');
  });

  it('shows a thinking state and disables the button while pending', () => {
    mockUseStartMyParagraph.mockReturnValue(startIdle({ isPending: true }));
    render(<FwUnstuck exerciseId="fw-1" fetchFn={fetchFn} value="" onChange={() => {}} />);
    expect(screen.getByText(/thinking/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /start my paragraph/i })).toBeDisabled();
  });

  it('shows an error state with a retry that re-runs the mutation', async () => {
    const mutateAsync = vi.fn().mockResolvedValue({ opener: 'AAA' });
    mockUseStartMyParagraph.mockReturnValue(startIdle({ isError: true, mutateAsync }));
    render(<FwUnstuck exerciseId="fw-1" fetchFn={fetchFn} value="" onChange={() => {}} />);
    expect(screen.getByText(/couldn't add an opener/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    await waitFor(() => expect(mutateAsync).toHaveBeenCalled());
  });

  // The brainstorm/vocab panel still works alongside the new chip.
  it('opening brainstorm still renders groups', () => {
    mockUseBrainstorm.mockReturnValue({ ...idle, data: { groups: [{ label: 'For', points: ['flexibility'] }] } });
    render(<FwUnstuck exerciseId="fw-1" fetchFn={fetchFn} value="" onChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /brainstorm/i }));
    expect(screen.getByText('For')).toBeInTheDocument();
    expect(screen.getByText('flexibility')).toBeInTheDocument();
  });
});
