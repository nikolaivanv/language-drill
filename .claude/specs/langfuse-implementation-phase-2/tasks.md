# Implementation Plan

## Status

**✅ Complete — all 31 tasks shipped (2026-05-20).** Tasks 1–30 landed
with the Phase 2 PR; task 31's six post-deploy scenarios were exercised
end-to-end against dev and prod per
`phase-2-post-deploy-runbook.md`. Phase 2's "fetch prompts from Langfuse
at runtime with in-repo fallback + eval/CLI workflow" is in production.

---

## Task Overview

Phase 2 implementation goes in **five layers**, each layer green-locked
by tests before moving to the next:

1. **Foundation** — observability changes (`onTraceCreated`,
   `setResolvedPromptVersion`, `promptFallback`) + `prompts-registry.ts`
   skeleton with `applyTemplate` and stub `getPromptOrFallback`. The
   contract is locked here so later tasks compile against stable types.
2. **Registry implementation** — the real `fetchOrFallback` + cache +
   `getPromptWithVarsOrFallback`, with mocked-Langfuse tests proving
   no-op, fetch, fallback, timeout, and cache paths.
3. **Static-surface migration** — `evaluate.ts` and `annotate.ts`
   adopt the registry. `systemPromptOverride` field added. Existing
   tests stay green; new tests cover the override + fetch paths.
4. **Builder-surface migration** — `generation-prompts.ts`,
   `validation-prompts.ts`, `theory-prompts.ts`,
   `theory-validation-prompts.ts` each get a fully-templated
   `*_SYSTEM_PROMPT_TEMPLATE`, an async builder, and a snapshot test
   proving byte-identity vs. the current synchronous output. Each
   caller (`generate.ts`, `validate.ts`, `theory-generate.ts`,
   `theory-validate.ts`) gets one `await` added.
5. **CLIs + wiring + docs** — three scripts under
   `packages/ai/scripts/`, package.json wiring, `.env.example`,
   `.gitignore`, `docs/llm-observability.md`, `CLAUDE.md`, and the
   pre-push gate.

Phase 1's `LANGFUSE_PUBLIC_KEY`-unset code path is exercised by every
existing test, so a green suite during early tasks proves the no-op
contract (Req 2 AC 2 / Req 7 AC 3).

## Steering Document Compliance

- **Monorepo layout** (CLAUDE.md): all new code lives in
  `packages/ai/src/` (registry) and `packages/ai/scripts/` (CLIs).
  `packages/db` is not touched. `infra/*` is not touched.
- **Forward-only Drizzle migrations**: no schema change.
- **Tests gate task completion** (CLAUDE.md): every implementation
  task ends with a Vitest run that must pass before marking complete.
- **Latest stable deps**: no new npm deps — `langfuse@^3.38.20` is
  already installed for Phase 1.
- **Prompt-edit discipline** (CLAUDE.md): bump the matching
  `*_SYSTEM_PROMPT_VERSION` to today's date in the same commit as any
  semantic prompt edit. Phase 2 does NOT re-write the prompt content
  (we move the same content into Langfuse and re-template the
  builders) so no version bumps are required during this spec — but
  tasks 9, 11, 13, 15 explicitly assert byte-identity to catch any
  accidental drift.
- **Hono on Lambda**, **Secrets in AWS Secrets Manager**, **CI/CD via
  GitHub Actions**: unchanged from Phase 1; Phase 2 reuses every
  existing pattern.

## Atomic Task Requirements

Each task touches 1–3 related files, completes in 15–30 min, and has
one testable outcome. Files are listed by absolute path within the
worktree root. Requirements are referenced with `_Requirements: X.Y_`
and existing code to leverage with `_Leverage: path/to/file.ts_`.

## Tasks

### Foundation

- [x] 1. Add `onTraceCreated` callback + `promptFallback` field to `LlmTraceContext`
  - File: `packages/ai/src/observability.ts`
  - Extend `LlmTraceContext` interface with two new optional fields: `onTraceCreated?: (trace: LangfuseTraceClient) => void` (imports `LangfuseTraceClient` from `langfuse`) and `promptFallback?: boolean`. Update the JSDoc with the design rationale (no escape from ALS scope; errors swallowed with warn-once). In `startLangfuseGeneration`, after `const trace = lf.trace(...)` returns, invoke `ctx.onTraceCreated?.(trace)` inside a try/catch that uses the existing `warnOnce`. In `buildTraceMetadata`, append `if (ctx.promptFallback !== undefined) m.promptFallback = ctx.promptFallback`.
  - Update `packages/ai/src/observability.test.ts`: add tests asserting (a) `onTraceCreated` is called once with a non-null trace; (b) a thrower callback is swallowed via `warnOnce`; (c) `promptFallback: true` shows up in trace metadata.
  - Run `pnpm --filter @language-drill/ai test` — all tests must pass.
  - Purpose: provide the Phase-1-extension seams the eval runner and the registry depend on.
  - _Leverage: `packages/ai/src/observability.ts:447-476` (`startLangfuseGeneration`), `packages/ai/src/observability.ts:351-377` (`buildTraceMetadata`), `packages/ai/src/observability.ts:283-289` (`warnOnce`)_
  - _Requirements: 4.2, 4.3 (promptFallback tag); enabling 6.2 (onTraceCreated for eval runner)_

