import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CollectBar } from '../collect-bar';

// ---------------------------------------------------------------------------
// CollectBar — flagged/saved counts + a single "save text" CTA. Words auto-save
// per-card, so there is no batch "add N to vocabulary" action anymore; the bar
// only saves the passage to the library.
// ---------------------------------------------------------------------------

describe('CollectBar', () => {
  it('renders flagged and saved counts', () => {
    render(
      <CollectBar flaggedCount={5} savedCount={3} onSaveToLibrary={vi.fn()} />,
    );
    expect(screen.getByText(/5 flagged/)).toBeInTheDocument();
    expect(screen.getByText(/3 saved/)).toBeInTheDocument();
  });

  it('renders only the "save text" button and no "add to vocabulary" action', () => {
    render(
      <CollectBar flaggedCount={5} savedCount={3} onSaveToLibrary={vi.fn()} />,
    );
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0]).toHaveTextContent(/save text/i);
    expect(
      screen.queryByRole('button', { name: /to vocabulary/i }),
    ).not.toBeInTheDocument();
  });

  it('calls onSaveToLibrary when "save text" is clicked', () => {
    const onSaveToLibrary = vi.fn();
    render(
      <CollectBar
        flaggedCount={5}
        savedCount={2}
        onSaveToLibrary={onSaveToLibrary}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /save text/i }));
    expect(onSaveToLibrary).toHaveBeenCalledTimes(1);
  });

  it('disables the button and reads "text saved" once already in the library', () => {
    const onSaveToLibrary = vi.fn();
    render(
      <CollectBar
        flaggedCount={5}
        savedCount={3}
        canSaveToLibrary={false}
        onSaveToLibrary={onSaveToLibrary}
      />,
    );
    const button = screen.getByRole('button', { name: /text saved/i });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(onSaveToLibrary).not.toHaveBeenCalled();
  });

  it('disables the button while a save is in flight', () => {
    render(
      <CollectBar
        flaggedCount={5}
        savedCount={0}
        saving
        onSaveToLibrary={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /save text/i })).toBeDisabled();
  });
});
