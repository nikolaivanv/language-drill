import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type {
  WordFlag,
  DeepWordCard,
  DeepSentenceCard,
} from '@language-drill/shared';
import { CefrLevel } from '@language-drill/shared';
import { WordPopover } from '../word-popover';
import { WordCardBody } from '../word-card-body';
import type { DeepSpan } from '../../_state/read-page-reducer';

// ---------------------------------------------------------------------------
// WordPopover — callbacks, keyboard escape, position clamp.
// (Requirements 7.1–7.7, 14.3)
// ---------------------------------------------------------------------------

const ENTRY: WordFlag = {
  lemma: 'aldea',
  pos: 'noun',
  gloss: 'a small village',
  example: 'la aldea está cerca del río',
  freq: 4321,
  cefr: CefrLevel.B2,
};

const baseProps = {
  entry: ENTRY,
  word: 'aldea',
  x: 600,
  y: 200,
  containerWidth: 1200,
  inBank: false,
  onSave: () => {},
  onSkip: () => {},
  onClose: () => {},
} as const;

describe('WordPopover — header / body content', () => {
  it('renders the lemma, POS, gloss, CEFR, example, and freq', () => {
    render(<WordPopover {...baseProps} />);
    expect(screen.getByText('aldea')).toBeInTheDocument();
    expect(screen.getByText('noun')).toBeInTheDocument();
    expect(screen.getByText('a small village')).toBeInTheDocument();
    expect(screen.getByText('B2')).toBeInTheDocument();
    expect(
      screen.getByText('la aldea está cerca del río'),
    ).toBeInTheDocument();
    // 4321 is rendered with the en-US thousands separator: "4,321".
    expect(screen.getByText(/freq #4,321/)).toBeInTheDocument();
  });
});

describe('WordPopover — save / skip / Escape', () => {
  it('clicking save fires onSave', () => {
    const onSave = vi.fn();
    render(<WordPopover {...baseProps} onSave={onSave} />);
    fireEvent.click(
      screen.getByRole('button', { name: /\+ save to bank/i }),
    );
    expect(onSave).toHaveBeenCalledTimes(1);
  });

  it('shows the "✓ saved · undo" accent button when inBank is true', () => {
    const onSave = vi.fn();
    render(<WordPopover {...baseProps} inBank={true} onSave={onSave} />);
    const button = screen.getByRole('button', { name: /✓ saved · undo/i });
    expect(button).toBeInTheDocument();
    fireEvent.click(button);
    expect(onSave).toHaveBeenCalledTimes(1);
    // The "+ save to bank" label should not be on screen when banked.
    expect(
      screen.queryByRole('button', { name: /\+ save to bank/i }),
    ).not.toBeInTheDocument();
  });

  it('shows "close" instead of "skip" when inBank is true', () => {
    render(<WordPopover {...baseProps} inBank={true} />);
    expect(screen.getByRole('button', { name: /^close$/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^skip$/i })).not.toBeInTheDocument();
  });

  it('clicking skip fires onSkip', () => {
    const onSkip = vi.fn();
    render(<WordPopover {...baseProps} onSkip={onSkip} />);
    fireEvent.click(screen.getByRole('button', { name: /^skip$/i }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('Escape on the popover fires onClose', () => {
    const onClose = vi.fn();
    render(<WordPopover {...baseProps} onClose={onClose} />);
    const dialog = screen.getByRole('dialog');
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicks inside the popover do not bubble (parent outside-click handler is shielded)', () => {
    const parentClick = vi.fn();
    render(
      <div onClick={parentClick}>
        <WordPopover {...baseProps} />
      </div>,
    );
    fireEvent.click(screen.getByRole('dialog'));
    expect(parentClick).not.toHaveBeenCalled();
  });

  it('clicking outside the popover fires onClose', () => {
    const onClose = vi.fn();
    render(
      <div>
        <div data-testid="outside">outside area</div>
        <WordPopover {...baseProps} onClose={onClose} />
      </div>,
    );
    fireEvent.mouseDown(screen.getByTestId('outside'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('clicking on a word button (data-word) does not close the popover', () => {
    const onClose = vi.fn();
    render(
      <div>
        <button data-word="test">word button</button>
        <WordPopover {...baseProps} onClose={onClose} />
      </div>,
    );
    fireEvent.mouseDown(screen.getByRole('button', { name: 'word button' }));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('clicking inside the popover does not fire onClose', () => {
    const onClose = vi.fn();
    render(
      <div>
        <div data-testid="outside">outside area</div>
        <WordPopover {...baseProps} onClose={onClose} />
      </div>,
    );
    fireEvent.mouseDown(screen.getByRole('dialog'));
    expect(onClose).not.toHaveBeenCalled();
  });
});

describe('WordPopover — position clamp', () => {
  it('pins to left edge (left = 8) when x = 0', () => {
    render(<WordPopover {...baseProps} x={0} containerWidth={1200} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.style.left).toBe('8px');
  });

  it('pins to right edge (left = containerWidth - 320) when x = containerWidth', () => {
    render(<WordPopover {...baseProps} x={1200} containerWidth={1200} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.style.left).toBe('880px'); // 1200 - 320
  });

  it('centers the card on the click coordinate when there is room on both sides', () => {
    render(<WordPopover {...baseProps} x={600} containerWidth={1200} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.style.left).toBe('440px'); // 600 - 160
  });

  it('places top at the supplied y', () => {
    render(<WordPopover {...baseProps} y={250} />);
    const dialog = screen.getByRole('dialog');
    expect(dialog.style.top).toBe('250px');
  });
});

describe('WordCardBody — shared content (extracted from the popover)', () => {
  it('renders the lemma, POS, gloss, CEFR, example, and freq', () => {
    render(
      <WordCardBody
        entry={ENTRY}
        inBank={false}
        onSave={() => {}}
        onSkip={() => {}}
      />,
    );
    expect(screen.getByText('aldea')).toBeInTheDocument();
    expect(screen.getByText('noun')).toBeInTheDocument();
    expect(screen.getByText('a small village')).toBeInTheDocument();
    expect(screen.getByText('B2')).toBeInTheDocument();
    expect(screen.getByText('la aldea está cerca del río')).toBeInTheDocument();
    expect(screen.getByText(/freq #4,321/)).toBeInTheDocument();
  });

  it('fires onSave / onSkip from the footer buttons', () => {
    const onSave = vi.fn();
    const onSkip = vi.fn();
    render(
      <WordCardBody
        entry={ENTRY}
        inBank={false}
        onSave={onSave}
        onSkip={onSkip}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /\+ save to bank/i }));
    fireEvent.click(screen.getByRole('button', { name: /^skip$/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('swaps to the banked labels when inBank is true', () => {
    render(
      <WordCardBody
        entry={ENTRY}
        inBank={true}
        onSave={() => {}}
        onSkip={() => {}}
      />,
    );
    expect(
      screen.getByRole('button', { name: /✓ saved · undo/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^close$/i })).toBeInTheDocument();
  });

  // Req 3.1 + 3.3 clarity — the user must see that a richer card is loading.
  it('replaces the freq line with a "looking it up…" caption when loadingDeep is true', () => {
    const { rerender } = render(
      <WordCardBody
        entry={ENTRY}
        inBank={false}
        onSave={() => {}}
        onSkip={() => {}}
      />,
    );
    expect(screen.getByText(/freq #4,321/)).toBeInTheDocument();
    expect(screen.queryByTestId('skim-loading-deep')).toBeNull();

    rerender(
      <WordCardBody
        entry={ENTRY}
        inBank={false}
        onSave={() => {}}
        onSkip={() => {}}
        loadingDeep
      />,
    );
    expect(screen.queryByText(/freq #4,321/)).toBeNull();
    const indicator = screen.getByTestId('skim-loading-deep');
    expect(indicator).toHaveTextContent(/looking it up/i);
    // Save/skip stay live so the user can still bank the skim or dismiss.
    expect(
      screen.getByRole('button', { name: /\+ save to bank/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^skip$/i })).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Deep-card states rendered by `deepCard.status` (Req 9.3, 9.4)
// ---------------------------------------------------------------------------

const SPAN: DeepSpan = { start: 0, end: 5, type: 'word', x: 600, y: 200 };

const WORD_CARD: DeepWordCard = {
  type: 'word',
  surface: 'aldea',
  lemma: 'aldea',
  pos: 'noun',
  contextualSense: 'small village',
  definition: 'pueblo pequeño',
  definitionLabel: 'Español',
  cefr: 'B2',
  freq: 4321,
};

const SENTENCE_CARD: DeepSentenceCard = {
  type: 'sentence',
  surface: 'La aldea está cerca.',
  translation: 'The village is near.',
  breakdown: [{ chunk: 'La aldea', role: 'subject', note: 'the village' }],
  grammarNotes: ['definite article'],
};

describe('WordPopover — skim preview while the deep card loads (Req 3.1, 3.3)', () => {
  it('renders the skim WordCardBody with the inline "looking it up…" indicator when loading and an entry is present', () => {
    render(
      <WordPopover
        {...baseProps}
        deepCard={{ status: 'loading', span: SPAN }}
      />,
    );
    // Skim card content (the gloss) shows…
    expect(screen.getByText('a small village')).toBeInTheDocument();
    // …with the loading indicator swapped in for the freq line…
    expect(screen.getByTestId('skim-loading-deep')).toBeInTheDocument();
    expect(screen.queryByText(/freq #/)).toBeNull();
    // …and the skeleton is NOT shown (the chrome chose skim preview, not skeleton).
    expect(screen.queryByTestId('deep-card-skeleton')).toBeNull();
  });
});

describe('WordPopover — deep-card loading (Req 9.3)', () => {
  it('keeps the chrome mounted and shows the "looking it up" skeleton', () => {
    render(
      <WordPopover
        {...baseProps}
        entry={null}
        deepCard={{ status: 'loading', span: SPAN }}
      />,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('deep-card-skeleton')).toBeInTheDocument();
    expect(screen.getByText(/looking it up/i)).toBeInTheDocument();
    // The skim entry body is not shown while the deep card loads.
    expect(screen.queryByText('a small village')).not.toBeInTheDocument();
  });
});

describe('WordPopover — deep-card error (Req 9.4)', () => {
  it('shows an inline error with an enabled retry that fires onRetry', () => {
    const onRetry = vi.fn();
    render(
      <WordPopover
        {...baseProps}
        entry={null}
        onRetry={onRetry}
        deepCard={{
          status: 'error',
          span: SPAN,
          error: { code: 'ai_unavailable', message: 'network blip', status: 502 },
        }}
      />,
    );
    expect(screen.getByTestId('deep-card-error')).toBeInTheDocument();
    expect(screen.getByText('network blip')).toBeInTheDocument();
    const retry = screen.getByRole('button', { name: /try again/i });
    expect(retry).toBeEnabled();
    fireEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('disables retry on a rate-limit (429)', () => {
    render(
      <WordPopover
        {...baseProps}
        entry={null}
        deepCard={{
          status: 'error',
          span: SPAN,
          error: { code: 'rate_limited', message: 'daily limit reached', status: 429 },
        }}
      />,
    );
    expect(screen.getByRole('button', { name: /try again/i })).toBeDisabled();
  });
});

describe('WordPopover — deep-card loaded', () => {
  it('renders the loaded word card and takes precedence over the skim entry', () => {
    render(
      <WordPopover
        {...baseProps}
        deepCard={{ status: 'loaded', span: SPAN, card: WORD_CARD }}
      />,
    );
    expect(screen.getByText('pueblo pequeño')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /\+ save to vocabulary/i }),
    ).toBeInTheDocument();
    // The skim card's "+ save to bank" label is gone — deep card won.
    expect(
      screen.queryByRole('button', { name: /\+ save to bank/i }),
    ).not.toBeInTheDocument();
  });

  it('renders a loaded sentence card with no save action', () => {
    render(
      <WordPopover
        {...baseProps}
        entry={null}
        deepCard={{
          status: 'loaded',
          span: { ...SPAN, type: 'sentence' },
          card: SENTENCE_CARD,
        }}
      />,
    );
    expect(screen.getByText('The village is near.')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /save/i }),
    ).not.toBeInTheDocument();
  });
});

describe('WordPopover — autoFocus', () => {
  it('focuses the skip button when autoFocus is true', () => {
    render(<WordPopover {...baseProps} autoFocus />);
    expect(
      screen.getByRole('button', { name: /^skip$/i }),
    ).toHaveFocus();
  });

  it('focuses the close button when autoFocus is true and inBank is true', () => {
    render(<WordPopover {...baseProps} autoFocus inBank={true} />);
    expect(
      screen.getByRole('button', { name: /^close$/i }),
    ).toHaveFocus();
  });

  it('does not steal focus when autoFocus is false', () => {
    render(<WordPopover {...baseProps} />);
    expect(
      screen.getByRole('button', { name: /^skip$/i }),
    ).not.toHaveFocus();
  });
});
