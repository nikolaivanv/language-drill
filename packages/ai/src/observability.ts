/**
 * packages/ai — Langfuse observability wrapper (Phase 1).
 *
 * Single integration point for LLM tracing. The Anthropic-shape client
 * returned by `createObservedClaudeClient` is a drop-in replacement for
 * `createClaudeClient`: when `LANGFUSE_PUBLIC_KEY` is set, every
 * `messages.create` / `messages.stream` call is recorded as a Langfuse
 * generation; when it's unset, it returns a vanilla Anthropic client
 * (zero added latency, zero behavior change — Req 1 AC 2).
 *
 * This file currently locks in the public API as a no-op so call-site
 * tasks (10–16) can compile against it. The Langfuse singleton lands in
 * Task 7; the Anthropic Proxy lands in Tasks 8–9.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import Anthropic from "@anthropic-ai/sdk";
import type { CefrLevel, ExerciseType, Language } from "@language-drill/shared";
import {
  Langfuse,
  type LangfuseGenerationClient,
  type LangfuseTraceClient,
  type TextPromptClient,
} from "langfuse";
import { extractNewItems } from "./annotate.js";
import { SONNET_4_5_PRICING } from "./cost-model.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type LlmFeature =
  | "evaluate"
  | "free-writing-eval"
  | "annotate"
  | "annotate-span"
  | "generate"
  | "validate"
  | "generate-theory"
  | "validate-theory";

export type LlmEnv = "prod" | "dev";

/**
 * Metadata pushed into the ALS scope by `withLlmTrace`. The Anthropic
 * Proxy (Task 8/9) reads this at call-time to tag each Langfuse
 * generation.
 *
 * Fields marked `?` are surface-specific:
 *   - `userId`: only on user-facing surfaces (evaluate, annotate)
 *   - `submissionId`: evaluate only — equals `userExerciseHistory.id`
 *   - `jobId` / `cellKey`: generate / validate (SQS-driven)
 *   - `exerciseId`: validate (the draft id under validation)
 *   - `candidateCount`: annotate only
 */
/**
 * Phase-2: why the prompt registry served the in-repo fallback instead of the
 * live Langfuse copy. Surfaced into trace metadata as `promptFallbackReason` so
 * dashboards (and a CloudWatch metric-filter alarm) can separate the *expected*
 * `keys_unset` case (Langfuse keys not configured for this env) from the
 * operator-emergency cases (`timeout` / `fetch_error` — Langfuse reachable but
 * the prompt fetch failed or the prompt vanished). Alarm on any non-`keys_unset`
 * fallback in production.
 */
export type PromptFallbackReason = 'keys_unset' | 'timeout' | 'fetch_error';

export interface LlmTraceContext {
  feature: LlmFeature;
  env: LlmEnv;
  promptVersion: string;
  requestId: string;
  userId?: string;
  submissionId?: string;
  jobId?: string;
  cellKey?: string;
  exerciseId?: string;
  language?: Language;
  cefrLevel?: CefrLevel;
  // `ExerciseType` doesn't cover `reading` (annotate) or `theory` (theory
  // generation/validation), so we accept the enum plus those two strings.
  // `null` is allowed for surfaces with no single type.
  exerciseType?: ExerciseType | "reading" | "theory" | null;
  candidateCount?: number;
  /**
   * R5 frequency-seeded generation: the content-word lemma the generator was
   * asked to build this draft around, plus its dictionary rank. Recorded as
   * named trace metadata (not an ad-hoc field) so seeded vs unseeded `generate`
   * cohorts are queryable in Langfuse. `generate` path only; both unset for an
   * unseeded ordinal, and `seedRank` may be unset if the lemma is not a
   * frequency-file surface key.
   */
  seedWord?: string;
  seedRank?: number;
  /**
   * Phase-2: invoked once per Claude call after the Langfuse trace object
   * is created. Receives the live `LangfuseTraceClient` so callers (the
   * Phase-2 eval runner) can pass the trace directly to
   * `datasetItem.link(trace, runName)` — the SDK's `LinkDatasetItem`
   * accepts a `LangfuseObjectClient`, not a bare id.
   *
   * The Proxy invokes this synchronously while still inside the ALS scope
   * — no escape from the surrounding `withLlmTrace`. Errors thrown inside
   * the callback are swallowed via the module-scope `warnOnce` so a buggy
   * caller can't fail a user request.
   */
  onTraceCreated?: (trace: LangfuseTraceClient) => void;
  /**
   * Phase-2: set by `prompts-registry`'s `setResolvedPromptVersion` when
   * the registry took the fallback path (Langfuse outage, timeout, keys
   * unset, or compile-time mismatch). Surfaced into trace metadata so
   * dashboards can spot periods of degraded prompt-fetch behavior with a
   * single filter (`promptFallback = true`).
   */
  promptFallback?: boolean;
  /**
   * Phase-2: when `promptFallback` is true, *why* the fallback was taken
   * (`keys_unset` / `timeout` / `fetch_error`). Set by `prompts-registry`'s
   * `setResolvedPromptVersion`. Lets dashboards and the metric-filter alarm
   * ignore the benign `keys_unset` case while catching the emergencies.
   */
  promptFallbackReason?: PromptFallbackReason;
  /**
   * Phase-2: live `TextPromptClient` for the resolved Langfuse prompt,
   * set by `prompts-registry`'s `setResolvedPromptClient` after a
   * successful fetch. When passed to `trace.generation({ prompt })`,
   * Langfuse links the generation to the prompt entry — the trace UI
   * shows a clickable "Prompt: <name>@v<n>" pill and dataset-run metrics
   * roll up per-prompt.
   *
   * `null` (or unset) means no live client is available — either the
   * fallback path was taken (Langfuse outage / 404 / keys unset) or the
   * caller passed a literal `systemPromptOverride`. The generation is
   * recorded without a prompt link in those cases; `promptFallback=true`
   * already disambiguates "Langfuse was reachable but we chose to skip
   * it" from "we used the live Langfuse copy."
   */
  promptClient?: TextPromptClient | null;
}

