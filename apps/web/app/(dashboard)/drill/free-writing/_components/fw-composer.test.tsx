import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FwComposer } from './fw-composer';
import { ExerciseType, type FreeWritingContent } from '@language-drill/shared';

vi.mock('@language-drill/api-client', () => ({
  useBrainstorm: () => ({ data: undefined, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() }),
  useVocabBoost: () => ({ data: undefined, isLoading: false, isFetching: false, isError: false, refetch: vi.fn() }),
}));

const fetchFn = vi.fn();

const content: FreeWritingContent = {
  type: ExerciseType.FREE_WRITING, instructions: 'i', title: 'T', task: 'task',
  domain: 'd', register: 'formal', minWords: 5, maxWords: 10, requiredElements: [],
};

describe('FwComposer', () => {
  it('disables grading below the minimum word count', () => {
    render(<FwComposer content={content} value="" onChange={() => {}} examMode={false} submitting={false} onGrade={() => {}} exerciseId="fw-1" fetchFn={fetchFn} />);
    expect(screen.getByRole('button', { name: /grade/i })).toBeDisabled();
  });
  it('fires onGrade with enough words', () => {
    const onGrade = vi.fn();
    render(<FwComposer content={content} value="one two three four five" onChange={() => {}} examMode={false} submitting={false} onGrade={onGrade} exerciseId="fw-1" fetchFn={fetchFn} />);
    fireEvent.click(screen.getByRole('button', { name: /grade/i }));
    expect(onGrade).toHaveBeenCalled();
  });
  it('shows brainstorm + vocab helpers (not exam mode), start-my-paragraph disabled', () => {
    render(<FwComposer content={content} value="" onChange={() => {}} examMode={false} submitting={false} onGrade={() => {}} exerciseId="fw-1" fetchFn={fetchFn} />);
    expect(screen.getByRole('button', { name: /brainstorm/i })).toBeEnabled();
    expect(screen.getByRole('button', { name: /start my paragraph/i })).toBeDisabled();
  });

  it('hides the helper area in exam mode', () => {
    render(<FwComposer content={content} value="" onChange={() => {}} examMode={true} submitting={false} onGrade={() => {}} exerciseId="fw-1" fetchFn={fetchFn} />);
    expect(screen.queryByRole('button', { name: /brainstorm/i })).not.toBeInTheDocument();
  });
});
