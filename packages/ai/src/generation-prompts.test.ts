import { describe, it, expect } from "vitest";
import {
  CefrLevel,
  ExerciseType,
  Language,
  type ClozeContent,
  type DictationContent,
  type TranslationContent,
  type VocabRecallContent,
} from "@language-drill/shared";
// SentenceConstructionContent is used implicitly via ExerciseType.SENTENCE_CONSTRUCTION
import { getGrammarPoint } from "@language-drill/db";

import { CEFR_LEVEL_DESCRIPTORS, EVALUATION_SYSTEM_PROMPT } from "./prompts.js";
import {
  GENERATION_PROMPT_VERSION,
  GENERATION_SYSTEM_PROMPT_TEMPLATE,
  MAX_PRIOR_POOL_SURFACES_IN_PROMPT,
  MAX_RECENT_STEMS_IN_PROMPT,
  buildGenerationSystemPrompt,
  buildGenerationUserPrompt,
  PERSON_ROTATION_BY_LANGUAGE,
  personForOrdinal,
  personRotationPhase,
  canonicalSurface,
  capPriorPoolSurfaces,
  computeGenerationPromptVars,
  sentenceConstructionModeForOrdinal,
  tailRecentStems,
  type GenerationPromptInputs,
} from "./generation-prompts.js";
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

const baseInputs: GenerationPromptInputs = {
  language: Language.ES,
  cefrLevel: CefrLevel.B1,
  exerciseType: ExerciseType.CLOZE,
  grammarPoint,
};

// ---------------------------------------------------------------------------
// buildGenerationSystemPrompt
// ---------------------------------------------------------------------------

