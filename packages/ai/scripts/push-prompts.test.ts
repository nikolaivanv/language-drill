/**
 * Unit tests for `push-prompts.ts`.
 *
 * Stubs the Langfuse client via the `LangfusePromptClient` port (reused from
 * bootstrap-prompts) so the SDK never spins up. `pushDriftedPrompts` layers
 * a create-new-version step on top of the already-tested `checkPrompts`, so
 * these tests focus on the new behaviour:
 *
 *   (a) pushes ONLY drifted prompts; in-sync ones are skipped untouched
 *   (b) the new version carries the `production` label + localVersion config
 *   (c) --dry-run makes zero createPrompt calls
 *   (d) all-in-sync → zero pushes
 *   (e) drift-detection error → aborts with NO writes
 *   (f) a per-prompt createPrompt failure is recorded but doesn't abort
 */

import { describe, expect, it, vi } from "vitest";

import {
  type LangfusePromptClient,
  type PromptManifestEntry,
} from "./bootstrap-prompts";
import { pushDriftedPrompts, type PushPromptsOptions } from "./push-prompts";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TWO_PROMPT_FIXTURE: readonly PromptManifestEntry[] = [
  { name: "prompt-a", text: "prompt A body", version: "a@2026-05-12", surface: "evaluate" },
  { name: "prompt-b", text: "prompt B body", version: "b@2026-05-12", surface: "annotate" },
];

const FIXED_NOW = new Date("2026-05-24T12:00:00.000Z");

/**
 * Stub the port. `getPrompt` resolves from a name→{version,prompt} map (the
 * core calls it once during drift detection and again to read the prior
 * version, so a keyed map is more robust than `mockResolvedValueOnce`).
 */
function makeStubClient(opts: {
  bodies?: Record<string, { version: number; prompt: string }>;
  getPrompt?: LangfusePromptClient["getPrompt"];
  createPrompt?: LangfusePromptClient["createPrompt"];
}): {
  client: LangfusePromptClient;
  getPrompt: ReturnType<typeof vi.fn>;
  createPrompt: ReturnType<typeof vi.fn>;
} {
  const getPrompt = vi.fn(
    opts.getPrompt ??
      (async (name: string) => {
        const body = opts.bodies?.[name];
        if (!body) throw new Error(`no fixture body for ${name}`);
        return body;
      }),
  );
  const createPrompt = vi.fn(opts.createPrompt ?? (async () => ({ id: "ok" })));
  return {
    client: { api: { promptsList: vi.fn() }, getPrompt, createPrompt },
    getPrompt,
    createPrompt,
  };
}

function baseOpts(
  overrides: Partial<PushPromptsOptions> & { langfuse: LangfusePromptClient },
): PushPromptsOptions {
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
// (a) + (b) — push only drifted, stamping label + config
// ---------------------------------------------------------------------------

describe("pushDriftedPrompts — partial drift", () => {
  it("pushes only the drifted prompt and leaves the in-sync one untouched", async () => {
    // prompt-a matches in-repo (in sync); prompt-b's live body is stale.
    const { client, createPrompt } = makeStubClient({
      bodies: {
        "prompt-a": { version: 5, prompt: "prompt A body" },
        "prompt-b": { version: 1, prompt: "STALE prompt B body" },
      },
    });

    const result = await pushDriftedPrompts(baseOpts({ langfuse: client }));

    expect(result.pushed).toEqual(["prompt-b"]);
    expect(result.skipped).toEqual(["prompt-a"]);
    expect(result.aborted).toBe(false);
    expect(result.errors).toEqual([]);

    expect(createPrompt).toHaveBeenCalledTimes(1);
    expect(createPrompt).toHaveBeenCalledWith({
      name: "prompt-b",
      prompt: "prompt B body",
      labels: ["production"],
      type: "text",
      config: {
        localVersion: "b@2026-05-12",
        surface: "annotate",
        registeredAt: FIXED_NOW.toISOString(),
      },
    });
  });
});

// ---------------------------------------------------------------------------
// (c) — dry-run writes nothing
// ---------------------------------------------------------------------------

describe("pushDriftedPrompts — --dry-run", () => {
  it("reports would-push prompts without calling createPrompt", async () => {
    const log = vi.fn();
    const { client, createPrompt } = makeStubClient({
      bodies: {
        "prompt-a": { version: 1, prompt: "STALE a" },
        "prompt-b": { version: 1, prompt: "STALE b" },
      },
    });

    const result = await pushDriftedPrompts(
      baseOpts({ langfuse: client, dryRun: true, log }),
    );

    expect(result.pushed).toEqual(["prompt-a", "prompt-b"]);
    expect(createPrompt).not.toHaveBeenCalled();
    const dryRunLogs = log.mock.calls.filter(
      (args) => typeof args[0] === "string" && args[0].includes("[dry-run]"),
    );
    expect(dryRunLogs).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// (d) — nothing to push
// ---------------------------------------------------------------------------

describe("pushDriftedPrompts — all in sync", () => {
  it("pushes nothing when every live body matches the in-repo source", async () => {
    const { client, createPrompt } = makeStubClient({
      bodies: {
        "prompt-a": { version: 3, prompt: "prompt A body" },
        "prompt-b": { version: 3, prompt: "prompt B body" },
      },
    });

    const result = await pushDriftedPrompts(baseOpts({ langfuse: client }));

    expect(result.pushed).toEqual([]);
    expect(result.skipped).toEqual(["prompt-a", "prompt-b"]);
    expect(createPrompt).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (e) — drift-detection error aborts with no writes
// ---------------------------------------------------------------------------

describe("pushDriftedPrompts — drift check errors", () => {
  it("aborts without writing when a prompt fetch fails during drift detection", async () => {
    const netErr = new Error("ECONNRESET");
    const { client, createPrompt } = makeStubClient({
      getPrompt: vi.fn().mockRejectedValue(netErr),
    });

    const result = await pushDriftedPrompts(baseOpts({ langfuse: client }));

    expect(result.aborted).toBe(true);
    expect(result.pushed).toEqual([]);
    expect(result.errors).toHaveLength(2);
    expect(createPrompt).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// (f) — per-prompt write failure is isolated
// ---------------------------------------------------------------------------

describe("pushDriftedPrompts — createPrompt fails on one row", () => {
  it("records the write failure and continues with the rest", async () => {
    const writeErr = new Error("upstream write timeout");
    const createPrompt = vi
      .fn()
      .mockRejectedValueOnce(writeErr)
      .mockResolvedValueOnce({ id: "ok" });
    const { client } = makeStubClient({
      bodies: {
        "prompt-a": { version: 1, prompt: "STALE a" },
        "prompt-b": { version: 1, prompt: "STALE b" },
      },
      createPrompt,
    });

    const result = await pushDriftedPrompts(baseOpts({ langfuse: client }));

    expect(result.aborted).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatchObject({ name: "prompt-a", error: writeErr });
    expect(result.pushed).toEqual(["prompt-b"]);
  });
});
