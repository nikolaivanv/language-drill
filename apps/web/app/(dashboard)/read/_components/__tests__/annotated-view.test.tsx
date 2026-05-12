import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { FlaggedMap } from '@language-drill/shared';
import { CefrLevel } from '@language-drill/shared';
import { AnnotatedView } from '../annotated-view';

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
  calibration: { eyebrow: '~B1+ calibration', explanation: 'showing words rarer than top-3000' },
  isSaving: false,
  onIntensityChange: () => {},
  onPopoverOpen: () => {},
  onPopoverClose: () => {},
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
