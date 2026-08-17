import { describe, it, expect } from "vitest";
import {
  CefrLevel,
  type ExerciseContent,
  ExerciseType,
  Language,
  type ClozeContent,
  type ConjugationContent,
  type ContextualParaphraseContent,
  type TranslationContent,
  type VocabRecallContent,
  type SentenceConstructionContent,
  type CoverageSpec,
} from "@language-drill/shared";
import { getGrammarPoint, grammarPointsAtOrBelow } from "@language-drill/db";

import { CEFR_LEVEL_DESCRIPTORS, EVALUATION_SYSTEM_PROMPT } from "./prompts.js";
import type { ExerciseDraft, GenerationSpec } from "./generate.js";
import {
  buildValidationSystemPrompt,
  buildValidationUserPrompt,
  computeValidationPromptVars,
  VALIDATION_SYSTEM_PROMPT_TEMPLATE,
  VALIDATION_PROMPT_VERSION,
} from "./validation-prompts.js";
import { applyTemplate } from "./prompts-registry.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const grammarPoint = getGrammarPoint("es-b1-present-subjunctive");
if (!grammarPoint) {
  throw new Error(
    "test fixture missing: curriculum entry 'es-b1-present-subjunctive'",
  );
}

const baseSpec: GenerationSpec = {
  language: Language.ES,
  cefrLevel: CefrLevel.B1,
  exerciseType: ExerciseType.CLOZE,
  grammarPoint,
  topicDomain: null,
  count: 1,
  batchSeed: "test-seed",
};

const trA2Grammar = getGrammarPoint("tr-a2-aorist");
if (!trA2Grammar) throw new Error("test fixture missing: tr-a2-aorist");
const trA1ScopePoint = getGrammarPoint("tr-a1-locative");
if (!trA1ScopePoint) throw new Error("test fixture missing: tr-a1-locative");

const trClozeSpec: GenerationSpec = {
  language: Language.TR,
  cefrLevel: CefrLevel.A2,
  exerciseType: ExerciseType.CLOZE,
  grammarPoint: trA2Grammar,
  topicDomain: null,
  count: 1,
  batchSeed: "test-seed",
  levelScopePoints: grammarPointsAtOrBelow(Language.TR, CefrLevel.A2),
};

function makeDraft(content: ExerciseContent): ExerciseDraft {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    contentJson: content,
    metadata: {
      grammarPointKey: grammarPoint!.key,
      topicDomain: null,
      modelId: "claude-sonnet-4-5",
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
      inBatchDuplicate: false,
    },
  };
}

// ---------------------------------------------------------------------------
// buildValidationSystemPrompt
// ---------------------------------------------------------------------------

