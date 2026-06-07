import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CollectBar } from '../collect-bar';

// ---------------------------------------------------------------------------
// CollectBar — counts; primary changes based on savedCount; callbacks fire
// ---------------------------------------------------------------------------

describe('CollectBar', () => {
  it('renders flagged and saved counts', () => {
    render(
      <CollectBar
        flaggedCount={5}
        savedCount={3}
        onSaveToLibrary={vi.fn()}
        onAddToVocabulary={vi.fn()}
      />,
    );
    expect(screen.getByText(/5 flagged/)).toBeInTheDocument();
    expect(screen.getByText(/3 saved/)).toBeInTheDocument();
  });

  it('shows "save to library" ghost and primary "add N to vocabulary" when savedCount > 0', () => {
    render(
      <CollectBar
        flaggedCount={5}
        savedCount={3}
        onSaveToLibrary={vi.fn()}
        onAddToVocabulary={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /save to library/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add 3 to vocabulary/i })).toBeInTheDocument();
  });

  it('shows only primary "save to library" when savedCount === 0', () => {
    render(
      <CollectBar
        flaggedCount={5}
        savedCount={0}
        onSaveToLibrary={vi.fn()}
        onAddToVocabulary={vi.fn()}
      />,
    );
    const buttons = screen.getAllByRole('button');
    // Only one button when savedCount === 0
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent(/save to library/i);
  });

  it('calls onSaveToLibrary when save to library ghost is clicked (savedCount > 0)', () => {
    const onSaveToLibrary = vi.fn();
    render(
      <CollectBar
        flaggedCount={5}
        savedCount={2}
        onSaveToLibrary={onSaveToLibrary}
        onAddToVocabulary={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /save to library/i }));
    expect(onSaveToLibrary).toHaveBeenCalledTimes(1);
  });

  it('calls onSaveToLibrary when single primary "save to library" is clicked (savedCount === 0)', () => {
    const onSaveToLibrary = vi.fn();
    render(
      <CollectBar
        flaggedCount={0}
        savedCount={0}
        onSaveToLibrary={onSaveToLibrary}
        onAddToVocabulary={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /save to library/i }));
    expect(onSaveToLibrary).toHaveBeenCalledTimes(1);
  });

  it('calls onAddToVocabulary when add to vocabulary is clicked', () => {
    const onAddToVocabulary = vi.fn();
    render(
      <CollectBar
        flaggedCount={5}
        savedCount={4}
        onSaveToLibrary={vi.fn()}
        onAddToVocabulary={onAddToVocabulary}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /add 4 to vocabulary/i }));
    expect(onAddToVocabulary).toHaveBeenCalledTimes(1);
  });
});
