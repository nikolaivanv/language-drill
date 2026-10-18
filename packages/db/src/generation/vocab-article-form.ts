/**
 * Resolve a vocab_recall row's `articleForm` — the noun WITH its definite
 * article ("la espalda") that the article rule grades against (see
 * `packages/shared/src/vocab-article.ts`). Shared by the generation insert path
 * and the one-off `backfill:vocab-article-form` script so new and old rows get
 * the same answer.
 */

import { bareVocabWord, normalizeWord, splitArticle } from '@language-drill/shared';
import { and, eq } from 'drizzle-orm';
import type { Db } from '../client';
import { vocabTarget } from '../schema/index';

const DEFINITE = new Set(['el', 'la', 'los', 'las', 'der', 'die', 'das']);

/** Only ES/DE nouns carry an article; Turkish has none. */
export function languageHasArticles(language: string): boolean {
  return language === 'ES' || language === 'DE';
}

/**
 * Pure resolution. Prefers the curated `displayForm` of the matching vocab
 * target (the authoritative gender), then an article the generator already put
 * on `expectedWord`. Returns null when neither carries a definite article —
 * verbs, adjectives, and nouns whose gender is unknown.
 */
export function articleFormFor(expectedWord: string, displayForm: string | null): string | null {
  for (const form of [displayForm, expectedWord]) {
    if (!form) continue;
    const { article, word } = splitArticle(form);
    if (article && DEFINITE.has(article)) return `${article} ${word}`;
  }
  return null;
}

/**
 * The curated target whose lemma or display form matches `expectedWord`.
 * Noun/verb homographs ("das Essen" / "essen", "el deber" / "deber") all match
 * case-folded, so: an exact-case match (article aside) wins, then — among the
 * remaining candidates — a noun or untagged target only when `expectedWord`
 * itself carries an article, a non-noun otherwise. A verb exercise "essen" thus
 * never inherits "das Essen" as its article form.
 */
export function matchTarget<T extends { lemma: string; displayForm: string; pos?: string | null }>(
  targets: readonly T[],
  expectedWord: string,
): T | null {
  const key = normalizeWord(expectedWord);
  const folded = targets.filter(
    (t) => normalizeWord(t.lemma) === key || normalizeWord(t.displayForm) === key,
  );
  if (folded.length <= 1) return folded[0] ?? null;
  const exact = bareVocabWord(expectedWord);
  const exactHits = folded.filter(
    (t) => bareVocabWord(t.lemma) === exact || bareVocabWord(t.displayForm) === exact,
  );
  const candidates = exactHits.length > 0 ? exactHits : folded;
  const wantNoun = splitArticle(expectedWord).article !== null;
  const nounish = (t: T): boolean => t.pos == null || t.pos === 'noun';
  return candidates.find((t) => nounish(t) === wantNoun) ?? candidates[0];
}

/** Display form of the matching curated target (see `matchTarget`). */
export function matchTargetDisplayForm(
  targets: readonly { lemma: string; displayForm: string }[],
  expectedWord: string,
): string | null {
  return matchTarget(targets, expectedWord)?.displayForm ?? null;
}

/**
 * DB-backed resolution for one draft at insert time. Best-effort: a failed
 * lookup logs and falls back to the article on `expectedWord` (if any) rather
 * than failing the insert — a missing `articleForm` only means the article is
 * not required for that row. A matched target tagged with a non-noun `pos`
 * (connectors like "das heißt") never carries an article requirement, and gets
 * no fallback to `expectedWord`; nor does an unmatched word when every approved
 * target of the umbrella is a tagged non-noun.
 */
export async function resolveArticleForm(
  db: Db,
  language: string,
  umbrellaKey: string,
  expectedWord: string,
): Promise<string | null> {
  if (!languageHasArticles(language)) return null;
  let displayForm: string | null = null;
  try {
    const rows = await db
      .select({ lemma: vocabTarget.lemma, displayForm: vocabTarget.displayForm, pos: vocabTarget.pos })
      .from(vocabTarget)
      .where(
        and(
          eq(vocabTarget.language, language),
          eq(vocabTarget.umbrellaKey, umbrellaKey),
          eq(vocabTarget.status, 'approved'),
        ),
      );
    const targets = Array.isArray(rows)
      ? rows
          .filter((r): r is { lemma: string; displayForm: string; pos: string | null } =>
            typeof r?.lemma === 'string' && typeof r?.displayForm === 'string',
          )
          .map((r) => ({ lemma: r.lemma, displayForm: r.displayForm, pos: r.pos ?? null }))
      : [];
    const hit = matchTarget(targets, expectedWord);
    if (hit && hit.pos !== null && hit.pos !== 'noun') return null;
    // An all-non-noun umbrella (a verbs or expressions group) has no noun to
    // carry an article, so an unmatched "das macht nichts" gets none either.
    if (!hit && targets.length > 0 && targets.every((t) => t.pos !== null && t.pos !== 'noun')) {
      return null;
    }
    displayForm = hit?.displayForm ?? null;
  } catch (err) {
    console.warn('resolveArticleForm: vocab_target lookup failed', {
      umbrellaKey,
      expectedWord,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return articleFormFor(expectedWord, displayForm);
}
