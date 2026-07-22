/**
 * packages/ai — Prompt builders for the validator (Phase 3).
 *
 * The validator's system prompt is `spec`-derived only — it does NOT include
 * draft-level fields — so two calls with the same `spec` produce byte-identical
 * strings. That's what allows Anthropic prompt caching (`cache_control:
 * ephemeral` on the system block) to hit on the second and subsequent
 * validator calls within a cell. The user prompt is `(draft, spec)`-derived
 * and changes per call.
 *
 * The system prompt's "Routing implication" block restates plan §3.1's
 * routing rule in plain English so Claude has the context to assign self-
 * consistent scores. The actual routing is done by `routeValidationResult`
 * (packages/db/scripts/generate-exercises-validate.ts), not here.
 */

import {
  type CefrLevel,
  type ClozeContent,
  type ConjugationContent,
  type ContextualParaphraseContent,
  coverageAxesFor,
  type CoverageAxis,
  ExerciseType,
  type SentenceConstructionContent,
  type TranslationContent,
  type VocabRecallContent,
} from "@language-drill/shared";

import { CEFR_LEVEL_DESCRIPTORS } from "./prompts.js";
import type { ExerciseDraft, GenerationSpec } from "./generate.js";
import { getPromptWithVarsOrFallback } from "./prompts-registry.js";
import { renderLevelScopeSection } from "./level-scope.js";

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
// Helpers
// ---------------------------------------------------------------------------

function renderBulletList(items: readonly string[]): string {
  return items.map((item) => `- ${item}`).join("\n");
}

// ---------------------------------------------------------------------------
// Raw template constant — Langfuse-registered body for `validate-system-prompt`.
// Phase 2 rewrites this in terms of FLAT placeholders only — the original
// Phase-1 placeholders used nested paths (`{{grammarPoint.name}}`,
// `{{CEFR_DESCRIPTORS}}`) which Langfuse's Mustache `compile(vars)` and our
// in-code `applyTemplate` cannot bridge byte-for-byte. The
// `VALIDATION_SYSTEM_PROMPT_TEMPLATE byte parity` test block pins
// `applyTemplate(TEMPLATE, computeValidationPromptVars(spec)).text ===
// buildValidationSystemPrompt(spec)` so any drift between the template and
// the live builder is caught at PR time.
// ---------------------------------------------------------------------------

// Bump in the same commit as any semantic edit to
// VALIDATION_SYSTEM_PROMPT_TEMPLATE. Drives the Langfuse trace
// `promptVersion` tag — dashboards cohort old vs. new prompt traces by
// this string.
// 2026-06-18: added the level-scope block ({{levelScopeSection}}) and reworded
// the levelMatch dimension to judge against the curriculum scope (ground truth)
// instead of the model's own sense of the level. Changes the registered
// template — needs a Langfuse push per env.
// 2026-07-08: added the flag-gated self-revealing-target note (cloze +
// translation) and the kind-gated vocab_recall note to the per-draft USER
// prompt (not the cached VALIDATION_SYSTEM_PROMPT_TEMPLATE — that stays
// byte-identical). Bumped so Langfuse cohorts new-vs-old validator traces;
// no Langfuse push needed since the system template itself is unchanged.
// 2026-07-08a: base-word-cue variant of the self-revealing note (derived-form
// points, appreciative suffixes): the parenthetical BASE-word cue is the
// sanctioned elicitation; spoilage only if the derived form itself is
// visible. Per-draft user prompt only — no Langfuse push needed.
// 2026-07-09: added the contextual_paraphrase validation user prompt (new
// ExerciseType). Per-draft user prompt only — no Langfuse push needed since
// the cached system template is unchanged.
// 2026-07-16: mirrors generate@2026-07-16 (generate↔validate contract split).
// (a) Form-contrast exception on the `ambiguous` dimension: for a point that
// contrasts two forms with different meanings (es-b2-perception-verbs
// infinitive vs. gerund), enumerating both in acceptableAnswers IS ambiguous,
// and a context-forced single-form draft must NOT be flagged for omitting the
// other alternant. (b) vocab_recall may cure a near-synonym-ambiguous
// definition by enumerating the alternates in the NEW acceptableAnswers
// field (rendered in the per-draft user prompt). Template edit → Langfuse
// push per env.
// 2026-07-18 (validate@2026-07-18): mirrors generate@2026-07-18. TranslationContent
// gained an `acceptableAnswers` field, now rendered in the translation user
// prompt; the `ambiguous` dimension for translation is now "structurally
// different renderings are ambiguous ONLY when acceptableAnswers doesn't
// enumerate them" (enumeration cures it, exactly as for cloze). Fixes the
// tr-a1-gore-bence collapse where every "In my opinion" translation was flagged
// ambiguous (Bence vs. Bana göre) with no way to enumerate. Template edit →
// Langfuse push per env.
export const VALIDATION_PROMPT_VERSION = "validate@2026-07-22";