describe("buildGenerationSystemPrompt", () => {
  it("is deterministic — same (inputs, recentStems) returns identical bytes", async () => {
    // Async since Phase-2: must await both before comparing, otherwise
    // `toBe` compares two distinct Promise references and trivially fails
    // (or worse, silently passes for `toEqual`). `Promise.all` lets one
    // failure short-circuit while keeping both calls scheduled.
    const [a, b] = await Promise.all([
      buildGenerationSystemPrompt(baseInputs, ["stem one", "stem two"]),
      buildGenerationSystemPrompt(baseInputs, ["stem one", "stem two"]),
    ]);
    expect(a).toBe(b);
  });

  it("renders '(none yet)' when recentStems is empty", async () => {
    const prompt = await buildGenerationSystemPrompt(baseInputs, []);
    expect(prompt).toContain("(none yet)");
  });

  it("renders one bullet per stem when recentStems is non-empty", async () => {
    const stems = ["primera frase", "segunda frase", "tercera frase"];
    const prompt = await buildGenerationSystemPrompt(baseInputs, stems);
    for (const stem of stems) {
      expect(prompt).toContain(`- ${stem}`);
    }
    expect(prompt).not.toContain("(none yet)");
  });

  it("inlines the grammar-point name, description, examples, and common errors verbatim", async () => {
    const prompt = await buildGenerationSystemPrompt(baseInputs, []);
    expect(prompt).toContain(grammarPoint.name);
    expect(prompt).toContain(grammarPoint.description);
    for (const example of grammarPoint.examplesPositive) {
      expect(prompt).toContain(example);
    }
    for (const example of grammarPoint.examplesNegative) {
      expect(prompt).toContain(example);
    }
    for (const error of grammarPoint.commonErrors) {
      expect(prompt).toContain(error);
    }
  });

  it("interpolates the language and CEFR level into the header and constraints", async () => {
    const prompt = await buildGenerationSystemPrompt(baseInputs, []);
    expect(prompt).toContain("ES learners at CEFR B1");
    expect(prompt).toContain(
      "every content word MUST be high-frequency everyday vocabulary at or below CEFR B1",
    );
  });

  it("forbids ambiguous blanks and spoiling context", async () => {
    // Regression: two production bugs from the Turkish A1 pool.
    //   - "Sınıfta sekiz ___ var" (chair/student/book all fit) → must require
    //     either narrower sentence framing or `acceptableAnswers`.
    //   - "Vowel harmony: front vowel (e) requires -ler suffix" above
    //     "Odada pencere___" → context literally states the answer.
    const prompt = await buildGenerationSystemPrompt(baseInputs, []);
    expect(prompt).toContain("Ambiguous blank");
    expect(prompt).toContain("acceptableAnswers");
    expect(prompt).toContain("Spoiled blank");
    // The two failure exemplars must appear verbatim so Claude reads them as
    // concrete pattern-match anchors, not paraphrased advice.
    expect(prompt).toContain("Sınıfta sekiz ___ var");
    expect(prompt).toContain("Vowel harmony: front vowel (e) requires -ler suffix");
  });

  it("pins the R2.3 / R3.B.7 hard-constraint bullets added in cluster B", async () => {
    // Independent rules that all live under "Hard constraints" and
    // were added together. Pin each so a future edit can't silently drop
    // one while preserving the others.
    const prompt = await buildGenerationSystemPrompt(baseInputs, []);

    // (a) R2.3 — vowel-harmony cell-level coverage rule. The prompt must
    // both name "vowel harmony" AND carry a recognizable substring of the
    // diversity constraint (covering both 2-way and 4-way patterns; capping
    // plural-suffix blanks at 50% of the batch).
    expect(prompt).toContain("tr-a1-vowel-harmony");
    expect(prompt).toContain("BOTH 2-way");
    expect(prompt).toContain("4-way");
    expect(prompt).toContain("at least three of the four high-vowel slots");
    expect(prompt).toContain("more than 50% of the batch");

    // (b) The R7.1 buffer-consonant ambiguity rule was removed by the
    // whole-word "Blank granularity" rule (R1.4) — whole-word blanks make
    // the buffer boundary moot. The buffer-absent + whole-word-present
    // assertions live in the dedicated Phase-2 cluster test below.

    // (c) R3.B.7 — unique-answer reiteration for grammar-shape clozes.
    // Must include the new "Evde yeni" exemplar and the explicit
    // "either constrain ... OR list every plausible lexeme in
    // acceptableAnswers" wording.
    expect(prompt).toContain("Evde yeni ___ var");
    expect(prompt).toContain("Either constrain the sentence");
    expect(prompt).toContain("list every plausible lexeme in `acceptableAnswers`");
  });

  it("pins the Phase-2 prompt cluster: whole-word blanks (R1), TR case gloss (R2), anti-leak/on-target (R7)", async () => {
    // The R1/R2/R7 generation-prompt edit landed as one coordinated cluster
    // (tasks 4–6, single version bump in task 7). Pin every limb so a later
    // edit can't silently drop one — and guard the deleted buffer-consonant
    // rule against reintroduction.
    const prompt = await buildGenerationSystemPrompt(baseInputs, []);

    // R1.1 / R1.3 — universal whole-word "Blank granularity" rule, with the
    // per-language mutation exemplars as concrete pattern anchors.
    expect(prompt).toContain("Blank granularity");
    expect(prompt).toContain("WHOLE inflected word");
    expect(prompt).toContain("kahveyi"); // TR consonant softening / buffer
    expect(prompt).toContain("kitabı"); // TR
    expect(prompt).toContain("vuelven"); // ES stem-change
    expect(prompt).toContain("busqué"); // ES orthographic shift
    expect(prompt).toContain("fährt"); // DE umlaut

    // R1.4 — the superseded buffer-consonant ambiguity rule is gone (whole-word
    // blanks make the buffer boundary moot). Both its heading and its unique
    // "buffer-included" wording must be absent.
    expect(prompt).not.toContain("Buffer-consonant ambiguity");
    expect(prompt).not.toContain("buffer-included");

    // R2.1 / R2.3 / R2.4 — TR case clozes: generic instruction, optional L1
    // gloss as the disambiguation device, level-gated (omitted for B1+).
    expect(prompt).toContain("correct form of the word in parentheses");
    expect(prompt).toContain("glossEn");
    expect(prompt).toContain("omit it for");

    // R7.1 / R7.2 / R7.3 — generator-side anti-leak, stay-on-target, single-fill.
    expect(prompt).toContain("anti-leak");
    expect(prompt).toContain("Stay on target");
    expect(prompt).toContain("One correct fill, or enumerate them");
  });

  it("pins the Turkish personal/copular-suffix cloze rule (lemma hint, person + animacy)", async () => {
    // Grammar-point-specific rule for tr-a1-personal-suffixes: the cell that
    // rejected 12/17 drafts on `low quality`. Lemma-only hint (not the
    // inflected answer), 3sg Ø is valid, 3pl -lAr is human-only / otherwise
    // enumerated in acceptableAnswers, and -DIr is the wrong default.
    const prompt = await buildGenerationSystemPrompt(baseInputs, []);

    expect(prompt).toContain("personal/copular-suffix clozes");
    expect(prompt).toContain(
      "citation (dictionary) form, NEVER the inflected answer",
    );
    expect(prompt).toContain("(tamirci)"); // lemma hint…
    expect(prompt).toContain("never `(tamirciyim)`"); // …not the inflected answer
    expect(prompt).toContain("3sg takes Ø");
    expect(prompt).toContain("3pl -lAr is optional and HUMAN-only");
    expect(prompt).toContain("acceptableAnswers"); // human-3pl enumeration
  });

  it("carries a bumped, correctly-formatted GENERATION_PROMPT_VERSION", () => {
    // R1.7 / R2.6 / R7.4 — the coordinated prompt edit must ship a
    // `generate@YYYY-MM-DD` version so Langfuse cohorts old vs new traces.
    expect(GENERATION_PROMPT_VERSION).toMatch(/^generate@\d{4}-\d{2}-\d{2}$/);
    // Bumped 2026-06-12 for two same-day edits sharing the cohort: the
    // possessive-suffix cloze diversity tweak in the system template (rotate
    // persons, prefer vowel-final stems) and the curriculum-wide grammatical-
    // person rotation in the per-draft user prompt (pool audit: TR tense
    // cells were ≥90% 3sg). Prior 2026-06-07 cohort covered the vocab_recall
    // hints anti-leak rule + the possessive-pronoun bullet.
    expect(GENERATION_PROMPT_VERSION).toBe("generate@2026-06-12");
    // Tasks 7–9: pin the new guardrail phrases in the cached template prefix.
    expect(GENERATION_SYSTEM_PROMPT_TEMPLATE).toContain(
      "every content word MUST be high-frequency everyday vocabulary at or below CEFR {{cefrLevel}}",
    );
    expect(GENERATION_SYSTEM_PROMPT_TEMPLATE).toContain("Safe, neutral topics");
    expect(GENERATION_SYSTEM_PROMPT_TEMPLATE).toContain("dalgayı");
    // vocab_recall hints anti-leak rule.
    expect(GENERATION_SYSTEM_PROMPT_TEMPLATE).toContain(
      "vocab_recall hints MUST NOT reveal the target word",
    );
  });

  it("adds the sentence-construction section ONLY for sentence_construction, with the anti-open / model-answer / per-mode rules", async () => {
    // 2026-06-07 fix for the first production SC run: open `grammar_target`
    // prompts (ambiguous), model answers propagating commonErrors, spoiled
    // instructions. The section must (a) appear for SC, (b) carry each of the
    // three guardrails, and (c) be absent for every other type so their cache
    // prefix / Langfuse cohort is unchanged.
    const sc = await buildGenerationSystemPrompt(
      { ...baseInputs, exerciseType: ExerciseType.SENTENCE_CONSTRUCTION },
      [],
    );
    expect(sc).toContain("## Sentence-construction specifics");
    expect(sc).toContain('no open "write a sentence using X"');
    expect(sc).toContain("Model answers must be correct, natural, and error-free");
    expect(sc).toContain("MUST NOT exhibit any of the **Common learner errors**");
    expect(sc).toContain("Do not spoil the answer");
    // grammar_target — the worst-performing mode — must be told to anchor to a
    // scenario, not ship the structure label alone.
    expect(sc).toContain("`grammar_target`");
    expect(sc).toContain("structure label alone is NOT enough");
    // The grammar-point name is baked in (it is itself one flat template var).
    expect(sc).toContain(grammarPoint.name);

    // Absent for the other three types.
    for (const type of [
      ExerciseType.CLOZE,
      ExerciseType.TRANSLATION,
      ExerciseType.VOCAB_RECALL,
    ]) {
      const other = await buildGenerationSystemPrompt(
        { ...baseInputs, exerciseType: type },
        [],
      );
      expect(other).not.toContain("## Sentence-construction specifics");
    }
  });

  it("instructs Claude to use the matching tool name", async () => {
    const cloze = await buildGenerationSystemPrompt(baseInputs, []);
    expect(cloze).toContain("submit_cloze_exercise");

    const translation = await buildGenerationSystemPrompt(
      { ...baseInputs, exerciseType: ExerciseType.TRANSLATION },
      [],
    );
    expect(translation).toContain("submit_translation_exercise");

    const vocab = await buildGenerationSystemPrompt(
      { ...baseInputs, exerciseType: ExerciseType.VOCAB_RECALL },
      [],
    );
    expect(vocab).toContain("submit_vocab_recall_exercise");
  });

  it("shares CEFR descriptors with EVALUATION_SYSTEM_PROMPT (DRY invariant)", async () => {
    const b1Descriptor = CEFR_LEVEL_DESCRIPTORS[CefrLevel.B1];
    const generatorPrompt = await buildGenerationSystemPrompt(baseInputs, []);
    expect(generatorPrompt).toContain(b1Descriptor);
    expect(EVALUATION_SYSTEM_PROMPT).toContain(b1Descriptor);
  });

  it("truncates recentStems beyond MAX_RECENT_STEMS_IN_PROMPT", async () => {
    const stems = Array.from({ length: 32 }, (_, i) => `stem-${i}`);
    const prompt = await buildGenerationSystemPrompt(baseInputs, stems);
    // First two should be dropped (LRU keeps the tail of 30).
    expect(prompt).not.toContain("stem-0\n");
    expect(prompt).not.toContain("stem-1\n");
    // Last 30 should survive.
    expect(prompt).toContain("stem-2");
    expect(prompt).toContain("stem-31");
  });

  it("omits the 'Already in the pool' section when priorPoolSurfaces is undefined", async () => {
    const prompt = await buildGenerationSystemPrompt(baseInputs, []);
    expect(prompt).not.toContain("Already in the pool");
  });

  it("omits the 'Already in the pool' section when priorPoolSurfaces is empty", async () => {
    const prompt = await buildGenerationSystemPrompt(
      { ...baseInputs, priorPoolSurfaces: [] },
      [],
    );
    expect(prompt).not.toContain("Already in the pool");
  });

  it("uses vocab-specific wording for VOCAB_RECALL and renders each prior word", async () => {
    const priors = ["kahvaltı", "ekmek", "araba"];
    const prompt = await buildGenerationSystemPrompt(
      {
        ...baseInputs,
        exerciseType: ExerciseType.VOCAB_RECALL,
        priorPoolSurfaces: priors,
      },
      [],
    );
    expect(prompt).toContain(
      "## Already in the pool — do NOT propose any of these target words",
    );
    for (const word of priors) {
      expect(prompt).toContain(`- ${word}`);
    }
  });

  it("uses sentence-surface wording for non-VOCAB_RECALL types", async () => {
    const prompt = await buildGenerationSystemPrompt(
      {
        ...baseInputs,
        exerciseType: ExerciseType.CLOZE,
        priorPoolSurfaces: ["yo hablo espanol."],
      },
      [],
    );
    expect(prompt).toContain(
      "## Already in the pool — do NOT propose any exercise whose surface matches these",
    );
    expect(prompt).toContain("- yo hablo espanol.");
  });

  it("caps priorPoolSurfaces at MAX_PRIOR_POOL_SURFACES_IN_PROMPT", async () => {
    const priors = Array.from(
      { length: MAX_PRIOR_POOL_SURFACES_IN_PROMPT + 5 },
      (_, i) => `word-${i}`,
    );
    const prompt = await buildGenerationSystemPrompt(
      {
        ...baseInputs,
        exerciseType: ExerciseType.VOCAB_RECALL,
        priorPoolSurfaces: priors,
      },
      [],
    );
    // First MAX entries kept, tail dropped (deterministic order so cache
    // prefix is stable across ordinals).
    expect(prompt).toContain(`- word-0`);
    expect(prompt).toContain(`- word-${MAX_PRIOR_POOL_SURFACES_IN_PROMPT - 1}`);
    expect(prompt).not.toContain(
      `- word-${MAX_PRIOR_POOL_SURFACES_IN_PROMPT}\n`,
    );
  });

  it("is deterministic when priorPoolSurfaces is supplied (cache invariant)", async () => {
    const inputs: GenerationPromptInputs = {
      ...baseInputs,
      exerciseType: ExerciseType.VOCAB_RECALL,
      priorPoolSurfaces: ["a", "b", "c"],
    };
    const [a, b] = await Promise.all([
      buildGenerationSystemPrompt(inputs, ["x"]),
      buildGenerationSystemPrompt(inputs, ["x"]),
    ]);
    expect(a).toBe(b);
  });
});

