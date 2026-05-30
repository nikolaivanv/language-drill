import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { WordFlag, DeepWordCard } from '@language-drill/shared';
import { CefrLevel } from '@language-drill/shared';
import { WordSheet } from '../word-sheet';
import type { DeepSpan } from '../../_state/read-page-reducer';

const ENTRY: WordFlag = {
  lemma: 'aldea',
  pos: 'noun',
  gloss: 'a small village',
  example: 'la aldea está cerca del río',
  freq: 4321,
  cefr: CefrLevel.B2,
};

const baseProps = {
  open: true,
  entry: ENTRY,
  word: 'aldea',
  inBank: false,
  onSave: () => {},
  onSkip: () => {},
  onClose: () => {},
} as const;

describe('WordSheet', () => {
  it('renders the word-card content when open', () => {
    render(<WordSheet {...baseProps} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByText('aldea')).toBeInTheDocument();
    expect(screen.getByText('a small village')).toBeInTheDocument();
    expect(screen.getByText('la aldea está cerca del río')).toBeInTheDocument();
    expect(screen.getByText(/freq #4,321/)).toBeInTheDocument();
  });

  it('does not render when closed', () => {
    render(<WordSheet {...baseProps} open={false} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('does not render when there is no entry', () => {
    render(<WordSheet {...baseProps} entry={null} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('fires onSave and onSkip from the card footer', () => {
    const onSave = vi.fn();
    const onSkip = vi.fn();
    render(<WordSheet {...baseProps} onSave={onSave} onSkip={onSkip} />);
    fireEvent.click(screen.getByRole('button', { name: /\+ save to bank/i }));
    fireEvent.click(screen.getByRole('button', { name: /^skip$/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('closes on the close button and Escape', () => {
    const onClose = vi.fn();
    render(<WordSheet {...baseProps} onClose={onClose} />);

    // Close button in the sheet header.
    fireEvent.click(screen.getByRole('button', { name: 'close' }));
    // Escape (handled by the vaul drawer → onOpenChange(false) → onClose).
    fireEvent.keyDown(document, { key: 'Escape' });

    expect(onClose).toHaveBeenCalledTimes(2);
    // Scrim-click and drag-to-dismiss are pointer-gesture dismissals owned by
    // vaul; they're exercised in the e2e suite rather than simulated in jsdom.
  });

  it('renders a draggable handle (drag up to expand, down to dismiss)', () => {
    render(<WordSheet {...baseProps} />);
    // vaul tags its grabber with data-vaul-handle; its presence is the
    // affordance that the sheet is resizable across snap points.
    expect(document.querySelector('[data-vaul-handle]')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Deep-card states rendered by `deepCard.status` (Req 9.3, 9.4)
// ---------------------------------------------------------------------------

const SPAN: DeepSpan = { start: 0, end: 5, type: 'word', x: 0, y: 0 };

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

describe('WordSheet — deep-card states', () => {
  it('shows the skim preview with an inline "looking it up…" indicator when loading and a flagged entry is present (Req 3.1, 3.3)', () => {
    render(
      <WordSheet
        {...baseProps}
        deepCard={{ status: 'loading', span: SPAN, partial: {} }}
      />,
    );
    expect(screen.getByText('a small village')).toBeInTheDocument();
    expect(screen.getByTestId('skim-loading-deep')).toBeInTheDocument();
    expect(screen.queryByTestId('deep-card-skeleton')).toBeNull();
  });

  it('opens with the skeleton while loading, even without a skim entry (Req 9.3)', () => {
    render(
      <WordSheet
        {...baseProps}
        entry={null}
        deepCard={{ status: 'loading', span: SPAN, partial: {} }}
      />,
    );
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByTestId('deep-card-skeleton')).toBeInTheDocument();
  });

  it('shows the inline error + retry on failure (Req 9.4)', () => {
    const onRetry = vi.fn();
    render(
      <WordSheet
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
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders the loaded deep word card over the skim entry', () => {
    render(
      <WordSheet
        {...baseProps}
        deepCard={{ status: 'loaded', span: SPAN, card: WORD_CARD }}
      />,
    );
    expect(screen.getByText('pueblo pequeño')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /\+ save to vocabulary/i }),
    ).toBeInTheDocument();
  });
});
