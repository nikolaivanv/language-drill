import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";

import { esCurriculum } from "@language-drill/db";
import { type GrammarPoint, Language } from "@language-drill/shared";

import { GENERATION_MODEL } from "./generate.js";
import {
  THEORY_GENERATION_MODEL,
  THEORY_GENERATION_TOOL,
  THEORY_TOOL_NAME,
  type TheoryGenerationSpec,
  deriveTheoryTopicId,
  generateTheoryTopic,
  theoryDraftId,
  TheoryDraftMalformedError,
} from "./theory-generate.js";

// ---------------------------------------------------------------------------
// Fixtures — Phase 1 subjunctive theory page JSON
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const subjunctiveJson = readFileSync(
  join(
    __dirname,
    "../../db/scripts/__fixtures__/theory-json/subjunctive.json",
  ),
  "utf-8",
);
const subjunctiveFixture = JSON.parse(subjunctiveJson);

// ---------------------------------------------------------------------------
// Spec builder — pulls the first `kind: 'grammar'` ES entry from the
// curriculum (today: `es-b1-present-subjunctive`) so this test stays in lock-
// step with the curriculum reduction noted in packages/db/src/curriculum/
// index.ts:36-38. The grammar-point key is used by `deriveTheoryTopicId`; the
// page content asserted against `subjunctiveFixture` is independent of which
// curriculum entry seeded the spec.
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

// ---------------------------------------------------------------------------
// Stub Anthropic client helper
// ---------------------------------------------------------------------------

type StubOpts = {
  stopReason?: string;
  toolName?: string;
  usage?: Partial<Anthropic.Usage>;
};

function makeStubClient(toolUseInput: unknown, opts: StubOpts = {}): Anthropic {
  return {
    messages: {
      create: vi.fn(async () => ({
        content: [
          {
            type: "tool_use",
            name: opts.toolName ?? THEORY_TOOL_NAME,
            input: toolUseInput,
            id: "toolu_test",
          },
        ],
        usage: {
          input_tokens: 1500,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 800,
          ...opts.usage,
        },
        stop_reason: opts.stopReason ?? "tool_use",
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-6",
        stop_sequence: null,
      })),
    },
  } as unknown as Anthropic;
}

/** A stub whose `messages.create` resolves to a response with no tool_use block. */
function makeNoToolUseStubClient(): Anthropic {
  return {
    messages: {
      create: async () => ({
        content: [{ type: "text", text: "Sorry, I cannot do that." }],
        usage: {
          input_tokens: 1500,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          output_tokens: 800,
        },
        stop_reason: "max_tokens",
        id: "msg_test",
        type: "message",
        role: "assistant",
        model: "claude-sonnet-4-6",
        stop_sequence: null,
      }),
    },
  } as unknown as Anthropic;
}

/**
 * A stub whose `messages.create` returns a different tool_use input per call,
 * cycling on the last entry once the list is exhausted (so an all-malformed
 * run keeps returning the same malformed input). Tracks the call count so the
 * retry loop's attempt count can be asserted. Each call reports the same
 * fixed usage (1500 input / 800 output) so summed-usage math is predictable.
 */
function makeSequenceStubClient(inputs: unknown[]): {
  client: Anthropic;
  callCount: () => number;
} {
  let calls = 0;
  const client = {
    messages: {
      create: async () => {
        const input = inputs[Math.min(calls, inputs.length - 1)];
        calls += 1;
        return {
          content: [
            {
              type: "tool_use",
              name: THEORY_TOOL_NAME,
              input,
              id: "toolu_test",
            },
          ],
          usage: {
            input_tokens: 1500,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            output_tokens: 800,
          },
          stop_reason: "tool_use",
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-6",
          stop_sequence: null,
        };
      },
    },
  } as unknown as Anthropic;
  return { client, callCount: () => calls };
}

// ===========================================================================
// theory-generate / pure helpers
// ===========================================================================

