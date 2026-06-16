import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { FlaggedExercise } from '@language-drill/api-client';
import { FlaggedExerciseCard } from '../flagged-exercise-card';

const item: FlaggedExercise = {
  id: 'ex-1',
  language: 'ES',
  level: 'A2',
  type: 'cloze',
  grammarPointKey: 'obj-pronoun',
  contentJson: { type: 'cloze', sentence: 'Maria ___ lo dio.', correctAnswer: 'se' },
  qualityScore: 0.62,
  flaggedReasons: [{ code: 'ambiguous' }],
  generatedAt: '2026-06-01T00:00:00.000Z',
};

describe('FlaggedExerciseCard', () => {
  it('renders header, reason chip, and content', () => {
    render(<FlaggedExerciseCard item={item} onResolve={vi.fn()} pending={false} demoted={false} />);
    expect(screen.getAllByText(/cloze/)[0]).toBeInTheDocument();
    expect(screen.getByText(/obj-pronoun/)).toBeInTheDocument();
    expect(screen.getByText(/Ambiguous|ambiguous/)).toBeInTheDocument();
    expect(screen.getByText('Maria ___ lo dio.')).toBeInTheDocument();
  });

  it('calls onResolve with approve / reject', () => {
    const onResolve = vi.fn();
    render(<FlaggedExerciseCard item={item} onResolve={onResolve} pending={false} demoted={false} />);
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(onResolve).toHaveBeenCalledWith('approve');
    fireEvent.click(screen.getByRole('button', { name: /reject/i }));
    expect(onResolve).toHaveBeenCalledWith('reject');
  });

  it('shows the demote notice when demoted', () => {
    render(<FlaggedExerciseCard item={item} onResolve={vi.fn()} pending={false} demoted />);
    expect(screen.getByText(/already exists in this cell/i)).toBeInTheDocument();
  });
});
