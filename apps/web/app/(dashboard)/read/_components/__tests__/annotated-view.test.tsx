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

// AnnotatedView calls useActiveLanguage() — mock it so tests don't need
// to mount the full ActiveLanguageProvider tree.
vi.mock('../../../../../components/shell/active-language-provider', () => ({
  useActiveLanguage: () => ({ activeLanguage: 'ES' }),
}));

// Audio-control placement tests only need a marker — the real PassageAudio
// needs a QueryClient + audio hook we don't want to wire up here. Exposes the
// `floating`/`floatingSuppressed` props as data attributes so the mobile
// floating-control wiring test (below) can assert on them without needing
// the real component.
vi.mock('../passage-audio', () => ({
  PassageAudio: (props: { floating?: boolean; floatingSuppressed?: boolean }) => (
    <div
      data-testid="passage-audio"
      data-floating={String(props.floating ?? false)}
      data-suppressed={String(props.floatingSuppressed ?? false)}
    />
  ),
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
  onIntensityChange: () => {},
  onPopoverOpen: () => {},
  onPopoverClose: () => {},
  onSpanSelect: () => {},
  onDeepRetry: () => {},
  onSaveCard: () => {},
  onUndoCard: () => {},
  savedSpan: null,
  savedWordKeys: new Set<string>(),
  savedVocab: [],
  onUnsaveVocab: () => {},
  onBankToggle: () => {},
  onPasteNew: () => {},
  flaggedCount: 0,
  savedCount: 0,
  languageLabel: 'español',
};

describe('AnnotatedView — flagged ≥ 1', () => {
  it('renders the header, calibration strip, reader, and word-bank rail when there is at least one flagged word', () => {
    render(<AnnotatedView {...baseProps} />);
    expect(screen.getByText('Cien años — ch. 1')).toBeInTheDocument();
    expect(screen.getByText('García Márquez')).toBeInTheDocument();
    expect(screen.getByText('~B1+ calibration')).toBeInTheDocument();
    expect(screen.getByText('word bank')).toBeInTheDocument();
    // The legacy footer "save N to bank →" button is gone — bank saves persist
    // immediately, so the explicit save action was redundant. The redesigned
    // CollectBar now renders the flagged/saved tally + library/vocab actions.
    expect(
      screen.queryByRole('button', { name: /save \d+ to bank/i }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(/flagged ·/)).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /save text/i }),
    ).toBeInTheDocument();
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
    render(
      <AnnotatedView
        {...baseProps}
        savedVocab={[
          {
            id: '11111111-1111-1111-1111-111111111111',
            word: 'aldea',
            lemma: 'aldea',
            gloss: 'a small village',
            type: 'word',
            cefr: CefrLevel.B2,
          },
        ]}
      />,
    );
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

// ---------------------------------------------------------------------------
// Span-select forwarding. AnnotatedView no longer anchors tap-first/tap-last;
// AnnotatedText resolves the full span (a tap → word, a drag → phrase/sentence)
// and AnnotatedView just maps the rect to container coords and forwards it. The
// touch-drag GESTURE needs real layout (elementFromPoint), so it's covered by
// the touch E2E (read-mobile-touch.spec); here we assert the forwarding via the
// mouse-drag path, which shares the same resolve/emit core in AnnotatedText.
// ---------------------------------------------------------------------------

describe('AnnotatedView — span-select forwarding', () => {
  beforeEach(() => mockIsMobile.mockReturnValue(true));

  // la[0,2] aldea[3,8] grande[9,15] es[16,18]
  const TEXT = 'la aldea grande es';
  const tapProps = {
    ...baseProps,
    entry: { ...baseProps.entry, text: TEXT, flaggedWords: {} as FlaggedMap },
  };

  it('forwards a plain tap as a one-word span', () => {
    const onSpanSelect = vi.fn();
    render(
      <AnnotatedView {...tapProps} onSpanSelect={onSpanSelect} deepCard={{ status: 'idle' }} />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'aldea' }));
    expect(onSpanSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({ start: 3, end: 8, type: 'word' }),
    );
  });

  it('forwards a multi-word drag as a single phrase span (one emit, no anchoring)', () => {
    const onSpanSelect = vi.fn();
    render(
      <AnnotatedView {...tapProps} onSpanSelect={onSpanSelect} deepCard={{ status: 'idle' }} />,
    );

    fireEvent.mouseDown(screen.getByRole('button', { name: 'aldea' }));
    fireEvent.mouseEnter(screen.getByRole('button', { name: 'grande' }));
    fireEvent.mouseUp(window);

    expect(onSpanSelect).toHaveBeenCalledTimes(1);
    expect(onSpanSelect).toHaveBeenLastCalledWith(
      expect.objectContaining({ start: 3, end: 15, type: 'phrase' }),
    );

    // A real browser fires a synthetic click on the container after a
    // cross-element drag; finalizeSelection installs a one-shot swallower for
    // exactly that click (so the open card isn't dismissed). Fire it here to
    // mirror the browser and consume the listener (no second emit).
    fireEvent.click(screen.getByRole('button', { name: 'grande' }));
    expect(onSpanSelect).toHaveBeenCalledTimes(1);
  });
});

describe('AnnotatedView — Listen audio control placement', () => {
  const audioProps = { ...baseProps, entryId: 'entry-1', fetchFn: (() => {}) as never };

  it('renders the audio control (desktop) before the calibration strip, not in the header cluster', () => {
    mockIsMobile.mockReturnValue(false);
    render(<AnnotatedView {...audioProps} />);
    const audio = screen.getByTestId('passage-audio');
    const intensity = screen.getByRole('radiogroup'); // IntensityToggle lives in the header cluster
    // Audio precedes the calibration eyebrow, and is a sibling row (not inside the intensity/header cluster).
    expect(audio).toBeInTheDocument();
    // New layout: the audio row sits AFTER the header block (which contains the
    // IntensityToggle), so the audio marker follows the toggle in document order.
    // In the old layout it preceded the toggle inside the header cluster — this
    // assertion fails there, so it genuinely guards the relocation.
    expect(
      intensity.compareDocumentPosition(audio) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('renders the audio control on mobile, after the header word-bank chip', () => {
    mockIsMobile.mockReturnValue(true);
    render(<AnnotatedView {...audioProps} />);
    const audio = screen.getByTestId('passage-audio');
    expect(audio).toBeInTheDocument();
    // baseProps has 1 flagged word, so showRail is true and the mobile header
    // renders the "word bank · N" chip. The audio row sits below the header,
    // so the marker follows the chip in document order — guards against a
    // future mobile-only edit silently moving the row above the header.
    const wordBank = screen.getByRole('button', { name: /word bank/i });
    expect(
      wordBank.compareDocumentPosition(audio) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it('hides the audio control when there is no persisted entry', () => {
    mockIsMobile.mockReturnValue(false);
    render(<AnnotatedView {...baseProps} />); // baseProps has no entryId/fetchFn
    expect(screen.queryByTestId('passage-audio')).not.toBeInTheDocument();
  });

  it('enables floating on mobile and suppresses it while a bottom sheet is open', () => {
    mockIsMobile.mockReturnValue(true);
    const { rerender } = render(<AnnotatedView {...audioProps} />);
    expect(screen.getByTestId('passage-audio')).toHaveAttribute('data-floating', 'true');
    expect(screen.getByTestId('passage-audio')).toHaveAttribute('data-suppressed', 'false');

    // A loaded/loading deep card opens the word sheet (cardOpen) → floating is
    // suppressed. The 'loading' slice must carry a `span` — annotated-view
    // reads deepCard.span when deepActive.
    rerender(
      <AnnotatedView
        {...audioProps}
        deepCard={{
          status: 'loading',
          span: { start: 0, end: 5, type: 'word', x: 100, y: 50 },
          partial: {},
        }}
      />,
    );
    expect(screen.getByTestId('passage-audio')).toHaveAttribute('data-suppressed', 'true');
  });

  it('suppresses floating when the word-bank sheet is open (mobile)', async () => {
    mockIsMobile.mockReturnValue(true);
    render(<AnnotatedView {...audioProps} />);
    expect(screen.getByTestId('passage-audio')).toHaveAttribute('data-suppressed', 'false');
    // Open the word-bank sheet via the header chip → bankSheetOpen → suppressed.
    fireEvent.click(screen.getByRole('button', { name: /word bank/i }));
    expect(screen.getByTestId('passage-audio')).toHaveAttribute('data-suppressed', 'true');
  });
});