describe("buildValidationSystemPrompt", () => {
  it("is deterministic — same spec returns identical bytes (cache invariant)", async () => {
    // Async since Phase-2: must await both before comparing, otherwise
    // `toBe` compares two distinct Promise references and fails trivially.
    const [a, b] = await Promise.all([
      buildValidationSystemPrompt(baseSpec),
      buildValidationSystemPrompt(baseSpec),
    ]);
    expect(a).toBe(b);
  });

  it("inlines the grammar-point name, description, positive examples, and common errors verbatim", async () => {
    const prompt = await buildValidationSystemPrompt(baseSpec);
    expect(prompt).toContain(grammarPoint.name);
    expect(prompt).toContain(grammarPoint.description);
    for (const example of grammarPoint.examplesPositive) {
      expect(prompt).toContain(example);
    }
    for (const error of grammarPoint.commonErrors) {
      expect(prompt).toContain(error);
    }
  });

  it("interpolates language and CEFR level into the header and the dimension descriptions", async () => {
    const prompt = await buildValidationSystemPrompt(baseSpec);
    expect(prompt).toContain("ES learners at CEFR B1");
    expect(prompt).toContain("trivially below B1");
    expect(prompt).toContain(`does this actually test ${grammarPoint.name}?`);
  });

  it("shares CEFR descriptors with EVALUATION_SYSTEM_PROMPT (DRY invariant — Req 2.4)", async () => {
    const b1Descriptor = CEFR_LEVEL_DESCRIPTORS[CefrLevel.B1];
    const validatorPrompt = await buildValidationSystemPrompt(baseSpec);
    expect(validatorPrompt).toContain(b1Descriptor);
    expect(EVALUATION_SYSTEM_PROMPT).toContain(b1Descriptor);
  });

  it("contains the routing-implication block verbatim from plan §3.1", async () => {
    const prompt = await buildValidationSystemPrompt(baseSpec);
    // qualityScore < 0.5 OR cultural issue OR contextSpoilsAnswer → REJECTED
    expect(prompt).toContain(
      "qualityScore < 0.5  OR  any cultural issue  OR  contextSpoilsAnswer  → REJECTED",
    );
    // qualityScore in [0.5, 0.7) → FLAGGED
    expect(prompt).toContain("qualityScore in [0.5, 0.7)");
    expect(prompt).toContain("FLAGGED (waits for human review)");
    // qualityScore >= 0.7 conjunction → AUTO-APPROVED
    expect(prompt).toContain(
      "qualityScore >= 0.7 AND not ambiguous AND not contextSpoilsAnswer AND levelMatch AND grammarPointMatch",
    );
    expect(prompt).toContain("AUTO-APPROVED (visible to learners)");
    // Otherwise → FLAGGED catch-all
    expect(prompt).toContain("otherwise");
  });

  it("instructs Claude to use the submit_validation_result tool only", async () => {
    const prompt = await buildValidationSystemPrompt(baseSpec);
    expect(prompt).toContain("submit_validation_result");
    expect(prompt).toContain("Do not return plain text");
  });

  it("contains the strict-reviewer framing", async () => {
    const prompt = await buildValidationSystemPrompt(baseSpec);
    expect(prompt).toContain("strict reviewer");
    expect(prompt).toContain("Be conservative");
  });

  it("pins the cluster A edits — 5-anchor rubric + R3.A/R3.B/R7.3 triples + R2.4/R2.6 bullets", async () => {
    // One regression net for everything that landed in the R3 + R4 + R7
    // validator-prompt edit (tasks 8 + 9 + 10). Pin each individually so a
    // future edit can't silently drop one while preserving the others.
    const prompt = await buildValidationSystemPrompt(baseSpec);

    // R4.1 — anchored qualityScore rubric. Pin the 0.9 anchor + the
    // "publishable" wording that ties the rubric to the requirement.
    expect(prompt).toContain("0.9");
    expect(prompt).toContain("publishable");
    expect(prompt).toContain("1.0");
    expect(prompt).toContain("0.8");
    expect(prompt).toContain("0.65");
    expect(prompt).toContain("0.5");

    // R3.B retained — the original "Sınıfta sekiz" exemplar must survive
    // the reformat into the triple block.
    expect(prompt).toContain("Sınıfta sekiz");
    // R3.B new — the "Evde yeni" exemplar added in task 9.
    expect(prompt).toContain("Evde yeni");
    // R7.3 — the buffer-consonant "mutlu" exemplar added in task 9.
    expect(prompt).toContain("mutlu");
    expect(prompt).toContain("buffer-consonant ambiguous blank");

    // 2026-07-23 tense-determinacy: an anchorless non-present finite-verb blank
    // is same-lexeme tense ambiguity, cured by anchor-or-present (not enumeration).
    expect(prompt).toContain("Tense-determinacy (cloze)");
    // 2026-07-30 — a habitual/iterative cue forbids the preterite but licenses
    // BOTH present and IMPERFECT, so an anchorless PRESENT answer under a
    // habitual cue is ALSO ambiguous (deja/dejaba); present is safe only with a
    // present anchor.
    expect(prompt).toContain("the imperfect fits identically");
    // 2026-08-11 polarity-determinacy: the superlative frame is symmetric, so a
    // lone `más`/`menos` correctAnswer with no evaluative anchor is ambiguous.
    expect(prompt).toContain("Polarity-determinacy (cloze)");
    expect(prompt).toContain("is SYMMETRIC and is NOT an anchor");
    // 2026-08-08 — multi-construction points: the grammarPointMatch clause
    // grew a sub-bullet clarifying that ANY construction described in the
    // point's description is on-target (see the dedicated describe block
    // below for the exact prose assertions).
    expect(VALIDATION_PROMPT_VERSION).toBe("validate@2026-08-17a");

    // R3.A — the three contextSpoilsAnswer triples added in task 8.
    expect(prompt).toContain("çocuk");
    expect(prompt).toContain("-da/-de");
    expect(prompt).toContain("Odada pencere");

    // R2.4 — the over-concentration soft signal added in task 10.
    expect(prompt).toContain("cell over-concentrated on plural suffix");

    // R2.6 — the grammarPointMatch sub-bullet uses the `correctAnswer: "da"`
    // outlier in `tr-a1-vowel-harmony` as the worked example.
    expect(prompt).toContain('correctAnswer: "da"');
    expect(prompt).toContain("tr-a1-vowel-harmony");
    expect(prompt).toContain("tr-a1-locative");
  });

  it("contextSpoilsAnswer covers glossEn, not just instructions/context (2026-08-13)", async () => {
    const prompt = await buildValidationSystemPrompt(baseSpec);
    // #639 rendered `glossEn` to the validator; the veto's own field list was
    // never extended, so the one production catch was the model generalising.
    expect(prompt).toContain(
      "does the draft's `instructions`, `context`, or `glossEn`",
    );
  });

  it("carries the neutral-gloss rule for lexical-choice points (2026-08-13)", async () => {
    const prompt = await buildValidationSystemPrompt(baseSpec);
    expect(prompt).toContain("Neutral-gloss rule");
    expect(prompt).toContain("saber");
    expect(prompt).toContain("know how to");
    // The anti-rejection guard: a neutral gloss must NOT be flagged ambiguous
    // when the L2 sentence forces the reading, or the generator's new output
    // gets rejected by the validator and the change nets to zero.
    expect(prompt).toContain("is NOT `ambiguous` when the L2 sentence forces");
  });

  it("template raw size stays within the NFR token budget (+44 % raw cap)", () => {
    // The NFR caps billed cost at +15 %, but the underlying raw-size
    // budget that produces that result with the existing ≥0.8 cache-hit
    // rate is +44 % (~415 tokens / ~1,680 bytes added to the original
    // 3,805-byte template). 5,500 was the original rounded ceiling.
    //
    // Task 4 (validator level-scope wiring) extended the template by adding
    // the {{levelScopeSection}} placeholder and rewriting the levelMatch
    // dimension (~570 bytes net). The ceiling is raised to 6,100 to
    // accommodate this intentional behavioural addition while still
    // guarding against unintentional future bloat.
    //
    // validate@2026-07-16 added the form-contrast exception and the
    // vocab_recall near-synonym escape valve to the `ambiguous` dimension
    // (~1,150 bytes, mirrors generate@2026-07-16). Ceiling raised to 7,500.
    //
    // validate@2026-07-22 added the sentence_construction carve-out to the
    // `ambiguous` dimension — scoping it to the PROMPT rather than the open
    // answer space, which pool-wide was false-flagging 81 % of SC drafts
    // `ambiguous` (~680 bytes). Ceiling raised to 8,500.
    //
    // validate@2026-07-23 added the Tense-determinacy (cloze) sub-bullet to
    // the `ambiguous` dimension — an anchorless non-present finite-verb
    // blank is same-lexeme tense ambiguity unless a temporal anchor forces
    // the past (~1.2KB, mirrors generate@2026-07-23). Ceiling raised to
    // 9,500.
    //
    // validate@2026-07-30 corrected the imperfect gap in that sub-bullet: a
    // habitual/iterative cue forbids the preterite but licenses BOTH present
    // and the IMPERFECT (past-habitual), so an anchorless PRESENT answer under
    // a habitual cue is ALSO `ambiguous` (deja/dejaba) — present is safe only
    // with a present anchor (~650 bytes, mirrors generate@2026-07-30). Ceiling
    // raised to 10,500.
    //
    // validate@2026-08-08 added a "Multi-construction points" sub-bullet to
    // the `grammarPointMatch` dimension: ANY construction described in the
    // grammar-point description is on-target, so the validator stops
    // re-collapsing generation's construction-variant fix by flagging
    // rarely-seen constructions as a mismatch (~400 bytes). Ceiling raised
    // to 11,000.
    //
    // validate@2026-08-11 added the Polarity-determinacy (cloze) sub-bullet to
    // the `ambiguous` dimension — the superlative frame is symmetric, so a
    // `más`/`menos` blank with no in-stem evaluative anchor is ambiguous in
    // EITHER direction, enumeration does not cure it (antonyms, not
    // alternants), and the adjective-swallowing / malformed-word-order
    // corollaries ride along (~1.6KB, mirrors generate@2026-08-11). Ceiling
    // raised to 13,000.
    //
    // validate@2026-08-12 added the Gloss consistency (cloze) sub-bullet to the
    // `ambiguous` dimension — when a draft carries `glossEn` (now rendered to
    // the validator), every `acceptableAnswers` entry must be true under that
    // gloss; an entry that changes the stated meaning is a defect, not an
    // alternant, curable by widening the gloss or dropping the entry, with a
    // carve-out where the point is a FORM and the alternates all realize it
    // (~1.0KB). Ceiling raised to 14,000.
    //
    // validate@2026-08-13 extended `contextSpoilsAnswer` to name `glossEn`
    // alongside `instructions`/`context` — #639 rendered the gloss to the
    // validator and added the gloss-consistency rule, but never extended the
    // spoil veto's own field list, so its one production catch was the model
    // generalising past the written rule. Also adds the Neutral-gloss rule
    // (cloze, lexical-choice points) mirroring the generator-side clause, with
    // the guard that a neutral gloss is not `ambiguous` when the L2 sentence
    // forces the reading (~0.5KB). Ceiling raised to 15,000.
    //
    // We assert on the TEMPLATE literal, not the rendered output, because:
    //   - The template is what Langfuse stores and what Anthropic's
    //     prompt-cache keys on byte-for-byte.
    //   - The rendered output is template + per-spec grammar-point content
    //     (descriptions, examples, common errors, CEFR descriptors) which
    //     varies by language/level and is not what the NFR budgets — those
    //     substitutions are already counted against the API per-call.
    // NOTE ON THIS CEILING: it has now been breached twice by CONCURRENT edits,
    // not by any single one. Two branches each add a rule and each raise the
    // ceiling just enough for their own addition, so the merge lands over both.
    // First merge: 14500 (candidateFillers) + 14000 (gloss rule) -> body 14,729.
    // Second merge: 16000 (this branch) + 15000 (main's #644) -> body 15,550.
    // Raised to 17000 (~1.4KB headroom) rather than the minimum that passes, so
    // the next concurrent pair does not re-trip it. The ceiling exists to catch
    // unbounded prompt growth, not to be re-tuned on every merge.
    expect(VALIDATION_SYSTEM_PROMPT_TEMPLATE.length).toBeLessThanOrEqual(17000);
  });

  it("instructs cloze validation to fill candidateFillers before deciding ambiguous", () => {
    expect(VALIDATION_SYSTEM_PROMPT_TEMPLATE).toContain(
      "fill `candidateFillers` before deciding this field",
    );
    expect(VALIDATION_SYSTEM_PROMPT_TEMPLATE).toContain(
      "quote the span of the visible sentence that forbids it",
    );
  });

  // Mirror of the generation-side DISTINCT-referent rule. Both halves must be
  // present or the contract splits: the generator would stop straddling while
  // the validator kept accepting straddled drafts that enumerate — the exact
  // behaviour observed on `der Schreibtisch`, flagged by the validator's own
  // judgement while its prompt text still said enumeration cures ambiguity.
  it("says enumeration cures only same-referent synonyms for vocab_recall", () => {
    const t = VALIDATION_SYSTEM_PROMPT_TEMPLATE;
    expect(t).toMatch(/Enumeration cures ONLY same-referent synonyms/);
    expect(t).toMatch(/Schreibtisch/);
    expect(t).toMatch(/Ebene/);
    // The instruction must name the remedy, otherwise the judge flags without
    // telling the generator what to change.
    expect(t).toMatch(/tighter definition/i);
  });

  it("pins the bumped validation prompt version", () => {
    expect(VALIDATION_PROMPT_VERSION).toBe("validate@2026-08-17a");
  });
});

