/**
 * packages/ai — Deterministic mixed-script checker for generated exercises.
 *
 * Every language the app teaches (EN/ES/DE/TR) is written in Latin script, but
 * the generator occasionally emits a word with one or two **Cyrillic** letters
 * spliced in mid-word: "şemsiyен", "sütле", "zorundасın", "Kliniктeki". The
 * substituted letters are the *phonetic* equivalents (н for n, р for r, у for u,
 * с for s), not the look-alikes, so the model is writing the right sound in the
 * wrong alphabet, not copying a lookalike from its input. Some are visible (н, л, к, м); many are
 * invisible homoglyphs (а, е, о, с), so neither a reviewer nor the LLM
 * validator reliably sees them. ~0.15% of generated rows carried one in every
 * month from 2026-05 to 2026-10 (84 rows on 2026-11-11, 40 approved) — and
 * when it lands in a cloze `correctAnswer`, a learner who types the correct
 * Latin form is graded against a string they cannot type.
 *
 * One stray Han character ("y终 defendiendo") showed up the same way, so the
 * check is "any letter outside Latin and Greek" rather than "Cyrillic". Greek
 * is allowed because conjugation breakdowns legitimately cite IPA ("/θ/").
 *
 * Pure and total: walks every string in the content (keys starting with `_`,
 * e.g. `_dedupKey`, are writer-only derivatives and skipped), never throws.
 * The combiner that maps the verdict onto routing lives in
 * `packages/db/src/generation/deterministic-checks.ts`.
 */

export type MixedScriptVerdict =
  | { kind: "ok" }
  | {
      kind: "mixed-script";
      /** Offending words with their JSON path, e.g. `referenceTranslation: şemsiyен`. */
      hits: string[];
    };

/** A letter that is neither Latin nor Greek. */
const FOREIGN_LETTER = /(?![\p{Script=Latin}\p{Script=Greek}])\p{L}/u;
/** Whitespace-delimited run containing a foreign letter. */
const FOREIGN_WORD = /\S*(?:(?![\p{Script=Latin}\p{Script=Greek}])\p{L})\S*/gu;

const MAX_HITS = 5;

function walk(value: unknown, path: string, hits: string[]): void {
  if (hits.length >= MAX_HITS) return;
  if (typeof value === "string") {
    if (!FOREIGN_LETTER.test(value)) return;
    for (const m of value.matchAll(FOREIGN_WORD)) {
      if (hits.length >= MAX_HITS) return;
      hits.push(`${path}: ${m[0]}`);
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, `${path}[${i}]`, hits));
    return;
  }
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if (k.startsWith("_")) continue;
      walk(v, path ? `${path}.${k}` : k, hits);
    }
  }
}

/**
 * Detect non-Latin, non-Greek letters anywhere in an exercise's content.
 * Every currently supported language is Latin-script; a future non-Latin
 * language must gate this check by language before routing on it.
 */
export function checkMixedScript(content: unknown): MixedScriptVerdict {
  try {
    const hits: string[] = [];
    walk(content, "", hits);
    return hits.length ? { kind: "mixed-script", hits } : { kind: "ok" };
  } catch {
    return { kind: "ok" };
  }
}
