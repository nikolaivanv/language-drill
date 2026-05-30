import { Language, type LearningLanguage } from '@language-drill/shared';

import deCurriculum, { CURRICULUM_VERSION_DE } from './de';
import esCurriculum, { CURRICULUM_VERSION_ES } from './es';
import trCurriculum, { CURRICULUM_VERSION_TR } from './tr';
import type { GrammarPoint } from './types';

export type { CurriculumCefrLevel, GrammarPoint } from './types';
export { esCurriculum, deCurriculum, trCurriculum };
export { CURRICULUM_VERSION_ES, CURRICULUM_VERSION_DE, CURRICULUM_VERSION_TR };

/**
 * One-stop lookup for the per-language curriculum version. The scheduler in
 * `infra/lambda/src/generation/scheduler.ts` compares each cell's
 * `cell.language` against this map to resolve the expected curriculum
 * version, and `run-one-cell.ts` reads it on `generation_jobs` INSERT to
 * populate the `curriculum_version` column.
 *
 * Keyed off `LearningLanguage` (not the full `Language` enum) because EN is
 * a source-only language for translation exercises and has no curriculum
 * module — the type system enforces that EN cannot be looked up here.
 */
export const CURRICULUM_VERSION_BY_LANGUAGE: Readonly<Record<LearningLanguage, string>> = {
  [Language.ES]: CURRICULUM_VERSION_ES,
  [Language.DE]: CURRICULUM_VERSION_DE,
  [Language.TR]: CURRICULUM_VERSION_TR,
};

/**
 * The full Phase-1 curriculum: all entries from all three learning languages,
 * concatenated and frozen. Order is ES → DE → TR.
 */
export const ALL_CURRICULA: readonly GrammarPoint[] = Object.freeze([
  ...esCurriculum,
  ...deCurriculum,
  ...trCurriculum,
]);

const GRAMMAR_POINT_INDEX: ReadonlyMap<string, GrammarPoint> = new Map(
  ALL_CURRICULA.map((entry) => [entry.key, entry] as const),
);

/** O(1) lookup by curriculum key. */
export function getGrammarPoint(key: string): GrammarPoint | undefined {
  return GRAMMAR_POINT_INDEX.get(key);
}

/**
 * Curriculum sequence number for the theory library's "curriculum order"
 * sort: a grammar point's 0-based position within its OWN language's
 * curriculum array (ES, DE, TR each restart at 0). Built once at module load
 * from the per-language arrays — `ALL_CURRICULA` is not used here because its
 * concatenation would offset DE/TR positions by the lengths of the languages
 * before them.
 */
const CURRICULUM_ORDER_INDEX: ReadonlyMap<string, number> = new Map(
  [esCurriculum, deCurriculum, trCurriculum].flatMap((curriculum) =>
    curriculum.map((entry, index) => [entry.key, index] as const),
  ),
);

/**
 * Position of `key` within its language's curriculum array (0-based), or
 * `undefined` for an unknown key. Callers (the theory list endpoint) sort
 * topics with an `undefined` order last.
 */
export function curriculumOrderOf(key: string): number | undefined {
  return CURRICULUM_ORDER_INDEX.get(key);
}

const KEY_REGEX = /^(es|de|tr)-(a1|a2|b1|b2)-[a-z0-9-]+$/;

const LANGUAGE_PREFIX_BY_LANGUAGE: Readonly<Record<string, string>> = {
  ES: 'es',
  DE: 'de',
  TR: 'tr',
};

// TR is now full-A1/A2 (Yedi İklim parity, 2026-05-28); B1/B2 remain disabled.
// ES/DE are still TEMPORARILY REDUCED (2026-05-10) to match the entries
// currently uncommented in es.ts / de.ts. When restoring those entries, bump
// the ES/DE minimums back to { A1: 4, A2: 5, B1: 6, B2: 5 } and re-enable the
// per-language counts assertions in curriculum.test.ts.
const PER_LANGUAGE_GRAMMAR_MIN: Readonly<Record<string, Record<string, number>>> = {
  ES: { A1: 0, A2: 0, B1: 6, B2: 5 },
  DE: { A1: 0, A2: 0, B1: 0, B2: 0 },
  TR: { A1: 26, A2: 14, B1: 0, B2: 0 },
};

/**
 * Throws if any cross-cutting curriculum invariant is violated. Designed to be
 * called from `curriculum.test.ts` so the test suite fails fast if the shipped
 * curriculum drifts. Production code does not call this — production trusts the
 * invariants because the test gate blocks bad merges.
 *
 * The optional `curriculum` argument lets mutation tests pass a cloned and
 * deliberately-broken copy without touching the frozen `ALL_CURRICULA`.
 */