// ---------------------------------------------------------------------------
// level scope in the validation prompt
// ---------------------------------------------------------------------------

describe("level scope in the validation prompt", () => {
  it("includes the at/below-level grammar scope for a grammar-anchored cell", async () => {
    const prompt = await buildValidationSystemPrompt(trClozeSpec);
    expect(prompt).toContain("Grammar in this learner's scope");
    expect(prompt).toContain(trA1ScopePoint.name);
  });

  it("rewords levelMatch to use the scope as ground truth, with the morphology carve-out", async () => {
    const prompt = await buildValidationSystemPrompt(trClozeSpec);
    expect(prompt).toContain("within or below the learner's scope");
    expect(prompt).toMatch(/never\s+"above level"/i);
    expect(prompt).toContain("not the target point");
  });

  it("omits the scope block for vocab_recall (gate)", async () => {
    const vocab = getGrammarPoint("tr-a1-vocab-food-drink");
    if (!vocab) throw new Error("test fixture missing: tr-a1-vocab-food-drink");
    const prompt = await buildValidationSystemPrompt({ ...trClozeSpec, exerciseType: ExerciseType.VOCAB_RECALL, grammarPoint: vocab, cefrLevel: CefrLevel.A1 });
    expect(prompt).not.toContain("Grammar in this learner's scope");
  });

});

