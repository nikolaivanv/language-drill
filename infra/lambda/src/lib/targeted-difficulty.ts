import { CefrLevel } from '@language-drill/shared';
import { getGrammarPoint } from '@language-drill/db';

/**
 * Effective difficulty for a grammar-point-targeted pull. A targeted drill
 * must filter the pool at the point's OWN CEFR level (the key encodes it:
 * `es-a2-…` → A2) — clients send the profile level, which can differ when the
 * drill is launched from a cross-level surface (theory detail page, /progress
 * next-level preview). Unknown keys keep the requested difficulty, so a stale
 * or malformed key degrades to the untargeted behavior instead of a new 4xx.
 * Note: the key's language segment is not cross-checked against the request
 * language — a mismatch yields zero targeted rows via the language filter.
 *
 * Used by POST /sessions (routes/sessions.ts) and GET /exercises/set
 * (routes/exercises.ts) — keep both on this helper so they cannot drift.
 */
export function resolveTargetedDifficulty(
  requested: CefrLevel,
  grammarPointKey: string | undefined,
): CefrLevel {
  if (!grammarPointKey) return requested;
  return getGrammarPoint(grammarPointKey)?.cefrLevel ?? requested;
}