export const VALIDATION_SYSTEM_PROMPT_TEMPLATE = `You are a strict reviewer of language exercises for {{language}} learners at CEFR {{cefrLevel}}. Your job is to validate one already-generated exercise that targets the grammar point: {{grammarPointName}}.

Be conservative. Reject anything ambiguous, anything mis-leveled, anything that fails to target the configured grammar point, and anything with cultural issues. Score on the high side only when the exercise is genuinely unambiguous, well-leveled, and on-point.

## Routing implication of your scores

Your output is routed by these rules:
- qualityScore < 0.5  OR  any cultural issue  OR  contextSpoilsAnswer  → REJECTED (dropped, not stored)
- qualityScore in [0.5, 0.7)                  → FLAGGED (waits for human review)
- qualityScore >= 0.7 AND not ambiguous AND not contextSpoilsAnswer AND levelMatch AND grammarPointMatch
                                              → AUTO-APPROVED (visible to learners)
- otherwise                                    → FLAGGED

Score conservatively — a flagged draft costs a human ~30 seconds of review; an auto-approved bad draft corrupts the learner's progress model.

## Grammar point context

{{grammarPointDescription}}

## Positive examples

{{positiveExamplesBullets}}

## Common learner errors (the exercise should expose these, not propagate them)

{{commonErrorsBullets}}

## CEFR level descriptors

{{cefrDescriptors}}

{{levelScopeSection}}## Dimensions to score (one-to-one with the tool's required fields)

1. **qualityScore** (0.0–1.0): overall fitness. Anchor to one of the values below; interpolate only when a draft sits cleanly between two anchors. Do NOT default to 0.7/0.75 as a "looks OK" floor.
   - **1.0** — exceptional; could anchor a published textbook unit.
   - **0.9** — publishable as-is by a native-speaker teacher.
   - **0.8** — publishable with one cosmetic edit.
   - **0.65** — borderline; clear issue but salvageable. Routes to FLAGGED.
   - **0.5** — unusable; reject. Routes to REJECTED.
2. **ambiguous** (boolean): more than one substantively-correct answer? For **cloze**, true when multiple lexemes/forms satisfy the grammar point in this sentence AND \`acceptableAnswers\` does not enumerate them. For **translation**, surface variation is fine; two or more structurally-different correct renderings are ambiguous ONLY when \`acceptableAnswers\` does not enumerate them — enumeration cures it exactly as for cloze (e.g. TR "In my opinion…" → both \`Bence …\` and \`Bana göre …\`; listing the alternative, or wording the source to force one structure, is NOT ambiguous). For **vocab_recall**, the prompt must pick out exactly one headword — or, when the language has true near-synonyms that the definition admits equally (e.g. TR \`istasyon\`/\`gar\` for a station definition), \`acceptableAnswers\` must enumerate every defensible alternate; enumerated near-synonyms cure the ambiguity, a missing defensible alternate does not. For **sentence_construction**, \`ambiguous\` is about the PROMPT, not the answer space: open production legitimately has many correct sentences (different modals, lexis, word order, polarity), and that is the task design — it is NOT \`ambiguous\`, and no \`acceptableAnswers\` enumeration is expected or possible. Set \`ambiguous = true\` ONLY when the PROMPT itself is self-contradictory (e.g. it instructs "reply as \`du\`" — a register/addressee cue — while the situation requires a first-person \`ich\` answer, so no coherent single sentence satisfies it) or so under-specified the learner cannot tell what structure to produce. Never set it merely because multiple valid sentences exist, or because the model answers differ in lexis, word order, or polarity.
   - **Form-contrast exception (cloze):** when the grammar point itself CONTRASTS two forms with DIFFERENT meanings (e.g. ES perception verbs: infinitive = completed event vs. gerund = caught in progress), enumeration does NOT cure ambiguity — listing both contrasting forms in \`acceptableAnswers\` teaches that they are interchangeable and IS \`ambiguous\`. A good draft forces exactly one of the contrasting forms via sentence context (durativity/completion cues) and lists neither contrast alternant in \`acceptableAnswers\`; do not flag such a context-forced draft merely for omitting the other contrasting form. A blank on the conjugated perception verb instead of the infinitive/gerund slot is \`grammarPointMatch: false\` (it tests tense selection).
   - "Sınıfta sekiz ___ var." / \`correctAnswer: "öğrenci"\` — sandalye, kalem, kitap, defter all satisfy no-plural-after-numeral equally; needs \`acceptableAnswers\`.
   - "Evde yeni ___ var. Onlar çok güzel." / \`correctAnswer: "perdeler"\` — perdeler, kitaplar, çiçekler, lambalar all fit "plural + positive descriptor"; the follow-on doesn't disambiguate. Needs \`acceptableAnswers\` or tighter framing ("Onları yıkamayı unutma" picks out perdeler).
   - "Ben çok mutlu___" / \`correctAnswer: "um"\` or \`"yum"\` — buffer-consonant blank: vowel-final stem "mutlu" + 1sg copular \`-Im\` requires buffer \`-y-\`. Without \`acceptableAnswers\` listing both ("um" and "yum"), or embedding \`-y-\` in the visible stem as "mutluy___", set \`ambiguous = true\` AND add \`'buffer-consonant ambiguous blank'\` to \`flaggedReasons\`.
   - Translation: "In my opinion…" / ref \`Bence bu doğru.\` — IS ambiguous with empty \`acceptableAnswers\` (equally-correct \`Bana göre bu doğru.\` unlisted), NOT ambiguous once it is listed. A source forcing one structure ("In his opinion…" → only \`Ona göre…\`) needs no list.
3. **contextSpoilsAnswer** (boolean): does the draft's \`instructions\` or \`context\` state the rule's outcome, name the required suffix/form, or otherwise let the learner write the answer without engaging with the blank? Naming the rule category is fine ("vowel harmony", "plural agreement after a numeral"); stating the outcome is not. Also true when \`context\` exhaustively enumerates every member of the closed set of forms the grammar point selects between. \`true\` is a hard veto.
   - "Vowel harmony: stem 'çocuk' (u = back, unrounded → -lar)" / blank "lar" — context derives the answer from the stem.
   - "Use -da/-de after voiced consonants, -ta/-te after voiceless" / blank one of "-da/-de/-ta/-te" — closed set exhaustively enumerated.
   - "Vowel harmony: front vowel stems take -ler suffix" above "Odada pencere___" / blank "ler" — rule's outcome stated for the exact stem class.
4. **levelMatch** (boolean): If a grammar-scope list is provided above, use it as the ground truth for what a {{cefrLevel}} learner has studied; if no list is provided, judge against your general knowledge of {{cefrLevel}} expectations. Set \`false\` only if the exercise REQUIRES a grammatical construction clearly ABOVE the learner's level, or is trivially below {{cefrLevel}}. Do NOT set \`false\` merely because a construction is within or below the learner's scope but is not the target point — anything within or below the learner's scope is fair game. Obligatory morphology inherent to {{language}} is part of the language at every level and is never "above level".
5. **grammarPointMatch** (boolean): does this actually test {{grammarPointName}}?
   - Set \`false\` when the blank's construction is a different grammar-point key from the cell's declared point, **even when grammatically related**. Example: \`correctAnswer: "da"\` in a \`tr-a1-vowel-harmony\` cell tests locative \`-DA\` (belongs in \`tr-a1-locative\`) — the suffix incidentally obeys vowel harmony but the blank tests locative selection. The grammar-point-key boundary is the rule, not the broader grammar family.
6. **culturalIssues** (array of strings): stereotyping, sensitive content, exclusion. Empty array when none.
7. **flaggedReasons** (array of strings): anything else a reviewer should know.
   - Cell over-concentration: when validating a draft for \`tr-a1-vowel-harmony\` (or any grammar-shape cell with multiple surface forms) where the blank tests the plural suffix \`-lAr/-lEr\`, add \`'cell over-concentrated on plural suffix'\`. Soft signal — does not change routing for this draft; aggregates at review time so a >50 % rate surfaces the imbalance.

## Output

You MUST use the submit_validation_result tool. Do not return plain text.`;

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