// ---------------------------------------------------------------------------
// Tool-name → feature map
// ---------------------------------------------------------------------------

/**
 * Disambiguates which `LlmFeature` to tag a trace with, keyed on the
 * outgoing `messages.create` `tools[0].name`. The Proxy (Task 8) reads
 * this at call-time so the same `withLlmTrace` scope can wrap multiple
 * surfaces (e.g. the generation Lambda runs both `generate` and
 * `validate` inside one cell-job scope — design.md §2c).
 *
 * Keys are literal strings, NOT imported constants, on purpose:
 * `observability.test.ts` cross-checks them against the matching exports
 * (`EVALUATION_TOOL_NAME`, `ANNOTATE_TOOL_NAME`, `READ_SPAN_TOOL_NAME`,
 * `TOOL_NAME_BY_TYPE`, `VALIDATION_TOOL_NAME`, `THEORY_TOOL_NAME`,
 * `THEORY_VALIDATION_TOOL_NAME`), so a rename in either place fails the
 * test loudly.
 *
 * If a tool name is missing from the map (an unrecognized future tool),
 * the Proxy falls back to the ALS `feature` value and warns once.
 */
export const TOOL_NAME_TO_FEATURE: ReadonlyMap<string, LlmFeature> = new Map([
  ["submit_evaluation", "evaluate"],
  ["submit_free_writing_evaluation", "free-writing-eval"],
  ["submit_annotated_words", "annotate"],
  ["submit_deep_card", "annotate-span"],
  ["submit_cloze_exercise", "generate"],
  ["submit_translation_exercise", "generate"],
  ["submit_vocab_recall_exercise", "generate"],
  ["submit_validation_result", "validate"],
  ["submit_theory_topic", "generate-theory"],
  ["submit_theory_validation_result", "validate-theory"],
] as const);

// ---------------------------------------------------------------------------
// AsyncLocalStorage (module-singleton)
// ---------------------------------------------------------------------------

const als = new AsyncLocalStorage<LlmTraceContext>();

/**
 * Run `fn` inside an ALS scope that carries `ctx`. The Anthropic Proxy
 * reads the current store at the start of every `messages.create` /
 * `messages.stream` call and uses the values to populate the matching
 * Langfuse generation.
 *
 * ALS-leakage discipline (design.md §Tracing model): all call sites
 * `await` the returned promise before their handler returns. Work MUST
 * NOT escape this scope via `setImmediate` / `process.nextTick` /
 * detached promises and expect the context to persist — Langfuse SDK
 * work is performed synchronously at the start of the Anthropic call,
 * so all downstream SDK activity is safely captured.
 */
export function withLlmTrace<T>(
  ctx: LlmTraceContext,
  fn: () => T | Promise<T>,
): Promise<T> {
  // Wrap `fn` in an `async` thunk so synchronous throws are converted to a
  // rejected promise. The thunk runs inside the ALS scope established by
  // `als.run`; subsequent microtasks inherit the context per AsyncLocal
  // Storage semantics.
  return als.run(ctx, async () => fn());
}

/**
 * Read the current ALS context, if any. Exported for the Anthropic Proxy
 * (Task 8) and for tests; surface code SHOULD use `withLlmTrace` instead.
 */