- [x] 2. Add `setResolvedPromptVersion` mutator to observability.ts
  - File: `packages/ai/src/observability.ts`
  - Add and export `setResolvedPromptVersion(version: string, fromFallback: boolean = false): void` near `getCurrentLlmTraceContext`. Reads the ALS store; if present, sets `store.promptVersion = version` and `store.promptFallback = fromFallback`. No-op outside a `withLlmTrace` scope. Add a comment pinning the retry-constraint invariant (re-call `getPromptOrFallback` before each Claude call within a scope).
  - Add to `packages/ai/src/observability.test.ts`: assert mutation is visible to a subsequent `getCurrentLlmTraceContext()` in the same `withLlmTrace` scope; assert no-op outside one.
  - Re-export `setResolvedPromptVersion` from `packages/ai/src/index.ts` alongside the other observability exports.
  - Run `pnpm --filter @language-drill/ai test`.
  - Purpose: lets the registry update the trace's `promptVersion` after fetch without changing the Phase-1 Proxy.
  - _Leverage: `packages/ai/src/observability.ts:130-135` (`getCurrentLlmTraceContext`), `packages/ai/src/observability.ts:103-127` (`withLlmTrace`)_
  - _Requirements: 2.6, 4.1, 4.2_

- [x] 3. Create `prompts-registry.ts` skeleton — types, env knobs, `applyTemplate`
  - File: `packages/ai/src/prompts-registry.ts` (NEW)
  - Export: `interface ResolvedPrompt`; `const LANGFUSE_PROMPT_CACHE_TTL_MS = 300_000`; `const LANGFUSE_PROMPT_FETCH_TIMEOUT_MS = 250`; `const PROMPT_LABEL_PRODUCTION = 'production'`; `function applyTemplate(template, vars): { text, missingVars }`. Read TTL + timeout overrides from `process.env.LANGFUSE_PROMPT_CACHE_TTL_MS` / `LANGFUSE_PROMPT_FETCH_TIMEOUT_MS` at module load. Add a `__resetRegistryForTests()` stub that does nothing yet. Stub `getPromptOrFallback` and `getPromptWithVarsOrFallback` to always return the fallback (no Langfuse call yet) so call sites in later tasks can compile.
  - Re-export `applyTemplate`, `LANGFUSE_PROMPT_CACHE_TTL_MS`, `LANGFUSE_PROMPT_FETCH_TIMEOUT_MS`, `PROMPT_LABEL_PRODUCTION`, `ResolvedPrompt`, `getPromptOrFallback`, `getPromptWithVarsOrFallback`, `__resetRegistryForTests` from `packages/ai/src/index.ts`.
  - Run `pnpm --filter @language-drill/ai typecheck`.
  - Purpose: lock the public API so tasks 6–15 can write call sites against it before the real fetch lands.
  - _Leverage: `packages/ai/src/observability.ts` (module pattern: types-then-impl-then-test-helpers)_
  - _Requirements: 2.1, 2.5 (timeout constant), 3.1 (applyTemplate for Mustache parity)_

- [x] 4. Add tests for `applyTemplate` and skeleton no-op contract
  - File: `packages/ai/src/prompts-registry.test.ts` (NEW)
  - Assertions: (a) `applyTemplate('{{a}} and {{b}}', { a: 'foo', b: 'bar' })` returns `{ text: 'foo and bar', missingVars: [] }`; (b) missing var leaves the placeholder in place and reports it in `missingVars`; (c) repeated `{{a}}` substitutions all replace; (d) `{{}}` (empty key) is left alone; (e) `getPromptOrFallback('x', 'fallback-text', 'v1')` returns `{ text: 'fallback-text', version: 'fallback:v1', fromFallback: true }` synchronously when `LANGFUSE_PUBLIC_KEY` is unset (use `vi.stubEnv` to clear it for the test).
  - Run `pnpm --filter @language-drill/ai test`.
  - Purpose: pin the substituter contract and the no-op contract before the real fetch lands.
  - _Leverage: `packages/ai/src/observability.test.ts` (Vitest env-stubbing pattern)_
  - _Requirements: 2.2, 3.1, 3.4_

### Registry implementation

- [x] 5. Implement `fetchOrFallback` + cache in `prompts-registry.ts`
  - File: `packages/ai/src/prompts-registry.ts`
  - Replace the stub `getPromptOrFallback` with the real implementation per design Component 1: module-scope `Map<string, CacheEntry>` cache, `warnedNames: Set<string>` for one-warn-per-cold-start, `fetchOrFallback(name, fallback, fallbackVersion, label)` that calls `getLangfuse().getPrompt(name, undefined, { label, cacheTtlSeconds: 0 })` raced against `LANGFUSE_PROMPT_FETCH_TIMEOUT_MS`, populates the wrapper cache (always — both success and fallback), and returns `{ resolved, promptClient, fetchedAt }`. `getPromptOrFallback` reads cache, evicts on TTL expiry, calls `fetchOrFallback`, then `setResolvedPromptVersion(resolved.version, resolved.fromFallback)` and returns the `ResolvedPrompt`. Wrap `__resetRegistryForTests` to clear cache + warnedNames.
  - Add a `raceWithTimeout(promise, timeoutMs, label)` helper that rejects with a labelled timeout error.
  - Update `packages/ai/src/prompts-registry.test.ts`: add cases for (a) no-Langfuse → fallback (existing); (b) mocked Langfuse returns prompt → `{ text, version: 'langfuse:N', fromFallback: false }` and `setResolvedPromptVersion` was called; (c) mocked Langfuse throws → fallback + warn-once; (d) mocked Langfuse pends past 250 ms → fallback + warn-once; (e) cache hit within TTL avoids re-entering the SDK; (f) cache expires past TTL and re-fetches. Use `__resetRegistryForTests` between cases that toggle env vars.
  - Run `pnpm --filter @language-drill/ai test`.
  - Purpose: prove the static-prompt fetch path end-to-end.
  - _Leverage: `packages/ai/src/observability.ts:175-208` (`getLangfuse` lazy singleton with warn-once pattern), Phase-1 `__resetForTests` shape (line 822)_
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 4.2, 7.1, 7.3_