/**
 * Flat-string var map consumed by both the in-code fallback substituter
 * and Langfuse's `compile(vars)`. Mirrors the shape required by
 * `VALIDATION_SYSTEM_PROMPT_TEMPLATE`. Pulled out of the builder so the
 * Task-12 snapshot parity test can exercise the same computation the
 * builder does (Task 13's async refactor will route both through it).
 */
export function computeValidationPromptVars(
  spec: GenerationSpec,
): Record<string, string> {
  const { language, cefrLevel, grammarPoint } = spec;
  return {
    language,
    cefrLevel,
    grammarPointName: grammarPoint.name,
    grammarPointDescription: grammarPoint.description,
    positiveExamplesBullets: renderBulletList(grammarPoint.examplesPositive),
    commonErrorsBullets: renderBulletList(grammarPoint.commonErrors),
    cefrDescriptors: CEFR_DESCRIPTOR_BULLETS,
    levelScopeSection: renderLevelScopeSection(
      spec.exerciseType,
      spec.language,
      spec.cefrLevel,
      spec.levelScopePoints,
    ),
  };
}

/**
 * Builds the validator system prompt, fetching the live body from
 * Langfuse (label `production`) and falling back to
 * `VALIDATION_SYSTEM_PROMPT_TEMPLATE` on outage / unset keys / compile
 * mismatch. Byte parity between the two paths is pinned by the
 * `VALIDATION_SYSTEM_PROMPT_TEMPLATE byte parity` test block.
 *
 * Async because the Langfuse fetch is async (cached in-process for 5 min
 * so warm Lambdas pay zero per-request cost). The single caller
 * (`validateDraft` in `validate.ts`) is already `async`.
 */
