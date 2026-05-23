import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { WordFlag } from '@language-drill/shared';
import { CefrLevel } from '@language-drill/shared';
import { WordSheet } from '../word-sheet';

const ENTRY: WordFlag = {
  lemma: 'aldea',
  pos: 'noun',
  gloss: 'a small village',
  example: 'la aldea está cerca del río',
  freq: 4321,
  cefr: CefrLevel.B2,
};

const baseProps = {
  open: true,
  entry: ENTRY,
  word: 'aldea',
  inBank: false,
  onSave: () => {},
  onSkip: () => {},
  onClose: () => {},
} as const;

describe('WordSheet', () => {
  it('renders the word-card content when open', () => {
    render(<WordSheet {...baseProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('aldea')).toBeInTheDocument();
    expect(screen.getByText('a small village')).toBeInTheDocument();
    expect(screen.getByText('la aldea está cerca del río')).toBeInTheDocument();
    expect(screen.getByText(/freq #4,321/)).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<WordSheet {...baseProps} open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not render when there is no entry', () => {
    render(<WordSheet {...baseProps} entry={null} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('fires onSave and onSkip from the card footer', () => {
    const onSave = vi.fn();
    const onSkip = vi.fn();
    render(<WordSheet {...baseProps} onSave={onSave} onSkip={onSkip} />);
    fireEvent.click(screen.getByRole('button', { name: /\+ save to bank/i }));
    fireEvent.click(screen.getByRole('button', { name: /^skip$/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('closes on the close button, the scrim, and Escape', () => {
    const onClose = vi.fn();
    render(<WordSheet {...baseProps} onClose={onClose} />);

    // Close button (BottomSheet header).
    fireEvent.click(screen.getByRole('button', { name: 'close' }));
    // Scrim is the dialog's portal parent.
    const scrim = screen.getByRole('dialog').parentElement as HTMLElement;
    fireEvent.click(scrim);
    // Escape.
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
