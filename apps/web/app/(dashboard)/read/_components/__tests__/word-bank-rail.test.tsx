import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { CefrLevel } from '@language-drill/shared';
import type { SavedVocabItem } from '@language-drill/api-client';
import { WordBankRail } from '../word-bank-rail';

// ---------------------------------------------------------------------------
// WordBankRail — empty state, list rendering, unsave callback
// (Requirements 6.3, 8.7, 8.8). Driven by the entry's saved vocabulary, so it
// lists both flagged-banked AND on-demand saves.
// ---------------------------------------------------------------------------

const ALDEA: SavedVocabItem = {
  id: '11111111-1111-1111-1111-111111111111',
  word: 'aldea',
  lemma: 'aldea',
  gloss: 'a small village',
  type: 'word',
  cefr: CefrLevel.B2,
};
const PUEBLO: SavedVocabItem = {
  id: '22222222-2222-2222-2222-222222222222',
  word: 'pueblo',
  lemma: 'pueblo',
  gloss: 'a town',
  type: 'word',
  cefr: CefrLevel.B1,
};
// An on-demand save of a non-flagged phrase — the case the old bank rail dropped.
const PHRASE: SavedVocabItem = {
  id: '33333333-3333-3333-3333-333333333333',
  word: 'echar de menos',
  lemma: 'echar de menos',
  gloss: 'to miss (someone)',
  type: 'phrase',
  cefr: null,
};

describe('WordBankRail — header + footer', () => {
  it('renders the "word bank" title, count, and subtitle', () => {
    render(<WordBankRail saved={[ALDEA]} onUnsave={() => {}} />);
    expect(screen.getByText('word bank')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('saved from this passage')).toBeInTheDocument();
  });

  it('renders the footer note + "from your reading" accent chip', () => {
    render(<WordBankRail saved={[]} onUnsave={() => {}} />);
    expect(
      screen.getByText(/saved words appear in cloze, vocab recall/i),
    ).toBeInTheDocument();
    expect(screen.getByText('from your reading')).toBeInTheDocument();
  });
});

describe('WordBankRail — empty state', () => {
  it('shows the dashed-border tap message when nothing is saved', () => {
    render(<WordBankRail saved={[]} onUnsave={() => {}} />);
    expect(
      screen.getByText('tap a word to see its meaning, then save it here.'),
    ).toBeInTheDocument();
  });

  it('renders no listitems when nothing is saved', () => {
    render(<WordBankRail saved={[]} onUnsave={() => {}} />);
    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
  });
});

describe('WordBankRail — list rendering', () => {
  it('renders one row per saved item with lemma, gloss, and CEFR', () => {
    render(<WordBankRail saved={[ALDEA, PUEBLO]} onUnsave={() => {}} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('aldea');
    expect(items[0]).toHaveTextContent('a small village');
    expect(items[0]).toHaveTextContent('B2');
    expect(items[1]).toHaveTextContent('pueblo');
    expect(items[1]).toHaveTextContent('a town');
    expect(items[1]).toHaveTextContent('B1');
  });

  it('renders an on-demand phrase save (no CEFR) with a "phr" marker', () => {
    render(<WordBankRail saved={[PHRASE]} onUnsave={() => {}} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(1);
    expect(items[0]).toHaveTextContent('echar de menos');
    expect(items[0]).toHaveTextContent('to miss (someone)');
    expect(items[0]).toHaveTextContent('phr');
  });

  it('hides the empty-state message when at least one row renders', () => {
    render(<WordBankRail saved={[ALDEA]} onUnsave={() => {}} />);
    expect(
      screen.queryByText(/tap a word to see its meaning/i),
    ).not.toBeInTheDocument();
  });
});

describe('WordBankRail — onUnsave', () => {
  it('clicking the × button on a row fires onUnsave with the saved item', () => {
    const onUnsave = vi.fn();
    render(<WordBankRail saved={[ALDEA, PUEBLO]} onUnsave={onUnsave} />);
    fireEvent.click(screen.getByRole('button', { name: /remove pueblo/i }));
    expect(onUnsave).toHaveBeenCalledWith(PUEBLO);
    expect(onUnsave).toHaveBeenCalledTimes(1);
  });
});
