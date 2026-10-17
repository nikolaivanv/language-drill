/**
 * Resolve a vocab_recall row's `articleForm` — the noun WITH its definite
 * article ("la espalda") that the article rule grades against (see
 * `packages/shared/src/vocab-article.ts`). Shared by the generation insert path
 * and the one-off `backfill:vocab-article-form` script so new and old rows get
 * the same answer.
 */

import { normalizeWord, splitArticle } from '@language-drill/shared';
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

/** The curated target whose lemma or display form matches `expectedWord`. */
export function matchTargetDisplayForm(
  targets: readonly { lemma: string; displayForm: string }[],
  expectedWord: string,
): string | null {
  const key = normalizeWord(expectedWord);
  const hit = targets.find(
    (t) => normalizeWord(t.lemma) === key || normalizeWord(t.displayForm) === key,
  );
  return hit?.displayForm ?? null;
}

/**
 * DB-backed resolution for one draft at insert time. Best-effort: a failed
 * lookup logs and falls back to the article on `expectedWord` (if any) rather
 * than failing the insert — a missing `articleForm` only means the article is
 * not required for that row.
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
      .select({ lemma: vocabTarget.lemma, displayForm: vocabTarget.displayForm })
      .from(vocabTarget)
      .where(
        and(
          eq(vocabTarget.language, language),
          eq(vocabTarget.umbrellaKey, umbrellaKey),
          eq(vocabTarget.status, 'approved'),
        ),
      );
    const targets = Array.isArray(rows)
      ? rows.filter((r): r is { lemma: string; displayForm: string } =>
          typeof r?.lemma === 'string' && typeof r?.displayForm === 'string',
        )
      : [];
    displayForm = matchTargetDisplayForm(targets, expectedWord);
  } catch (err) {
    console.warn('resolveArticleForm: vocab_target lookup failed', {
      umbrellaKey,
      expectedWord,
      error: err instanceof Error ? err.message : String(err),
    });
  }
  return articleFormFor(expectedWord, displayForm);
}
