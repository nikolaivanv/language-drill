import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
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
  afterEach(() => vi.unstubAllEnvs());

  it('renders a Langfuse traces link for a complete item when configured', () => {
    vi.stubEnv('NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE', 'https://lf/traces?q={cellKey}');
    render(<FlaggedExerciseCard item={item} onResolve={vi.fn()} pending={false} demoted={false} />);
    expect(screen.getByRole('link', { name: /traces in langfuse/i }))
      .toHaveAttribute('href', 'https://lf/traces?q=es%3Aa2%3Acloze%3Aobj-pronoun');
  });

  it('omits the Langfuse link when grammarPointKey is missing', () => {
    vi.stubEnv('NEXT_PUBLIC_LANGFUSE_TRACE_URL_TEMPLATE', 'https://lf/traces?q={cellKey}');
    render(<FlaggedExerciseCard item={{ ...item, grammarPointKey: null }} onResolve={vi.fn()} pending={false} demoted={false} />);
    expect(screen.queryByRole('link', { name: /traces in langfuse/i })).not.toBeInTheDocument();
  });

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

  it('disables both buttons when pending is true', () => {
    render(<FlaggedExerciseCard item={item} onResolve={vi.fn()} pending={true} demoted={false} />);
    expect(screen.getByRole('button', { name: /approve/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /reject/i })).toBeDisabled();
  });
});
