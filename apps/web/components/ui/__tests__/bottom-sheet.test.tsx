import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { BottomSheet } from '../bottom-sheet';

beforeEach(() => {
  // Reset scroll-lock side effects between tests.
  document.body.style.overflow = '';
  document.documentElement.style.overflow = '';
});

describe('BottomSheet', () => {
  it('renders the children and a labelled dialog when open', () => {
    render(
      <BottomSheet open onClose={vi.fn()} ariaLabel="example sheet">
        <button>inner action</button>
      </BottomSheet>,
    );
    expect(
      screen.getByRole('dialog', { name: 'example sheet' }),
    ).toBeInTheDocument();
    expect(screen.getByText('inner action')).toBeInTheDocument();
  });

  it('renders nothing when closed', () => {
    render(
      <BottomSheet open={false} onClose={vi.fn()} ariaLabel="example sheet">
        <button>inner action</button>
      </BottomSheet>,
    );
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText('inner action')).not.toBeInTheDocument();
  });

  it('renders the optional title', () => {
    render(
      <BottomSheet open onClose={vi.fn()} ariaLabel="example sheet" title={<h2>my title</h2>}>
        <span>body</span>
      </BottomSheet>,
    );
    expect(screen.getByText('my title')).toBeInTheDocument();
  });

  it('calls onClose when the scrim is clicked but not the panel', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose} ariaLabel="example sheet">
        <button>inner action</button>
      </BottomSheet>,
    );
    const dialog = screen.getByRole('dialog');

    // Clicking inside the panel must not dismiss.
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();

    // Clicking the scrim (the dialog's parent) dismisses.
    fireEvent.click(dialog.parentElement as HTMLElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when the close button is clicked', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose} ariaLabel="example sheet">
        <span>body</span>
      </BottomSheet>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('calls onClose when Escape is pressed', () => {
    const onClose = vi.fn();
    render(
      <BottomSheet open onClose={onClose} ariaLabel="example sheet">
        <span>body</span>
      </BottomSheet>,
    );
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('locks background scroll while open and restores it on close', () => {
    const { rerender } = render(
      <BottomSheet open onClose={vi.fn()} ariaLabel="example sheet">
        <span>body</span>
      </BottomSheet>,
    );
    expect(document.body.style.overflow).toBe('hidden');
    expect(document.documentElement.style.overflow).toBe('hidden');

    rerender(
      <BottomSheet open={false} onClose={vi.fn()} ariaLabel="example sheet">
        <span>body</span>
      </BottomSheet>,
    );
    expect(document.body.style.overflow).toBe('');
  });

  it('traps focus inside the panel (close button focused on open)', () => {
    render(
      <BottomSheet open onClose={vi.fn()} ariaLabel="example sheet">
        <button>inner action</button>
      </BottomSheet>,
    );
    const closeButton = screen.getByRole('button', { name: 'close' });
    expect(document.activeElement).toBe(closeButton);
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });

  it('applies the near-full-height sizing when fullScreen is set', () => {
    render(
      <BottomSheet open onClose={vi.fn()} ariaLabel="example sheet" fullScreen>
        <span>body</span>
      </BottomSheet>,
    );
    const dialog = screen.getByRole('dialog');
    expect(dialog.style.maxHeight).toBe('92vh');
    expect(dialog.style.height).toBe('92vh');
  });
});
