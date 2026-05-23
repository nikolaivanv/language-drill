import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FlaggedMap } from '@language-drill/shared';
import { CefrLevel } from '@language-drill/shared';
import { WordBankSheet } from '../word-bank-sheet';

const FLAGGED: FlaggedMap = {
  aldea: {
    lemma: 'aldea',
    pos: 'noun',
    gloss: 'a small village',
    example: 'la aldea está cerca',
    freq: 4321,
    cefr: CefrLevel.B2,
  },
};

const baseProps = {
  open: true,
  onClose: () => {},
  bank: ['aldea'],
  flaggedMap: FLAGGED,
  intensity: 'subtle' as const,
  onIntensityChange: () => {},
  onRemove: () => {},
};

describe('WordBankSheet', () => {
  it('renders the bank rows and the intensity toggle in the header', () => {
    render(<WordBankSheet {...baseProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Bank row (from WordBankRail).
    expect(screen.getByText('aldea')).toBeInTheDocument();
    expect(screen.getByText('a small village')).toBeInTheDocument();
    // Intensity toggle (Req 8.3).
    expect(
      screen.getByRole('radiogroup', { name: /highlight intensity/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'subtle' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'assertive' })).toBeInTheDocument();
  });

  it('fires onIntensityChange when a toggle option is chosen', () => {
    const onIntensityChange = vi.fn();
    render(
      <WordBankSheet {...baseProps} onIntensityChange={onIntensityChange} />,
    );
    fireEvent.click(screen.getByRole('radio', { name: 'assertive' }));
    expect(onIntensityChange).toHaveBeenCalledWith('assertive');
  });

  it('fires onRemove when a bank row remove button is clicked', () => {
    const onRemove = vi.fn();
    render(<WordBankSheet {...baseProps} onRemove={onRemove} />);
    fireEvent.click(screen.getByRole('button', { name: /remove aldea/i }));
    expect(onRemove).toHaveBeenCalledWith('aldea');
  });

  it('closes on the close button, the scrim, and Escape', () => {
    const onClose = vi.fn();
    render(<WordBankSheet {...baseProps} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'close' }));
    const scrim = screen.getByRole('dialog').parentElement as HTMLElement;
    fireEvent.click(scrim);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(3);
  });

  it('does not render when closed', () => {
    render(<WordBankSheet {...baseProps} open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
