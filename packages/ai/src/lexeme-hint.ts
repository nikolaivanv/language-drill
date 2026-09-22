/**
 * Deterministic check: does a cloze hand the learner the verb it blanks?
 *
 * For a grammar point whose target is a verb FORM — mood, clitic placement,
 * agreement — the verb's lexeme is never what is being tested. When the blank
 * swallows the whole predicate, the item silently adds a second task: guessing
 * which verb the author imagined.
 *
 * `generate@2026-09-21` (#730) offers two cures: a stem that ENTAILS the verb,
 * or the verb's bare infinitive in parentheses. The first is an LLM judgment
 * call, and it is the one that fails at the margin — a prod row scored 0.90 on
 * "Tienes una mancha en la mejilla. ___ con la mano sucia, usa una servilleta."
 * / `No te la toques`, where the judge read the INSTRUMENT phrase as an anchor
 * even though `no te la limpies` / `frotes` / `restriegues` all fit (a napkin
 * arguably points toward cleaning). The learner wrote `No la limpies` and was
 * marked wrong.
 *
 * This checker takes the judgment out of it for points flagged
 * `requiresLexemeHint`: the parenthetical is required, full stop. It is what
 * the affirmative half of that point already does in 92 % of its approved rows
 * — not because it is better authored, but because the unguessable accented
 * form (`Dáselas`) FORCES the generator to supply `(dar / se / las)`. The
 * negative half has no such forcing function and sits at 31 %.
 *
 * **Scope is deliberately narrow.** It proves one thing — the stem carries no
 * parenthetical infinitive at all — and says nothing about hint QUALITY. A hint
 * that pre-encodes the clitic (`(enviarlo)`, `(decírsela)`) still spoils the
 * pronoun whose placement the point tests, but it leaves the item answerable,
 * which is the learner-facing defect here; that case stays with the prompt rule
 * and the LLM validator, where judging it costs nothing extra. A deterministic
 * gate that can only downgrade must be obviously correct, so it does not guess.
 *
 * It also errs deliberately toward `ok`. Infinitive detection is morphological,
 * so a NOUN cue that happens to end in an infinitive suffix — ES `(lugar)`,
 * `(mujer)`, DE `(der Wagen)` — reads as a hint and lets the row through. That
 * direction is the safe one for a downgrade-only gate: a missed flag leaves the
 * row where the LLM validator already had it, while a false flag would demote a
 * sound exercise on a spelling coincidence.
 *
 * Pure function — no I/O, no Claude calls. Applicability (the curriculum flag)
 * is decided by the caller in `@language-drill/db`; this module must not import
 * the curriculum (see the ai↛db build cycle).
 */

import { type ClozeContent, Language } from "@language-drill/shared";

export type LexemeHintVerdict =
  /** Not applicable, or a parenthetical infinitive is present. */
  | { kind: "ok" }
  /** The stem carries no parenthetical infinitive the learner could use. */
  | { kind: "missing-hint" };

/** Spanish bare infinitive, any stem length — `dar` and `ir` are two letters. */
const ES_BARE_INFINITIVE = /^[a-zñ]*(?:ar|er|ir)$/iu;

/**
 * Enclitic pronoun run on a Spanish infinitive: `irse`, `enviarlo`,
 * `decírsela`. Stripped before the bare test so a hint that pre-encodes the
 * clitic still counts as SUPPLYING the lexeme — spoiling the pronoun is a
 * separate (lesser) defect, and one the LLM validator already judges.
 */
const ES_ENCLITICS = /(?:se|me|te|nos|os|los|las|les|lo|la|le)+$/iu;

const DEACCENT: Record<string, string> = { á: "a", é: "e", í: "i", ó: "o", ú: "u", ü: "u" };

/** `decírsela` → `decir`: enclisis forces a written accent on the infinitive. */
function esNormalize(token: string): string {
  return token.replace(/[áéíóúü]/giu, (ch) => DEACCENT[ch.toLowerCase()] ?? ch);
}

function isInfinitive(token: string, language: Language): boolean {
  switch (language) {
    case Language.ES: {
      if (ES_BARE_INFINITIVE.test(token)) return true;
      const stripped = esNormalize(token).replace(ES_ENCLITICS, "");
      return stripped !== "" && ES_BARE_INFINITIVE.test(stripped);
    }
    // German `-en`/`-n`, Turkish `-mak`/`-mek`.
    case Language.DE:
      return /^[a-zäöüß]{3,}e?n$/iu.test(token);
    case Language.TR:
      return /^[a-zçğıiöşü]{3,}m[ae]k$/iu.test(token);
    case Language.EN:
      return /^[a-z]{2,}$/iu.test(token);
  }
}

/** Inner text of every parenthetical group in the stem. */
function parentheticals(sentence: string): string[] {
  const out: string[] = [];
  for (const m of sentence.matchAll(/\(([^)]*)\)/gu)) {
    const inner = m[1]?.trim();
    if (inner) out.push(inner);
  }
  return out;
}

/**
 * Candidate lexeme tokens inside one parenthetical. Authors write these several
 * ways — `(dar / se / las)`, `(enseñar, se las)`, `(irse)` — so separators are
 * normalized away and each token is judged on its own.
 */
function tokens(inner: string): string[] {
  return inner
    .split(/[\s,/+]+/u)
    .map((t) => t.replace(/^[¿¡"'“”‘’]+|[.,;:!?"'“”‘’]+$/gu, ""))
    .filter((t) => t.length > 0);
}

/**
 * Verdict for one cloze. `ok` when the stem has no blank (not this checker's
 * business) or when some parenthetical token reads as an infinitive in
 * `language`.
 *
 * Deliberately permissive about WHERE the parenthetical sits: authors put it
 * after the sentence, after the blank, or mid-clause, and all three are legible
 * to the learner.
 */
export function checkLexemeHint(
  content: ClozeContent,
  language: Language,
): LexemeHintVerdict {
  const sentence = content.sentence ?? "";
  if (!sentence.includes("___")) return { kind: "ok" };

  for (const inner of parentheticals(sentence)) {
    for (const token of tokens(inner)) {
      if (isInfinitive(token, language)) return { kind: "ok" };
    }
  }
  return { kind: "missing-hint" };
}
