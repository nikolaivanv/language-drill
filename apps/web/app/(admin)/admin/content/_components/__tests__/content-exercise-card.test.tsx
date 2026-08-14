import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { ContentExercise } from '@language-drill/api-client';
import { ContentExerciseCard } from '../content-exercise-card';

const item: ContentExercise = {
  id: 'ex-1', language: 'ES', level: 'A2', type: 'cloze', grammarPointKey: 'obj-pronoun',
  contentJson: { type: 'cloze', sentence: 'Maria ___ lo dio.', correctAnswer: 'se' },
  coverageTags: { person: '3sg' }, qualityScore: 0.91, generationSource: 'claude-batch',
  modelId: 'claude-sonnet-4-6', reviewStatus: 'auto-approved', generatedAt: '2026-06-01T00:00:00.000Z',
};

describe('ContentExerciseCard', () => {
  it('renders header metadata and content', () => {
    render(<ContentExerciseCard item={item} onResolve={vi.fn()} pending={false} demoted={false} />);
    expect(screen.getAllByText(/cloze/)[0]).toBeInTheDocument();
    expect(screen.getByText(/obj-pronoun/)).toBeInTheDocument();
    expect(screen.getByText(/claude-batch/)).toBeInTheDocument();
    expect(screen.getByText('Maria ___ lo dio.')).toBeInTheDocument();
  });
  it('calls onResolve with demote / reject', () => {
    const onResolve = vi.fn();
    render(<ContentExerciseCard item={item} onResolve={onResolve} pending={false} demoted={false} />);
    fireEvent.click(screen.getByRole('button', { name: /demote/i }));
    expect(onResolve).toHaveBeenCalledWith('demote');
    fireEvent.click(screen.getByRole('button', { name: /reject/i }));
    expect(onResolve).toHaveBeenCalledWith('reject');
  });
  it('shows the demote notice when demoted', () => {
    render(<ContentExerciseCard item={item} onResolve={vi.fn()} pending={false} demoted />);
    expect(screen.getByText(/sent back to the review queue/i)).toBeInTheDocument();
  });
  it('disables both buttons when pending', () => {
    render(<ContentExerciseCard item={item} onResolve={vi.fn()} pending demoted={false} />);
    expect(screen.getByRole('button', { name: /demote/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /reject/i })).toBeDisabled();
  });

  it('renders each coverage tag as its own chip', () => {
    render(
      <ContentExerciseCard
        item={{ ...item, coverageTags: { person: '1sg', polarity: 'negative' } }}
        onResolve={vi.fn()} pending={false} demoted={false}
      />,
    );
    expect(screen.getByText('person: 1sg')).toBeInTheDocument();
    expect(screen.getByText('polarity: negative')).toBeInTheDocument();
  });

  it('labels a declared variant id as a variant, not a seed word', () => {
    render(
      <ContentExerciseCard
        item={{
          ...item,
          grammarPointKey: 'es-b1-impersonal-plural',
          contentJson: { ...(item.contentJson as Record<string, unknown>), seedWord: 'hearsay' },
          coverageTags: null,
        }}
        isVariantSeed
        onResolve={vi.fn()} pending={false} demoted={false}
      />,
    );
    expect(screen.getByText('variant: hearsay')).toBeInTheDocument();
  });

  it('labels a frequency seed as a seed', () => {
    render(
      <ContentExerciseCard
        item={{
          ...item,
          contentJson: { ...(item.contentJson as Record<string, unknown>), seedWord: 'okul' },
          coverageTags: null,
        }}
        isVariantSeed={false}
        onResolve={vi.fn()} pending={false} demoted={false}
      />,
    );
    expect(screen.getByText('seed: okul')).toBeInTheDocument();
  });

  it('renders nothing for an unseeded, untagged exercise', () => {
    render(
      <ContentExerciseCard
        item={{
          ...item,
          coverageTags: null,
          contentJson: { ...(item.contentJson as Record<string, unknown>), seedWord: undefined },
        }}
        onResolve={vi.fn()} pending={false} demoted={false}
      />,
    );
    expect(screen.queryByText(/^seed:/)).not.toBeInTheDocument();
  });
});
