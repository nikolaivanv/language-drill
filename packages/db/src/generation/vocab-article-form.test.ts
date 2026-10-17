import { describe, expect, it } from 'vitest';
import { articleFormFor, languageHasArticles, matchTargetDisplayForm } from './vocab-article-form';

describe('articleFormFor', () => {
  it('prefers the curated display form', () => {
    expect(articleFormFor('espalda', 'la espalda')).toBe('la espalda');
    expect(articleFormFor('el mano', 'la mano')).toBe('la mano');
  });
  it('falls back to an article already on expectedWord', () => {
    expect(articleFormFor('die Küche', null)).toBe('die Küche');
  });
  it('is null for bare forms and indefinite-only forms', () => {
    expect(articleFormFor('correr', 'correr')).toBeNull();
    expect(articleFormFor('empatía', null)).toBeNull();
    expect(articleFormFor('ein Hund', null)).toBeNull();
  });
});

describe('matchTargetDisplayForm', () => {
  const targets = [
    { lemma: 'espalda', displayForm: 'la espalda' },
    { lemma: 'Schule', displayForm: 'die Schule' },
  ];
  it('matches by lemma or display form, ignoring an article on expectedWord', () => {
    expect(matchTargetDisplayForm(targets, 'Espalda')).toBe('la espalda');
    expect(matchTargetDisplayForm(targets, 'die Schule')).toBe('die Schule');
    expect(matchTargetDisplayForm(targets, 'cabeza')).toBeNull();
  });
});

describe('languageHasArticles', () => {
  it('covers ES and DE only', () => {
    expect(languageHasArticles('ES')).toBe(true);
    expect(languageHasArticles('DE')).toBe(true);
    expect(languageHasArticles('TR')).toBe(false);
  });
});
