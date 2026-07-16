import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DeepPhraseCard } from '@language-drill/shared';
import { PhraseCardBody } from '../phrase-card-body';

// ---------------------------------------------------------------------------
// PhraseCardBody — rich phrase-card layout (Req 4.2, 8.4)
// ---------------------------------------------------------------------------

const FULL_CARD: DeepPhraseCard = {
  type: 'phrase',
  surface: 'dar en el clavo',
  citation: 'dar en el clavo',
  literal: 'to give on the nail',
  idiomaticMeaning: 'to hit the nail on the head',
  register: 'colloquial',
  example: { tl: 'Diste en el clavo.', en: 'You hit the nail on the head.' },
  synonyms: [{ phrase: 'acertar de pleno', note: 'more neutral' }],
};

const MINIMAL_CARD: DeepPhraseCard = {
  type: 'phrase',
  surface: 'por si acaso',
  literal: 'for if case',
  idiomaticMeaning: 'just in case',
  register: 'neutral',
};

function noop() {}

describe('PhraseCardBody — core fields (Req 4.2)', () => {
  it('renders the citation headword, register, idiomatic meaning, and literal rendering', () => {
    render(
      <PhraseCardBody card={FULL_CARD} inBank={false} onSave={noop} onSkip={noop} />,
    );
    expect(screen.getByText('dar en el clavo')).toBeInTheDocument();
    expect(screen.getByText('phrase')).toBeInTheDocument();
    expect(screen.getByText(/colloquial/)).toBeInTheDocument();
    expect(screen.getByText(/to hit the nail on the head/)).toBeInTheDocument();
    expect(screen.getByText('to give on the nail')).toBeInTheDocument();
  });

  it('falls back to the surface form when no citation is supplied', () => {
    render(
      <PhraseCardBody card={MINIMAL_CARD} inBank={false} onSave={noop} onSkip={noop} />,
    );
    expect(screen.getByText('por si acaso')).toBeInTheDocument();
  });

  it('renders the example and synonymous expressions when present', () => {
    render(
      <PhraseCardBody card={FULL_CARD} inBank={false} onSave={noop} onSkip={noop} />,
    );
    expect(screen.getByText('Diste en el clavo.')).toBeInTheDocument();
    expect(screen.getByText('You hit the nail on the head.')).toBeInTheDocument();
    expect(screen.getByText('acertar de pleno')).toBeInTheDocument();
    expect(screen.getByText(/more neutral/)).toBeInTheDocument();
  });
});

describe('PhraseCardBody — absent optional fields', () => {
  it('omits the example and synonyms cleanly when absent — no empty blocks', () => {
    render(
      <PhraseCardBody card={MINIMAL_CARD} inBank={false} onSave={noop} onSkip={noop} />,
    );
    expect(screen.queryByText('example')).not.toBeInTheDocument();
    expect(
      screen.queryByText('synonymous expressions'),
    ).not.toBeInTheDocument();
  });
});

describe('PhraseCardBody — save/skip footer (Req 8.4)', () => {
  it('fires onSave and onSkip and reflects the saved state', () => {
    const onSave = vi.fn();
    const onSkip = vi.fn();
    const { rerender } = render(
      <PhraseCardBody card={FULL_CARD} inBank={false} onSave={onSave} onSkip={onSkip} />,
    );
    expect(
      screen.getByRole('button', { name: '+ save phrase' }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ save phrase' }));
    fireEvent.click(screen.getByRole('button', { name: 'skip' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);

    rerender(
      <PhraseCardBody card={FULL_CARD} inBank onSave={onSave} onSkip={onSkip} />,
    );
    expect(
      screen.getByRole('button', { name: '✓ saved · remove' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'close' })).toBeInTheDocument();
  });
});