export function getCurrentLlmTraceContext(): LlmTraceContext | undefined {
  return als.getStore();
}

/**
 * Phase-2: mutate the current ALS frame's `promptVersion` (and optional
 * `promptFallback`) after `packages/ai/src/prompts-registry.ts` has
 * resolved a prompt — so the subsequent `messages.create` Proxy reads
 * the *resolved* version (e.g. `langfuse:7` or
 * `fallback:evaluate@2026-05-12`) rather than the placeholder the caller
 * passed into `withLlmTrace`.
 *
 * ALS stores objects by reference, so this in-place mutation is visible
 * to every downstream read in the same async chain — which is exactly
 * what the Phase-1 Proxy does at the start of each `messages.create`.
 *
 * No-op outside a `withLlmTrace` scope (covers test harnesses and
 * ad-hoc scripts that call surface fns directly).
 *
 * **Retry-constraint invariant** (documented for future code): today no
 * surface function issues a second `messages.create` after the first
 * within a single `withLlmTrace` scope. If a retry path is added in the
 * future, callers MUST re-call `getPromptOrFallback` before each attempt
 * so a TTL boundary doesn't silently version-skew the second trace.
 * `setResolvedPromptVersion` is idempotent — repeating with the same
 * version is a no-op; repeating with a new version overwrites cleanly.
 */
export function setResolvedPromptVersion(
  version: string,
  fromFallback: boolean = false,
  fallbackReason?: PromptFallbackReason,
): void {
  const store = als.getStore();
  if (!store) return;
  store.promptVersion = version;
  store.promptFallback = fromFallback;
  // Only meaningful on the fallback path; clear it otherwise so a later
  // successful resolution in the same frame doesn't leave a stale reason.
  store.promptFallbackReason = fromFallback ? fallbackReason : undefined;
}

/**
 * Phase-2: stash the live `TextPromptClient` on the current ALS frame
 * after `prompts-registry` has resolved a prompt. `startLangfuseGeneration`
 * reads this and passes it to `trace.generation({ prompt })` so Langfuse
 * links the generation to the prompt entry (clickable prompt-name pill in
 * the trace UI + per-prompt dataset-run metrics).
 *
 * Pass `null` to clear (fallback / override paths where no live client
 * exists). Symmetric with `setResolvedPromptVersion` — same ALS frame,
 * same in-place mutation semantics, same no-op-outside-scope contract.
 */
export function setResolvedPromptClient(
  client: TextPromptClient | null,
): void {
  const store = als.getStore();
  if (!store) return;
  store.promptClient = client;
}

// ---------------------------------------------------------------------------
// Langfuse singleton
// ---------------------------------------------------------------------------

// Tri-state: `langfuseSingleton` is the cached client (or null); `initialized`
// distinguishes "not tried yet" from "tried and got null" so we don't retry
// a failed construction on every getLangfuse() call. Tests reset both via
// __resetForTests so they can toggle env vars across cases.
let langfuseSingleton: Langfuse | null = null;
let initialized = false;
// Module-scope flag — at most one console.warn per cold start for either
// the Langfuse init path OR the flush path (Req 7 AC 2: "one log per
// invocation, not per event"). Reset by __resetForTests.
let warnedOnce = false;

function parseSampleRate(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 1) return undefined;
  return n;
}

/**
 * Lazy singleton accessor for the Langfuse client.
 *
 * Returns `null` when:
 *   - `LANGFUSE_PUBLIC_KEY` or `LANGFUSE_SECRET_KEY` is unset (Req 1 AC 2 —
 *     normal "no-op" mode, no warn).
 *   - the `Langfuse` constructor threw (Req 7 AC 1 — warn once per cold
 *     start, then graceful no-op).
 *
 * Memoizes its result so subsequent calls in the same Lambda invocation
 * are zero-cost. Tests must call `__resetForTests()` between cases that
 * toggle env vars.
 *
 * Exported for the Anthropic Proxy (Task 8) and the observability test
 * suite. Surface code SHOULD use `createObservedClaudeClient` instead.
 */
export function getLangfuse(): Langfuse | null {
  if (initialized) return langfuseSingleton;
  initialized = true;
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) {
    // Keys-missing is the documented zero-config path — no warn.
    return null;
  }
  try {
    langfuseSingleton = new Langfuse({
      publicKey,
      secretKey,
      // Both optional; passing `undefined` lets the SDK apply its defaults
      // (cloud URL, sampleRate=1.0).
      baseUrl: process.env.LANGFUSE_BASE_URL,
      sampleRate: parseSampleRate(process.env.LANGFUSE_SAMPLE_RATE),
      // SDK defaults (flushAt=15, flushInterval=10s) are intentionally
      // unchanged — design.md §Component 1 explains why lowering them
      // would inflate the p95 latency budget (Req 6 AC 4).
    });
    return langfuseSingleton;
  } catch (err) {
    if (!warnedOnce) {
      warnedOnce = true;
      console.warn(
        "[observability] Langfuse init failed; tracing disabled",
        err,
      );
    }
    langfuseSingleton = null;
    return null;
  }
}

