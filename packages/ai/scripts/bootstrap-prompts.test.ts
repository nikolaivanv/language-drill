/**
 * Unit tests for `bootstrap-prompts.ts` (Phase 2 Task 20).
 *
 * Stubs the Langfuse client via the `LangfusePromptClient` port so the SDK
 * never spins up; assertions cover the four documented cases:
 *
 *   (a) fresh project — every prompt is missing → 6 creates
 *   (b) all exist → 0 creates, 6 skips
 *   (c) one exists, five missing → 5 creates, 1 skip
 *   (d) --dry-run → 0 actual creates, 6 entries marked as "would create"
 *
 * Plus a fail-loud check for `api.promptsList` outages (we refuse to
 * create blind when we can't tell what exists), and a pagination smoke
 * test to confirm the page loop terminates correctly.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  bootstrapPrompts,
  checkPrompts,
  PROMPTS,
  unifiedDiff,
  type BootstrapPromptsOptions,
  type CheckPromptsOptions,
  type LangfusePromptClient,
  type PromptManifestEntry,
} from "./bootstrap-prompts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Two-row manifest stand-in for the production six. Letting tests work
 * against a small, named set keeps the assertion arithmetic obvious AND
 * exercises the same code paths as the full set (the loop body doesn't
 * care how many rows there are).
 */
const TWO_PROMPT_FIXTURE: readonly PromptManifestEntry[] = [
  {
    name: "prompt-a",
    text: "prompt A body",
    version: "a@2026-05-12",
    surface: "evaluate",
  },
  {
    name: "prompt-b",
    text: "prompt B body",
    version: "b@2026-05-12",
    surface: "annotate",
  },
];

const FIXED_NOW = new Date("2026-05-17T12:00:00.000Z");

/**
 * Build a one-page `api.promptsList` response. The SDK paginates, but six
 * prompts always fit on page 1 — multi-page behaviour is exercised
 * explicitly in the pagination test below.
 */
function makeListResp(
  names: readonly string[],
  meta: { totalPages: number; page: number } = { totalPages: 1, page: 1 },
): { data: ReadonlyArray<{ name: string }>; meta: { totalPages: number; page: number } } {
  return { data: names.map((name) => ({ name })), meta };
}

function makeStubClient(impl: {
  promptsList?: LangfusePromptClient["api"]["promptsList"];
  getPrompt?: LangfusePromptClient["getPrompt"];
  createPrompt?: LangfusePromptClient["createPrompt"];
} = {}): {
  client: LangfusePromptClient;
  promptsList: ReturnType<typeof vi.fn>;
  getPrompt: ReturnType<typeof vi.fn>;
  createPrompt: ReturnType<typeof vi.fn>;
} {
  // Default: empty production-label list → "fresh project" semantics.
  const promptsList = vi.fn(
    impl.promptsList ?? (async () => makeListResp([])),
  );
  const getPrompt = vi.fn(
    impl.getPrompt ?? (async () => ({ version: 1, prompt: "x" })),
  );
  const createPrompt = vi.fn(
    impl.createPrompt ?? (async () => ({ id: "ok" })),
  );
  return {
    client: { api: { promptsList }, getPrompt, createPrompt },
    promptsList,
    getPrompt,
    createPrompt,
  };
}

