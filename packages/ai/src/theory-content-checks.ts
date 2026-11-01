/**
 * packages/ai — deterministic checks on a generated theory page, run alongside
 * the LLM theory validator.
 *
 * The 2026-11-01 theory audit found Turkish forms rendered with Cyrillic
 * look-alike letters ("gelmен", "gelivер-", "gidiverdі"). An LLM reviewer reads
 * them as the intended Latin word, so it never flags them, while a learner who
 * copies the form types something that is not Turkish. A character-class check
 * catches every instance for free.
 */

/** Cyrillic and Greek blocks — look-alikes of Latin letters. */
const FOREIGN_SCRIPT = /[Ͱ-ϿЀ-ӿ]/;
/** Latin letters, including the extended range used by ES/DE/TR. */
const LATIN = /[A-Za-zÀ-ɏ]/;

/**
 * IPA in slashes (/θ/, /ʎ/) is legitimate notation on ES pronunciation notes,
 * and Greek θ is the usual way to write it.
 */
function isPhoneticNotation(word: string): boolean {
  const trimmed = word.replace(/^[«"'(\[]+|[»"'.,;:!?)\]]+$/g, "");
  return trimmed.length >= 3 && trimmed.startsWith("/") && trimmed.endsWith("/");
}

function collectStrings(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    out.push(value);
  } else if (Array.isArray(value)) {
    for (const v of value) collectStrings(v, out);
  } else if (typeof value === "object" && value !== null) {
    for (const v of Object.values(value)) collectStrings(v, out);
  }
}

/**
 * Words that mix Latin letters with Cyrillic/Greek ones, deduplicated, in page
 * order. Pure-Greek or pure-Cyrillic words are not reported: they are not a
 * look-alike substitution inside a target-language form.
 */
export function findMixedScriptWords(content: unknown): string[] {
  const strings: string[] = [];
  collectStrings(content, strings);
  const found = new Set<string>();
  for (const s of strings) {
    for (const word of s.split(/\s+/)) {
      if (!word || isPhoneticNotation(word)) continue;
      if (FOREIGN_SCRIPT.test(word) && LATIN.test(word)) found.add(word);
    }
  }
  return [...found];
}

/** Factual-error strings for the validator result, one per offending word. */
export function mixedScriptFactualErrors(content: unknown): string[] {
  return findMixedScriptWords(content).map(
    (w) =>
      `"${w}" mixes Latin letters with Cyrillic/Greek look-alikes; a learner copying it would type a non-word.`,
  );
}
