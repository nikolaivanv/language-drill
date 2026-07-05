import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMutateAsync = vi.fn();
const mockUseExplainSubmission = vi.fn((_args?: unknown) => ({
  mutateAsync: mockMutateAsync,
  isPending: false,
  isError: false,
}));
vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/api-client')>('@language-drill/api-client');
  return { ...actual, useExplainSubmission: (args: unknown) => mockUseExplainSubmission(args) };
});

import { ExplainWhy } from '../explain-why';

const fetchFn = vi.fn();

beforeEach(() => {
  mockMutateAsync.mockReset();
  mockUseExplainSubmission.mockClear();
});

describe('ExplainWhy', () => {
  it('renders the canned feedback and an Explain why button', () => {
    render(
      <ExplainWhy
        exerciseId="ex-1"
        submissionId="sub-1"
        fallbackFeedback="Correct — koydu"
        fetchFn={fetchFn}
      />,
    );
    expect(screen.getByText('Correct — koydu')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /explain why/i }),
    ).toBeInTheDocument();
  });

  it('swaps in the explanation after a successful fetch', async () => {
    mockMutateAsync.mockResolvedValue({ explanation: 'Because koy- takes -du.' });
    render(
      <ExplainWhy
        exerciseId="ex-1"
        submissionId="sub-1"
        fallbackFeedback="Correct — koydu"
        fetchFn={fetchFn}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /explain why/i }));
    await waitFor(() =>
      expect(screen.getByText('Because koy- takes -du.')).toBeInTheDocument(),
    );
    expect(mockMutateAsync).toHaveBeenCalledWith({
      exerciseId: 'ex-1',
      submissionId: 'sub-1',
    });
    expect(
      screen.queryByRole('button', { name: /explain why/i }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Correct — koydu')).not.toBeInTheDocument();
  });

  it("keeps the canned feedback and shows an error note when the call fails", async () => {
    mockMutateAsync.mockRejectedValue(new Error('boom'));
    mockUseExplainSubmission.mockReturnValue({
      mutateAsync: mockMutateAsync,
      isPending: false,
      isError: true,
    });
    render(
      <ExplainWhy
        exerciseId="ex-1"
        submissionId="sub-1"
        fallbackFeedback="Correct — koydu"
        fetchFn={fetchFn}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /explain why/i }));
    await waitFor(() =>
      expect(screen.getByText(/couldn't load/i)).toBeInTheDocument(),
    );
    expect(screen.getByText('Correct — koydu')).toBeInTheDocument();
  });
});
