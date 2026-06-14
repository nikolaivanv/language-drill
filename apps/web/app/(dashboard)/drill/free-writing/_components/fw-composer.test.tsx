import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { FwComposer } from './fw-composer';
import { ExerciseType, type FreeWritingContent } from '@language-drill/shared';

const content: FreeWritingContent = {
  type: ExerciseType.FREE_WRITING, instructions: 'i', title: 'T', task: 'task',
  domain: 'd', register: 'formal', minWords: 5, maxWords: 10, requiredElements: [],
};

describe('FwComposer', () => {
  it('disables grading below the minimum word count', () => {
    render(<FwComposer content={content} value="" onChange={() => {}} examMode={false} submitting={false} onGrade={() => {}} />);
    expect(screen.getByRole('button', { name: /grade/i })).toBeDisabled();
  });
  it('fires onGrade with enough words', () => {
    const onGrade = vi.fn();
    render(<FwComposer content={content} value="one two three four five" onChange={() => {}} examMode={false} submitting={false} onGrade={onGrade} />);
    fireEvent.click(screen.getByRole('button', { name: /grade/i }));
    expect(onGrade).toHaveBeenCalled();
  });
  it('renders helper buttons disabled', () => {
    render(<FwComposer content={content} value="" onChange={() => {}} examMode={false} submitting={false} onGrade={() => {}} />);
    expect(screen.getByRole('button', { name: /brainstorm/i })).toBeDisabled();
  });
});