// ---------------------------------------------------------------------------
// VALIDATION_SYSTEM_PROMPT_TEMPLATE byte parity (Phase 2, Task 12)
// ---------------------------------------------------------------------------

/**
 * Pins the contract: `applyTemplate(TEMPLATE, computeVars(spec)).text`
 * MUST equal `buildValidationSystemPrompt(spec)` byte-for-byte. The
 * pre-Phase-2 template used nested-path placeholders (`{{grammarPoint.
 * name}}`, `{{CEFR_DESCRIPTORS}}`) that the Mustache subset doesn't
 * resolve to anything; this block proves the rewritten flat-string
 * template is a true drop-in for the live builder before Task 13
 * routes both through `getPromptWithVarsOrFallback`.
 *
 * Why this matters: Anthropic's ephemeral prompt cache requires
 * byte-identical system blocks across validator calls within the
 * 5-min window. Drift between the template and the in-code builder
 * silently breaks the cache and inflates validation cost.
 */
describe("VALIDATION_SYSTEM_PROMPT_TEMPLATE byte parity", () => {
  async function assertParity(spec: GenerationSpec): Promise<void> {
    // Builder is now async (Phase-2, Task 13). Fallback path (Langfuse
    // keys unset in CI) returns the template-substituted string, so
    // byte parity vs. local `applyTemplate(TEMPLATE, vars)` still holds.
    const builderOutput = await buildValidationSystemPrompt(spec);
    const templateOutput = applyTemplate(
      VALIDATION_SYSTEM_PROMPT_TEMPLATE,
      computeValidationPromptVars(spec),
    );
    expect(templateOutput.missingVars).toEqual([]);
    expect(templateOutput.text).toBe(builderOutput);
  }

  it("ES / B1 / cloze / es-b1-present-subjunctive (base fixture)", async () => {
    await assertParity(baseSpec);
  });

  it("survives a different language + level combination (cache parity across specs)", async () => {
    // Turkish A1 vowel-harmony is in the live curriculum and uses a
    // distinct example/error vocabulary, exercising the
    // `positiveExamplesBullets`/`commonErrorsBullets` substitution paths
    // with content separate from the base fixture.
    const altGrammarPoint = getGrammarPoint("tr-a1-vowel-harmony");
    if (!altGrammarPoint) {
      throw new Error(
        "test fixture missing: curriculum entry 'tr-a1-vowel-harmony'",
      );
    }
    await assertParity({
      ...baseSpec,
      language: Language.TR,
      cefrLevel: CefrLevel.A1,
      grammarPoint: altGrammarPoint,
    });
  });
});

// ---------------------------------------------------------------------------
// buildValidationUserPrompt
// ---------------------------------------------------------------------------

