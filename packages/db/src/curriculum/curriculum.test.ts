import { Language, type LearningLanguage } from '@language-drill/shared';
import { describe, expect, it } from 'vitest';

import {
  ALL_CURRICULA,
  assertCurriculumInvariants,
  CURRICULUM_VERSION_BY_LANGUAGE,
  CURRICULUM_VERSION_DE,
  CURRICULUM_VERSION_ES,
  CURRICULUM_VERSION_TR,
  curriculumOrderOf,
  deCurriculum,
  esCurriculum,
  getGrammarPoint,
  trCurriculum,
} from './index';
import type { GrammarPoint } from './types';

/**
 * Returns a shallow clone of ALL_CURRICULA where the entry at `index` has been
 * shallow-merged with `overrides`. Used by the mutation tests so the frozen
 * production array stays untouched.
 */
function mutateAt(index: number, overrides: Partial<GrammarPoint>): GrammarPoint[] {
  const clone = ALL_CURRICULA.map((entry) => ({ ...entry }));
  clone[index] = { ...clone[index], ...overrides };
  return clone;
}

const FIRST_ES_INDEX = 0;
const FIRST_GRAMMAR_KEY = ALL_CURRICULA[FIRST_ES_INDEX].key;

describe('assertCurriculumInvariants', () => {
  it('passes for the shipped curriculum', () => {
    expect(() => assertCurriculumInvariants()).not.toThrow();
  });

  it('throws on a malformed key', () => {
    const broken = mutateAt(FIRST_ES_INDEX, { key: 'es-Z9-bad-key' });
    expect(() => assertCurriculumInvariants(broken)).toThrow(/malformed key 'es-Z9-bad-key'/);
  });

  it('throws on a duplicate key', () => {
    const broken = mutateAt(1, { key: FIRST_GRAMMAR_KEY });
    expect(() => assertCurriculumInvariants(broken)).toThrow(
      new RegExp(`duplicate key '${FIRST_GRAMMAR_KEY}'`),
    );
  });

  it('throws when language does not match the key prefix', () => {
    const broken = mutateAt(FIRST_ES_INDEX, { language: 'DE' as GrammarPoint['language'] });
    expect(() => assertCurriculumInvariants(broken)).toThrow(/does not match key prefix/);
  });

  it('throws when cefrLevel does not match the key infix', () => {
    const broken = mutateAt(FIRST_ES_INDEX, {
      cefrLevel: 'B2' as GrammarPoint['cefrLevel'],
    });
    expect(() => assertCurriculumInvariants(broken)).toThrow(/does not match key infix/);
  });

  it('throws on fewer than two positive examples', () => {
    const broken = mutateAt(FIRST_ES_INDEX, { examplesPositive: ['only one'] });
    expect(() => assertCurriculumInvariants(broken)).toThrow(/fewer than 2 positive examples/);
  });

  it('throws on missing negative examples', () => {
    const broken = mutateAt(FIRST_ES_INDEX, { examplesNegative: [] });
    expect(() => assertCurriculumInvariants(broken)).toThrow(/no negative examples/);
  });

  it('throws on a negative example missing the leading "*"', () => {
    const broken = mutateAt(FIRST_ES_INDEX, { examplesNegative: ['no asterisk here'] });
    expect(() => assertCurriculumInvariants(broken)).toThrow(/missing the leading '\*'/);
  });

  it('throws on missing commonErrors', () => {
    const broken = mutateAt(FIRST_ES_INDEX, { commonErrors: [] });
    expect(() => assertCurriculumInvariants(broken)).toThrow(/no commonErrors/);
  });

  it('throws on an over-long description', () => {
    const broken = mutateAt(FIRST_ES_INDEX, { description: 'x'.repeat(201) });
    expect(() => assertCurriculumInvariants(broken)).toThrow(/exceeds 200 characters/);
  });

  it('throws on a dangling prerequisite key', () => {
    const broken = mutateAt(FIRST_ES_INDEX, {
      prerequisiteKeys: ['es-a1-this-does-not-exist'],
    });
    expect(() => assertCurriculumInvariants(broken)).toThrow(/dangling prerequisite/);
  });

  it('throws on a cross-language prerequisite', () => {
    // DE is temporarily disabled (see de.ts), so use TR for the cross-language
    // example. Restore to DE when DE entries are uncommented.
    const esIndex = ALL_CURRICULA.findIndex((e) => e.language === 'ES');
    const trKey = ALL_CURRICULA.find((e) => e.language === 'TR')!.key;
    const broken = mutateAt(esIndex, { prerequisiteKeys: [trKey] });
    expect(() => assertCurriculumInvariants(broken)).toThrow(/cross-language prerequisite/);
  });

  it('throws when a per-language grammar count drops below the minimum', () => {
    // ES A1 minimum is temporarily 0 (see PER_LANGUAGE_GRAMMAR_MIN), so this
    // test now drops ES B1 (still required: 6). Restore to ES A1 when the A1
    // entries are uncommented.
    const trimmed = ALL_CURRICULA
      .filter((e) => !(e.language === 'ES' && e.cefrLevel === 'B1'))
      .map((e) => ({ ...e, prerequisiteKeys: undefined }));
    expect(() => assertCurriculumInvariants(trimmed)).toThrow(
      /ES B1 grammar count 0 below minimum 6/,
    );
  });
});

