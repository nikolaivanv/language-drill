/**
 * packages/ai — Langfuse prompt registry (Phase 2).
 *
 * Single integration point for the six system prompts the app sends to
 * Claude. Surfaces in `evaluate.ts`, `annotate.ts`, `generation-prompts.ts`,
 * `validation-prompts.ts`, `theory-prompts.ts`, and
 * `theory-validation-prompts.ts` fetch their live text from Langfuse via
 * `getPromptOrFallback` / `getPromptWithVarsOrFallback`, with a
 * module-scope cache (5-minute TTL, aligned with Anthropic ephemeral cache)
 * and a byte-identical fallback to the in-repo string on any error
 * (Langfuse outage, timeout, keys unset, compile mismatch).
 *
 * Cache strategy (design.md §Component 1):
 *   - One cache. The wrapper Map below is the only cache; the Langfuse
 *     SDK's internal prompt cache is disabled via `cacheTtlSeconds: 0`.
 *     Two caches with mismatched TTLs leads to "SDK has v8, wrapper has
 *     v7" bugs — disable one.
 *   - Cache stores the **whole `TextPromptClient`** (not just the text)
 *     so `compile(vars)` runs locally on every templated call (Task 6).
 *   - Both successful fetches and fallback decisions populate the cache,
 *     so a Langfuse outage doesn't trigger network retries on every
 *     Claude call during the TTL window.
 *
 * Both `getPromptOrFallback` (static prompts) and
 * `getPromptWithVarsOrFallback` (builder-composed prompts) share the
 * same cache and `fetchOrFallback` workhorse — the templated variant
 * adds `TextPromptClient.compile(vars)` plus an un-filled-`{{var}}`
 * guard on top.
 */

import { createHash } from "node:crypto";

import type { TextPromptClient } from "langfuse";
import {
  getLangfuse,
  setResolvedPromptClient,
  setResolvedPromptVersion,
} from "./observability.js";

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/**
 * Default TTL for the in-process prompt cache. Chosen to **bracket**
 * Anthropic's 5-minute ephemeral prompt-cache TTL: if our cache expired
 * before Anthropic's, a Langfuse refetch that returns a new version
 * mid-Anthropic-window would force a re-cache-write on the very next
 * Claude call. Matching the two TTLs bounds the worst-case cost impact
 * of an operator prompt promotion to a single cache miss per surface
 * per Lambda.
 *
 * Override via `LANGFUSE_PROMPT_CACHE_TTL_MS`.
 */
export const LANGFUSE_PROMPT_CACHE_TTL_MS = 300_000;

/**
 * Hard cap on a single Langfuse `getPrompt` round trip. Beyond this, the
 * registry returns the in-repo fallback and warns once per surface per
 * cold start. Override via `LANGFUSE_PROMPT_FETCH_TIMEOUT_MS`.
 *
 * Chosen at 250 ms because it must be smaller than Phase-1's
 * `LANGFUSE_FLUSH_TIMEOUT_MS = 200`'s sibling budget for the
 * user-facing critical path. A first-request-after-cold-start cost
 * of ≤ 250 ms per surface is amortised across the 5-minute cache TTL
 * — see design.md §Performance Notes.
 */
export const LANGFUSE_PROMPT_FETCH_TIMEOUT_MS = 250;

/**
 * Langfuse label that designates the "live" production version of each
 * prompt. Engineers and operators set this label on a Langfuse prompt
 * version to roll it out to all running Lambdas (subject to the cache
 * TTL above). Candidate / experiment labels are free-form by convention.
 */
