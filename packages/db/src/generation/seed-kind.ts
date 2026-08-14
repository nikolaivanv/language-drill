import { ExerciseType } from '@language-drill/shared';

import type { Cell } from './cells';

/**
 * Which seed band a cell draws from, or null for non-seeded types. Pure — the
 * type gate is unit-tested without a DB. cloze/translation seed at-level content
 * words; verb-morphology conjugation seeds at-or-below-level VERBS (any language
 * now that PoS is DB-backed — previously ES-only). NOMINAL-inflection points
 * (`conjugationSeedKind: 'noun'` — possessive/case/copula) decline a noun, not a
 * verb, so their conjugation cell seeds from the NOUN band instead. The legacy
 * `'none'` opts out of seeding entirely. vocab_recall now seeds from the
 * curated `vocab_target` list (Spec 2) — an umbrella with no approved targets
 * falls back to unseeded free generation. free-writing/etc. remain unseeded.
 *
 * Lives in its own module (rather than in `run-one-cell.ts`) so pure consumers
 * — `diversity-mechanisms.ts`, and through it the admin API — can import the
 * gate without pulling in drizzle, the schema, and the Anthropic SDK.
 */
export function seedKindFor(
  cell: Cell,
): | 'frequency' | 'verb' | 'noun' | 'predicate-nominal' | 'elicitation-values'
  | 'vocab-target' | 'construction-variants' | null {
  if (
    (cell.exerciseType === ExerciseType.CLOZE ||
      cell.exerciseType === ExerciseType.TRANSLATION) &&
    cell.grammarPoint.selfRevealingElicitation
  ) {
    // Self-revealing point (numbers/ordinals): rotate over the curated
    // target-form pool instead of the frequency band — the target form IS the
    // diversity axis. Frequency seeding let the model collapse onto one value
    // ('üçüncü' in 18/20 approved TR translations).
    return 'elicitation-values';
  }
  if (
    (cell.exerciseType === ExerciseType.CLOZE ||
      cell.exerciseType === ExerciseType.TRANSLATION ||
      // sentence_construction joined 2026-08-14. It was excluded when variants
      // shipped (#631), which stranded `de-b1-um-zu-damit` — the only point
      // declaring both — with a collapsed SC cell no repass could reach:
      // demoting its rows frees slots the rotation could not refill, so the
      // right fix is seeding, not demotion. Rotation is also the documented
      // remedy for "multi-construction points are a poor fit for SC" (proven
      // on tr-a2-reported-speech): the failure there was an either/or prompt
      // with no single scorable target, and one mandated construction per
      // draft is exactly the "force a single construction" cure.
      cell.exerciseType === ExerciseType.SENTENCE_CONSTRUCTION) &&
    cell.grammarPoint.constructionVariants &&
    cell.grammarPoint.constructionVariants.length > 0
  ) {
    // Multi-construction point: the SUB-CONSTRUCTION is the diversity axis, not
    // the content word. A frequency seed gets absorbed into the complement
    // (`restaurante`, `iglesia`) while the frame stays free and collapses onto
    // the prototype — 43/50 `Dicen` clozes for es-b1-impersonal-plural.
    return 'construction-variants';
  }
  if (
    cell.exerciseType === ExerciseType.CLOZE ||
    cell.exerciseType === ExerciseType.TRANSLATION ||
    // Dictation: a per-ordinal frequency lemma is a loose lexical anchor that
    // breaks the "everything is about reading a book" collapse. No prior-seed
    // avoid-list (priorSeeds stays empty for dictation) — diversity comes from
    // batchSeed rotation over the band, matching cloze/translation.
    cell.exerciseType === ExerciseType.DICTATION
  ) {
    return 'frequency';
  }
  if (cell.exerciseType === ExerciseType.CONJUGATION) {
    const seedKind = cell.grammarPoint.conjugationSeedKind;
    if (seedKind === 'none') return null;
    if (seedKind === 'noun') return 'noun';
    if (seedKind === 'predicate-nominal') return 'predicate-nominal';
    return 'verb';
  }
  if (cell.exerciseType === ExerciseType.CONTEXTUAL_PARAPHRASE) {
    // Curated scenario-seed rotation from the umbrella's paraphrase.seeds pool,
    // reusing the elicitation-values path: persisted as content_json.seedWord and
    // excluded cross-run via fetchPriorSeeds — the identity-diversity axis.
    return 'elicitation-values';
  }
  if (cell.exerciseType === ExerciseType.VOCAB_RECALL) {
    // Seed the target word from the curated vocab_target list, preferring
    // uncovered targets so coverage converges (Spec 2). buildSeedWords returns
    // undefined when the umbrella has no approved targets, restoring today's
    // free generation for un-authored umbrellas (the data-driven gate).
    return 'vocab-target';
  }
  return null;
}