describe('curriculum clozeUnsuitable flag', () => {
  it('passes invariants on the shipped curriculum (with the four TR-A2 flags)', () => {
    expect(() => assertCurriculumInvariants()).not.toThrow();
  });

  it('throws when a vocab umbrella is flagged clozeUnsuitable', () => {
    const syntheticFlaggedVocab: GrammarPoint = {
      key: 'tr-a2-synthetic-vocab-umbrella',
      kind: 'vocab',
      name: 'Synthetic vocab umbrella',
      description: 'Synthetic vocab entry for clozeUnsuitable invariant testing.',
      cefrLevel: 'A2',
      language: Language.TR,
      examplesPositive: ['bir', 'iki'],
      examplesNegative: ['*yanlış'],
      commonErrors: ['hata'],
      clozeUnsuitable: true,
    };
    expect(() => assertCurriculumInvariants([syntheticFlaggedVocab])).toThrow(
      "'tr-a2-synthetic-vocab-umbrella' is clozeUnsuitable but not kind 'grammar'",
    );
  });
});

describe('curriculum sentenceConstructionSuitable flag', () => {
  it('throws when a vocab umbrella is flagged sentenceConstructionSuitable', () => {
    expect(() =>
      assertCurriculumInvariants([
        {
          key: 'tr-a2-synthetic-vocab-sc',
          kind: 'vocab',
          name: 'Synthetic vocab',
          description: 'Synthetic vocab entry for sentenceConstructionSuitable invariant testing.',
          cefrLevel: 'A2',
          language: Language.TR,
          examplesPositive: ['a', 'b'],
          examplesNegative: ['*c'],
          commonErrors: ['e'],
          sentenceConstructionSuitable: true,
        },
      ]),
    ).toThrow(/sentenceConstructionSuitable but not kind 'grammar'/);
  });
});

describe('curriculum personRotation flag', () => {
  it('throws when a vocab umbrella is flagged personRotation', () => {
    expect(() =>
      assertCurriculumInvariants([
        {
          key: 'tr-a2-synthetic-vocab-pr',
          kind: 'vocab',
          name: 'Synthetic vocab',
          description: 'Synthetic vocab entry for personRotation invariant testing.',
          cefrLevel: 'A2',
          language: Language.TR,
          examplesPositive: ['a', 'b'],
          examplesNegative: ['*c'],
          commonErrors: ['e'],
          personRotation: true,
        },
      ]),
    ).toThrow(/personRotation but not kind 'grammar'/);
  });

  it('flags the person-marked TR tense/copular points', () => {
    const flaggedKeys = [
      'tr-a1-present-continuous',
      'tr-a1-dili-past',
      'tr-a1-future',
      'tr-a1-negation',
      'tr-a1-personal-suffixes',
      'tr-a2-aorist',
    ];
    for (const key of flaggedKeys) {
      expect(getGrammarPoint(key)?.personRotation, key).toBe(true);
    }
  });

  it('does not flag person-less points or the eval-excluded weak cells', () => {
    // mis-evidential / ability-necessity: rotation eval (2026-06-12) showed
    // both chronically weak cells degrade further under rotation — excluded
    // pending cell-specific fixes (see comments in tr.ts).
    const excluded = [
      'tr-a1-var-yok',
      'tr-a1-locative',
      'es-b1-passive-se',
      'tr-a2-mis-evidential',
      'tr-a2-ability-necessity',
    ];
    for (const key of excluded) {
      expect(getGrammarPoint(key)?.personRotation, key).toBeUndefined();
    }
  });
});