export const PROMPT_LABEL_PRODUCTION = "production";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Result of a prompt fetch. Static-prompt callers consume `text`
 * directly; templated-prompt callers also receive a compiled string in
 * `text` (Langfuse's `compile(vars)` or the local `applyTemplate`).
 *
 *   - `version`: cohort key for Langfuse trace dashboards. Values:
 *       'langfuse:<N>'                       — successful fetch, N = SDK version number
 *       'fallback:<*_SYSTEM_PROMPT_VERSION>' — fallback path taken
 *       'override:<sha8>'                    — surface-side override (eval runner)
 *   - `fromFallback`: mirrors the second form above; true iff the fallback
 *     path was taken. Plumbed to `setResolvedPromptVersion` so the trace
 *     metadata carries `promptFallback=true`.
 */
export interface ResolvedPrompt {
  text: string;
  version: string;
  fromFallback: boolean;
}

// ---------------------------------------------------------------------------
// Template substituter (Langfuse-compatible Mustache subset)
// ---------------------------------------------------------------------------

/**
 * Pattern for the Mustache-style `{{flatVarName}}` placeholders used by
 * Langfuse's `prompt.compile(vars)` AND our in-code fallback templates.
 * Identifiers are `\w+` only — we deliberately do NOT support nested
 * paths (`{{obj.field}}`) because callers pre-flatten their vars into a
 * `Record<string, string>` before substitution.
 *
 * Restricting placeholder identifiers to `\w+` keeps Langfuse's
 * `compile(vars)` and our `applyTemplate(template, vars)` byte-identical
 * for the same input — required for Anthropic prompt-caching parity.
 */
const TEMPLATE_VAR_RE = /\{\{(\w+)\}\}/g;

/**
 * In-code Mustache-subset substituter. Replaces every `{{key}}` in
 * `template` with `vars[key]`. Missing keys are left in place (so the
 * bug is loud rather than silent) and reported in `missingVars`.
 *
 * Re-exported and exercised by tests so any drift between this and
 * Langfuse's `prompt.compile(vars)` is caught at PR time.
 */
export function applyTemplate(
  template: string,
  vars: Record<string, string>,
): { text: string; missingVars: string[] } {
  const missing: string[] = [];
  const text = template.replace(TEMPLATE_VAR_RE, (match, key: string) => {
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      return vars[key];
    }
    missing.push(key);
    return match;
  });
  return { text, missingVars: missing };
}

// ---------------------------------------------------------------------------
// sha8 — short content hash for override / candidate identity
// ---------------------------------------------------------------------------

/**
 * 8-character SHA-256 prefix of `s`. Used as the cohort tag suffix for
 * the two `promptVersion` forms that aren't tied to a Langfuse version
 * number:
 *
 *   - `override:<sha8>` — surface-side `systemPromptOverride` (the eval
 *     runner passes a candidate prompt verbatim; sha8 deduplicates runs
 *     against the same candidate text).
 *   - `eval-run:<sha8>` — the eval runner's `withLlmTrace` cohort tag
 *     for the candidate prompt under test.
 *
 * 8 hex chars = 32 bits of namespace; collision probability across a few
 * thousand candidate prompts is negligible. Reused by `evaluate.ts`,
 * `annotate.ts`, and `packages/ai/scripts/eval-run.ts`.
 */
export function sha8(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 8);
}

// ---------------------------------------------------------------------------
// Module-scope cache + warn-once state
// ---------------------------------------------------------------------------

/**
 * One slot per `(name, label)` pair. Holds both the simple `resolved`
 * shape (what callers return) and the live `TextPromptClient` (kept so
 * Task 6's `getPromptWithVarsOrFallback` can call `compile(vars)`
 * locally without re-entering the SDK). `promptClient` is `null` on
 * fallback rows so the consumer can distinguish "live Langfuse value"
 * from "in-repo backup."
 */
type CacheEntry = {
  resolved: ResolvedPrompt;
  promptClient: TextPromptClient | null;
  fetchedAt: number;
};

const cache = new Map<string, CacheEntry>();

/**
 * Surface-name set for the warn-once gate. Populated the first time a
 * given prompt fails to fetch in a cold start; cleared by
 * `__resetRegistryForTests`. Keyed by Langfuse prompt name (NOT
 * `${name}@${label}`) so a future candidate-label rollout doesn't drown
 * production dashboards in warns.
 */
const warnedNames = new Set<string>();

// ---------------------------------------------------------------------------
// Env-override helpers (re-read on each call so tests can adjust)
// ---------------------------------------------------------------------------

/**
 * Effective cache TTL. Reads `LANGFUSE_PROMPT_CACHE_TTL_MS` per call
 * rather than at module load so tests can adjust without re-importing.
 * Invalid / non-positive overrides fall back to the exported default.
 */
function getCacheTtlMs(): number {
  const override = Number(process.env.LANGFUSE_PROMPT_CACHE_TTL_MS);
  return Number.isFinite(override) && override > 0
    ? override
    : LANGFUSE_PROMPT_CACHE_TTL_MS;
}

/**
 * Effective fetch timeout. Same env-on-each-call pattern as the cache
 * TTL — keeps tests deterministic without a module-reload dance.
 */
function getFetchTimeoutMs(): number {
  const override = Number(process.env.LANGFUSE_PROMPT_FETCH_TIMEOUT_MS);
  return Number.isFinite(override) && override > 0
    ? override
    : LANGFUSE_PROMPT_FETCH_TIMEOUT_MS;
}

// ---------------------------------------------------------------------------
// raceWithTimeout
// ---------------------------------------------------------------------------