// ---------------------------------------------------------------------------
// GENERATION_SYSTEM_PROMPT_TEMPLATE byte parity (Phase 2, Task 9)
// ---------------------------------------------------------------------------

/**
 * Pins the contract: `applyTemplate(TEMPLATE, computeVars(...)).text`
 * MUST equal `buildGenerationSystemPrompt(...)` byte-for-byte across
 * representative input shapes (with priorPoolSurfaces, without; empty
 * recentStems, populated recentStems; every exercise type). Any drift
 * between the template and the live builder is caught here BEFORE
 * Task 10 routes both through `getPromptWithVarsOrFallback`.
 *
 * Why this matters: Anthropic's ephemeral prompt cache requires
 * byte-identical system blocks across calls within the 5-min window.
 * If the template and the in-code builder diverge, the same `(inputs,
 * recentStems)` pair could yield two different strings depending on
 * which code path runs — silently breaking the cache and inflating
 * generation cost.
 */
describe("GENERATION_SYSTEM_PROMPT_TEMPLATE byte parity", () => {
  async function assertParity(
    inputs: GenerationPromptInputs,
    recentStems: readonly string[],
  ): Promise<void> {
    // Builder is now async (Phase-2). The fallback path returns the
    // template-substituted string, so the test runs the same in
    // CI (LANGFUSE_PUBLIC_KEY unset → fallback substitution path).
    const builderOutput = await buildGenerationSystemPrompt(inputs, recentStems);
    const templateOutput = applyTemplate(
      GENERATION_SYSTEM_PROMPT_TEMPLATE,
      computeGenerationPromptVars(inputs, recentStems),
    );
    expect(templateOutput.missingVars).toEqual([]);
    expect(templateOutput.text).toBe(builderOutput);
  }

  it("cloze, no priorPoolSurfaces, with recentStems", async () => {
    await assertParity(baseInputs, ["primera frase", "segunda frase"]);
  });

  it("cloze, no priorPoolSurfaces, empty recentStems", async () => {
    // The '(none yet)' branch in renderRecentStems must survive
    // round-tripping through the template.
    await assertParity(baseInputs, []);
  });

  it("translation, with mid-sized priorPoolSurfaces", async () => {
    await assertParity(
      {
        ...baseInputs,
        exerciseType: ExerciseType.TRANSLATION,
        priorPoolSurfaces: ["yo hablo espanol.", "ella va a la tienda."],
      },
      ["uno", "dos", "tres"],
    );
  });

  it("vocab_recall, with priorPoolSurfaces (uses the vocab-specific heading)", async () => {
    await assertParity(
      {
        ...baseInputs,
        exerciseType: ExerciseType.VOCAB_RECALL,
        priorPoolSurfaces: ["kahvaltı", "ekmek", "araba"],
      },
      [],
    );
  });

  it("vocab_recall, no priorPoolSurfaces (the section is omitted entirely)", async () => {
    // Exercises the renderPriorPoolSection-returns-empty path AND the
    // immediate `## Hard constraints` follow-up (no blank line before).
    await assertParity(
      { ...baseInputs, exerciseType: ExerciseType.VOCAB_RECALL },
      ["one stem"],
    );
  });

  it("sentence_construction (the SC-specific section is spliced before ## Output)", async () => {
    // Locks byte parity through the non-empty `{{sentenceConstructionSection}}`
    // branch so the template and the in-code builder cannot diverge on SC cells.
    await assertParity(
      { ...baseInputs, exerciseType: ExerciseType.SENTENCE_CONSTRUCTION },
      ["primera frase"],
    );
  });
});

