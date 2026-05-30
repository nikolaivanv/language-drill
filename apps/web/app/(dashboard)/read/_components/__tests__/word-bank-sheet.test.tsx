import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CefrLevel } from '@language-drill/shared';
import type { SavedVocabItem } from '@language-drill/api-client';
import { WordBankSheet } from '../word-bank-sheet';

const ALDEA: SavedVocabItem = {
  id: '11111111-1111-1111-1111-111111111111',
  word: 'aldea',
  lemma: 'aldea',
  gloss: 'a small village',
  type: 'word',
  cefr: CefrLevel.B2,
};

const baseProps = {
  open: true,
  onClose: () => {},
  saved: [ALDEA],
  intensity: 'subtle' as const,
  onIntensityChange: () => {},
  onUnsave: () => {},
};

describe('WordBankSheet', () => {
  it('renders the saved rows and the intensity toggle in the header', () => {
    render(<WordBankSheet {...baseProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // Saved row (from WordBankRail).
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

  it('fires onUnsave when a saved row remove button is clicked', () => {
    const onUnsave = vi.fn();
    render(<WordBankSheet {...baseProps} onUnsave={onUnsave} />);
    fireEvent.click(screen.getByRole('button', { name: /remove aldea/i }));
    expect(onUnsave).toHaveBeenCalledWith(ALDEA);
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
