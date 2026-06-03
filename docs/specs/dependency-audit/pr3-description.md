# chore(deps): anthropic sdk

## Summary

PR 3 of 5 in the rollout planned by `.claude/specs/dependency-audit/`. Bumps `@anthropic-ai/sdk` 0.36.3 → 0.91.1 in `packages/ai`. Lockfile shrinks **net −241 lines** because the new SDK uses native `fetch` and drops the legacy `node-fetch` / `form-data` / `digest-fetch` / `web-streams-polyfill` transitives. The wrapper bulkhead held: zero source files were modified (`packages/ai/src/**`, `infra/lambda/src/**`, `packages/api-client/src/**` all untouched). Prompt caching was verified live against `claude-sonnet-4-5`; submit-endpoint JSON shape is unchanged from `main`.

Diff is `packages/ai/package.json`, `pnpm-lock.yaml`, and this description.

## Bumps in this PR

| Package | Workspace | Old → New | Notes |
|---|---|---|---|
| `@anthropic-ai/sdk` | `packages/ai` | 0.36.3 → 0.91.1 | Major (~55 minor releases). Native-fetch migration drops legacy transitives. New nested `usage.cache_creation` field is informational; existing `usage.cache_read_input_tokens` cache-hit signal is unchanged. ([changelog](https://github.com/anthropics/anthropic-sdk-typescript/releases)) |

## Lockfile churn

- **Net −241 lines** (`+28 / −269`) — `git diff origin/main --stat -- pnpm-lock.yaml`.
- Net `+3 / −1` packages installed.
- The new SDK uses native `fetch`, dropping these legacy transitives:
  - `node-fetch`
  - `form-data`
  - `digest-fetch`
  - `web-streams-polyfill`

This is the rare upgrade where the lockfile gets _smaller_ at a major boundary.

## Source migration

`packages/ai/src/**` was **not modified**. The wrapper consumes only the SDK's stable core surface:

- `new Anthropic({ apiKey })`
- `Anthropic.Tool`, `Anthropic.ToolUseBlock` (re-exported types)
- `client.messages.create({ ... })` (sync; no streaming)
- `usage.cache_read_input_tokens` (top-level, unchanged across versions)

The 0.36 → 0.91 churn was largely:
- The native-`fetch` migration (transitives only — no API-surface impact).
- New feature surfaces (batch, files, citations, agent SDK) the wrapper doesn't import.
- Adapter / runtime helper restructuring (the wrapper doesn't touch the Node adapter directly).

`packages/db/src/**`, `infra/lambda/src/**`, `packages/api-client/src/**` are also untouched — the wrapper bulkhead in `design.md` §Components held exactly as predicted.

## Verification

All commands run from the worktree root (`/Users/valentinanikitina/Seal/Dev/language-drill/.claude/worktrees/dependency-audit`).

- `pnpm install` — lockfile regenerated, net −241 lines.
- `pnpm lint` — **green**, 6/6 packages with lint scripts pass.
- `pnpm typecheck` — **green**, 11/11 typecheck/build tasks pass.
- `pnpm test` — **477 tests across 39 files pass** (same totals as PR 1 / PR 2):
  - `@language-drill/shared` — 21 tests
  - `@language-drill/db` — 6 tests
  - `@language-drill/ai` — **31 tests** (the wrapper's own contract — unchanged)
  - `@language-drill/api-client` — **75 tests** (no SDK leakage)
  - `@language-drill/lambda` — **55 tests** (no SDK leakage)
  - `@language-drill/web` — 289 tests

Wrapper-bulkhead breakdown (R3.5): the three packages that exercise the AI surface — `@language-drill/ai`, `@language-drill/lambda`, `@language-drill/api-client` — all stayed green with **zero edits** to source files in those packages. That is the load-bearing test for this PR.

## Prompt-cache smoke

Captured live from task 3.5 — two back-to-back calls within the cache TTL against `claude-sonnet-4-5`:

| Field | Call 1 (cache miss) | Call 2 (cache hit) |
|---|---|---|
| `input_tokens` | 482 | 482 |
| `cache_creation_input_tokens` | 1231 | 0 |
| **`cache_read_input_tokens`** | **0** | **1231** |
| `output_tokens` | 222 | 222 |
| Latency | 4593 ms | 4200 ms |

- **Cache-hit detection field (load-bearing): top-level `usage.cache_read_input_tokens`.** Stable across SDK versions — the same field name worked on 0.36, works on 0.91, and is documented as the canonical cache-read indicator. Reviewers chasing prompt-cache regressions should grep for this.
- **SDK 0.91 informational addition:** the new SDK exposes a nested `usage.cache_creation.{ ephemeral_5m_input_tokens, ephemeral_1h_input_tokens }` breakdown that did not exist in 0.36. **Not load-bearing for the cache check.** The wrapper still keys off the top-level field; the nested field is available if cost-attribution telemetry wants it later.

End-to-end proof: the upgrade does not regress prompt caching. The ~80% cost-saving on prompt tokens documented in `CLAUDE.md` §"Content Strategy" / Pre-generation pipeline still applies on 0.91.

## Submit-endpoint JSON shape smoke

Per design.md §Manual Smoke Recipe step 4: `POST /exercises/:id/submit` was exercised locally with a real Anthropic key.

- Exercise: cloze ES A2, exercise id `81b6dd31...`
- Answer body: `"fui"`
- Response status: HTTP 200
- Response shape: same `EvaluationResult` contract as `main`:
  - `score`
  - `grammarAccuracy`
  - `vocabularyRange`
  - `taskAchievement`
  - `feedback`
  - `errors`
  - `estimatedCefrEvidence`

No fields added, removed, or renamed. The route's response contract is byte-shape-identical to `main`.

## Model name flag (informational, not a blocker)

`packages/ai/src/evaluate.ts:207` calls `claude-sonnet-4-5`, not `claude-sonnet-4-6` as referenced in `CLAUDE.md` §Tech Stack and the spec title for task 3.5. The smoke recipe verified prompt caching against the model the production code _actually_ uses. Bumping to `claude-sonnet-4-6` (or `4-7`) is a model-rev question that is **out of scope for this dep-audit rollout** and should be tracked as a separate spec — not gated on PR-3.

## Pin guarantees + audit posture

Per task 3.6 — explicit per-PR checkpoint that R6 (pin guarantees) and the Security NFR are met before merge. All commands run from the worktree root.

### Pin verification (`pnpm list -r --depth=0 @types/node next zod typescript @hono/node-server`)

| Package | Required line | Resolved on this branch | Verdict |
|---|---|---|---|
| `@types/node` | 22.x | 22.19.17 (root + every workspace via `pnpm.overrides`) | OK |
| `next` | 15.x | 15.5.15 (`apps/web`) | OK |
| `zod` | 3.x | 3.25.76 (`infra/lambda`, `packages/api-client`) | OK |
| `typescript` | 5.x | 5.9.3 (root + every workspace) | OK |
| `@hono/node-server` | 1.x | 1.19.14 (`infra/lambda`) | OK |

The Anthropic SDK upgrade did not pull any held-back package past its pin. None of `@types/node` 24.x/25.x, `next` 16, `zod` 4, `typescript` 6, or `@hono/node-server` 2 appears in the resolved tree.

### `pnpm.overrides` byte-identical confirmation

The `pnpm` block at `package.json:28-32` on this branch:

```json
  "pnpm": {
    "overrides": {
      "@types/node": "^22.0.0"
    }
  }
```

`diff` of this block against `origin/main` (`01c3cae`) is empty for **both raw text and canonical JSON** (`json.dumps(..., sort_keys=True)`). The Anthropic SDK upgrade did not require any new override entries (R6.3).

### `pnpm audit --prod` posture

Production-only audit, this branch vs. `origin/main` (`01c3cae` — PR-2 merge commit; verified that no `package.json`-touching commits have landed on `origin/main` since via `git log origin/main --since="2026-04-30 03:43:13 +0300" --stat -- "*package.json"` returning empty). Baseline re-run on a fresh clone of `origin/main` to confirm.

| Severity | `origin/main` (`01c3cae`) | This branch | Delta |
|---|---|---|---|
| critical | 0 | 0 | 0 |
| high | 0 | 0 | 0 |
| moderate | 1 | 1 | 0 |
| low | 0 | 0 | 0 |

Branch advisory that remains:

- MODERATE `postcss` <8.5.10 — transitive via `next` 15.5.15 (held back per R6); will clear when Next bumps its pinned postcss or when the deferred Next 16 spec lands. **Same single advisory PR-2 documented.** No new advisories were introduced by the SDK upgrade — and none of the dropped transitives (`node-fetch`, `form-data`, `digest-fetch`, `web-streams-polyfill`) were on the prod advisory list, so dropping them was security-neutral despite being maintenance-positive.

**Verdict: no regression.** Audit posture is byte-identical to `origin/main`. Merge is **not** blocked by the Security NFR.

### Requirement traceability

Satisfies R6.1, R6.2, R6.3, NFR Security.

## Deferred work

These items remain on the drift list and are owned by later PRs in this rollout:

- **PR 4** — `chore(deps): vitest stack` (`vitest` 1.6.1 → 4.1.5, `@vitejs/plugin-react` 4.7.0 → 6.0.1)
- **PR 5** — `chore(deps): eslint flat config` (`eslint` 8.57.1 → 9.x, `@typescript-eslint/*` 7.18.0 → 8.59.1, `.eslintrc*` → flat config)
- **Held back per R6 / strategic decisions:** `@types/node` 22.x (Lambda LTS, pinned via `pnpm.overrides`), `next` 15.x (defer to Next 16 spec), `zod` 3.x (defer to zod 4 spec), `typescript` 5.x (let TS 6 ecosystem settle), `@hono/node-server` 1.x (local-dev only, low ROI).
- **Out of scope for dep-audit:** model-rev to `claude-sonnet-4-6` / `4-7` (see "Model name flag" above) — should be its own spec.

---

Closes the AI-SDK group of `.claude/specs/dependency-audit/`. Sequenced after PR 2 and before PR 4 per `design.md` §Components and §Architecture.
