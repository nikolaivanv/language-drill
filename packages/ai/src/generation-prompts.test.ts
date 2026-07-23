import { describe, it, expect } from "vitest";
import {
  CefrLevel,
  ExerciseType,
  Language,
  type ClozeContent,
  type ConjugationContent,
  type DictationContent,
  type FreeWritingContent,
  type TranslationContent,
  type VocabRecallContent,
} from "@language-drill/shared";
// SentenceConstructionContent is used implicitly via ExerciseType.SENTENCE_CONSTRUCTION
import { getGrammarPoint, grammarPointsAtOrBelow } from "@language-drill/db";

import { CEFR_LEVEL_DESCRIPTORS, EVALUATION_SYSTEM_PROMPT } from "./prompts.js";
import {
  GENERATION_PROMPT_VERSION,
  GENERATION_SYSTEM_PROMPT_TEMPLATE,
  MAX_PRIOR_POOL_SURFACES_IN_PROMPT,
  MAX_RECENT_STEMS_IN_PROMPT,
  buildGenerationSystemPrompt,
  buildGenerationUserPrompt,
  PERSON_ROTATION_BY_LANGUAGE,
  personCodesForLanguage,
  personDisplayForCode,
  canonicalSurface,
  capPriorPoolSurfaces,
  computeGenerationPromptVars,
  sentenceConstructionModeForOrdinal,
  contextualParaphraseConstraintForOrdinal,
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

const trA2Grammar = getGrammarPoint("tr-a2-aorist");
if (!trA2Grammar) throw new Error("test fixture missing: tr-a2-aorist");
const trA1ScopePoint = getGrammarPoint("tr-a1-locative");
if (!trA1ScopePoint) throw new Error("test fixture missing: tr-a1-locative");

const trClozeInputs: GenerationPromptInputs = {
  language: Language.TR,
  cefrLevel: CefrLevel.A2,
  exerciseType: ExerciseType.CLOZE,
  grammarPoint: trA2Grammar,
  levelScopePoints: grammarPointsAtOrBelow(Language.TR, CefrLevel.A2),
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
    // 2026-07-12: cloze `context` field removed — the template must no longer
    // invite the model to populate it.
    expect(prompt).not.toContain("and `context` fields");
    expect(prompt).not.toContain("`sentence`, `context`");
  });

  it("includes the TR indefinite-noun-compound cloze format rule (2026-06-23)", async () => {
    // Root-cause fix for tr-a2-indefinite-compound cloze (8/49 on 2026-06-22):
    // whole-compound blanks + omitted parenthetical head + case-stacking → the
    // answer isn't pinned to one form, so the validator flags `ambiguous`.
    const prompt = await buildGenerationSystemPrompt(baseInputs, []);
    expect(prompt).toContain("indefinite noun compound");
    expect(prompt).toContain("ONLY the head noun is blanked");
    expect(prompt).toContain("nominative");
  });

  it("pins the 2026-06-25 indefinite-compound generation hardening (no bir-hugging, one-word answer, literal modifier)", async () => {
    // The 2026-06-23 validator note fixed the false-rejects; the 2026-06-25 run
    // (3/17) showed the residual blockers were generation defects. Pin each new
    // guardrail so a future edit can't silently drop one.
    const prompt = await buildGenerationSystemPrompt(baseInputs, []);
    expect(prompt).toContain("No article hugging the compound");
    expect(prompt).toContain("One-word answer");
    expect(prompt).toContain("Modifier is a literal word");
  });

  it("includes the TR gemination / stem-change translation rule (2026-06-23)", async () => {
    // Root-cause fix for tr-a2-consonant-doubling translation (2/27 on
    // 2026-06-22): the source must force a vowel-initial suffix so the
    // alternation is obligatory, and synonym escapes must be enumerated.
    const prompt = await buildGenerationSystemPrompt(baseInputs, []);
    expect(prompt).toContain("gemination");
    expect(prompt).toContain("vowel-initial");
  });

  it("includes the vocab_recall kinship side-disambiguation rule (2026-07-17)", async () => {
    // Root-cause fix for TR family-vocab clues (amca/dayı marked wrong on a
    // side-neutral gloss): a side-specific kin term needs the side named in the
    // definition, or both terms enumerated in acceptableAnswers; and the gloss
    // must not describe a different relation than the answer denotes.
    const prompt = await buildGenerationSystemPrompt(baseInputs, []);
    expect(prompt).toContain("vocab_recall kinship terms");
    expect(prompt).toContain("father's brother"); // amca
    expect(prompt).toContain("mother's brother"); // dayı
    expect(prompt).toContain("side-NEUTRAL");
    // the wrong-relation guard (a cousin gloss for dayı, teyze for hala)
    expect(prompt).toContain("that is a cousin");
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
    // Optional single-letter suffix = second bump on the same day (mirrors
    // the CURRICULUM_VERSION_<LANG> convention in curriculum.test.ts).
    expect(GENERATION_PROMPT_VERSION).toMatch(/^generate@\d{4}-\d{2}-\d{2}[a-z]?$/);
    // Bumped 2026-06-16 — two same-day edits share this cohort: (1) the
    // sentence-construction "Plain text only — no markdown" rule (the generator
    // leaked `**keyword**` emphasis into the plain-text `prompt` field, rendered
    // verbatim as literal asterisks); (2) the conjugation/inflection drill type's
    // `{{conjugationSection}}` guidance block spliced into the cached template.
    // Prior 2026-06-12 cohort covered the possessive-cloze diversity tweak + the
    // curriculum-wide grammatical-person rotation.
    // Bumped 2026-06-20 — featureBundle no-leak hardening (must not embed
    // targetForm / an inflected lemma / a worked example), after the possessive-
    // stacking flag wave. (2026-06-19: strict conjugate-the-seed directive +
    // instruction-discipline bullets in renderConjugationSection.)
    // Bumped 2026-06-23 — TR indefinite-noun-compound cloze rule + gemination /
    // stem-change translation rule, after the 2026-06-22 run analysis.
    // Bumped 2026-06-25 — tightened indefinite-compound cloze generation
    // (no `bir` hugging the compound, one-word answer, literal modifier, concrete
    // vocab) after the 2026-06-25 run showed those generation defects.
    // Bumped 2026-06-29 — nominal-inflection conjugation seeds (conjugationSeedKind:
    // 'noun') render a strict "noun to inflect" directive instead of "verb to
    // conjugate", so the six TR nominal points seed from the noun band.
    // Bumped 2026-06-30 — copular point gets a 'predicate-nominal' directive
    // ("predicate to use" from a curated pool, not "noun to inflect"), and the
    // renderConjugationSection `breakdown` rule now forbids model deliberation /
    // self-correction leaking into the learner-visible breakdown.
    // Bumped 2026-07-08 — self-revealing digit-form directive: flagged
    // numbers/ordinals cloze/translation cells now get a per-draft
    // digit-only-presentation directive (pinned to the seeded target value
    // when seeded) instead of the ordinary loose seed block.
    // Bumped 2026-07-08a — self-revealing base-word-cue directive: flagged
    // derived-form points (appreciative suffixes) cue the parenthetical BASE
    // word and pin the seeded target form; the derived form never appears in
    // the visible text.
    // Bumped 2026-07-10 — contextual_paraphrase seed injected as a strict
    // scenario directive in the per-draft user prompt (replacing the generic
    // word/substitution framing). (2026-07-09 added the paraphrase guidance
    // section + constraint-kind rotation.)
    // Bumped 2026-07-12 — cloze `context` field dropped from the tool schema
    // (anti-spoil) and the injected seed self-filters register-specific /
    // above-level frequency words.
    // Bumped 2026-07-18 — translation `acceptableAnswers`: the Ambiguous-blank
    // rule now REQUIRES enumerating structurally-different renderings (or
    // forcing one structure via person) instead of forbidding them.
    // Bumped 2026-07-22 — sentence_construction person target must land on the
    // SUBJECT, not the addressee: fixes the situation-mode "reply as du"
    // miscompile that shipped incoherent du-subject model answers
    // (generation-run-2026-07-22.md). Section value only — no Langfuse push.
    // Bumped 2026-07-23 — tense-determinacy rule for finite-verb cloze blanks:
    // a non-present correctAnswer in an anchorless stem is a false-negative trap
    // (the present/habitual reading is equally valid). Fixes the systemic
    // es-b1-influence-verbs-infinitive failure (docs/.../2026-07-23-cloze-tense-determinacy).
    expect(GENERATION_PROMPT_VERSION).toBe("generate@2026-07-23");
    // Tense-determinacy rule pinned in the cached template prefix.
    expect(GENERATION_SYSTEM_PROMPT_TEMPLATE).toContain(
      "Tense determinacy on finite-verb blanks",
    );
    expect(GENERATION_SYSTEM_PROMPT_TEMPLATE).toContain("todos los días");
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
    // Plain-text rule: the prompt field renders verbatim, so the generator
    // must not leak markdown emphasis (the `**keyword**` literal-asterisk bug).
    expect(sc).toContain("Plain text only — no markdown");
    // grammar_target — the worst-performing mode — must be told to anchor to a
    // scenario, not ship the structure label alone.
    expect(sc).toContain("`grammar_target`");
    expect(sc).toContain("structure label alone is NOT enough");
    // 2026-07-22: person target must land on the SUBJECT, not the addressee —
    // the "reply as du" miscompile that produced incoherent du-subject model
    // answers on situation-mode SC (see generation-run-2026-07-22.md).
    expect(sc).toContain(
      "Target person is the SUBJECT of the sentence the learner writes",
    );
    expect(sc).toContain("register/addressee cue, NOT the subject");
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

  it("adds the conjugation section ONLY for conjugation, absent for other types", async () => {
    const conj = await buildGenerationSystemPrompt(
      { ...baseInputs, exerciseType: ExerciseType.CONJUGATION },
      [],
    );
    expect(conj).toContain("## Conjugation/inflection specifics");

    for (const type of [
      ExerciseType.CLOZE,
      ExerciseType.TRANSLATION,
      ExerciseType.VOCAB_RECALL,
      ExerciseType.SENTENCE_CONSTRUCTION,
    ]) {
      const other = await buildGenerationSystemPrompt(
        { ...baseInputs, exerciseType: type },
        [],
      );
      expect(other).not.toContain("## Conjugation/inflection specifics");
    }
  });

  it("conjugation guidance forbids reasoning leaking into instructions", async () => {
    // 2026-06-19 instruction-discipline rule: the `instructions` field must
    // contain ONLY the learner directive — no reasoning, meta-text, or
    // abandoned attempts. Assert the discipline bullet is present in the
    // conjugation section (via the system prompt for a conjugation cell).
    const conj = await buildGenerationSystemPrompt(
      { ...baseInputs, exerciseType: ExerciseType.CONJUGATION },
      [],
    );
    expect(conj).toContain("do NOT choose your own");
    expect(conj).toContain("abandoned attempts");
  });

  it("conjugation guidance instructs the model to author features and subject", async () => {
    // Build the conjugation system prompt the same way the sibling test does.
    const conj = await buildGenerationSystemPrompt(
      { ...baseInputs, exerciseType: ExerciseType.CONJUGATION },
      [],
    );
    expect(conj).toContain("`features`");
    expect(conj).toContain("`subject`");
    expect(conj).toContain("person/number");
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
// level scope in the generation prompt
// ---------------------------------------------------------------------------

describe("level scope in the generation prompt", () => {
  it("includes the at/below-level grammar scope for a grammar-anchored cell", async () => {
    const prompt = await buildGenerationSystemPrompt(trClozeInputs, []);
    expect(prompt).toContain("Grammar in this learner's scope");
    expect(prompt).toContain(trA1ScopePoint.name); // A1 point in an A2 cell's scope
  });

  it("omits the scope block for vocab_recall (gate)", async () => {
    const vocab = getGrammarPoint("tr-a1-vocab-food-drink");
    if (!vocab) throw new Error("test fixture missing: tr-a1-vocab-food-drink");
    const prompt = await buildGenerationSystemPrompt(
      { language: Language.TR, cefrLevel: CefrLevel.A1, exerciseType: ExerciseType.VOCAB_RECALL, grammarPoint: vocab },
      [],
    );
    expect(prompt).not.toContain("Grammar in this learner's scope");
  });

  it("exposes levelScopeSection via computeGenerationPromptVars", () => {
    const vars = computeGenerationPromptVars(trClozeInputs, []);
    expect(vars.levelScopeSection).toContain("learner's scope");
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

  it("conjugation (the conjugation-specific section is spliced before ## Output)", async () => {
    // Locks byte parity through the non-empty `{{conjugationSection}}` branch so
    // the template and the in-code builder cannot diverge on conjugation cells.
    await assertParity(
      { ...baseInputs, exerciseType: ExerciseType.CONJUGATION },
      ["primera frase"],
    );
  });

  it("contextual_paraphrase (the paraphrase-specific section is spliced before ## Output)", async () => {
    // Locks byte parity through the non-empty `{{contextualParaphraseSection}}`
    // branch so the template and the in-code builder cannot diverge on
    // contextual_paraphrase cells.
    await assertParity(
      { ...baseInputs, exerciseType: ExerciseType.CONTEXTUAL_PARAPHRASE },
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
    expect(seeded).toContain("of similar frequency");
    // 2026-07-12: register/level self-filter for off-band frequency seeds.
    expect(seeded).toContain("register-specific");
    expect(seeded).toContain(baseInputs.cefrLevel);
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

  it("renders conjugation seeds as a strict conjugate-this-verb directive", () => {
    // 2026-06-19: conjugation cells use a STRICT seed directive — no
    // substitution escape hatch, because the picker already guarantees a
    // conjugatable verb and substitution re-opens the dedup-collapse we fixed.
    const conjugationInputs: GenerationPromptInputs = {
      ...baseInputs,
      exerciseType: ExerciseType.CONJUGATION,
    };
    const prompt = buildGenerationUserPrompt(
      conjugationInputs,
      0,
      null,
      "cantar",
    );
    expect(prompt).toContain('The verb to conjugate is "cantar"');
    expect(prompt).not.toContain("choose a related content word"); // no substitution escape hatch
  });

  it("renders nominal-inflection conjugation seeds as a strict inflect-this-noun directive", () => {
    // conjugationSeedKind: 'noun' points (possessive/case/copula) decline a NOUN,
    // not a verb — the strict directive must name the right word class so the
    // author inflects the seed instead of treating it as a verb to conjugate.
    const nounConjInputs: GenerationPromptInputs = {
      ...baseInputs,
      exerciseType: ExerciseType.CONJUGATION,
      grammarPoint: { ...baseInputs.grammarPoint, conjugationSeedKind: "noun" },
    };
    const prompt = buildGenerationUserPrompt(nounConjInputs, 0, null, "okul");
    expect(prompt).toContain('The noun to inflect is "okul"');
    expect(prompt).not.toContain("verb to conjugate");
    expect(prompt).not.toContain("choose a related content word"); // strict — no escape hatch
  });

  it("renders copular (predicate-nominal) conjugation seeds as a predicate directive", () => {
    // conjugationSeedKind: 'predicate-nominal' (the copular personal-suffix
    // point) makes a "subject IS <predicate>" sentence — the directive must
    // frame the seed as a predicate nominal, not an object noun to decline.
    const copularInputs: GenerationPromptInputs = {
      ...baseInputs,
      exerciseType: ExerciseType.CONJUGATION,
      grammarPoint: {
        ...baseInputs.grammarPoint,
        conjugationSeedKind: "predicate-nominal",
      },
    };
    const prompt = buildGenerationUserPrompt(copularInputs, 0, null, "doktor");
    expect(prompt).toContain('The predicate is "doktor"');
    expect(prompt).not.toContain("noun to inflect");
    expect(prompt).not.toContain("verb to conjugate");
    expect(prompt).not.toContain("choose a related content word"); // strict — no escape hatch
  });
});

describe("buildGenerationUserPrompt — vocab_recall seed directive", () => {
  it("pins expectedWord to the seed and forbids substitution", () => {
    // 2026-07-10: vocab_recall cells are now seeded from the curated
    // vocab_target list (Tasks 1-3) — coverage only registers when
    // expectedWord matches the seed, so the loose substitution escape hatch
    // (which lets the model pick "a related content word of similar
    // frequency") would defeat convergence. This must be strict, like the
    // conjugation and contextual_paraphrase directives above.
    const vocabInputs: GenerationPromptInputs = {
      ...baseInputs,
      exerciseType: ExerciseType.VOCAB_RECALL,
    };
    const out = buildGenerationUserPrompt(vocabInputs, 0, null, "manzana");
    expect(out).toContain("manzana");
    expect(out).toMatch(/must be exactly/i);
    // Must NOT offer the loose frequency-substitution escape hatch.
    expect(out).not.toContain("similar frequency");
  });
});

describe("buildGenerationUserPrompt — self-revealing digit-form directive", () => {
  const flaggedInputs: GenerationPromptInputs = {
    ...baseInputs,
    grammarPoint: {
      ...baseInputs.grammarPoint,
      selfRevealingElicitation: "digit-form" as const,
      elicitationSeedValues: ["tercero", "doscientas"],
    },
  };

  it("pins the seeded target value and demands digit-only presentation (cloze)", () => {
    const prompt = buildGenerationUserPrompt(flaggedInputs, 0, null, "tercero");
    expect(prompt).toContain('The target form is "tercero"');
    expect(prompt).toContain("digits");
    // The generic loose-seed block must NOT also appear:
    expect(prompt).not.toContain("Build this exercise around the word");
  });

  it("emits a generic digit-form directive when unseeded (CLI/eval path)", () => {
    const prompt = buildGenerationUserPrompt(flaggedInputs, 0, null, null);
    expect(prompt).toContain("digits");
    expect(prompt).toContain("written form");
  });

  it("translation variant demands digits in the SOURCE text", () => {
    const trInputs: GenerationPromptInputs = {
      ...flaggedInputs,
      exerciseType: ExerciseType.TRANSLATION,
    };
    const prompt = buildGenerationUserPrompt(trInputs, 0, null, "doscientas");
    expect(prompt).toContain('The target form is "doscientas"');
    expect(prompt).toContain("source");
  });

  it("unflagged cloze is byte-identical to before (loose seed block)", () => {
    const prompt = buildGenerationUserPrompt(baseInputs, 0, null, "mesa");
    expect(prompt).toContain('Build this exercise around the word "mesa"');
    expect(prompt).not.toContain("target form");
  });
});

describe("buildGenerationUserPrompt — self-revealing base-word-cue directive", () => {
  const flaggedInputs: GenerationPromptInputs = {
    ...baseInputs,
    grammarPoint: {
      ...baseInputs.grammarPoint,
      selfRevealingElicitation: "base-word-cue" as const,
      elicitationSeedValues: ["sillita", "hotelucho"],
    },
  };

  it("pins the seeded target form and demands a parenthetical BASE-word cue (cloze)", () => {
    const prompt = buildGenerationUserPrompt(flaggedInputs, 0, null, "sillita");
    expect(prompt).toContain('The target form is "sillita"');
    expect(prompt).toContain("BASE word");
    // Neither the loose seed block nor the digit-form directive may leak in:
    expect(prompt).not.toContain("Build this exercise around the word");
    expect(prompt).not.toContain("digits");
  });

  it("emits a generic base-word-cue directive when unseeded (CLI/eval path)", () => {
    const prompt = buildGenerationUserPrompt(flaggedInputs, 0, null, null);
    expect(prompt).toContain("BASE word");
    expect(prompt).toContain("derived form");
  });

  it("translation variant conveys the nuance in the SOURCE text and pins the reference form", () => {
    const trInputs: GenerationPromptInputs = {
      ...flaggedInputs,
      exerciseType: ExerciseType.TRANSLATION,
    };
    const prompt = buildGenerationUserPrompt(trInputs, 0, null, "hotelucho");
    expect(prompt).toContain('The target form is "hotelucho"');
    expect(prompt).toContain("source");
    expect(prompt).not.toContain("digits");
  });

  it("conjugation cells are unaffected by the flag (no directive, no seed misread)", () => {
    const conjInputs: GenerationPromptInputs = {
      ...flaggedInputs,
      exerciseType: ExerciseType.CONJUGATION,
    };
    const prompt = buildGenerationUserPrompt(conjInputs, 0, null, "hablar");
    expect(prompt).not.toContain("BASE word");
    expect(prompt).not.toContain("target form");
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

  it("uses the title (lowercased, diacritic-stripped) for free-writing content", () => {
    const content: FreeWritingContent = {
      type: ExerciseType.FREE_WRITING,
      instructions: "x",
      title: "El Teletrabajo: ¿Avance o Aislamiento?",
      task: "x",
      domain: "x",
      register: "formal",
      minWords: 150,
      maxWords: 200,
      requiredElements: [],
    };
    expect(canonicalSurface(content)).toBe("el teletrabajo: ¿avance o aislamiento?");
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

describe("canonicalSurface — dictation", () => {
  it("canonicalSurface uses referenceText for dictation", () => {
    const surface = canonicalSurface({
      type: ExerciseType.DICTATION,
      title: "t",
      referenceText: "El Tiempo  lo Cura.",
      sentences: ["El Tiempo lo Cura."],
      accent: "a",
      voiceId: "Sergio",
      tested: ["x"],
      durationSec: 5,
      waveform: [0.5],
    } as never);
    expect(surface).toBe("el tiempo lo cura.");
  });
});

describe("canonicalSurface — conjugation", () => {
  it("keys on the stable lemma + targetForm + pronoun (not the rephrasable featureBundle)", () => {
    const content: ConjugationContent = {
      type: ExerciseType.CONJUGATION,
      instructions: "Write the correct form.",
      lemma: "Öğrenci",
      lemmaGloss: "student",
      featureBundle: "kişi eki · 2. tekil kişi (sen)",
      subject: { pronoun: "sen", gloss: "you" },
      targetForm: "öğrencisin",
      breakdown: "x",
      exampleSentences: ["Sen öğrencisin."],
    };
    // normaliseSurface lowercases + strips diacritics (ö→o, ğ→g, ç→c, ş→s, ü→u).
    expect(canonicalSurface(content)).toBe("ogrenci::ogrencisin::sen");
  });

  it("collapses a rephrased featureBundle to the SAME key (the duplicate-accrual root cause)", () => {
    const base: ConjugationContent = {
      type: ExerciseType.CONJUGATION,
      instructions: "x",
      lemma: "öğrenci",
      lemmaGloss: "student",
      featureBundle: "kişi eki · 2. tekil kişi (sen)",
      subject: { pronoun: "sen", gloss: "you" },
      targetForm: "öğrencisin",
      breakdown: "x",
      exampleSentences: ["x"],
    };
    // Same prompt, featureBundle reworded by the model on a later run — MUST now
    // hash to the same key so the dedup unique index catches the re-generation.
    const rephrased = { ...base, featureBundle: "kişi eki (yüklem) · 2. tekil şahıs" };
    expect(canonicalSurface(base)).toBe(canonicalSurface(rephrased));

    // A genuinely different answer (different form + pronoun) is a distinct item.
    const otherCell = {
      ...base,
      targetForm: "öğrenciyim",
      subject: { pronoun: "ben", gloss: "I" },
    };
    expect(canonicalSurface(base)).not.toBe(canonicalSurface(otherCell));

    // Same lemma + form but a different pronoun → distinct.
    const otherPronoun = { ...base, subject: { pronoun: "o", gloss: "he / she" } };
    expect(canonicalSurface(base)).not.toBe(canonicalSurface(otherPronoun));
  });

  it("tolerates a missing subject (legacy rows) — empty pronoun segment", () => {
    const content: ConjugationContent = {
      type: ExerciseType.CONJUGATION,
      instructions: "x",
      lemma: "hablar",
      lemmaGloss: "to speak",
      featureBundle: "presente · 1sg",
      targetForm: "hablo",
      breakdown: "x",
      exampleSentences: ["Hablo español."],
    };
    expect(canonicalSurface(content)).toBe("hablar::hablo::");
  });
});

describe("computeGenerationPromptVars — conjugationSection", () => {
  it("returns conjugationSection === '' for a non-conjugation cell", () => {
    const vars = computeGenerationPromptVars(baseInputs, []);
    expect(vars.conjugationSection).toBe("");
  });

  it("returns the conjugation guidance block for a conjugation cell", () => {
    const vars = computeGenerationPromptVars(
      { ...baseInputs, exerciseType: ExerciseType.CONJUGATION },
      [],
    );
    expect(vars.conjugationSection).toContain(
      "Conjugation/inflection specifics",
    );
    // Splices cleanly before `## Output` (trailing blank line).
    expect(vars.conjugationSection.endsWith("\n\n")).toBe(true);
  });

  it("leaves sentenceConstructionSection empty for a conjugation cell (mutually exclusive sections)", () => {
    const vars = computeGenerationPromptVars(
      { ...baseInputs, exerciseType: ExerciseType.CONJUGATION },
      [],
    );
    expect(vars.sentenceConstructionSection).toBe("");
  });

  it("leaves contextualParaphraseSection empty for a non-paraphrase cell (mutually exclusive sections)", () => {
    const vars = computeGenerationPromptVars(
      { ...baseInputs, exerciseType: ExerciseType.CONJUGATION },
      [],
    );
    expect(vars.contextualParaphraseSection).toBe("");
  });

  it("populates contextualParaphraseSection for a contextual_paraphrase cell", () => {
    const vars = computeGenerationPromptVars(
      { ...baseInputs, exerciseType: ExerciseType.CONTEXTUAL_PARAPHRASE },
      [],
    );
    expect(vars.contextualParaphraseSection).toContain(
      "Contextual-paraphrase specifics",
    );
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

describe("contextualParaphraseConstraintForOrdinal", () => {
  it("rotates avoid → register → simplify", () => {
    expect(contextualParaphraseConstraintForOrdinal(0)).toBe("avoid");
    expect(contextualParaphraseConstraintForOrdinal(1)).toBe("register");
    expect(contextualParaphraseConstraintForOrdinal(2)).toBe("simplify");
    expect(contextualParaphraseConstraintForOrdinal(3)).toBe("avoid");
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

describe("buildGenerationUserPrompt — contextual_paraphrase", () => {
  it("names the constraint kind for the ordinal", () => {
    const prompt = buildGenerationUserPrompt(
      { ...baseInputs, exerciseType: ExerciseType.CONTEXTUAL_PARAPHRASE },
      1, // ordinal 1 → register
      null,
    );
    expect(prompt).toMatch(/constraint kind: register/i);
  });

  it("rotates the constraint kind across ordinals 0/2", () => {
    const avoidPrompt = buildGenerationUserPrompt(
      { ...baseInputs, exerciseType: ExerciseType.CONTEXTUAL_PARAPHRASE },
      0,
      null,
    );
    expect(avoidPrompt).toMatch(/constraint kind: avoid/i);

    const simplifyPrompt = buildGenerationUserPrompt(
      { ...baseInputs, exerciseType: ExerciseType.CONTEXTUAL_PARAPHRASE },
      2,
      null,
    );
    expect(simplifyPrompt).toMatch(/constraint kind: simplify/i);
  });

  it("does not add a constraint-kind line for other types", () => {
    const msg = buildGenerationUserPrompt(baseInputs, 1, null);
    expect(msg).not.toContain("constraint kind:");
  });

  it("renders a paraphrase seed as a strict scenario directive, not the generic word framing", () => {
    // The paraphrase seed is a SCENARIO from the curated paraphrase.seeds pool —
    // the identity-diversity axis. It must be framed as a scenario (not a "word")
    // with no substitution escape hatch, mirroring the strict conjugation seed.
    const prompt = buildGenerationUserPrompt(
      { ...baseInputs, exerciseType: ExerciseType.CONTEXTUAL_PARAPHRASE },
      0,
      null,
      "a complaint to a landlord",
    );
    expect(prompt).toContain('scenario: "a complaint to a landlord"');
    // The generic word-oriented seed block + its substitution escape hatch must NOT appear:
    expect(prompt).not.toContain("Build this exercise around the word");
    expect(prompt).not.toContain("choose a related content word");
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
  it("uses the normalised referenceText as the dedup surface", () => {
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
    expect(canonicalSurface(content)).toBe("hello world");
  });
});

// ---------------------------------------------------------------------------
// personCodesForLanguage
// ---------------------------------------------------------------------------

describe("personCodesForLanguage", () => {
  it("derives canonical codes from the rotation labels", () => {
    expect(personCodesForLanguage(Language.TR)).toEqual([
      "1sg", "2sg", "3sg", "1pl", "2pl", "3pl",
    ]);
  });
  it("omits vosotros for Spanish (5 persons, no 2pl)", () => {
    expect(personCodesForLanguage(Language.ES)).toEqual([
      "1sg", "2sg", "3sg", "1pl", "3pl",
    ]);
  });
  it("returns all six person codes for German", () => {
    expect(personCodesForLanguage(Language.DE)).toEqual([
      "1sg", "2sg", "3sg", "1pl", "2pl", "3pl",
    ]);
  });
});

// ---------------------------------------------------------------------------
// personDisplayForCode
// ---------------------------------------------------------------------------

describe("personDisplayForCode", () => {
  it("maps a code back to the language-specific label", () => {
    expect(personDisplayForCode(Language.TR, "2pl")).toBe("2pl (siz)");
    expect(personDisplayForCode(Language.ES, "1pl")).toBe(
      "1pl (nosotros/nosotras)",
    );
  });
  it("falls back to the bare code when the language lacks it", () => {
    expect(personDisplayForCode(Language.ES, "2pl")).toBe("2pl");
  });
  it("maps 2pl for German to its ihr label", () => {
    expect(personDisplayForCode(Language.DE, "2pl")).toBe("2pl (ihr)");
  });
});

// ---------------------------------------------------------------------------
// renderCoverageBlock (via buildGenerationUserPrompt) — Phase 2
// ---------------------------------------------------------------------------

function covInputs(over: Record<string, unknown> = {}) {
  return {
    language: Language.TR,
    cefrLevel: CefrLevel.A1,
    exerciseType: ExerciseType.CLOZE,
    grammarPoint: getGrammarPoint("tr-a1-present-continuous"),
    ...over,
  } as Parameters<typeof buildGenerationUserPrompt>[0];
}

describe("renderCoverageBlock (via buildGenerationUserPrompt)", () => {
  it("emits a person directive with the language display label", () => {
    const out = buildGenerationUserPrompt(covInputs(), 0, null, null, [{ person: "2pl" }]);
    expect(out).toContain("2pl (siz)");
  });
  it("emits one directive per axis when the target is multi-axis", () => {
    const out = buildGenerationUserPrompt(covInputs(), 0, null, null, [{ person: "1sg", polarity: "negative" }]);
    expect(out).toContain("1sg (ben)");
    expect(out).toContain("negative");
  });
  it("emits a wordClass directive for vocab", () => {
    const out = buildGenerationUserPrompt(
      covInputs({ exerciseType: ExerciseType.VOCAB_RECALL, grammarPoint: getGrammarPoint("tr-a1-vocab-food-drink") }),
      0,
      null,
      null,
      [{ wordClass: "verb" }],
    );
    expect(out).toContain("verb");
  });
  it("emits no directive when there is no target for the ordinal", () => {
    const withTargets = buildGenerationUserPrompt(covInputs(), 0, null, null, [{ person: "1sg" }]);
    const without = buildGenerationUserPrompt(covInputs(), 0, null, null, undefined);
    expect(without).not.toContain("Target grammatical person");
    expect(withTargets).toContain("Target grammatical person");
  });
  it("emits number and case directives for nominal inflection targets", () => {
    const out = buildGenerationUserPrompt(covInputs(), 0, null, null, [
      { case: "dative", number: "plural" },
    ]);
    expect(out).toContain("dative");
    expect(out).toContain("plural");
  });
  it("emits a comparison directive when the target sets it", () => {
    const out = buildGenerationUserPrompt(covInputs(), 0, null, null, [
      { comparison: "superlative" },
    ]);
    expect(out).toContain("superlative");
    expect(out).toMatch(/comparison/i);
  });
});

// ---------------------------------------------------------------------------
// renderConjugationSection
// ---------------------------------------------------------------------------

import { renderConjugationSection } from "./generation-prompts.js";

describe("renderConjugationSection", () => {
  const section = () =>
    renderConjugationSection(ExerciseType.CONJUGATION, "Turkish", "A1", "Locative case -DA");

  it("returns empty for non-conjugation types", () => {
    expect(
      renderConjugationSection(ExerciseType.CLOZE, "Turkish", "A1", "x"),
    ).toBe("");
  });

  it("does not assume the lemma is a verb", () => {
    expect(section()).not.toMatch(/Use the verb you are given/);
    expect(section()).toMatch(/lemma|word/i);
  });

  it("treats the fixed inflectional category generically (not tense-only)", () => {
    // Must not hard-assert 'Tense/mood is FIXED' as the only fixed category.
    expect(section()).toMatch(/inflectional category|case\/number|tense\/mood for verbs/i);
  });

  it("still documents features and subject, with subject made optional for case forms", () => {
    expect(section()).toMatch(/`features`/);
    expect(section()).toMatch(/`subject`/);
    // The verb-shaped 'subject is the person/number cue' must become conditional.
    expect(section()).toMatch(/omit `subject`|when the form agrees with a person|possessor/i);
  });

  it("forbids leaking the answer (or a worked example) in the featureBundle", () => {
    // Hardening after the 2026-06-20 possessive-stacking flag wave, where
    // bundles like "yönelme hâli (benim çantama)" embedded the targetForm.
    expect(section()).toMatch(/MUST NOT contain `targetForm`/);
    expect(section()).toMatch(/inflected form of the lemma|worked example/i);
  });

  it("forbids model deliberation / self-correction leaking into the breakdown", () => {
    // 2026-06-30: locative conjugation shipped breakdowns with embedded
    // chain-of-thought (".. back vowel i → e… wait: iş has back vowel? No —…✓"),
    // shown verbatim to the learner — both low-quality and answer-spoiling.
    expect(section()).toMatch(/`breakdown`/);
    expect(section()).toMatch(/reasoning|deliberation|self-correction/i);
    expect(section()).toMatch(/wait/i);
  });
});
