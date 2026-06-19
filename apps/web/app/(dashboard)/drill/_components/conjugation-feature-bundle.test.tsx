import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ExerciseType, type ConjugationContent } from '@language-drill/shared';
import { ConjugationFeatureBundle } from './conjugation-feature-bundle';

const BASE: ConjugationContent = {
  type: ExerciseType.CONJUGATION,
  instructions: 'Write the correct form.',
  lemma: 'içmek',
  lemmaGloss: 'to drink',
  featureBundle: 'geçmiş zaman · olumlu · 3. tekil şahıs (o)',
  targetForm: 'içti',
  breakdown: 'iç- + -ti',
  exampleSentences: ['O su içti.'],
};

const STRUCTURED: ConjugationContent = {
  ...BASE,
  features: [
    { term: 'geçmiş zaman', gloss: 'past' },
    { term: 'olumlu', gloss: 'affirmative' },
  ],
  subject: { pronoun: 'o', gloss: 'he / she / it' },
};

describe('ConjugationFeatureBundle', () => {
  it('card variant renders the pronoun badge and a chip per feature with glosses', () => {
    render(<ConjugationFeatureBundle content={STRUCTURED} />);
    expect(screen.getByText('o')).toBeInTheDocument();
    expect(screen.getByText('he / she / it')).toBeInTheDocument();
    expect(screen.getByText('geçmiş zaman')).toBeInTheDocument();
    expect(screen.getByText('past')).toBeInTheDocument();
    expect(screen.getByText('olumlu')).toBeInTheDocument();
    expect(screen.getByText('affirmative')).toBeInTheDocument();
    // The flat string is NOT shown when structured data is present.
    expect(screen.queryByText(BASE.featureBundle)).not.toBeInTheDocument();
  });

  it('card variant falls back to the flat featureBundle when structured data is absent', () => {
    render(<ConjugationFeatureBundle content={BASE} />);
    expect(screen.getByText(BASE.featureBundle)).toBeInTheDocument();
  });

  it('inline variant renders a compact dot-joined string', () => {
    render(<ConjugationFeatureBundle content={STRUCTURED} variant="inline" />);
    expect(
      screen.getByText('o (he / she / it) · geçmiş zaman (past) · olumlu (affirmative)'),
    ).toBeInTheDocument();
  });

  it('inline variant falls back to the flat featureBundle when structured data is absent', () => {
    render(<ConjugationFeatureBundle content={BASE} variant="inline" />);
    expect(screen.getByText(BASE.featureBundle)).toBeInTheDocument();
  });
});