// ---------------------------------------------------------------------------
// Usage + cost mapping helpers (Req 4)
// ---------------------------------------------------------------------------

/**
 * Shape of the four token-bucket counts as reported by the Anthropic SDK.
 * Mirrors the `Usage` properties read by `cost-model.ts` and `generate.ts`.
 */
type AnthropicUsageLike = {
  input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  output_tokens?: number | null;
};

/**
 * Convert an Anthropic `usage` block into the Langfuse v3 `usageDetails`
 * map (bucket name → token count). Keys are deliberately aligned with
 * `ClaudeUsageBreakdown` for dashboard intuitiveness.
 */
export function mapUsageDetails(
  u: AnthropicUsageLike | null | undefined,
): Record<string, number> {
  return {
    input: u?.input_tokens ?? 0,
    cache_creation_input: u?.cache_creation_input_tokens ?? 0,
    cache_read_input: u?.cache_read_input_tokens ?? 0,
    output: u?.output_tokens ?? 0,
  };
}

/**
 * Per-bucket USD cost. Sum across buckets equals `estimateCostUsd(usage)`
 * to within rounding (Req 4 AC 3) — verified by the round-trip test in
 * `cost-model.test.ts` (Task 8b).
 *
 * Includes an explicit `total` key in addition to the four buckets:
 * Langfuse's dashboard "Total cost" widget reads `total` directly when
 * present, falling back to a server-side sum of the remaining keys
 * otherwise. The sum-fallback is unreliable with custom buckets like
 * `cache_creation_input`, so we set `total` explicitly. (`buildCostDetails`
 * is also called by the `cost-model.test.ts` round-trip — that test
 * subtracts out the `total` key so the parity invariant still holds.)
 */
export function buildCostDetails(
  u: AnthropicUsageLike | null | undefined,
): Record<string, number> {
  const input = (u?.input_tokens ?? 0) * SONNET_4_5_PRICING.inputUsdPerToken;
  const cache_creation_input =
    (u?.cache_creation_input_tokens ?? 0) *
    SONNET_4_5_PRICING.cacheWriteUsdPerToken;
  const cache_read_input =
    (u?.cache_read_input_tokens ?? 0) *
    SONNET_4_5_PRICING.cacheReadUsdPerToken;
  const output =
    (u?.output_tokens ?? 0) * SONNET_4_5_PRICING.outputUsdPerToken;
  return {
    input,
    cache_creation_input,
    cache_read_input,
    output,
    total: input + cache_creation_input + cache_read_input + output,
  };
}

// ---------------------------------------------------------------------------
// Per-trace warn-once helper
// ---------------------------------------------------------------------------

/**
 * Emit a single `console.warn` per Lambda invocation no matter how many
 * times the underlying issue recurs (Req 7 AC 2). Used by the Proxy and
 * by `flushObservability`.
 */
function warnOnce(...args: unknown[]): void {
  if (!warnedOnce) {
    warnedOnce = true;
    console.warn("[observability]", ...args);
  }
}

// ---------------------------------------------------------------------------
// Anthropic wrapper
// ---------------------------------------------------------------------------

type MessagesCreateRequest = {
  model: string;
  tools?: ReadonlyArray<{ name?: string }>;
  messages?: unknown;
  system?: unknown;
  temperature?: number;
  max_tokens?: number;
  tool_choice?: unknown;
  // The full Anthropic schema has many more fields; we only inspect these.
  [key: string]: unknown;
};

type MessagesCreateResponse = {
  content: ReadonlyArray<{ type: string; input?: unknown; [key: string]: unknown }>;
  usage?: AnthropicUsageLike;
  stop_reason?: string | null;
  model?: string;
};

/**
 * Resolve the trace `feature` tag from the outgoing tool name. Falls back
 * to the ALS-provided `ctx.feature` when the tool name is missing from
 * `TOOL_NAME_TO_FEATURE` (warn once — see design §Component 1).
 */
function resolveFeature(
  request: MessagesCreateRequest,
  ctx: LlmTraceContext,
): LlmFeature {
  const toolName = request.tools?.[0]?.name;
  if (toolName) {
    const mapped = TOOL_NAME_TO_FEATURE.get(toolName);
    if (mapped) return mapped;
    warnOnce(
      `unknown tool name "${toolName}" — falling back to ALS feature "${ctx.feature}"`,
    );
  }
  return ctx.feature;
}

