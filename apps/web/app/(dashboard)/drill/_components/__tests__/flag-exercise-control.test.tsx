import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockMutate = vi.fn();
const mockUseFlagExercise = vi.fn((_args?: unknown) => ({ mutate: mockMutate, isPending: false, isSuccess: false, isError: false }));
vi.mock('@language-drill/api-client', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/api-client')>('@language-drill/api-client');
  return { ...actual, useFlagExercise: (args: unknown) => mockUseFlagExercise(args) };
});

import { FlagExerciseControl } from '../flag-exercise-control';

const fetchFn = vi.fn();

beforeEach(() => {
  mockMutate.mockReset();
  mockUseFlagExercise.mockClear();
});

describe('FlagExerciseControl', () => {
  it('opens the dialog and submits a category + note', () => {
    render(<FlagExerciseControl exerciseId="ex1" submissionId="sub1" fetchFn={fetchFn} />);
    fireEvent.click(screen.getByRole('button', { name: /flag this exercise/i }));
    fireEvent.click(screen.getByLabelText(/answer is wrong/i));
    fireEvent.change(screen.getByLabelText(/note/i), { target: { value: 'the reference is wrong' } });
    fireEvent.click(screen.getByRole('button', { name: /submit flag/i }));
    expect(mockMutate).toHaveBeenCalledWith(
      expect.objectContaining({ exerciseId: 'ex1', submissionId: 'sub1', category: 'wrong_answer', note: 'the reference is wrong' }),
      expect.anything(),
    );
  });

  it('shows a confirmation after a successful flag', () => {
    mockUseFlagExercise.mockReturnValueOnce({ mutate: mockMutate, isPending: false, isSuccess: true, isError: false });
    render(<FlagExerciseControl exerciseId="ex1" submissionId="sub1" fetchFn={fetchFn} />);
    expect(screen.getByText(/flagged for review/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /flag this exercise/i })).not.toBeInTheDocument();
  });
});
