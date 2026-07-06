/**
 * Curriculum-anchored category taxonomy for the theory library.
 *
 * A theory topic's category is not stored on the topic; it is *resolved* from
 * the topic's `grammarPointKey` (the curriculum `GrammarPoint.key`) via
 * `resolveTheoryCategory`. This keeps the taxonomy decoupled from the generated
 * content and lets the library re-bucket topics by editing the map here.
 *
 * `cases` and `morphology` were added beyond the original Spanish prototype's
 * category set so the Turkish-heavy live curriculum (locative / accusative /
 * genitive / dative cases, agglutinative suffixes) groups into meaningful
 * buckets rather than collapsing into `other`.
 *
 * `KEY_TO_CATEGORY` covers the curriculum entries that are currently live —
 * the ES A1/A2/B1/B2 grammar points and the full TR A1/A2/B1 grammar set. It
 * is expected to grow as more curriculum entries land: the entire DE
 * curriculum is intentionally absent for now, and non-`grammar` kinds
 * (`vocab`, `dictation`, `free-writing`) are intentionally omitted so they
 * fall through to `other`.
 */

/**
 * Stable category ids. Order here is intentional and mirrors the canonical
 * display order in `THEORY_CATEGORIES`, with `'other'` always last.
 */
export type TheoryCategoryId =
  | 'tenses'
  | 'moods'
  | 'pairs'
  | 'morphology'
  | 'cases'
  | 'syntax'
  | 'pronouns'
  | 'articles'
  | 'orthography'
  | 'other';

export type TheoryCategory = Readonly<{
  id: TheoryCategoryId;
  label: string;
  order: number;
}>;

/** The bucket every unmapped or vocab-kind topic falls into. */
export const FALLBACK_CATEGORY_ID: TheoryCategoryId = 'other';

/**
 * Display metadata for every category, in canonical order. Labels are
 * lowercase to match the app's lowercase aesthetic. `order` is strictly
 * increasing and `'other'` sorts last.
 */
export const THEORY_CATEGORIES: readonly TheoryCategory[] = [
  { id: 'tenses', label: 'verb tenses', order: 1 },
  { id: 'moods', label: 'moods & conditionals', order: 2 },
  { id: 'pairs', label: 'confusable pairs', order: 3 },
  { id: 'morphology', label: 'word morphology', order: 4 },
  { id: 'cases', label: 'noun cases', order: 5 },
  { id: 'syntax', label: 'syntax & clauses', order: 6 },
  { id: 'pronouns', label: 'pronouns', order: 7 },
  { id: 'articles', label: 'articles & gender', order: 8 },
  { id: 'orthography', label: 'orthography', order: 9 },
  { id: 'other', label: 'other', order: 99 },
];

/** O(1) lookup table built once at module load from `THEORY_CATEGORIES`. */
const CATEGORY_BY_ID: ReadonlyMap<TheoryCategoryId, TheoryCategory> = new Map(
  THEORY_CATEGORIES.map((category) => [category.id, category]),
);

/**
 * Resolve a category's display metadata by id. Falls back to the `'other'`
 * entry if an unknown id is somehow passed (defensive — the union type should
 * prevent this at compile time).
 */
export function getTheoryCategory(id: TheoryCategoryId): TheoryCategory {
  return CATEGORY_BY_ID.get(id) ?? CATEGORY_BY_ID.get(FALLBACK_CATEGORY_ID)!;
}

/**
 * Maps a curriculum `grammarPointKey` to its theory category. Only the
 * currently-uncommented grammar entries are listed; vocab-kind keys are
 * intentionally omitted so they fall through to `FALLBACK_CATEGORY_ID`.
 */
