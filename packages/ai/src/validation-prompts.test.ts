import { describe, it, expect } from "vitest";
import {
  CefrLevel,
  type ExerciseContent,
  ExerciseType,
  Language,
  type ClozeContent,
  type ConjugationContent,
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
    // We assert on the TEMPLATE literal, not the rendered output, because:
    //   - The template is what Langfuse stores and what Anthropic's
    //     prompt-cache keys on byte-for-byte.
    //   - The rendered output is template + per-spec grammar-point content
    //     (descriptions, examples, common errors, CEFR descriptors) which
    //     varies by language/level and is not what the NFR budgets — those
    //     substitutions are already counted against the API per-call.
    expect(VALIDATION_SYSTEM_PROMPT_TEMPLATE.length).toBeLessThanOrEqual(6100);
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
