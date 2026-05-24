/**
 * packages/ai — Deterministic Turkish vowel-harmony + word-formedness checker.
 *
 * Turkish vowel harmony and suffix-allomorph selection are closed-class,
 * algorithmic rules: the allomorph a suffix takes is a pure function of the
 * stem's last vowel. Delegating that to an LLM at generation/validation/
 * evaluation time is what let `domat___ / ler → domatler` (a non-word) ship.
 * This module computes the rule exactly, in-process, with no Claude call.
 *
 * `checkTurkishCloze` is the single entry point. It is pure and total: any
 * internal failure degrades to `{ kind: 'not-applicable' }` rather than
 * throwing, so a caller in the per-ordinal generation loop can never be
 * aborted by it (protects the batch-survival invariant).
 *
 * The combiner that maps a verdict onto a routing decision lives in
 * `packages/db/src/generation/deterministic-checks.ts` — this module owns the
 * linguistics only.
 */

import { type ClozeContent, Language } from "@language-drill/shared";

import { loadFrequency } from "./frequency/index.js";

// ---------------------------------------------------------------------------
// Vowel inventory — the canonical source. The evaluator prompt's TR note
// (packages/ai/src/prompts.ts) cites this table so the two cannot drift.
// front:  e i ö ü      back:      a ı o u
// rounded: o ö u ü     unrounded: a e ı i
// ---------------------------------------------------------------------------

export type TurkishVowel = "a" | "e" | "ı" | "i" | "o" | "ö" | "u" | "ü";

export const VOWELS = Object.freeze({
  front: new Set<TurkishVowel>(["e", "i", "ö", "ü"]),
  back: new Set<TurkishVowel>(["a", "ı", "o", "u"]),
  rounded: new Set<TurkishVowel>(["o", "ö", "u", "ü"]),
  unrounded: new Set<TurkishVowel>(["a", "e", "ı", "i"]),
});

/**
 * Maps every Turkish vowel — both cases — to its lowercase identity. Turkish
 * casing is special (`I`↔`ı`, `İ`↔`i`), and JS `.toLowerCase()` mis-handles
 * the dotless/dotted pair, so vowel classification uses this explicit table
 * rather than locale lowercasing. (Lexicon lookups, by contrast, use plain
 * `.toLowerCase()` to match how `build-frequency.ts` keyed `tr.json`.)
 */
const VOWEL_IDENTITY: ReadonlyMap<string, TurkishVowel> = new Map([
  ["a", "a"], ["A", "a"],
  ["e", "e"], ["E", "e"],
  ["ı", "ı"], ["I", "ı"],
  ["i", "i"], ["İ", "i"],
  ["o", "o"], ["O", "o"],
  ["ö", "ö"], ["Ö", "ö"],
  ["u", "u"], ["U", "u"],
  ["ü", "ü"], ["Ü", "ü"],
]);

const isLowVowel = (v: TurkishVowel): boolean => v === "a" || v === "e";

/** Returns the first Turkish vowel in `word`, or `null` if it has none. */
export function firstVowel(word: string): TurkishVowel | null {
  for (const ch of word) {
    const v = VOWEL_IDENTITY.get(ch);
    if (v !== undefined) return v;
  }
  return null;
}

/** Returns the last Turkish vowel in `word`, or `null` if it has none. */
export function lastVowel(word: string): TurkishVowel | null {
  let found: TurkishVowel | null = null;
  for (const ch of word) {
    const v = VOWEL_IDENTITY.get(ch);
    if (v !== undefined) found = v;
  }
  return found;
}

/**
 * The harmonic vowel a suffix takes after a stem whose last vowel is
 * `stemLastVowel`:
 *   - 2-way (low/e-a): front → `e`, back → `a`.
 *   - 4-way (high/i-ı-u-ü): (back,unrounded)→`ı`, (back,rounded)→`u`,
 *     (front,unrounded)→`i`, (front,rounded)→`ü`.
 */
export function harmonize(
  stemLastVowel: TurkishVowel,
  paradigm: "2-way" | "4-way",
): TurkishVowel {
  const isFront = VOWELS.front.has(stemLastVowel);
  if (paradigm === "2-way") {
    return isFront ? "e" : "a";
  }
  const isRounded = VOWELS.rounded.has(stemLastVowel);
  if (isFront) return isRounded ? "ü" : "i";
  return isRounded ? "u" : "ı";
}

const BLANK_MARKER = "___";

/**
 * Returns the visible stem immediately before the `___` blank when the blank
 * is **suffixal** (a letter directly abuts it, no whitespace), else `null`.
 *
 * `"Pazarda taze domat___ satıyorlar."` → `"domat"`.
 * `"Sınıfta sekiz ___ var."` (space before `___`) → `null` (lexical blank).
 * No `___` → `null`.
 */
export function extractSuffixalStem(sentence: string): string | null {
  const idx = sentence.indexOf(BLANK_MARKER);
  if (idx <= 0) return null; // not present, or at string start (no stem)
  const prefix = sentence.slice(0, idx);
  const match = prefix.match(/[\p{L}]+$/u);
  return match ? match[0] : null;
}

