/**
 * packages/ai — Deterministic answer/stem overlap checker for cloze drafts.
 *
 * A cloze is only well-formed if substituting `correctAnswer` into the `___`
 * yields the intended sentence. The generator periodically emits the answer as
 * the whole *phrase* while leaving part of that phrase visible in the stem, so
 * the substitution duplicates a word:
 *
 *   "No me gusta este abrigo; prefiero ___ del escaparate." / "el del"
 *     → "prefiero el del del escaparate"   (ES B1 nominalizers)
 *   "Ich habe ___ Bruder." / "einen Bruder"
 *     → "Ich habe einen Bruder Bruder"     (DE A1 accusative)
 *   "Mein Vater ist ___ Arzt." / "Arzt"
 *     → "Mein Vater ist Arzt Arzt"         (DE A1 zero article)
 *
 * Every such draft is unanswerable as printed — the learner can only produce
 * the fill the *visible* stem admits, and is then graded against the phrase.
 * 38 of these were live in the prod pool on 2026-08-08. Neither the structural
 * parser (`parseGeneratedClozeDraft`, which checks only that a `___` exists)
 * nor the LLM validator caught them; they scored 0.85-0.9 and auto-approved.
 *
 * This module computes the overlap exactly, in-process, with no Claude call.
 * `checkClozeOverlap` is the single entry point. It is pure and total: any
 * internal failure degrades to `{ kind: 'not-applicable' }` rather than
 * throwing, so a caller in the per-ordinal generation loop can never be
 * aborted by it (protects the batch-survival invariant) — same contract as
 * `checkTurkishCloze`.
 *
 * The combiner that maps a verdict onto a routing decision lives in
 * `packages/db/src/generation/deterministic-checks.ts` — this module owns the
 * detection only.
 *
 * ## Why two confidence tiers
 *
 * A MULTI-token answer whose edge token restates the adjacent stem word is a
 * provable defect: no natural sentence wants "in den Park Park". Those are
 * `certain` → rejected.
 *
 * A SINGLE-token answer equal to the adjacent stem word is *usually* the same
 * defect, but adjacent repetition does occur legitimately — Turkish
 * distributive/intensive reduplication ("ikişer ikişer", "yavaş yavaş") and
 * German relative-pronoun-then-article sequences ("die Frau, die die Tür
 * öffnete"). Those are `suspected` → flagged (kept for review, not discarded).
 * All 13 single-token hits in the 2026-08-08 prod sweep of ~25k approved cloze
 * rows were genuine defects (zero-article / article-use cells restating the
 * noun), zero were reduplication.
 *
 * That reading did not survive the next sweep. On 2026-08-13 the first
 * `revalidate:cloze --deterministic-only` pass over the whole pool wanted to
 * flag 7 approved rows, and **6 were false positives** — DE B1 Konjunktiv II
 * conditionals ("Wenn ich mehr Zeit gehabt hätte, ___ ich …" / "hätte"), where
 * the repetition spans the comma between the two clauses. Hence the
 * `CLAUSE_BOUNDARY` guard below: punctuation before the blank means the two
 * words are in different clauses, and the substitution is grammatical.
 */

import { type ClozeContent } from "@language-drill/shared";

/**
 * Verdict from {@link checkClozeOverlap}.
 *
 * - `not-applicable` — no blank marker, no answer, or nothing adjacent to
 *   compare (blank at a sentence edge, or the adjacent token is a parenthetical
 *   lemma cue). Also the total-function escape hatch for any internal failure.
 * - `ok` — substitution produces no duplicated word.
 * - `answer-stem-overlap` — the answer restates the stem word on `side` of the
 *   blank. `substituted` is the resulting broken sentence, for the reason
 *   `detail`.
 */
export type ClozeOverlapVerdict =
  | { kind: "not-applicable" }
  | { kind: "ok" }
  | {
      kind: "answer-stem-overlap";
      /** `certain` → reject; `suspected` → flag. See module docs. */
      confidence: "certain" | "suspected";
      /** Which side of the blank the duplicated stem word sits on. */
      side: "before" | "after";
      /** The duplicated token, as it appears in the stem. */
      token: string;
      /** The sentence with `correctAnswer` substituted into the blank. */
      substituted: string;
    };

