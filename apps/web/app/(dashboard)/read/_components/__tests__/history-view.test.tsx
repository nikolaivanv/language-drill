import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { ReadEntrySummary } from '@language-drill/api-client';
import { HistoryView } from '../history-view';

// ---------------------------------------------------------------------------
// HistoryView — card stack + click-to-open (Requirement 10.3).
// ---------------------------------------------------------------------------

const ENTRIES: ReadEntrySummary[] = [
  {
    id: '11111111-1111-1111-1111-111111111111',
    title: 'Cien años — ch. 1',
    source: 'García Márquez',
    preview: 'muchos años después, frente al pelotón de fusilamiento…',
    flaggedCount: 8,
    savedCount: 3,
    pastedAt: '2026-04-30T12:00:00.000Z',
  },
  {
    id: '22222222-2222-2222-2222-222222222222',
    title: '',
    source: '',
    preview: 'la aldea estaba en silencio aquella mañana…',
    flaggedCount: 5,
    savedCount: 0,
    pastedAt: '2026-04-29T12:00:00.000Z',
  },
];

describe('HistoryView — header', () => {
  it('renders the eyebrow and the "past texts" title', () => {
    render(<HistoryView entries={ENTRIES} onOpen={() => {}} />);
    expect(screen.getByText('your reading')).toBeInTheDocument();
    expect(screen.getByText('past texts')).toBeInTheDocument();
  });
});

describe('HistoryView — card content', () => {
  it('renders one listitem per entry', () => {
    render(<HistoryView entries={ENTRIES} onOpen={() => {}} />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('renders title, source, preview, flagged count, and saved chip on each card', () => {
    render(<HistoryView entries={ENTRIES} onOpen={() => {}} />);
    expect(screen.getByText('Cien años — ch. 1')).toBeInTheDocument();
    expect(screen.getByText('García Márquez')).toBeInTheDocument();
    expect(
      screen.getByText(/muchos años después, frente al pelotón/),
    ).toBeInTheDocument();
    expect(screen.getByText('8 flagged')).toBeInTheDocument();
    expect(screen.getByText('3 saved')).toBeInTheDocument();
  });

  it('falls back to "untitled passage" when title is empty and hides the source line when source is empty', () => {
    render(<HistoryView entries={ENTRIES} onOpen={() => {}} />);
    expect(screen.getByText('untitled passage')).toBeInTheDocument();
    // The second entry has no source — make sure no extraneous source-row mock string got rendered.
    const items = screen.getAllByRole('listitem');
    expect(items[1].textContent ?? '').not.toMatch(/García Márquez/);
  });

  it('renders both flagged + saved counts even when savedCount === 0', () => {
    render(<HistoryView entries={ENTRIES} onOpen={() => {}} />);
    expect(screen.getByText('5 flagged')).toBeInTheDocument();
    expect(screen.getByText('0 saved')).toBeInTheDocument();
  });
});

describe('HistoryView — mobile reflow', () => {
  it('drops the desktop max-width cap so the cards go full-width on mobile (Req 8.5)', () => {
    const { container } = render(
      <HistoryView entries={ENTRIES} onOpen={() => {}} />,
    );
    expect(container.firstChild).toHaveClass('mobile:max-w-none');
    expect(container.firstChild).toHaveClass('max-w-[800px]');
  });
});

describe('HistoryView — clicks', () => {
  it('clicking a card fires onOpen with the entry id', () => {
    const onOpen = vi.fn();
    render(<HistoryView entries={ENTRIES} onOpen={onOpen} />);
    fireEvent.click(screen.getByRole('button', { name: /Cien años/i }));
    expect(onOpen).toHaveBeenCalledWith(
      '11111111-1111-1111-1111-111111111111',
    );
  });

  it('each card is its own button (one per entry)', () => {
    render(<HistoryView entries={ENTRIES} onOpen={() => {}} />);
    expect(screen.getAllByRole('button')).toHaveLength(2);
  });
});