export async function buildValidationSystemPrompt(
  spec: GenerationSpec,
): Promise<string> {
  const vars = computeValidationPromptVars(spec);
  const { text } = await getPromptWithVarsOrFallback(
    "validate-system-prompt",
    VALIDATION_SYSTEM_PROMPT_TEMPLATE,
    VALIDATION_PROMPT_VERSION,
    vars,
  );
  return text;
}

// ---------------------------------------------------------------------------
// Per-type user prompts
// ---------------------------------------------------------------------------
//
// Each renderer prepends a "Spec:" preamble that names the target language,
// CEFR level, and grammar point key — repeated from the (cached) system
// prompt so the validator can compare the draft against the spec in one
// pass. Token cost is ~30 per draft; the latency benefit of not having to
// cross-reference message blocks justifies the duplication.

// Per-cell scoring guidance lives in the (uncached, per-draft) user prompt —
// NOT the global system prompt — so a single grammar point's rubric note costs
// tokens only on its own drafts and never inflates every other cell's
// validation. `tr-a1-possessive-suffixes` needs this because the generation
// prompt mandates an overt possessor pronoun to disambiguate the person, but
// the default rubric otherwise dings that same pronoun as "over-scaffolding",
// capping clean drafts at ~0.62 (FLAGGED) instead of auto-approving them.
function clozeCellScoringNote(grammarPointKey: string): string {
  if (grammarPointKey === "tr-a1-possessive-suffixes") {
    return `

**Scoring note for this possessive-suffix (İyelik) cell:** an overt genitive possessor pronoun (benim/senin/onun/bizim/sizin/onların) in the sentence is the INTENDED person-disambiguator — it is what makes the blank unambiguous (the same sentence without it would admit every person). Do NOT lower qualityScore for that pronoun as "over-scaffolding", "telegraphing the person/number", "redundant", or "too mechanical", and do NOT suggest blanking only the suffix (the whole-word blank is by design). The learner must still produce the correctly harmonised WHOLE form, including the 3sg -s- buffer and the dropped buffer vowel after vowel-final stems. Score on naturalness, A1 vocabulary, and whether the stem actually exercises the suffix — a clean draft of this kind (e.g. "Onun ___ çok güzel. (araba)" → arabası) is 0.8+, not 0.62.`;
  }
  if (grammarPointKey === "tr-a2-indefinite-compound") {
    return `

**Scoring note for this indefinite-noun-compound (belirtisiz isim tamlaması) cell:** by design the bare modifier noun is GIVEN in the sentence and ONLY the head noun is blanked (e.g. "Çantamda bir müzik ___ var. (kaset)" → kaseti). Producing the head + 3sg -(s)I (the compound marker) in the nominative IS the target skill, and a genitive/case-marked distractor is the intended foil. Do NOT set grammarPointMatch=false merely because "only the head is blanked", "the modifier is already present", or "the -(s)I suffix is tested in isolation / could be read as a plain possessive" — that head-only blank is the correct shape for this point, NOT a grammar-point mismatch. Set grammarPointMatch=false only when the blank genuinely tests a DIFFERENT grammar-point key (e.g. case-stacking → tr-a2-possessive-case-stacking). Keep flagging real defects normally: 'bir' wedged between the modifier and the head ('bir' must precede the WHOLE compound — "bir müzik kaseti", never "bir müzik ___"), above-level vocabulary, or two options both valid. A clean draft of this kind is 0.8+, not flagged.`;
  }
  return "";
}

