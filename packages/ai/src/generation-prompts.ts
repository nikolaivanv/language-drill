/**
 * packages/ai — Prompt builders for the exercise generator.
 *
 * Pure functions; no I/O. The system prompt is what gets cached via Anthropic
 * prompt caching when the generator dispatches drafts in a cell — see
 * generate.ts for how it's wired up. Two calls with the same (inputs, recentStems)
 * MUST return identical strings, otherwise prompt caching cannot hit.
 */

import {
  type CefrLevel,
  type CoverageAxis,
  type CoverageTarget,
  type ExerciseContent,
  ExerciseType,
  type GrammarPoint,
  Language,
  PERSON_CODES,
  type PersonCode,
} from "@language-drill/shared";

import { CEFR_LEVEL_DESCRIPTORS } from "./prompts.js";
import { TOOL_NAME_BY_TYPE } from "./generate.js";
import { getPromptWithVarsOrFallback } from "./prompts-registry.js";
import { renderLevelScopeSection } from "./level-scope.js";

// The TOOL_NAME_BY_TYPE import comes from generate.ts. The two modules form
// a circular import on paper — generate.ts will import from this file in
// Task 9 — but neither side dereferences the other at module init: prompt
// builders are runtime functions, and generate.ts's module-init computations
// don't reach into generation-prompts.ts. ESM handles this case correctly.

// ---------------------------------------------------------------------------
// Recent-stems LRU helper
// ---------------------------------------------------------------------------

/**
 * Cap on how many stems appear in the system prompt's "do not resemble these"
 * list. The full set of seen stems lives in the generator's `seenStems` Set
 * (used to mark `inBatchDuplicate`); this number bounds the prompt size.
 */
export const MAX_RECENT_STEMS_IN_PROMPT = 30;

/**
 * Cap on how many pool-surfaces appear in the system prompt's "already in the
 * pool" list. Used by `vocab_recall` cells to feed Claude the words that have
 * already been generated and persisted — without this, the generator gravitates
 * to the same high-frequency words each run and the partial UNIQUE index
 * `exercises_dedup_idx` rejects them on insert, dragging effective approval
 * rate down even though the validator never said no. 250 keeps prompt size
 * bounded (~2.5 kB of bullets) while comfortably covering every saturated
 * vocab umbrella's word inventory.
 */
export const MAX_PRIOR_POOL_SURFACES_IN_PROMPT = 250;

export function tailRecentStems(stems: readonly string[]): string[] {
  return stems.slice(-MAX_RECENT_STEMS_IN_PROMPT);
}