/**
 * Build the trace-level metadata object. Mirrors design.md Model 3:
 * cross-reference ids (submission/job/cell/exercise) plus operational
 * fields go here; the tag schema (Model 3 §1) is built separately.
 *
 * `language`, `cefrLevel`, and `exerciseType` are *also* in `metadata`
 * (and not only as tags) so Langfuse dashboards can `group by` them.
 * Tags are great for filter-search ("show traces tagged `es`") but
 * Langfuse's group-by selector keys off structured metadata fields —
 * a "cost broken down by language" chart needs `metadata.language` to
 * exist (Req 9 AC 1 dashboard).
 */
// Langfuse SDK v3 narrows metadata values to `string | number | boolean |
// string[] | null`. The builder's return type matches so the call sites
// type-check without a cast.
type LangfuseMetadataValue = string | number | boolean | string[] | null;

function buildTraceMetadata(
  ctx: LlmTraceContext,
  feature: LlmFeature,
  model: string,
): Record<string, LangfuseMetadataValue> {
  const m: Record<string, LangfuseMetadataValue> = {
    feature,
    env: ctx.env,
    promptVersion: ctx.promptVersion,
    requestId: ctx.requestId,
    model,
  };
  if (ctx.submissionId !== undefined) m.submissionId = ctx.submissionId;
  if (ctx.jobId !== undefined) m.jobId = ctx.jobId;
  if (ctx.cellKey !== undefined) m.cellKey = ctx.cellKey;
  if (ctx.exerciseId !== undefined) m.exerciseId = ctx.exerciseId;
  if (ctx.candidateCount !== undefined) m.candidateCount = ctx.candidateCount;
  if (ctx.seedWord !== undefined) m.seedWord = ctx.seedWord;
  if (ctx.seedRank !== undefined) m.seedRank = ctx.seedRank;
  if (ctx.promptFallback !== undefined) m.promptFallback = ctx.promptFallback;
  if (ctx.promptFallbackReason !== undefined)
    m.promptFallbackReason = ctx.promptFallbackReason;
  // Dashboard-pivot dimensions: tag-and-metadata so both filter UIs and
  // group-by selectors work. Language is lowercased to match the tag
  // canonicalisation in `buildTraceTags` (Req 3 AC 1: `en` | `es` | …).
  if (ctx.language) m.language = String(ctx.language).toLowerCase();
  if (ctx.cefrLevel) m.cefrLevel = ctx.cefrLevel;
  if (ctx.exerciseType !== undefined && ctx.exerciseType !== null) {
    m.exerciseType = String(ctx.exerciseType);
  }
  return m;
}

/**
 * Build the v2 tag schema — every tag is `dimension:value` so Langfuse
 * dashboards can both **filter** (prefix `language:*`) and **group by**
 * tag value (`language:es`, `language:de`, …) for breakdown charts.
 *
 * The v1 schema (Phase 1) used bare values (`es`, `B1`, `cloze`). Langfuse's
 * dashboard group-by only works on tags, not metadata, but with bare-value
 * tags every trace has 6-7 unrelated tags and the UI can't tell which one
 * represents which dimension. Namespacing solves both filter and group-by
 * in one go; the schema is forward-extensible (just keep the
 * `dimension:value` rule for any new tag).
 *
 * `language` is lowercased to match Req 3 AC 1 (`en` | `es` | `de` | `tr`).
 * `submissionId` was already namespaced in v1 — kept as-is. `promptVersion`
 * and `cellKey` were metadata-only in v1; promoted to tags so dashboards
 * 3 (prompt-version A/B) and 4 (per-cell rejection rate) can group by them.
 *
 * `requestId` and `jobId` stay metadata-only — they're high-cardinality
 * pivot keys, used for filtering one specific trace, not for breakdown.
 */
function buildTraceTags(
  ctx: LlmTraceContext,
  feature: LlmFeature,
  model: string,
): string[] {
  const tags: string[] = [
    `feature:${feature}`,
    `env:${ctx.env}`,
    `model:${model}`,
    `promptVersion:${ctx.promptVersion}`,
  ];
  if (ctx.language) {
    tags.push(`language:${String(ctx.language).toLowerCase()}`);
  }
  if (ctx.cefrLevel) tags.push(`cefrLevel:${ctx.cefrLevel}`);
  if (ctx.exerciseType !== undefined && ctx.exerciseType !== null) {
    tags.push(`exerciseType:${ctx.exerciseType}`);
  }
  if (ctx.cellKey) tags.push(`cellKey:${ctx.cellKey}`);
  if (ctx.submissionId) tags.push(`submissionId:${ctx.submissionId}`);
  return tags;
}