describe("buildValidationUserPrompt", () => {
  it("renders a cloze draft with every documented field + Spec preamble", () => {
    const content: ClozeContent = {
      type: ExerciseType.CLOZE,
      instructions: "Fill in the blank with the present subjunctive.",
      sentence: "Espero que ___ a tiempo.",
      correctAnswer: "llegues",
      options: ["llegas", "llegues", "llegabas"],
      context: "Hopes and wishes",
    };
    const prompt = buildValidationUserPrompt(makeDraft(content), baseSpec);

    expect(prompt).toContain("Validate this Cloze exercise");
    expect(prompt).toContain(
      `**Spec:** language=${Language.ES}, cefrLevel=${CefrLevel.B1}, grammar point=${grammarPoint.key}`,
    );
    expect(prompt).toContain(
      "**Instructions:** Fill in the blank with the present subjunctive.",
    );
    expect(prompt).toContain("**Sentence:** Espero que ___ a tiempo.");
    expect(prompt).toContain("**Correct Answer:** llegues");
    expect(prompt).toContain("**Options:** llegas, llegues, llegabas");
    expect(prompt).toContain("**Context:** Hopes and wishes");
  });

  it("omits Options and Context lines for cloze drafts that lack them", () => {
    const content: ClozeContent = {
      type: ExerciseType.CLOZE,
      instructions: "x",
      sentence: "y ___ z",
      correctAnswer: "w",
    };
    const prompt = buildValidationUserPrompt(makeDraft(content), baseSpec);
    expect(prompt).not.toContain("**Options:**");
    expect(prompt).not.toContain("**Context:**");
  });

  it("adds the possessive-suffix scoring note ONLY for the tr-a1-possessive-suffixes cell", () => {
    const possessive = getGrammarPoint("tr-a1-possessive-suffixes");
    if (!possessive) throw new Error("tr-a1-possessive-suffixes missing from curriculum");
    const content: ClozeContent = {
      type: ExerciseType.CLOZE,
      instructions: "Fill in the blank with the correct possessive form.",
      sentence: "Onun ___ çok güzel. (araba)",
      correctAnswer: "arabası",
    };
    const possessiveSpec: GenerationSpec = {
      ...baseSpec,
      language: Language.TR,
      cefrLevel: CefrLevel.A1,
      grammarPoint: possessive,
    };

    const withNote = buildValidationUserPrompt(makeDraft(content), possessiveSpec);
    expect(withNote).toContain("Scoring note for this possessive-suffix");
    expect(withNote).toContain("INTENDED person-disambiguator");

    // The note is scoped: a different cloze cell must NOT receive it.
    const withoutNote = buildValidationUserPrompt(makeDraft(content), baseSpec);
    expect(withoutNote).not.toContain("Scoring note for this possessive-suffix");
  });

  it("adds the indefinite-compound head-only-blank note ONLY for the tr-a2-indefinite-compound cell", () => {
    const compound = getGrammarPoint("tr-a2-indefinite-compound");
    if (!compound) throw new Error("tr-a2-indefinite-compound missing from curriculum");
    const content: ClozeContent = {
      type: ExerciseType.CLOZE,
      instructions: "Fill in the blank with the correct compound head form.",
      sentence: "Çantamda bir müzik ___ var. (kaset)",
      correctAnswer: "kaseti",
    };
    const compoundSpec: GenerationSpec = {
      ...baseSpec,
      language: Language.TR,
      cefrLevel: CefrLevel.A2,
      grammarPoint: compound,
    };

    const withNote = buildValidationUserPrompt(makeDraft(content), compoundSpec);
    expect(withNote).toContain("indefinite-noun-compound");
    // Pins the generate↔validate contract: head-only blanking is BY DESIGN, not a mismatch.
    expect(withNote).toContain("ONLY the head noun is blanked");
    expect(withNote).toContain("Do NOT set grammarPointMatch=false");

    // The note is scoped: a different cloze cell must NOT receive it.
    const withoutNote = buildValidationUserPrompt(makeDraft(content), baseSpec);
    expect(withoutNote).not.toContain("indefinite-noun-compound");
  });

  it("renders a translation draft with every documented field + Spec preamble", () => {
    const content: TranslationContent = {
      type: ExerciseType.TRANSLATION,
      instructions: "Translate to Spanish.",
      sourceText: "I hope you arrive on time.",
      sourceLanguage: Language.EN,
      targetLanguage: Language.ES,
      referenceTranslation: "Espero que llegues a tiempo.",
    };
    const prompt = buildValidationUserPrompt(makeDraft(content), baseSpec);

    expect(prompt).toContain("Validate this Translation exercise");
    expect(prompt).toContain(
      `**Spec:** language=${Language.ES}, cefrLevel=${CefrLevel.B1}, grammar point=${grammarPoint.key}`,
    );
    expect(prompt).toContain("**Instructions:** Translate to Spanish.");
    expect(prompt).toContain(
      `**Source Text (${Language.EN}):** I hope you arrive on time.`,
    );
    expect(prompt).toContain(`**Target Language:** ${Language.ES}`);
    expect(prompt).toContain(
      "**Reference Translation:** Espero que llegues a tiempo.",
    );
    // With no acceptableAnswers, the validator is told the source must admit
    // only one structure (so structural alternatives can't be silently ignored).
    expect(prompt).toContain(
      "**Acceptable Answers (structurally-different renderings, also accepted):** (none declared",
    );
  });

  it("renders translation acceptableAnswers so enumeration can cure the ambiguous flag", () => {
    const content: TranslationContent = {
      type: ExerciseType.TRANSLATION,
      instructions: "Translate to Turkish.",
      sourceText: "In my opinion, this is right.",
      sourceLanguage: Language.EN,
      targetLanguage: Language.ES,
      referenceTranslation: "Bence bu doğru.",
      acceptableAnswers: ["Bana göre bu doğru."],
    };
    const prompt = buildValidationUserPrompt(makeDraft(content), baseSpec);

    expect(prompt).toContain(
      "**Acceptable Answers (structurally-different renderings, also accepted):** Bana göre bu doğru.",
    );
  });

  it("renders a vocab_recall draft with every documented field + Spec preamble", () => {
    const content: VocabRecallContent = {
      type: ExerciseType.VOCAB_RECALL,
      instructions: "Provide the Spanish word.",
      prompt: "The mood used after expressions of doubt or wish.",
      expectedWord: "subjuntivo",
      hints: ["Starts with 's'", "9 letters"],
      exampleSentence: "El subjuntivo es importante.",
    };
    const prompt = buildValidationUserPrompt(makeDraft(content), baseSpec);

    expect(prompt).toContain("Validate this Vocabulary Recall exercise");
    expect(prompt).toContain(
      `**Spec:** language=${Language.ES}, cefrLevel=${CefrLevel.B1}, grammar point=${grammarPoint.key}`,
    );
    expect(prompt).toContain("**Instructions:** Provide the Spanish word.");
    expect(prompt).toContain(
      "**Prompt:** The mood used after expressions of doubt or wish.",
    );
    expect(prompt).toContain("**Expected Word:** subjuntivo");
    expect(prompt).toContain("**Hints:** Starts with 's'; 9 letters");
    expect(prompt).toContain("**Example Sentence:** El subjuntivo es importante.");
  });

  it("is deterministic — same (draft, spec) returns identical bytes", () => {
    const content: ClozeContent = {
      type: ExerciseType.CLOZE,
      instructions: "x",
      sentence: "a ___ b",
      correctAnswer: "c",
    };
    const draft = makeDraft(content);
    const a = buildValidationUserPrompt(draft, baseSpec);
    const b = buildValidationUserPrompt(draft, baseSpec);
    expect(a).toBe(b);
  });

  it("builds a sentence-construction validation prompt naming the model answers", () => {
    const content: SentenceConstructionContent = {
      type: ExerciseType.SENTENCE_CONSTRUCTION,
      instructions: "Write one sentence in Spanish.",
      promptMode: "grammar_target",
      prompt: "Write a sentence using the present subjunctive to express a wish.",
      targetStructure: "present subjunctive",
      modelAnswers: ["Espero que vengas.", "Ojalá llueva."],
    };
    const spec = { ...baseSpec, exerciseType: ExerciseType.SENTENCE_CONSTRUCTION };
    const msg = buildValidationUserPrompt(makeDraft(content), spec);
    expect(msg).toContain("Validate this Sentence Construction exercise");
    expect(msg).toContain("present subjunctive");
    expect(msg).toContain("Espero que vengas.");
  });

  it("validation prompt for contextual_paraphrase checks meaning preservation + banned-term exclusion", () => {
    const content: ContextualParaphraseContent = {
      type: ExerciseType.CONTEXTUAL_PARAPHRASE,
      instructions: "Rewrite.",
      sourceText: "Me gusta el café.",
      constraintKind: "avoid",
      bannedTerms: ["gustar"],
      constraintLabel: "Say this without «gustar».",
      referenceParaphrases: ["Disfruto del café.", "Adoro el café."],
    };
    const spec = { ...baseSpec, exerciseType: ExerciseType.CONTEXTUAL_PARAPHRASE };
    const prompt = buildValidationUserPrompt(makeDraft(content), spec);
    expect(prompt).toMatch(/meaning/i);
    expect(prompt).toMatch(/gustar/);
  });
});