const BLANK = "___";

/**
 * Compare-form of a token: strip leading/trailing punctuation and quoting, then
 * lowercase. Interior punctuation is kept, so a genuine contraction ("del",
 * "l'ora") still compares as one unit.
 */
function normalizeToken(token: string): string {
  return token
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "")
    .toLocaleLowerCase();
}

/**
 * Punctuation that closes a clause. When it trails the stem word immediately
 * before the blank, that word and the answer sit in **different clauses**, so
 * repeating it is not a duplication — German Konjunktiv II inverts the main
 * clause after the subordinate one ("Wenn ich mehr Zeit gehabt hätte, hätte ich
 * …"), and the substituted sentence is perfectly grammatical.
 *
 * Only the *before* side needs this. After the blank the punctuation belongs to
 * the answer's own clause, so it arrives as its own token (", hätte") which
 * normalizes to empty and never matches, or trails the duplicated word
 * ("Bruder.") where it separates nothing.
 */
const CLAUSE_BOUNDARY = /[,;:.!?…—–]$/u;

function words(text: string): string[] {
  const trimmed = text.trim();
  return trimmed.length === 0 ? [] : trimmed.split(/\s+/);
}

/**
 * Detect a cloze whose `correctAnswer` restates a word already printed in the
 * stem immediately beside the blank.
 *
 * Only the tokens *adjacent* to the blank are compared. A word repeated
 * elsewhere in the sentence is normal ("Ich habe einen Hund. Der Hund ist
 * süß.") and never a hit.
 *
 * A parenthetical immediately after the blank is the lemma/infinitive cue
 * ("birkaç ___ (portakal) var", "Die Kinder laufen ___ (der Park)") — it is
 * scaffolding, not sentence text, so it is skipped rather than compared.
 */
export function checkClozeOverlap(content: ClozeContent): ClozeOverlapVerdict {
  const sentence = content.sentence ?? "";
  const answer = (content.correctAnswer ?? "").trim();

  const blankIndex = sentence.indexOf(BLANK);
  if (blankIndex < 0 || answer.length === 0) {
    return { kind: "not-applicable" };
  }

  const head = sentence.slice(0, blankIndex);
  const tail = sentence.slice(blankIndex + BLANK.length);

  const answerTokens = words(answer);
  if (answerTokens.length === 0) return { kind: "not-applicable" };
  const confidence = answerTokens.length > 1 ? "certain" : "suspected";

  const substituted = `${head}${answer}${tail}`;

  // -- after the blank ------------------------------------------------------
  // Skipped when the next non-space character opens a parenthetical: that is
  // the lemma cue, not sentence text.
  if (!tail.trimStart().startsWith("(")) {
    const nextToken = words(tail)[0];
    const answerLast = answerTokens[answerTokens.length - 1];
    if (
      nextToken !== undefined &&
      normalizeToken(nextToken).length > 0 &&
      normalizeToken(nextToken) === normalizeToken(answerLast)
    ) {
      return {
        kind: "answer-stem-overlap",
        confidence,
        side: "after",
        token: nextToken,
        substituted,
      };
    }
  }

  // -- before the blank -----------------------------------------------------
  const headTokens = words(head);
  const prevToken = headTokens[headTokens.length - 1];
  const answerFirst = answerTokens[0];
  if (
    prevToken !== undefined &&
    !prevToken.endsWith(")") &&
    !CLAUSE_BOUNDARY.test(prevToken) &&
    normalizeToken(prevToken).length > 0 &&
    normalizeToken(prevToken) === normalizeToken(answerFirst)
  ) {
    return {
      kind: "answer-stem-overlap",
      confidence,
      side: "before",
      token: prevToken,
      substituted,
    };
  }

  return { kind: "ok" };
}