// Self-revealing targets (numbers/ordinals — see
// docs/findings/2026-07-07-self-revealing-target-elicitation.md): the target's
// meaning cannot be conveyed without identifying it, so the digit-form cue is
// the sanctioned elicitation. Gated on the curriculum flag (not a key list) so
// future flagged points inherit it. Applies to cloze AND translation drafts.
function selfRevealingScoringNote(spec: GenerationSpec): string {
  if (spec.grammarPoint.selfRevealingElicitation === "digit-form") {
    return `

**Scoring note for this self-revealing-target cell:** the target is a number/ordinal whose meaning CANNOT be conveyed without identifying it. A digit or numeral cue in the visible text (e.g. "3.º", "3.", "200", "123", digits in a translation source sentence) is the INTENDED elicitation for this cell — do NOT set contextSpoilsAnswer=true because digits identify which value the learner must write. The tested skill is producing the WRITTEN form with correct agreement/apocope/gender/harmony (tercer vs tercero, doscientas, üçüncü), which digits do not reveal. Still set contextSpoilsAnswer=true if the written word form itself appears anywhere in the visible text. Score all other dimensions normally; a clean digit-cued draft is 0.8+, not spoiled.`;
  }
  if (spec.grammarPoint.selfRevealingElicitation === "base-word-cue") {
    return `

**Scoring note for this self-revealing-target cell:** the target is a DERIVED form (appreciative suffix) that cannot be elicited without identifying its base word. A parenthetical BASE-word cue in the visible text (e.g. "(silla)" when the answer is "sillita") is the INTENDED elicitation for this cell — do NOT set contextSpoilsAnswer=true because the base word appears. The tested skill is choosing the suffix from the context's nuance and forming it with the correct allomorph and gender (mujercita, cochecito, notición), which the base word does not reveal. Still set contextSpoilsAnswer=true if the derived form itself appears anywhere in the visible text (including inside the parenthetical cue). Reject an answer that is a novel coinage rather than an established form, and flag genuine nuance ambiguity where a DIFFERENT established suffixed form of the same base fits the context equally well. Score all other dimensions normally; a clean base-cued draft is 0.8+, not spoiled.`;
  }
  return "";
}

// vocab_recall's task IS meaning→word retrieval: a definition that picks out
// exactly one headword is the exercise working as designed, not spoilage.
// Spoilage for vocab is ORTHOGRAPHIC and confined to the PROMPT/HINTS.
//
// The exampleSentence is NOT a spoiler surface: the drill UI only reveals it at
// the deepest opt-in hint level and masks the expected word to `___` first
// (hint-row.tsx `maskExampleSentence`); the full sentence appears only AFTER
// submission, as post-answer usage. So the expected word appearing in the
// example is by design — 53% of the auto-approved pool has it. The prior rule
// listing "example sentence" as an orthographic reveal contradicted both the UI
// and the pool (it made the validator inconsistently reject otherwise-fine
// drafts), so it is scoped to prompt/hints only.
//
// The grammarPointMatch clause aligns the validator with the curriculum the
// generator is already driven by: a vocab umbrella is a SEMANTIC DOMAIN (its
// coverageSpec can mandate verbs/adjectives — e.g. food-drink floors verb:2,
// adjective:2), so POS is not a grammarPointMatch criterion. Without this, the
// validator invents a "food-drink ⇒ noun" heuristic and flags curriculum-mandated
// verbs/adjectives (içmek, acı) as grammarPointMatch=false — a generate↔validate
// contract split that kept those cells at ~0% approval. Kept SURGICAL (single
// dimension, no "pre-vetted/curated/good" framing) because a broader pro-context
// block was verified to make the validator miss orthographic spoilers and
// spuriously level-flag clean drafts. Level-mismatch on genuinely rare/over-level
// headwords is handled by curriculum curation (drop extended-tier targets), not
// here; ambiguous, levelMatch, qualityScore are untouched.
function vocabRecallScoringNote(spec: GenerationSpec): string {
  if (spec.grammarPoint.kind !== "vocab") return "";
  return `

**Scoring note for vocab_recall:** the Prompt is a meaning-based definition whose JOB is to pick out exactly one headword — do NOT set contextSpoilsAnswer=true because the definition identifies the expected word, however precise the definition is. Set contextSpoilsAnswer=true ONLY for orthographic reveals in the PROMPT or HINTS: the expected word (in any inflection) appearing there; first/last-letter or letter-count hints; partial spellings. The exampleSentence is a post-answer usage illustration (the UI masks the word before submission), so the expected word appearing in the example sentence is NOT contextSpoilsAnswer. A precise unambiguous definition with meaning-only hints is a GOOD exercise (0.8+), not a spoiled one.

**grammarPointMatch for vocab_recall:** a vocab umbrella is a SEMANTIC DOMAIN (e.g. food & drink, transport & places), NOT a part of speech. A domain-appropriate verb (içmek "to drink"), adjective (acı "spicy"), or adverb is on-target — set grammarPointMatch=false ONLY when the headword is outside that domain, never merely because it is not a noun. Judge every other dimension (levelMatch, ambiguous, contextSpoilsAnswer, qualityScore) exactly as defined above, unchanged.

**Kinship definitions for vocab_recall:** when the target language lexicalizes a kin relation more finely than English — most sharply by SIDE of the family (TR \`amca\` father's brother vs \`dayı\` mother's brother; \`hala\` father's sister vs \`teyze\` mother's sister; \`babaanne\` father's mother vs \`anneanne\` mother's mother) — a side-NEUTRAL gloss ("your father's OR mother's brother", "your parent's sister") is true of BOTH terms equally, so it does NOT pick out the single \`expectedWord\`: set ambiguous=true UNLESS the other defensible term is listed in acceptableAnswers. A gloss that names the side ("your MOTHER's brother" → \`dayı\`) is unambiguous — do not flag it. A generic term that is genuinely side-neutral in the target language (TR \`büyükanne\`/\`dede\`, \`kuzen\`, \`akraba\`) legitimately takes a side-neutral gloss — do not flag those. Separately: if the definition describes a DIFFERENT relation than the \`expectedWord\` denotes (glossing \`dayı\` as "the child of your mother's brother" — that is a cousin, \`kuzen\`; or \`hala\` as "your mother's sister" — that is \`teyze\`), the clue is factually wrong for its answer — set ambiguous=true and lower qualityScore below 0.5 (a mislabeled clue is not a servable exercise).`;
}

