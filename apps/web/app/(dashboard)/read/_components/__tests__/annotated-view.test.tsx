import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FlaggedMap } from '@language-drill/shared';
import { CefrLevel } from '@language-drill/shared';
import { AnnotatedView } from '../annotated-view';

// AnnotatedView branches on `useIsMobile()` — default to desktop so the
// existing 2-column / popover / rail assertions hold; the mobile suite flips
// it on to exercise the chip + bottom sheets.
const mockIsMobile = vi.fn(() => false);
vi.mock('../../../../../lib/responsive', () => ({
  useIsMobile: () => mockIsMobile(),
}));

beforeEach(() => {
  mockIsMobile.mockReturnValue(false);
});

// ---------------------------------------------------------------------------
// AnnotatedView — composition + outside-click + zero-flagged path
// (Requirements 6.1, 6.7, 6.9).
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
};

const baseProps = {
  entry: {
    text: 'aldea grande',
    title: 'Cien años — ch. 1',
    source: 'García Márquez',
    flaggedWords: FLAGGED,
  },
  bank: [],
  intensity: 'subtle' as const,
  activeWord: null,
  deepCard: { status: 'idle' } as const,
  calibration: { eyebrow: '~B1+ calibration', explanation: 'showing words rarer than top-3000' },
  isSaving: false,
  onIntensityChange: () => {},
  onPopoverOpen: () => {},
  onPopoverClose: () => {},
  onSpanSelect: () => {},
  onDeepRetry: () => {},
  onSaveCard: () => {},
  onUndoCard: () => {},
  savedSpan: null,
  savedWordKeys: new Set<string>(),
  onBankToggle: () => {},
  onClearBank: () => {},
  onSave: () => {},
  onPasteNew: () => {},
};

describe('AnnotatedView — flagged ≥ 1', () => {
  it('renders the rail, reader, and footer when there is at least one flagged word', () => {
    render(<AnnotatedView {...baseProps} />);
    // Header
    expect(screen.getByText('Cien años — ch. 1')).toBeInTheDocument();
    expect(screen.getByText('García Márquez')).toBeInTheDocument();
    // Calibration strip
    expect(screen.getByText('~B1+ calibration')).toBeInTheDocument();
    // Word bank rail
    expect(screen.getByText('word bank')).toBeInTheDocument();
    // Footer
    expect(screen.getByText(/1 flagged · 0 saved · 1 skipped/)).toBeInTheDocument();
  });

  it('hides the source line when entry.source is empty', () => {
    render(
      <AnnotatedView
        {...baseProps}
        entry={{ ...baseProps.entry, source: '' }}
      />,
    );
    expect(screen.queryByText('García Márquez')).not.toBeInTheDocument();
  });

  it('falls back to "untitled passage" when entry.title is empty', () => {
    render(
      <AnnotatedView
        {...baseProps}
        entry={{ ...baseProps.entry, title: '' }}
      />,
    );
    expect(screen.getByText('untitled passage')).toBeInTheDocument();
  });
});

