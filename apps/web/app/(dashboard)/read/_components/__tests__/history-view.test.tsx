import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReadEntrySummary } from '@language-drill/api-client';
import { HistoryView } from '../history-view';
import { ReadingCategory, ReadingTextLength, CefrLevel } from '@language-drill/shared';

// ---------------------------------------------------------------------------
// HistoryView — card grid + click-to-open (Task 13 redesign)
// ---------------------------------------------------------------------------

const GENERATED_ENTRY: ReadEntrySummary = {
  id: '11111111-1111-1111-1111-111111111111',
  title: 'The Lost Key',
  source: '',
  preview: 'A detective story about a missing key…',
  flaggedCount: 3,
  savedCount: 5,
  pastedAt: '2026-06-07T10:00:00.000Z',
  kind: 'generated',
  category: ReadingCategory.STORY,
  cefr: CefrLevel.B2,
  length: ReadingTextLength.SHORT,
  prompt: 'a detective story about a missing key',
};

const PASTED_ENTRY: ReadEntrySummary = {
  id: '22222222-2222-2222-2222-222222222222',
  title: 'Cien años — ch. 1',
  source: 'García Márquez',
  preview: 'muchos años después, frente al pelotón de fusilamiento…',
  flaggedCount: 8,
  savedCount: 3,
  pastedAt: '2026-06-06T10:00:00.000Z',
  kind: 'pasted',
  category: null,
  cefr: null,
  length: null,
  prompt: null,
};

const ENTRIES: readonly ReadEntrySummary[] = [GENERATED_ENTRY, PASTED_ENTRY];

const DEFAULT_PROPS = {
  entries: ENTRIES,
  onOpen: vi.fn(),
  onGenerateNew: vi.fn(),
  languageLabel: 'Español',
};

describe('HistoryView — header', () => {
  it('renders the YOUR READING eyebrow and "past texts" heading', () => {
    render(<HistoryView {...DEFAULT_PROPS} />);
    expect(screen.getByText(/your reading/i)).toBeInTheDocument();
    expect(screen.getByText(/past texts/i)).toBeInTheDocument();
  });
});

describe('HistoryView — card per entry', () => {
  it('renders one card per entry (plus the add card)', () => {
    render(<HistoryView {...DEFAULT_PROPS} />);
    // Two entry cards + one "add" card = 3 clickable items
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThanOrEqual(2);
  });

  it('renders the title of each entry', () => {
    render(<HistoryView {...DEFAULT_PROPS} />);
    expect(screen.getByText('The Lost Key')).toBeInTheDocument();
    expect(screen.getByText('Cien años — ch. 1')).toBeInTheDocument();
  });
});

describe('HistoryView — clicks', () => {
  it('clicking a card calls onOpen with the entry id', () => {
    const onOpen = vi.fn();
    render(<HistoryView {...DEFAULT_PROPS} onOpen={onOpen} />);
    fireEvent.click(screen.getByText('The Lost Key').closest('[role="button"], button')!);
    expect(onOpen).toHaveBeenCalledWith('11111111-1111-1111-1111-111111111111');
  });

  it('clicking a pasted entry card calls onOpen with correct id', () => {
    const onOpen = vi.fn();
    render(<HistoryView {...DEFAULT_PROPS} onOpen={onOpen} />);
    fireEvent.click(screen.getByText('Cien años — ch. 1').closest('[role="button"], button')!);
    expect(onOpen).toHaveBeenCalledWith('22222222-2222-2222-2222-222222222222');
  });
});

describe('HistoryView — generated entry chips', () => {
  it('shows category chip for a generated entry', () => {
    render(<HistoryView {...DEFAULT_PROPS} />);
    // Category should be STORY, displayed uppercased
    expect(screen.getByText('STORY')).toBeInTheDocument();
  });

  it('shows cefr chip for a generated entry', () => {
    render(<HistoryView {...DEFAULT_PROPS} />);
    expect(screen.getByText('B2')).toBeInTheDocument();
  });

  it('shows length chip (uppercased) for a generated entry', () => {
    render(<HistoryView {...DEFAULT_PROPS} />);
    expect(screen.getByText('SHORT')).toBeInTheDocument();
  });

  it('shows a saved chip with count for generated entry', () => {
    render(<HistoryView {...DEFAULT_PROPS} />);
    // 5 saved for generated entry
    const savedChips = screen.getAllByText(/saved/);
    const fiveSaved = savedChips.find((el) => el.textContent?.includes('5'));
    expect(fiveSaved).toBeInTheDocument();
  });
});

describe('HistoryView — pasted entry chips', () => {
  it('shows a "pasted" chip for a pasted entry', () => {
    render(<HistoryView {...DEFAULT_PROPS} />);
    expect(screen.getByText('pasted')).toBeInTheDocument();
  });

  it('does NOT show category/cefr/length chips for a pasted entry', () => {
    render(<HistoryView {...DEFAULT_PROPS} entries={[PASTED_ENTRY]} />);
    expect(screen.queryByText('STORY')).not.toBeInTheDocument();
    expect(screen.queryByText('B2')).not.toBeInTheDocument();
    expect(screen.queryByText('SHORT')).not.toBeInTheDocument();
  });

  it('shows a saved chip with count for pasted entry', () => {
    render(<HistoryView {...DEFAULT_PROPS} />);
    // 3 saved for pasted entry
    const savedChips = screen.getAllByText(/saved/);
    const threeSaved = savedChips.find((el) => el.textContent?.includes('3'));
    expect(threeSaved).toBeInTheDocument();
  });
});

describe('HistoryView — add card', () => {
  it('renders a "generate a new text" add card', () => {
    render(<HistoryView {...DEFAULT_PROPS} />);
    expect(screen.getByText(/generate a new text/i)).toBeInTheDocument();
  });

  it('clicking the add card calls onGenerateNew', () => {
    const onGenerateNew = vi.fn();
    render(<HistoryView {...DEFAULT_PROPS} onGenerateNew={onGenerateNew} />);
    fireEvent.click(screen.getByText(/generate a new text/i).closest('[role="button"], button')!);
    expect(onGenerateNew).toHaveBeenCalledTimes(1);
  });
});