describe('curriculum clozeUnsuitable flag — specific entries', () => {
  it('flags the four bipartite TR-A2 grammar points', () => {
    const flaggedKeys = [
      'tr-a2-converbs',
      'tr-a2-correlative-conjunctions',
      'tr-a2-nominalization',
      'tr-a2-relative-an',
    ];
    for (const key of flaggedKeys) {
      expect(getGrammarPoint(key)?.clozeUnsuitable).toBe(true);
    }
  });

  it('flags the two ambiguity-driven TR-A1 grammar points', () => {
    // -A göre / bence: a single L2 sentence cannot fix the opinion-holder, so
    // the slot accepts every person. -DEn beri / -DIr: near-synonym alternants
    // both fit. Both are unsolvable as a single-blank cloze without spoiling;
    // they keep only the translation cell. See investigation 2026-06-07.
    for (const key of ['tr-a1-gore-bence', 'tr-a1-beri-dir']) {
      expect(getGrammarPoint(key)?.clozeUnsuitable).toBe(true);
    }
  });

  it('the full TR clozeUnsuitable set is exactly these six points', () => {
    const flagged = trCurriculum
      .filter((g) => g.clozeUnsuitable === true)
      .map((g) => g.key)
      .sort();
    expect(flagged).toEqual(
      [
        'tr-a1-beri-dir',
        'tr-a1-gore-bence',
        'tr-a2-converbs',
        'tr-a2-correlative-conjunctions',
        'tr-a2-nominalization',
        'tr-a2-relative-an',
      ].sort(),
    );
  });
});

describe('getGrammarPoint', () => {
  it('returns the matching entry for a known key', () => {
    const entry = getGrammarPoint('es-b1-present-subjunctive');
    expect(entry).toBeDefined();
    expect(entry?.key).toBe('es-b1-present-subjunctive');
    expect(entry?.language).toBe('ES');
    expect(entry?.cefrLevel).toBe('B1');
  });

  it('returns undefined for an unknown key', () => {
    expect(getGrammarPoint('xx-z9-no-such-thing')).toBeUndefined();
  });
});

describe('curriculumOrderOf', () => {
  it('returns the 0-based index of a key within its own language array', () => {
    esCurriculum.forEach((entry, index) => {
      expect(curriculumOrderOf(entry.key)).toBe(index);
    });
    trCurriculum.forEach((entry, index) => {
      expect(curriculumOrderOf(entry.key)).toBe(index);
    });
  });

  it('restarts numbering per language (each first entry is 0)', () => {
    if (esCurriculum.length > 0) {
      expect(curriculumOrderOf(esCurriculum[0].key)).toBe(0);
    }
    if (trCurriculum.length > 0) {
      expect(curriculumOrderOf(trCurriculum[0].key)).toBe(0);
    }
  });

  it('orders consecutive entries within a language ascending', () => {
    for (let i = 1; i < trCurriculum.length; i++) {
      const prev = curriculumOrderOf(trCurriculum[i - 1].key);
      const curr = curriculumOrderOf(trCurriculum[i].key);
      expect(prev).toBeDefined();
      expect(curr).toBeDefined();
      expect(curr as number).toBeGreaterThan(prev as number);
    }
  });

  it('returns undefined for an unknown key', () => {
    expect(curriculumOrderOf('xx-z9-no-such-thing')).toBeUndefined();
  });
});