// ---------------------------------------------------------------------------
// Sentence-construction scoring note (appended to the SC user prompt).
//
// SC is OPEN PRODUCTION. The generic `ambiguous` test and a strict reading of
// model-answer consistency both mis-fire here: pool-wide, 81 % of flagged SC
// drafts carried `ambiguous` (vs 4 % for deterministic conjugation), and most
// of the co-occurring `low-quality` flags were the validator nitpicking model
// answers for optional words / varied modals / mixed polarity — all expected
// in free production. This note scopes qualityScore + low-quality reasons to
// the exercise type; the `ambiguous` dimension itself is scoped in the system
// prompt (item 2). See docs/analysis/generation-run-2026-07-22.md.
// ---------------------------------------------------------------------------
function sentenceConstructionScoringNote(spec: GenerationSpec): string {
  return `

**Scoring note for sentence_construction:** this is OPEN PRODUCTION. Do NOT dock qualityScore below 0.7, and do NOT add a low-quality flaggedReason, merely because the model answers add optional words (e.g. \`zu Hause\`, \`heute Abend\`), use different modals/polarity, or vary word order — that variation is expected and correct. Reserve concerns for: a self-contradictory or under-specified PROMPT; a model answer that is incoherent or off-target for the prompt (e.g. a \`du\`-subject sentence where the situation requires a first-person \`ich\` reply); or a model answer using a structure clearly ABOVE ${spec.cefrLevel} (e.g. a \`weil\`/\`dass\` subordinate clause or \`also\`-coordination at A1 → set levelMatch=false). A prompt whose \`du\`/\`Sie\` is a register/addressee cue is fine; only flag when it is mis-compiled into the grammatical subject and yields an incoherent answer.`;
}

function buildClozeValidationUserPrompt(
  content: ClozeContent,
  spec: GenerationSpec,
): string {
  return `## Validate this Cloze exercise

**Spec:** language=${spec.language}, cefrLevel=${spec.cefrLevel}, grammar point=${spec.grammarPoint.key}
**Instructions:** ${content.instructions}
**Sentence:** ${content.sentence}
**Correct Answer:** ${content.correctAnswer}
${content.acceptableAnswers && content.acceptableAnswers.length > 0 ? `**Acceptable Answers (also accepted):** ${content.acceptableAnswers.join(", ")}` : "**Acceptable Answers (also accepted):** (none declared — `correctAnswer` must be the only plausible fill)"}
${content.options ? `**Options:** ${content.options.join(", ")}` : ""}
${content.context ? `**Context:** ${content.context}` : ""}${clozeCellScoringNote(spec.grammarPoint.key)}${selfRevealingScoringNote(spec)}

Score the dimensions in the system prompt and submit via the tool.`;
}

function buildTranslationValidationUserPrompt(
  content: TranslationContent,
  spec: GenerationSpec,
): string {
  return `## Validate this Translation exercise

**Spec:** language=${spec.language}, cefrLevel=${spec.cefrLevel}, grammar point=${spec.grammarPoint.key}
**Instructions:** ${content.instructions}
**Source Text (${content.sourceLanguage}):** ${content.sourceText}
**Target Language:** ${content.targetLanguage}
**Reference Translation:** ${content.referenceTranslation}
${content.acceptableAnswers && content.acceptableAnswers.length > 0 ? `**Acceptable Answers (structurally-different renderings, also accepted):** ${content.acceptableAnswers.join(", ")}` : "**Acceptable Answers (structurally-different renderings, also accepted):** (none declared — the source must admit only one natural structure)"}${selfRevealingScoringNote(spec)}

Score the dimensions in the system prompt and submit via the tool.`;
}