/**
 * Capture useful per-request knobs as Langfuse `modelParameters`.
 * `tool_choice` (an object in the Anthropic SDK) is rendered as a short
 * string so it fits Langfuse's `MapValue` (string | number | boolean |
 * string[] | null) field type.
 */
function extractModelParameters(
  request: MessagesCreateRequest,
): Record<string, LangfuseMetadataValue> {
  const out: Record<string, LangfuseMetadataValue> = {};
  if (request.temperature !== undefined) out.temperature = request.temperature;
  if (request.max_tokens !== undefined) out.max_tokens = request.max_tokens;
  if (request.tool_choice !== undefined) {
    const tc = request.tool_choice as { type?: string; name?: string };
    out.tool_choice = tc.name ? `${tc.type ?? "tool"}:${tc.name}` : String(tc.type ?? "");
  }
  return out;
}

/**
 * Open a Langfuse trace + generation for one outgoing Claude call. Wraps
 * every SDK call in try/catch so a Langfuse outage cannot fail the
 * underlying request (Req 7 AC 2). Returns `null` when init fails —
 * callers must skip subsequent `gen.end()` calls on null.
 */
function startLangfuseGeneration(
  lf: Langfuse,
  ctx: LlmTraceContext,
  request: MessagesCreateRequest,
  feature: LlmFeature,
): LangfuseGenerationClient | null {
  const traceMetadata = buildTraceMetadata(ctx, feature, request.model);
  const traceTags = buildTraceTags(ctx, feature, request.model);
  try {
    const trace = lf.trace({
      name: feature,
      userId: ctx.userId,
      tags: traceTags,
      metadata: traceMetadata,
    });
    if (ctx.onTraceCreated) {
      try {
        ctx.onTraceCreated(trace);
      } catch (cbErr) {
        warnOnce("onTraceCreated callback threw", cbErr);
      }
    }
    // `prompt: <TextPromptClient>` links this generation to the resolved
    // Langfuse prompt entry — trace UI shows a clickable "Prompt:
    // <name>@v<n>" pill, and dataset-run metrics roll up per-prompt.
    // Fallback / override paths leave `ctx.promptClient` null, in which
    // case we omit the field entirely (Langfuse complains if we pass
    // `null`). `promptFallback=true` on the metadata already tells
    // dashboards why the link is missing.
    return trace.generation({
      name: feature,
      model: request.model,
      input: {
        system: request.system,
        messages: request.messages,
      },
      modelParameters: extractModelParameters(request),
      metadata: traceMetadata,
      ...(ctx.promptClient ? { prompt: ctx.promptClient } : {}),
    });
  } catch (err) {
    warnOnce("Langfuse trace/generation start failed", err);
    return null;
  }
}

/**
 * Best-effort abort detection. `messages.stream` aborts surface as
 * `AbortError` (DOM-style) OR an Anthropic SDK class whose message
 * mentions "abort". Both should be tagged as a client disconnect rather
 * than a generic error (design.md Scenario 4).
 */
function isAbortError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { name?: string; message?: string };
  if (e.name === "AbortError") return true;
  const msg = String(e.message ?? "").toLowerCase();
  return msg.includes("aborted") || msg.includes("abort");
}

/**
 * Wrap an Anthropic `MessageStream` so Langfuse sees:
 *  - the full event stream's tool-use payload (assembled via
 *    `extractNewItems` against the running JSON buffer),
 *  - `stop_reason` and `flaggedCount` in metadata,
 *  - the four-bucket usage from `finalMessage()`.
 *
 * Finalization is idempotent — whichever of (iteration end, finalMessage
 * resolve, iteration throw, finalMessage reject) happens first calls
 * `gen.end` exactly once. `max_tokens` stop_reason is recorded as level
 * `WARNING` so dashboards can split truncations from clean completions
 * (Req 5 AC 2). Aborts are recorded as level `WARNING` with
 * `statusMessage: "client_disconnect"` (design Scenario 4).
 */
