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
  type ExerciseContent,
  ExerciseType,
  type GrammarPoint,
  type Language,
} from "@language-drill/shared";

import { CEFR_LEVEL_DESCRIPTORS } from "./prompts.js";
import { TOOL_NAME_BY_TYPE } from "./generate.js";
import { getPromptWithVarsOrFallback } from "./prompts-registry.js";

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
export const GENERATION_PROMPT_VERSION = "generate@2026-06-07";

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

{{priorPoolSection}}## Hard constraints

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

## Output

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
  const { language, cefrLevel, exerciseType, grammarPoint, priorPoolSurfaces } =
    inputs;
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
    priorPoolSection: renderPriorPoolSection(exerciseType, priorPoolSurfaces),
    recentStemsBlock: renderRecentStems(recentStems),
    toolName: TOOL_NAME_BY_TYPE[exerciseType],
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
): string {
  const toolName = TOOL_NAME_BY_TYPE[inputs.exerciseType];
  const domain = topicDomain ?? "mixed";
  // R5.5: a LOOSE constraint — anchor on the seed, but allow a similar-frequency
  // substitute when it doesn't fit the grammar point, so seeding doesn't trade
  // dedup rejections for quality rejections.
  const seedBlock =
    seedWord && seedWord.length > 0
      ? `Build this exercise around the word "${seedWord}". If "${seedWord}" does not fit ${inputs.grammarPoint.name} naturally, choose a related content word of similar frequency instead.\n\n`
      : "";
  return `Produce exercise #${ordinal + 1}.

Topic domain: ${domain}

${seedBlock}Use the ${toolName} tool.`;
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
    default: {
      const _exhaustive: never = content;
      throw new Error(
        `canonicalSurface: unsupported content type ${(_exhaustive as ExerciseContent).type}`,
      );
    }
  }
}