function buildVocabRecallValidationUserPrompt(
  content: VocabRecallContent,
  spec: GenerationSpec,
): string {
  return `## Validate this Vocabulary Recall exercise

**Spec:** language=${spec.language}, cefrLevel=${spec.cefrLevel}, grammar point=${spec.grammarPoint.key}
**Instructions:** ${content.instructions}
**Prompt:** ${content.prompt}
**Expected Word:** ${content.expectedWord}
**Acceptable Answers (near-synonyms also accepted):** ${content.acceptableAnswers && content.acceptableAnswers.length > 0 ? content.acceptableAnswers.join(", ") : "(none declared — the definition must pick out `Expected Word` alone)"}
**Hints:** ${content.hints.join("; ")}
**Example Sentence:** ${content.exampleSentence}${vocabRecallScoringNote(spec)}

Score the dimensions in the system prompt and submit via the tool.`;
}

function buildSentenceConstructionValidationUserPrompt(
  content: SentenceConstructionContent,
  spec: GenerationSpec,
): string {
  const keywordsLine =
    content.keywords && content.keywords.length > 0
      ? `**Keywords:** ${content.keywords.join(", ")}`
      : "";
  const structureLine = content.targetStructure
    ? `**Target structure:** ${content.targetStructure}`
    : "";
  const registerLine = content.register ? `**Register:** ${content.register}` : "";
  return `## Validate this Sentence Construction exercise

**Spec:** language=${spec.language}, cefrLevel=${spec.cefrLevel}, grammar point=${spec.grammarPoint.key}
**Prompt mode:** ${content.promptMode}
**Instructions:** ${content.instructions}
**Prompt:** ${content.prompt}
${keywordsLine}
${structureLine}
${registerLine}
**Model answers:** ${content.modelAnswers.join(" | ")}${sentenceConstructionScoringNote(spec)}

Score the dimensions in the system prompt. Treat the exercise as well-formed only if the prompt is self-consistent and solvable at the target level, AND every model answer genuinely satisfies the prompt (keywords used / goal met / target structure used) at the target CEFR level. If a model answer does not exercise the grammar point, set grammarPointMatch=false. Submit via the tool.`;
}

function buildContextualParaphraseValidationUserPrompt(
  content: ContextualParaphraseContent,
  spec: GenerationSpec,
): string {
  const constraintDetail =
    content.constraintKind === "avoid"
      ? `Banned terms (must appear in the source, must NOT appear in any paraphrase): ${(content.bannedTerms ?? []).join(", ")}`
      : content.constraintKind === "register"
        ? `Target register: ${content.targetRegister}`
        : `Simplify for: ${content.audience}`;
  return `Validate this ${spec.language} contextual-paraphrase exercise (CEFR ${spec.cefrLevel}).

Source sentence: ${content.sourceText}
Constraint kind: ${content.constraintKind}
${constraintDetail}
Task shown to learner: ${content.constraintLabel}
Reference paraphrases:
${content.referenceParaphrases.map((p, i) => `${i + 1}. ${p}`).join("\n")}

Reject (flag) the exercise if ANY of the following hold:
- The meaning cannot be preserved under the constraint, or the only faithful rewrite is the source itself.
- constraintKind 'avoid': a banned term is absent from the source, OR appears in any reference paraphrase, OR has no reasonable ${spec.language} synonym/circumlocution at CEFR ${spec.cefrLevel}.
- constraintKind 'register': the source is already in the target register (no shift to perform), or a reference paraphrase changes the propositional content.
- constraintKind 'simplify': a reference paraphrase omits information or is not simpler for the stated audience.
- Any reference paraphrase is ungrammatical, unnatural, or above/below CEFR ${spec.cefrLevel}.
- The source sentence is unnatural, or the constraintLabel leaks a finished paraphrase.
Otherwise approve it.`;
}

export function buildConjugationValidationUserPrompt(
  content: ConjugationContent,
  spec: GenerationSpec,
): string {
  return `## Validate this Conjugation/Inflection exercise

**Spec:** language=${spec.language}, cefrLevel=${spec.cefrLevel}, grammar point=${spec.grammarPoint.key}
**Instructions:** ${content.instructions}
**Lemma:** ${content.lemma} (${content.lemmaGloss})
**Feature bundle:** ${content.featureBundle}
**Proposed correct form:** ${content.targetForm}
**Acceptable variants:** ${(content.acceptableForms ?? []).join(", ") || "(none)"}
**Breakdown shown to the learner:** ${content.breakdown}
**Example sentences:** ${content.exampleSentences.join(" / ")}

Check, and reject (low quality) if any fails:
1. Is "${content.targetForm}" the EXACTLY correct ${spec.language} form for that lemma + feature bundle, including all diacritics? An incorrect stored form mis-grades every learner. For nominal points in languages that mark case/number on the article/adjective rather than the noun (German declension), the target is legitimately a multi-word NP ("einen neuen Tisch", "kaltem Wasser") — do NOT reject it for not being a single word; instead verify every word of the phrase (article type, adjective ending, noun form) is correct for the stated case/number and the noun's gender.
2. Does the feature bundle correspond to the grammar point's inflectional category (tense/mood for verbs; case/number/possessive for nominals) — it must not drift to a different category?
3. Are all "acceptable variants" genuinely fully-correct alternatives (not near-misses or common errors)?
4. Does the feature bundle avoid leaking the answer, and do the example sentences use the form correctly and naturally at this level?
5. Is the breakdown accurate?

Score the dimensions in the system prompt and submit via the tool.`;
}

