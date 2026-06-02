import { describe, expect, it } from "vitest";

import { esCurriculum, trCurriculum } from "@language-drill/db";
import { Language, type TheoryTopicJson } from "@language-drill/shared";

import type { TheoryDraft, TheoryGenerationSpec } from "./theory-generate.js";
import {
  buildTheoryValidationSystemPrompt,
  buildTheoryValidationUserPrompt,
  computeTheoryValidationPromptVars,
  THEORY_VALIDATION_PROMPT_VERSION,
  THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE,
} from "./theory-validation-prompts.js";
import { THEORY_VALIDATION_THRESHOLDS } from "./theory-validation-thresholds.js";
import { applyTemplate } from "./prompts-registry.js";

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
// THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE byte parity (Phase 2, Task 17)
// ---------------------------------------------------------------------------

/**
 * Pins the contract: `applyTemplate(TEMPLATE, computeVars(spec)).text`
 * MUST equal `buildTheoryValidationSystemPrompt(spec)` byte-for-byte.
 * The pre-Phase-2 template used nested-path placeholders
 * (`{{grammarPoint.name}}`, `{{CEFR_DESCRIPTORS}}`) that the Mustache
 * subset doesn't resolve; this block proves the rewritten flat-string
 * template is a true drop-in for the live builder before Task 18
 * routes both through `getPromptWithVarsOrFallback`.
 *
 * Why this matters: Anthropic's ephemeral prompt cache requires
 * byte-identical system blocks across theory-validator calls within
 * the 5-min window. Drift between the template and the in-code
 * builder silently breaks the cache and inflates validation cost.
 */
describe("THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE byte parity", () => {
  async function assertParity(spec: TheoryGenerationSpec): Promise<void> {
    // Builder is now async (Phase-2, Task 18). Fallback path (Langfuse
    // keys unset in CI) returns the template-substituted string, so byte
    // parity vs. local `applyTemplate(TEMPLATE, vars)` still holds.
    const builderOutput = await buildTheoryValidationSystemPrompt(spec);
    const templateOutput = applyTemplate(
      THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE,
      computeTheoryValidationPromptVars(spec),
    );
    expect(templateOutput.missingVars).toEqual([]);
    expect(templateOutput.text).toBe(builderOutput);
  }

  it("ES base fixture (first grammar entry)", async () => {
    await assertParity(baseSpec);
  });

  it("survives a different language input (TR cross-language coverage)", async () => {
    // Different language exercises the `{{languageName}}` LANGUAGE_NAMES
    // lookup branch with content distinct from the base fixture.
    const altEntry = trCurriculum.find((e) => e.kind === "grammar");
    if (!altEntry) {
      throw new Error("test fixture missing: no TR grammar entry available");
    }
    await assertParity({
      language: Language.TR,
      cefrLevel: altEntry.cefrLevel,
      grammarPoint: altEntry,
      batchSeed: "test-seed",
    });
  });
});

// ---------------------------------------------------------------------------
// buildTheoryValidationSystemPrompt
// ---------------------------------------------------------------------------

describe("buildTheoryValidationSystemPrompt", () => {
  it("is deterministic — same spec returns identical bytes (Req 2.2, cache invariant)", async () => {
    const [a, b] = await Promise.all([
      buildTheoryValidationSystemPrompt(baseSpec),
      buildTheoryValidationSystemPrompt(baseSpec),
    ]);
    expect(a).toBe(b);
  });

  it("inlines the grammar-point name, description, positive examples, and common errors verbatim (Req 2.1)", async () => {
    const prompt = await buildTheoryValidationSystemPrompt(baseSpec);
    expect(prompt).toContain(grammarEntry.name);
    expect(prompt).toContain(grammarEntry.description);
    for (const example of grammarEntry.examplesPositive) {
      expect(prompt).toContain(example);
    }
    for (const error of grammarEntry.commonErrors) {
      expect(prompt).toContain(error);
    }
  });

  it("includes the CEFR level both in the role line and in the level descriptors block", async () => {
    const prompt = await buildTheoryValidationSystemPrompt(baseSpec);
    expect(prompt).toContain(`CEFR ${baseSpec.cefrLevel}`);
    // The descriptor block uses `- **A1**:`, `- **B1**:`, etc.
    expect(prompt).toContain(`- **${baseSpec.cefrLevel}**:`);
  });

  it("interpolates the routing thresholds from THEORY_VALIDATION_THRESHOLDS (Req 2.5)", async () => {
    const prompt = await buildTheoryValidationSystemPrompt(baseSpec);
    expect(prompt).toContain(
      THEORY_VALIDATION_THRESHOLDS.flagQualityFloor.toString(),
    );
    expect(prompt).toContain(
      THEORY_VALIDATION_THRESHOLDS.approveQualityFloor.toString(),
    );
  });

  it("lists the five required sections in generator order (Req 2.1 design Component 2)", async () => {
    const prompt = await buildTheoryValidationSystemPrompt(baseSpec);
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

  it("closes with the submit_theory_validation_result tool directive", async () => {
    const prompt = await buildTheoryValidationSystemPrompt(baseSpec);
    expect(prompt).toContain(
      "You MUST use the submit_theory_validation_result tool",
    );
  });

  // R5.1/R5.2/R5.4: flaggedReasons must carry one concise final reason per
  // issue — no validator chain-of-thought leaking into error_message / the
  // reviewer UI. Model behavior isn't unit-testable, so we pin the
  // instruction's presence in the rendered prompt.
  it("instructs concise flaggedReasons with no chain-of-thought (R5.1/R5.2)", async () => {
    const prompt = await buildTheoryValidationSystemPrompt(baseSpec);
    expect(prompt).toContain("one concise final reason per issue");
    expect(prompt).toContain(
      "no step-by-step reasoning, self-correction, or hedging",
    );
  });

  it("does NOT include draft-specific content (Req 2.4 — spec-only system prompt)", async () => {
    const prompt = await buildTheoryValidationSystemPrompt(baseSpec);
    // The draft's topicId, batchSeed, or any draft-side metadata must not leak
    // into the cacheable system prompt.
    expect(prompt).not.toContain("b1-sample");
    expect(prompt).not.toContain("test-seed");
    expect(prompt).not.toContain("Sample content.");
  });
});

// ---------------------------------------------------------------------------
// Prompt version (R5.3)
// ---------------------------------------------------------------------------

describe("THEORY_VALIDATION_PROMPT_VERSION", () => {
  // Bumped in the same change as the R5.1 concise-flaggedReasons edit so
  // Langfuse dashboards cohort the new prompt traces separately from the old.
  it("is the dated version for the concise-flaggedReasons edit", () => {
    expect(THEORY_VALIDATION_PROMPT_VERSION).toBe("theory-validate@2026-06-02");
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