describe('AnnotatedView — zero flagged words', () => {
  it('hides the rail and renders the ZeroFlaggedStrip', () => {
    render(
      <AnnotatedView
        {...baseProps}
        entry={{ ...baseProps.entry, flaggedWords: {} }}
      />,
    );
    expect(screen.queryByText('word bank')).not.toBeInTheDocument();
    expect(
      screen.getByText('this passage is well within your level — nice.'),
    ).toBeInTheDocument();
  });

  it('passes onPasteNew through to the ZeroFlaggedStrip CTA', () => {
    const onPasteNew = vi.fn();
    render(
      <AnnotatedView
        {...baseProps}
        entry={{ ...baseProps.entry, flaggedWords: {} }}
        onPasteNew={onPasteNew}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: /paste something harder/i }),
    );
    expect(onPasteNew).toHaveBeenCalledTimes(1);
  });

  it('does NOT show the "within your level" message while annotation is still streaming, even with zero flags so far', () => {
    // The misleading-UX bug: during streaming with no flags yet, the page
    // was rendering ZeroFlaggedStrip because flaggedCount === 0 — looked
    // like "passage too easy" when really the iterator just hadn't yielded
    // anything yet.
    render(
      <AnnotatedView
        {...baseProps}
        entry={{ ...baseProps.entry, flaggedWords: {} }}
        annotateStreaming={{ flaggedCount: 0, candidateCount: 5 }}
      />,
    );
    expect(
      screen.queryByText('this passage is well within your level — nice.'),
    ).not.toBeInTheDocument();
    // The rail column is reserved during streaming so the layout doesn't
    // shift when the first flag tints (NFR Usability).
    expect(screen.getByText('word bank')).toBeInTheDocument();
  });

  it('shows the "within your level" message after streaming completes with zero flags', () => {
    // The legitimate path: stream done, zero flags. ZeroFlaggedStrip is
    // correct here — annotateStreaming is undefined (complete state).
    render(
      <AnnotatedView
        {...baseProps}
        entry={{ ...baseProps.entry, flaggedWords: {} }}
      />,
    );
    expect(
      screen.getByText('this passage is well within your level — nice.'),
    ).toBeInTheDocument();
  });
});

describe('AnnotatedView — outside-click dismissal', () => {
  it('clicking on the rd-text container (outside the popover) fires onPopoverClose when a popover is open', () => {
    const onPopoverClose = vi.fn();
    render(
      <AnnotatedView
        {...baseProps}
        activeWord={{ word: 'aldea', x: 100, y: 50 }}
        onPopoverClose={onPopoverClose}
      />,
    );
    const container = screen.getByTestId('rd-text');
    // Click directly on the container, not on a button or the popover.
    fireEvent.click(container);
    expect(onPopoverClose).toHaveBeenCalledTimes(1);
  });

  it('does not call onPopoverClose when no popover is open', () => {
    const onPopoverClose = vi.fn();
    render(
      <AnnotatedView
        {...baseProps}
        activeWord={null}
        onPopoverClose={onPopoverClose}
      />,
    );
    fireEvent.click(screen.getByTestId('rd-text'));
    expect(onPopoverClose).not.toHaveBeenCalled();
  });

  it('does not dismiss when the click originated inside a flagged-word button', () => {
    const onPopoverClose = vi.fn();
    const onPopoverOpen = vi.fn();
    render(
      <AnnotatedView
        {...baseProps}
        activeWord={{ word: 'aldea', x: 100, y: 50 }}
        onPopoverClose={onPopoverClose}
        onPopoverOpen={onPopoverOpen}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'aldea' }));
    expect(onPopoverOpen).toHaveBeenCalled();
    expect(onPopoverClose).not.toHaveBeenCalled();
  });
});