- [x] 6. Implement `getPromptWithVarsOrFallback` for templated prompts
  - File: `packages/ai/src/prompts-registry.ts`
  - Implement per design Component 1: shares the cache + `fetchOrFallback` from task 5. On Langfuse hit, calls `entry.promptClient.compile(vars)`; checks output for un-filled `{{var}}` via the same `TEMPLATE_VAR_RE`; if any leftover, warns-once and falls back via `applyTemplate(fallbackTemplate, vars)`. On Langfuse miss / outage / compile-throw, substitutes locally via `applyTemplate(fallbackTemplate, vars)`. Always calls `setResolvedPromptVersion(version, fromFallback)`.
  - Add tests to `packages/ai/src/prompts-registry.test.ts`: (a) Langfuse hit → mocked `compile(vars)` is called and its result returned; (b) Langfuse template missing a variable the caller didn't pass → leftover `{{x}}` detected, falls back; (c) Langfuse template throws on compile → falls back, warn-once; (d) Langfuse unset → `applyTemplate(fallbackTemplate, vars)` is the result.
  - Run `pnpm --filter @language-drill/ai test`.
  - Purpose: prove the templated fetch path before any builder is migrated to use it.
  - _Leverage: `packages/ai/src/prompts-registry.ts` (`fetchOrFallback`, `applyTemplate` from task 5)_
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

### Static-surface migration

- [x] 7. Migrate `evaluate.ts` to fetch the system prompt via the registry
  - File: `packages/ai/src/evaluate.ts`, `packages/ai/src/prompts-registry.ts`
  - Export a tiny `sha8(s: string): string` helper from `prompts-registry.ts` (8-char SHA-256 prefix via `node:crypto.createHash('sha256').update(s).digest('hex').slice(0,8)`) — both `evaluate.ts` and `annotate.ts` (task 8) and the eval runner (task 24) reuse this.
  - In `evaluate.ts`: add `systemPromptOverride?: string` to `EvaluateAnswerInput`. Inside `evaluateAnswer`, branch: if override present, set `systemPromptText = override` and call `setResolvedPromptVersion(\`override:\${sha8(override)}\`, false)`; otherwise `const { text } = await getPromptOrFallback('evaluate-system-prompt', EVALUATION_SYSTEM_PROMPT, EVALUATION_SYSTEM_PROMPT_VERSION)` and use it. Replace the `system: [{ ..., text: EVALUATION_SYSTEM_PROMPT, ... }]` reference with `text: systemPromptText`.
  - Update `packages/ai/src/evaluate.test.ts`: assert that with `LANGFUSE_PUBLIC_KEY` unset (default) the call works exactly as today; assert override path uses the override verbatim (mock `client.messages.create` to capture the system block); assert `setResolvedPromptVersion` was called with the expected version on each path (mock or spy from `@language-drill/ai`).
  - Run `pnpm --filter @language-drill/ai test`.
  - Purpose: wire the user-facing evaluation surface to the registry.
  - _Leverage: `packages/ai/src/evaluate.ts:220-272` (existing `evaluateAnswer`), `packages/ai/src/prompts.ts:42-92` (`EVALUATION_SYSTEM_PROMPT*`)_
  - _Requirements: 1.4, 2.1, 2.6, 6.1, 6.6 (`promptSha`)_

- [x] 8. Migrate `annotate.ts` (streamAnnotation) to fetch the system prompt via the registry
  - File: `packages/ai/src/annotate.ts`
  - Add `systemPromptOverride?: string` to `AnnotateStreamInput`. Inside `streamAnnotation`, branch the same way as task 7: override → `setResolvedPromptVersion(\`override:\${sha8(override)}\`)`; otherwise `await getPromptOrFallback('annotate-system-prompt', ANNOTATE_SYSTEM_PROMPT, ANNOTATE_SYSTEM_PROMPT_VERSION)`. Replace `ANNOTATE_SYSTEM_PROMPT` in the call to `client.messages.stream({system: [...]})` with the resolved `systemPromptText`. Import `sha8` from `prompts-registry.ts` (added in task 7).
  - Update `packages/ai/src/annotate.test.ts` (and `annotate-stream.test.ts` if streaming): existing tests stay green; add one new test confirming override is used verbatim.
  - Run `pnpm --filter @language-drill/ai test`.
  - Purpose: wire the user-facing annotation surface to the registry.
  - _Leverage: `packages/ai/src/annotate.ts:94-99` (`ANNOTATE_SYSTEM_PROMPT*`), the existing `streamAnnotation` setup that already awaits before opening the SSE stream_
  - _Requirements: 1.4, 2.1, 2.6_