// Per-axis instruction copy for the realized-coverage tags. Appended to the
// (uncached, per-draft) user prompt only for the axes applicable to the cell —
// so non-applicable cells pay zero tokens and the CACHED system prompt stays
// byte-identical. The tool field that receives these is `coverage` (validate.ts).
const COVERAGE_AXIS_DIRECTIVE: Record<CoverageAxis, string> = {
  person:
    "- `coverage.person`: the grammatical person/number the target answer realizes (1sg/2sg/3sg/1pl/2pl/3pl). Report what the draft ACTUALLY produced, not what was requested.",
  number:
    "- `coverage.number`: the grammatical number of the target form (singular/plural). Report what the draft ACTUALLY produced, not what was requested.",
  case:
    "- `coverage.case`: the grammatical case of the target form (nominative/accusative/dative/locative/ablative/genitive). Report what the draft ACTUALLY produced, not what was requested.",
  wordClass:
    "- `coverage.wordClass`: the part of speech of the target word (noun/verb/adjective/adverb/other).",
  polarity:
    "- `coverage.polarity`: whether the target sentence is affirmative or negative.",
  sentenceType:
    "- `coverage.sentenceType`: the clause type of the target sentence (declarative/interrogative/imperative).",
  comparison:
    "- `coverage.comparison`: the comparison construction the target realizes (comparative/superlative/equative/less). Report what the draft ACTUALLY produced, not what was requested.",
};

function renderCoverageDirective(spec: GenerationSpec): string {
  const axes = coverageAxesFor(
    spec.exerciseType,
    spec.grammarPoint.coverageSpec,
  );
  if (axes.length === 0) return "";
  const lines = axes.map((axis) => COVERAGE_AXIS_DIRECTIVE[axis]).join("\n");
  return `\n\n**Coverage tags (descriptive only — do NOT change qualityScore based on these):** also fill the \`coverage\` object with the realized value(s) for this draft:\n${lines}`;
}

/**
 * Pure: builds the per-draft user message. Two calls with the same
 * (draft, spec) return byte-identical strings.
 *
 * NOTE on signature: the design's Component 2 floats `(draft)` only, but
 * rendering the documented "Spec:" preamble requires `language` and
 * `cefrLevel`, which live on `spec` and not on the draft. Widened to
 * `(draft, spec)` here so the caller (`validateDraft`) can pass both. The
 * caller already has both available — this is the only sensible signature.
 */
export function buildValidationUserPrompt(
  draft: ExerciseDraft,
  spec: GenerationSpec,
): string {
  const content = draft.contentJson;
  let base: string;
  switch (content.type) {
    case ExerciseType.CLOZE:
      base = buildClozeValidationUserPrompt(content, spec);
      break;
    case ExerciseType.TRANSLATION:
      base = buildTranslationValidationUserPrompt(content, spec);
      break;
    case ExerciseType.VOCAB_RECALL:
      base = buildVocabRecallValidationUserPrompt(content, spec);
      break;
    case ExerciseType.SENTENCE_CONSTRUCTION:
      base = buildSentenceConstructionValidationUserPrompt(content, spec);
      break;
    case ExerciseType.CONJUGATION:
      base = buildConjugationValidationUserPrompt(content, spec);
      break;
    case ExerciseType.CONTEXTUAL_PARAPHRASE:
      base = buildContextualParaphraseValidationUserPrompt(content, spec);
      break;
    case ExerciseType.DICTATION:
      throw new Error(
        "Dictation exercises are not validated via this path; use gradeDictationAnswer.",
      );
    case ExerciseType.FREE_WRITING:
      // free_writing is authored by hand, not produced/validated by the pool
      // generation pipeline.
      throw new Error(
        "buildValidationUserPrompt: free_writing is not pool-validated",
      );
    default: {
      const _exhaustive: never = content;
      throw new Error(
        `buildValidationUserPrompt: unsupported content type ${(_exhaustive as { type: ExerciseType }).type}`,
      );
    }
  }
  return base + renderCoverageDirective(spec);
}

