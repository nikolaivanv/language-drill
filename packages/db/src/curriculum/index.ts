import { COVERAGE_AXIS_VALUES, Language, type LearningLanguage } from '@language-drill/shared';

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

// CEFR rank for "at or below" comparisons. Mirrors ROUND_1_CEFR_LEVELS
// (generation/cells.ts) without importing across the curriculum→generation
// boundary. C1/C2 are intentionally absent — out-of-round levels rank as
// "unknown" and yield an empty scope.
const CEFR_RANK: Readonly<Record<string, number>> = { A1: 0, A2: 1, B1: 2, B2: 3 };

/**
 * All `kind: 'grammar'` points for `language` at or below `level`, in that
 * language's curriculum order. The "level scope" a learner at `level` has
 * plausibly studied — fed into the generation/validation prompts so they judge
 * level-appropriateness against the real curriculum instead of the model's own
 * sense of the CEFR band. Returns `[]` for an unknown/out-of-round level (C1/C2)
 * and excludes vocab/dictation/free-writing umbrellas (not grammar).
 *
 * `level` is typed `string` so callers can pass the broader `CefrLevel` enum
 * (which includes C1/C2) without a cast; unknown ranks fall through to `[]`.
 */
export function grammarPointsAtOrBelow(
  language: LearningLanguage,
  level: string,
): readonly GrammarPoint[] {
  const maxRank = CEFR_RANK[level];
  if (maxRank === undefined) return [];
  return ALL_CURRICULA.filter(
    (entry) =>
      entry.kind === 'grammar' &&
      entry.language === language &&
      (CEFR_RANK[entry.cefrLevel] ?? Number.POSITIVE_INFINITY) <= maxRank,
  );
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
// ES is at full PCIC A1-B2 parity (2026-07-07) plus the four B&B
// book-coverage-ledger additions (2026-07-16): 23 A1 + 27 A2 + 21 B1 +
// 24 B2 grammar-point floors. DE was re-enabled 2026-07-12 at full Menschen
// A1–B1 / Sicher! B2 parity: 18 A1 + 29 A2 + 25 B1 + 26 B2 grammar points.
const PER_LANGUAGE_GRAMMAR_MIN: Readonly<Record<string, Record<string, number>>> = {
  ES: { A1: 23, A2: 27, B1: 21, B2: 24 },
  DE: { A1: 19, A2: 31, B1: 27, B2: 27 },
  TR: { A1: 27, A2: 15, B1: 13, B2: 0 },
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

    // 8. description.length <= 450 (raised from 200 for Turkish, then from 300
    //    on 2026-07-16: 22 ES points sat at ≥280 and the DE gap-triage folds
    //    push several planned points past 300 — authors were trimming
    //    pedagogical content to fit. Descriptions are injected verbatim into
    //    generation/validation/theory prompts, so the cap exists to keep them
    //    summaries rather than essays; ~450 ≈ 100 extra tokens per call).
    if (entry.description.length > 450) {
      throw new Error(
        `Curriculum invariant violated: '${entry.key}' description exceeds 450 characters (got ${entry.description.length})`,
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

    // 9c. sentenceConstructionSuitable is only meaningful on grammar points.
    if (entry.sentenceConstructionSuitable && entry.kind !== 'grammar') {
      throw new Error(
        `Curriculum invariant violated: '${entry.key}' is sentenceConstructionSuitable but not kind 'grammar'`,
      );
    }

    // 9f. conjugationSuitable is only meaningful on real grammar points.
    if (entry.conjugationSuitable && entry.kind !== 'grammar') {
      throw new Error(
        `Curriculum invariant violated: conjugationSuitable set on non-grammar kind '${entry.kind}' ('${entry.key}')`,
      );
    }

    // 9g. conjugationSeedWords (the curated predicate pool) is present iff the
    //     point seeds from it (conjugationSeedKind: 'predicate-nominal'). A
    //     predicate-nominal point with no pool would fall back to an empty band
    //     and seed nothing; a pool on any other kind is dead config.
    if (
      entry.conjugationSeedKind === 'predicate-nominal' &&
      (!entry.conjugationSeedWords || entry.conjugationSeedWords.length === 0)
    ) {
      throw new Error(
        `Curriculum invariant violated: '${entry.key}' is conjugationSeedKind 'predicate-nominal' but has no conjugationSeedWords`,
      );
    }
    // conjugationSeedWords is a curated seed pool. Allowed on 'predicate-nominal'
    // (the copular predicate pool, required above) AND on verb-morphology points
    // (kind undefined or 'verb') whose target verb set is small and closed —
    // e.g. es-a1-present-yo-go: the curated list REPLACES the DB frequency band
    // so the generator can't pick off-target verbs (a 3sg "hace" doesn't exercise
    // the irregular yo-form). A pool on 'noun'/'none' is dead config.
    if (
      entry.conjugationSeedWords &&
      entry.conjugationSeedKind !== 'predicate-nominal' &&
      entry.conjugationSeedKind !== 'verb' &&
      entry.conjugationSeedKind !== undefined
    ) {
      throw new Error(
        `Curriculum invariant violated: '${entry.key}' has conjugationSeedWords but conjugationSeedKind '${entry.conjugationSeedKind}' does not support a curated pool (allowed: 'predicate-nominal', 'verb')`,
      );
    }

    // 9h. elicitationSeedValues (the curated target-form pool) is present iff
    //     the point is self-revealing. A self-revealing point with no pool
    //     would seed nothing (empty band); a pool without the flag is dead
    //     config.
    if (
      entry.selfRevealingElicitation &&
      (!entry.elicitationSeedValues || entry.elicitationSeedValues.length === 0)
    ) {
      throw new Error(
        `Curriculum invariant violated: '${entry.key}' has selfRevealingElicitation but no elicitationSeedValues`,
      );
    }
    if (
      entry.elicitationSeedValues &&
      entry.elicitationSeedValues.length > 0 &&
      !entry.selfRevealingElicitation
    ) {
      throw new Error(
        `Curriculum invariant violated: '${entry.key}' has elicitationSeedValues but no selfRevealingElicitation`,
      );
    }

    // 9e. freeWriting config is present iff the entry is a free-writing umbrella.
    if (entry.kind === 'free-writing' && !entry.freeWriting) {
      throw new Error(
        `Curriculum invariant violated: '${entry.key}' is kind 'free-writing' but has no freeWriting config`,
      );
    }
    if (entry.kind !== 'free-writing' && entry.freeWriting) {
      throw new Error(
        `Curriculum invariant violated: '${entry.key}' has freeWriting config but is not kind 'free-writing'`,
      );
    }

    // 9i. paraphrase config is present iff the entry is a paraphrase umbrella,
    // and its seed pool is non-empty.
    if (entry.kind === 'paraphrase' && (!entry.paraphrase || entry.paraphrase.seeds.length === 0)) {
      throw new Error(
        `Curriculum invariant violated: '${entry.key}' is kind 'paraphrase' but has no non-empty paraphrase.seeds`,
      );
    }
    if (entry.kind !== 'paraphrase' && entry.paraphrase) {
      throw new Error(
        `Curriculum invariant violated: '${entry.key}' has paraphrase config but is not kind 'paraphrase'`,
      );
    }

    // 9d. coverageSpec (Phase 2): axis applicability, unique axes, legal floor
    //     keys, positive-integer floors. `personRotation` is gone; a person axis
    //     here is the old flag.
    if (entry.coverageSpec) {
      const seenAxes = new Set<string>();
      for (const axis of entry.coverageSpec.axes) {
        if (seenAxes.has(axis.name)) {
          throw new Error(
            `Curriculum invariant violated: '${entry.key}' has duplicate axis '${axis.name}' in coverageSpec`,
          );
        }
        seenAxes.add(axis.name);

        if (axis.name === 'wordClass' && entry.kind !== 'vocab') {
          throw new Error(
            `Curriculum invariant violated: '${entry.key}' coverageSpec axis 'wordClass' is only valid on kind 'vocab'`,
          );
        }
        if (axis.name !== 'wordClass' && entry.kind !== 'grammar') {
          throw new Error(
            `Curriculum invariant violated: '${entry.key}' coverageSpec axis '${axis.name}' is only valid on kind 'grammar'`,
          );
        }

        const legal = COVERAGE_AXIS_VALUES[axis.name];
        const floorKeys = Object.keys(axis.floors);
        if (floorKeys.length === 0) {
          throw new Error(
            `Curriculum invariant violated: '${entry.key}' coverageSpec axis '${axis.name}' has no floors`,
          );
        }
        for (const [value, floor] of Object.entries(axis.floors)) {
          if (!legal.includes(value)) {
            throw new Error(
              `Curriculum invariant violated: '${entry.key}' coverageSpec axis '${axis.name}' has illegal value '${value}'`,
            );
          }
          if (!Number.isInteger(floor) || (floor as number) <= 0) {
            throw new Error(
              `Curriculum invariant violated: '${entry.key}' coverageSpec axis '${axis.name}' floor for '${value}' must be a positive integer`,
            );
          }
        }
      }
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
