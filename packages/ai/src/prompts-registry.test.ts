/**
 * Skeleton-contract tests for `prompts-registry.ts` (Phase 2, Task 4).
 *
 * These pin the public API so that the call sites in tasks 7–18 can swap
 * `EVALUATION_SYSTEM_PROMPT` for `await getPromptOrFallback(...)` without
 * any behavioral drift before the real fetch (Tasks 5 + 6) lands.
 *
 * Tests for the real cache + fetch + timeout / outage paths grow into
 * this same file in Tasks 5 + 6.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Langfuse } from "langfuse";
import { CefrLevel, ExerciseType, Language } from "@language-drill/shared";

import {
  __resetForTests as __resetObservabilityForTests,
  getCurrentLlmTraceContext,
  withLlmTrace,
  type LlmTraceContext,
} from "./observability.js";
import {
  __resetRegistryForTests,
  applyTemplate,
  getPromptOrFallback,
  getPromptWithVarsOrFallback,
  LANGFUSE_PROMPT_CACHE_TTL_MS,
  LANGFUSE_PROMPT_FETCH_TIMEOUT_MS,
  PROMPT_LABEL_PRODUCTION,
  raceWithTimeout,
} from "./prompts-registry.js";

// Hoisted mock for the Langfuse SDK constructor. Each test installs a
// per-case `getPrompt` impl via `vi.mocked(Langfuse).mockImplementationOnce`.
// Pattern mirrors `observability.test.ts` so behavior across both suites
// stays consistent.
vi.mock("langfuse", () => {
  const LangfuseMock = vi.fn(function (this: {
    flushAsync: () => Promise<void>;
    getPrompt: ReturnType<typeof vi.fn>;
  }) {
    this.flushAsync = vi.fn().mockResolvedValue(undefined);
    // Default: any test that doesn't supply its own getPrompt impl will
    // see a Langfuse instance whose getPrompt rejects with "not configured"
    // — surfaces unwired tests loudly.
    this.getPrompt = vi.fn().mockRejectedValue(new Error("getPrompt not configured for this test"));
  });
  return { Langfuse: LangfuseMock };
});

// ---------------------------------------------------------------------------
// Env-var + singleton state hygiene
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  "LANGFUSE_PUBLIC_KEY",
  "LANGFUSE_SECRET_KEY",
  "LANGFUSE_BASE_URL",
  "LANGFUSE_PROMPT_CACHE_TTL_MS",
  "LANGFUSE_PROMPT_FETCH_TIMEOUT_MS",
] as const;

const envSnapshot = new Map<string, string | undefined>();

beforeEach(() => {
  for (const k of ENV_KEYS) {
    envSnapshot.set(k, process.env[k]);
    delete process.env[k];
  }
  __resetRegistryForTests();
  __resetObservabilityForTests();
  vi.mocked(Langfuse).mockClear();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    const v = envSnapshot.get(k);
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  __resetRegistryForTests();
  __resetObservabilityForTests();
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<LlmTraceContext> = {}): LlmTraceContext {
  return {
    feature: "evaluate",
    env: "dev",
    promptVersion: "pending",
    requestId: "test-request-001",
    userId: "dev_user_001",
    language: Language.ES,
    cefrLevel: CefrLevel.B1,
    exerciseType: ExerciseType.CLOZE,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

describe("public constants", () => {
  it("exports the 5-minute cache TTL aligned with Anthropic ephemeral cache", () => {
    expect(LANGFUSE_PROMPT_CACHE_TTL_MS).toBe(300_000);
  });

  it("exports a 250 ms fetch-timeout cap", () => {
    expect(LANGFUSE_PROMPT_FETCH_TIMEOUT_MS).toBe(250);
  });

  it("exports the Langfuse 'production' label as a single source of truth", () => {
    expect(PROMPT_LABEL_PRODUCTION).toBe("production");
  });
});

// ---------------------------------------------------------------------------
// applyTemplate — Mustache-subset substituter (Req 3 AC 1)
// ---------------------------------------------------------------------------

describe("applyTemplate", () => {
  it("substitutes flat `{{var}}` placeholders from the vars record", () => {
    const result = applyTemplate("{{a}} and {{b}}", { a: "foo", b: "bar" });
    expect(result).toEqual({ text: "foo and bar", missingVars: [] });
  });

  it("leaves missing placeholders in place AND reports them in missingVars", () => {
    const result = applyTemplate("Hello {{name}}, you are {{age}}", {
      name: "Val",
    });
    expect(result.text).toBe("Hello Val, you are {{age}}");
    expect(result.missingVars).toEqual(["age"]);
  });

  it("substitutes every occurrence of a repeated `{{key}}`", () => {
    const result = applyTemplate("{{x}} + {{x}} = {{y}}", {
      x: "1",
      y: "2",
    });
    expect(result.text).toBe("1 + 1 = 2");
    expect(result.missingVars).toEqual([]);
  });

  it("leaves the literal `{{}}` (empty key) alone — not a valid placeholder", () => {
    const result = applyTemplate("Before {{}} after", {});
    expect(result.text).toBe("Before {{}} after");
    expect(result.missingVars).toEqual([]);
  });

  it("leaves the literal `{{a-b}}` (non-word char) alone — `\\w+` only", () => {
    // Hyphenated identifiers are NOT valid placeholders. Keeping the
    // restriction tight makes Langfuse's compile(vars) and applyTemplate
    // produce the same output for any input — required for prompt-cache
    // parity (Req 3 AC 2).
    const result = applyTemplate("{{a-b}} {{a_b}}", { a_b: "ok" });
    expect(result.text).toBe("{{a-b}} ok");
    expect(result.missingVars).toEqual([]);
  });

  it("accumulates duplicate missing keys (one entry per occurrence)", () => {
    // Surface multi-occurrence misses so callers can see how many times
    // the bad placeholder appears.
    const result = applyTemplate("{{x}} {{x}} {{y}}", {});
    expect(result.text).toBe("{{x}} {{x}} {{y}}");
    expect(result.missingVars).toEqual(["x", "x", "y"]);
  });

  it("handles a template with no placeholders by returning it unchanged", () => {
    const result = applyTemplate("plain text", { unused: "ignored" });
    expect(result.text).toBe("plain text");
    expect(result.missingVars).toEqual([]);
  });

  it("handles empty-string substitution", () => {
    const result = applyTemplate("{{a}}|{{b}}", { a: "", b: "x" });
    expect(result.text).toBe("|x");
    expect(result.missingVars).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// getPromptOrFallback — skeleton no-op contract (Req 2 AC 2, 2 AC 6)
// ---------------------------------------------------------------------------

describe("getPromptOrFallback (skeleton)", () => {
  it("returns the in-repo fallback when LANGFUSE_PUBLIC_KEY is unset", async () => {
    // beforeEach already cleared the env vars; assert it's still unset.
    expect(process.env.LANGFUSE_PUBLIC_KEY).toBeUndefined();

    const resolved = await getPromptOrFallback(
      "evaluate-system-prompt",
      "fallback-text",
      "v1",
    );

    expect(resolved).toEqual({
      text: "fallback-text",
      version: "fallback:v1",
      fromFallback: true,
    });
  });

  it("calls setResolvedPromptVersion with the fallback version inside a withLlmTrace scope", async () => {
    await withLlmTrace(makeCtx({ promptVersion: "pending" }), async () => {
      await getPromptOrFallback(
        "evaluate-system-prompt",
        "fallback-text",
        "evaluate@2026-05-12",
      );
      const ctx = getCurrentLlmTraceContext();
      expect(ctx?.promptVersion).toBe("fallback:evaluate@2026-05-12");
      expect(ctx?.promptFallback).toBe(true);
      // No live Langfuse client to link — `setResolvedPromptClient(null)`
      // pairs with the fallback version so the trace records without a
      // prompt link (matches the `fallback:` cohort semantics).
      expect(ctx?.promptClient).toBeNull();
    });
  });

  it("is a no-op outside a withLlmTrace scope (still returns the fallback)", async () => {
    // No `withLlmTrace` wrap. setResolvedPromptVersion silently no-ops,
    // and the function still returns the correct shape.
    const resolved = await getPromptOrFallback("x", "fallback-text", "v1");
    expect(resolved).toMatchObject({
      text: "fallback-text",
      version: "fallback:v1",
      fromFallback: true,
    });
    expect(getCurrentLlmTraceContext()).toBeUndefined();
  });

  it("accepts an explicit label argument without affecting the fallback path", async () => {
    const resolved = await getPromptOrFallback(
      "evaluate-system-prompt",
      "fallback-text",
      "v1",
      "candidate-2026-05-15",
    );
    // The label is plumbed into the (real) fetch in Task 5; in the
    // skeleton it's accepted but ignored. The fallback shape MUST be
    // identical to the default-label call so call-site code is uniform.
    expect(resolved).toEqual({
      text: "fallback-text",
      version: "fallback:v1",
      fromFallback: true,
    });
  });
});

// ---------------------------------------------------------------------------
// getPromptWithVarsOrFallback — fallback (LF-unset) path (Req 3 AC 4)
// ---------------------------------------------------------------------------

describe("getPromptWithVarsOrFallback (Langfuse unset)", () => {
  it("substitutes the in-repo template via applyTemplate when LANGFUSE_PUBLIC_KEY is unset", async () => {
    const template = "Hello {{name}}, level {{cefr}}.";
    const resolved = await getPromptWithVarsOrFallback(
      "generate-system-prompt",
      template,
      "generate@2026-05-12",
      { name: "Val", cefr: "B1" },
    );

    expect(resolved).toEqual({
      text: "Hello Val, level B1.",
      version: "fallback:generate@2026-05-12",
      fromFallback: true,
    });
  });

  it("leaves un-substituted placeholders in place when a var is missing", async () => {
    // Bare-skeleton behavior: applyTemplate leaves `{{name}}` alone if
    // not supplied. The real Task 6 path will warn-and-fall-back; today
    // the skeleton just exercises applyTemplate semantics.
    const resolved = await getPromptWithVarsOrFallback(
      "generate-system-prompt",
      "Hello {{name}}, level {{cefr}}.",
      "generate@2026-05-12",
      { cefr: "B1" },
    );

    expect(resolved.text).toBe("Hello {{name}}, level B1.");
    expect(resolved.fromFallback).toBe(true);
  });

  it("calls setResolvedPromptVersion inside a withLlmTrace scope", async () => {
    await withLlmTrace(makeCtx({ promptVersion: "pending" }), async () => {
      await getPromptWithVarsOrFallback(
        "generate-system-prompt",
        "Hello {{name}}",
        "generate@2026-05-12",
        { name: "world" },
      );
      const ctx = getCurrentLlmTraceContext();
      expect(ctx?.promptVersion).toBe("fallback:generate@2026-05-12");
      expect(ctx?.promptFallback).toBe(true);
      // No live client on the LF-unset fallback path.
      expect(ctx?.promptClient).toBeNull();
    });
  });
});

// ---------------------------------------------------------------------------
// __resetRegistryForTests — callable no-op in the skeleton
// ---------------------------------------------------------------------------

describe("__resetRegistryForTests", () => {
  it("is callable and returns undefined", () => {
    expect(__resetRegistryForTests()).toBeUndefined();
  });

  it("can be called repeatedly without throwing", () => {
    expect(() => {
      __resetRegistryForTests();
      __resetRegistryForTests();
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// raceWithTimeout — exported helper used by fetchOrFallback (Req 2 AC 5)
// ---------------------------------------------------------------------------

describe("raceWithTimeout", () => {
  it("resolves when the inner promise resolves before the timeout", async () => {
    const value = await raceWithTimeout(
      Promise.resolve("ok"),
      1000,
      "test-fast-path",
    );
    expect(value).toBe("ok");
  });

  it("rejects with a labelled timeout error when the inner promise stalls", async () => {
    vi.useFakeTimers();
    const stalling = new Promise<string>(() => {
      // never resolves
    });
    const racing = raceWithTimeout(stalling, 250, "test-stall");
    // Attach a rejection handler immediately so the rejection on advance
    // doesn't trip the "unhandled rejection" check.
    const settled = expect(racing).rejects.toThrow(/timeout 250ms: test-stall/);
    await vi.advanceTimersByTimeAsync(250);
    await settled;
  });

  it("propagates the inner promise's rejection (not the timeout) when it rejects first", async () => {
    const err = new Error("inner fail");
    await expect(
      raceWithTimeout(Promise.reject(err), 1000, "test-reject"),
    ).rejects.toThrow("inner fail");
  });
});

// ---------------------------------------------------------------------------
// getPromptOrFallback — real fetch path (Req 2 AC 1, 2.3, 2.4, 2.5, 2.6)
// ---------------------------------------------------------------------------

/**
 * Install a per-case Langfuse mock whose `getPrompt` returns the supplied
 * value. The returned spy can be inspected via `spy.getPrompt.mock.calls`.
 */
