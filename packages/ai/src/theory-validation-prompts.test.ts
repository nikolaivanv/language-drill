import { describe, expect, it } from "vitest";

import { esCurriculum } from "@language-drill/db";
import { Language, type TheoryTopicJson } from "@language-drill/shared";

import type { TheoryDraft, TheoryGenerationSpec } from "./theory-generate.js";
import {
  buildTheoryValidationSystemPrompt,
  buildTheoryValidationUserPrompt,
  THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE,
} from "./theory-validation-prompts.js";
import { THEORY_VALIDATION_THRESHOLDS } from "./theory-validation-thresholds.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const grammarEntry = esCurriculum.find((e) => e.kind === "grammar");
if (!grammarEntry) {
  throw new Error(
    "test fixture missing: no `kind: 'grammar'` entry in esCurriculum",
  );
}

const baseSpec: TheoryGenerationSpec = {
  language: Language.ES,
  cefrLevel: grammarEntry.cefrLevel,
  grammarPoint: grammarEntry,
  batchSeed: "test-seed",
};

const sampleTopic: TheoryTopicJson = {
  id: "b1-sample",
  title: "Sample Topic",
  subtitle: "A sample page",
  cefr: "B1",
  sections: [
    {
      id: "what-is-it",
      title: "what is it?",
      body: [
        {
          kind: "paragraph",
          text: [{ kind: "text", text: "Sample content." }],
        },
      ],
    },
  ],
};

function makeDraft(content: TheoryTopicJson = sampleTopic): TheoryDraft {
  return {
    id: "00000000-0000-0000-0000-000000000000",
    topicId: "b1-sample",
    contentJson: content,
    metadata: {
      grammarPointKey: grammarEntry!.key,
      modelId: "claude-sonnet-4-5",
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    },
  };
}

// ---------------------------------------------------------------------------
// THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE — structural anchors (Req 2.1)
// ---------------------------------------------------------------------------

describe("THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE", () => {
  it("contains every section heading expected by buildTheoryValidationSystemPrompt", () => {
    expect(THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE).toContain(
      "## Grammar point context",
    );
    expect(THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE).toContain(
      "## Positive examples",
    );
    expect(THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE).toContain(
      "## Common learner errors",
    );
    expect(THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE).toContain(
      "## CEFR level descriptors",
    );
    expect(THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE).toContain(
      "## Required sections",
    );
    expect(THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE).toContain(
      "## Routing implication of your scores",
    );
    expect(THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE).toContain(
      "## Dimensions to score",
    );
    expect(THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE).toContain("## Output");
  });

  it("names the submit_theory_validation_result tool in the closing directive", () => {
    expect(THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE).toContain(
      "submit_theory_validation_result",
    );
  });
});

// ---------------------------------------------------------------------------
// buildTheoryValidationSystemPrompt
// ---------------------------------------------------------------------------

describe("buildTheoryValidationSystemPrompt", () => {
  it("is deterministic — same spec returns identical bytes (Req 2.2, cache invariant)", () => {
    const a = buildTheoryValidationSystemPrompt(baseSpec);
    const b = buildTheoryValidationSystemPrompt(baseSpec);
    expect(a).toBe(b);
  });

  it("inlines the grammar-point name, description, positive examples, and common errors verbatim (Req 2.1)", () => {
    const prompt = buildTheoryValidationSystemPrompt(baseSpec);
    expect(prompt).toContain(grammarEntry.name);
    expect(prompt).toContain(grammarEntry.description);
    for (const example of grammarEntry.examplesPositive) {
      expect(prompt).toContain(example);
    }
    for (const error of grammarEntry.commonErrors) {
      expect(prompt).toContain(error);
    }
  });

  it("includes the CEFR level both in the role line and in the level descriptors block", () => {
    const prompt = buildTheoryValidationSystemPrompt(baseSpec);
    expect(prompt).toContain(`CEFR ${baseSpec.cefrLevel}`);
    // The descriptor block uses `- **A1**:`, `- **B1**:`, etc.
    expect(prompt).toContain(`- **${baseSpec.cefrLevel}**:`);
  });

  it("interpolates the routing thresholds from THEORY_VALIDATION_THRESHOLDS (Req 2.5)", () => {
    const prompt = buildTheoryValidationSystemPrompt(baseSpec);
    expect(prompt).toContain(
      THEORY_VALIDATION_THRESHOLDS.flagQualityFloor.toString(),
    );
    expect(prompt).toContain(
      THEORY_VALIDATION_THRESHOLDS.approveQualityFloor.toString(),
    );
  });

  it("lists the five required sections in generator order (Req 2.1 design Component 2)", () => {
    const prompt = buildTheoryValidationSystemPrompt(baseSpec);
    const sections = [
      "what is it?",
      "when to use it",
      "formation",
      "examples in context",
      "common pitfalls",
    ];
    let cursor = -1;
    for (const section of sections) {
      const idx = prompt.indexOf(section, cursor + 1);
      expect(idx, `section '${section}' missing or out of order`).toBeGreaterThan(
        cursor,
      );
      cursor = idx;
    }
  });

  it("closes with the submit_theory_validation_result tool directive", () => {
    const prompt = buildTheoryValidationSystemPrompt(baseSpec);
    expect(prompt).toContain(
      "You MUST use the submit_theory_validation_result tool",
    );
  });

  it("does NOT include draft-specific content (Req 2.4 — spec-only system prompt)", () => {
    const prompt = buildTheoryValidationSystemPrompt(baseSpec);
    // The draft's topicId, batchSeed, or any draft-side metadata must not leak
    // into the cacheable system prompt.
    expect(prompt).not.toContain("b1-sample");
    expect(prompt).not.toContain("test-seed");
    expect(prompt).not.toContain("Sample content.");
  });
});

// ---------------------------------------------------------------------------
// buildTheoryValidationUserPrompt
// ---------------------------------------------------------------------------

describe("buildTheoryValidationUserPrompt", () => {
  it("embeds the draft's contentJson as pretty-printed JSON (Req 2.3)", () => {
    const draft = makeDraft();
    const userPrompt = buildTheoryValidationUserPrompt(draft, baseSpec);
    expect(userPrompt).toContain(
      JSON.stringify(draft.contentJson, null, 2),
    );
  });

  it("names the grammar point key and CEFR level in the directive", () => {
    const userPrompt = buildTheoryValidationUserPrompt(makeDraft(), baseSpec);
    expect(userPrompt).toContain(baseSpec.grammarPoint.key);
    expect(userPrompt).toContain(`CEFR ${baseSpec.cefrLevel}`);
  });

  it("wraps the JSON in a fenced code block so Claude parses it as data, not prose", () => {
    const userPrompt = buildTheoryValidationUserPrompt(makeDraft(), baseSpec);
    expect(userPrompt).toContain("```json");
    expect(userPrompt).toContain("```");
  });

  it("is deterministic — same (draft, spec) returns identical bytes", () => {
    const draft = makeDraft();
    const a = buildTheoryValidationUserPrompt(draft, baseSpec);
    const b = buildTheoryValidationUserPrompt(draft, baseSpec);
    expect(a).toBe(b);
  });
});
