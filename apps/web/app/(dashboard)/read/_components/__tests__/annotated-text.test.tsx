import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FlaggedMap } from '@language-drill/shared';
import { CefrLevel } from '@language-drill/shared';
import { AnnotatedText } from '../annotated-text';
import styles from '../word-flag-styles.module.css';

// ---------------------------------------------------------------------------
// AnnotatedText — class-set + click-rect + intensity/saved/active modifiers
// (Requirements 6.2, 6.4, 6.5, 6.6, 6.10, 14.2).
// ---------------------------------------------------------------------------

function flag(extras: Partial<{ freq: number; cefr: CefrLevel }> = {}): {
  lemma: string;
  pos: string;
  gloss: string;
  example: string;
  freq: number;
  cefr: CefrLevel;
} {
  return {
    lemma: 'aldea',
    pos: 'noun',
    gloss: 'village',
    example: 'la aldea pequeña',
    freq: extras.freq ?? 4200,
    cefr: extras.cefr ?? CefrLevel.B2,
  };
}

const FLAGGED: FlaggedMap = {
  aldea: flag(),
  pueblo: flag(),
};

describe('AnnotatedText — flagged vs unflagged tokens', () => {
  it('renders a flagged word as a <button> with the base + intensity classes', () => {
    render(
      <AnnotatedText
        text="aldea grande"
        flaggedMap={FLAGGED}
        intensity="subtle"
        bankSet={new Set()}
        activeWord={null}
        onWordClick={() => {}}
      />,
    );
    const button = screen.getByRole('button', { name: 'aldea' });
    expect(button).toHaveAttribute('data-word', 'aldea');
    expect(button.className).toContain(styles.word);
    expect(button.className).toContain(styles.subtle);
    expect(button.className).not.toContain(styles.assertive);
    expect(button.className).not.toContain(styles.saved);
    expect(button.className).not.toContain(styles.active);
  });

  it('renders an unflagged word as plain text (no button, no class)', () => {
    render(
      <AnnotatedText
        text="aldea grande"
        flaggedMap={FLAGGED}
        intensity="subtle"
        bankSet={new Set()}
        activeWord={null}
        onWordClick={() => {}}
      />,
    );
    // "grande" is not in the flagged map → no button.
    expect(
      screen.queryByRole('button', { name: 'grande' }),
    ).not.toBeInTheDocument();
    // But its raw text still appears in the rendered output.
    expect(screen.getByText(/grande/)).toBeInTheDocument();
  });

  it('preserves separator characters in the rendered output', () => {
    const { container } = render(
      <AnnotatedText
        text="aldea, pueblo."
        flaggedMap={FLAGGED}
        intensity="subtle"
        bankSet={new Set()}
        activeWord={null}
        onWordClick={() => {}}
      />,
    );
    // Round-trip: the rendered text content matches the source text exactly.
    expect(container.textContent).toBe('aldea, pueblo.');
  });
});

describe('AnnotatedText — click handler', () => {
  it('calls onWordClick with the lowercased key and a DOMRect-shaped object', () => {
    const onWordClick = vi.fn();
    render(
      <AnnotatedText
        text="ALDEA grande"
        flaggedMap={FLAGGED}
        intensity="subtle"
        bankSet={new Set()}
        activeWord={null}
        onWordClick={onWordClick}
      />,
    );
    const button = screen.getByRole('button', { name: 'ALDEA' });
    fireEvent.click(button);
    expect(onWordClick).toHaveBeenCalledTimes(1);
    const [word, rect] = onWordClick.mock.calls[0];
    expect(word).toBe('aldea');
    // jsdom returns a DOMRect-shaped object with numeric layout fields.
    expect(rect).toMatchObject({
      top: expect.any(Number),
      left: expect.any(Number),
      width: expect.any(Number),
      height: expect.any(Number),
    });
  });
});

describe('AnnotatedText — intensity / saved / active modifiers', () => {
  it('switching intensity swaps the class (subtle → assertive)', () => {
    const { rerender } = render(
      <AnnotatedText
        text="aldea"
        flaggedMap={FLAGGED}
        intensity="subtle"
        bankSet={new Set()}
        activeWord={null}
        onWordClick={() => {}}
      />,
    );
    const subtleBtn = screen.getByRole('button', { name: 'aldea' });
    expect(subtleBtn.className).toContain(styles.subtle);
    expect(subtleBtn.className).not.toContain(styles.assertive);

    rerender(
      <AnnotatedText
        text="aldea"
        flaggedMap={FLAGGED}
        intensity="assertive"
        bankSet={new Set()}
        activeWord={null}
        onWordClick={() => {}}
      />,
    );
    const assertiveBtn = screen.getByRole('button', { name: 'aldea' });
    expect(assertiveBtn.className).toContain(styles.assertive);
    expect(assertiveBtn.className).not.toContain(styles.subtle);
  });

  it('adds the saved class when the word is in bankSet', () => {
    render(
      <AnnotatedText
        text="aldea"
        flaggedMap={FLAGGED}
        intensity="subtle"
        bankSet={new Set(['aldea'])}
        activeWord={null}
        onWordClick={() => {}}
      />,
    );
    const button = screen.getByRole('button', { name: 'aldea' });
    expect(button.className).toContain(styles.saved);
  });

  it('does not add saved when the word is absent from bankSet', () => {
    render(
      <AnnotatedText
        text="aldea pueblo"
        flaggedMap={FLAGGED}
        intensity="subtle"
        bankSet={new Set(['aldea'])}
        activeWord={null}
        onWordClick={() => {}}
      />,
    );
    const pueblo = screen.getByRole('button', { name: 'pueblo' });
    expect(pueblo.className).not.toContain(styles.saved);
  });

  it('adds the active class when activeWord matches', () => {
    render(
      <AnnotatedText
        text="aldea pueblo"
        flaggedMap={FLAGGED}
        intensity="subtle"
        bankSet={new Set()}
        activeWord="aldea"
        onWordClick={() => {}}
      />,
    );
    const aldea = screen.getByRole('button', { name: 'aldea' });
    const pueblo = screen.getByRole('button', { name: 'pueblo' });
    expect(aldea.className).toContain(styles.active);
    expect(pueblo.className).not.toContain(styles.active);
  });
});
