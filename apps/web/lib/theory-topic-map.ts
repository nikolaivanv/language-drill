import type { LearningLanguage } from '@language-drill/shared';

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