export function assertCurriculumInvariants(
  curriculum: readonly GrammarPoint[] = ALL_CURRICULA,
): void {
  const seenKeys = new Set<string>();
  const lookup = new Map(curriculum.map((entry) => [entry.key, entry] as const));

  for (const entry of curriculum) {
    // 1. Key format
    if (!KEY_REGEX.test(entry.key)) {
      throw new Error(`Curriculum invariant violated: malformed key '${entry.key}'`);
    }

    // 2. Globally unique keys
    if (seenKeys.has(entry.key)) {
      throw new Error(`Curriculum invariant violated: duplicate key '${entry.key}'`);
    }
    seenKeys.add(entry.key);

    // 3. language field matches the key prefix
    const expectedPrefix = LANGUAGE_PREFIX_BY_LANGUAGE[entry.language];
    if (!expectedPrefix || !entry.key.startsWith(`${expectedPrefix}-`)) {
      throw new Error(
        `Curriculum invariant violated: language '${entry.language}' does not match key prefix on '${entry.key}'`,
      );
    }

    // 4. cefrLevel matches the key infix
    const keyInfix = entry.key.split('-')[1].toUpperCase();
    if (keyInfix !== entry.cefrLevel) {
      throw new Error(
        `Curriculum invariant violated: cefrLevel '${entry.cefrLevel}' does not match key infix on '${entry.key}'`,
      );
    }

    // 5. examplesPositive.length >= 2
    if (entry.examplesPositive.length < 2) {
      throw new Error(
        `Curriculum invariant violated: '${entry.key}' has fewer than 2 positive examples`,
      );
    }

    // 6. examplesNegative.length >= 1, each starts with '*'
    if (entry.examplesNegative.length < 1) {
      throw new Error(
        `Curriculum invariant violated: '${entry.key}' has no negative examples`,
      );
    }
    for (const negative of entry.examplesNegative) {
      if (!negative.startsWith('*')) {
        throw new Error(
          `Curriculum invariant violated: '${entry.key}' has a negative example missing the leading '*': ${negative}`,
        );
      }
    }

    // 7. commonErrors.length >= 1
    if (entry.commonErrors.length < 1) {
      throw new Error(
        `Curriculum invariant violated: '${entry.key}' has no commonErrors`,
      );
    }

    // 8. description.length <= 200
    if (entry.description.length > 200) {
      throw new Error(
        `Curriculum invariant violated: '${entry.key}' description exceeds 200 characters (got ${entry.description.length})`,
      );
    }

    // 9. prerequisiteKeys (if present) resolve in the same language
    if (entry.prerequisiteKeys) {
      for (const prerequisite of entry.prerequisiteKeys) {
        const target = lookup.get(prerequisite);
        if (!target) {
          throw new Error(
            `Curriculum invariant violated: '${entry.key}' has dangling prerequisite '${prerequisite}'`,
          );
        }
        if (target.language !== entry.language) {
          throw new Error(
            `Curriculum invariant violated: '${entry.key}' has cross-language prerequisite '${prerequisite}' (${target.language} vs ${entry.language})`,
          );
        }
      }
    }

    // 9b. clozeUnsuitable is only meaningful on grammar points — a vocab
    //     umbrella has no cloze cell to suppress, so flagging one is a data error.
    if (entry.clozeUnsuitable && entry.kind !== 'grammar') {
      throw new Error(
        `Curriculum invariant violated: '${entry.key}' is clozeUnsuitable but not kind 'grammar'`,
      );
    }
  }

  // 10. Per-language grammar counts
  const perLanguageCounts: Record<string, Record<string, number>> = {};
  for (const entry of curriculum) {
    if (entry.kind !== 'grammar') continue;
    perLanguageCounts[entry.language] ??= {};
    perLanguageCounts[entry.language][entry.cefrLevel] =
      (perLanguageCounts[entry.language][entry.cefrLevel] ?? 0) + 1;
  }
  for (const [language, mins] of Object.entries(PER_LANGUAGE_GRAMMAR_MIN)) {
    for (const [level, min] of Object.entries(mins)) {
      const got = perLanguageCounts[language]?.[level] ?? 0;
      if (got < min) {
        throw new Error(
          `Curriculum invariant violated: ${language} ${level} grammar count ${got} below minimum ${min}`,
        );
      }
    }
  }
}