describe('AnnotatedView — calibration strip pass-through (task 37)', () => {
  it('shows the streaming progress UI when annotateStreaming is set', () => {
    render(
      <AnnotatedView
        {...baseProps}
        annotateStreaming={{ flaggedCount: 1, candidateCount: 5 }}
      />,
    );
    expect(screen.getByText(/annotating · 1 \/ 5/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    // Eyebrow must not render while streaming.
    expect(screen.queryByText('~B1+ calibration')).not.toBeInTheDocument();
  });

  it('shows "· no above-level words" when noAboveLevelWords is true and not streaming', () => {
    render(
      <AnnotatedView
        {...baseProps}
        entry={{ ...baseProps.entry, flaggedWords: {} }}
        noAboveLevelWords
      />,
    );
    expect(screen.getByText('· no above-level words')).toBeInTheDocument();
    expect(
      screen.queryByText('showing words rarer than top-3000'),
    ).not.toBeInTheDocument();
    expect(screen.getByText('~B1+ calibration')).toBeInTheDocument();
  });
});

describe('AnnotatedView — popover composition', () => {
  it('renders the popover only when activeWord points at a flagged entry', () => {
    const { rerender } = render(<AnnotatedView {...baseProps} activeWord={null} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    rerender(
      <AnnotatedView
        {...baseProps}
        activeWord={{ word: 'aldea', x: 100, y: 50 }}
      />,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  it('clicking the popover save button fires onBankToggle with the active word', () => {
    const onBankToggle = vi.fn();
    render(
      <AnnotatedView
        {...baseProps}
        activeWord={{ word: 'aldea', x: 100, y: 50 }}
        onBankToggle={onBankToggle}
      />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: /\+ save to bank/i }),
    );
    expect(onBankToggle).toHaveBeenCalledWith('aldea');
  });
});

describe('AnnotatedView — deep-card save / undo (Req 8.4, 8.5)', () => {
  const LOADED_WORD = {
    status: 'loaded' as const,
    span: { start: 0, end: 5, type: 'word' as const, x: 100, y: 50 },
    card: {
      type: 'word' as const,
      surface: 'aldea',
      lemma: 'aldea',
      pos: 'noun',
      contextualSense: 'a small rural settlement',
      definition: 'pueblo pequeño',
      definitionLabel: 'Español',
      cefr: CefrLevel.B2,
      freq: 4321,
    },
  };

  it('routes the deep card save button to onSaveCard with the card + span', () => {
    const onSaveCard = vi.fn();
    render(
      <AnnotatedView {...baseProps} deepCard={LOADED_WORD} onSaveCard={onSaveCard} />,
    );
    fireEvent.click(
      screen.getByRole('button', { name: /\+ save to vocabulary/i }),
    );
    expect(onSaveCard).toHaveBeenCalledWith(LOADED_WORD.card, LOADED_WORD.span);
  });

  it('shows the saved footer and routes to onUndoCard when the span is the saved one', () => {
    const onUndoCard = vi.fn();
    render(
      <AnnotatedView
        {...baseProps}
        deepCard={LOADED_WORD}
        savedSpan={{ start: 0, end: 5 }}
        onUndoCard={onUndoCard}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /✓ saved · undo/i }));
    expect(onUndoCard).toHaveBeenCalledTimes(1);
  });
});

describe('AnnotatedView — mobile branch (≤760px)', () => {
  beforeEach(() => {
    mockIsMobile.mockReturnValue(true);
  });

  it('renders a word-bank chip instead of the sticky rail', () => {
    render(<AnnotatedView {...baseProps} />);
    // The chip opens the bank sheet; the standalone rail/popover are absent.
    expect(
      screen.getByRole('button', { name: /word bank · 0/i }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId('word-popover')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the word bank sheet (with the intensity toggle) when the chip is tapped', () => {
    render(<AnnotatedView {...baseProps} bank={['aldea']} />);
    expect(
      screen.queryByRole('radiogroup', { name: /highlight intensity/i }),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /word bank · 1/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(
      screen.getByRole('radiogroup', { name: /highlight intensity/i }),
    ).toBeInTheDocument();
  });

  it('tapping a flagged word fires onPopoverOpen (reusing the reducer action)', () => {
    const onPopoverOpen = vi.fn();
    render(<AnnotatedView {...baseProps} onPopoverOpen={onPopoverOpen} />);
    fireEvent.click(screen.getByRole('button', { name: 'aldea' }));
    expect(onPopoverOpen).toHaveBeenCalledWith('aldea', expect.any(Number), expect.any(Number));
  });

  it('opens the word card as a sheet (not the anchored popover) for the active word', () => {
    render(
      <AnnotatedView
        {...baseProps}
        activeWord={{ word: 'aldea', x: 100, y: 50 }}
      />,
    );
    // The word card content shows inside a dialog, but not the popover shell.
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.queryByTestId('word-popover')).not.toBeInTheDocument();
    expect(screen.getByText('a small village')).toBeInTheDocument();
    // BottomSheet's close affordance proves it's the sheet, not the popover.
    expect(screen.getByRole('button', { name: 'close' })).toBeInTheDocument();
  });

  it('wires the word sheet save to onBankToggle for the active word', () => {
    const onBankToggle = vi.fn();
    render(
      <AnnotatedView
        {...baseProps}
        activeWord={{ word: 'aldea', x: 100, y: 50 }}
        onBankToggle={onBankToggle}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /\+ save to bank/i }));
    expect(onBankToggle).toHaveBeenCalledWith('aldea');
  });
});