describe("theory-generate / pure helpers", () => {
  // -------------------------------------------------------------------------
  // theoryDraftId determinism + distinct-input (Req 8.1.b, 8.1.c)
  // -------------------------------------------------------------------------

  describe("theoryDraftId", () => {
    it("is deterministic across 100 calls with the same spec (Req 8.1.b)", () => {
      const reference = theoryDraftId(baseSpec);
      for (let i = 0; i < 100; i++) {
        expect(theoryDraftId(baseSpec)).toBe(reference);
      }
    });

    it("produces distinct ids for distinct batchSeeds (Req 8.1.c)", () => {
      expect(theoryDraftId({ ...baseSpec, batchSeed: "a" })).not.toBe(
        theoryDraftId({ ...baseSpec, batchSeed: "b" }),
      );
    });
  });

  // -------------------------------------------------------------------------
  // deriveTheoryTopicId round-trips + rejects (Req 8.1.d, 8.1.e)
  // -------------------------------------------------------------------------

  describe("deriveTheoryTopicId", () => {
    it("round-trips ES, DE, TR keys (Req 8.1.d)", () => {
      expect(deriveTheoryTopicId("es-b1-x")).toBe("b1-x");
      expect(deriveTheoryTopicId("de-a2-x")).toBe("a2-x");
      expect(deriveTheoryTopicId("tr-b2-x")).toBe("b2-x");
    });

    it("rejects malformed keys (Req 8.1.e)", () => {
      const invalidKeys = ["invalid-key", "es-c1-x", "", "fr-b1-x"];
      for (const bad of invalidKeys) {
        expect(() => deriveTheoryTopicId(bad)).toThrow(
          /Invalid grammar point key/,
        );
      }
    });
  });

  // -------------------------------------------------------------------------
  // Model pin (Req 8.3)
  // -------------------------------------------------------------------------

  describe("theory-generate model pin (Req 8.3)", () => {
    it("THEORY_GENERATION_MODEL is pinned to claude-opus-4-8 (deliberately decoupled from GENERATION_MODEL)", () => {
      expect(THEORY_GENERATION_MODEL).toBe("claude-opus-4-8");
      // The exercise generator stays on Sonnet — theory intentionally runs a
      // stronger model (one page per cell, filled once, cost immaterial).
      expect(GENERATION_MODEL).toBe("claude-sonnet-4-6");
    });

    it("sends no sampling parameters (temperature is rejected with a 400 on Opus 4.8)", async () => {
      const client = makeStubClient(subjunctiveFixture);
      await generateTheoryTopic(client, baseSpec);
      const callArgs = (
        client.messages.create as ReturnType<typeof vi.fn>
      ).mock.calls[0][0] as Record<string, unknown>;
      expect(callArgs.model).toBe(THEORY_GENERATION_MODEL);
      expect(callArgs).not.toHaveProperty("temperature");
      expect(callArgs).not.toHaveProperty("top_p");
      expect(callArgs).not.toHaveProperty("top_k");
    });

    it("threads validatorFeedback into the user prompt on a feedback retry", async () => {
      const client = makeStubClient(subjunctiveFixture);
      await generateTheoryTopic(client, baseSpec, {
        validatorFeedback: ["wrong gender label on Wetter", "table row 2 typo"],
      });
      const callArgs = (
        client.messages.create as ReturnType<typeof vi.fn>
      ).mock.calls[0][0] as {
        messages: Array<{ content: string }>;
      };
      const userText = callArgs.messages[0].content;
      expect(userText).toContain("wrong gender label on Wetter");
      expect(userText).toContain("table row 2 typo");
      expect(userText).toContain("rejected by the quality validator");
    });
  });
});

// ===========================================================================
// theory-generate / generateTheoryTopic
// ===========================================================================

