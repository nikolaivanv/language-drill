import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { FlaggedTheory } from '@language-drill/api-client';
import { FlaggedTheoryCard } from '../flagged-theory-card';

const item: FlaggedTheory = {
  id: 'th-1',
  language: 'DE',
  level: 'B1',
  grammarPointKey: 'dative',
  topicId: 'de-b1-dative',
  contentJson: {},
  qualityScore: 0.5,
  flaggedReasons: [{ code: 'level-mismatch' }],
  generatedAt: '2026-06-02T00:00:00.000Z',
};

describe('FlaggedTheoryCard', () => {
  it('renders header and reason chip', () => {
    render(<FlaggedTheoryCard item={item} onResolve={vi.fn()} pending={false} demoted={false} />);
    expect(screen.getByText(/theory/i)).toBeInTheDocument();
    expect(screen.getByText(/DE/)).toBeInTheDocument();
    expect(screen.getByText(/B1/)).toBeInTheDocument();
    expect(screen.getByText(/dative/)).toBeInTheDocument();
    expect(screen.getByText(/Level mismatch|level-mismatch/i)).toBeInTheDocument();
  });

  it('falls back to raw JSON for malformed contentJson', () => {
    const malformed: FlaggedTheory = { ...item, contentJson: { not: 'a valid theory topic' } };
    render(<FlaggedTheoryCard item={malformed} onResolve={vi.fn()} pending={false} demoted={false} />);
    // Should not throw; demote/reason chrome should still render
    expect(screen.getAllByText(/theory/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/Level mismatch|level-mismatch/i)).toBeInTheDocument();
    // Raw JSON fallback should be visible
    expect(screen.getByText(/"not".*"a valid theory topic"/s)).toBeInTheDocument();
  });

  it('shows the demote notice when demoted is true', () => {
    render(<FlaggedTheoryCard item={item} onResolve={vi.fn()} pending={false} demoted />);
    expect(screen.getByText(/already exists in this cell/i)).toBeInTheDocument();
  });

  it('calls onResolve with approve / reject', () => {
    const onResolve = vi.fn();
    render(<FlaggedTheoryCard item={item} onResolve={onResolve} pending={false} demoted={false} />);
    fireEvent.click(screen.getByRole('button', { name: /approve/i }));
    expect(onResolve).toHaveBeenCalledWith('approve');
    fireEvent.click(screen.getByRole('button', { name: /reject/i }));
    expect(onResolve).toHaveBeenCalledWith('reject');
  });
});