/**
 * Race a promise against a `setTimeout(reject, ms)`. The losing side is
 * not cancelled — if the SDK call eventually resolves, the result is
 * dropped. This is intentional: the SDK has no AbortSignal hook for
 * `getPrompt`, and silently retaining the in-flight network call costs
 * nothing on a successful late resolve.
 *
 * Exported only for tests; surface code should use `getPromptOrFallback`
 * which wraps this with cache + fallback logic.
 */
export async function raceWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error(`timeout ${timeoutMs}ms: ${label}`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// fetchOrFallback — the cache-miss workhorse
// ---------------------------------------------------------------------------

/**
 * Resolve a single `(name, fallback, fallbackVersion, label)` tuple to a
 * `CacheEntry`. Has no caching of its own — callers (the two public
 * `getPrompt*` functions) handle the cache.
 *
 * Always returns a non-null entry. The fallback path is taken when:
 *   - `getLangfuse()` returns `null` (keys unset OR Langfuse init failed
 *     — see Phase-1 `observability.ts:175-208`).
 *   - The SDK throws.
 *   - The fetch exceeds `LANGFUSE_PROMPT_FETCH_TIMEOUT_MS`.
 * On any of those, a one-shot `console.warn` per surface name fires.
 *
 * Exported only for tests / Task 6's templated wrapper.
 */
export async function fetchOrFallback(
  name: string,
  fallback: string,
  fallbackVersion: string,
  label: string,
): Promise<CacheEntry> {
  const lf = getLangfuse();
  if (!lf) {
    return {
      resolved: {
        text: fallback,
        version: `fallback:${fallbackVersion}`,
        fromFallback: true,
      },
      promptClient: null,
      fetchedAt: Date.now(),
    };
  }
  try {
    const fetched = (await raceWithTimeout(
      lf.getPrompt(name, undefined, { label, cacheTtlSeconds: 0 }),
      getFetchTimeoutMs(),
      `prompt-fetch:${name}@${label}`,
    )) as TextPromptClient;
    return {
      resolved: {
        text: fetched.prompt,
        version: `langfuse:${fetched.version}`,
        fromFallback: false,
      },
      promptClient: fetched,
      fetchedAt: Date.now(),
    };
  } catch (err) {
    if (!warnedNames.has(name)) {
      warnedNames.add(name);
      console.warn(
        `[prompts-registry] fetch failed for "${name}@${label}"; using fallback`,
        err,
      );
    }
    return {
      resolved: {
        text: fallback,
        version: `fallback:${fallbackVersion}`,
        fromFallback: true,
      },
      promptClient: null,
      fetchedAt: Date.now(),
    };
  }
}

/**
 * Look up a cache slot or compute it via `fetchOrFallback`. Mutates the
 * module-scope cache. Exported only for tests / Task 6.
 */
export async function getCacheEntry(
  name: string,
  fallback: string,
  fallbackVersion: string,
  label: string,
): Promise<CacheEntry> {
  const cacheKey = `${name}@${label}`;
  const existing = cache.get(cacheKey);
  if (existing && Date.now() - existing.fetchedAt < getCacheTtlMs()) {
    return existing;
  }
  const fresh = await fetchOrFallback(name, fallback, fallbackVersion, label);
  cache.set(cacheKey, fresh);
  return fresh;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve a Langfuse-registered static prompt. Returns the in-repo
 * `fallback` string when Langfuse is unreachable, the keys are unset,
 * the fetch times out, or the SDK throws.
 *
 * Also calls `setResolvedPromptVersion` on the current ALS frame so the
 * Phase-1 Proxy emits the trace with the resolved version (e.g.
 * `langfuse:7` or `fallback:evaluate@2026-05-12`).
 *
 * @param name        Langfuse prompt name (e.g. `'evaluate-system-prompt'`).
 * @param fallback    In-repo `*_SYSTEM_PROMPT` constant — used verbatim
 *                    when the fetch can't succeed.
 * @param fallbackVersion  In-repo `*_SYSTEM_PROMPT_VERSION` constant —
 *                    embedded into the trace's `promptVersion` so
 *                    dashboards can cohort fallback periods.
 * @param label       Langfuse label to fetch; defaults to `'production'`.
 */
export async function getPromptOrFallback(
  name: string,
  fallback: string,
  fallbackVersion: string,
  label: string = PROMPT_LABEL_PRODUCTION,
): Promise<ResolvedPrompt> {
  const entry = await getCacheEntry(name, fallback, fallbackVersion, label);
  setResolvedPromptVersion(entry.resolved.version, entry.resolved.fromFallback);
  // `entry.promptClient` is the live `TextPromptClient` on a Langfuse hit
  // and `null` on the fallback path — `setResolvedPromptClient` forwards
  // either to the ALS frame so `startLangfuseGeneration` can decide
  // whether to link this generation to the prompt entry.
  setResolvedPromptClient(entry.promptClient);
  return entry.resolved;
}

/**
 * Resolve a Langfuse-registered templated prompt and substitute the
 * provided variables. Falls back to `applyTemplate(fallbackTemplate, vars)`
 * on any of:
 *
 *   - `LANGFUSE_PUBLIC_KEY` unset / Langfuse singleton null.
 *   - The fetch errors / times out (handled inside `fetchOrFallback`).
 *   - `TextPromptClient.compile(vars)` throws (Mustache parse error on
 *     the live template).
 *   - The compiled output still contains `{{var}}` placeholders — i.e.
 *     the Langfuse-side template introduced a variable the in-code
 *     builder doesn't compute. We refuse to ship a half-substituted
 *     prompt to Claude; the dashboards still show the broken Langfuse
 *     version via the warn + fallback cohort tag, so the operator can
 *     revert.
 *
 * The cache stores the fetched `TextPromptClient` (not the compiled
 * output) so `compile(vars)` runs locally on every call — no per-call
 * network round-trip. Caching the compiled string by vars-hash would
 * explode for generation prompts where `recentStems` changes per batch.
 *
 * @param name             Langfuse prompt name.
 * @param fallbackTemplate In-repo `*_SYSTEM_PROMPT_TEMPLATE` constant
 *                         with `{{flatVar}}` placeholders.
 * @param fallbackVersion  In-repo `*_SYSTEM_PROMPT_VERSION` constant.
 * @param vars             Pre-computed flat-string substitutions.
 * @param label            Langfuse label to fetch; defaults to `'production'`.
 */
export async function getPromptWithVarsOrFallback(
  name: string,
  fallbackTemplate: string,
  fallbackVersion: string,
  vars: Record<string, string>,
  label: string = PROMPT_LABEL_PRODUCTION,
): Promise<ResolvedPrompt> {
  const entry = await getCacheEntry(name, fallbackTemplate, fallbackVersion, label);

  // Fallback path (no live Langfuse template): substitute locally with
  // applyTemplate. `entry.resolved.text === fallbackTemplate` here, since
  // `fetchOrFallback` was called with `fallbackTemplate` as the fallback.
  if (!entry.promptClient) {
    const { text } = applyTemplate(fallbackTemplate, vars);
    setResolvedPromptVersion(entry.resolved.version, true);
    setResolvedPromptClient(null);
    return { ...entry.resolved, text };
  }

  // Langfuse path: `compile()` is Mustache.js (`{{flatVar}}` semantics
  // identical to `applyTemplate`).
  let compiled: string;
  try {
    compiled = entry.promptClient.compile(vars);
  } catch (err) {
    if (!warnedNames.has(name)) {
      warnedNames.add(name);
      console.warn(
        `[prompts-registry] compile failed for "${name}@${label}"; using fallback`,
        err,
      );
    }
    const { text } = applyTemplate(fallbackTemplate, vars);
    const fallbackVersionTag = `fallback:${fallbackVersion}`;
    setResolvedPromptVersion(fallbackVersionTag, true);
    setResolvedPromptClient(null);
    return { text, version: fallbackVersionTag, fromFallback: true };
  }

  // Catch the "Langfuse template introduced a placeholder the builder
  // doesn't pass" case. `String.match` with a /g regex does not mutate
  // `lastIndex`, so it's safe to reuse `TEMPLATE_VAR_RE` across calls.
  const leftover = compiled.match(TEMPLATE_VAR_RE);
  if (leftover && leftover.length > 0) {
    if (!warnedNames.has(name)) {
      warnedNames.add(name);
      console.warn(
        `[prompts-registry] template "${name}@${label}" has unfilled vars ${leftover.join(", ")}; using fallback`,
      );
    }
    const { text } = applyTemplate(fallbackTemplate, vars);
    const fallbackVersionTag = `fallback:${fallbackVersion}`;
    setResolvedPromptVersion(fallbackVersionTag, true);
    setResolvedPromptClient(null);
    return { text, version: fallbackVersionTag, fromFallback: true };
  }

  setResolvedPromptVersion(entry.resolved.version, false);
  setResolvedPromptClient(entry.promptClient);
  return { text: compiled, version: entry.resolved.version, fromFallback: false };
}

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Reset module-singleton state for tests. Clears the cache + warn-once
 * gate so cases that toggle `LANGFUSE_PUBLIC_KEY`, seed cache entries,
 * or test the warn-once dedup work independently.
 *
 * Tests SHOULD also call `__resetObservabilityForTests` if they exercise
 * `getLangfuse()` — the registry uses it but doesn't own its state.
 */
export function __resetRegistryForTests(): void {
  cache.clear();
  warnedNames.clear();
}