const KEY_TO_CATEGORY: Readonly<Record<string, TheoryCategoryId>> = {
  // --- Spanish (A1) ---
  'es-a1-noun-gender': 'articles',
  'es-a1-noun-plural': 'morphology',
  'es-a1-gender-agreement': 'articles',
  'es-a1-articles': 'articles',
  'es-a1-demonstratives': 'pronouns',
  'es-a1-possessives-atonic': 'pronouns',
  'es-a1-subject-pronouns': 'pronouns',
  'es-a1-interrogatives': 'syntax',
  'es-a1-present-indicative-regular': 'tenses',
  'es-a1-present-irregular-core': 'tenses',
  'es-a1-ser-estar-basic': 'pairs',
  'es-a1-hay-estar': 'pairs',
  'es-a1-gustar-basic': 'syntax',
  'es-a1-querer-poder-infinitive': 'syntax',
  'es-a1-numbers-ordinals': 'morphology',
  'es-a1-quantifiers-muy-mucho': 'pairs',
  'es-a1-negation-tampoco': 'syntax',
  'es-a1-relative-que-basic': 'syntax',
  'es-a1-noun-modifiers-de': 'syntax',
  'es-a1-coordination-basic': 'syntax',
  'es-a1-porque-para': 'syntax',
  'es-a1-prepositions-a-en': 'pairs',

  // --- Spanish (A2) ---
  'es-a2-present-irregular-stem-changes': 'tenses',
  'es-a2-preterite-regular': 'tenses',
  'es-a2-preterite-irregular': 'tenses',
  'es-a2-imperfect': 'tenses',
  'es-a2-preterito-perfecto': 'tenses',
  'es-a2-imperative-affirmative': 'moods',
  'es-a2-estar-gerundio': 'tenses',
  'es-a2-ir-a-future': 'tenses',
  'es-a2-periphrases-obligation-aspect': 'syntax',
  'es-a2-direct-object-pronouns': 'pronouns',
  'es-a2-indirect-object-pronouns-se': 'pronouns',
  'es-a2-tonic-pronouns-prepositions': 'pronouns',
  'es-a2-personal-a': 'syntax',
  'es-a2-reflexive-verbs': 'pronouns',
  'es-a2-gustar-type-verbs': 'syntax',
  'es-a2-articles-use': 'articles',
  'es-a2-possessives-tonic': 'pronouns',
  'es-a2-todo-otro-quantifiers': 'syntax',
  'es-a2-temporal-clauses': 'syntax',
  'es-a2-si-present-conditional': 'moods',
  'es-a2-exclamatives-impersonals': 'syntax',
  'es-a2-connectors': 'syntax',
  'es-a2-indefinites-double-negation': 'syntax',
  'es-a2-por-para': 'pairs',
  'es-a2-mente-adverbs': 'morphology',
  'es-a2-adjective-apocopation': 'morphology',
  'es-a2-comparatives-superlatives': 'syntax',

  // --- Spanish (B1/B2 grammar) ---
  'es-b1-present-subjunctive': 'moods',
  'es-b1-conditional': 'moods',
  'es-b1-llevar-time-expressions': 'syntax',
  'es-b1-relative-clauses': 'syntax',
  'es-b1-passive-se': 'syntax',
  'es-b2-past-subjunctive': 'moods',
  'es-b2-compound-tenses': 'tenses',
  'es-b2-conditional-perfect': 'moods',
  'es-b2-complex-conditionals': 'syntax',
  'es-b2-nuanced-ser-estar': 'pairs',

  // --- Spanish (B1 additions) ---
  'es-b1-futuro-simple': 'tenses',
  'es-b1-pluperfect': 'tenses',
  'es-b1-past-narration': 'tenses',
  'es-b1-imperative-negative-pronouns': 'moods',
  'es-b1-subjunctive-adverbial': 'moods',
  'es-b1-reported-speech': 'syntax',
  'es-b1-deber-obligation-probability': 'pairs',
  'es-b1-aspectual-periphrases': 'syntax',
  'es-b1-verb-preposition-regime': 'syntax',
  'es-b1-discourse-connectors': 'syntax',
  'es-b1-superlatives-comparisons': 'syntax',
  'es-b1-que-vs-cual': 'pairs',
  'es-b1-ser-estar-uses': 'pairs',
  'es-b1-indirect-questions': 'syntax',

  // --- Spanish (B2 additions) ---
  'es-b2-relative-clauses-advanced': 'syntax',
  'es-b2-subjunctive-compound': 'moods',
  'es-b2-subjunctive-negated-opinion': 'moods',
  'es-b2-subjunctive-temporal-concessive': 'moods',
  'es-b2-conditional-connectors': 'moods',
  'es-b2-passive-voice': 'syntax',
  'es-b2-verbs-of-change': 'syntax',
  'es-b2-se-middle-accidental': 'pronouns',
  'es-b2-clitic-advanced': 'pronouns',
  'es-b2-gerund-participle-constructions': 'syntax',
  'es-b2-consecutives-intensity': 'syntax',
  'es-b2-sino-adversatives': 'pairs',
  'es-b2-causal-connectors': 'syntax',
  'es-b2-lo-nominalizer': 'syntax',
  'es-b2-comparatives-advanced': 'syntax',
  'es-b2-quantifiers-advanced': 'syntax',
  'es-b2-cleft-sentences': 'syntax',
  'es-b2-appreciative-suffixes': 'morphology',

  // --- Turkish A1 ---
  'tr-a1-vowel-harmony': 'orthography',
  'tr-a1-stem-changes': 'orthography',
  'tr-a1-personal-suffixes': 'morphology',
  'tr-a1-plural-suffix': 'morphology',
  'tr-a1-locative': 'cases',
  'tr-a1-present-continuous': 'tenses',
  'tr-a1-negation': 'tenses',
  'tr-a1-dili-past': 'tenses',
  'tr-a1-future': 'tenses',
  'tr-a1-imperative': 'moods',
  'tr-a1-questions': 'syntax',
  'tr-a1-degil': 'syntax',
  'tr-a1-var-yok': 'syntax',
  'tr-a1-accusative-definite-object': 'cases',
  'tr-a1-ablative-dative': 'cases',
  'tr-a1-genitive-possessive': 'cases',
  'tr-a1-demonstratives': 'pronouns',
  'tr-a1-personal-pronouns': 'pronouns',
  'tr-a1-numbers-ordinals': 'morphology',
  'tr-a1-possessive-suffixes': 'morphology',
  'tr-a1-instrumental-ile': 'cases',
  'tr-a1-postpositions-once-sonra': 'syntax',
  'tr-a1-dan-a-kadar': 'syntax',
  'tr-a1-ki-relativizer': 'syntax',
  'tr-a1-gore-bence': 'syntax',
  'tr-a1-beri-dir': 'syntax',
  'tr-a1-comparative-superlative': 'syntax',

  // --- Turkish A2 ---
  'tr-a2-indefinite-compound': 'morphology',
  'tr-a2-suffix-order-buffers': 'morphology',
  'tr-a2-optative': 'moods',
  'tr-a2-indefinite-pronouns': 'pronouns',
  'tr-a2-consonant-doubling': 'orthography',
  'tr-a2-reflexive-reciprocal-pronouns': 'pronouns',
  'tr-a2-distributive': 'morphology',
  'tr-a2-mis-evidential': 'tenses',
  'tr-a2-aorist': 'tenses',
  'tr-a2-ability-necessity': 'moods',
  'tr-a2-converbs': 'syntax',
  'tr-a2-converb-temporal': 'syntax',
  'tr-a2-nominalization': 'syntax',
  'tr-a2-relative-an': 'syntax',
  'tr-a2-gibi-kadar': 'syntax',
  'tr-a2-correlative-conjunctions': 'syntax',
  'tr-a2-causal-connectors': 'syntax',
  'tr-a2-possessive-case-stacking': 'morphology',
  'tr-a2-ca-suffix': 'morphology',
  'tr-a2-pekistirme': 'morphology',
  'tr-a2-purpose-icin-uzere': 'syntax',
  'tr-a2-reported-speech': 'syntax',

  // --- Turkish B1 ---
  'tr-b1-past-continuous-iyordu': 'tenses',
  'tr-b1-real-conditional': 'moods',
  'tr-b1-conditional-irrealis': 'moods',
  'tr-b1-obligation-periphrases': 'moods',
  // Verbal voice is derivational morphology on the stem (no dedicated "voice"
  // bucket), so causative/passive/reflexive/reciprocal group under morphology
  // rather than the finite-form "verb tenses" bucket.
  'tr-b1-causative-voice': 'morphology',
  'tr-b1-passive-voice': 'morphology',
  'tr-b1-reflexive-voice-kendi': 'morphology',
  'tr-b1-reciprocal-voice': 'morphology',
  'tr-b1-converb-while-yken': 'syntax',
  'tr-b1-since-converb': 'syntax',
  'tr-b1-participles-dik-acak': 'syntax',
};

/**
 * Resolve the theory category for a topic from its curriculum
 * `grammarPointKey`. Returns `FALLBACK_CATEGORY_ID` (`'other'`) for `null`,
 * `undefined`, or any key not present in `KEY_TO_CATEGORY`.
 */
export function resolveTheoryCategory(
  grammarPointKey: string | null | undefined,
): TheoryCategoryId {
  if (grammarPointKey == null) return FALLBACK_CATEGORY_ID;
  return KEY_TO_CATEGORY[grammarPointKey] ?? FALLBACK_CATEGORY_ID;
}