export function capPriorPoolSurfaces(
  surfaces: readonly string[],
): readonly string[] {
  return surfaces.length <= MAX_PRIOR_POOL_SURFACES_IN_PROMPT
    ? surfaces
    : surfaces.slice(0, MAX_PRIOR_POOL_SURFACES_IN_PROMPT);
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export type GenerationPromptInputs = {
  language: Exclude<Language, Language.EN>;
  cefrLevel: CefrLevel;
  exerciseType: ExerciseType;
  grammarPoint: GrammarPoint;
  /**
   * Surfaces already in the persisted pool for this cell — passed by the
   * caller (currently only `runOneCell` for `vocab_recall`) so the generator
   * stops re-proposing words/sentences that would collide with
   * `exercises_dedup_idx`. The list is frozen for the duration of the batch
   * (same content for every ordinal), preserving prompt-cache hits across
   * ordinals within a cell. Empty/undefined → the "Already in the pool"
   * section is omitted entirely.
   */
  priorPoolSurfaces?: readonly string[];
  /**
   * Grammar points at or below this cell's CEFR level — the learner's "level
   * scope". Resolved by the caller via `grammarPointsAtOrBelow` (the curriculum
   * lives in `@language-drill/db`, which this package must not depend on) and
   * injected here, mirroring `priorPoolSurfaces`. `renderLevelScopeSection`
   * formats them into `{{levelScopeSection}}` for grammar-anchored types only;
   * empty/undefined → the section is omitted.
   */
  levelScopePoints?: readonly GrammarPoint[];
};

// ---------------------------------------------------------------------------
// CEFR descriptor block — built once at module load, reused on every call so
// the cached system prompt's bytes are identical across drafts.
// ---------------------------------------------------------------------------

const CEFR_DESCRIPTOR_BULLETS = (
  Object.entries(CEFR_LEVEL_DESCRIPTORS) as [CefrLevel, string][]
)
  .map(([level, descriptor]) => `- **${level}**: ${descriptor}`)
  .join("\n");

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function renderBulletList(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

function renderRecentStems(recentStems: readonly string[]): string {
  const tail = tailRecentStems(recentStems);
  if (tail.length === 0) return "(none yet)";
  return tail.map((stem) => `  - ${stem}`).join("\n");
}

// Bump in the same commit as any semantic edit to the generation system
// prompt (this file's `buildGenerationSystemPrompt`). Drives the Langfuse
// trace `promptVersion` tag — dashboards cohort old vs. new prompt traces
// by this string.
//
// NOTE: the date-only tag collapses same-day edits into one cohort — the
// `2026-06-12` bump covers BOTH the possessive-cloze diversity tweak in the
// system template (rotate persons, prefer vowel-final stems — that edit DID
// change the registered template, so it needed a Langfuse push) AND the
// curriculum-wide grammatical-person rotation in the per-draft USER prompt
// (`renderPersonBlock`, no Langfuse push needed). Use the `eval:gen`
// baseline/candidate arms — not promptVersion — to A/B within a day.
//
// 2026-06-16: added the "Plain text only — no markdown" rule to the
// sentence-construction section after the generator leaked `**keyword**`
// emphasis into the plain-text `prompt` field (rendered verbatim, so it
// showed literal asterisks). This edit changes the registered template — it
// needs a Langfuse push per env.
//
// 2026-06-16: added the conjugation guidance section ({{conjugationSection}})
// for the new conjugation/inflection ExerciseType. Also changes the registered
// template — needs a Langfuse push per env.
//
// 2026-06-17: added the level-scope block ({{levelScopeSection}}) — a
// curriculum-grounded list of grammar points at or below the target CEFR
// level, spliced between the CEFR descriptors and the prior-pool section.
// Gated to grammar-anchored types (cloze, translation, sentence_construction,
// conjugation). Also changes the registered template — needs a Langfuse push
// per env.
//
// 2026-06-19: verb-seeded ES conjugation — the user-prompt seed block now
// uses a strict "conjugate this verb" directive for ExerciseType.CONJUGATION
// (no substitution escape hatch). Added two instruction-discipline bullets to
// renderConjugationSection: use the given verb as lemma; `instructions` must
// contain ONLY the learner directive, no reasoning/meta-text.
//
// 2026-06-23: two TR-specific rules added to the system template after the
// 2026-06-22 run analysis. (a) Indefinite-noun-compound cloze rule: blank only
// the head, hint the bare head's citation form, answer in the nominative, no
// case-stacking (tr-a2-indefinite-compound was 8/49 — whole-compound blanks +
// omitted parenthetical heads + case-stacked answers flag `ambiguous`). (b)
// Gemination / stem-change translation rule: the source must force a
// vowel-initial suffix so the alternation is obligatory, keep the clause short,
// and enumerate synonym/number renderings in `acceptableAnswers`
// (tr-a2-consonant-doubling translation was 2/27 — bypassable + over-complex).
// Both change the registered template — they need a Langfuse push per env.
//
// 2026-06-25: tighten the indefinite-noun-compound cloze rule after the
// 2026-06-25 run (3/17 approved). The 2026-06-23 validator note fixed the
// false-rejects, exposing real generation defects: `bir` wedged against the
// compound (`bir şeker ___`), whole-compound/two-word answers (`basın
// toplantısı`), the modifier left only in the parenthetical (`bir ___ (destek)`),
// and abstract/admin/medical vocab. Adds the no-article-hugging, one-word-answer,
// literal-modifier, and concrete-vocab rules. Template edit → Langfuse push per env.
// 2026-06-30: two TR conjugation fixes after the 2026-06-30 run analysis, both
// in runtime-substituted sections (ship with the code deploy — NOT the
// registered Langfuse template, so no push-prompts run is needed). (a) New
// `predicate-nominal` seed kind for the copular personal-suffix point: the
// per-draft user prompt now renders a "predicate to use" directive (was "noun
// to inflect"), so the author builds "X is a <profession/adjective>" instead of
// declining an arbitrary object noun ("you are a cat"). (b) renderConjugationSection
// `breakdown` rule now forbids model deliberation / self-correction / check
// marks leaking into the learner-visible breakdown (locative conjugation was
// shipping breakdowns like "…back vowel i → e… wait: iş has back vowel? No —…✓").
// 2026-07-08: self-revealing digit-form directive for flagged numbers/
// ordinals cloze/translation cells (`grammarPoint.selfRevealingElicitation
// === 'digit-form'`). These points can't use a written-word seed without
// leaking the answer (the target IS the written form), so the per-draft
// user prompt now demands digit/numeral presentation instead, pinned to the
// seeded value when one is supplied. Lives entirely in the per-draft user
// prompt — the cached system template is untouched.
// 2026-07-08a: self-revealing base-word-cue directive for flagged derived-form
// points (`selfRevealingElicitation === 'base-word-cue'`, appreciative
// suffixes). The target cannot be elicited without identifying its base word,
// so the sanctioned cue is the parenthetical BASE word ("(silla)" → sillita);
// the derived form itself must never appear in the visible text. Pinned to
// the seeded target form when one is supplied. Per-draft user prompt only.
// 2026-07-09: contextual_paraphrase guidance section (`{{contextualParaphraseSection}}`,
// spliced after `{{sentenceConstructionSection}}`) plus a per-draft
// avoid/register/simplify constraint-kind rotation (`contextualParaphraseConstraintForOrdinal`)
// so a batch covers all three constraint kinds.
// 2026-07-10: contextual_paraphrase seed injected as a strict SCENARIO directive
// (per-draft user prompt), replacing the generic "build around the word … or
// substitute a similar-frequency word" framing that let the model discard the
// curated scenario seed and collapse the scenario-diversity axis. Code-side
// (user prompt) only — the system template is unchanged, so no Langfuse push.
export const GENERATION_PROMPT_VERSION = "generate@2026-07-12";

/**
 * Wording differs per type so Claude reads it the way the cell is constrained:
 * vocab cells are constrained at the target-word level, sentence cells at the
 * stem level. Returns the empty string when there are no priors so the section
 * is omitted entirely.
 */
function renderPriorPoolSection(
  exerciseType: ExerciseType,
  priorPoolSurfaces: readonly string[] | undefined,
): string {
  if (!priorPoolSurfaces || priorPoolSurfaces.length === 0) return "";
  const capped = capPriorPoolSurfaces(priorPoolSurfaces);
  const bullets = capped.map((surface) => `  - ${surface}`).join("\n");
  const heading =
    exerciseType === ExerciseType.VOCAB_RECALL
      ? "## Already in the pool — do NOT propose any of these target words"
      : "## Already in the pool — do NOT propose any exercise whose surface matches these";
  return `${heading}\n\n${bullets}\n\n`;
}

/**
 * Sentence-construction-only guidance block. Returns "" for every other type so
 * cloze/translation/vocab prompts stay byte-identical to the pre-2026-06-07
 * template (preserving their Anthropic cache prefix and Langfuse cohort). For a
 * sentence_construction cell it returns a section ending in `\n\n` so the
 * template's `{{sentenceConstructionSection}}## Output` splices cleanly.
 *
 * Added 2026-06-07 to fix three failure modes seen in the first production SC
 * run: (1) `grammar_target` mode produced open-ended "write a sentence using X"
 * prompts the validator flagged `ambiguous` (55% approval vs ~85% for the other
 * modes); (2) model answers propagated the exact `commonErrors` the point warns
 * against (e.g. TR `diye söyledi`, a non-reporting verb after `diye`); (3)
 * instructions spoiled the answer. The values are baked in here (not left as
 * `{{vars}}`) because this whole string is itself one flat template var — see
 * `renderPriorPoolSection` for the same pattern.
 */
function renderSentenceConstructionSection(
  exerciseType: ExerciseType,
  language: string,
  cefrLevel: string,
  grammarPointName: string,
): string {
  if (exerciseType !== ExerciseType.SENTENCE_CONSTRUCTION) return "";
  return `## Sentence-construction specifics (this exercise type)

This is a sentence_construction exercise: there is NO blank — the learner writes one complete ${language} sentence from a prompt. The blank-granularity, \`glossEn\`, \`correctAnswer\`, and \`acceptableAnswers\` rules above are cloze-only and do not apply here; the **Ambiguous**, **anti-leak**, **Stay on target**, vocabulary-band, and **Safe, neutral topics** rules DO apply, adapted as follows:

- **Constrain the answer space — no open "write a sentence using X".** A bare invitation like "Write a sentence using ${grammarPointName}" admits unboundedly many correct answers and cannot be scored — the validator flags it \`ambiguous\`. The \`prompt\` MUST pin the task down so a competent learner lands in a small, predictable set of sentences: require specific keywords, give a concrete one-line scenario to react to, or specify a target structure *together with* a situation. If the only constraint is "use ${grammarPointName}", the draft is too open — add a scenario or required words before submitting.
- **Model answers must be correct, natural, and error-free.** Every entry in \`modelAnswers\` (provide 2–3) MUST be fully grammatical ${language} at CEFR ${cefrLevel}, genuinely exercise ${grammarPointName}, satisfy the prompt's own constraints (use every required keyword / fit the scenario / use the named structure), and MUST NOT exhibit any of the **Common learner errors** listed above. A model answer is the target the learner aims at — never ship one that models the very mistake the grammar point warns against. If you cannot write 2–3 clean answers, simplify the \`prompt\` until you can.
- **Do not spoil the answer.** \`instructions\` and \`prompt\` may name the structure being practiced and may cite an example auxiliary/reporting word, but MUST NOT hand the learner a finished, ready-to-copy inflected form of the target. Naming the rule type is fine; writing out the conjugated answer is not.
- **Plain text only — no markdown.** \`instructions\`, \`prompt\`, and \`keywords\` are rendered verbatim as plain text; there is NO markdown renderer. Do NOT use any emphasis markup — no \`**bold**\`, no \`*italics*\`, no backticks. The \`keywords\` already appear to the learner as separate chips below the prompt, so do NOT re-list or bold them inside \`prompt\`; refer to them in plain prose (e.g. "Use all four words below in one sentence.").
- **Per-mode framing** (the user message selects one mode per draft):
  - \`keywords\`: put 3–4 everyday content words at or below CEFR ${cefrLevel} in \`keywords\`; the learner must use ALL of them in one sentence and the combination must force ${grammarPointName}. Every model answer must actually use every keyword.
  - \`situation\`: give a concrete one-line scenario in \`prompt\` (something said, a problem to react to) so the natural response exercises ${grammarPointName}; leave \`keywords\` empty.
  - \`grammar_target\`: name the structure in \`targetStructure\` AND give a concrete mini-scenario or seed content in \`prompt\`. The structure label alone is NOT enough to constrain the answer — this mode is the most prone to over-open prompts, so always anchor it to a situation.

`;
}

/**
 * Contextual-paraphrase-only guidance block. Mirrors
 * `renderSentenceConstructionSection`: returns "" for every other type so
 * non-paraphrase prompts stay byte-identical (preserving their Anthropic
 * cache prefix and Langfuse cohort), and for a contextual_paraphrase cell
 * returns a section ending in `\n\n` so the template's
 * `{{contextualParaphraseSection}}## Output` splices cleanly.
 */
function renderContextualParaphraseSection(
  exerciseType: ExerciseType,
  language: string,
  cefrLevel: string,
): string {
  if (exerciseType !== ExerciseType.CONTEXTUAL_PARAPHRASE) return "";
  return `## Contextual-paraphrase specifics (this exercise type)

This is a contextual_paraphrase exercise: there is NO blank. You author a natural ${language} \`sourceText\` sentence at CEFR ${cefrLevel} and ONE transformation constraint; the learner rewrites the sentence to satisfy the constraint while preserving meaning. The cloze/blank rules above do not apply; the **anti-leak**, vocabulary-band, and **Safe, neutral topics** rules DO apply, adapted as follows:

- **The meaning MUST be preservable under the constraint.** Never author a source + constraint whose only faithful rewrite is the source itself, or which forces a meaning change. A competent learner must be able to produce at least two distinct valid paraphrases.
- **Per constraint kind (the user message selects one per draft):**
  - \`avoid\`: put the banned word(s)/structure(s) in \`bannedTerms\`; they MUST occur in \`sourceText\` and MUST NOT occur in any \`referenceParaphrases\`. Choose a term that has real ${language} synonyms or a circumlocution route at CEFR ${cefrLevel} — never a function word with no paraphrase.
  - \`register\`: set \`targetRegister\`; the source must be in a clearly DIFFERENT register, and the rewrite changes register (address forms, politeness, lexis) WITHOUT changing the propositional content.
  - \`simplify\`: set \`audience\`; the rewrite conveys the same information in language appropriate for that audience.
- **\`referenceParaphrases\` (2–3) must each be fully grammatical ${language} at CEFR ${cefrLevel}, preserve the source meaning, and satisfy the constraint.** They are the learner's reveal hint and the validator's evidence that the task is solvable.
- **Plain text only — no markdown.** \`instructions\`, \`sourceText\`, and \`constraintLabel\` render verbatim; use no emphasis markup.
- **Do not spoil.** \`constraintLabel\` names the transformation; it must not hand the learner a finished paraphrase.

`;
}

/**
 * Conjugation-only guidance block. Mirrors `renderSentenceConstructionSection`:
 * returns "" for every other type so non-conjugation prompts stay byte-identical
 * (preserving their Anthropic cache prefix and Langfuse cohort), and for a
 * conjugation cell returns a section ending in `\n\n` so the template's
 * `{{conjugationSection}}## Output` splices cleanly. The values are baked in here
 * (not left as `{{vars}}`) because this whole string is itself one flat template
 * var — same pattern as `renderSentenceConstructionSection`.
 */
export function renderConjugationSection(
  exerciseType: ExerciseType,
  language: string,
  cefrLevel: string,
  grammarPointName: string,
): string {
  if (exerciseType !== ExerciseType.CONJUGATION) return "";
  return `## Conjugation/inflection specifics (this exercise type)

This is an inflection drill: there is NO sentence and NO blank. You produce one lemma + one explicit feature bundle, and the single correct inflected form the learner must type. The cloze/sentence rules above do not apply. Follow these:

- **The inflectional category is FIXED by the grammar point (${grammarPointName})** — tense/mood for verbs, case/number/possessive for nominals. Do not drift to a different category. Vary only the features the cell names (person/number/case, and polarity where the point covers it). The combination you pick determines \`targetForm\`.
- **\`targetForm\` MUST be the exactly-correct ${language} form at CEFR ${cefrLevel}**, including every diacritic. Grading is an exact string match — a wrong accent or a vowel-harmony slip is a wrong stored answer and will mis-grade every learner. Double-check irregular stems and consonant softening.
- **Enumerate genuine variants in \`acceptableForms\`** (e.g. accepted orthographic variants). Do NOT list near-misses or common-error forms — those must stay wrong.
- **\`breakdown\` teaches the morphology**: stem + ending for ${language} fusional forms, or stem + ordered suffix gloss for agglutinative forms (e.g. Turkish: root + (plural) + (possessive) + case/person, noting vowel harmony). Keep it to ONE clean line of the SETTLED decomposition. Like \`instructions\`, it is shown verbatim to the learner, so it MUST NOT contain your own reasoning, deliberation, self-correction, or verification — no "wait…", "no —", "actually", "hmm", rhetorical questions, or check/cross marks (✓/✗). Decide the form first, then write only the final morpheme breakdown; never narrate how you got there.
- **\`featureBundle\` names the cell** in ${language}'s conventional grammar notation, using grammatical-feature terms ONLY (person/case/number/tense). It MUST NOT contain \`targetForm\`, nor any inflected form of the lemma, nor a worked example in parentheses — e.g. for target "çantama" write "iyelik · 1. tekil · yönelme hâli", never "… (benim çantama)". Naming the answer-word anywhere in the bundle spoils the exercise.
- **\`features\` decomposes the cell for display.** List the inflectional dimensions OTHER than the subject cue — for verbs the tense/mood (and polarity where ${language} marks it); for nominals the case and/or number — in order. Each entry pairs the ${language} term in conventional notation (\`term\`) with a 1–2 word English gloss (\`gloss\`), e.g. {term: "geçmiş zaman", gloss: "past"} or {term: "bulunma", gloss: "locative"}. Do NOT put the subject cue in \`features\`.
- **\`subject\` is the person cue — only when the form agrees with a person.** For verbs and the copula, give the representative ${language} subject pronoun (\`pronoun\`, e.g. "o", "ich") and its English \`gloss\` ("he / she / it"). For possessives, the possessor is the person cue (\`arabam\` → {pronoun: "benim", gloss: "my"}). **OMIT \`subject\` entirely for pure case/number forms that have no person** (\`ev → evde\`). It is shown prominently when present.
- **\`features\` + \`subject\` describe the SAME cell as \`featureBundle\`** — they are its structured, glossed form, not extra constraints. They MUST NOT contain the answer.
- **Use the lemma you are given in the user prompt — do NOT choose your own.** When a word is provided, inflect exactly that word.
- **\`instructions\` must contain ONLY the directive the learner reads** — one clean sentence telling them which form to produce. Never include your own reasoning, alternative phrasings, abandoned attempts, or meta-text (no "Actually…", "Wait…", "let's keep it simple", or arrows). Any carrier/context sentence must use the target lemma.
- **\`exampleSentences\` (1–2)** must use \`targetForm\` verbatim, be natural, and sit at or below CEFR ${cefrLevel}.

`;
}

/**
 * Phase-2 Langfuse-registered template. Identical to the body
 * `buildGenerationSystemPrompt` returns, with every interpolation replaced
 * by a `{{flatVar}}` placeholder consumable by both `applyTemplate`
 * (in-code fallback) and Langfuse's Mustache.js `compile(vars)` (live
 * fetch). The `generation-prompts.test.ts` snapshot block asserts byte
 * parity for `applyTemplate(TEMPLATE, computeGenerationPromptVars(...))`
 * against the current sync builder output so any drift between the two
 * is caught at PR time.
 *
 * Placeholder set is **flat strings only** (no nested paths) so the two
 * substituters produce identical bytes — required for Anthropic
 * prompt-cache parity.
 */
export const GENERATION_SYSTEM_PROMPT_TEMPLATE = `You are an expert language exercise author for {{language}} learners at CEFR {{cefrLevel}}. Your job is to produce one exercise of type {{exerciseType}} that targets exactly one grammar point: {{grammarPointName}}.

## Grammar point context

{{grammarPointDescription}}

## Positive examples

{{positiveExamplesBullets}}

## Negative examples (incorrect production — for awareness only, do not include in the exercise)

{{negativeExamplesBullets}}

## Common learner errors

{{commonErrorsBullets}}

## CEFR level descriptors

{{cefrDescriptors}}

{{levelScopeSection}}{{priorPoolSection}}## Hard constraints

- **The learner must produce the answer themselves.** Two failure modes are forbidden:
  - **Ambiguous blank.** For a cloze, the answer must be uniquely produced. Either (a) the surrounding sentence constrains the blank so only one specific lexeme/form plausibly fits — every other candidate is ruled out by something explicit in the sentence — OR (b) for grammar-shape clozes where many lexemes satisfy the rule, you populate \`acceptableAnswers\` with every lexeme that fits. Sentences like "Sınıfta sekiz ___ var" ("There are eight ___ in the classroom") are forbidden without \`acceptableAnswers\`, because chair, student, book, pencil, and many other nouns all satisfy the rule equally. Likewise "Evde yeni ___ var. Onlar çok güzel." is forbidden with \`correctAnswer: "perdeler"\` alone — curtains, books, lamps, flowers all satisfy "plural, positive descriptor" equally; the "Onlar çok güzel" follow-on signals plurality but not which lexeme. Either constrain the sentence ("Evde yeni ___ var. Onları yıkamayı unutma." — "don't forget to wash them" picks out "perdeler") or list every plausible lexeme in \`acceptableAnswers\`. For translation, the reference translation must be the dominant rendering — minor variants are accepted at evaluation time, but the source text must not admit two structurally different correct translations. For vocab_recall, the prompt/definition must pick out exactly one headword.
  - **Spoiled blank.** The \`instructions\` and \`context\` fields may name the grammar category being tested (e.g. "vowel harmony", "noun-numeral agreement") but MUST NOT state the rule's outcome, name the required suffix/form, or otherwise let the learner produce the answer without engaging with the blank. "Vowel harmony: front vowel (e) requires -ler suffix" above "Odada pencere___ açık" is forbidden — it tells the learner the answer is "-ler". "Plural agreement after a numeral" above "Sınıfta sekiz ___ var" is acceptable — it names the rule type without giving the form.
- **Blank granularity — the \`___\` blank is the WHOLE inflected word.** In every language, the \`___\` in \`sentence\` stands for the entire inflected surface form, and \`correctAnswer\` is that complete word — never a bare suffix/inflection fragment (\`yi\`, \`en\`, \`t\`) and never a stem with the blank attached (\`kahve___\`, \`vol___\`). When the stem mutates at its boundary under the target inflection, the displayed text MUST NOT reveal the mutated stem; the learner produces the whole mutated form as the answer:
  - **TR** consonant softening / buffer consonants: \`kahve\` → \`kahveyi\`, \`kitap\` → \`kitabı\`, \`köpek\` → \`köpeğe\`. Blank the whole word — "Annem her sabah ___ içiyor. (kahve)" → \`kahveyi\` — never "Annem her sabah kahve___ içiyor." → \`yi\`.
  - **ES** stem-changing / irregular / orthographic shifts: \`volver\` → \`vuelven\`, \`tener\` → \`tengo\`, \`buscar\` → \`busqué\`. Never "vol___" → \`vemos\`: a shown stem both spoils the word and is wrong for stressed/irregular forms.
  - **DE** ablaut / umlaut: \`fahren\` → \`fährt\`, \`geben\` → \`gibt\`, \`Apfel\` → \`Äpfel\`. Blank the whole word, not "f___" → \`ährt\`.
  A partial (suffix-only) blank either shows the citation stem — making the correct fill wrong — or shows the mutated stem — revealing the irregularity. Mixing partial blanks for regular words with whole-word blanks for irregular ones itself leaks which words are irregular, so the whole-word rule is uniform across regulars and irregulars. This supersedes the earlier Turkish suffix-only / stem-embedded-buffer convention (e.g. "Ben çok mutlu___" → \`um\`), which is no longer used for newly generated cloze.
- **Turkish case clozes — generic instruction, context-forced case, optional L1 gloss.** For a TR cloze whose grammar point is a **case** (accusative, dative, locative, ablative, genitive), the \`instructions\` MUST be generic — "Fill in the blank with the correct form of the word in parentheses" — and MUST NOT name the case or the suffix; the noun's citation (dictionary) form MUST appear in parentheses next to the sentence (e.g. "Her sabah ___ gidiyorum. (okul)" → \`okula\`). The surrounding sentence MUST constrain exactly **one** case as correct so that dropping the case name from the instruction does not make the blank \`ambiguous\`: motion-toward forces dative ("...___ gidiyorum" → \`okula\`), motion-from forces ablative ("...___ geldim" → \`okuldan\`), static location forces locative, and so on. Because **accusative** marks *definiteness* — hard to force in a short L2-only sentence, since "kahve içiyor" (generic) and "kahveyi içiyor" (definite) are both grammatical — an accusative cloze MUST carry a disambiguation device. **PREFER forcing definiteness structurally inside the L2 sentence** — via prior mention of the noun, a uniquely-identifiable referent, or a possessive — so the definite reading is the only natural one (e.g. "Denizde büyük bir dalga vardı. Çocuklar ___ gördü. (dalga)" → \`dalgayı\`: the noun is introduced in the first sentence, so prior mention forces the accusative). The forcing device MUST live in the \`sentence\`/context, NEVER in \`instructions\` (the anti-spoil rule stays in force), and any words it adds MUST obey the vocabulary-band rule above (introduce no above-level vocabulary to force definiteness). ONLY as a **fallback**, when in-sentence forcing is impractical, use an English gloss in the optional \`glossEn\` field (e.g. "Annem ___ içiyor. (kahve)" with \`glossEn: "My mother is drinking the coffee"\` → \`kahveyi\`). Populate \`glossEn\` for CEFR **A1–A2 only**; omit it for **B1+** (this cell is CEFR {{cefrLevel}}), where richer L2 context is expected to disambiguate. The gloss MUST obey the **Spoiled blank** rule above — it conveys meaning/case **without** stating the rule outcome or the required form: "I drink the coffee" is allowed; "use the accusative -yi" is forbidden.
- **Turkish personal/copular-suffix clozes — lemma hint, person-driven form.** For a TR cloze whose grammar point is the personal (copular) suffix, the parenthetical hint MUST be the predicate's citation (dictionary) form, NEVER the inflected answer — e.g. \`(tamirci)\` with answer \`tamirciyim\`, never \`(tamirciyim)\` (which spoils the blank). The answer is the WHOLE inflected predicate, and the person drives the form: 1st/2nd person take an obligatory overt suffix (-(y)Im / -sIn / -(y)Iz / -sInIz); **3sg takes Ø** — the bare citation form IS the correct answer (e.g. "O bir ___ . (doktor)" → \`doktor\`), so do NOT append -DIr (the conversational -DIr default is a flagged learner error); **3pl -lAr is optional and HUMAN-only**. To keep exactly one correct answer, prefer a subject that forces a single form — a non-human / animal plural subject takes the bare predicate, no -lAr (e.g. "Kediler ___ . (küçük)" → \`küçük\`). Only a human plural subject that genuinely allows both forms may ship, and then \`acceptableAnswers\` MUST list every natural form (e.g. "Öğrenciler ___ . (çalışkan)" → \`çalışkan\` and \`çalışkanlar\`). The blanked predicate MUST sit in sentence-final PREDICATE position — not as an attributive modifier before another noun — and be a concrete, high-frequency A1 noun or adjective.
- **Turkish possessive-suffix clozes — overt possessor pronoun, citation-form hint.** For a TR cloze whose grammar point is the possessive (İyelik) suffix, an overt genitive possessor pronoun (\`benim\` / \`senin\` / \`onun\` / \`bizim\` / \`sizin\` / \`onların\`) MUST appear in the \`sentence\` to fix the person — without it a sentence-initial or bare possessed noun admits every person (\`evim\` / \`evin\` / \`evi\`…) and the blank is \`ambiguous\`. The parenthetical hint MUST be the possessed noun's citation (dictionary) form, NEVER the inflected answer — \`(el)\` with answer \`elim\`, never \`(elim)\` (which spoils the blank). \`instructions\` stay generic ("Fill in the blank with the correct possessive form of the word in parentheses"), and the possessed noun MUST be a concrete, high-frequency A1 noun in a SINGLE simple clause — do NOT stack genitive + locative + progressive scaffolding around it (forbidden: "Biz şehrin merkezinde oturuyoruz. ___ çok büyük. (ev)"; prefer "Bu benim ___ . (el)" → \`elim\` or "Senin ___ nerede? (araba)" → \`araban\`). The answer is the WHOLE inflected noun, with vowel harmony applied and the 3sg -s- buffer / dropped 1-2p buffer vowel after vowel-final stems (\`araba\` → \`arabam\`, \`araba\` → \`arabası\`). Across a batch, ROTATE the possessor person (cover 1sg / 2sg / 3sg / 1pl, and 2pl / 3pl where natural) and vary the predicate and scene — do NOT reuse a single frame (e.g. not five \`Bizim ___ çok büyük\`). PREFER vowel-final stems (\`araba\`, \`kapı\`, \`oda\`, \`kedi\`, \`çanta\`) for a good share of the batch: they alone exercise the cell's diagnostic forms — the 3sg \`-s-\` buffer (\`arabası\`) and the dropped 1-2p buffer vowel (\`araba\` → \`arabam\`); a batch built only on consonant-final stems (\`ev\` → \`evim\` / \`evi\`) never tests them.
- **Turkish indefinite-noun-compound clozes — bare-head hint, nominative answer, no case-stacking.** For a TR cloze whose grammar point is the indefinite noun compound (belirtisiz isim tamlaması: bare modifier + head taking 3sg \`-(s)I\`, e.g. \`otobüs bileti\`, \`şehir merkezi\`), the modifier noun MUST already appear in the \`sentence\` and **ONLY the head noun is blanked**; the parenthetical hint MUST be the head noun's citation (dictionary) form, NEVER the full compound or the inflected answer — \`(oda)\` with answer \`odası\`, never \`(otel odası)\` (a copying task) nor \`(odası)\` (spoils the blank). The answer is the head + \`-(s)I\` in the **nominative** — do NOT stack case onto it (forbidden: \`merkezini\`, \`tarifini\`, \`sözleşmesini\`): case-stacking conflates this point with tr-a2-possessive-case-stacking and buries the \`-(s)I\` marker inside the case form. Do NOT blank the whole two-word compound, and do NOT omit the parenthetical head — a bare "...bir ___ var" with no head given admits many compounds (\`adres bilgisi\` / \`telefon numarası\` / \`posta kodu\`) and is \`ambiguous\`. **No article hugging the compound:** do NOT place \`bir\` (nor \`yeni bir\` / \`taze bir\` / \`düz bir\`) immediately before the modifier noun or the blank — \`bir şeker ___\`, \`yeni bir uygulama ___\`, \`taze bir ekmek ___\`, and a bare \`bir ___\` all read as "a [modifier]" + a stray head and misparse the compound. The modifier sits BARE directly before the blanked head, exactly like the clean frames \`kurabiye ___ (tarif)\` → \`tarifi\`, \`masa ___ (örtü)\` → \`örtüsü\`, \`sinema ___ (bilet)\` → \`bileti\`. **One-word answer:** the answer is exactly ONE word — the head + \`-(s)I\`; a two-word answer (\`basın toplantısı\`, \`destek programı\`) means you blanked the whole compound and is malformed. **Modifier is a literal word in the \`sentence\`:** never leave the modifier only in the parenthetical hint — \`Bu telefona bir ___ lazım. (destek)\` has no modifier in the sentence and is malformed. Keep both nouns concrete, picturable, and high-frequency at or below the cell level — home / kitchen / street / school objects; avoid abstract, administrative, medical, or media register (\`yetki\`, \`belge\`, \`sözleşme\`, \`başvuru\`, \`basın\`, \`mide ilacı\`, \`hava tahmini\`). If MC \`options\` are supplied they MUST pin a single correct compound (no two options both valid).
- **Turkish gemination / stem-change translations — force the vowel suffix, enumerate synonyms.** For a TR translation whose grammar point is consonant-doubling (gemination: \`hak\`→\`hakkım\`, \`sır\`→\`sırrım\`, \`hat\`→\`hattı\`) or a stem change, the alternation only surfaces when a **vowel-initial** suffix attaches, so the English source MUST force the target noun into a vowel-suffixed form — a possessive ("my/your/our right" → \`hakkım\`) or a definite object (accusative → \`hattı\`) — and MUST NOT use a frame the learner can render suffixless ("This is a secret" → \`Bu bir sır\` bypasses the rule entirely). Keep the source a **single short clause** at the cell level — do NOT reach for reported speech, verbal-noun + genitive stacks, or low-frequency lexemes just to force the form (that drives \`level-mismatch\`). Because a synonym or number variant often dodges the alternation (\`ağrı kesici\` for \`ağrı ilacı\`, \`haklarımı\` for \`hakkımı\`, \`karşıtı\` for \`zıddı\`), either the source must rule them out or \`acceptableAnswers\` MUST list every plausible rendering.
- **Do not leak the answer in the visible text (anti-leak).** Apart from the parenthetical citation hint — which is the word to *inflect*, not the answer form — nothing in the visible \`sentence\`, \`context\`, \`glossEn\`, or \`instructions\` may let the learner write the blank without engaging the grammar point. Concretely forbidden: the target's inflected form (or the bare lexeme, when the task is lexical) appearing elsewhere in the sentence; an L1 gloss or near-synonym that names the exact target word; a cue phrase that makes the fill mechanical. Negative example — "Bu ___ çok eski. Bu kitabı dün aldım. (kitap)" leaks "kitabı" in the next clause, and a \`glossEn\` like "I drink the coffee (kahveyi)" that spells out the inflected form is forbidden. This is the generator-side guard for the validator's \`contextSpoilsAnswer\` veto, which remains in force.
- **Stay on target.** The blank MUST require the cell's declared grammar point ({{grammarPointName}}) to solve — not merely a related or incidentally-present construction. A fill that happens to obey the rule while actually testing a different grammar-point key is off-target: e.g. in a \`tr-a1-vowel-harmony\` cell, a blank whose answer is the locative \`-DA\` ("evde") tests locative *selection* — its own grammar point — and only incidentally obeys vowel harmony, so it does not drill harmony. Choose a blank that cannot be solved without applying {{grammarPointName}}. This is the generator-side guard for the validator's \`grammarPointMatch=false\` flag.
- **One correct fill, or enumerate them.** Before finalizing, verify that exactly one form fills the blank — or that \`acceptableAnswers\` lists every form that does. If a competent learner could defend a second word/form as correct given only the visible context, the draft is ambiguous: either tighten the sentence so only one fits, or enumerate all of them in \`acceptableAnswers\`. Do not ship a lone \`correctAnswer\` when the context admits synonyms or alternative inflections. In particular, a translation whose source admits more than one natural rendering, and an alternant-bearing cloze where two near-synonymous forms both fit (e.g. \`koşa koşa\`/\`koşarak\`, \`gezmek\`/\`gezme\`), MUST enumerate every valid form in \`acceptableAnswers\` rather than ship a lone \`correctAnswer\`. This reinforces the **Ambiguous blank** rule above and reduces the validator's \`ambiguous\` flag.
- Vocabulary band: every content word MUST be high-frequency everyday vocabulary at or below CEFR {{cefrLevel}}. The target grammatical form/construction is the ONLY element that may be challenging; the target construction itself is exempt from this band. Do NOT introduce non-target words or structures above {{cefrLevel}} (including above-level subordination that is not the grammar point under test) — an item must test the grammar point, never incidental vocabulary.
- **Safe, neutral topics.** Avoid weapons/explosives (e.g. \`bomba\`), alcohol and other substances, violence, and culturally-sensitive or stereotyping topics. Prefer neutral everyday contexts: home, food, daily routine, travel, weather, study/work.
- **vocab_recall hints MUST NOT reveal the target word (anti-leak).** For a vocab_recall exercise, every \`hints\` entry must describe meaning, usage, register, or a topical association — NEVER its orthographic shape. Forbidden: the starting or ending letter ("Starts with 'd'"), the letter count or syllable breakdown ("2 syllables: dük-kan"), any partial spelling or fill-in-the-blank skeleton ("kah___tı", "d u r a _"), a near-rhyme that spells it out, or the word appearing (in any inflected form) inside \`exampleSentence\`. A learner must recall the word from its meaning, not reconstruct it letter-by-letter — hints that narrow it to a single spelling are the generator-side cause of the validator's \`contextSpoilsAnswer\` veto. Good hint: "the meal eaten first thing in the morning"; bad hint: "k-a-h-v-a-l-t-ı". Also: \`exampleSentence\` should use the word naturally but MUST blank or omit it if showing it would give the prompt's answer away.
- **Cell-level coverage for \`tr-a1-vowel-harmony\`.** This cell drills BOTH 2-way (low-vowel e/a) AND 4-way (high-vowel i/ı/u/ü) harmony. Drafts that only test the plural suffix -lAr/-lEr cover one half of the grammar point and are forbidden in the cell-wide majority. Across a batch for this cell: (a) at least three of the four high-vowel slots (i, ı, u, ü) MUST be exercised by non-plural suffixes (accusative -(y)I, locative -DA on a high-vowel stem, possessive -(s)I, dative -(y)A on a high-vowel stem, past -DI); (b) both low-vowel slots (e and a) MUST appear at least once; (c) the plural suffix -lAr/-lEr MUST NOT be the blanked element in more than 50% of the batch. This constraint applies only to cells targeting \`tr-a1-vowel-harmony\` — other cells are unconstrained on this axis.
- Do not produce an exercise that resembles any of these existing stems:
{{recentStemsBlock}}
- One exercise per tool call. Do not batch multiple inside one tool call.
- You MUST use the provided tool. Do not return plain text.

{{sentenceConstructionSection}}{{contextualParaphraseSection}}{{conjugationSection}}## Output

Use the {{toolName}} tool with all required fields populated.`;

/**
 * Flat-string var map consumed by both the in-code fallback substituter
 * and Langfuse's `compile(vars)`. Mirrors the shape required by
 * `GENERATION_SYSTEM_PROMPT_TEMPLATE`. Pulled out of the builder so the
 * Task-9 snapshot parity test can exercise the same computation the
 * builder does (and Task 10's async refactor will route both through it).
 */
export function computeGenerationPromptVars(
  inputs: GenerationPromptInputs,
  recentStems: readonly string[],
): Record<string, string> {
  if (inputs.exerciseType === ExerciseType.DICTATION) {
    throw new Error(
      "Dictation exercises are not batch-generated; computeGenerationPromptVars received a dictation cell.",
    );
  }
  const {
    language,
    cefrLevel,
    exerciseType,
    grammarPoint,
    priorPoolSurfaces,
    levelScopePoints,
  } = inputs;
  return {
    language,
    cefrLevel,
    exerciseType,
    grammarPointName: grammarPoint.name,
    grammarPointDescription: grammarPoint.description,
    positiveExamplesBullets: renderBulletList(grammarPoint.examplesPositive),
    negativeExamplesBullets: renderBulletList(grammarPoint.examplesNegative),
    commonErrorsBullets: renderBulletList(grammarPoint.commonErrors),
    cefrDescriptors: CEFR_DESCRIPTOR_BULLETS,
    levelScopeSection: renderLevelScopeSection(
      exerciseType,
      language,
      cefrLevel,
      levelScopePoints,
    ),
    priorPoolSection: renderPriorPoolSection(exerciseType, priorPoolSurfaces),
    sentenceConstructionSection: renderSentenceConstructionSection(
      exerciseType,
      language,
      cefrLevel,
      grammarPoint.name,
    ),
    contextualParaphraseSection: renderContextualParaphraseSection(
      exerciseType,
      language,
      cefrLevel,
    ),
    conjugationSection: renderConjugationSection(
      exerciseType,
      language,
      cefrLevel,
      grammarPoint.name,
    ),
    recentStemsBlock: renderRecentStems(recentStems),
    toolName: TOOL_NAME_BY_TYPE[exerciseType as keyof typeof TOOL_NAME_BY_TYPE],
  };
}

/**
 * Builds the generation system prompt, fetching the live body from
 * Langfuse (label `production`) and falling back to
 * `GENERATION_SYSTEM_PROMPT_TEMPLATE` on outage / unset keys / compile
 * mismatch. Byte parity between the two paths is pinned by the
 * `GENERATION_SYSTEM_PROMPT_TEMPLATE byte parity` test block.
 *
 * Async because the Langfuse fetch is async (cached in-process for 5 min
 * so warm Lambdas pay zero per-request cost). The single caller
 * (`generateBatch` in `generate.ts`) is already `async`.
 */
export async function buildGenerationSystemPrompt(
  inputs: GenerationPromptInputs,
  recentStems: readonly string[],
): Promise<string> {
  const vars = computeGenerationPromptVars(inputs, recentStems);
  const { text } = await getPromptWithVarsOrFallback(
    "generate-system-prompt",
    GENERATION_SYSTEM_PROMPT_TEMPLATE,
    GENERATION_PROMPT_VERSION,
    vars,
  );
  return text;
}

// ---------------------------------------------------------------------------
// Grammatical-person rotation (R: person coverage, 2026-06-12)
// ---------------------------------------------------------------------------
// A 2026-06-12 pool audit found every TR tense cell ≥90% third-person
// singular (negation/aorist/mış: 100%), so the "plus personal endings" half
// of those grammar points was never tested — 3sg is the unmarked, suffix-light
// form the model defaults to. For grammar points whose `coverageSpec` controls
// the `person` axis, the scheduler supplies an explicit per-draft `person`
// target (via `coverageTargets`) and each draft's USER prompt pins it, so a
// batch covers the paradigm. User-prompt-only by design: the cached system
// prompt stays byte-identical across the batch (same rationale as `seedWord`, R5.4).

/**
 * Per-language person rotation lists. The label is injected verbatim into the
 * user prompt; the parenthesised pronouns anchor the model to the right cell
 * of the paradigm.
 *
 * ES deliberately omits `vosotros`: the pool targets pan-American Spanish
 * (2pl is rendered by `ustedes`, morphologically identical to 3pl). Add a
 * sixth entry here if a peninsular-Spanish track ever ships.
 */
export const PERSON_ROTATION_BY_LANGUAGE: Record<
  Exclude<Language, Language.EN>,
  readonly string[]
> = {
  [Language.TR]: [
    "1sg (ben)",
    "2sg (sen)",
    "3sg (o)",
    "1pl (biz)",
    "2pl (siz)",
    "3pl (onlar)",
  ],
  [Language.ES]: [
    "1sg (yo)",
    "2sg (tú)",
    "3sg (él/ella/usted)",
    "1pl (nosotros/nosotras)",
    "3pl (ellos/ellas/ustedes)",
  ],
  [Language.DE]: [
    "1sg (ich)",
    "2sg (du)",
    "3sg (er/sie/es)",
    "1pl (wir)",
    "2pl (ihr)",
    "3pl (sie/Sie)",
  ],
};

/** Canonical `PersonCode` list for a language, derived from the rotation labels
 *  (the leading token of each entry). ES yields 5 codes (no `2pl`); TR/DE 6. */
export function personCodesForLanguage(
  language: Exclude<Language, Language.EN>,
): PersonCode[] {
  return PERSON_ROTATION_BY_LANGUAGE[language].map((label) => {
    const code = label.split(" ")[0];
    if (!(PERSON_CODES as readonly string[]).includes(code)) {
      throw new Error(
        `personCodesForLanguage: rotation label "${label}" for ${language} has no valid leading PersonCode`,
      );
    }
    return code as PersonCode;
  });
}

/** Maps a `PersonCode` back to the language's display label for the prompt
 *  directive (e.g. `"2pl"` → `"2pl (siz)"`). Falls back to the bare code if the
 *  language has no such person (defensive; the controller never emits one). */
export function personDisplayForCode(
  language: Exclude<Language, Language.EN>,
  code: PersonCode,
): string {
  const match = PERSON_ROTATION_BY_LANGUAGE[language].find(
    (label) => label.split(" ")[0] === code,
  );
  return match ?? code;
}

/** Non-person directive templates. Person is handled separately (it needs the
 *  per-language display label + the grammar-point escape hatch). */
const COVERAGE_DIRECTIVE_BY_AXIS: Record<
  Exclude<CoverageAxis, "person">,
  (value: string) => string
> = {
  number: (v) =>
    `The target word form MUST be ${v} (grammatical number).`,
  case: (v) =>
    `The target word form MUST carry the ${v} case.`,
  polarity: (v) =>
    `The target sentence MUST be ${v} (${v === "negative" ? "negated" : "a positive statement"}).`,
  wordClass: (v) => `The target word the learner must produce MUST be a ${v}.`,
  sentenceType: (v) => `The target sentence MUST be ${v} in clause type.`,
};

/**
 * Render the per-draft coverage directive block (Pool Coverage Controller,
 * Phase 2). One sentence per axis present in `coverageTargets[ordinal]`. Returns
 * "" when there is no target for the ordinal — there is no blind fallback; the
 * scheduler always supplies targets for a spec'd cell. The block lives in the
 * UNCACHED per-draft user prompt, so the cached system prefix is unchanged.
 */
function renderCoverageBlock(
  inputs: GenerationPromptInputs,
  ordinal: number,
  coverageTargets?: readonly CoverageTarget[],
): string {
  const target = coverageTargets?.[ordinal];
  if (!target) return "";
  const parts: string[] = [];
  if (target.person) {
    const person = personDisplayForCode(inputs.language, target.person as PersonCode);
    parts.push(
      `Target grammatical person for this draft: ${person}. ` +
        `The form the learner must produce MUST be marked for this person, and the visible sentence/context MUST make the person unambiguously recoverable (overt subject pronoun, possessor, vocative, or unambiguous context) WITHOUT revealing the conjugated form itself. ` +
        `If ${inputs.grammarPoint.name} cannot naturally express this person, use the closest natural person instead.`,
    );
  }
  for (const axis of ["number", "case", "polarity", "wordClass", "sentenceType"] as const) {
    const v = target[axis];
    if (v) parts.push(COVERAGE_DIRECTIVE_BY_AXIS[axis](v));
  }
  return parts.length > 0 ? parts.join(" ") + "\n\n" : "";
}

// ---------------------------------------------------------------------------
// Sentence-construction mode rotation
// ---------------------------------------------------------------------------

const SENTENCE_CONSTRUCTION_MODES = [
  "keywords",
  "situation",
  "grammar_target",
] as const;

/** Deterministic mode rotation so a batch covers all three framings. */
export function sentenceConstructionModeForOrdinal(
  ordinal: number,
): (typeof SENTENCE_CONSTRUCTION_MODES)[number] {
  return SENTENCE_CONSTRUCTION_MODES[ordinal % SENTENCE_CONSTRUCTION_MODES.length];
}

// ---------------------------------------------------------------------------
// Contextual-paraphrase constraint-kind rotation
// ---------------------------------------------------------------------------

const CONTEXTUAL_PARAPHRASE_CONSTRAINTS = ["avoid", "register", "simplify"] as const;

/** Deterministic constraint-kind rotation so a batch covers all three kinds. */
export function contextualParaphraseConstraintForOrdinal(
  ordinal: number,
): (typeof CONTEXTUAL_PARAPHRASE_CONSTRAINTS)[number] {
  return CONTEXTUAL_PARAPHRASE_CONSTRAINTS[
    ordinal % CONTEXTUAL_PARAPHRASE_CONSTRAINTS.length
  ];
}

// ---------------------------------------------------------------------------
// User prompt — short per-draft message; the system prompt is the heavy lift.
// ---------------------------------------------------------------------------

export function buildGenerationUserPrompt(
  inputs: GenerationPromptInputs,
  ordinal: number,
  topicDomain: string | null,
  // R5.4: the frequency seed is injected HERE (per-draft user prompt), never in
  // the cached system prompt, so the Anthropic cache prefix stays byte-identical
  // across the batch. `null`/absent → unseeded (byte-identical to the prior
  // output, preserving back-compat for existing callers).
  seedWord: string | null = null,
  // Phase 2 coverage controller: explicit per-ordinal axis targets
  // (`coverageTargets[ordinal]`) from the scheduler. `undefined` → no coverage
  // directive (CLI/admin and non-spec cells). Length matches `count` when set.
  coverageTargets: readonly CoverageTarget[] | undefined = undefined,
): string {
  if (inputs.exerciseType === ExerciseType.DICTATION) {
    throw new Error(
      "Dictation exercises are not batch-generated; buildGenerationUserPrompt received a dictation cell.",
    );
  }
  const toolName = TOOL_NAME_BY_TYPE[inputs.exerciseType as keyof typeof TOOL_NAME_BY_TYPE];
  const domain = topicDomain ?? "mixed";
  // R5.5: branch on exercise type — conjugation uses a STRICT directive (no
  // substitution escape hatch) because the verb picker already guarantees a
  // conjugatable verb and substitution re-opens the dedup-collapse we fixed.
  // All other types keep the LOOSE constraint: anchor on the seed but allow a
  // similar-frequency substitute when it doesn't fit the grammar point.
  // Self-revealing target (numbers/ordinals): the ONLY sanctioned elicitation
  // is a digit/numeral cue — the written form is what the learner produces.
  // Lives in the per-draft user prompt (uncached; system prompt stays
  // byte-identical). When seeded, the target value is pinned (strict, like
  // conjugation); when unseeded (CLI/eval paths pass no seedWords) the
  // directive still applies, just without a pinned value.
  const digitForm =
    inputs.grammarPoint.selfRevealingElicitation === "digit-form" &&
    (inputs.exerciseType === ExerciseType.CLOZE ||
      inputs.exerciseType === ExerciseType.TRANSLATION);
  const digitFormBlock = digitForm
    ? inputs.exerciseType === ExerciseType.TRANSLATION
      ? `${
          seedWord && seedWord.length > 0
            ? `The target form is "${seedWord}" — the reference translation must contain exactly this form (with correct agreement); do not substitute another value. `
            : ""
        }Write the number/order as DIGITS in the source text (e.g. "the 3rd floor", "200 chairs", "in 1923") — never spelled out in the source language — so the learner must produce the written target-language form themselves. Vary the noun and scenario; do not reuse a noun or template from earlier exercises in this batch.\n\n`
      : `${
          seedWord && seedWord.length > 0
            ? `The target form is "${seedWord}" — use exactly this value; do not substitute another. `
            : ""
        }Present the quantity/order ONLY as digits or numerals in the visible text (e.g. "3.º", "3.", "200", "123"), typically as the parenthetical hint — NEVER as the written word. The learner produces the written form (with correct agreement/gender/harmony) from the digit cue; the digit cue is the sanctioned elicitation for this cell, not an answer leak. Vary the noun and scenario; do not reuse a noun or template from earlier exercises in this batch.\n\n`
    : "";
  // Self-revealing derived-form target (appreciative suffixes): the ONLY
  // sanctioned elicitation is a parenthetical BASE-word cue — the learner
  // chooses and forms the suffix from the context's nuance. Same placement
  // and pinning rules as the digit-form block above.
  const baseWordCue =
    inputs.grammarPoint.selfRevealingElicitation === "base-word-cue" &&
    (inputs.exerciseType === ExerciseType.CLOZE ||
      inputs.exerciseType === ExerciseType.TRANSLATION);
  const baseWordCueBlock = baseWordCue
    ? inputs.exerciseType === ExerciseType.TRANSLATION
      ? `${
          seedWord && seedWord.length > 0
            ? `The target form is "${seedWord}" — the reference translation must contain exactly this derived form; do not substitute another. `
            : ""
        }Write a source sentence whose meaning naturally elicits the derived form — express the nuance explicitly in the source (e.g. "a nice little chair", "a huge success", "a shabby run-down hotel") so the suffix choice is forced. The derived form must never appear in the source text. Vary the scenario; do not reuse a noun or template from earlier exercises in this batch.\n\n`
      : `${
          seedWord && seedWord.length > 0
            ? `The target form is "${seedWord}" — the answer must be exactly this form; do not substitute another. `
            : ""
        }Cue the learner with the BASE word in parentheses after the sentence — e.g. "(silla)" when the answer is "sillita" — NEVER the derived form itself, and the derived form must not appear anywhere in the visible text. The base-word cue is the sanctioned elicitation for this cell, not an answer leak: the tested skill is choosing the suffix from the context's nuance and forming it with the correct allomorph and gender. Craft the context so the intended nuance (smallness/affection, augmentative force, or pejorative shabbiness) is unmistakable and no other established suffixed form of the same base fits. Vary the scenario; do not reuse a noun or template from earlier exercises in this batch.\n\n`
    : "";
  const seedBlock =
    !digitForm && !baseWordCue && seedWord && seedWord.length > 0
      ? inputs.exerciseType === ExerciseType.CONJUGATION
        ? // Strict: the seed IS the word to inflect. No substitution escape hatch —
          // the picker already guarantees an inflectable word, and substitution
          // would re-open the dedup-collapse we are fixing. Nominal-inflection
          // points (conjugationSeedKind: 'noun') decline a NOUN, not a verb, so the
          // directive names the right word class to avoid confusing the author.
          inputs.grammarPoint.conjugationSeedKind === "noun"
          ? `The noun to inflect is "${seedWord}". Use exactly this noun — do not substitute another.\n\n`
          : // Copular personal-suffix point: the seed is a PREDICATE (profession /
            // role / nationality / adjective), and the drill makes a "subject IS
            // <predicate>" sentence. Name the word class so the author treats it as
            // a predicate nominal rather than an object noun to decline.
            inputs.grammarPoint.conjugationSeedKind === "predicate-nominal"
            ? `The predicate is "${seedWord}" (a profession, role, nationality, or adjective). The drill states that the subject IS "${seedWord}": inflect "${seedWord}" with the correct personal/copular suffix for the target person (e.g. "${seedWord}" → 1sg "…${seedWord}+(y)Im"). Use exactly this word — do not substitute another.\n\n`
            : `The verb to conjugate is "${seedWord}". Use exactly this verb — do not substitute another.\n\n`
        : inputs.exerciseType === ExerciseType.CONTEXTUAL_PARAPHRASE
          ? // Strict: the seed is a SCENARIO drawn from the curated `paraphrase.seeds`
            // pool — the identity-diversity axis for this cell. Frame it as a scenario
            // (NOT a "word") with no substitution escape hatch, so each ordinal's
            // distinct scenario yields a distinct source sentence. The generic loose
            // seed block's "word" wording and "similar frequency" substitution are
            // nonsensical for a scenario phrase and would let the model discard the
            // seed, collapsing the very diversity axis this seed enforces.
            `Set this exercise in the following scenario: "${seedWord}". The source sentence you author must fit this scenario naturally. Use exactly this scenario — do not substitute another.\n\n`
          : inputs.exerciseType === ExerciseType.VOCAB_RECALL
            ? // Strict: the seed IS the target word. No substitution escape hatch —
              // the seed comes from the curated vocab_target list and coverage only
              // registers when expectedWord matches it (Spec 2). The anti-leak rule
              // (system prompt) still forbids the clue from containing the word.
              `The target word (expectedWord) MUST be exactly "${seedWord}". Write a clue or definition that elicits "${seedWord}" without revealing it — the clue must NOT contain "${seedWord}". Do not substitute another word.\n\n`
            : `Build this exercise around the word "${seedWord}". If "${seedWord}" does not fit ${inputs.grammarPoint.name} naturally, choose a related content word of similar frequency instead.\n\n`
      : "";
  const modeBlock =
    inputs.exerciseType === ExerciseType.SENTENCE_CONSTRUCTION
      ? `Use prompt mode: ${sentenceConstructionModeForOrdinal(ordinal)}.\n\n`
      : "";
  const paraphraseBlock =
    inputs.exerciseType === ExerciseType.CONTEXTUAL_PARAPHRASE
      ? `Use constraint kind: ${contextualParaphraseConstraintForOrdinal(ordinal)}.\n\n`
      : "";
  const coverageBlock = renderCoverageBlock(inputs, ordinal, coverageTargets);
  return `Produce exercise #${ordinal + 1}.

Topic domain: ${domain}

${modeBlock}${paraphraseBlock}${coverageBlock}${digitFormBlock}${baseWordCueBlock}${seedBlock}Use the ${toolName} tool.`;
}

// ---------------------------------------------------------------------------
// Canonical surface — used for `recentStems` accumulation in the generator,
// and (in Phase 3) for across-batch dedup. Lowercase + NFKD + diacritic-strip.
// ---------------------------------------------------------------------------

function normaliseSurface(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/\p{Diacritic}+/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

export function canonicalSurface(content: ExerciseContent): string {
  switch (content.type) {
    case ExerciseType.CLOZE:
      return normaliseSurface(content.sentence);
    case ExerciseType.TRANSLATION:
      return normaliseSurface(content.sourceText);
    case ExerciseType.VOCAB_RECALL:
      // Word + retrieval cue. Same word with a different cue (`prompt`) is a
      // distinct surface — R6 allows up to N exercises per word — but an
      // identical (word, cue) pair collapses to the same key and is blocked
      // as an exact duplicate.
      return `${normaliseSurface(content.expectedWord)}::${normaliseSurface(content.prompt)}`;
    case ExerciseType.SENTENCE_CONSTRUCTION:
      return normaliseSurface(content.prompt);
    case ExerciseType.DICTATION:
      // The reference transcription is the dedup surface (drives `_dedupKey`
      // and in-batch duplicate detection).
      return normaliseSurface(content.referenceText);
    case ExerciseType.FREE_WRITING:
      // The prompt title is the dedup surface (drives `_dedupKey` and in-batch
      // duplicate detection) — two prompts on the same topic must differ in title.
      return normaliseSurface(content.title);
    case ExerciseType.CONJUGATION:
      // Stable identity of a conjugation drill: lemma + target form + subject
      // pronoun — exactly what the learner produces. We deliberately do NOT key
      // on `featureBundle`: it is free-text grammar notation the model rephrases
      // run-to-run (e.g. "2. tekil kişi" vs "2. tekil şahıs"), so keying on it
      // gave the same prompt a different `_dedupKey` every run, bypassing the
      // dedup unique index and accruing duplicate rows. Person/number is carried
      // by `subject.pronoun`; tense/mood is fixed by the grammar point (cell),
      // and any tense/mood difference shows up in `targetForm` — so
      // lemma+targetForm+pronoun uniquely identifies the item within a cell.
      // `subject` is optional on legacy rows; fall back to an empty segment.
      return `${normaliseSurface(content.lemma)}::${normaliseSurface(content.targetForm)}::${normaliseSurface(content.subject?.pronoun ?? "")}`;
    case ExerciseType.CONTEXTUAL_PARAPHRASE:
      // The source sentence is the dedup surface: no two paraphrase exercises
      // in a cell may reuse the same sentence, regardless of constraint kind.
      return normaliseSurface(content.sourceText);
    default: {
      const _exhaustive: never = content;
      throw new Error(
        `canonicalSurface: unsupported content type ${(_exhaustive as ExerciseContent).type}`,
      );
    }
  }
}
