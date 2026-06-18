# Admin UI-Triggered Revalidation (Design)

**Status:** approved · **Date:** 2026-06-18 · **Scope:** the `revalidate:cloze` pass, triggered from the pool-cell view

A synchronous, bounded **Revalidate** action on the pool-health cell view (`PoolCellDetail`), with a **dry-run preview → apply** flow, available on all cell types. Re-runs the **current** validator over a cell's stored exercises and applies the existing **demote-only** policy. Mirrors the on-demand generation trigger (PR #332) for guards/audit, and reuses the validator + routing the CLI already uses.

## Goal

Let an admin re-score one cell's pool through today's validator from the cell view — preview what would be demoted, then apply — without dropping to the `pnpm revalidate:cloze` CLI for routine, per-cell checks. The CLI remains for bulk/cross-cell passes.

## Decisions (from brainstorming)

- **Execution:** synchronous, bounded inline (no new queue/consumer/infra). Hard server cap on exercises per pass; larger cells truncate with a pointer to the CLI.
- **Apply mode:** dry-run preview first, then a separate confirmed apply.
- **Scope:** any exercise type (the validator + demote-only policy are generic; the Turkish deterministic checker no-ops for non-TR/non-cloze).

## Background (verified against current code)

- **CLI** `packages/db/scripts/revalidate-cloze-pool.ts` re-runs the validator and demotes failures. **Demote-only policy** (`decideDemotion`): only LOWERS status (`auto-approved`→`flagged`/`rejected`, `flagged`→`rejected`); never promotes; **skips** `manual-approved` and `rejected`. It routes via `routeValidationResult` then `applyDeterministicChecks` (the single-source-of-truth gate shared with the live path).
- The CLI's pure helpers live in `scripts/` (not `src/`). `reconstructDraftAndSpec(row)` is **cloze-hardcoded** (`content.type !== ExerciseType.CLOZE` → skip; `isClozeContent`). `decideDemotion` is already generic. Candidate query: `type = 'cloze'`, `reviewStatus ∈ ('auto-approved','flagged')`, optional language/cefr, ordered by id, optional `--limit`.
- **`validateDraft(client, draft, spec, signal?)`** (`packages/ai/src/validate.ts`) supports **all 7** exercise types (`TOOL_NAME_BY_TYPE`: cloze, translation, vocab_recall, sentence_construction, dictation, free_writing, conjugation); it guards `draft.contentJson.type in TOOL_NAME_BY_TYPE`. Returns `{ result: ValidationResult, tokenUsage }`. Cost helpers `ZERO_USAGE`/`addUsage`/`estimateCostUsd` are pure.
- **`applyDeterministicChecks(decision, content, language)`** is generic — it pass-throughs unless `language === TR && isClozeContent(content)`. Safe to call for any type.
- **API Lambda already has Claude**: `infra/lambda/src/routes/read.ts` does `createClaudeClient(...)`; `infra/lib/constructs/lambda.test.ts` asserts the API Lambda's policy grants `/ANTHROPIC_API_KEY`. So a synchronous validator call needs **no CDK change**.
- **Generation trigger precedent** (`POST /admin/generate`, admin.ts:974): zod body → `enumerateCurriculumCells(...).find(cellKey)` → `400 INVALID_CELL`; server-set cost cap (never client-settable); `recordAdminAction(...)`. The cell view (`apps/web/.../generation/_components/pool-cell-detail.tsx`) drives it via `useGenerateCell` with `window.confirm`, `isPending` disable, 409 handling, and a status message.
- **Audit**: `recordAdminAction` (`infra/lambda/src/lib/admin-audit.ts`) takes `action: AdminAuditAction` (a union) and `targetType: 'cell'` already exists. The web audit page (`app/(admin)/admin/audit/page.tsx`) has a raw `ACTIONS` filter list.
- **API Gateway timeout** is ~29s (hard) — the cap + truncation keep a pass under it.

## Architecture

```
packages/db/src/generation/revalidation.ts   — extracted, generalized pure helpers (shared by CLI + Lambda)
infra/lambda/src/routes/admin.ts              — POST /admin/revalidate (sync, bounded)
packages/api-client/src/{schemas,hooks}       — RevalidateResponse schema + useRevalidateCell
apps/web/.../pool-cell-detail.tsx             — Revalidate section (preview → apply)
```

