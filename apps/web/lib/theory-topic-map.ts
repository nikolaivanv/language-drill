import { type LearningLanguage, ExerciseType } from '@language-drill/shared';

// Exercise types that are produced *exclusively* by non-grammar curriculum
// kinds (`vocab` / `dictation` / `free-writing`). Theory pages exist only for
// `kind: 'grammar'` points (the theory pool is grammar-only), so a theory
// lookup for one of these types can only ever 404 — the guaranteed-permanent
// 404 that flooded Sentry from `/drill`. The authoritative kind→type mapping
// lives in `compatibleTypes` (packages/db generation); this is its inverse for
// the three non-grammar kinds.
const NON_THEORY_EXERCISE_TYPES: ReadonlySet<string> = new Set([
  ExerciseType.VOCAB_RECALL,
  ExerciseType.DICTATION,
  ExerciseType.FREE_WRITING,
]);

// Whether an exercise of the given `type` could ever have a theory page.
// Returns false only for the known non-grammar types; an unknown/null type
// defaults to true, so a genuinely new grammar type still gets a lookup (and
// the `useTheoryTopic` 404→empty-state path remains the safety net).
export function exerciseTypeHasTheory(
  type: string | null | undefined,
): boolean {
  if (!type) return true;
  return !NON_THEORY_EXERCISE_TYPES.has(type);
}

// Derives the theory topic id from an exercise's `grammar_point_key`.
//
// Convention: `<lang>-<rest>` (e.g. `tr-a1-vowel-harmony`) maps to topic id
// `<rest>` (e.g. `a1-vowel-harmony`). This matches the slug used by
// `theory_topics.topic_id` so a DB-backed render-from-JSON lookup
// (`GET /theory/:lang/:topicId`) and the static TSX registry both key off the
// same value.
//
// The resolver is purely a string transform — it does NOT check whether a
// matching theory topic exists. That decision is owned by `useTheoryTopic`,
// which falls back from static TSX to DB. Returning a non-null id here means
// "try to render it"; `useTheoryTopic` returning null means "no content yet,
// don't render the pill".
export function topicIdForGrammarPointKey(
  grammarPointKey: string | null | undefined,
  language: LearningLanguage,
): string | null {
  if (!grammarPointKey) return null;
  const prefix = `${language.toLowerCase()}-`;
  if (!grammarPointKey.startsWith(prefix)) return null;
  const rest = grammarPointKey.slice(prefix.length);
  return rest === '' ? null : rest;
}
