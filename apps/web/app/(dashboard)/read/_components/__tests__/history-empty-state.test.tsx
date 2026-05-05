import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { HistoryEmptyState } from '../history-empty-state';

// ---------------------------------------------------------------------------
// HistoryEmptyState — empty message + primary CTA (Requirement 10.5).
// ---------------------------------------------------------------------------

describe('HistoryEmptyState', () => {
  it('renders the "no past texts yet" copy', () => {
    render(<HistoryEmptyState onPasteNew={() => {}} />);
    expect(
      screen.getByText('no past texts yet — paste one to start.'),
    ).toBeInTheDocument();
  });

  it('renders a primary "+ paste new" CTA', () => {
    render(<HistoryEmptyState onPasteNew={() => {}} />);
    expect(
      screen.getByRole('button', { name: /\+ paste new/i }),
    ).toBeInTheDocument();
  });

  it('clicking the CTA fires onPasteNew', () => {
    const onPasteNew = vi.fn();
    render(<HistoryEmptyState onPasteNew={onPasteNew} />);
    fireEvent.click(screen.getByRole('button', { name: /\+ paste new/i }));
    expect(onPasteNew).toHaveBeenCalledTimes(1);
  });
});