### Shared extraction (single source of truth)

Move the pure helpers from `scripts/revalidate-cloze-pool.ts` into **`packages/db/src/generation/revalidation.ts`**, exported from the package barrel:
- `reconstructDraftAndSpec(row, exerciseType)` — **generalized**: takes the target `ExerciseType` instead of hard-coding cloze; the content-type guard checks `content.type === exerciseType`; the rest (grammar-point resolve, language/cefr validation, draft/spec assembly) is unchanged. Types `CandidateRow`, `SkipReason`, `Reconstructed`, `ReconstructFailure` move with it.
- `decideDemotion(currentStatus, result, content?, language?)` — moves unchanged (already generic; already depends on `routing` + `deterministic-checks` which live in `src/generation`).
- `DemotionAction` type moves with it.

The CLI imports these from the new module and passes `ExerciseType.CLOZE` (its cloze-only candidate filter + intent are unchanged). The CLI's unit tests update their import paths to the new module. No behavior change for the CLI.

### API — `POST /admin/revalidate` (new; writes only when `apply: true`)

Body (zod): `{ language: 'ES'|'DE'|'TR', level: 'A1'|'A2'|'B1'|'B2', type: string (min 1), grammarPoint: string (min 1), apply: boolean }`. No client cost/count/concurrency knobs.

Server constants (not client-settable): `REVALIDATE_MAX_EXERCISES = 25`, `REVALIDATE_CONCURRENCY = 6`, `REVALIDATE_MAX_COST_USD = 2.0`.

Flow:
1. Parse body → `400 { code: 'VALIDATION_ERROR' }` on failure (sibling shape).
2. `buildCellKey(...)` + `enumerateCurriculumCells(ALL_CURRICULA).find(...)` → `400 { code: 'INVALID_CELL' }` if unknown (mirrors `/admin/generate`).
3. Fetch candidates: `exercises` where `type = cell.exerciseType AND language = cell.language AND difficulty = level AND grammarPointKey = cell.grammarPoint.key AND reviewStatus ∈ ('auto-approved','flagged')`, ordered by id, **limited to `REVALIDATE_MAX_EXERCISES + 1`** to detect overflow. If `> cap` → keep the first `cap`, set `truncated = true`, `totalCandidates` = a `count()` (or the capped+overflow indicator).
4. `createClaudeClient(requireEnv('ANTHROPIC_API_KEY'))`. With a `pLimit(REVALIDATE_CONCURRENCY)`, for each candidate: `reconstructDraftAndSpec(row, cell.exerciseType)` → on failure record a `skip` with its reason; else `validateDraft(client, draft, spec)`, accumulate usage, and once `estimateCostUsd(usage) > REVALIDATE_MAX_COST_USD` stop starting new calls (remaining rows → `skip: 'cost-cap'`). Then `decideDemotion(row.reviewStatus, result, content, language)`.
5. If `apply`: for each `demote` outcome, `update exercises set reviewStatus, flaggedReasons, qualityScore where id = …`. If dry-run: compute only, no writes.
6. If `apply`: `recordAdminAction(db, { adminUserId, action: 'revalidate.apply', targetType: 'cell', targetId: cellKey, metadata: { scanned, demotedToFlagged, demotedToRejected, skipped, estCostUsd } })`. Dry-run is NOT audited (no DB mutation).
7. Respond `200`:
```
{
  apply: boolean,
  scanned: number,            // candidates actually validated
  noChange: number,
  demotedToFlagged: number,
  demotedToRejected: number,
  skipped: number,
  skipReasons: Record<string, number>,
  estCostUsd: number,
  truncated: boolean,
  totalCandidates: number,    // total matching the cell filter (>= scanned)
  demotions: { id: string; from: string; to: string; reasons: string[] }[],
}
```
`reasons` are humanized via `formatReason` (as the CLI summary does).

New audit action: add `'revalidate.apply'` to the `AdminAuditAction` union (`admin-audit.ts`). `targetType: 'cell'` already exists.

### api-client