// ---------------------------------------------------------------------------
// capPriorPoolSurfaces
// ---------------------------------------------------------------------------

describe("capPriorPoolSurfaces", () => {
  it("returns the input unchanged when within the cap", () => {
    const surfaces = ["a", "b", "c"];
    expect(capPriorPoolSurfaces(surfaces)).toEqual(surfaces);
  });

  it("returns the first MAX_PRIOR_POOL_SURFACES_IN_PROMPT entries when oversized", () => {
    const surfaces = Array.from(
      { length: MAX_PRIOR_POOL_SURFACES_IN_PROMPT + 10 },
      (_, i) => `w${i}`,
    );
    const capped = capPriorPoolSurfaces(surfaces);
    expect(capped).toHaveLength(MAX_PRIOR_POOL_SURFACES_IN_PROMPT);
    expect(capped[0]).toBe("w0");
    expect(capped[capped.length - 1]).toBe(
      `w${MAX_PRIOR_POOL_SURFACES_IN_PROMPT - 1}`,
    );
  });

  it("returns an empty array when input is empty", () => {
    expect(capPriorPoolSurfaces([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// buildGenerationUserPrompt
// ---------------------------------------------------------------------------

describe("buildGenerationUserPrompt", () => {
  it("renders 'mixed' when topicDomain is null", () => {
    const prompt = buildGenerationUserPrompt(baseInputs, 0, null);
    expect(prompt).toContain("Topic domain: mixed");
  });

  it("renders the supplied topicDomain", () => {
    const prompt = buildGenerationUserPrompt(baseInputs, 0, "travel");
    expect(prompt).toContain("Topic domain: travel");
  });

  it("displays the ordinal as 1-indexed", () => {
    expect(buildGenerationUserPrompt(baseInputs, 0, null)).toContain(
      "Produce exercise #1.",
    );
    expect(buildGenerationUserPrompt(baseInputs, 49, null)).toContain(
      "Produce exercise #50.",
    );
  });

  it("names the matching tool", () => {
    expect(
      buildGenerationUserPrompt(baseInputs, 0, null),
    ).toContain("submit_cloze_exercise");
    expect(
      buildGenerationUserPrompt(
        { ...baseInputs, exerciseType: ExerciseType.TRANSLATION },
        0,
        null,
      ),
    ).toContain("submit_translation_exercise");
  });

  it("appends the loose seed instruction only when a seed is supplied (R5.5)", () => {
    const seeded = buildGenerationUserPrompt(baseInputs, 0, null, "viajar");
    expect(seeded).toContain('Build this exercise around the word "viajar".');
    // Loose: names the grammar point and offers a similar-frequency substitute.
    expect(seeded).toContain(baseInputs.grammarPoint.name);
    expect(seeded).toContain("a related content word of similar frequency");
  });

  it("omits the seed line — byte-identical to the unseeded output — when seed is null/absent", () => {
    const unseededArg = buildGenerationUserPrompt(baseInputs, 0, null, null);
    const noArg = buildGenerationUserPrompt(baseInputs, 0, null);
    expect(unseededArg).toBe(noArg); // back-compat: existing 3-arg callers unaffected
    expect(unseededArg).not.toContain("Build this exercise around");
  });

  it("treats an empty-string seed as unseeded", () => {
    expect(buildGenerationUserPrompt(baseInputs, 0, null, "")).toBe(
      buildGenerationUserPrompt(baseInputs, 0, null),
    );
  });

  it("never leaks the seed into the cached system prompt (R5.4 cache-prefix invariant)", async () => {
    // The seed lives ONLY in the per-draft user prompt; the system prompt
    // builder takes no seed and must stay byte-identical across the batch.
    const system = await buildGenerationSystemPrompt(baseInputs, []);
    expect(system).not.toContain("viajar");
    expect(system).not.toContain("Build this exercise around");
  });
});

// ---------------------------------------------------------------------------
// canonicalSurface
// ---------------------------------------------------------------------------

describe("canonicalSurface", () => {
  it("lowercases and strips diacritics from a cloze sentence", () => {
    const content: ClozeContent = {
      type: ExerciseType.CLOZE,
      instructions: "x",
      sentence: "Yo HABLO españól.",
      correctAnswer: "x",
    };
    expect(canonicalSurface(content)).toBe("yo hablo espanol.");
  });

  it("uses sourceText for translation content", () => {
    const content: TranslationContent = {
      type: ExerciseType.TRANSLATION,
      instructions: "x",
      sourceText: "The Cat is on the Mat.",
      sourceLanguage: Language.EN,
      targetLanguage: Language.ES,
      referenceTranslation: "El gato está sobre la alfombra.",
    };
    expect(canonicalSurface(content)).toBe("the cat is on the mat.");
  });

  it("combines expectedWord and prompt cue for vocab content", () => {
    const content: VocabRecallContent = {
      type: ExerciseType.VOCAB_RECALL,
      instructions: "x",
      prompt: "What is the Spanish for 'subjunctive'?",
      expectedWord: "Subjuntivo",
      hints: [],
      exampleSentence: "x",
    };
    expect(canonicalSurface(content)).toBe(
      "subjuntivo::what is the spanish for 'subjunctive'?",
    );
  });

  it("yields a different key for the same word with a different cue", () => {
    const base: VocabRecallContent = {
      type: ExerciseType.VOCAB_RECALL,
      instructions: "x",
      prompt: "Translate: to return",
      expectedWord: "volver",
      hints: [],
      exampleSentence: "x",
    };
    const otherCue: VocabRecallContent = { ...base, prompt: "Antonym of 'ir'" };
    expect(canonicalSurface(base)).not.toBe(canonicalSurface(otherCue));
  });

  it("yields the same key for an identical (word, cue) pair", () => {
    const base: VocabRecallContent = {
      type: ExerciseType.VOCAB_RECALL,
      instructions: "x",
      prompt: "Translate: to RETURN",
      expectedWord: "Volver",
      hints: [],
      exampleSentence: "first example sentence",
    };
    // Differs only on hint-level fields (case, exampleSentence) — collapses to
    // the same key, so it is blocked as an exact duplicate.
    const dup: VocabRecallContent = {
      ...base,
      expectedWord: "volver",
      prompt: "translate: to return",
      exampleSentence: "a different example sentence",
    };
    expect(canonicalSurface(base)).toBe(canonicalSurface(dup));
  });

  it("collapses internal whitespace runs to a single space", () => {
    const content: ClozeContent = {
      type: ExerciseType.CLOZE,
      instructions: "x",
      sentence: "Yo  HABLO   españól.",
      correctAnswer: "x",
    };
    expect(canonicalSurface(content)).toBe("yo hablo espanol.");
  });

  it("trims leading and trailing whitespace", () => {
    const content: ClozeContent = {
      type: ExerciseType.CLOZE,
      instructions: "x",
      sentence: "  espero que llegues a tiempo.  ",
      correctAnswer: "llegues",
    };
    expect(canonicalSurface(content)).toBe("espero que llegues a tiempo.");
  });

  it("treats tabs and newlines as whitespace via \\s", () => {
    const content: TranslationContent = {
      type: ExerciseType.TRANSLATION,
      instructions: "x",
      sourceText: "I\thope\nyou arrive on time.",
      sourceLanguage: Language.EN,
      targetLanguage: Language.ES,
      referenceTranslation: "Espero que llegues a tiempo.",
    };
    expect(canonicalSurface(content)).toBe("i hope you arrive on time.");
  });
});

// ---------------------------------------------------------------------------
// canonicalSurface — sentence_construction
// ---------------------------------------------------------------------------

describe("canonicalSurface — sentence_construction", () => {
  it("keys on the normalised prompt text", () => {
    expect(
      canonicalSurface({
        type: ExerciseType.SENTENCE_CONSTRUCTION,
        instructions: "x",
        promptMode: "grammar_target",
        prompt: "  Usá  el  Subjuntivo.  ",
        modelAnswers: ["a", "b"],
      }),
    ).toBe("usa el subjuntivo.");
  });
});

describe("sentenceConstructionModeForOrdinal", () => {
  it("cycles keywords → situation → grammar_target by ordinal", () => {
    expect(sentenceConstructionModeForOrdinal(0)).toBe("keywords");
    expect(sentenceConstructionModeForOrdinal(1)).toBe("situation");
    expect(sentenceConstructionModeForOrdinal(2)).toBe("grammar_target");
    expect(sentenceConstructionModeForOrdinal(3)).toBe("keywords");
  });
});

describe("buildGenerationUserPrompt — sentence_construction", () => {
  const inputs = {
    language: "ES",
    cefrLevel: "B1",
    exerciseType: ExerciseType.SENTENCE_CONSTRUCTION,
    grammarPoint: {
      key: "es-b1-present-subjunctive",
      kind: "grammar",
      name: "Present subjunctive",
      description: "d",
      cefrLevel: "B1",
      language: "es",
      examplesPositive: ["a", "b"],
      examplesNegative: ["*c"],
      commonErrors: ["e"],
    },
  } as const;

  it("names the ordinal's mode in the message", () => {
    const msg = buildGenerationUserPrompt(inputs as never, 0, null);
    expect(msg).toContain("prompt mode: keywords");
  });

  it("does not add a mode line for other types", () => {
    const cloze = { ...inputs, exerciseType: ExerciseType.CLOZE };
    const msg = buildGenerationUserPrompt(cloze as never, 0, null);
    expect(msg).not.toContain("prompt mode:");
  });
});

// ---------------------------------------------------------------------------
// Grammatical-person rotation
// ---------------------------------------------------------------------------

describe("personForOrdinal", () => {
  it("cycles the TR six-person paradigm and wraps", () => {
    expect(personForOrdinal(Language.TR, 0)).toBe("1sg (ben)");
    expect(personForOrdinal(Language.TR, 1)).toBe("2sg (sen)");
    expect(personForOrdinal(Language.TR, 5)).toBe("3pl (onlar)");
    expect(personForOrdinal(Language.TR, 6)).toBe("1sg (ben)");
  });

  it("ES list omits vosotros (pan-American 2pl = ustedes)", () => {
    const es = PERSON_ROTATION_BY_LANGUAGE[Language.ES];
    expect(es).toHaveLength(5);
    expect(es.join(" ")).not.toContain("vosotros");
    expect(es).toContain("3pl (ellos/ellas/ustedes)");
  });

  it("a full cycle covers every person exactly once per language", () => {
    for (const language of [Language.TR, Language.ES, Language.DE] as const) {
      const persons = PERSON_ROTATION_BY_LANGUAGE[language];
      const cycle = persons.map((_, i) => personForOrdinal(language, i));
      expect(new Set(cycle).size).toBe(persons.length);
    }
  });
});

describe("personRotationPhase", () => {
  it("is deterministic and in range for date-stamped scheduler seeds", () => {
    for (const seed of [
      "scheduled-2026-06-12",
      "scheduled-2026-06-13",
      "phase-2-default",
    ]) {
      const phase = personRotationPhase(seed, 6);
      expect(phase).toBe(personRotationPhase(seed, 6));
      expect(phase).toBeGreaterThanOrEqual(0);
      expect(phase).toBeLessThan(6);
    }
  });

  it("varies across nightly seeds so small top-ups cover the cycle tail", () => {
    // A week of scheduler seeds must not all hash to the same phase —
    // otherwise a cell topping up by 1–2 drafts/night would still starve
    // the tail persons.
    const phases = new Set(
      Array.from({ length: 7 }, (_, day) =>
        personRotationPhase(`scheduled-2026-06-${String(10 + day)}`, 6),
      ),
    );
    expect(phases.size).toBeGreaterThan(1);
  });

  it("returns phase 0 for null/absent seed (back-compat path)", () => {
    expect(personRotationPhase(null, 6)).toBe(0);
    expect(personRotationPhase(undefined, 6)).toBe(0);
    expect(personRotationPhase("", 6)).toBe(0);
  });

  it("offsets personForOrdinal while preserving full-cycle coverage", () => {
    const seed = "scheduled-2026-06-12";
    const phase = personRotationPhase(seed, 6);
    expect(personForOrdinal(Language.TR, 0, seed)).toBe(
      PERSON_ROTATION_BY_LANGUAGE[Language.TR][phase],
    );
    const cycle = PERSON_ROTATION_BY_LANGUAGE[Language.TR].map((_, i) =>
      personForOrdinal(Language.TR, i, seed),
    );
    expect(new Set(cycle).size).toBe(6);
  });

  it("threads batchSeed through buildGenerationUserPrompt", () => {
    const seed = "scheduled-2026-06-12";
    const expected = personForOrdinal(Language.ES, 0, seed);
    const msg = buildGenerationUserPrompt(baseInputs, 0, null, null, seed);
    expect(msg).toContain(`Target grammatical person for this draft: ${expected}`);
  });
});

describe("buildGenerationUserPrompt — person rotation", () => {
  // baseInputs targets es-b1-present-subjunctive, which is flagged
  // `personRotation: true` in the curriculum.
  it("pins the ordinal's person for a flagged grammar point", () => {
    const msg = buildGenerationUserPrompt(baseInputs, 0, null);
    expect(msg).toContain("Target grammatical person for this draft: 1sg (yo)");
  });

  it("rotates the person across ordinals", () => {
    const msg = buildGenerationUserPrompt(baseInputs, 1, null);
    expect(msg).toContain("Target grammatical person for this draft: 2sg (tú)");
  });

  it("is deterministic — same ordinal yields identical bytes", () => {
    expect(buildGenerationUserPrompt(baseInputs, 3, null)).toBe(
      buildGenerationUserPrompt(baseInputs, 3, null),
    );
  });

  it("adds no person line for an unflagged grammar point", () => {
    const unflagged = getGrammarPoint("es-b1-relative-clauses");
    if (!unflagged) throw new Error("fixture missing: es-b1-relative-clauses");
    expect(unflagged.personRotation).toBeUndefined();
    const msg = buildGenerationUserPrompt(
      { ...baseInputs, grammarPoint: unflagged },
      0,
      null,
    );
    expect(msg).not.toContain("Target grammatical person");
  });

  it("composes with the SC mode block and seed word", () => {
    const msg = buildGenerationUserPrompt(
      { ...baseInputs, exerciseType: ExerciseType.SENTENCE_CONSTRUCTION },
      0,
      "travel",
      "viajar",
    );
    expect(msg).toContain("prompt mode: keywords");
    expect(msg).toContain("Target grammatical person for this draft: 1sg (yo)");
    expect(msg).toContain('Build this exercise around the word "viajar"');
  });
});

// ---------------------------------------------------------------------------
// tailRecentStems
// ---------------------------------------------------------------------------

describe("tailRecentStems", () => {
  it("returns the input as-is when within the cap", () => {
    const stems = ["a", "b", "c"];
    expect(tailRecentStems(stems)).toEqual(stems);
  });

  it("returns the last 30 of 32", () => {
    const stems = Array.from({ length: 32 }, (_, i) => `s${i}`);
    const tail = tailRecentStems(stems);
    expect(tail).toHaveLength(MAX_RECENT_STEMS_IN_PROMPT);
    expect(tail[0]).toBe("s2");
    expect(tail[tail.length - 1]).toBe("s31");
  });

  it("returns an empty array when input is empty", () => {
    expect(tailRecentStems([])).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Dictation rejection guards
// ---------------------------------------------------------------------------

describe("computeGenerationPromptVars — dictation guard", () => {
  it("throws when exerciseType is DICTATION", () => {
    expect(() =>
      computeGenerationPromptVars(
        { ...baseInputs, exerciseType: ExerciseType.DICTATION },
        [],
      ),
    ).toThrow("Dictation exercises are not batch-generated");
  });
});

describe("buildGenerationUserPrompt — dictation guard", () => {
  it("throws when exerciseType is DICTATION", () => {
    expect(() =>
      buildGenerationUserPrompt(
        { ...baseInputs, exerciseType: ExerciseType.DICTATION },
        0,
        null,
      ),
    ).toThrow("Dictation exercises are not batch-generated");
  });
});

describe("canonicalSurface — dictation guard", () => {
  it("throws for a dictation content type", () => {
    const content: DictationContent = {
      type: ExerciseType.DICTATION,
      title: "Test clip",
      referenceText: "Hello world",
      sentences: ["Hello world"],
      accent: "EN neutral",
      voiceId: "Joanna",
      tested: ["listening"],
      durationSec: 3,
      waveform: [0.5, 0.5],
    };
    expect(() => canonicalSurface(content)).toThrow(
      "Dictation exercises are not generated via this path",
    );
  });
});
