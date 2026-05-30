import { describe, it, expect } from 'vitest';
import { Language } from '@language-drill/shared';
import {
  normalize,
  gradeCloze,
  gradeMeaning,
  gradeRecognition,
} from './grading';

const { ES, DE, TR } = Language;

describe('normalize', () => {
  it('trims and collapses internal whitespace', () => {
    expect(normalize('  hola   mundo  ', ES)).toBe('hola mundo');
  });

  it('locale-lowercases without stripping accents (ES)', () => {
    expect(normalize('COMIÓ', ES)).toBe('comió');
  });

  it('lowercases German nouns and preserves ß/umlauts (DE)', () => {
    expect(normalize('Straße', DE)).toBe('straße');
    expect(normalize('SCHÖN', DE)).toBe('schön');
  });

  it('uses Turkish dotted/dotless i casing (TR)', () => {
    // Turkish locale: İ → i, I → ı
    expect(normalize('İYİ', TR)).toBe('iyi');
    expect(normalize('IŞIK', TR)).toBe('ışık');
  });
});

describe('gradeCloze', () => {
  it('returns correct on an exact (case/whitespace-insensitive) match', () => {
    expect(gradeCloze('comió', 'comió', ES)).toBe('correct');
    expect(gradeCloze('  COMIÓ ', 'comió', ES)).toBe('correct');
  });

  it('returns partial on an accent-only mismatch (Req 5.2)', () => {
    expect(gradeCloze('comio', 'comió', ES)).toBe('partial');
  });

  it('returns partial on a German umlaut-only mismatch', () => {
    expect(gradeCloze('schon', 'schön', DE)).toBe('partial');
  });

  it('returns incorrect on a genuinely wrong answer', () => {
    expect(gradeCloze('bebió', 'comió', ES)).toBe('incorrect');
  });

  it('returns incorrect on an empty answer', () => {
    expect(gradeCloze('   ', 'comió', ES)).toBe('incorrect');
  });
});

describe('gradeMeaning', () => {
  const forms = ['comer', 'como', 'comió'];

  it('returns correct when the answer matches the lemma', () => {
    expect(gradeMeaning('comer', forms, ES)).toBe('correct');
  });

  it('returns correct when the answer matches an accepted inflected form', () => {
    expect(gradeMeaning('comió', forms, ES)).toBe('correct');
  });

  it('returns partial on an accent-only mismatch against any form', () => {
    expect(gradeMeaning('comio', forms, ES)).toBe('partial');
  });

  it('returns incorrect when no form matches', () => {
    expect(gradeMeaning('beber', forms, ES)).toBe('incorrect');
  });

  it('downgrades a correct hint-assisted answer to partial (Req 6.2, 6.3)', () => {
    expect(gradeMeaning('comer', forms, ES, 1)).toBe('partial');
    expect(gradeMeaning('comer', forms, ES, 3)).toBe('partial');
  });

  it('does not upgrade an incorrect answer regardless of hints', () => {
    expect(gradeMeaning('beber', forms, ES, 2)).toBe('incorrect');
  });

  it('keeps an accent-partial answer as partial when hints were used', () => {
    expect(gradeMeaning('comio', forms, ES, 2)).toBe('partial');
  });

  it('matches a German form via locale-aware normalization', () => {
    expect(gradeMeaning('Häuser', ['Haus', 'Häuser'], DE)).toBe('correct');
  });

  it('matches a Turkish form via dotted/dotless i normalization', () => {
    expect(gradeMeaning('İYİ', ['iyi'], TR)).toBe('correct');
  });
});

describe('gradeRecognition', () => {
  it('returns correct on an exact key match', () => {
    expect(gradeRecognition('a', 'a')).toBe('correct');
  });

  it('returns incorrect on a key mismatch (no partial)', () => {
    expect(gradeRecognition('b', 'a')).toBe('incorrect');
  });
});
