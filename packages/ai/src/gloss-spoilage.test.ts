import { describe, expect, it } from 'vitest';

import {
  GLOSS_SPOILAGE_PROMPT_VERSION,
  parseGlossVerdict,
  parsePointTriageVerdict,
} from './gloss-spoilage.js';

describe('parsePointTriageVerdict', () => {
  it('accepts a well-formed verdict', () => {
    const v = parsePointTriageVerdict({
      englishEncodesDistinction: false,
      reasoning: 'English "is" covers both ser and estar.',
      confidence: 'high',
    });
    expect(v.englishEncodesDistinction).toBe(false);
    expect(v.confidence).toBe('high');
  });

  it('rejects a missing boolean rather than coercing it', () => {
    expect(() => parsePointTriageVerdict({ reasoning: 'x', confidence: 'high' })).toThrow(
      /englishEncodesDistinction/,
    );
  });

  it('rejects an unknown confidence', () => {
    expect(() =>
      parsePointTriageVerdict({
        englishEncodesDistinction: true,
        reasoning: 'x',
        confidence: 'certain',
      }),
    ).toThrow(/confidence/);
  });

  it('rejects empty reasoning', () => {
    expect(() =>
      parsePointTriageVerdict({
        englishEncodesDistinction: true,
        reasoning: '   ',
        confidence: 'low',
      }),
    ).toThrow(/reasoning/);
  });
});

describe('parseGlossVerdict', () => {
  const spoiled = {
    verdict: 'spoiled',
    offendingSpan: '(a current condition)',
    proposedGloss: 'Today the weather is very bad.',
    loadBearing: false,
    reasoning: 'The parenthetical names estar’s trigger.',
    confidence: 'high',
  };

  it('accepts a well-formed spoiled verdict', () => {
    const v = parseGlossVerdict(spoiled);
    expect(v.verdict).toBe('spoiled');
    expect(v.offendingSpan).toBe('(a current condition)');
    expect(v.loadBearing).toBe(false);
  });

  it('requires an offendingSpan when the verdict is spoiled', () => {
    expect(() => parseGlossVerdict({ ...spoiled, offendingSpan: null })).toThrow(
      /offendingSpan/,
    );
  });

  it('forbids an offendingSpan when the verdict is legitimate', () => {
    expect(() =>
      parseGlossVerdict({
        verdict: 'legitimate',
        offendingSpan: '(female)',
        proposedGloss: null,
        loadBearing: false,
        reasoning: 'Gender is meaning, not the dative form.',
        confidence: 'high',
      }),
    ).toThrow(/legitimate/);
  });

  it('allows a null proposedGloss only when dropping is safe', () => {
    // loadBearing + no replacement is contradictory: removing a load-bearing
    // gloss makes the blank ambiguous, so the model must propose a replacement.
    expect(() =>
      parseGlossVerdict({ ...spoiled, loadBearing: true, proposedGloss: null }),
    ).toThrow(/loadBearing/);
  });

  it('normalises a legitimate verdict to null span and null proposal', () => {
    const v = parseGlossVerdict({
      verdict: 'legitimate',
      offendingSpan: null,
      proposedGloss: null,
      loadBearing: true,
      reasoning: 'The parenthetical forces the reading without naming the form.',
      confidence: 'medium',
    });
    expect(v.offendingSpan).toBeNull();
    expect(v.proposedGloss).toBeNull();
  });
});

describe('GLOSS_SPOILAGE_PROMPT_VERSION', () => {
  it('is dated and surface-tagged', () => {
    expect(GLOSS_SPOILAGE_PROMPT_VERSION).toBe('gloss-spoilage@2026-08-12');
  });
});