function wrapStream(
  innerStream: unknown,
  maybeGen: LangfuseGenerationClient | null,
): unknown {
  if (!maybeGen) return innerStream;
  const gen = maybeGen;

  const collected: unknown[] = [];
  let jsonBuf = "";
  let processed = 0;
  let finalized = false;

  function finalize(extras: {
    usage?: AnthropicUsageLike | null;
    stop_reason?: string | null;
    level?: "ERROR" | "WARNING";
    statusMessage?: string;
  }): void {
    if (finalized) return;
    finalized = true;
    const stopReason = extras.stop_reason ?? null;
    const effectiveLevel =
      extras.level ?? (stopReason === "max_tokens" ? "WARNING" : undefined);
    const effectiveStatus =
      extras.statusMessage ??
      (stopReason === "max_tokens" ? "stop_reason: max_tokens" : undefined);
    try {
      gen.end({
        output: collected,
        usageDetails: extras.usage ? mapUsageDetails(extras.usage) : undefined,
        costDetails: extras.usage ? buildCostDetails(extras.usage) : undefined,
        level: effectiveLevel,
        statusMessage: effectiveStatus,
        metadata: {
          flaggedCount: collected.length,
          ...(stopReason !== null ? { stop_reason: stopReason } : {}),
        },
      });
    } catch (lfErr) {
      warnOnce("Langfuse generation.end (stream) failed", lfErr);
    }
  }

  function teeEvent(event: unknown): void {
    const e = event as
      | { type?: string; delta?: { type?: string; partial_json?: string } }
      | undefined;
    if (
      e?.type === "content_block_delta" &&
      e.delta?.type === "input_json_delta"
    ) {
      jsonBuf += e.delta.partial_json ?? "";
      for (const item of extractNewItems(jsonBuf, processed)) {
        processed++;
        collected.push(item);
      }
    }
  }

  return new Proxy(innerStream as object, {
    get(target, prop, receiver) {
      if (prop === Symbol.asyncIterator) {
        return function () {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const it = (target as any)[Symbol.asyncIterator]();
          return {
            async next(): Promise<IteratorResult<unknown>> {
              try {
                const r = await it.next();
                if (r.done) {
                  // Stream exhausted — fetch finalMessage to capture
                  // usage + stop_reason.
                  try {
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    const final = await (target as any).finalMessage();
                    finalize({
                      usage: final?.usage,
                      stop_reason: final?.stop_reason,
                    });
                  } catch (err) {
                    finalize({
                      level: "WARNING",
                      statusMessage: isAbortError(err)
                        ? "client_disconnect"
                        : err instanceof Error
                          ? err.message
                          : String(err),
                    });
                  }
                } else {
                  teeEvent(r.value);
                }
                return r;
              } catch (err) {
                finalize({
                  level: "WARNING",
                  statusMessage: isAbortError(err)
                    ? "client_disconnect"
                    : err instanceof Error
                      ? err.message
                      : String(err),
                });
                throw err;
              }
            },
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return: (it as any).return?.bind(it),
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            throw: (it as any).throw?.bind(it),
          };
        };
      }
      if (prop === "finalMessage") {
        return async function (): Promise<unknown> {
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const final = await (target as any).finalMessage();
            finalize({
              usage: final?.usage,
              stop_reason: final?.stop_reason,
            });
            return final;
          } catch (err) {
            finalize({
              level: "WARNING",
              statusMessage: isAbortError(err)
                ? "client_disconnect"
                : err instanceof Error
                  ? err.message
                  : String(err),
            });
            throw err;
          }
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
}

/**
 * Wrap an Anthropic client in a Proxy that emits a Langfuse generation
 * for every `messages.create` AND `messages.stream` call. The Proxy
 * reads ALS at call-time so a single `withLlmTrace` scope can wrap
 * multiple Claude calls (e.g. the generation Lambda dispatching both
 * generate + validate inside one cell-job — design.md §2c).
 *
 * Other Anthropic SDK methods pass through transparently.
 */
function wrapAnthropic(inner: Anthropic, lf: Langfuse): Anthropic {
  const innerMessages = inner.messages;

  const messagesProxy = new Proxy(innerMessages, {
    get(target, prop, receiver) {
      if (prop === "create") {
        return async (
          request: MessagesCreateRequest,
          options?: unknown,
        ): Promise<MessagesCreateResponse> => {
          const ctx = getCurrentLlmTraceContext();
          // No ALS scope ⇒ trust the caller's intent and pass through.
          // Surface code always enters `withLlmTrace` before invoking
          // the SDK; reaching here without one means a test harness or
          // a code path we explicitly chose not to trace.
          if (!ctx) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            return (target.create as any).call(target, request, options);
          }

          const feature = resolveFeature(request, ctx);
          const gen = startLangfuseGeneration(lf, ctx, request, feature);

          let response: MessagesCreateResponse;
          try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            response = (await (target.create as any).call(
              target,
              request,
              options,
            )) as MessagesCreateResponse;
          } catch (err) {
            if (gen) {
              try {
                gen.end({
                  level: "ERROR",
                  statusMessage:
                    err instanceof Error ? err.message : String(err),
                });
              } catch (lfErr) {
                warnOnce("Langfuse generation.end (error path) failed", lfErr);
              }
            }
            throw err;
          }

          if (gen) {
            try {
              const toolUseBlock = response.content.find(
                (b) => b.type === "tool_use",
              );
              // Generic-on-shape: if the tool input carries a numeric `score`
              // field, mirror it into trace metadata so dashboards can
              // aggregate it (avg-score-by-language, etc.). Today only
              // `evaluate` emits a score, but the guard `typeof === 'number'`
              // keeps the Proxy decoupled from per-surface schemas. NOTE:
              // this is a *user-progress* metric, not an LLM-quality metric —
              // do NOT route it through Langfuse's first-class Scores API.
              const toolInput = toolUseBlock?.input as
                | Record<string, unknown>
                | undefined;
              const scoreOnInput = toolInput?.score;
              const endMetadata: Record<string, LangfuseMetadataValue> = {};
              if (typeof scoreOnInput === "number") {
                endMetadata.score = scoreOnInput;
              }

              gen.end({
                output: toolUseBlock?.input ?? response.content,
                usageDetails: mapUsageDetails(response.usage),
                costDetails: buildCostDetails(response.usage),
                ...(Object.keys(endMetadata).length > 0
                  ? { metadata: endMetadata }
                  : {}),
              });
            } catch (lfErr) {
              warnOnce("Langfuse generation.end (success path) failed", lfErr);
            }
          }

          return response;
        };
      }
      if (prop === "stream") {
        return (request: MessagesCreateRequest, options?: unknown): unknown => {
          const ctx = getCurrentLlmTraceContext();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const inner = (target.stream as any).call(target, request, options);
          if (!ctx) return inner;
          const feature = resolveFeature(request, ctx);
          const gen = startLangfuseGeneration(lf, ctx, request, feature);
          return wrapStream(inner, gen);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });

  return new Proxy(inner, {
    get(target, prop, receiver) {
      if (prop === "messages") return messagesProxy;
      return Reflect.get(target, prop, receiver);
    },
  }) as Anthropic;
}

/**
 * Drop-in replacement for `createClaudeClient`. Returns a vanilla
 * `Anthropic` instance when Langfuse is disabled (Req 1 AC 2); otherwise
 * returns a Proxy that records each `messages.create` call as a Langfuse
 * generation (Req 1 AC 3).
 *
 * `opts` (optional) sets per-surface `timeout` / `maxRetries` at the
 * Anthropic client constructor. We apply them here rather than per-request
 * so they take effect regardless of whether the Langfuse Proxy forwards a
 * second request-options argument — the constructor values are the floor for
 * every call the returned client makes. Omitting `opts` is behaviour-identical
 * to the original single-arg factory (the SDK defaults: `maxRetries: 2`, a
 * 10-minute timeout).
 */
export function createObservedClaudeClient(
  apiKey: string,
  opts?: { timeout?: number; maxRetries?: number },
): Anthropic {
  const inner = new Anthropic({ apiKey, ...opts });
  const lf = getLangfuse();
  if (!lf) return inner;
  return wrapAnthropic(inner, lf);
}

// ---------------------------------------------------------------------------
// Flush (stub)
// ---------------------------------------------------------------------------

/**
 * Hard cap on `flushAsync`. Lambda handlers race the flush against this
 * timeout so trace-buffer drains never dominate tail latency (Req 6 AC 4).
 */
export const LANGFUSE_FLUSH_TIMEOUT_MS = 200;

/**
 * Drain any buffered Langfuse traces. Races `flushAsync()` against
 * `timeoutMs` and swallows errors so a Langfuse outage cannot fail a
 * request (Req 7 AC 3). Safe to call from any handler `finally`
 * whether or not Langfuse is enabled — when the singleton is null
 * (keys absent OR never instantiated by a Claude call) this is a
 * synchronous no-op.
 */
export async function flushObservability(
  timeoutMs: number = LANGFUSE_FLUSH_TIMEOUT_MS,
): Promise<void> {
  // Read the variable directly (not via getLangfuse) — `finally`-style
  // callers must not trigger first-init from inside a flush.
  const lf = langfuseSingleton;
  if (!lf) return;
  try {
    await Promise.race([
      lf.flushAsync(),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ]);
  } catch (err) {
    if (!warnedOnce) {
      warnedOnce = true;
      console.warn("[observability] flushAsync failed", err);
    }
  }
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Discard the module-singleton Langfuse client and reset all once-per-
 * cold-start flags. Tests that toggle `LANGFUSE_PUBLIC_KEY` across cases
 * must call this between them — the lazy singleton otherwise caches its
 * first cold-start decision and subsequent env-var changes are invisible.
 */
export function __resetForTests(): void {
  langfuseSingleton = null;
  initialized = false;
  warnedOnce = false;
}
