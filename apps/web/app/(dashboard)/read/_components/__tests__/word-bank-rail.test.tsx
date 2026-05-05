import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FlaggedMap } from '@language-drill/shared';
import { CefrLevel } from '@language-drill/shared';
import { WordBankRail } from '../word-bank-rail';

// ---------------------------------------------------------------------------
// WordBankRail — empty state, list rendering, remove callback
// (Requirements 6.3, 8.7, 8.8).
// ---------------------------------------------------------------------------

const FLAGGED: FlaggedMap = {
  aldea: {
    lemma: 'aldea',
    pos: 'noun',
    gloss: 'a small village',
    example: 'la aldea está cerca',
    freq: 4321,
    cefr: CefrLevel.B2,
  },
  pueblo: {
    lemma: 'pueblo',
    pos: 'noun',
    gloss: 'a town',
    example: 'el pueblo es grande',
    freq: 1820,
    cefr: CefrLevel.B1,
  },
};

describe('WordBankRail — header + footer', () => {
  it('renders the "word bank" title, count, and subtitle', () => {
    render(<WordBankRail bank={['aldea']} flaggedMap={FLAGGED} onRemove={() => {}} />);
    expect(screen.getByText('word bank')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('marked from this passage')).toBeInTheDocument();
  });

  it('renders the footer note + "from your reading" accent chip', () => {
    render(<WordBankRail bank={[]} flaggedMap={{}} onRemove={() => {}} />);
    expect(
      screen.getByText(/saved words appear in cloze, vocab recall/i),
    ).toBeInTheDocument();
    expect(screen.getByText('from your reading')).toBeInTheDocument();
  });
});

describe('WordBankRail — empty state', () => {
  it('shows the dashed-border tap message when bank is empty', () => {
    render(<WordBankRail bank={[]} flaggedMap={{}} onRemove={() => {}} />);
    expect(
      screen.getByText(
        'tap a highlighted word to see its meaning, then save it here.',
      ),
    ).toBeInTheDocument();
  });

  it('renders no listitems when bank is empty', () => {
    render(<WordBankRail bank={[]} flaggedMap={{}} onRemove={() => {}} />);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});

describe('WordBankRail — list rendering', () => {
  it('renders one row per bank word with lemma, gloss, and CEFR', () => {
    render(
      <WordBankRail
        bank={['aldea', 'pueblo']}
        flaggedMap={FLAGGED}
        onRemove={() => {}}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('aldea');
    expect(items[0]).toHaveTextContent('a small village');
    expect(items[0]).toHaveTextContent('B2');
    expect(items[1]).toHaveTextContent('pueblo');
    expect(items[1]).toHaveTextContent('a town');
    expect(items[1]).toHaveTextContent('B1');
  });

  it('skips bank entries whose flag is missing from flaggedMap (defensive)', () => {
    render(
      <WordBankRail
        bank={['aldea', 'orphan']}
        flaggedMap={FLAGGED}
        onRemove={() => {}}
      />,
    );
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('aldea');
  });

  it('hides the empty-state message when at least one row renders', () => {
    render(
      <WordBankRail bank={['aldea']} flaggedMap={FLAGGED} onRemove={() => {}} />,
    );
    expect(
      screen.queryByText(/tap a highlighted word/i),
    ).not.toBeInTheDocument();
  });
});

describe('WordBankRail — onRemove', () => {
  it('clicking the × button on a row fires onRemove with the bank key', () => {
    const onRemove = vi.fn();
    render(
      <WordBankRail
        bank={['aldea', 'pueblo']}
        flaggedMap={FLAGGED}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /remove pueblo/i }));
    expect(onRemove).toHaveBeenCalledWith('pueblo');
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