describe("theory-generate / generateTheoryTopic", () => {
  // -------------------------------------------------------------------------
  // Happy path (Req 8.1.a)
  // -------------------------------------------------------------------------

  it("returns a draft whose contentJson deep-equals the Phase 1 fixture and metadata reflects spec + usage (Req 8.1.a)", async () => {
    const client = makeStubClient(subjunctiveFixture);
    const { draft } = await generateTheoryTopic(client, baseSpec);

    expect(draft.id).toBe(theoryDraftId(baseSpec));
    expect(draft.topicId).toBe(
      deriveTheoryTopicId(baseSpec.grammarPoint.key),
    );
    expect(draft.metadata.modelId).toBe(THEORY_GENERATION_MODEL);
    expect(draft.contentJson).toEqual(subjunctiveFixture);
    expect(draft.metadata.inputTokens).toBe(1500);
    expect(draft.metadata.outputTokens).toBe(800);
    expect(draft.metadata.grammarPointKey).toBe(baseSpec.grammarPoint.key);
  });

  // -------------------------------------------------------------------------
  // EN reject (Req 8.1.g)
  // -------------------------------------------------------------------------

  it("rejects EN language with `resolved decision #5` (Req 8.1.g)", async () => {
    const enSpec = {
      ...baseSpec,
      language: Language.EN as unknown as typeof baseSpec.language,
    };
    const client = makeStubClient(subjunctiveFixture);
    await expect(generateTheoryTopic(client, enSpec)).rejects.toThrow(
      /resolved decision #5/,
    );
  });

  // -------------------------------------------------------------------------
  // Vocab reject (Req 8.1.f) — synthesize a kind:'vocab' entry because the
  // umbrella entries were removed in the 2026-05-10 curriculum reduction.
  // -------------------------------------------------------------------------

  it("rejects grammarPoint.kind === 'vocab' with `resolved decision #6` (Req 8.1.f)", async () => {
    const vocabPoint: GrammarPoint = {
      ...grammarEntry,
      kind: "vocab",
      key: "es-b1-vocab-umbrella",
    };
    const vocabSpec: TheoryGenerationSpec = {
      ...baseSpec,
      grammarPoint: vocabPoint,
    };
    const client = makeStubClient(subjunctiveFixture);
    await expect(generateTheoryTopic(client, vocabSpec)).rejects.toThrow(
      /resolved decision #6/,
    );
  });

  // -------------------------------------------------------------------------
  // No tool_use block (Req 8.1.h)
  // -------------------------------------------------------------------------

  it("throws when the response has no tool_use block (Req 8.1.h)", async () => {
    const client = makeNoToolUseStubClient();
    await expect(generateTheoryTopic(client, baseSpec)).rejects.toThrow(
      "Theory draft malformed: no tool_use block returned (stop_reason=max_tokens)",
    );
  });

  // -------------------------------------------------------------------------
  // Wrong tool name (Req 8.1.i)
  // -------------------------------------------------------------------------

  it("throws when the tool_use block uses an unexpected tool name (Req 8.1.i)", async () => {
    const client = makeStubClient(subjunctiveFixture, {
      toolName: "submit_other_thing",
    });
    await expect(generateTheoryTopic(client, baseSpec)).rejects.toThrow(
      /expected tool 'submit_theory_topic', got 'submit_other_thing'/,
    );
  });

  // -------------------------------------------------------------------------
  // Parser failure (Req 8.1.j)
  // -------------------------------------------------------------------------

  it("throws with the parser's path-prefixed message when the tool input is malformed (Req 8.1.j)", async () => {
    const client = makeStubClient({ id: "x" });
    let caught: unknown;
    try {
      await generateTheoryTopic(client, baseSpec);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
    const message = (caught as Error).message;
    expect(message).toMatch(/^Theory draft malformed: Invalid/);
    expect(message).toMatch(/Invalid title.*must be present/);
  });

  // -------------------------------------------------------------------------
  // Regenerate-on-malformed retry loop (Req 1.3, 1.4, 1.9, 2.3, 2.5)
  // -------------------------------------------------------------------------

  const expectedCellKey =
    `${baseSpec.language}:${baseSpec.cefrLevel}:${baseSpec.grammarPoint.key}`.toLowerCase();

  it("regenerates a malformed draft and succeeds on a later attempt, summing usage (Req 1.3, 2.3)", async () => {
    // Attempt 0 returns a malformed input ({ id: 'x' } fails the parser);
    // attempt 1 returns the valid fixture. This is the captured-shape recovery
    // exercised at the pipeline level (repair can't fix it; the retry does).
    const { client, callCount } = makeSequenceStubClient([
      { id: "x" },
      subjunctiveFixture,
    ]);
    const { draft, tokenUsage } = await generateTheoryTopic(client, baseSpec);

    expect(callCount()).toBe(2);
    expect(draft.contentJson).toEqual(subjunctiveFixture);
    // Summed across both attempts (1500 + 1500 input, 800 + 800 output).
    expect(tokenUsage.inputTokens).toBe(3000);
    expect(tokenUsage.outputTokens).toBe(1600);
    // draft.metadata describes only the winning attempt.
    expect(draft.metadata.inputTokens).toBe(1500);
    expect(draft.metadata.outputTokens).toBe(800);
  });

  it("throws TheoryDraftMalformedError with summed non-zero usage after exhausting retries (Req 1.9, 2.3, 2.5)", async () => {
    const { client, callCount } = makeSequenceStubClient([{ id: "x" }]);
    let caught: unknown;
    try {
      await generateTheoryTopic(client, baseSpec, { maxRetries: 2 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(TheoryDraftMalformedError);
    expect(callCount()).toBe(3); // initial attempt + 2 retries
    const usage = (caught as TheoryDraftMalformedError).tokenUsage;
    expect(usage.inputTokens).toBe(4500); // 3 attempts × 1500
    expect(usage.outputTokens).toBe(2400); // 3 attempts × 800
  });

  it("emits exactly one warn log line per retry, carrying the cell key (Req 1.4)", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const { client } = makeSequenceStubClient([{ id: "x" }, subjunctiveFixture]);
      await generateTheoryTopic(client, baseSpec);

      const warnLines = logSpy.mock.calls
        .map((c) => {
          try {
            return JSON.parse(c[0] as string) as Record<string, unknown>;
          } catch {
            return null;
          }
        })
        .filter(
          (o) => o?.message === "theory draft malformed — regenerating",
        );

      expect(warnLines).toHaveLength(1); // one retry → one line
      expect(warnLines[0]!.level).toBe("warn");
      expect(warnLines[0]!.attempt).toBe(0);
      expect(warnLines[0]!.cellKey).toBe(expectedCellKey);
    } finally {
      logSpy.mockRestore();
    }
  });

  it("does not call Claude for the EN top guard — no usage, no retry (Req 1.3)", async () => {
    const { client, callCount } = makeSequenceStubClient([subjunctiveFixture]);
    const enSpec = {
      ...baseSpec,
      language: Language.EN as unknown as typeof baseSpec.language,
    };
    await expect(generateTheoryTopic(client, enSpec)).rejects.toThrow(
      /resolved decision #5/,
    );
    expect(callCount()).toBe(0);
  });
});

// ===========================================================================
// theory-generate / tool schema shape (Req 8.2)
// ===========================================================================

describe("theory-generate / tool schema (Req 8.2)", () => {
  // The `input_schema` is typed as Anthropic.Tool.InputSchema which permits
  // arbitrary extra keys. Cast to a plain record so we can walk `$defs`.
  const schema = THEORY_GENERATION_TOOL.input_schema as unknown as Record<
    string,
    unknown
  >;
  const $defs = schema.$defs as Record<string, unknown>;

  it("top-level required array equals ['id', 'title', 'subtitle', 'cefr', 'sections']", () => {
    expect(schema.required).toEqual([
      "id",
      "title",
      "subtitle",
      "cefr",
      "sections",
    ]);
  });

  it("$defs.block.oneOf enumerates the five block kinds", () => {
    const block = $defs.block as { oneOf: unknown[] };
    expect(block.oneOf).toHaveLength(5);
    const expectedBlockKinds = new Set([
      "paragraph",
      "callout",
      "example",
      "list",
      "conjugation-table",
    ]);
    const seenKinds = new Set<string>();
    for (const arm of block.oneOf) {
      const ref = (arm as { $ref: string }).$ref;
      // Resolve `#/$defs/<name>` → $defs[<name>]
      const armName = ref.replace("#/$defs/", "");
      const armDef = $defs[armName] as {
        properties: { kind: { const: string } };
      };
      const kindConst = armDef.properties.kind.const;
      expect(expectedBlockKinds.has(kindConst)).toBe(true);
      seenKinds.add(kindConst);
    }
    expect(seenKinds).toEqual(expectedBlockKinds);
  });

  it("$defs.inline.oneOf enumerates the five inline kinds", () => {
    const inline = $defs.inline as { oneOf: unknown[] };
    expect(inline.oneOf).toHaveLength(5);
    const expectedInlineKinds = new Set([
      "text",
      "strong",
      "em",
      "hilite",
      "mono",
    ]);
    const seenKinds = new Set<string>();
    for (const arm of inline.oneOf) {
      const ref = (arm as { $ref: string }).$ref;
      const armName = ref.replace("#/$defs/", "");
      const armDef = $defs[armName] as {
        properties: { kind: { const: string } };
      };
      const kindConst = armDef.properties.kind.const;
      expect(expectedInlineKinds.has(kindConst)).toBe(true);
      seenKinds.add(kindConst);
    }
    expect(seenKinds).toEqual(expectedInlineKinds);
  });

  it("$defs.blockExample.required includes kind, target, en but NOT note", () => {
    const blockExample = $defs.blockExample as { required: string[] };
    expect(blockExample.required).toContain("kind");
    expect(blockExample.required).toContain("target");
    expect(blockExample.required).toContain("en");
    expect(blockExample.required).not.toContain("note");
  });
});

