import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { ContentTheory } from '@language-drill/api-client';
import { ContentTheoryCard } from '../content-theory-card';

const item: ContentTheory = {
  id: 'th-1', language: 'DE', level: 'B1', grammarPointKey: 'dative', topicId: 'de-b1-dative',
  contentJson: { not: 'a valid theory topic' }, qualityScore: 0.8, generationSource: 'claude-batch',
  modelId: 'claude-sonnet-4-6', reviewStatus: 'manual-approved', generatedAt: '2026-06-02T00:00:00.000Z',
};

describe('ContentTheoryCard', () => {
  it('renders header metadata', () => {
    render(<ContentTheoryCard item={item} onResolve={vi.fn()} pending={false} demoted={false} />);
    expect(screen.getByText('theory')).toBeInTheDocument();
    expect(screen.getByText(/DE/)).toBeInTheDocument();
    expect(screen.getByText(/B1/)).toBeInTheDocument();
    expect(screen.getByText(/dative/)).toBeInTheDocument();
    expect(screen.getByText(/claude-batch/)).toBeInTheDocument();
  });

  it('renders raw JSON fallback for malformed contentJson', () => {
    render(<ContentTheoryCard item={item} onResolve={vi.fn()} pending={false} demoted={false} />);
    // The try/catch in TheoryBody falls back to a <pre> with JSON.stringify output
    const pre = document.querySelector('pre');
    expect(pre).toBeInTheDocument();
    expect(pre!.textContent).toContain('not');
    expect(pre!.textContent).toContain('a valid theory topic');
  });

  it('shows demote notice when demoted', () => {
    render(<ContentTheoryCard item={item} onResolve={vi.fn()} pending={false} demoted />);
    expect(screen.getByText(/sent back to the review queue/i)).toBeInTheDocument();
  });

  it('calls onResolve with demote / reject', () => {
    const onResolve = vi.fn();
    render(<ContentTheoryCard item={item} onResolve={onResolve} pending={false} demoted={false} />);
    fireEvent.click(screen.getByRole('button', { name: /demote/i }));
    expect(onResolve).toHaveBeenCalledWith('demote');
    fireEvent.click(screen.getByRole('button', { name: /reject/i }));
    expect(onResolve).toHaveBeenCalledWith('reject');
  });

  it('disables both buttons when pending', () => {
    render(<ContentTheoryCard item={item} onResolve={vi.fn()} pending demoted={false} />);
    expect(screen.getByRole('button', { name: /demote/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /reject/i })).toBeDisabled();
  });
});