describe('per-language counts', () => {
  function countsFor(curriculum: readonly GrammarPoint[]) {
    const grammar = { A1: 0, A2: 0, B1: 0, B2: 0 } as Record<string, number>;
    let vocab = 0;
    for (const entry of curriculum) {
      if (entry.kind === 'grammar') {
        grammar[entry.cefrLevel]++;
      } else {
        vocab++;
      }
    }
    return { grammar, vocab };
  }

  // ES/DE are TEMPORARILY REDUCED (2026-05-10): assertions match the
  // currently-active curriculum subset. Restore the original ≥4/≥5/≥6/≥5
  // assertions and vocab.toBe(3) for ES/DE when their A1/A2 entries are
  // uncommented. TR (2026-05-28) is now at full Yedi İklim A1+A2 parity
  // (26 A1 + 14 A2 grammar + 10 themed vocab umbrellas); B1/B2 remain disabled.

  it('Spanish meets minimums (B1 + B2 only while A1/A2 are disabled) and has 2 vocab umbrellas', () => {
    const { grammar, vocab } = countsFor(esCurriculum);
    expect(grammar.A1).toBe(0);
    expect(grammar.A2).toBe(0);
    expect(grammar.B1).toBeGreaterThanOrEqual(6);
    expect(grammar.B2).toBeGreaterThanOrEqual(5);
    expect(vocab).toBe(2);
  });

  it('German is fully disabled (no grammar entries, no vocab umbrellas)', () => {
    const { grammar, vocab } = countsFor(deCurriculum);
    expect(grammar.A1).toBe(0);
    expect(grammar.A2).toBe(0);
    expect(grammar.B1).toBe(0);
    expect(grammar.B2).toBe(0);
    expect(vocab).toBe(0);
  });

  it('Turkish is at full Yedi İklim A1 + A2 parity (B1/B2 disabled) and has 10 themed vocab umbrellas', () => {
    const { grammar, vocab } = countsFor(trCurriculum);
    expect(grammar.A1).toBeGreaterThanOrEqual(26);
    expect(grammar.A2).toBeGreaterThanOrEqual(14);
    expect(grammar.B1).toBe(0);
    expect(grammar.B2).toBe(0);
    // 5 themed A1 + 5 themed A2 umbrellas (2026-06-07 everyday-vocab split).
    expect(vocab).toBe(10);
  });
});

describe('CURRICULUM_VERSION_<LANG> constants', () => {
  // CLAUDE.md requires that any curriculum edit bumps the matching
  // CURRICULUM_VERSION_<LANG> in the same commit. Asserting the shape here
  // catches typos (e.g. empty string, '2026-5-23', '2026-05-23-draft') at PR
  // time so we never ship a curriculum_version row that breaks the
  // YYYY-MM-DD invariant downstream consumers rely on.
  it('every learning language exports a YYYY-MM-DD version constant', () => {
    expect(CURRICULUM_VERSION_ES).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(CURRICULUM_VERSION_DE).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(CURRICULUM_VERSION_TR).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('CURRICULUM_VERSION_BY_LANGUAGE', () => {
  // LearningLanguage = Exclude<Language, Language.EN> — EN is excluded by the
  // type because it has no curriculum module. If a new learning language is
  // added to the enum, this test will fail until the map gets an entry.
  it('has an entry for every LearningLanguage value (exhaustiveness)', () => {
    const expected: LearningLanguage[] = [Language.ES, Language.DE, Language.TR];
    const keys = Object.keys(CURRICULUM_VERSION_BY_LANGUAGE) as LearningLanguage[];
    expect(new Set(keys)).toEqual(new Set(expected));
  });

  it('each value matches the language-specific constant', () => {
    expect(CURRICULUM_VERSION_BY_LANGUAGE[Language.ES]).toBe(CURRICULUM_VERSION_ES);
    expect(CURRICULUM_VERSION_BY_LANGUAGE[Language.DE]).toBe(CURRICULUM_VERSION_DE);
    expect(CURRICULUM_VERSION_BY_LANGUAGE[Language.TR]).toBe(CURRICULUM_VERSION_TR);
  });
});
