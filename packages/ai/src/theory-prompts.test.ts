import { describe, it, expect } from "vitest";
import { Language } from "@language-drill/shared";
import { esCurriculum } from "@language-drill/db";

import {
  buildTheorySystemPrompt,
  buildTheoryUserPrompt,
  type TheoryPromptInputs,
} from "./theory-prompts.js";

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
  it("is deterministic — same inputs return byte-identical strings", () => {
    expect(buildTheorySystemPrompt(TEST_INPUT)).toBe(
      buildTheorySystemPrompt(TEST_INPUT),
    );
  });

  it("inlines the grammar-point description, positive examples, and common errors verbatim", () => {
    const prompt = buildTheorySystemPrompt(TEST_INPUT);
    expect(prompt).toContain(entry.description);
    for (const example of entry.examplesPositive) {
      expect(prompt).toContain(example);
    }
    for (const error of entry.commonErrors) {
      expect(prompt).toContain(error);
    }
  });

  it("renders the five required sections in canonical order", () => {
    const prompt = buildTheorySystemPrompt(TEST_INPUT);

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

  it("carries the voice directive and the tool name in the output-format block", () => {
    const prompt = buildTheorySystemPrompt(TEST_INPUT);
    expect(prompt).toContain("Editorial. Concise. Lowercase headings.");
    expect(prompt).toContain("No padding, no encouragement, no emojis.");
    expect(prompt).toContain("submit_theory_topic");
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