- `schemas/revalidate.ts`: `RevalidateRequestSchema` (the body) + `RevalidateResponseSchema` (the summary above) + exported types.
- `hooks/useRevalidateCell.ts`: `useRevalidateCell({ fetchFn })` → `useMutation` POSTing `/admin/revalidate`, parsing `RevalidateResponseSchema` (mirrors `useGenerateCell`). Barrel-exported.

### Web — `PoolCellDetail`

Add a **Revalidate** section under Refill (rendered for all cell types):
- A **Preview** button → `revalidate.mutateAsync({ ...cell, apply: false })`; on success render the dry-run summary: `scanned`, `would demote → flagged N`, `→ rejected N`, `skipped N`, `est $X`, and — when `truncated` — a muted note: "Showing first 25 of {totalCandidates}; use `pnpm revalidate:cloze` for the full pass."
- An **Apply demotions** button — disabled until a preview has returned with `demotedToFlagged + demotedToRejected > 0` — guarded by `window.confirm('Demote N exercises in this cell?')`, calls `apply: true`, then shows the applied summary and resets the preview.
- Mirror Refill's `isPending` disabling + single status-message element. Keep the existing Refill untouched.

Add `'revalidate.apply'` to the audit page's `ACTIONS` filter list (`app/(admin)/admin/audit/page.tsx`) so the new action is filterable.

## Testing

- **db** (`src/generation/revalidation.test.ts`, relocated from the script test): `reconstructDraftAndSpec` happy path for cloze AND one non-cloze type (e.g. `translation`); each `SkipReason` (missing/unknown grammar point, mismatched language/cefr, content-type mismatch). Keep the full `decideDemotion` matrix (manual-approved/rejected skip; demote-only ranking; deterministic-check downgrade). Update the CLI's own test imports.
- **lambda** (`admin.test.ts`): mock `validateDraft` + `createClaudeClient` from `@language-drill/ai`; stage candidate rows + the update on the db chain-mock. Cases: `INVALID_CELL` 400; bad body 400; **dry-run** returns the summary and performs **no** `update` and **no** audit insert; **apply** writes one `update` per demotion and inserts the `revalidate.apply` audit row; `truncated: true` when candidates exceed the cap; cost-cap stops further validation; demote-only respected (a `manual-approved` row is skipped).
- **api-client** (`useRevalidateCell.test.ts`): posts the body to `/admin/revalidate`, parses the summary (incl. `demotions` + `skipReasons`).
- **web** (`pool-cell-detail.test.tsx`): Preview renders the dry-run summary; Apply is disabled until a preview with demotions; confirm + apply calls the hook with `apply:true` and shows the applied summary; truncation note appears when `truncated`. (Mock `useRevalidateCell` + `window.confirm`.)
- Gate: `pnpm lint`, `pnpm typecheck`, `pnpm turbo run test --concurrency=1`.

## Out of scope

- **Async/queued** revalidation (we chose synchronous bounded). If per-cell caps prove limiting, a queued pass is a future, separately-specced infra project.
- **Bulk / cross-cell** revalidation in one request — the CLI (`pnpm revalidate:cloze`) covers that.
- **Promotion** — demote-only is preserved; nothing ever raises review status.
- Non-pool exercises; changing the validator/prompt itself.

## Risks / notes

- **API Gateway ~29s** for very large cells: bounded by `REVALIDATE_MAX_EXERCISES` (25) × `REVALIDATE_CONCURRENCY` (6) ≈ a handful of waves; `truncated` + the CLI pointer cover the overflow. Tune the cap down if real cells run long.
- **LLM cost**: server-set `REVALIDATE_MAX_COST_USD` (never client-settable, mirroring the generation trigger), plus demote-only so the blast radius is bounded and recoverable (flagged items land in the review queue; `manual-approved` is never touched).
- **Dry-run still spends tokens** (it runs the validator) but writes nothing — acceptable; the preview is the whole point. It is not audited because it makes no DB change.
- **Concurrent applies** on one cell are idempotent-ish (demote-only converges); no in-flight 409 is needed for the synchronous path.
- **Single source of truth**: extracting the helpers to `src` (rather than duplicating in the Lambda) keeps the CLI and the UI pass scoring identically — the same principle that already keeps `applyDeterministicChecks` shared.