function installLangfuseGetPromptMock(impl: {
  prompt: string;
  version: number;
}): { getPrompt: ReturnType<typeof vi.fn> } {
  const getPrompt = vi.fn().mockResolvedValue(impl);
  vi.mocked(Langfuse).mockImplementationOnce(function (
    this: {
      flushAsync: () => Promise<void>;
      getPrompt: typeof getPrompt;
    },
  ) {
    this.flushAsync = vi.fn().mockResolvedValue(undefined);
    this.getPrompt = getPrompt;
  });
  return { getPrompt };
}

describe("getPromptOrFallback (real fetch)", () => {
  beforeEach(() => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-test";
  });

  it("returns the Langfuse text + 'langfuse:N' version on a successful fetch", async () => {
    const { getPrompt } = installLangfuseGetPromptMock({
      prompt: "live-langfuse-text",
      version: 7,
    });

    const resolved = await getPromptOrFallback(
      "evaluate-system-prompt",
      "fallback-text",
      "evaluate@2026-05-12",
    );

    expect(resolved).toEqual({
      text: "live-langfuse-text",
      version: "langfuse:7",
      fromFallback: false,
    });
    expect(getPrompt).toHaveBeenCalledTimes(1);
    expect(getPrompt).toHaveBeenCalledWith(
      "evaluate-system-prompt",
      undefined,
      { label: PROMPT_LABEL_PRODUCTION, cacheTtlSeconds: 0 },
    );
  });

  it("calls setResolvedPromptVersion with the Langfuse version (no fallback flag)", async () => {
    installLangfuseGetPromptMock({ prompt: "live", version: 3 });
    await withLlmTrace(makeCtx({ promptVersion: "pending" }), async () => {
      await getPromptOrFallback(
        "evaluate-system-prompt",
        "fallback-text",
        "evaluate@2026-05-12",
      );
      const ctx = getCurrentLlmTraceContext();
      expect(ctx?.promptVersion).toBe("langfuse:3");
      expect(ctx?.promptFallback).toBe(false);
      // The live `TextPromptClient` lands on the ALS frame so
      // `startLangfuseGeneration` can pass it to `trace.generation` and
      // Langfuse renders the clickable "Prompt: <name>@v<n>" pill.
      expect(ctx?.promptClient).toMatchObject({ prompt: "live", version: 3 });
    });
  });

  it("falls back + warns once when getPrompt throws", async () => {
    vi.mocked(Langfuse).mockImplementationOnce(function (
      this: {
        flushAsync: () => Promise<void>;
        getPrompt: ReturnType<typeof vi.fn>;
      },
    ) {
      this.flushAsync = vi.fn().mockResolvedValue(undefined);
      this.getPrompt = vi.fn().mockRejectedValue(new Error("LF 503"));
    });

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const a = await getPromptOrFallback(
      "evaluate-system-prompt",
      "fallback-text",
      "v1",
    );
    expect(a).toMatchObject({
      text: "fallback-text",
      version: "fallback:v1",
      fromFallback: true,
    });

    // Second call within the cache TTL serves from cache — so no second
    // network attempt and no second warn. Reset the cache to force a
    // refetch, then confirm warn-once still holds across the second
    // failed fetch.
    __resetRegistryForTests();
    vi.mocked(Langfuse).mockImplementationOnce(function (
      this: {
        flushAsync: () => Promise<void>;
        getPrompt: ReturnType<typeof vi.fn>;
      },
    ) {
      this.flushAsync = vi.fn().mockResolvedValue(undefined);
      this.getPrompt = vi.fn().mockRejectedValue(new Error("LF 503 again"));
    });
    __resetObservabilityForTests();
    const b = await getPromptOrFallback(
      "evaluate-system-prompt",
      "fallback-text",
      "v1",
    );
    expect(b.fromFallback).toBe(true);
    // BUT: warnedNames was cleared by __resetRegistryForTests, so we
    // expect a SECOND warn here in this test setup. The "warn-once per
    // cold start" guarantee is per-process, and __resetRegistryForTests
    // is the analog of a cold start. So total = 2 in this test.
    expect(warnSpy).toHaveBeenCalledTimes(2);
    expect(warnSpy.mock.calls[0][0]).toContain("evaluate-system-prompt");
    warnSpy.mockRestore();
  });

  it("warns exactly once across multiple in-the-same-cold-start failures", async () => {
    // Both calls fail; warnedNames persists across the cache eviction,
    // so the second failure does NOT re-warn.
    vi.mocked(Langfuse).mockImplementationOnce(function (
      this: {
        flushAsync: () => Promise<void>;
        getPrompt: ReturnType<typeof vi.fn>;
      },
    ) {
      this.flushAsync = vi.fn().mockResolvedValue(undefined);
      this.getPrompt = vi.fn().mockRejectedValue(new Error("LF 503"));
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await getPromptOrFallback("evaluate-system-prompt", "fb", "v1");
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // Force a cache eviction for the same name (TTL=0 override → expire
    // instantly). Same Langfuse singleton, same prompt name → no second
    // warn.
    process.env.LANGFUSE_PROMPT_CACHE_TTL_MS = "1";
    await new Promise((r) => setTimeout(r, 5));
    await getPromptOrFallback("evaluate-system-prompt", "fb", "v1");
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("falls back when getPrompt exceeds LANGFUSE_PROMPT_FETCH_TIMEOUT_MS", async () => {
    process.env.LANGFUSE_PROMPT_FETCH_TIMEOUT_MS = "50";
    vi.mocked(Langfuse).mockImplementationOnce(function (
      this: {
        flushAsync: () => Promise<void>;
        getPrompt: ReturnType<typeof vi.fn>;
      },
    ) {
      this.flushAsync = vi.fn().mockResolvedValue(undefined);
      // Hangs forever — race against the 50 ms timeout.
      this.getPrompt = vi.fn().mockImplementation(
        () => new Promise(() => {}),
      );
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const t0 = Date.now();
    const resolved = await getPromptOrFallback(
      "evaluate-system-prompt",
      "fallback-text",
      "v1",
    );
    const elapsed = Date.now() - t0;

    expect(resolved).toMatchObject({
      text: "fallback-text",
      version: "fallback:v1",
      fromFallback: true,
    });
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(500);
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][1]).toBeInstanceOf(Error);
    expect((warnSpy.mock.calls[0][1] as Error).message).toMatch(/timeout/);
    warnSpy.mockRestore();
  });

  it("serves from cache within the TTL — second call does not re-enter the SDK", async () => {
    const { getPrompt } = installLangfuseGetPromptMock({
      prompt: "live-v7",
      version: 7,
    });

    const a = await getPromptOrFallback("evaluate-system-prompt", "fb", "v1");
    const b = await getPromptOrFallback("evaluate-system-prompt", "fb", "v1");
    expect(a).toEqual(b);
    expect(getPrompt).toHaveBeenCalledTimes(1);
  });

  it("re-fetches once the cache entry expires past LANGFUSE_PROMPT_CACHE_TTL_MS", async () => {
    process.env.LANGFUSE_PROMPT_CACHE_TTL_MS = "1"; // 1 ms TTL — expires almost instantly
    const getPrompt = vi
      .fn()
      .mockResolvedValueOnce({ prompt: "live-v7", version: 7 })
      .mockResolvedValueOnce({ prompt: "live-v8", version: 8 });
    vi.mocked(Langfuse).mockImplementationOnce(function (
      this: {
        flushAsync: () => Promise<void>;
        getPrompt: typeof getPrompt;
      },
    ) {
      this.flushAsync = vi.fn().mockResolvedValue(undefined);
      this.getPrompt = getPrompt;
    });

    const a = await getPromptOrFallback("evaluate-system-prompt", "fb", "v1");
    expect(a.version).toBe("langfuse:7");

    // Wait beyond TTL.
    await new Promise((r) => setTimeout(r, 10));

    const b = await getPromptOrFallback("evaluate-system-prompt", "fb", "v1");
    expect(b.version).toBe("langfuse:8");
    expect(getPrompt).toHaveBeenCalledTimes(2);
  });

  it("separately caches different labels under the same prompt name", async () => {
    const getPrompt = vi
      .fn()
      .mockImplementation(
        async (_name: string, _version: unknown, opts: { label: string }) =>
          opts.label === PROMPT_LABEL_PRODUCTION
            ? { prompt: "prod-text", version: 7 }
            : { prompt: "candidate-text", version: 8 },
      );
    vi.mocked(Langfuse).mockImplementationOnce(function (
      this: {
        flushAsync: () => Promise<void>;
        getPrompt: typeof getPrompt;
      },
    ) {
      this.flushAsync = vi.fn().mockResolvedValue(undefined);
      this.getPrompt = getPrompt;
    });

    const prod = await getPromptOrFallback(
      "evaluate-system-prompt",
      "fb",
      "v1",
    );
    const candidate = await getPromptOrFallback(
      "evaluate-system-prompt",
      "fb",
      "v1",
      "candidate-2026-05-20",
    );
    expect(prod.text).toBe("prod-text");
    expect(candidate.text).toBe("candidate-text");
    expect(getPrompt).toHaveBeenCalledTimes(2);
    // Subsequent calls for either label served from cache.
    await getPromptOrFallback("evaluate-system-prompt", "fb", "v1");
    await getPromptOrFallback(
      "evaluate-system-prompt",
      "fb",
      "v1",
      "candidate-2026-05-20",
    );
    expect(getPrompt).toHaveBeenCalledTimes(2);
  });
});

// ---------------------------------------------------------------------------
// getPromptWithVarsOrFallback — real fetch + compile (Req 3 AC 1, 2, 3, 4)
// ---------------------------------------------------------------------------

/**
 * Install a per-case Langfuse mock whose `getPrompt` returns a
 * `TextPromptClient`-shaped object with the supplied `prompt`, `version`,
 * and `compile` impl. Mirrors `installLangfuseGetPromptMock` above, but
 * for the templated path that needs `compile()` to be a callable.
 */
function installLangfuseTemplatedMock(impl: {
  prompt: string;
  version: number;
  compile: (vars: Record<string, string>) => string;
}): {
  getPrompt: ReturnType<typeof vi.fn>;
  compile: ReturnType<typeof vi.fn>;
} {
  const compile = vi.fn(impl.compile);
  const promptClient = {
    prompt: impl.prompt,
    version: impl.version,
    compile,
  };
  const getPrompt = vi.fn().mockResolvedValue(promptClient);
  vi.mocked(Langfuse).mockImplementationOnce(function (
    this: {
      flushAsync: () => Promise<void>;
      getPrompt: typeof getPrompt;
    },
  ) {
    this.flushAsync = vi.fn().mockResolvedValue(undefined);
    this.getPrompt = getPrompt;
  });
  return { getPrompt, compile };
}

describe("getPromptWithVarsOrFallback (real fetch + compile)", () => {
  beforeEach(() => {
    process.env.LANGFUSE_PUBLIC_KEY = "pk-test";
    process.env.LANGFUSE_SECRET_KEY = "sk-test";
  });

  it("calls TextPromptClient.compile(vars) and returns its output on a Langfuse hit", async () => {
    const { compile } = installLangfuseTemplatedMock({
      prompt: "Hello {{name}}, level {{cefr}}.",
      version: 4,
      compile: (vars) => `Hello ${vars.name}, level ${vars.cefr}.`,
    });

    const resolved = await getPromptWithVarsOrFallback(
      "generate-system-prompt",
      "fallback {{name}} fallback {{cefr}}",
      "generate@2026-05-12",
      { name: "Val", cefr: "B1" },
    );

    expect(resolved).toEqual({
      text: "Hello Val, level B1.",
      version: "langfuse:4",
      fromFallback: false,
    });
    expect(compile).toHaveBeenCalledTimes(1);
    expect(compile).toHaveBeenCalledWith({ name: "Val", cefr: "B1" });
  });

  it("propagates 'langfuse:N' version + fromFallback=false to setResolvedPromptVersion on success", async () => {
    installLangfuseTemplatedMock({
      prompt: "Hello {{name}}",
      version: 9,
      compile: (vars) => `Hello ${vars.name}`,
    });
    await withLlmTrace(makeCtx({ promptVersion: "pending" }), async () => {
      await getPromptWithVarsOrFallback(
        "generate-system-prompt",
        "Hello {{name}}",
        "generate@2026-05-12",
        { name: "world" },
      );
      const ctx = getCurrentLlmTraceContext();
      expect(ctx?.promptVersion).toBe("langfuse:9");
      expect(ctx?.promptFallback).toBe(false);
      // Live templated client lands on the ALS frame on the success path,
      // identical to the static-prompt branch.
      expect(ctx?.promptClient).toMatchObject({ version: 9 });
    });
  });

  it("falls back when the Langfuse template introduces an unfilled {{var}} the builder didn't pass", async () => {
    // Langfuse template references a `{{newField}}` placeholder the caller
    // doesn't know about. compile() leaves it in place; the registry
    // detects the leftover and refuses to ship a half-substituted prompt.
    installLangfuseTemplatedMock({
      prompt: "Hello {{name}} ({{newField}})",
      version: 5,
      compile: (vars) =>
        `Hello ${vars.name ?? "{{name}}"} (${vars.newField ?? "{{newField}}"})`,
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const resolved = await getPromptWithVarsOrFallback(
      "generate-system-prompt",
      "Hello {{name}} fallback",
      "generate@2026-05-12",
      { name: "Val" },
    );

    expect(resolved).toEqual({
      text: "Hello Val fallback",
      version: "fallback:generate@2026-05-12",
      fromFallback: true,
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("unfilled vars");
    expect(warnSpy.mock.calls[0][0]).toContain("newField");
    warnSpy.mockRestore();
  });

  it("falls back + warns once when TextPromptClient.compile throws", async () => {
    installLangfuseTemplatedMock({
      prompt: "Hello {{name}}",
      version: 6,
      compile: () => {
        throw new Error("mustache parse error");
      },
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const resolved = await getPromptWithVarsOrFallback(
      "generate-system-prompt",
      "fallback {{name}}",
      "generate@2026-05-12",
      { name: "Val" },
    );

    expect(resolved).toEqual({
      text: "fallback Val",
      version: "fallback:generate@2026-05-12",
      fromFallback: true,
    });
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy.mock.calls[0][0]).toContain("compile failed");
    expect(warnSpy.mock.calls[0][1]).toBeInstanceOf(Error);
    expect((warnSpy.mock.calls[0][1] as Error).message).toBe(
      "mustache parse error",
    );
    warnSpy.mockRestore();
  });

  it("propagates fallback version tag to setResolvedPromptVersion on compile throw", async () => {
    installLangfuseTemplatedMock({
      prompt: "Hello {{name}}",
      version: 6,
      compile: () => {
        throw new Error("mustache parse error");
      },
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await withLlmTrace(makeCtx({ promptVersion: "pending" }), async () => {
      await getPromptWithVarsOrFallback(
        "generate-system-prompt",
        "fallback {{name}}",
        "generate@2026-05-12",
        { name: "Val" },
      );
      const ctx = getCurrentLlmTraceContext();
      expect(ctx?.promptVersion).toBe("fallback:generate@2026-05-12");
      expect(ctx?.promptFallback).toBe(true);
      // Compile-throw demotes to fallback → no live client → null on ALS.
      expect(ctx?.promptClient).toBeNull();
    });
    warnSpy.mockRestore();
  });

  it("warns at most once across repeated compile failures for the same prompt name", async () => {
    // The Langfuse singleton is constructed lazily on the first
    // `getLangfuse()` call and reused; subsequent fetches re-call the
    // same mocked `getPrompt`, which returns the same `TextPromptClient`,
    // whose `compile` throws each time. So one `mockImplementationOnce`
    // is sufficient — the second call within the cache TTL serves from
    // the registry cache; the second call AFTER TTL re-enters
    // `fetchOrFallback`, hits the same cached singleton's `getPrompt`,
    // and re-runs the same thrower `compile`. Either way: no second warn.
    installLangfuseTemplatedMock({
      prompt: "Hello {{name}}",
      version: 6,
      compile: () => {
        throw new Error("compile err");
      },
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await getPromptWithVarsOrFallback(
      "generate-system-prompt",
      "fallback {{name}}",
      "v1",
      { name: "Val" },
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);

    // Force cache expiry so the next call re-enters `fetchOrFallback` →
    // re-fetches the (same) thrower TextPromptClient → re-runs compile →
    // warn-once gate suppresses a second log.
    process.env.LANGFUSE_PROMPT_CACHE_TTL_MS = "1";
    await new Promise((r) => setTimeout(r, 5));

    await getPromptWithVarsOrFallback(
      "generate-system-prompt",
      "fallback {{name}}",
      "v1",
      { name: "Val" },
    );
    expect(warnSpy).toHaveBeenCalledTimes(1);
    warnSpy.mockRestore();
  });

  it("substitutes locally via applyTemplate(fallbackTemplate, vars) when Langfuse is unset", async () => {
    // Sanity check on the LF-unset path inside the new describe block too,
    // since the surrounding beforeEach sets the keys — explicitly unset
    // them here.
    delete process.env.LANGFUSE_PUBLIC_KEY;
    delete process.env.LANGFUSE_SECRET_KEY;
    __resetRegistryForTests();
    __resetObservabilityForTests();

    const resolved = await getPromptWithVarsOrFallback(
      "generate-system-prompt",
      "Hello {{name}}, level {{cefr}}.",
      "generate@2026-05-12",
      { name: "Val", cefr: "B1" },
    );

    expect(resolved).toEqual({
      text: "Hello Val, level B1.",
      version: "fallback:generate@2026-05-12",
      fromFallback: true,
    });
  });

  it("serves a Langfuse hit from cache on the second templated call within TTL", async () => {
    const { getPrompt, compile } = installLangfuseTemplatedMock({
      prompt: "Hello {{name}}",
      version: 4,
      compile: (vars) => `Hello ${vars.name}`,
    });

    const a = await getPromptWithVarsOrFallback(
      "generate-system-prompt",
      "Hello {{name}}",
      "v1",
      { name: "Val" },
    );
    const b = await getPromptWithVarsOrFallback(
      "generate-system-prompt",
      "Hello {{name}}",
      "v1",
      { name: "Val" },
    );
    expect(a).toEqual(b);
    // Only one fetch round-trip — the cache stored the TextPromptClient.
    expect(getPrompt).toHaveBeenCalledTimes(1);
    // ... but compile runs per call so different vars produce different
    // strings within the same cache window.
    expect(compile).toHaveBeenCalledTimes(2);
  });
});