function baseOpts(
  overrides: Partial<BootstrapPromptsOptions> & {
    langfuse: LangfusePromptClient;
  },
): BootstrapPromptsOptions {
  return {
    dryRun: false,
    prompts: TWO_PROMPT_FIXTURE,
    now: () => FIXED_NOW,
    log: () => {
      /* suppress test output */
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Manifest sanity — make sure the production prompts are all wired up
// ---------------------------------------------------------------------------

describe("PROMPTS manifest", () => {
  it("contains exactly seven entries — one per registered Langfuse prompt", () => {
    // Bumps here are intentional: adding/removing a prompt should be a
    // PR-level conversation, not silently slip past the test gate.
    expect(PROMPTS).toHaveLength(7);
  });

  it("registers every surface listed in design Component 4", () => {
    const surfaces = new Set(PROMPTS.map((p) => p.surface));
    expect(surfaces).toEqual(
      new Set([
        "evaluate",
        "annotate",
        "generate",
        "validate",
        "theory-generate",
        "theory-validate",
        "read-span",
      ]),
    );
  });

  it("uses unique Langfuse prompt names (manifest is a registry key set)", () => {
    const names = new Set(PROMPTS.map((p) => p.name));
    expect(names.size).toBe(PROMPTS.length);
  });

  it("uses canonical `<surface>-system-prompt` naming so dashboards group by feature tag", () => {
    for (const p of PROMPTS) {
      expect(p.name).toMatch(/-system-prompt$/);
    }
  });
});

// ---------------------------------------------------------------------------
// Default mode — write path
// ---------------------------------------------------------------------------

describe("bootstrapPrompts — fresh project (case a)", () => {
  it("creates every prompt when the production-label list is empty, stamping localVersion/surface/registeredAt", async () => {
    const { client, promptsList, getPrompt, createPrompt } = makeStubClient();

    const result = await bootstrapPrompts(baseOpts({ langfuse: client }));

    expect(result.created).toEqual(["prompt-a", "prompt-b"]);
    expect(result.skipped).toEqual([]);
    expect(result.errors).toEqual([]);

    // One list call up front replaces per-prompt getPrompt probes — that's
    // the whole point of the refactor (no SDK-level 404 stderr noise).
    expect(promptsList).toHaveBeenCalledTimes(1);
    expect(promptsList).toHaveBeenCalledWith({
      label: "production",
      limit: 100,
      page: 1,
    });
    expect(getPrompt).not.toHaveBeenCalled();

    expect(createPrompt).toHaveBeenCalledTimes(2);
    expect(createPrompt).toHaveBeenNthCalledWith(1, {
      name: "prompt-a",
      prompt: "prompt A body",
      labels: ["production"],
      type: "text",
      config: {
        localVersion: "a@2026-05-12",
        surface: "evaluate",
        registeredAt: FIXED_NOW.toISOString(),
      },
    });
  });
});

// ---------------------------------------------------------------------------
// Default mode — all already exist
// ---------------------------------------------------------------------------

describe("bootstrapPrompts — all prompts exist (case b)", () => {
  it("makes zero createPrompt calls when every prompt is in the production-label list", async () => {
    const { client, promptsList, createPrompt } = makeStubClient({
      promptsList: async () => makeListResp(["prompt-a", "prompt-b"]),
    });

    const result = await bootstrapPrompts(baseOpts({ langfuse: client }));

    expect(result.created).toEqual([]);
    expect(result.skipped).toEqual(["prompt-a", "prompt-b"]);
    expect(result.errors).toEqual([]);
    expect(promptsList).toHaveBeenCalledTimes(1);
    expect(createPrompt).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Default mode — partial create
// ---------------------------------------------------------------------------

describe("bootstrapPrompts — partial create (case c)", () => {
  it("creates only the missing prompts when one of two already exists", async () => {
    // prompt-a exists; prompt-b doesn't.
    const { client, createPrompt } = makeStubClient({
      promptsList: async () => makeListResp(["prompt-a"]),
    });

    const result = await bootstrapPrompts(baseOpts({ langfuse: client }));

    expect(result.skipped).toEqual(["prompt-a"]);
    expect(result.created).toEqual(["prompt-b"]);
    expect(result.errors).toEqual([]);
    expect(createPrompt).toHaveBeenCalledTimes(1);
    expect(createPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ name: "prompt-b" }),
    );
  });
});

// ---------------------------------------------------------------------------
// Dry-run — no writes, full log
// ---------------------------------------------------------------------------

describe("bootstrapPrompts — --dry-run (case d)", () => {
  it("does NOT call createPrompt and records each missing prompt as 'would create'", async () => {
    const log = vi.fn();
    const { client, createPrompt } = makeStubClient();

    const result = await bootstrapPrompts(
      baseOpts({ langfuse: client, dryRun: true, log }),
    );

    expect(result.created).toEqual(["prompt-a", "prompt-b"]);
    expect(createPrompt).not.toHaveBeenCalled();

    // Two "[dry-run] would create …" lines, one per missing prompt.
    const dryRunLogs = log.mock.calls.filter((args) =>
      typeof args[0] === "string" && args[0].includes("[dry-run]"),
    );
    expect(dryRunLogs).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Hard failures — promptsList outage → no writes, every entry errored
// ---------------------------------------------------------------------------

describe("bootstrapPrompts — promptsList fails", () => {
  it("records every manifest entry as errored and skips ALL creates when the list call throws", async () => {
    // Auth failure / network outage / 500 → unknown API state → refuse to
    // create. The bootstrap can't tell whether prompts already exist, so
    // creating blind risks duplicating production-labeled prompts.
    const authErr = Object.assign(new Error("Unauthorized"), { status: 401 });
    const { client, createPrompt } = makeStubClient({
      promptsList: vi.fn().mockRejectedValue(authErr),
    });

    const result = await bootstrapPrompts(baseOpts({ langfuse: client }));

    expect(result.created).toEqual([]);
    expect(result.skipped).toEqual([]);
    expect(result.errors).toHaveLength(2);
    expect(result.errors).toEqual([
      { name: "prompt-a", error: authErr },
      { name: "prompt-b", error: authErr },
    ]);
    expect(createPrompt).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Pagination — `promptsList` page loop terminates correctly
// ---------------------------------------------------------------------------

describe("bootstrapPrompts — paginated list", () => {
  it("walks every page of the promptsList response before deciding what to create", async () => {
    // prompt-a returned on page 1, prompt-b returned on page 2.
    // Both should be in the seen-set → 0 creates.
    const promptsList = vi
      .fn()
      .mockResolvedValueOnce(
        makeListResp(["prompt-a"], { totalPages: 2, page: 1 }),
      )
      .mockResolvedValueOnce(
        makeListResp(["prompt-b"], { totalPages: 2, page: 2 }),
      );
    const { client, createPrompt } = makeStubClient({ promptsList });

    const result = await bootstrapPrompts(baseOpts({ langfuse: client }));

    expect(promptsList).toHaveBeenCalledTimes(2);
    expect(promptsList).toHaveBeenNthCalledWith(1, {
      label: "production",
      limit: 100,
      page: 1,
    });
    expect(promptsList).toHaveBeenNthCalledWith(2, {
      label: "production",
      limit: 100,
      page: 2,
    });
    expect(result.skipped).toEqual(["prompt-a", "prompt-b"]);
    expect(result.created).toEqual([]);
    expect(createPrompt).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// createPrompt failure is per-row, not fatal
// ---------------------------------------------------------------------------

describe("bootstrapPrompts — createPrompt fails after a successful 404", () => {
  beforeEach(() => {
    // No-op: makes intent explicit. vi state is per-test by default.
  });

  it("records the write failure but continues with subsequent prompts", async () => {
    const writeErr = new Error("upstream write timeout");
    const createImpl = vi
      .fn()
      .mockRejectedValueOnce(writeErr)
      .mockResolvedValueOnce({ id: "ok" });
    const { client } = makeStubClient({
      createPrompt: createImpl,
    });

    const result = await bootstrapPrompts(baseOpts({ langfuse: client }));

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ name: "prompt-a", error: writeErr });
    expect(result.created).toEqual(["prompt-b"]);
  });
});

// ---------------------------------------------------------------------------
// unifiedDiff — line-based LCS diff (Task 21)
// ---------------------------------------------------------------------------

describe("unifiedDiff", () => {
  it("returns an all-context diff for identical strings", () => {
    const diff = unifiedDiff("alpha\nbeta\ngamma", "alpha\nbeta\ngamma");
    expect(diff).toBe("  alpha\n  beta\n  gamma");
  });

  it("marks removed and added lines around a single-line change", () => {
    const diff = unifiedDiff(
      "alpha\nbeta\ngamma",
      "alpha\nBETA\ngamma",
    );
    // Order matters — `-` lines come before `+` lines around the diverging
    // region, matching `diff -u` convention.
    expect(diff).toContain("- beta");
    expect(diff).toContain("+ BETA");
    expect(diff).toContain("  alpha");
    expect(diff).toContain("  gamma");
  });

  it("handles pure insertion", () => {
    const diff = unifiedDiff("alpha\ngamma", "alpha\nbeta\ngamma");
    expect(diff).toContain("+ beta");
    expect(diff).not.toContain("- beta");
  });

  it("handles pure deletion", () => {
    const diff = unifiedDiff("alpha\nbeta\ngamma", "alpha\ngamma");
    expect(diff).toContain("- beta");
    expect(diff).not.toContain("+ beta");
  });
});

// ---------------------------------------------------------------------------
// checkPrompts — drift-detection mode (Task 21)
// ---------------------------------------------------------------------------

function baseCheckOpts(
  overrides: Partial<CheckPromptsOptions> & {
    langfuse: LangfusePromptClient;
  },
): CheckPromptsOptions {
  return {
    prompts: TWO_PROMPT_FIXTURE,
    log: () => {
      /* suppress test output */
    },
    ...overrides,
  };
}

describe("checkPrompts — all match (case a)", () => {
  it("reports every prompt as matched when the live body equals the in-repo source", async () => {
    const getPrompt = vi
      .fn()
      .mockResolvedValueOnce({ version: 7, prompt: TWO_PROMPT_FIXTURE[0].text })
      .mockResolvedValueOnce({ version: 4, prompt: TWO_PROMPT_FIXTURE[1].text });
    const log = vi.fn();
    const { client } = makeStubClient({ getPrompt });

    const result = await checkPrompts(baseCheckOpts({ langfuse: client, log }));

    expect(result.matched).toEqual(["prompt-a", "prompt-b"]);
    expect(result.mismatched).toEqual([]);
    expect(result.errors).toEqual([]);

    // Every fetch goes to the `production` label with the SDK's own cache
    // disabled — bootstrap is the source of truth, not the SDK's cache.
    expect(getPrompt).toHaveBeenCalledWith(
      "prompt-a",
      undefined,
      { label: "production", cacheTtlSeconds: 0 },
    );
    // No mismatch log fired.
    for (const call of log.mock.calls) {
      expect(String(call[0] ?? "")).not.toContain("DRIFTED");
    }
  });
});

describe("checkPrompts — drift detected (case b)", () => {
  it("flags the drifted prompt, prints a unified diff, and lets the CLI exit 1 via the result", async () => {
    const driftedLive = TWO_PROMPT_FIXTURE[0].text.replace("A body", "A BODY");
    const getPrompt = vi
      .fn()
      .mockResolvedValueOnce({ version: 9, prompt: driftedLive })
      .mockResolvedValueOnce({ version: 4, prompt: TWO_PROMPT_FIXTURE[1].text });
    const log = vi.fn();
    const { client } = makeStubClient({ getPrompt });

    const result = await checkPrompts(baseCheckOpts({ langfuse: client, log }));

    expect(result.matched).toEqual(["prompt-b"]);
    expect(result.mismatched).toHaveLength(1);
    expect(result.mismatched[0].name).toBe("prompt-a");
    expect(result.mismatched[0].diff).toContain("- prompt A body");
    expect(result.mismatched[0].diff).toContain("+ prompt A BODY");
    expect(result.errors).toEqual([]);

    // The CLI exit-code branch keys off `mismatched.length > 0` — so a
    // visible "DRIFTED" log line is the operator-facing signal that this
    // run will exit non-zero.
    const driftLogs = log.mock.calls.filter((args) =>
      typeof args[0] === "string" && args[0].includes("DRIFTED"),
    );
    expect(driftLogs).toHaveLength(1);
  });
});

describe("checkPrompts — Langfuse outage (case c)", () => {
  it("records the fetch failure with an explanatory error", async () => {
    const networkErr = new Error("ECONNRESET");
    const getPrompt = vi.fn().mockRejectedValue(networkErr);
    const log = vi.fn();
    const { client } = makeStubClient({ getPrompt });

    const result = await checkPrompts(baseCheckOpts({ langfuse: client, log }));

    expect(result.matched).toEqual([]);
    expect(result.mismatched).toEqual([]);
    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toMatchObject({
      name: "prompt-a",
      error: networkErr,
    });
    // The CLI maps `errors.length > 0` to exit 1 — confirm operator-facing
    // log includes the prompt name so they know which surface to diagnose.
    expect(
      log.mock.calls.some(
        (args) => typeof args[0] === "string" && args[0].includes("prompt-a"),
      ),
    ).toBe(true);
  });

  it("treats a 404 as drift signal (not a missing-prompt cue)", async () => {
    // In --check mode, "the prompt doesn't exist" IS a drift — the operator
    // wanted to confirm Langfuse matches main, and a missing prompt means it
    // doesn't. The default-mode path (bootstrapPrompts) would create here;
    // checkPrompts records an error so the CLI exits 1.
    const notFound = Object.assign(new Error("Prompt not found"), { status: 404 });
    const getPrompt = vi
      .fn()
      .mockRejectedValueOnce(notFound)
      .mockResolvedValueOnce({ version: 4, prompt: TWO_PROMPT_FIXTURE[1].text });
    const { client } = makeStubClient({ getPrompt });

    const result = await checkPrompts(baseCheckOpts({ langfuse: client }));

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ name: "prompt-a" });
    expect(result.matched).toEqual(["prompt-b"]);
  });

  it("records an error when the live prompt object is missing the `prompt` field", async () => {
    // Defensive: future SDK shape changes shouldn't silently pass a check.
    const getPrompt = vi.fn().mockResolvedValue({ version: 7 /* no prompt */ });
    const { client } = makeStubClient({ getPrompt });

    const result = await checkPrompts(baseCheckOpts({ langfuse: client }));

    expect(result.matched).toEqual([]);
    expect(result.mismatched).toEqual([]);
    expect(result.errors).toHaveLength(2);
    expect(String(result.errors[0].error)).toMatch(/unreadable/i);
  });
});
