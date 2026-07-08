import {
  ExerciseType,
  Language,
  resolveTheoryCategory,
  type LearningLanguage,
} from '@language-drill/shared';
import { describe, expect, it } from 'vitest';

import { enumerateCurriculumCells } from '../generation/cells';

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
  grammarPointsAtOrBelow,
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
    const broken = mutateAt(FIRST_ES_INDEX, { description: 'x'.repeat(301) });
    expect(() => assertCurriculumInvariants(broken)).toThrow(/exceeds 300 characters/);
  });

  it('allows a description between the old and new caps', () => {
    const ok = mutateAt(FIRST_ES_INDEX, { description: 'x'.repeat(250) });
    expect(() => assertCurriculumInvariants(ok)).not.toThrow();
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
    const trimmed = ALL_CURRICULA
      .filter((e) => !(e.language === 'ES' && e.cefrLevel === 'A1'))
      .map((e) => ({ ...e, prerequisiteKeys: undefined }));
    expect(() => assertCurriculumInvariants(trimmed)).toThrow(
      /ES A1 grammar count 0 below minimum 22/,
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

describe('curriculum conjugationSuitable flag', () => {
  it('throws when a vocab umbrella is flagged conjugationSuitable', () => {
    expect(() =>
      assertCurriculumInvariants([
        {
          key: 'tr-a2-synthetic-vocab-conj',
          kind: 'vocab',
          name: 'Synthetic vocab',
          description: 'Synthetic vocab entry for conjugationSuitable invariant testing.',
          cefrLevel: 'A2',
          language: Language.TR,
          examplesPositive: ['a', 'b'],
          examplesNegative: ['*c'],
          commonErrors: ['e'],
          conjugationSuitable: true,
        },
      ]),
    ).toThrow(/conjugationSuitable/);
  });

  it('flagged conjugation points each have at least one coverage axis (person, case, or number)', () => {
    // Verb-inflection points carry a person axis; nominal-inflection points
    // (cases, possessive+case stacking) carry case or number axes instead.
    const flagged = ALL_CURRICULA.filter((p) => p.conjugationSuitable);
    expect(flagged.length).toBeGreaterThan(0);
    for (const p of flagged) {
      expect(p.kind).toBe('grammar');
      const names = (p.coverageSpec?.axes ?? []).map((a) => a.name);
      const hasRelevantAxis = names.some((n) => n === 'person' || n === 'case' || n === 'number');
      expect(hasRelevantAxis, `${p.key}: conjugationSuitable point must have person, case, or number axis`).toBe(true);
    }
  });
});

describe('curriculum conjugationSeedKind (nominal-inflection points seed from the noun band)', () => {
  // Nominal-inflection points decline a noun, not a verb. Unseeded they collapsed
  // onto a couple of nouns and exhausted their identity space, so they now draw
  // from the noun band with conjugationSeedKind: 'noun' (the strict directive
  // names "the noun to inflect"). The COPULAR point (personal-suffixes) is the
  // exception — it makes a "subject IS <predicate>" sentence, so it uses
  // 'predicate-nominal' instead (see the separate describe below). No point
  // currently uses the legacy 'none'.
  it('the full conjugationSeedKind:"noun" set is exactly these five TR case/possessive points', () => {
    const nounSeeded = ALL_CURRICULA.filter((g) => g.conjugationSeedKind === 'noun')
      .map((g) => g.key)
      .sort();
    expect(nounSeeded).toEqual(
      [
        'tr-a1-accusative-definite-object',
        'tr-a1-ablative-dative',
        'tr-a1-locative',
        'tr-a1-possessive-suffixes',
        'tr-a2-possessive-case-stacking',
      ].sort(),
    );
  });

  it('no point uses the legacy unseeded conjugationSeedKind:"none"', () => {
    const seedless = ALL_CURRICULA.filter((g) => g.conjugationSeedKind === 'none').map((g) => g.key);
    expect(seedless).toEqual([]);
  });

  it('every conjugationSeedKind:"noun" point is also conjugationSuitable', () => {
    for (const g of ALL_CURRICULA.filter((p) => p.conjugationSeedKind === 'noun')) {
      expect(g.conjugationSuitable, g.key).toBe(true);
    }
  });

  it('the copular point seeds from a curated predicate pool (conjugationSeedKind:"predicate-nominal")', () => {
    const predicateSeeded = ALL_CURRICULA.filter(
      (g) => g.conjugationSeedKind === 'predicate-nominal',
    );
    expect(predicateSeeded.map((g) => g.key)).toEqual(['tr-a1-personal-suffixes']);
    const copular = predicateSeeded[0];
    // Pool must be present, non-trivial, and sized above the person-floor target
    // (5 per × 6 persons = 30) so the lemma-keyed exclude has room before it
    // exhausts.
    expect((copular.conjugationSeedWords ?? []).length).toBeGreaterThanOrEqual(30);
    expect(copular.conjugationSuitable).toBe(true);
  });

  it('throws when a predicate-nominal point has no conjugationSeedWords pool', () => {
    expect(() =>
      assertCurriculumInvariants([
        {
          key: 'tr-a1-synthetic-copular',
          kind: 'grammar',
          name: 'Synthetic copular',
          description: 'Synthetic entry for predicate-nominal invariant testing.',
          cefrLevel: 'A1',
          language: Language.TR,
          examplesPositive: ['a', 'b'],
          examplesNegative: ['*c'],
          commonErrors: ['e'],
          conjugationSuitable: true,
          conjugationSeedKind: 'predicate-nominal',
          // conjugationSeedWords intentionally omitted.
        },
      ]),
    ).toThrow(/conjugationSeedWords/);
  });

  it('throws when conjugationSeedWords is set without conjugationSeedKind predicate-nominal', () => {
    expect(() =>
      assertCurriculumInvariants([
        {
          key: 'tr-a1-synthetic-misplaced-pool',
          kind: 'grammar',
          name: 'Synthetic misplaced pool',
          description: 'Synthetic entry for predicate-nominal invariant testing.',
          cefrLevel: 'A1',
          language: Language.TR,
          examplesPositive: ['a', 'b'],
          examplesNegative: ['*c'],
          commonErrors: ['e'],
          conjugationSuitable: true,
          conjugationSeedKind: 'noun',
          conjugationSeedWords: ['doktor'],
        },
      ]),
    ).toThrow(/conjugationSeedWords/);
  });

  it('verb-morphology conjugation points keep the default verb seed (no flag)', () => {
    for (const key of [
      'tr-a2-aorist',
      'tr-b1-real-conditional',
      'es-b1-present-subjunctive',
    ]) {
      expect(getGrammarPoint(key)?.conjugationSeedKind).toBeUndefined();
    }
  });

  it('throws when a self-revealing point has no elicitationSeedValues pool', () => {
    expect(() =>
      assertCurriculumInvariants([
        {
          key: 'tr-a1-synthetic-numbers',
          kind: 'grammar',
          name: 'Synthetic numbers',
          description: 'Synthetic entry for self-revealing invariant testing.',
          cefrLevel: 'A1',
          language: Language.TR,
          examplesPositive: ['a', 'b'],
          examplesNegative: ['*c'],
          commonErrors: ['e'],
          selfRevealingElicitation: 'digit-form',
          // elicitationSeedValues intentionally omitted.
        },
      ]),
    ).toThrow(/elicitationSeedValues/);
  });

  it('throws when elicitationSeedValues is set without selfRevealingElicitation', () => {
    expect(() =>
      assertCurriculumInvariants([
        {
          key: 'tr-a1-synthetic-numbers',
          kind: 'grammar',
          name: 'Synthetic numbers',
          description: 'Synthetic entry for self-revealing invariant testing.',
          cefrLevel: 'A1',
          language: Language.TR,
          examplesPositive: ['a', 'b'],
          examplesNegative: ['*c'],
          commonErrors: ['e'],
          elicitationSeedValues: ['birinci'],
        },
      ]),
    ).toThrow(/selfRevealingElicitation/);
  });
});

describe('curriculum personRotation flag (migrated to coverageSpec — Task 4)', () => {
  // The `personRotation` field has been migrated to `coverageSpec` in Task 4 of
  // the Pool Coverage Controller Phase 2 migration. Active entries no longer have
  // `personRotation`; they carry a person-axis `coverageSpec` instead.

  it('person-marked TR tense/copular points have a person-axis coverageSpec (not personRotation)', () => {
    const flaggedKeys = [
      'tr-a1-present-continuous',
      'tr-a1-dili-past',
      'tr-a1-future',
      'tr-a1-negation',
      'tr-a1-personal-suffixes',
      'tr-a2-aorist',
    ];
    for (const key of flaggedKeys) {
      const gp = getGrammarPoint(key);
      expect(gp?.personRotation, `${key}: personRotation should be gone`).toBeUndefined();
      expect(
        gp?.coverageSpec?.axes.some((a) => a.name === 'person'),
        `${key}: coverageSpec should have a person axis`,
      ).toBe(true);
    }
  });

  it('does not give coverageSpec.person to person-less points or the eval-excluded weak cells', () => {
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
      const gp = getGrammarPoint(key);
      expect(gp?.personRotation, `${key}: personRotation should be absent`).toBeUndefined();
      const hasPersonAxis = gp?.coverageSpec?.axes.some((a) => a.name === 'person') ?? false;
      expect(hasPersonAxis, `${key}: should have no person axis in coverageSpec`).toBe(false);
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

  it('flags the three morphology-invisible / ambiguous points retired from cloze (2026-06-21)', () => {
    // stem-changes & consonant-doubling only surface WITH a vowel suffix, so a
    // whole-word blank shows no change or forces a 2nd grammar point;
    // reflexive-reciprocal leaves the case under-constrained (birbirine /
    // birbirini / birbiriyle). See the 2026-06-21 generation-run analysis.
    for (const key of [
      'tr-a1-stem-changes',
      'tr-a2-consonant-doubling',
      'tr-a2-reflexive-reciprocal-pronouns',
    ]) {
      expect(getGrammarPoint(key)?.clozeUnsuitable).toBe(true);
    }
  });

  it('caps tr-a2-consonant-doubling translation volume via targetOverride (2026-06-23)', () => {
    // Cloze was retired 2026-06-21; the surviving translation surface yields
    // poorly (2/27 on the 2026-06-22 run) because gemination is bypassable and
    // the closed Arabic-origin set is tiny. Cap the per-cell target so the
    // scheduler stops grinding the A2 default (30) into dedup/ambiguous waste.
    expect(getGrammarPoint('tr-a2-consonant-doubling')?.targetOverride).toBe(10);
  });

  it('raises every TR dictation target to 30 via targetOverride (2026-06-25b)', () => {
    // The A1 15-trial landed (pool 6→11 on the 2026-06-24 run after the
    // level-scope fix), so all three TR dictation levels are raised to 30 to
    // build deeper pools. Point-wide is safe: a dictation umbrella only feeds the
    // dictation cell.
    expect(getGrammarPoint('tr-a1-dictation')?.targetOverride).toBe(30);
    expect(getGrammarPoint('tr-a2-dictation')?.targetOverride).toBe(30);
    expect(getGrammarPoint('tr-b1-dictation')?.targetOverride).toBe(30);
  });

  it('leaves tr-a2-indefinite-compound uncapped — its translation surface is healthy', () => {
    // The cloze quality fix lives in the generation prompt (bare-head hint,
    // nominative answer, no case-stacking). targetOverride is point-wide and
    // would also clamp the healthy translation surface (13/41 on 2026-06-22),
    // so it is deliberately NOT set here.
    expect(
      getGrammarPoint('tr-a2-indefinite-compound')?.targetOverride,
    ).toBeUndefined();
  });

  it('the full TR clozeUnsuitable set is exactly these nineteen points', () => {
    const flagged = trCurriculum
      .filter((g) => g.clozeUnsuitable === true)
      .map((g) => g.key)
      .sort();
    expect(flagged).toEqual(
      [
        'tr-a1-beri-dir',
        'tr-a1-gore-bence',
        'tr-a1-stem-changes',
        'tr-a2-consonant-doubling',
        'tr-a2-converbs',
        'tr-a2-correlative-conjunctions',
        'tr-a2-nominalization',
        'tr-a2-possessive-case-stacking',
        'tr-a2-reflexive-reciprocal-pronouns',
        'tr-a2-suffix-order-buffers',
        'tr-a2-relative-an',
        'tr-b1-converb-while-yken',
        'tr-b1-participles-dik-acak',
        'tr-b1-since-converb',
        'tr-b1-causative-voice',
        'tr-b1-obligation-periphrases',
        'tr-b1-passive-voice',
        'tr-b1-reciprocal-voice',
        'tr-b1-reflexive-voice-kendi',
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
    let dictation = 0;
    let freeWriting = 0;
    for (const entry of curriculum) {
      if (entry.kind === 'grammar') {
        grammar[entry.cefrLevel]++;
      } else if (entry.kind === 'vocab') {
        vocab++;
      } else if (entry.kind === 'dictation') {
        dictation++;
      } else {
        freeWriting++;
      }
    }
    return { grammar, vocab, dictation, freeWriting };
  }

  // ES is at full PCIC A1-B2 parity plus the 2026-07-09 Butt & Benjamin gap
  // audit (22 extra points): 24 A1 + 33 A2 + 25 B1 + 31 B2 grammar points.
  // DE is still TEMPORARILY REDUCED (2026-05-10). TR (2026-05-28) is now at
  // full Yedi İklim A1+A2 parity (26 A1 + 14 A2 grammar + 10 themed vocab
  // umbrellas); B1/B2 remain disabled.

  it('Spanish is at full PCIC A1–B2 parity (+ B&B gap audit), has 12 vocab umbrellas, 4 dictation umbrellas, and 18 free-writing umbrellas', () => {
    const { grammar, vocab, dictation, freeWriting } = countsFor(esCurriculum);
    expect(grammar.A1).toBeGreaterThanOrEqual(24);
    expect(grammar.A2).toBeGreaterThanOrEqual(33);
    expect(grammar.B1).toBeGreaterThanOrEqual(25);
    expect(grammar.B2).toBeGreaterThanOrEqual(31);
    // 5 A1 + 5 A2 themed umbrellas + es-b1-environment-vocab + es-b2-abstract-noun-vocab.
    expect(vocab).toBe(12);
    // es-a1-dictation + es-a2-dictation + es-b1-dictation + es-b2-dictation (Phase 2 dictation generation pipeline).
    expect(dictation).toBe(4);
    // 3 × A1 + 3 × A2 + 6 × B1 + 6 × B2 free-writing topic umbrellas (Phase 2 free-writing generation).
    expect(freeWriting).toBe(18);
  });

  it('German is fully disabled (no grammar entries, no vocab or dictation umbrellas)', () => {
    const { grammar, vocab, dictation } = countsFor(deCurriculum);
    expect(grammar.A1).toBe(0);
    expect(grammar.A2).toBe(0);
    expect(grammar.B1).toBe(0);
    expect(grammar.B2).toBe(0);
    expect(vocab).toBe(0);
    expect(dictation).toBe(0);
  });

  it('Turkish is at full Yedi İklim A1 + A2 + B1 parity (B2 disabled), has 15 vocab umbrellas, 3 dictation umbrellas, and 9 free-writing umbrellas', () => {
    const { grammar, vocab, dictation, freeWriting } = countsFor(trCurriculum);
    expect(grammar.A1).toBeGreaterThanOrEqual(26);
    expect(grammar.A2).toBeGreaterThanOrEqual(14);
    expect(grammar.B1).toBe(11);
    expect(grammar.B2).toBe(0);
    // 5 A1 + 5 A2 + 5 B1 themed vocab umbrellas.
    expect(vocab).toBe(15);
    // tr-a1 + tr-a2 + tr-b1 dictation.
    expect(dictation).toBe(3);
    // 3 A1 + 3 A2 + 3 B1 free-writing topic umbrellas.
    expect(freeWriting).toBe(9);
  });
});

describe('free-writing topic umbrellas', () => {
  it('has 3 free-writing topic umbrellas per ES A1 and A2, and 6 per B1 and B2', () => {
    const fw = esCurriculum.filter((e) => e.kind === 'free-writing');
    expect(fw.filter((e) => e.cefrLevel === 'A1')).toHaveLength(3);
    expect(fw.filter((e) => e.cefrLevel === 'A2')).toHaveLength(3);
    expect(fw.filter((e) => e.cefrLevel === 'B1')).toHaveLength(6);
    expect(fw.filter((e) => e.cefrLevel === 'B2')).toHaveLength(6);
    for (const e of fw) {
      expect(e.freeWriting?.register).toBeDefined();
    }
  });

  it("has 3 free-writing topic umbrellas per TR A1, A2 and B1", () => {
    const fw = trCurriculum.filter((e) => e.kind === "free-writing");
    expect(fw.filter((e) => e.cefrLevel === "A1")).toHaveLength(3);
    expect(fw.filter((e) => e.cefrLevel === "A2")).toHaveLength(3);
    expect(fw.filter((e) => e.cefrLevel === "B1")).toHaveLength(3);
    for (const e of fw) {
      expect(e.freeWriting?.register).toBeDefined();
    }
  });
});

describe('CURRICULUM_VERSION_<LANG> constants', () => {
  // CLAUDE.md requires that any curriculum edit bumps the matching
  // CURRICULUM_VERSION_<LANG> in the same commit. Asserting the shape here
  // catches typos (e.g. empty string, '2026-5-23', '2026-05-23-draft') at PR
  // time so we never ship a curriculum_version row that breaks the
  // YYYY-MM-DD invariant downstream consumers rely on.
  it('every learning language exports a YYYY-MM-DD version constant (optional single-letter suffix allowed)', () => {
    expect(CURRICULUM_VERSION_ES).toMatch(/^\d{4}-\d{2}-\d{2}[a-z]?$/);
    expect(CURRICULUM_VERSION_DE).toMatch(/^\d{4}-\d{2}-\d{2}[a-z]?$/);
    expect(CURRICULUM_VERSION_TR).toMatch(/^\d{4}-\d{2}-\d{2}[a-z]?$/);
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

function baseGrammar(over: Partial<GrammarPoint>): GrammarPoint {
  return {
    key: 'tr-a1-x-test',
    kind: 'grammar',
    name: 'test',
    description: 'd',
    cefrLevel: 'A1',
    language: Language.TR as GrammarPoint['language'],
    examplesPositive: ['a', 'b'],
    examplesNegative: ['*c'],
    commonErrors: ['e'],
    ...over,
  } as GrammarPoint;
}

describe('coverageSpec invariants', () => {
  it('rejects an illegal floor key for the axis', () => {
    const gp = baseGrammar({ coverageSpec: { axes: [{ name: 'person', floors: { '9sg': 5 } }] } });
    expect(() => assertCurriculumInvariants([gp])).toThrow(/illegal value '9sg'/);
  });
  it('rejects wordClass on a grammar point', () => {
    const gp = baseGrammar({ coverageSpec: { axes: [{ name: 'wordClass', floors: { noun: 5 } }] } });
    expect(() => assertCurriculumInvariants([gp])).toThrow(/wordClass.*only valid on kind 'vocab'/);
  });
  it('rejects person on a vocab point', () => {
    const gp = baseGrammar({
      kind: 'vocab',
      key: 'tr-a1-vocab-test',
      coverageSpec: { axes: [{ name: 'person', floors: { '3sg': 5 } }] },
    });
    expect(() => assertCurriculumInvariants([gp])).toThrow(/person.*only valid on kind 'grammar'/);
  });
  it('rejects a non-positive-integer floor', () => {
    const gp = baseGrammar({ coverageSpec: { axes: [{ name: 'person', floors: { '3sg': 0 } }] } });
    expect(() => assertCurriculumInvariants([gp])).toThrow(/floor.*positive integer/);
  });
  it('rejects a duplicate axis', () => {
    const gp = baseGrammar({
      coverageSpec: { axes: [{ name: 'person', floors: { '3sg': 5 } }, { name: 'person', floors: { '1sg': 5 } }] },
    });
    expect(() => assertCurriculumInvariants([gp])).toThrow(/duplicate axis/);
  });
  it('accepts a valid person spec on a grammar point', () => {
    const gp = baseGrammar({ coverageSpec: { axes: [{ name: 'person', floors: { '1sg': 5, '3sg': 5 } }] } });
    // Invariant 10 (per-language grammar count minimums) may throw for a single-entry
    // fixture; we only care that no coverageSpec-related error is thrown.
    try {
      assertCurriculumInvariants([gp]);
    } catch (e) {
      expect((e as Error).message).not.toMatch(/coverageSpec|duplicate axis|illegal value|only valid|positive integer/);
    }
  });

  it('allows a case+number axis and conjugationSuitable on a grammar point', () => {
    const point = baseGrammar({
      key: 'tr-a1-test-case-axis',
      conjugationSuitable: true,
      coverageSpec: {
        axes: [
          { name: 'case', floors: { dative: 3, ablative: 3 } },
          { name: 'number', floors: { singular: 4, plural: 4 } },
        ],
      },
    });
    // Invariant 10 (per-language grammar count minimums) may throw for a single-entry
    // fixture; we only care that no coverageSpec-related error is thrown.
    try {
      assertCurriculumInvariants([point]);
    } catch (e) {
      expect((e as Error).message).not.toMatch(/coverageSpec|duplicate axis|illegal value|only valid|positive integer/);
    }
  });

  it('still rejects a wordClass axis on a grammar point', () => {
    const point = baseGrammar({
      key: 'tr-a1-test-bad-axis',
      coverageSpec: { axes: [{ name: 'wordClass', floors: { noun: 3 } }] },
    });
    expect(() => assertCurriculumInvariants([point])).toThrow(/wordClass/);
  });
});

describe('grammarPointsAtOrBelow', () => {
  it('returns TR A1+A2 grammar points (only) for TR at A2', () => {
    const pts = grammarPointsAtOrBelow('TR', 'A2');
    expect(pts.length).toBeGreaterThanOrEqual(40); // 26 A1 + 14 A2
    expect(pts.every((p) => p.kind === 'grammar')).toBe(true);
    expect(pts.every((p) => p.language === 'TR')).toBe(true);
    expect(pts.every((p) => p.cefrLevel === 'A1' || p.cefrLevel === 'A2')).toBe(true);
    expect(pts.some((p) => p.key.includes('-vocab-') || p.key.includes('-dictation') || p.key.includes('-fw-'))).toBe(false);
  });

  it('is inclusive of the target level and excludes higher levels', () => {
    const a1 = grammarPointsAtOrBelow('TR', 'A1');
    expect(a1.every((p) => p.cefrLevel === 'A1')).toBe(true);
    expect(a1.some((p) => p.cefrLevel === 'A2')).toBe(false);
    const a2 = grammarPointsAtOrBelow('TR', 'A2');
    expect(a2.length).toBeGreaterThan(a1.length);
  });

  it('returns [] for an out-of-round level', () => {
    expect(grammarPointsAtOrBelow('TR', 'C1')).toEqual([]);
    expect(grammarPointsAtOrBelow('TR', 'C2')).toEqual([]);
  });

  it('scopes by language', () => {
    const tr = grammarPointsAtOrBelow('TR', 'B2');
    expect(tr.length).toBeGreaterThan(0);
    expect(tr.every((p) => p.language === 'TR')).toBe(true);
    // None of TR's scope leaks from ES/DE.
    expect(tr.some((p) => p.language === 'ES' || p.language === 'DE')).toBe(false);
  });
});

describe('theory category coverage', () => {
  // The theory library buckets each topic via resolveTheoryCategory(grammarPointKey).
  // The TR curriculum is live end-to-end (A1+A2+B1), so every TR grammar point
  // must map to a real category — anything falling through to 'other' is a stale
  // or missing KEY_TO_CATEGORY entry (the bug that dumped present-continuous /
  // negation / dili-past into 'other' after the A2→A1 re-numbering).
  it('maps every live TR grammar point to a non-other category', () => {
    const unmapped = trCurriculum
      .filter((p) => p.kind === 'grammar')
      .filter((p) => resolveTheoryCategory(p.key) === 'other')
      .map((p) => p.key);
    expect(unmapped).toEqual([]);
  });

  it('leaves non-grammar TR umbrellas in other', () => {
    const nonGrammar = trCurriculum.filter((p) => p.kind !== 'grammar');
    expect(nonGrammar.length).toBeGreaterThan(0);
    expect(nonGrammar.every((p) => resolveTheoryCategory(p.key) === 'other')).toBe(true);
  });

  // ES is now live end-to-end (49 A1/A2 + 42 B1/B2 grammar points, all mapped),
  // so it gets the same non-other guarantee as TR above.
  it('maps every live ES grammar point to a non-other category', () => {
    const unmapped = esCurriculum
      .filter((p) => p.kind === 'grammar')
      .filter((p) => resolveTheoryCategory(p.key) === 'other')
      .map((p) => p.key);
    expect(unmapped).toEqual([]);
  });
});

describe('TR nominal-inflection conjugation cells (Task 6)', () => {
  const CONJ_POINTS = [
    'tr-a1-personal-suffixes',
    'tr-a1-possessive-suffixes',
    'tr-a1-locative',
    'tr-a1-accusative-definite-object',
    'tr-a1-ablative-dative',
  ];

  it('emits a conjugation cell for each flagged Turkish nominal point', () => {
    const cells = enumerateCurriculumCells(trCurriculum);
    for (const key of CONJ_POINTS) {
      const hasConj = cells.some(
        (c) => c.grammarPoint.key === key && c.exerciseType === ExerciseType.CONJUGATION,
      );
      expect(hasConj, `${key} should have a conjugation cell`).toBe(true);
    }
  });

  it('A1 possessive-suffixes is person-only (stacking moved to its own A2 point)', () => {
    // 2026-06-20: a `case` axis here made the validator flag every stacked form
    // (grammar-point-mismatch + level-mismatch). Stacking now lives on
    // tr-a2-possessive-case-stacking; the A1 point keeps only nominative forms.
    const point = trCurriculum.find((p) => p.key === 'tr-a1-possessive-suffixes');
    const axes = (point?.coverageSpec?.axes ?? []).map((a) => a.name);
    expect(axes).toEqual(['person']);
  });

  it('tr-a2-possessive-case-stacking drills possessive×case at A2 via conjugation, not cloze', () => {
    const point = trCurriculum.find((p) => p.key === 'tr-a2-possessive-case-stacking');
    expect(point).toBeDefined();
    expect(point!.cefrLevel).toBe('A2');
    expect(point!.conjugationSuitable).toBe(true);
    expect(point!.clozeUnsuitable).toBe(true);

    const caseAxis = point!.coverageSpec?.axes.find((a) => a.name === 'case');
    expect(caseAxis).toBeDefined();
    expect(Object.keys(caseAxis!.floors).sort()).toEqual(
      ['ablative', 'accusative', 'dative', 'locative'],
    );
    expect(point!.coverageSpec?.axes.some((a) => a.name === 'person')).toBe(true);

    const types = enumerateCurriculumCells(trCurriculum)
      .filter((c) => c.grammarPoint.key === 'tr-a2-possessive-case-stacking')
      .map((c) => c.exerciseType);
    expect(types).toContain(ExerciseType.CONJUGATION);
    expect(types).toContain(ExerciseType.TRANSLATION);
    expect(types).not.toContain(ExerciseType.CLOZE);
  });
});
