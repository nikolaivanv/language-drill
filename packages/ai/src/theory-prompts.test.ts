import { describe, it, expect } from "vitest";
import { Language } from "@language-drill/shared";
import { esCurriculum, trCurriculum } from "@language-drill/db";

import {
  buildTheorySystemPrompt,
  buildTheoryUserPrompt,
  computeTheoryPromptVars,
  THEORY_SYSTEM_PROMPT_TEMPLATE,
  type TheoryPromptInputs,
} from "./theory-prompts.js";
import { applyTemplate } from "./prompts-registry.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const entry = esCurriculum.find((e) => e.kind === "grammar");
if (!entry) {
  throw new Error(
    "test fixture missing: no `kind: 'grammar'` entry in esCurriculum",
  );
}

const TEST_INPUT: TheoryPromptInputs = {
  language: Language.ES,
  cefrLevel: entry.cefrLevel,
  grammarPoint: entry,
};

describe("theory-prompts", () => {
// ---------------------------------------------------------------------------
// buildTheorySystemPrompt
// ---------------------------------------------------------------------------

describe("buildTheorySystemPrompt", () => {
  it("is deterministic — same inputs return byte-identical strings", async () => {
    const [a, b] = await Promise.all([
      buildTheorySystemPrompt(TEST_INPUT),
      buildTheorySystemPrompt(TEST_INPUT),
    ]);
    expect(a).toBe(b);
  });

  it("inlines the grammar-point description, positive examples, and common errors verbatim", async () => {
    const prompt = await buildTheorySystemPrompt(TEST_INPUT);
    expect(prompt).toContain(entry.description);
    for (const example of entry.examplesPositive) {
      expect(prompt).toContain(example);
    }
    for (const error of entry.commonErrors) {
      expect(prompt).toContain(error);
    }
  });

  it("renders the five required sections in canonical order", async () => {
    const prompt = await buildTheorySystemPrompt(TEST_INPUT);

    // Scope to the `## Required sections` block — the phrases "examples in
    // context" and "common pitfalls" also appear in earlier header copy (e.g.
    // the positive-examples header mentions "examples in context section"), so
    // a naive `prompt.indexOf` would match the wrong occurrence.
    const sectionsBlockMatch = prompt.match(
      /## Required sections[\s\S]*?## Voice/,
    );
    expect(sectionsBlockMatch).not.toBeNull();
    const sectionsBlock = sectionsBlockMatch![0];

    const idxWhatIsIt = sectionsBlock.indexOf("what is it?");
    const idxWhenToUse = sectionsBlock.indexOf("when to use it");
    const idxFormation = sectionsBlock.indexOf("formation");
    const idxExamples = sectionsBlock.indexOf("examples in context");
    const idxPitfalls = sectionsBlock.indexOf("common pitfalls");

    // Sanity: every section name is present in the required-sections block.
    expect(idxWhatIsIt).toBeGreaterThanOrEqual(0);
    expect(idxWhenToUse).toBeGreaterThanOrEqual(0);
    expect(idxFormation).toBeGreaterThanOrEqual(0);
    expect(idxExamples).toBeGreaterThanOrEqual(0);
    expect(idxPitfalls).toBeGreaterThanOrEqual(0);

    // Order: what is it? → when to use it → formation → examples in context → common pitfalls
    expect(idxWhatIsIt).toBeLessThan(idxWhenToUse);
    expect(idxWhenToUse).toBeLessThan(idxFormation);
    expect(idxFormation).toBeLessThan(idxExamples);
    expect(idxExamples).toBeLessThan(idxPitfalls);
  });

  it("carries the voice directive and the tool name in the output-format block", async () => {
    const prompt = await buildTheorySystemPrompt(TEST_INPUT);
    expect(prompt).toContain("Editorial. Concise. Lowercase headings.");
    expect(prompt).toContain("No padding, no encouragement, no emojis.");
    expect(prompt).toContain("submit_theory_topic");
  });
});

// ---------------------------------------------------------------------------
// THEORY_SYSTEM_PROMPT_TEMPLATE byte parity (Phase 2, Task 15)
// ---------------------------------------------------------------------------

/**
 * Pins the contract: `applyTemplate(TEMPLATE, computeVars(inputs)).text`
 * MUST equal `buildTheorySystemPrompt(inputs)` byte-for-byte. Any drift
 * between the template and the live builder is caught here BEFORE
 * Task 16 routes both through `getPromptWithVarsOrFallback`.
 *
 * Why this matters: Anthropic's ephemeral prompt cache requires
 * byte-identical system blocks across theory-generator calls within
 * the 5-min window. Drift between the template and the in-code
 * builder silently breaks the cache and inflates theory cost.
 */
describe("THEORY_SYSTEM_PROMPT_TEMPLATE byte parity", () => {
  async function assertParity(inputs: TheoryPromptInputs): Promise<void> {
    // Builder is now async (Phase-2, Task 16). Fallback path (Langfuse
    // keys unset in CI) returns the template-substituted string, so
    // byte parity vs. local `applyTemplate(TEMPLATE, vars)` still holds.
    const builderOutput = await buildTheorySystemPrompt(inputs);
    const templateOutput = applyTemplate(
      THEORY_SYSTEM_PROMPT_TEMPLATE,
      computeTheoryPromptVars(inputs),
    );
    expect(templateOutput.missingVars).toEqual([]);
    expect(templateOutput.text).toBe(builderOutput);
  }

  it("base fixture: first ES grammar entry", async () => {
    await assertParity(TEST_INPUT);
  });

  it("survives a different (TR A1 vowel-harmony) input — exercises the LANGUAGE_NAMES lookup branch", async () => {
    // Different language + CEFR + content shape so the
    // `{{positiveExamplesBullets}}` / `{{commonErrorsBullets}}` /
    // `{{languageName}}` paths run on data distinct from the base fixture.
    const altEntry = trCurriculum.find((e) => e.kind === "grammar");
    if (!altEntry) {
      throw new Error("test fixture missing: no TR grammar entry available");
    }
    await assertParity({
      language: Language.TR,
      cefrLevel: altEntry.cefrLevel,
      grammarPoint: altEntry,
    });
  });
});

// ---------------------------------------------------------------------------
// buildTheoryUserPrompt
// ---------------------------------------------------------------------------

describe("buildTheoryUserPrompt", () => {
  it("is deterministic — same inputs return byte-identical strings", () => {
    expect(buildTheoryUserPrompt(TEST_INPUT)).toBe(
      buildTheoryUserPrompt(TEST_INPUT),
    );
  });

  it("renders the exact one-line template with name, key, and CEFR level", () => {
    expect(buildTheoryUserPrompt(TEST_INPUT)).toBe(
      `Produce the theory page for ${entry.name} (${entry.key}) at CEFR ${entry.cefrLevel}.`,
    );
  });
});

});