// ---------------------------------------------------------------------------
// self-revealing / vocab_recall scoring notes (Task 5)
// ---------------------------------------------------------------------------

describe("self-revealing / vocab_recall scoring notes", () => {
  const flaggedSpec: GenerationSpec = {
    ...baseSpec,
    grammarPoint: {
      ...baseSpec.grammarPoint,
      selfRevealingElicitation: "digit-form" as const,
      elicitationSeedValues: ["tercero"],
    },
  };

  const clozeContent: ClozeContent = {
    type: ExerciseType.CLOZE,
    instructions: "Fill in the blank with the correct ordinal form.",
    sentence: "Vivo en el 3.º piso.",
    correctAnswer: "tercer",
  };

  const translationContent: TranslationContent = {
    type: ExerciseType.TRANSLATION,
    instructions: "Translate to Spanish.",
    sourceText: "I live on the 3rd floor.",
    sourceLanguage: Language.EN,
    targetLanguage: Language.ES,
    referenceTranslation: "Vivo en el tercer piso.",
  };

  const vocabRecallContent: VocabRecallContent = {
    type: ExerciseType.VOCAB_RECALL,
    instructions: "Provide the Spanish word.",
    prompt: "The mood used after expressions of doubt or wish.",
    expectedWord: "subjuntivo",
    hints: ["Starts with 's'", "9 letters"],
    exampleSentence: "El subjuntivo es importante.",
  };

  it("cloze prompt for a flagged cell carries the digit-form exemption", () => {
    const prompt = buildValidationUserPrompt(makeDraft(clozeContent), flaggedSpec);
    expect(prompt).toContain("self-revealing-target");
    expect(prompt).toContain("do NOT set contextSpoilsAnswer=true");
  });

  it("translation prompt for a flagged cell carries the exemption", () => {
    const prompt = buildValidationUserPrompt(
      makeDraft(translationContent),
      flaggedSpec,
    );
    expect(prompt).toContain("self-revealing-target");
  });

  it("unflagged cloze prompt is unchanged", () => {
    const prompt = buildValidationUserPrompt(makeDraft(clozeContent), baseSpec);
    expect(prompt).not.toContain("self-revealing-target");
  });

  it("vocab_recall prompt for a vocab-kind point carries the meaning-vs-orthography note", () => {
    const vocabSpec: GenerationSpec = {
      ...baseSpec,
      grammarPoint: { ...baseSpec.grammarPoint, kind: "vocab" as const },
    };
    const prompt = buildValidationUserPrompt(makeDraft(vocabRecallContent), vocabSpec);
    expect(prompt).toContain("Scoring note for vocab_recall");
    expect(prompt).toContain("orthographic");
  });

  it("vocab_recall note relaxes grammarPointMatch for in-domain non-nouns only, leaving other dims explicitly unchanged", () => {
    const vocabSpec: GenerationSpec = {
      ...baseSpec,
      cefrLevel: CefrLevel.A1,
      grammarPoint: { ...baseSpec.grammarPoint, kind: "vocab" as const },
    };
    const prompt = buildValidationUserPrompt(makeDraft(vocabRecallContent), vocabSpec);
    // POS deference: a vocab umbrella is a semantic domain, not a part of speech.
    expect(prompt).toContain("a vocab umbrella is a SEMANTIC DOMAIN");
    expect(prompt).toContain("never merely because it is not a noun");
    // Surgical: every other dimension is explicitly left unchanged (no over-correction).
    expect(prompt).toContain(
      "Judge every other dimension (levelMatch, ambiguous, contextSpoilsAnswer, qualityScore) exactly as defined above, unchanged.",
    );
    // The note must NOT reintroduce the pro-approval framing that broke spoiler/level scoring.
    expect(prompt).not.toContain("pre-vetted");
    // Orthographic spoilage is confined to prompt/hints; a word in the example
    // sentence is not a spoiler (the UI masks it pre-submit).
    expect(prompt).toContain("orthographic reveals in the PROMPT or HINTS");
    expect(prompt).toContain(
      "the expected word appearing in the example sentence is NOT contextSpoilsAnswer",
    );
  });

  it("non-vocab point gets no vocab scoring note", () => {
    const prompt = buildValidationUserPrompt(makeDraft(vocabRecallContent), baseSpec);
    expect(prompt).not.toContain("Scoring note for vocab_recall");
    expect(prompt).not.toContain("a vocab umbrella is a SEMANTIC DOMAIN");
  });

  it("vocab_recall note carries the kinship side-disambiguation guidance (2026-07-17)", () => {
    // Mirror of the generation-side kinship rule: a side-neutral gloss on a
    // side-specific TR kin term (amca/dayı, hala/teyze) must be flagged
    // ambiguous, and a gloss naming a different relation is factually wrong.
    const vocabSpec: GenerationSpec = {
      ...baseSpec,
      grammarPoint: { ...baseSpec.grammarPoint, kind: "vocab" as const },
    };
    const prompt = buildValidationUserPrompt(makeDraft(vocabRecallContent), vocabSpec);
    expect(prompt).toContain("Kinship definitions for vocab_recall");
    expect(prompt).toContain("side-NEUTRAL gloss");
    // the wrong-relation guard: a cousin gloss for dayı, or teyze for hala
    expect(prompt).toContain("that is a cousin");
    expect(prompt).toContain("lower qualityScore below 0.5");
  });
});