/**
 * Suffix surfaces that do NOT obey vowel harmony — a frozen `e`/`i` after a
 * back-vowel stem is correct Turkish here (`okurken`, `akşamleyin`). Matched
 * against the (plain-lowercased) `correctAnswer` so the harmony veto is
 * skipped; word-formedness still runs. Without this, `oku___ / rken` would be
 * a false `wrong-harmony` rejection.
 */
const INVARIANT_SUFFIXES: ReadonlySet<string> = new Set([
  "ken",
  "leyin",
  "gil",
  "mtrak",
  "ımtırak",
  "imtırak",
]);

// Match as a SUFFIX of the answer surface: the visible blank fill may carry a
// linking consonant (e.g. aorist `oku` + `-r-` + `-ken` → answer `"rken"`),
// so an exact-equality check would miss it.
const isInvariantSuffix = (answerLc: string): boolean =>
  [...INVARIANT_SUFFIXES].some((s) => answerLc.endsWith(s));

/** Turkish final-consonant softening, reversed: undo `p→b, ç→c, t→d, k→ğ`
 *  so an accusative/possessive visible stem like `kitab` maps back to the
 *  lemma `kitap`. */
function deMutateFinal(stemLc: string): string {
  if (stemLc.length === 0) return stemLc;
  const last = stemLc[stemLc.length - 1];
  const reverse: Record<string, string> = { b: "p", c: "ç", d: "t", ğ: "k" };
  const replacement = reverse[last];
  return replacement ? stemLc.slice(0, -1) + replacement : stemLc;
}

/** Replaces the first Turkish vowel in `word` with `vowel` (used to render the
 *  expected allomorph, e.g. `"ler"` with expected vowel `"a"` → `"lar"`). */
function replaceFirstVowel(word: string, vowel: TurkishVowel): string {
  const chars = [...word];
  for (let i = 0; i < chars.length; i++) {
    if (VOWEL_IDENTITY.has(chars[i])) {
      chars[i] = vowel;
      return chars.join("");
    }
  }
  return word;
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

export type DeterministicVerdict =
  | { kind: "ok" }
  | { kind: "not-applicable" }
  | { kind: "wrong-harmony"; expected: string; actual: string; stem: string }
  | { kind: "non-word-stem"; reconstructed: string; stem: string };

/**
 * Deterministic check for a Turkish cloze. Returns:
 *   - `wrong-harmony` — the blanked suffix is the wrong harmonic allomorph for
 *     the visible stem's last vowel (provably incorrect → reject upstream).
 *   - `non-word-stem` — harmony is fine but the visible stem is not a known
 *     Turkish lexeme (suspected mis-placed blank → flag upstream).
 *   - `not-applicable` — non-suffixal/lexical blank, no harmonizing vowel, or
 *     any internal failure (degrade-to-pass-through; never throws).
 *   - `ok` — checked and passes.
 *
 * Caller must already have narrowed `content` to a Turkish cloze; this function
 * does not re-check language (it has no language field on `ClozeContent`).
 */
export function checkTurkishCloze(content: ClozeContent): DeterministicVerdict {
  try {
    const stem = extractSuffixalStem(content.sentence);
    if (stem === null) return { kind: "not-applicable" };

    const answer = content.correctAnswer?.trim() ?? "";
    if (answer.length === 0) return { kind: "not-applicable" };

    const answerVowel = firstVowel(answer);
    if (answerVowel === null) return { kind: "not-applicable" };

    const stemVowel = lastVowel(stem);
    if (stemVowel === null) return { kind: "not-applicable" };

    const answerLc = answer.toLowerCase();

    // --- Harmony check (skipped for invariant/non-harmonic suffixes) -------
    if (!isInvariantSuffix(answerLc)) {
      const paradigm = isLowVowel(answerVowel) ? "2-way" : "4-way";
      const expectedVowel = harmonize(stemVowel, paradigm);
      if (expectedVowel !== answerVowel) {
        return {
          kind: "wrong-harmony",
          expected: replaceFirstVowel(answer, expectedVowel),
          actual: answer,
          stem,
        };
      }
    }

    // --- Word-formedness check ---------------------------------------------
    // Lexicon keys are plain-lowercased (build-frequency.ts), so look up with
    // plain `.toLowerCase()` for key parity. The reconstruction is naive
    // concatenation (no vowel-elision modelling); a miss only ever flags
    // (non-word-stem), never rejects, so an elision/irregular form is safe.
    const lex = loadFrequency(Language.TR);
    const stemLc = stem.toLowerCase();
    const reconstructed = stem + answer;
    const candidates = [stemLc, deMutateFinal(stemLc), reconstructed.toLowerCase()];
    const known = candidates.some((c) => lex.lookup(c) !== null);
    if (!known) {
      return { kind: "non-word-stem", reconstructed, stem };
    }

    return { kind: "ok" };
  } catch {
    return { kind: "not-applicable" };
  }
}