### Builder-surface migration — generation prompts

- [x] 9. Add `GENERATION_SYSTEM_PROMPT_TEMPLATE` constant + snapshot parity test
  - Files: `packages/ai/src/generation-prompts.ts`, `packages/ai/src/generation-prompts.test.ts`
  - In `generation-prompts.ts`, add an exported `GENERATION_SYSTEM_PROMPT_TEMPLATE` string with the FULL system prompt expressed as `{{flatVarName}}` placeholders (per design §3c): `language`, `cefrLevel`, `exerciseType`, `grammarPointName`, `grammarPointDescription`, `positiveExamplesBullets`, `negativeExamplesBullets`, `commonErrorsBullets`, `cefrDescriptors`, `priorPoolSection`, `recentStemsBlock`, `toolName`. The structure must match the current `buildGenerationSystemPrompt` output exactly.
  - In `generation-prompts.test.ts`, add a `describe('GENERATION_SYSTEM_PROMPT_TEMPLATE byte parity')` block that, for at least one fixture `(GenerationPromptInputs, recentStems)`, asserts `applyTemplate(GENERATION_SYSTEM_PROMPT_TEMPLATE, computeVars(inputs, recentStems)).text === buildGenerationSystemPrompt(inputs, recentStems)` (current sync output — pin against today's behavior before making it async in task 10). Where `computeVars` is the same var computation that task 10 will move out of the builder.
  - **Crucial:** fix the existing byte-identity test at `generation-prompts.test.ts:199-200` if it compares Promises naively after task 10's async refactor (look ahead).
  - Run `pnpm --filter @language-drill/ai test`.
  - Purpose: pin byte-identity between the new template and the current builder BEFORE the async refactor, so any drift is caught in this commit.
  - _Leverage: `packages/ai/src/generation-prompts.ts:134-176` (current `buildGenerationSystemPrompt`)_
  - _Requirements: 3.1, 3.2 (byte-identity invariant)_

- [x] 10. Make `buildGenerationSystemPrompt` async and fetch from registry
  - File: `packages/ai/src/generation-prompts.ts`
  - Change `buildGenerationSystemPrompt(inputs, recentStems): string` → `Promise<string>`. Extract the var computation into a local helper `computeVars(inputs, recentStems): Record<string, string>` (the same logic the snapshot test in task 9 uses). Body becomes: `const vars = computeVars(inputs, recentStems); const { text } = await getPromptWithVarsOrFallback('generate-system-prompt', GENERATION_SYSTEM_PROMPT_TEMPLATE, GENERATION_PROMPT_VERSION, vars); return text;`.
  - In `generation-prompts.test.ts`, await all existing calls. Replace `expect(buildGenerationSystemPrompt(...)).toBe(buildGenerationSystemPrompt(...))` (line ~199–200) with `expect(await Promise.all([buildGenerationSystemPrompt(...), buildGenerationSystemPrompt(...)])).toEqual([s, s])` or equivalent — must await both before comparing.
  - Run `pnpm --filter @language-drill/ai test`.
  - Purpose: route generation through the registry without breaking byte-identity.
  - _Leverage: `packages/ai/src/generation-prompts.ts:134-176`, `getPromptWithVarsOrFallback` (task 6)_
  - _Requirements: 3.2, 3.5_

- [x] 11. Update `generate.ts` to await the now-async builder
  - File: `packages/ai/src/generate.ts`
  - Find the single call site for `buildGenerationSystemPrompt` and add `await`. Confirm the surrounding function is already `async` (it is — `generateBatch` is async). No other changes.
  - Update `packages/ai/src/generate.test.ts` if needed (await the call in any test that builds the prompt directly).
  - Run `pnpm --filter @language-drill/ai test`.
  - Purpose: keep the caller in sync with the async signature.
  - _Leverage: `packages/ai/src/generate.ts` (look for `buildGenerationSystemPrompt(`)_
  - _Requirements: 3.2_

### Builder-surface migration — validation prompts

- [x] 12. Add `VALIDATION_SYSTEM_PROMPT_TEMPLATE` constant + snapshot parity test
  - Files: `packages/ai/src/validation-prompts.ts`, `packages/ai/src/validation-prompts.test.ts`
  - **Replace** the existing `VALIDATION_SYSTEM_PROMPT_TEMPLATE` (which currently uses `{{grammarPoint.examplesPositive}}`-style nested paths — see `validation-prompts.ts:51-93`) with a flat-string-var version matching `buildValidationSystemPrompt`'s output exactly. New placeholders: `language`, `cefrLevel`, `grammarPointName`, `grammarPointDescription`, `positiveExamplesBullets`, `commonErrorsBullets`, `cefrDescriptors`.
  - In `validation-prompts.test.ts`, add `describe('VALIDATION_SYSTEM_PROMPT_TEMPLATE byte parity')` asserting `applyTemplate(VALIDATION_SYSTEM_PROMPT_TEMPLATE, computeVars(spec)).text === buildValidationSystemPrompt(spec)` for at least one fixture spec.
  - Update any existing test that imports the OLD template (it was test-only per the file comment); rewrite assertions in terms of the new flat-var template.
  - Run `pnpm --filter @language-drill/ai test`.
  - Purpose: pin byte-identity between the new template and the current builder; supersede the placeholder Phase-1 template that was never live.
  - _Leverage: `packages/ai/src/validation-prompts.ts:51-93` (current placeholder template), `packages/ai/src/validation-prompts.ts:107-152` (current builder)_
  - _Requirements: 3.1, 3.2_

- [x] 13. Make `buildValidationSystemPrompt` async and fetch from registry
  - File: `packages/ai/src/validation-prompts.ts`
  - Change `buildValidationSystemPrompt(spec): string` → `Promise<string>`. Extract var computation into `computeVars(spec)`. Body: `const { text } = await getPromptWithVarsOrFallback('validate-system-prompt', VALIDATION_SYSTEM_PROMPT_TEMPLATE, VALIDATION_PROMPT_VERSION, vars); return text;`.
  - Update `packages/ai/src/validation-prompts.test.ts`: await all existing calls.
  - Run `pnpm --filter @language-drill/ai test`.
  - Purpose: route validation through the registry.
  - _Leverage: `packages/ai/src/validation-prompts.ts:107-152`, `getPromptWithVarsOrFallback`_
  - _Requirements: 3.3, 3.5_

- [x] 14. Update `validate.ts` to await the now-async builder
  - File: `packages/ai/src/validate.ts`
  - Add `await` to the single `buildValidationSystemPrompt` call site. Confirm the enclosing function is async (it is).
  - Update `packages/ai/src/validate.test.ts` if needed.
  - Run `pnpm --filter @language-drill/ai test`.
  - Purpose: keep the caller in sync.
  - _Leverage: `packages/ai/src/validate.ts` (find the call site)_
  - _Requirements: 3.3_

### Builder-surface migration — theory prompts

- [x] 15. Add `THEORY_SYSTEM_PROMPT_TEMPLATE` + snapshot parity test
  - Files: `packages/ai/src/theory-prompts.ts`, `packages/ai/src/theory-prompts.test.ts`
  - Same pattern as task 9, applied to `buildTheorySystemPrompt`. Define a flat-string-var template that produces today's output byte-for-byte. Add a snapshot parity test.
  - Run `pnpm --filter @language-drill/ai test`.
  - Purpose: pin byte-identity for theory generation before the async refactor.
  - _Leverage: `packages/ai/src/theory-prompts.ts` (current builder)_
  - _Requirements: 3.1, 3.2_

- [x] 16. Make `buildTheorySystemPrompt` async + update `theory-generate.ts`
  - Files: `packages/ai/src/theory-prompts.ts`, `packages/ai/src/theory-generate.ts`
  - Combine tasks 10+11 for theory. Convert builder to async + `getPromptWithVarsOrFallback('theory-generate-system-prompt', ..., THEORY_GENERATION_PROMPT_VERSION, vars)`. Add `await` to the single call site in `theory-generate.ts`. Update both test files.
  - Run `pnpm --filter @language-drill/ai test`.
  - Purpose: route theory generation through the registry.
  - _Leverage: `packages/ai/src/theory-prompts.ts`, `packages/ai/src/theory-generate.ts`_
  - _Requirements: 3.3, 3.5_

- [x] 17. Add `THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE` + snapshot parity test
  - Files: `packages/ai/src/theory-validation-prompts.ts`, `packages/ai/src/theory-validation-prompts.test.ts`
  - Same pattern as task 12 — replace any placeholder template, pin byte-identity.
  - Run `pnpm --filter @language-drill/ai test`.
  - Purpose: pin byte-identity for theory validation.
  - _Leverage: `packages/ai/src/theory-validation-prompts.ts` (current builder)_
  - _Requirements: 3.1, 3.2_

- [x] 18. Make `buildTheoryValidationSystemPrompt` async + update `theory-validate.ts`
  - Files: `packages/ai/src/theory-validation-prompts.ts`, `packages/ai/src/theory-validate.ts`
  - Combine tasks 13+14 for theory validation. Convert builder to async + `getPromptWithVarsOrFallback('theory-validate-system-prompt', ..., THEORY_VALIDATION_PROMPT_VERSION, vars)`. Add `await` in `theory-validate.ts`. Update tests.
  - Run `pnpm --filter @language-drill/ai test`.
  - Purpose: route theory validation through the registry.
  - _Leverage: `packages/ai/src/theory-validation-prompts.ts`, `packages/ai/src/theory-validate.ts`_
  - _Requirements: 3.3, 3.5_

### Index re-exports

- [x] 19. Re-export the four new `*_SYSTEM_PROMPT_TEMPLATE` constants from `packages/ai/src/index.ts`
  - File: `packages/ai/src/index.ts`
  - Append `GENERATION_SYSTEM_PROMPT_TEMPLATE`, `VALIDATION_SYSTEM_PROMPT_TEMPLATE` (already exported but re-confirm the path), `THEORY_SYSTEM_PROMPT_TEMPLATE`, `THEORY_VALIDATION_SYSTEM_PROMPT_TEMPLATE` to the matching re-export blocks. These are consumed by `bootstrap-prompts.ts` in task 20.
  - Run `pnpm --filter @language-drill/ai typecheck`.
  - Purpose: make the templates importable from the bootstrap CLI.
  - _Leverage: `packages/ai/src/index.ts:56-64, 86-91, 113-117, 137-142` (existing re-export blocks)_
  - _Requirements: 1.5_

### CLIs

- [x] 20. Add `bootstrap-prompts.ts` CLI — default mode + tests
  - Files: `packages/ai/scripts/bootstrap-prompts.ts` (NEW), `packages/ai/scripts/bootstrap-prompts.test.ts` (NEW)
  - Implement per design Component 4 default mode only (no `--check` yet; that's task 21). Imports the 6 `*_SYSTEM_PROMPT` / `*_SYSTEM_PROMPT_TEMPLATE` + matching `*_VERSION` from `@language-drill/ai`. Iterates a `PROMPTS = [...]` array with `{name, text, version, surface}`. For each: calls `lf.getPrompt(name, undefined, {label: 'production', cacheTtlSeconds: 0})` inside a try/catch. On 404 (broad detection: `err.status === 404 || /not\s*found/i.test(err.message)`) → `lf.createPrompt({name, prompt: text, labels: ['production'], config: {localVersion: version, surface, registeredAt: <iso>}})`. On hit → log skip. On any other error → exit non-zero. Supports `--dry-run` flag (parse via `node:util.parseArgs`).
  - Tests (mock the Langfuse SDK): (a) fresh project → 6 createPrompt calls; (b) all exist → 0 creates; (c) one exists, five don't → 5 creates; (d) `--dry-run` → 0 creates, 6 logs.
  - Run `pnpm --filter @language-drill/ai test`.
  - Purpose: enable one-command initialisation of a Langfuse project.
  - _Leverage: `packages/ai/src/observability.ts:175-208` (`getLangfuse` for env var handling), `packages/db/scripts/generate-exercises.ts` (existing CLI pattern with `parseArgs`)_
  - _Requirements: 1.1, 1.2, 1.3, 1.5, 7.1_

- [x] 21. Add `--check` drift-detection mode to `bootstrap-prompts.ts`
  - Files: `packages/ai/scripts/bootstrap-prompts.ts`, `packages/ai/scripts/bootstrap-prompts.test.ts`
  - Add the `--check` branch: for each prompt, fetch the live `production` body; compare byte-for-byte against the in-repo string (static prompts) or template (builder-composed). Print a unified diff per mismatch and exit 1 if any mismatch; exit 0 with a "all match" log otherwise. Use `node:util` formatting or a tiny inline diff (small enough; no new deps).
  - Tests: (a) all match → exit 0; (b) one mismatch → exit 1 + diff printed; (c) Langfuse outage → exit non-zero with explanatory message.
  - Run `pnpm --filter @language-drill/ai test`.
  - Purpose: give operators a "is Langfuse drifted from main?" command.
  - _Leverage: `packages/ai/scripts/bootstrap-prompts.ts` (from task 20)_
  - _Requirements: 1.2 (byte-identity), 10.3_

- [x] 22. Add `eval-export.ts` CLI — Langfuse trace fetch + sampling
  - Files: `packages/ai/scripts/eval-export.ts` (NEW)
  - Parse argv: `--from`, `--to`, `--sample`, `--dataset`, `--language?`, `--cefr?`, `--seed?`. Build tag filter array from `feature:evaluate` + optional language / CEFR. Call `langfuse.api.traceList({tags, fromTimestamp, toTimestamp, limit: 1000})` with pagination. Apply uniform-random sampling with optional seed (use a tiny PRNG seeded from the integer — no new dep; vanilla `Math.random()` falls back to crypto-derived seed if `--seed` absent). Print a summary "fetched N, sampled M" and return the sampled list (a thin function the test can call directly).
  - Defer dataset-item creation to task 23 — task 22 stops at "produces a sampled trace list."
  - Run `pnpm --filter @language-drill/ai typecheck`.
  - Purpose: lay down the fetch + sample primitives in isolation, testable without Drizzle.
  - _Leverage: `packages/ai/src/observability.ts:175-208` (`getLangfuse`), Langfuse SDK `api.traceList` (verified at `langfuse@3.38.20/lib/index.d.ts:2460`)_
  - _Requirements: 5.1, 5.5, 5.6_

- [x] 23. Add dataset item creation + dedupe to `eval-export.ts` + tests
  - Files: `packages/ai/scripts/eval-export.ts`, `packages/ai/scripts/eval-export.test.ts` (NEW)
  - Add: get-or-create dataset via `lf.getDataset(args.dataset).catch(() => lf.createDataset({name}))`. Fetch existing items via `lf.fetchDatasetItems({datasetName, limit: 10_000})`; build `existingSubmissionIds = new Set(items.data.map(i => i.metadata.submissionId))`. For each sampled trace, extract `submissionId`, `language`, `cefrLevel`, `exerciseType` from `trace.metadata`. Skip if `submissionId` is already in the dataset. Query `user_exercise_history JOIN exercises` via Drizzle (`db.query.userExerciseHistory.findFirst({where: eq(id, submissionId), with: {exercise: true}})`) for the user answer + exercise content. Build `input = {exercise, userAnswer, language, difficulty: cefrLevel}` and `expectedOutput = trace.output` (the `EvaluationResult`). Call `lf.createDatasetItem({datasetName, input, expectedOutput, metadata: {submissionId, language, cefrLevel, exerciseType, localPromptVersion: trace.metadata.localPromptVersion, sourceTraceId: trace.id, exportedAt}})`. Wrap each item in try/catch — log and continue on per-item failures.
  - Tests (mock Langfuse + mock Drizzle `db.query`): (a) 5 fixture traces → 5 items created (no dedupe); (b) 3 of 5 already in dataset → 2 items created; (c) one trace missing user answer in Neon → logged + skipped, 4 items created; (d) Langfuse outage on `createDataset` → script exits non-zero.
  - Run `pnpm --filter @language-drill/ai test`.
  - Purpose: turn sampled traces into a usable dataset.
  - _Leverage: `packages/ai/scripts/eval-export.ts` (task 22), `packages/db/src/schema.ts` (`userExerciseHistory`), `packages/db/src/index.ts` (Drizzle `db` export)_
  - _Requirements: 5.2, 5.3, 5.4, 5.6, 5.7_

- [x] 24. Add `eval-run.ts` CLI — candidate resolution + dataset iteration
  - Files: `packages/ai/scripts/eval-run.ts` (NEW), `packages/ai/scripts/eval-run.test.ts` (NEW)
  - Parse argv: `--dataset`, `--candidate`, `--run-name?`, `--allow-prod?`, `--limit?`. Refuse if `LANGFUSE_ENV === 'prod'` without `--allow-prod` (Req 8 AC 4). Resolve candidate: `file:<path>` → `readFileSync(path, 'utf8')`; `langfuse:<name>@<label>` → `(await lf.getPrompt(name, undefined, {label})).prompt`. Compute `promptSha = sha256(text).slice(0,8)`; default `runName = \`candidate-\${promptSha}-\${iso}\``. Fetch dataset via `lf.getDataset(datasetName)`, iterate `dataset.items`. For each item: open a `withLlmTrace({feature: 'evaluate', env: 'dev', userId: 'eval-runner', requestId: \`evalrun:\${item.id}\`, promptVersion: \`eval-run:\${promptSha}\`, onTraceCreated: trace => { itemTrace = trace }, ...})` scope; call `evaluateAnswer(client, {...item.input, systemPromptOverride: candidateText})`; record `latencyMs` and capture errors; in a try/catch around `item.link(itemTrace, runName, {metadata: {promptSha, candidateSource}})`. Push result to in-memory array.
  - Stops at "all items processed, results in memory" — task 25 adds the diff computation.
  - Tests (mock Langfuse + stub Anthropic with a fixed `EvaluationResult`): (a) 3-item dataset, file-candidate → 3 traces emitted, 3 `link` calls, 3 results; (b) `LANGFUSE_ENV=prod` without `--allow-prod` → exits non-zero before any call; (c) Anthropic stub throws on item 2 → 3 results, one with `error` set, no early termination; (d) `link()` throws → warned, eval data still in summary.
  - Run `pnpm --filter @language-drill/ai test`.
  - Purpose: the iteration shell that the diff layer plugs into.
  - _Leverage: `packages/ai/src/observability.ts:103-127` (`withLlmTrace`), `packages/ai/src/evaluate.ts` (after task 7 has `systemPromptOverride`), `packages/ai/src/observability.ts` (`onTraceCreated` from task 1)_
  - _Requirements: 6.1, 6.2, 6.5, 7.2, 8.1, 8.2, 8.4_

- [x] 25. Add quality / cost / latency diff + summary output to `eval-run.ts`
  - Files: `packages/ai/scripts/eval-run.ts`, `packages/ai/scripts/eval-run.test.ts`
  - Implement `computeDiff(results, runMetadata): EvalRunSummary` per design Model 3 + Component 6 step 7. Helpers: `deltaStats(items, fn, signFlipThreshold?)` returns `{avgDelta, p95AbsDelta, signFlips?}`; CEFR distance = `Math.abs(cefrIndex(a) - cefrIndex(b))` over `A1..C2 → 0..5`. Cost: candidate = sum of `estimateCostUsd(usage)` from in-process Anthropic responses (capture `response.usage` inside the loop by reading it from the trace's `costDetails.total` if surfaced, OR computing locally from the same usage object the SDK returned); baseline = `null` if not available (the dataset item's `expectedOutput` doesn't carry usage today — log "baseline cost not captured" once and proceed). Latency p50/p95 of `latencyMs`. Print a markdown table to stdout. Write `./eval-runs/<runName>.json` with the full summary including `perItem` array.
  - Tests: (a) fixture 3-item run → markdown table contains all expected columns; (b) JSON file is written with `perItem` field present; (c) `summary.errors.length > 0` → exit code 1.
  - Run `pnpm --filter @language-drill/ai test`.
  - Purpose: turn the per-item results into a single decision-grade artefact.
  - _Leverage: `packages/ai/src/cost-model.ts:estimateCostUsd`, design.md Component 6 type sketch_
  - _Requirements: 6.3, 6.4, 6.7, 8.3_

### Wiring + docs

- [x] 26. Wire `packages/ai/package.json` scripts and root pnpm shortcuts
  - Files: `packages/ai/package.json`, root `package.json`
  - In `packages/ai/package.json` add `"scripts": { "bootstrap-prompts": "tsx scripts/bootstrap-prompts.ts", "eval:export": "tsx scripts/eval-export.ts", "eval": "tsx scripts/eval-run.ts" }`. In the root `package.json`, add `"bootstrap-prompts": "pnpm --filter @language-drill/ai bootstrap-prompts"`, `"eval:export": "pnpm --filter @language-drill/ai eval:export"`, `"eval": "pnpm --filter @language-drill/ai eval"` so the bare `pnpm eval` works from the repo root.
  - Smoke: from the repo root, run `pnpm eval --help` (the CLI should print usage and exit 0) and `pnpm bootstrap-prompts --dry-run` (should attempt a dry-run, fail-soft if Langfuse keys are unset).
  - Purpose: make the CLIs invocable per the requirements doc commands.
  - _Leverage: existing `pnpm db:studio` shortcut pattern in root `package.json`_
  - _Requirements: 5.1, 6.1, Req 10 AC 2_

- [x] 27. Update `.env.example`, `.gitignore`
  - Files: `.env.example`, `.gitignore`
  - In `.env.example`, after the existing Langfuse block, add optional `LANGFUSE_PROMPT_CACHE_TTL_MS` (default 300000) and `LANGFUSE_PROMPT_FETCH_TIMEOUT_MS` (default 250) with comments explaining the trade-offs.
  - In `.gitignore`, append `eval-runs/` (eval-runner JSON output directory).
  - Purpose: complete environment surface so a new clone runs out of the box.
  - _Leverage: `.env.example` (existing Langfuse block — Phase 1 added it)_
  - _Requirements: 8.2 (eval runner reuses `ANTHROPIC_API_KEY`), 10.2_

- [x] 28. Update `docs/llm-observability.md` with Phase 2 section
  - File: `docs/llm-observability.md`
  - After §7 (Phase plan), add a new "Phase 2 — Prompt registry" section documenting: (a) the six prompt names, (b) the `production` / `candidate-*` label convention, (c) the 5-minute cache TTL with rationale, (d) the fallback behaviour, (e) the `pnpm bootstrap-prompts` / `pnpm eval:export` / `pnpm eval` commands, (f) the `--check` drift detection, (g) the `eval-runs/` JSON artefact format, (h) the cost / latency / quality diff metrics.
  - Purpose: durable operator runbook for this workflow.
  - _Leverage: `docs/llm-observability.md` (existing §6 Use cases, §7 Phase plan)_
  - _Requirements: 10.1_

- [x] 29. Update `CLAUDE.md` — Running locally table + Prompt Editing note
  - File: `CLAUDE.md`
  - In the "Running locally" table, add three rows: `pnpm bootstrap-prompts`, `pnpm eval:export`, `pnpm eval` with short descriptions. In the "Prompt Editing" section, append one sentence: _"Langfuse is now the live source for these prompts; the in-repo `*_SYSTEM_PROMPT` constant is the fallback. Bumping `*_SYSTEM_PROMPT_VERSION` is still required (drives the fallback cohort tag and signals reviewers that the local fallback also changed)."_
  - Purpose: keep the project guide authoritative; satisfy Req 10 AC 2.
  - _Leverage: `CLAUDE.md` "Running locally" table (existing 6 rows), "Prompt Editing" section (existing — added in Phase 1)_
  - _Requirements: 10.2_

### Gates

- [x] 30. Full-suite gate — lint, typecheck, test from repo root
  - Run from the worktree root: `pnpm lint && pnpm typecheck && pnpm test`. All three must report zero failures. Fix any regressions before considering Phase 2 done.
  - Purpose: pre-push gate (CLAUDE.md "Pre-Push Checks").
  - _Leverage: existing scripts in root `package.json` (`lint`, `typecheck`, `test`)_
  - _Requirements: 7.3, 7.4_

- [x] 31. Manual post-deploy verification — six acceptance scenarios
  - Files: none (operator runbook step). Printable checklist:
    `.claude/specs/langfuse-implementation-phase-2/phase-2-post-deploy-runbook.md`
  - After merging:
    1. `pnpm bootstrap-prompts` against the dev Langfuse project; confirm 6 prompts appear with `production` label.
    2. Submit one answer from `apps/web` (or `pnpm dev` end-to-end) against dev API; confirm the trace shows `promptVersion=langfuse:1` and `promptFallback=false`.
    3. Edit `evaluate-system-prompt` v1 in the Langfuse UI → save as new version → set `production` label to v2. After ≤ 5 min OR a Lambda cold start, confirm a fresh submission's trace shows `promptVersion=langfuse:2`.
    4. Temporarily set `LANGFUSE_BASE_URL=https://bogus.example` on the dev Lambda; confirm the next trace shows `promptVersion=fallback:evaluate@<v>` and `promptFallback=true`. Revert.
    5. `pnpm eval:export --from 2026-05-10 --to 2026-05-16 --sample 10 --dataset eval-smoke` → confirm 10 items in the Langfuse dataset.
    6. `pnpm eval --dataset eval-smoke --candidate langfuse:evaluate-system-prompt@production` → confirm markdown table prints, `./eval-runs/<runName>.json` written, Langfuse dataset run page lists 10 linked traces.
  - Purpose: dashboard + CLI acceptance gate.
  - _Leverage: `docs/llm-observability.md §Phase 2` (the operator runbook section added in task 28)_
  - _Requirements: 1.1, 1.4, 2.6, 4.1, 4.2, 5.1, 6.1, 6.7_