describe("self-revealing base-word-cue scoring note", () => {
  const baseCueSpec: GenerationSpec = {
    ...baseSpec,
    grammarPoint: {
      ...baseSpec.grammarPoint,
      selfRevealingElicitation: "base-word-cue" as const,
      elicitationSeedValues: ["sillita"],
    },
  };

  const clozeContent: ClozeContent = {
    type: ExerciseType.CLOZE,
    instructions: "Fill in the blank with the appreciative form of the cued word.",
    sentence: "El bebé dormía en su ___. (silla)",
    correctAnswer: "sillita",
  };

  it("cloze prompt for a flagged cell exempts the base-word cue from contextSpoilsAnswer", () => {
    const prompt = buildValidationUserPrompt(makeDraft(clozeContent), baseCueSpec);
    expect(prompt).toContain("BASE-word cue");
    expect(prompt).toContain("do NOT set contextSpoilsAnswer=true");
    // The digit-form note must not leak into base-word-cue cells:
    expect(prompt).not.toContain("digit or numeral cue");
  });

  it("still demands spoilage when the derived form itself is visible", () => {
    const prompt = buildValidationUserPrompt(makeDraft(clozeContent), baseCueSpec);
    expect(prompt).toContain("derived form");
    expect(prompt).toContain("Still set contextSpoilsAnswer=true");
  });

  it("digit-form cells keep their own note, unchanged", () => {
    const digitSpec: GenerationSpec = {
      ...baseSpec,
      grammarPoint: {
        ...baseSpec.grammarPoint,
        selfRevealingElicitation: "digit-form" as const,
        elicitationSeedValues: ["tercero"],
      },
    };
    const prompt = buildValidationUserPrompt(makeDraft(clozeContent), digitSpec);
    expect(prompt).toContain("digit or numeral cue");
    expect(prompt).not.toContain("BASE-word cue");
  });
});

// ---------------------------------------------------------------------------
// buildValidationUserPrompt — coverage directive (Task 3)
// ---------------------------------------------------------------------------

function coverageGrammarPoint(coverageSpec?: CoverageSpec): GenerationSpec["grammarPoint"] {
  return {
    key: "tr-a1-test",
    kind: "grammar" as const,
    name: "Test point",
    description: "desc",
    cefr: CefrLevel.A1,
    cefrLevel: CefrLevel.A1 as GenerationSpec["grammarPoint"]["cefrLevel"],
    language: Language.TR as GenerationSpec["grammarPoint"]["language"],
    examplesPositive: [],
    examplesNegative: [],
    commonErrors: [],
    ...(coverageSpec ? { coverageSpec } : {}),
  };
}

function specFor(
  exerciseType: ExerciseType,
  coverageSpec?: CoverageSpec,
): GenerationSpec {
  return {
    language: Language.TR,
    cefrLevel: CefrLevel.A1,
    exerciseType,
    grammarPoint: coverageGrammarPoint(coverageSpec),
    topicDomain: null,
    count: 1,
    batchSeed: "test",
  };
}

const clozeDraftForCoverage: ExerciseDraft = {
  id: "00000000-0000-0000-0000-000000000001",
  contentJson: {
    type: ExerciseType.CLOZE,
    instructions: "Fill the blank",
    sentence: "Ben ___ (gitmek).",
    correctAnswer: "giderim",
  } as ClozeContent,
  metadata: {
    grammarPointKey: "tr-a1-test",
    topicDomain: null,
    modelId: "claude-sonnet-4-6",
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 0,
    inBatchDuplicate: false,
  },
};

const vocabDraftForCoverage: ExerciseDraft = {
  ...clozeDraftForCoverage,
  contentJson: {
    type: ExerciseType.VOCAB_RECALL,
    instructions: "Recall the word",
    prompt: "water",
    expectedWord: "su",
    hints: [],
    exampleSentence: "Su içiyorum.",
  } as VocabRecallContent,
};

describe("buildValidationUserPrompt — coverage directive", () => {
  it("grammar cloze without coverageSpec asks polarity + sentenceType, not person", () => {
    const p = buildValidationUserPrompt(clozeDraftForCoverage, specFor(ExerciseType.CLOZE));
    expect(p).toContain("polarity");
    expect(p).toContain("sentenceType");
    expect(p).not.toContain("grammatical person");
  });

  it("grammar cloze with person coverageSpec also asks person", () => {
    const personSpec: CoverageSpec = { axes: [{ name: "person", floors: { "3sg": 5 } }] };
    const p = buildValidationUserPrompt(clozeDraftForCoverage, specFor(ExerciseType.CLOZE, personSpec));
    expect(p).toContain("grammatical person");
    expect(p).toContain("polarity");
  });

  it("vocab_recall asks wordClass only", () => {
    const p = buildValidationUserPrompt(vocabDraftForCoverage, specFor(ExerciseType.VOCAB_RECALL));
    expect(p).toContain("part of speech");
    expect(p).not.toContain("polarity");
  });
});

// ---------------------------------------------------------------------------
// Conjugation validation prompt
// ---------------------------------------------------------------------------

describe("buildValidationUserPrompt — conjugation", () => {
  it("builds a conjugation validation prompt that asks to verify the form", () => {
    const conjugationDraft: ExerciseDraft = {
      ...clozeDraftForCoverage,
      contentJson: {
        type: ExerciseType.CONJUGATION,
        instructions: "Write the correct form.",
        lemma: "ir",
        lemmaGloss: "to go",
        featureBundle: "condicional · 1ª pers. plural",
        targetForm: "iríamos",
        breakdown: "ir- + -íamos",
        exampleSentences: ["Iríamos al cine."],
      } as ConjugationContent,
    };
    const conjugationSpec: GenerationSpec = {
      ...baseSpec,
      exerciseType: ExerciseType.CONJUGATION,
    };
    const prompt = buildValidationUserPrompt(conjugationDraft, conjugationSpec);
    expect(prompt).toContain("iríamos");
    expect(prompt).toContain("EXACTLY correct");
  });
});

// ---------------------------------------------------------------------------
// buildConjugationValidationUserPrompt — generalized check #2 (Task 5)
// ---------------------------------------------------------------------------

import { buildConjugationValidationUserPrompt } from "./validation-prompts.js";

const nominalContent = {
  type: ExerciseType.CONJUGATION,
  instructions: "Write the correct form.",
  lemma: "ev",
  lemmaGloss: "house",
  featureBundle: "bulunma · tekil",
  targetForm: "evde",
  breakdown: "ev + -de (locative)",
  exampleSentences: ["Ali evde."],
} as const;

