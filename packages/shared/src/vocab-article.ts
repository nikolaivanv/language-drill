// Article-aware grading for vocab_recall nouns (ES/DE).
//
// Policy (2026-10-17): a noun answer must carry its definite article. Before
// this, the stored `expectedWord` was bare for most rows and article-bearing for
// others, the exact-match grader compared verbatim, and the evaluator prompt had
// no rule — so "cabeza" was marked down on one item while "la espalda" was
// marked down-then-up on the next. The rule now lives in one place:
//
//   - `content.articleForm` (e.g. "la espalda") marks the row as an article-
//     bearing noun. Absent → no article requirement (verbs, adjectives, TR).
//   - correct word + correct article        → exact
//   - correct word, no article              → missing-article
//   - correct word, wrong-gender article    → wrong-article
//   - anything else                         → no-match (falls through to Claude)
//
// An indefinite article of the right gender (una espalda, eine Schule) counts
// as exact: it shows the learner knows the gender, which is what the rule tests.

import type { VocabRecallContent } from "./index";
import { normalizeFluencyAnswer } from "./fluency";

/** Definite article → its gender/number class. */
const DEFINITE: Record<string, string> = {
  // Spanish
  el: "es-m",
  la: "es-f",
  los: "es-mpl",
  las: "es-fpl",
  // German
  der: "de-m",
  die: "de-f",
  das: "de-n",
};

/** Indefinite article → the classes it is compatible with. */
const INDEFINITE: Record<string, readonly string[]> = {
  un: ["es-m"],
  una: ["es-f"],
  unos: ["es-mpl"],
  unas: ["es-fpl"],
  // `ein` is masculine OR neuter; `die` doubles as the plural, which has no
  // singular indefinite counterpart, so `eine` is feminine only.
  ein: ["de-m", "de-n"],
  eine: ["de-f"],
};

export type VocabArticleGrade = "exact" | "missing-article" | "wrong-article" | "no-match";

interface SplitForm {
  /** Lower-cased leading article, or null when the form has none. */
  article: string | null;
  /** The form without its leading article. */
  word: string;
}

/** Split a leading (definite or indefinite) article off a multi-token form. */
export function splitArticle(form: string): SplitForm {
  const trimmed = form.trim().replace(/\s+/g, " ");
  const space = trimmed.indexOf(" ");
  if (space > 0) {
    const first = trimmed.slice(0, space).toLowerCase();
    if (first in DEFINITE || first in INDEFINITE) {
      return { article: first, word: trimmed.slice(space + 1) };
    }
  }
  return { article: null, word: trimmed };
}

/** The bare headword a hint or letter count should describe ("la mano" → "mano"). */
export function bareVocabWord(form: string): string {
  return splitArticle(form).word;
}

const CASE_FOLD_LOCALES = ["en", "tr"] as const;

function sameWord(a: string, b: string): boolean {
  return CASE_FOLD_LOCALES.some(
    (locale) => normalizeFluencyAnswer(a, locale) === normalizeFluencyAnswer(b, locale),
  );
}

function articleClass(article: string): readonly string[] {
  if (article in DEFINITE) return [DEFINITE[article]];
  return INDEFINITE[article] ?? [];
}

/**
 * Grade a vocab_recall answer under the article rule. Only meaningful when
 * `content.articleForm` is set; rows without it return "no-match" and the
 * caller keeps its plain exact-match path.
 */
export function gradeVocabArticle(
  content: Pick<VocabRecallContent, "expectedWord" | "acceptableAnswers" | "articleForm">,
  answer: string,
): VocabArticleGrade {
  if (!content.articleForm) return "no-match";
  const required = splitArticle(content.articleForm);
  if (!required.article || !(required.article in DEFINITE)) return "no-match";

  // Each accepted form carries its own article when it has one (a synonym may
  // differ in gender: "el automóvil" for "la coche"-style pairs); a bare
  // accepted form inherits the required article.
  const accepted = [content.articleForm, content.expectedWord, ...(content.acceptableAnswers ?? [])]
    .map(splitArticle)
    .map((f) => ({ word: f.word, article: f.article ?? required.article! }));

  const given = splitArticle(answer);
  const hits = accepted.filter((a) => sameWord(a.word, given.word));
  if (hits.length === 0) return "no-match";
  if (given.article === null) return "missing-article";

  const givenClasses = articleClass(given.article);
  const ok = hits.some((h) => {
    const want = DEFINITE[h.article];
    return want !== undefined && givenClasses.includes(want);
  });
  return ok ? "exact" : "wrong-article";
}

/** Score for the right word without its article (the evaluator uses the same). */
export const VOCAB_MISSING_ARTICLE_SCORE = 0.8;

/** The article choices to show for a language ("el/la", "der/die/das"). */
export function articleChoicesLabel(articleForm: string): string | null {
  const { article } = splitArticle(articleForm);
  if (!article) return null;
  const cls = DEFINITE[article];
  if (!cls) return null;
  if (cls === "es-mpl" || cls === "es-fpl") return "los/las";
  return cls.startsWith("es") ? "el/la" : "der/die/das";
}
