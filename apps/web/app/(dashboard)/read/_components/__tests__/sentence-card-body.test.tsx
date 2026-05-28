import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { DeepSentenceCard } from '@language-drill/shared';
import { SentenceCardBody } from '../sentence-card-body';

// ---------------------------------------------------------------------------
// SentenceCardBody — sentence-card layout (Req 5.2, 5.3, 5.4)
// ---------------------------------------------------------------------------

const CARD: DeepSentenceCard = {
  type: 'sentence',
  surface: 'Cuando llegué, ya se habían ido.',
  translation: 'When I arrived, they had already left.',
  breakdown: [
    {
      chunk: 'Cuando llegué',
      role: 'subordinate clause',
      note: 'temporal "when" clause in the preterite',
    },
    {
      chunk: 'ya se habían ido',
      role: 'main clause',
      note: 'pluperfect — completed before another past action',
    },
  ],
  grammarNotes: ['pluperfect tense', 'temporal subordinate clauses'],
};

function noop() {}

describe('SentenceCardBody — translation + breakdown (Req 5.2)', () => {
  it('renders the sentence, its translation, and each chunk with role and note', () => {
    render(<SentenceCardBody card={CARD} onClose={noop} />);
    expect(screen.getByText(/Cuando llegué, ya se habían ido\./)).toBeInTheDocument();
    expect(
      screen.getByText('When I arrived, they had already left.'),
    ).toBeInTheDocument();
    // Each chunk: text + role tag + one-line note.
    expect(screen.getByText('Cuando llegué')).toBeInTheDocument();
    expect(screen.getByText('subordinate clause')).toBeInTheDocument();
    expect(
      screen.getByText('temporal "when" clause in the preterite'),
    ).toBeInTheDocument();
    expect(screen.getByText('ya se habían ido')).toBeInTheDocument();
    expect(screen.getByText('main clause')).toBeInTheDocument();
  });
});

describe('SentenceCardBody — grammar chips (Req 5.3)', () => {
  it('renders grammar topics as non-interactive text when no target resolves', () => {
    render(<SentenceCardBody card={CARD} onClose={noop} />);
    const chip = screen.getByText('pluperfect tense');
    expect(chip).toBeInTheDocument();
    // Plain text — not a link.
    expect(chip.closest('a')).toBeNull();
  });

  it('renders a grammar topic as a deep link when resolveTheoryHref returns an href', () => {
    render(
      <SentenceCardBody
        card={CARD}
        onClose={noop}
        resolveTheoryHref={(note) =>
          note === 'pluperfect tense' ? '/drill?topic=pluperfect' : null
        }
      />,
    );
    const link = screen.getByRole('link', { name: 'pluperfect tense' });
    expect(link).toHaveAttribute('href', '/drill?topic=pluperfect');
    // The unresolved note stays plain text.
    expect(
      screen.queryByRole('link', { name: 'temporal subordinate clauses' }),
    ).toBeNull();
  });
});

describe('SentenceCardBody — no save action (Req 5.4)', () => {
  it('shows no save-to-vocabulary action and disables the translation-drills affordance', () => {
    render(<SentenceCardBody card={CARD} onClose={noop} />);
    expect(
      screen.queryByRole('button', { name: /save/i }),
    ).not.toBeInTheDocument();
    const drills = screen.getByRole('button', {
      name: '+ add to translation drills',
    });
    expect(drills).toBeDisabled();
  });

  it('fires onClose from the close button', () => {
    const onClose = vi.fn();
    render(<SentenceCardBody card={CARD} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