const nominalSpec = {
  language: "TR",
  cefrLevel: "A1",
  grammarPoint: { key: "tr-a1-locative" },
} as never;

describe("buildConjugationValidationUserPrompt", () => {
  it("checks the grammar point's inflectional category generically", () => {
    const out = buildConjugationValidationUserPrompt(
      nominalContent as never,
      nominalSpec,
    );
    expect(out).toMatch(/inflectional category|case\/number/i);
    expect(out).toContain("evde");
  });

  // Regression: `breakdown` and `exampleSentences` are POST-ANSWER feedback —
  // `conjugation-exercise.tsx` renders both only inside `FeedbackShell`, gated
  // on `submission.kind === 'evaluated'`. The prompt used to label the
  // breakdown "Breakdown shown to the learner", and the judge then applied the
  // `contextSpoilsAnswer` hard veto to a field whose whole job is to spell out
  // the morphology. A 16-draft paired probe on
  // `de:a2:conjugation:de-a2-adjective-declension-zero` measured 9/16 spoiled
  // at baseline vs 1/16 once the judge was told the breakdown is post-answer.
  it("does not claim the breakdown is visible while the learner answers", () => {
    const out = buildConjugationValidationUserPrompt(
      nominalContent as never,
      nominalSpec,
    );
    expect(out).not.toContain("Breakdown shown to the learner");
  });

  it("tells the judge the breakdown and example sentences are post-answer", () => {
    const out = buildConjugationValidationUserPrompt(
      nominalContent as never,
      nominalSpec,
    );
    expect(out).toContain("Scoring note for conjugation");
    // Both fields must be named — the probe's isolation arms scored 1/16
    // (breakdown note) and 5/16 (examples note) against a 9/16 baseline.
    expect(out).toMatch(/post-answer/i);
    expect(out).toMatch(/breakdown/i);
    expect(out).toMatch(/example sentences/i);
    // The veto must stay live for the genuinely pre-answer fields.
    expect(out).toMatch(/instructions|feature bundle/i);
  });
});

// ---------------------------------------------------------------------------
// Dictation rejection guard
// ---------------------------------------------------------------------------

describe("buildValidationUserPrompt — dictation guard", () => {
  it("throws for a dictation draft (not validated via this path)", () => {
    const dictationDraft: ExerciseDraft = {
      ...clozeDraftForCoverage,
      contentJson: {
        type: ExerciseType.DICTATION,
        title: "Test clip",
        referenceText: "Hello world",
        sentences: ["Hello world"],
        accent: "EN neutral",
        voiceId: "Joanna",
        tested: ["listening"],
        durationSec: 3,
        waveform: [0.5, 0.5],
      } as import("@language-drill/shared").DictationContent,
    };
    expect(() =>
      buildValidationUserPrompt(dictationDraft, specFor(ExerciseType.DICTATION, false)),
    ).toThrow("Dictation exercises are not validated via this path");
  });
});

// ---------------------------------------------------------------------------
// Multi-construction grammarPointMatch guidance (Task 5)
// ---------------------------------------------------------------------------

describe("multi-construction grammarPointMatch guidance", () => {
  it("tells the validator that any construction in the description is on-target", () => {
    expect(VALIDATION_SYSTEM_PROMPT_TEMPLATE).toContain(
      'ANY construction described in the grammar-point description is on-target',
    );
  });

  it("names the failure mode it is preventing", () => {
    expect(VALIDATION_SYSTEM_PROMPT_TEMPLATE).toContain(
      'not merely because it is not the point’s most common pattern',
    );
  });

  it("bumps the prompt version to today", () => {
    expect(VALIDATION_PROMPT_VERSION).toBe("validate@2026-08-17a");
  });
});

// ---------------------------------------------------------------------------
// Meaning gloss visibility (Task 2)
// ---------------------------------------------------------------------------

// The validator could not see `glossEn` either, which is how a row glossed
// "The park is near the school." shipped declaring the antonym "lejos" an
// acceptable answer: the contradiction was invisible at validation time.
describe("cloze validation prompt — meaning gloss", () => {
  it("renders the gloss so the validator can check it against acceptableAnswers", () => {
    const content: ClozeContent = {
      type: ExerciseType.CLOZE,
      instructions: "Fill in the blank with the correct compound preposition.",
      sentence: "El parque está ___ del colegio.",
      correctAnswer: "cerca",
      acceptableAnswers: ["lejos"],
      glossEn: "The park is near the school.",
    };
    const out = buildValidationUserPrompt(makeDraft(content), baseSpec);
    expect(out).toContain(
      "**Meaning (shown to the learner):** The park is near the school.",
    );
    expect(out).toContain("**Acceptable Answers (also accepted):** lejos");
  });

  it("omits the Meaning line for an unglossed draft", () => {
    const content: ClozeContent = {
      type: ExerciseType.CLOZE,
      instructions: "Fill in the blank.",
      sentence: "El portero no ___ entrar.",
      correctAnswer: "dejó",
    };
    const out = buildValidationUserPrompt(makeDraft(content), baseSpec);
    expect(out).not.toContain("**Meaning");
  });
});

describe("validation template — gloss consistency rule", () => {
  it("tells the validator a gloss-contradicting acceptableAnswer is ambiguous, with both cures", () => {
    expect(VALIDATION_SYSTEM_PROMPT_TEMPLATE).toContain("Gloss consistency (cloze)");
    expect(VALIDATION_SYSTEM_PROMPT_TEMPLATE).toMatch(/true \*under that gloss\*/);
    // Both cures must be stated, or the validator flags without a fix path.
    expect(VALIDATION_SYSTEM_PROMPT_TEMPLATE).toContain("widen the gloss");
    expect(VALIDATION_SYSTEM_PROMPT_TEMPLATE).toContain("I want/can walk");
    // The form-vs-lexeme carve-out keeps de-a1-zero-article legitimate.
    expect(VALIDATION_SYSTEM_PROMPT_TEMPLATE).toMatch(/zero article before a profession/);
  });
});
