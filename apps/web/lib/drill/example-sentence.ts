/**
 * Shared rendering for vocab_recall `exampleSentence`. The stored sentence is
 * one of two shapes:
 *   1. it contains the target word in a natural usage sentence
 *      (e.g. "Her sabah otobüse biniyorum"), or
 *   2. it was pre-blanked at generation time with a `___` where the word goes
 *      (e.g. "Mi ___ trabaja todos los días") — ~30% of the pool.
 *
 * Two directions render it consistently regardless of which shape was stored:
 *
 * - `hideWordInExample` (pre-submit hint): show the sentence with the word
 *   HIDDEN. Shape 2 already carries a blank → leave it. Shape 1 → mask the word,
 *   including inflected forms (Turkish suffixation: `otobüs` → "otobüse"), which
 *   the previous exact-word match leaked.
 * - `revealWordInExample` (post-submit / reveal): show the sentence with the
 *   word PRESENT. Shape 2 → fill the blank with the word. Shape 1 → leave the
 *   natural sentence as-is. Without this, shape-2 items render a bare `___` in
 *   the post-answer feedback card (the reported bug).
 */

// 2+ underscores. Matches the generator's `___` blank; kept at 2+ (not 3+) so a
// stray two-underscore blank is still handled.
const BLANK = /_{2,}/;
const BLANK_GLOBAL = /_{2,}/g;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True when the sentence was pre-blanked at generation time. */
export function hasBlank(sentence: string): boolean {
  return BLANK.test(sentence);
}

/**
 * Post-answer reveal: ensure the word is shown. Fills a pre-blanked slot with
 * `word`; a sentence that already contains the word is returned unchanged.
 */
export function revealWordInExample(sentence: string, word: string): string {
  if (!word || !hasBlank(sentence)) return sentence;
  return sentence.replace(BLANK_GLOBAL, word);
}

/**
 * Pre-submit hint: ensure the word is hidden. A pre-blanked sentence is left
 * as-is; otherwise the word is masked to `___`.
 *
 * Masks the word stem plus any trailing suffix letters so inflected forms are
 * covered (`otobüs` masks "otobüse"/"otobüsü"/"otobüste"). Uses a Unicode
 * letter lookbehind rather than `\b` — JS word boundaries are ASCII-only and
 * fail to anchor around words that start with ç/ş/ğ/ı/ö/ü. Trade-off: a word
 * that is a prefix of an unrelated word can over-mask (e.g. `el` would also mask
 * "elma"); over-masking a hint is acceptable, leaking the answer is not, so we
 * err toward hiding. Consonant-mutation forms (`kitap` → "kitabı") still leak —
 * a known limitation that needs morphology to close.
 */
export function hideWordInExample(sentence: string, word: string): string {
  if (hasBlank(sentence) || !word) return sentence;
  const re = new RegExp(`(?<!\\p{L})${escapeRegExp(word)}\\p{L}*`, 'giu');
  return sentence.replace(re, '___');
}
