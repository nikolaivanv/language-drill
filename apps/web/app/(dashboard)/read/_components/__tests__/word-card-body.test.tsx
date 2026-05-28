import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DeepWordCard } from '@language-drill/shared';
import { DeepWordCardBody } from '../word-card-body';

// ---------------------------------------------------------------------------
// DeepWordCardBody — rich word-card layout (Req 6.1–6.5, 7.1)
// ---------------------------------------------------------------------------

const FULL_CARD: DeepWordCard = {
  type: 'word',
  surface: 'geldiğinde',
  lemma: 'gelmek',
  pos: 'verb',
  contextualSense: 'when (he) arrives',
  definition: 'bir yere ulaşmak',
  definitionLabel: 'Türkçe',
  cefr: 'B1',
  freq: 320,
  inflection: { forms: [{ label: 'tense', value: 'aorist' }] },
  morphology: {
    root: 'gel',
    rootGloss: 'come',
    segments: [
      { morph: 'gel', function: 'root' },
      { morph: 'diğ', function: 'participle' },
      { morph: 'in', function: '2sg possessive' },
      { morph: 'de', function: 'locative' },
    ],
    whyThisForm: 'the locative on the participle marks the temporal "when" clause',
  },
  synonyms: [{ word: 'varmak', note: 'more formal' }],
  collocations: [{ phrase: 'eve gelmek', gloss: 'to come home' }],
  register: 'neutral',
  extraExample: { tl: 'O geldiğinde uyuyordum.', en: 'I was sleeping when he arrived.' },
};

const MINIMAL_CARD: DeepWordCard = {
  type: 'word',
  surface: 'casa',
  lemma: 'casa',
  pos: 'noun',
  contextualSense: 'house',
  definition: 'edificio para vivir',
  definitionLabel: 'Español',
  cefr: 'A1',
  freq: 120,
};

function noop() {}

describe('DeepWordCardBody — core fields (Req 6.1)', () => {
  it('renders the inflected headword, pos, CEFR, freq, contextual sense, and labelled definition', () => {
    render(
      <DeepWordCardBody card={FULL_CARD} inBank={false} onSave={noop} onSkip={noop} />,
    );
    // Inflected surface form is the headword (not the lemma).
    expect(screen.getByText('geldiğinde')).toBeInTheDocument();
    expect(screen.getByText('verb')).toBeInTheDocument();
    expect(screen.getByText('B1')).toBeInTheDocument();
    expect(screen.getByText(/#320/)).toBeInTheDocument();
    // Lemma shown as a secondary hint when it differs from the surface.
    expect(screen.getByText(/gelmek/)).toBeInTheDocument();
    expect(screen.getByText(/when \(he\) arrives/)).toBeInTheDocument();
    // Definition labelled with the language's own name (Req 6.6).
    expect(screen.getByText('Türkçe')).toBeInTheDocument();
    expect(screen.getByText('bir yere ulaşmak')).toBeInTheDocument();
  });

  it('renders the inline inflection line (Req 6.2)', () => {
    render(
      <DeepWordCardBody card={FULL_CARD} inBank={false} onSave={noop} onSkip={noop} />,
    );
    expect(screen.getByText('tense aorist')).toBeInTheDocument();
  });
});

describe('DeepWordCardBody — morphology (Req 6.3, 7.1)', () => {
  it('renders each morpheme segment with its function and the "why this form" note', () => {
    render(
      <DeepWordCardBody card={FULL_CARD} inBank={false} onSave={noop} onSkip={noop} />,
    );
    expect(screen.getByText('diğ')).toBeInTheDocument();
    expect(screen.getByText('participle')).toBeInTheDocument();
    expect(screen.getByText('locative')).toBeInTheDocument();
    expect(screen.getByText('why this form')).toBeInTheDocument();
    expect(
      screen.getByText(/marks the temporal "when" clause/),
    ).toBeInTheDocument();
  });
});

describe('DeepWordCardBody — collapsible extras (Req 6.4)', () => {
  it('keeps synonyms collapsed by default and reveals them on click', () => {
    render(
      <DeepWordCardBody card={FULL_CARD} inBank={false} onSave={noop} onSkip={noop} />,
    );
    const toggle = screen.getByRole('button', { name: /synonyms/i });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // Collapsed → synonym content not visible yet.
    expect(screen.queryByText('varmak')).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('varmak')).toBeInTheDocument();
    expect(screen.getByText(/more formal/)).toBeInTheDocument();
  });

  it('exposes collocations, register, and extra-example sections', () => {
    render(
      <DeepWordCardBody card={FULL_CARD} inBank={false} onSave={noop} onSkip={noop} />,
    );
    expect(
      screen.getByRole('button', { name: /collocations/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /register/i })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /another example/i }),
    ).toBeInTheDocument();
  });
});

describe('DeepWordCardBody — absent optional fields (Req 6.5)', () => {
  it('omits inflection, morphology, and all extras when absent — no empty blocks', () => {
    render(
      <DeepWordCardBody card={MINIMAL_CARD} inBank={false} onSave={noop} onSkip={noop} />,
    );
    expect(screen.queryByText('morphology')).not.toBeInTheDocument();
    expect(screen.queryByText('why this form')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /synonyms/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /register/i })).not.toBeInTheDocument();
    // Minimal card: lemma === surface, so no secondary lemma hint duplication.
    expect(screen.getByText('casa')).toBeInTheDocument();
  });
});

describe('DeepWordCardBody — save/skip footer', () => {
  it('fires onSave and onSkip and reflects the saved state', () => {
    const onSave = vi.fn();
    const onSkip = vi.fn();
    const { rerender } = render(
      <DeepWordCardBody card={MINIMAL_CARD} inBank={false} onSave={onSave} onSkip={onSkip} />,
    );
    expect(screen.getByRole('button', { name: '+ save to vocabulary' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '+ save to vocabulary' }));
    fireEvent.click(screen.getByRole('button', { name: 'skip' }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSkip).toHaveBeenCalledTimes(1);

    rerender(
      <DeepWordCardBody card={MINIMAL_CARD} inBank onSave={onSave} onSkip={onSkip} />,
    );
    expect(screen.getByRole('button', { name: '✓ saved · undo' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'close' })).toBeInTheDocument();
  });
});
