import { describe, expect, it } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { VocabWord } from '@language-drill/api-client';
import { VocabWordCell } from '../vocab-word-cell';

const word: VocabWord = {
  lemma: 'manzana',
  displayForm: 'la manzana',
  gloss: 'apple',
  exampleSentence: 'Como una manzana.',
  freqRank: 800,
  tier: 'core',
  state: 'untested',
};

describe('VocabWordCell', () => {
  it('hides the gloss until tapped', () => {
    render(<VocabWordCell word={word} />);
    expect(screen.getByText('la manzana')).toBeInTheDocument();
    expect(screen.queryByText('apple')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /la manzana/i }));
    expect(screen.getByText('apple')).toBeInTheDocument();
  });

  it('exposes the coverage state for styling', () => {
    render(<VocabWordCell word={{ ...word, state: 'practiced-strong' }} />);
    expect(screen.getByRole('button', { name: /la manzana/i })).toHaveAttribute(
      'data-state',
      'practiced-strong',
    );
  });

  it('toggles aria-expanded when tapped again', () => {
    render(<VocabWordCell word={word} />);
    const button = screen.getByRole('button', { name: /la manzana/i });
    expect(button).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('apple')).not.toBeInTheDocument();
  });

  it('omits the freq-rank chip when freqRank is null', () => {
    render(<VocabWordCell word={{ ...word, freqRank: null }} />);
    expect(screen.queryByText(/#/)).not.toBeInTheDocument();
  });
});
