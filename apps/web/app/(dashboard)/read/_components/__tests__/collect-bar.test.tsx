import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CollectBar } from '../collect-bar';

// ---------------------------------------------------------------------------
// CollectBar — counts; primary changes based on savedCount; callbacks fire;
// the "save text" button disables once the passage is already in the library.
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

  it('shows "save text" ghost and primary "add N to vocabulary" when savedCount > 0', () => {
    render(
      <CollectBar
        flaggedCount={5}
        savedCount={3}
        onSaveToLibrary={vi.fn()}
        onAddToVocabulary={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /save text/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /add 3 to vocabulary/i })).toBeInTheDocument();
  });

  it('shows only the primary "save text" button when savedCount === 0', () => {
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
    expect(buttons[0]).toHaveTextContent(/save text/i);
  });

  it('calls onSaveToLibrary when the "save text" ghost is clicked (savedCount > 0)', () => {
    const onSaveToLibrary = vi.fn();
    render(
      <CollectBar
        flaggedCount={5}
        savedCount={2}
        onSaveToLibrary={onSaveToLibrary}
        onAddToVocabulary={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /save text/i }));
    expect(onSaveToLibrary).toHaveBeenCalledTimes(1);
  });

  it('calls onSaveToLibrary when the single primary "save text" is clicked (savedCount === 0)', () => {
    const onSaveToLibrary = vi.fn();
    render(
      <CollectBar
        flaggedCount={0}
        savedCount={0}
        onSaveToLibrary={onSaveToLibrary}
        onAddToVocabulary={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /save text/i }));
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

  it('disables the save-text button and reads "text saved" once already in the library', () => {
    const onSaveToLibrary = vi.fn();
    render(
      <CollectBar
        flaggedCount={5}
        savedCount={0}
        canSaveToLibrary={false}
        onSaveToLibrary={onSaveToLibrary}
        onAddToVocabulary={vi.fn()}
      />,
    );
    const button = screen.getByRole('button', { name: /text saved/i });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onSaveToLibrary).not.toHaveBeenCalled();
  });

  it('disables the save-text ghost when already in the library but keeps vocabulary actionable', () => {
    const onSaveToLibrary = vi.fn();
    const onAddToVocabulary = vi.fn();
    render(
      <CollectBar
        flaggedCount={5}
        savedCount={3}
        canSaveToLibrary={false}
        onSaveToLibrary={onSaveToLibrary}
        onAddToVocabulary={onAddToVocabulary}
      />,
    );
    expect(screen.getByRole('button', { name: /text saved/i })).toBeDisabled();
    const add = screen.getByRole('button', { name: /add 3 to vocabulary/i });
    expect(add).not.toBeDisabled();
    fireEvent.click(add);
    expect(onAddToVocabulary).toHaveBeenCalledTimes(1);
  });
});
