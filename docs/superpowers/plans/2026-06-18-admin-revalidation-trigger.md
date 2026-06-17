# Admin UI-Triggered Revalidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a synchronous, bounded **Revalidate** trigger to the pool-cell view — preview (dry-run) then apply — that re-runs the current validator over a cell's exercises and applies the existing demote-only policy, via a new `POST /admin/revalidate` endpoint that reuses helpers extracted from the `revalidate:cloze` CLI.

**Architecture:** Extract the CLI's pure helpers into `packages/db/src/generation/revalidation.ts` (generalizing `reconstructDraftAndSpec` to any exercise type); add a synchronous `POST /admin/revalidate` to the admin router (cap + cost-stop + demote-only + audit-on-apply); a `useRevalidateCell` mutation hook; and a Revalidate section in `PoolCellDetail`. No new infra.

**Tech Stack:** Hono + Drizzle + `@language-drill/ai` validator (Lambda), Vitest, Zod, TanStack Query, Next.js client components, Tailwind.

---

## Context the implementer needs

Work from the worktree `/Users/seal/dev/language-drill/.claude/worktrees/feat-admin-revalidate` (branch `feat-admin-revalidate`). `cd` into it in every Bash call (the checked-out branch can silently flip). Paths contain a `(admin)` route-group segment — quote them.

**Build/dist gotchas:** if a test errors resolving `@language-drill/*`, run `pnpm build` at repo root (the db package especially — editing `packages/db/src` requires a rebuild for dependents; single-package vitest resolves against `db/dist`). If the full lambda run shows phantom failures from stale `infra/lambda/dist/**/*.test.js`, `rm -rf infra/lambda/dist` and re-run.

**Single-file test commands:** `pnpm --filter @language-drill/db test <path>` · `pnpm --filter @language-drill/lambda test <path>` · `pnpm --filter @language-drill/api-client test <path>` · `pnpm --filter @language-drill/web test <path>`.

**Key existing code (verified):**
- `packages/db/scripts/revalidate-cloze-pool.ts` — the CLI. Pure helpers to MOVE: `CandidateRow`, `SkipReason`, `Reconstructed`, `ReconstructFailure`, `reconstructDraftAndSpec` (currently cloze-hardcoded), `DemotionAction`, `decideDemotion`. Stay in the script: `parseRevalidateArgs`, `RevalidateArgs`, `fetchCandidates`, `applyDemotion`, `printSummary`, `main`. `decideDemotion` already imports `routeValidationResult` + `applyDeterministicChecks` from `../src/generation/{routing,deterministic-checks}`.
- `packages/db/scripts/revalidate-cloze-pool.test.ts` — imports `{ decideDemotion, parseRevalidateArgs, reconstructDraftAndSpec, type CandidateRow }` from `./revalidate-cloze-pool` and `type ReviewStatus` from `../src/generation/routing`. Uses real curriculum key `tr-a1-vowel-harmony`.
- `packages/db/src/index.ts` (barrel) re-exports generation helpers (e.g. `enumerateCurriculumCells`, `getGrammarPoint`) — the new `revalidation.ts` exports go here too so the Lambda can `import { ... } from '@language-drill/db'`.
- `@language-drill/ai` exports: `validateDraft(client, draft, spec, signal?)` → `{ result: ValidationResult, tokenUsage: ClaudeUsageBreakdown }`; `createClaudeClient(key)`; pure cost helpers `ZERO_USAGE`, `addUsage`, `estimateCostUsd`; types `ExerciseDraft`, `GenerationSpec`, `ValidationResult`, `ClaudeUsageBreakdown`.
- `@language-drill/shared`: `ExerciseType`, `Language`, `CefrLevel`, `formatReason`, `type ExerciseContent`, `type GenerationReason`.
- `infra/lambda/src/routes/admin.ts` — admin router. `POST /admin/generate` (admin.ts:974) is the pattern: zod body → `buildCellKey` + `enumerateCurriculumCells(ALL_CURRICULA).find(cellKey)` → `400 { error, code: 'INVALID_CELL' }`; server-set cost cap; `recordAdminAction(...)`. Already imports `ALL_CURRICULA`, `enumerateCurriculumCells`, `buildCellKey`, `exercises`, `db`, `and`, `eq`, `inArray`, `count`, `z`, `requireEnv`, `recordAdminAction`. The candidate columns are exactly those the CLI's `fetchCandidates` selects: `id, type, language, difficulty, contentJson, grammarPointKey, topicDomain, modelId, reviewStatus`. Update columns: `reviewStatus, flaggedReasons, qualityScore`.
- `infra/lambda/src/lib/admin-audit.ts` — `AdminAuditAction` union (add `'revalidate.apply'`); `targetType: 'cell'` already exists.
- `infra/lambda/src/routes/admin.test.ts` — db chain-mock + shared `queryQueue` (awaiting any chain — select, update `.where()`, insert `.values()` — shifts the next staged value; stage one entry per awaited query, in execution order). `db.update(...).set(...).where(...)` and `db.insert(...).values(...)` are supported; inserts are also captured in `insertedValuesByTable[table.__mock]`. Helpers: `app.request(path, init, env)`, `adminEnv`, `type AnyJson`. The file does NOT yet mock `@language-drill/ai` — Task 2 adds that mock. The `/admin/generate` tests show the cell-resolve + SQS pattern; the `/admin/flagged/.../:id/:action` tests show `update` + audit-insert staging.
- `packages/api-client/src/hooks/useGenerateCell.ts` + `schemas/generate.ts` — the mutation-hook + schema pattern to mirror (`GenerateCellRequest` is a plain `type`; `GenerateCellResponseSchema` is zod). Barrel `src/index.ts`.
- `apps/web/app/(admin)/admin/generation/_components/pool-cell-detail.tsx` — the cell view; the Refill block (lines 102-126) is the UI pattern to mirror (`window.confirm`, `isPending` disable, single status-message element). It receives `{ item: PoolStatusItem, fetchFn }`.
- `apps/web/app/(admin)/admin/audit/page.tsx` — `ACTIONS` array (line 8-11); add `'revalidate.apply'`. Its test asserts the action list.

---

## File structure

**db (create/modify):** `packages/db/src/generation/revalidation.ts` (new), `packages/db/src/generation/revalidation.test.ts` (new); `packages/db/src/index.ts` (barrel); `packages/db/scripts/revalidate-cloze-pool.ts` (import from new module), `packages/db/scripts/revalidate-cloze-pool.test.ts` (split imports).
**lambda (modify):** `infra/lambda/src/lib/admin-audit.ts` (+action), `infra/lambda/src/routes/admin.ts` (+endpoint), `infra/lambda/src/routes/admin.test.ts` (+tests + ai mock).
**api-client (create/modify):** `schemas/revalidate.ts` (new), `hooks/useRevalidateCell.ts` (new), `hooks/useRevalidateCell.test.ts` (new), `index.ts` (barrel).
**web (modify):** `apps/web/app/(admin)/admin/generation/_components/pool-cell-detail.tsx` + its test; `apps/web/app/(admin)/admin/audit/page.tsx` + its test.

---

## Task 1: db — extract + generalize shared revalidation helpers

**Files:** Create `packages/db/src/generation/revalidation.ts`, `packages/db/src/generation/revalidation.test.ts`; modify `packages/db/src/index.ts`, `packages/db/scripts/revalidate-cloze-pool.ts`, `packages/db/scripts/revalidate-cloze-pool.test.ts`.

- [ ] **Step 1: Create `revalidation.ts` by moving + generalizing the helpers**

Move these from `revalidate-cloze-pool.ts` into `packages/db/src/generation/revalidation.ts` verbatim EXCEPT the one generalization noted: `CandidateRow`, `SkipReason`, `Reconstructed`, `ReconstructFailure`, `reconstructDraftAndSpec`, `DemotionAction`, `decideDemotion`. Fix import paths to be relative to `src/generation/` (e.g. `../curriculum` → `../curriculum`, `./routing`, `./deterministic-checks`, schema from `../schema`). Imports from `@language-drill/ai` / `@language-drill/shared` are unchanged.

**Generalize `reconstructDraftAndSpec`** to take the target exercise type:
```ts
export function reconstructDraftAndSpec(
  row: CandidateRow,
  exerciseType: ExerciseType,
): Reconstructed | ReconstructFailure {
  // ... grammar-point / language / cefr checks unchanged ...

  // content-type guard — generalized from cloze-only to the passed type:
  const content = row.contentJson as { type?: unknown } | null;
  if (!content || typeof content !== 'object' || content.type !== exerciseType) {
    return {
      ok: false,
      reason: 'malformed-content-json',
      detail: `row ${row.id} content_json is not a ${exerciseType} exercise`,
    };
  }
  const exerciseContent = content as ExerciseContent;

  // ... language EN guard unchanged ...

  const draft: ExerciseDraft = {
    id: row.id,
    contentJson: exerciseContent,
    metadata: { /* unchanged: grammarPointKey, topicDomain, modelId ?? 'unknown', zero tokens, inBatchDuplicate:false */ },
  };
  const spec: GenerationSpec = {
    language,
    cefrLevel,
    exerciseType,            // <-- was hard-coded ExerciseType.CLOZE
    grammarPoint,
    topicDomain: row.topicDomain,
    count: 1,
    batchSeed: ZERO_UUID,
  };
  return { ok: true, draft, spec };
}
```
Drop the `isClozeContent` import/use (the generic `content.type === exerciseType` check replaces it). Keep `ZERO_UUID` (move it too) and `decideDemotion` unchanged (it's already generic).

- [ ] **Step 2: Re-export from the barrel** — in `packages/db/src/index.ts`, add (matching the existing generation re-export style):
```ts
export {
  reconstructDraftAndSpec,
  decideDemotion,
  type CandidateRow,
  type SkipReason,
  type Reconstructed,
  type ReconstructFailure,
  type DemotionAction,
} from './generation/revalidation';
```

- [ ] **Step 3: Update the CLI script to import the moved helpers**

In `revalidate-cloze-pool.ts`: delete the moved definitions; import them from `../src/generation/revalidation`; update the one call site to pass the type:
```ts
import {
  reconstructDraftAndSpec,
  decideDemotion,
  type CandidateRow,
  type DemotionAction,
  // ...any moved types the script still references
} from '../src/generation/revalidation';
// ...
const recon = reconstructDraftAndSpec(row, ExerciseType.CLOZE);
```
Keep `parseRevalidateArgs`, `RevalidateArgs`, `fetchCandidates`, `applyDemotion`, `printSummary`, `main`, `ZERO_UUID` usage (import `ZERO_UUID` from the new module if `applyDemotion`/`main` need it, else it's internal to revalidation.ts). `Outcome` type stays in the script (it references `CandidateRow` — now imported).

- [ ] **Step 4: Create `revalidation.test.ts` (moved + generalized cases)**

Create `packages/db/src/generation/revalidation.test.ts`. Move the `reconstructDraftAndSpec` + `decideDemotion` test cases from the script test (adjust imports to `./revalidation`). ADD a generalized case: a `translation` row reconstructs OK when called with `ExerciseType.TRANSLATION`, and a cloze row with `reconstructDraftAndSpec(row, ExerciseType.TRANSLATION)` fails `malformed-content-json` (type mismatch). Keep the existing cloze happy-path + every `SkipReason`. Reuse the real curriculum key `tr-a1-vowel-harmony`. For the translation case, use a minimal valid translation `contentJson` (`{ type: ExerciseType.TRANSLATION, ... }` — check `ExerciseContent`'s translation shape in `@language-drill/shared`; only `.type` is asserted by the guard).

- [ ] **Step 5: Trim the CLI test** — in `revalidate-cloze-pool.test.ts`, keep ONLY the `parseRevalidateArgs` cases (and any CLI-specific ones). Remove the moved `reconstructDraftAndSpec`/`decideDemotion` cases (now in `revalidation.test.ts`). Update imports so it pulls `parseRevalidateArgs` from `./revalidate-cloze-pool` and drops the now-unused helper imports.

- [ ] **Step 6: Build + test + typecheck**
- `pnpm --filter @language-drill/db build` → success (dependents resolve the new export)
- `pnpm --filter @language-drill/db test src/generation/revalidation.test.ts scripts/revalidate-cloze-pool.test.ts` → all pass
- `pnpm --filter @language-drill/db typecheck` → clean

- [ ] **Step 7: Commit**
```bash
git add packages/db/src/generation/revalidation.ts packages/db/src/generation/revalidation.test.ts packages/db/src/index.ts packages/db/scripts/revalidate-cloze-pool.ts packages/db/scripts/revalidate-cloze-pool.test.ts
git commit -m "refactor(db): extract + generalize revalidation helpers for reuse"
```

---

## Task 2: lambda — `POST /admin/revalidate`

**Files:** Modify `infra/lambda/src/lib/admin-audit.ts`, `infra/lambda/src/routes/admin.ts`, `infra/lambda/src/routes/admin.test.ts`.

- [ ] **Step 1: Add the audit action** — in `admin-audit.ts`, add `| 'revalidate.apply'` to the `AdminAuditAction` union.

- [ ] **Step 2: Write failing tests**

In `admin.test.ts`, add a `vi.mock('@language-drill/ai', ...)` near the other mocks (spread `...actual`, override only `validateDraft` + `createClaudeClient`; keep the real pure cost helpers):
```ts
const mockValidateDraft = vi.fn();
vi.mock('@language-drill/ai', async () => {
  const actual = await vi.importActual<typeof import('@language-drill/ai')>('@language-drill/ai');
  return {
    ...actual,
    createClaudeClient: vi.fn(() => ({})),
    validateDraft: (...args: unknown[]) => mockValidateDraft(...args),
  };
});
```
Then a describe block. Use a real curriculum cell — resolve one from `ALL_CURRICULA` (e.g. a TR A1 cloze cell: language `TR`, level `A1`, type `cloze`, grammarPoint a real TR-A1 key like `tr-a1-vowel-harmony`). Candidate rows must carry valid cloze `contentJson` so `reconstructDraftAndSpec` succeeds. Helper to make a `ValidationResult` that routes to flagged vs auto-approved (inspect `routeValidationResult` thresholds; e.g. low `qualityScore` or `ambiguous:true` → flagged). Stage the db `queryQueue` in execution order: **(1)** count row `[{ count: N }]`, **(2)** candidate rows array, then **apply-only:** one entry per expected `update` and one for the audit insert. Adjust staging to the mock's actual shift order by running the test (the `/admin/generate` + `/admin/flagged` tests are the references).
```ts
beforeEach(() => { mockValidateDraft.mockReset(); });

describe('POST /admin/revalidate', () => {
  const cell = { language: 'TR', level: 'A1', type: 'cloze', grammarPoint: 'tr-a1-vowel-harmony' };
  const clozeContent = { type: 'cloze', instructions: 'Fill in.', sentence: 'Sınıfta sekiz ___ var.', correctAnswer: 'öğrenci' };
  const row = (id, reviewStatus) => ({ id, type: 'cloze', language: 'TR', difficulty: 'A1', contentJson: clozeContent, grammarPointKey: 'tr-a1-vowel-harmony', topicDomain: null, modelId: 'm', reviewStatus });

  it('400 on invalid body', async () => {
    const res = await app.request('/admin/revalidate', { method: 'POST', body: JSON.stringify({ language: 'TR' }) }, adminEnv);
    expect(res.status).toBe(400);
    expect(((await res.json()) as AnyJson).code).toBe('VALIDATION_ERROR');
  });

  it('400 INVALID_CELL for an unknown cell', async () => {
    const res = await app.request('/admin/revalidate', { method: 'POST', body: JSON.stringify({ ...cell, grammarPoint: 'tr-a1-nonexistent', apply: false }) }, adminEnv);
    expect(res.status).toBe(400);
    expect(((await res.json()) as AnyJson).code).toBe('INVALID_CELL');
  });

  it('dry-run returns a summary and writes nothing', async () => {
    mockValidateDraft.mockResolvedValue({ result: /* flagged-routing result */, tokenUsage: { inputTokens: 10, outputTokens: 5, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 } });
    queryQueue.push([{ count: 1 }]);          // totalCandidates
    queryQueue.push([row('00000000-0000-0000-0000-000000000001', 'auto-approved')]);
    const res = await app.request('/admin/revalidate', { method: 'POST', body: JSON.stringify({ ...cell, apply: false }) }, adminEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as AnyJson;
    expect(body.apply).toBe(false);
    expect(body.scanned).toBe(1);
    expect(body.demotedToFlagged).toBe(1);
    expect(body.demotions[0]).toMatchObject({ id: '00000000-0000-0000-0000-000000000001', from: 'auto-approved', to: 'flagged' });
    expect(insertedValuesByTable['adminAuditLog']).toBeUndefined(); // not audited
  });

  it('apply writes a demotion update and records the audit row', async () => {
    mockValidateDraft.mockResolvedValue({ result: /* flagged-routing result */, tokenUsage: { inputTokens: 10, outputTokens: 5, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 } });
    queryQueue.push([{ count: 1 }]);                                   // totalCandidates
    queryQueue.push([row('00000000-0000-0000-0000-000000000002', 'auto-approved')]);
    queryQueue.push([]);                                              // the update
    queryQueue.push([]);                                              // the audit insert
    const res = await app.request('/admin/revalidate', { method: 'POST', body: JSON.stringify({ ...cell, apply: true }) }, adminEnv);
    const body = (await res.json()) as AnyJson;
    expect(body.apply).toBe(true);
    expect(body.demotedToFlagged).toBe(1);
    expect(insertedValuesByTable['adminAuditLog']).toMatchObject({ action: 'revalidate.apply', targetType: 'cell' });
  });

  it('reports truncated when candidates exceed the cap', async () => {
    mockValidateDraft.mockResolvedValue({ result: /* auto-approved result */, tokenUsage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 } });
    queryQueue.push([{ count: 99 }]);                                 // totalCandidates > cap
    queryQueue.push(Array.from({ length: 25 }, (_, i) => row(`00000000-0000-0000-0000-0000000000${String(i).padStart(2,'0')}`, 'auto-approved')));
    const res = await app.request('/admin/revalidate', { method: 'POST', body: JSON.stringify({ ...cell, apply: false }) }, adminEnv);
    const body = (await res.json()) as AnyJson;
    expect(body.truncated).toBe(true);
    expect(body.totalCandidates).toBe(99);
    expect(body.scanned).toBe(25);
  });

  it('never promotes: a flagged row whose new verdict is auto-approved is no-change (no update, no audit)', async () => {
    // demote-only — decideDemotion returns no-change when the new status would RAISE.
    mockValidateDraft.mockResolvedValue({ result: /* auto-approved-routing result */, tokenUsage: { inputTokens: 1, outputTokens: 1, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 } });
    queryQueue.push([{ count: 1 }]);                                  // totalCandidates
    queryQueue.push([row('00000000-0000-0000-0000-000000000004', 'flagged')]);
    const res = await app.request('/admin/revalidate', { method: 'POST', body: JSON.stringify({ ...cell, apply: true }) }, adminEnv);
    const body = (await res.json()) as AnyJson;
    expect(body.noChange).toBe(1);
    expect(body.demotedToFlagged + body.demotedToRejected).toBe(0);
    expect(insertedValuesByTable['adminAuditLog']).toBeUndefined();  // no demotions ⇒ no audit row
  });
});
```
NOTE: construct the two `ValidationResult` fixtures (flagged-routing vs auto-approved-routing) by reading `routeValidationResult`'s thresholds so the routed status is deterministic (e.g. `ambiguous: true` or a low `qualityScore` → flagged; a clean high-score result → auto-approved). Define them once at the top of the describe block and reuse. Keep assertions meaningful; don't over-stage the queue.

- [ ] **Step 3: Run, expect FAIL** — `pnpm --filter @language-drill/lambda test src/routes/admin.test.ts`

- [ ] **Step 4: Implement the endpoint**

In `admin.ts`, add imports: `reconstructDraftAndSpec`, `decideDemotion` from `@language-drill/db`; `createClaudeClient`, `validateDraft`, `estimateCostUsd`, `addUsage`, `ZERO_USAGE`, `type ClaudeUsageBreakdown` from `@language-drill/ai`; `formatReason` from `@language-drill/shared`. Reuse a small concurrency limiter (if none exists in lambda, a tiny inline `pLimit` or sequential loop — keep it simple; sequential is acceptable given the cap). Add:
```ts
const REVALIDATE_MAX_EXERCISES = 25;
const REVALIDATE_CONCURRENCY = 6;
const REVALIDATE_MAX_COST_USD = 2.0;

const RevalidateBodySchema = z.object({
  language: z.enum(['ES', 'DE', 'TR']),
  level: z.enum(['A1', 'A2', 'B1', 'B2']),
  type: z.string().min(1),
  grammarPoint: z.string().min(1),
  apply: z.boolean(),
});

admin.post('/admin/revalidate', async (c) => {
  const raw = await c.req.json().catch(() => null);
  const parsed = RevalidateBodySchema.safeParse(raw);
  if (!parsed.success) {
    return c.json({ error: 'Invalid request body', code: 'VALIDATION_ERROR', details: parsed.error.flatten() }, 400);
  }
  const { language, level, type, grammarPoint, apply } = parsed.data;

  const cellKey = buildCellKey({ language, cefrLevel: level, exerciseType: type, grammarPointKey: grammarPoint });
  const cell = enumerateCurriculumCells(ALL_CURRICULA).find((cc) => cc.cellKey === cellKey);
  if (!cell) return c.json({ error: 'Unknown cell', code: 'INVALID_CELL' }, 400);

  const filter = and(
    eq(exercises.type, cell.exerciseType),
    eq(exercises.language, cell.language),
    eq(exercises.difficulty, cell.cefrLevel),
    eq(exercises.grammarPointKey, cell.grammarPoint.key),
    inArray(exercises.reviewStatus, ['auto-approved', 'flagged']),
  );

  const totalRows = await db.select({ count: count() }).from(exercises).where(filter);
  const totalCandidates = Number(totalRows[0]?.count ?? 0);

  const candidates = await db
    .select({
      id: exercises.id, type: exercises.type, language: exercises.language,
      difficulty: exercises.difficulty, contentJson: exercises.contentJson,
      grammarPointKey: exercises.grammarPointKey, topicDomain: exercises.topicDomain,
      modelId: exercises.modelId, reviewStatus: exercises.reviewStatus,
    })
    .from(exercises).where(filter).orderBy(exercises.id).limit(REVALIDATE_MAX_EXERCISES);
  const truncated = totalCandidates > REVALIDATE_MAX_EXERCISES;

  const client = createClaudeClient(requireEnv('ANTHROPIC_API_KEY'));
  let usage: ClaudeUsageBreakdown = ZERO_USAGE;
  let costStopped = false;
  const demotions: { id: string; from: string; to: string; reasons: string[] }[] = [];
  let noChange = 0, skipped = 0;
  const skipReasons: Record<string, number> = {};
  const bump = (r: string) => { skipReasons[r] = (skipReasons[r] ?? 0) + 1; skipped++; };

  // Bounded concurrency over candidates (sequential is fine given the cap).
  for (const row of candidates) {
    if (costStopped) { bump('cost-cap'); continue; }
    const recon = reconstructDraftAndSpec(row as CandidateRow, cell.exerciseType);
    if (!recon.ok) { bump(recon.reason); continue; }
    let result; let callUsage;
    try {
      const r = await validateDraft(client, recon.draft, recon.spec);
      result = r.result; callUsage = r.tokenUsage;
    } catch { bump('validator-error'); continue; }
    usage = addUsage(usage, callUsage);
    if (estimateCostUsd(usage) > REVALIDATE_MAX_COST_USD) costStopped = true;

    const action = decideDemotion(row.reviewStatus as ReviewStatus, result, recon.draft.contentJson, cell.language);
    if (action.kind === 'skip') { bump(action.reason); continue; }
    if (action.kind === 'no-change') { noChange++; continue; }
    if (apply) {
      await db.update(exercises).set({ reviewStatus: action.to, flaggedReasons: action.reasons, qualityScore: result.qualityScore }).where(eq(exercises.id, row.id));
    }
    demotions.push({ id: row.id, from: action.from, to: action.to, reasons: action.reasons.map(formatReason) });
  }

  const demotedToFlagged = demotions.filter((d) => d.to === 'flagged').length;
  const demotedToRejected = demotions.filter((d) => d.to === 'rejected').length;

  if (apply && demotions.length > 0) {
    await recordAdminAction(db, {
      adminUserId: c.get('userId'),
      action: 'revalidate.apply',
      targetType: 'cell',
      targetId: cellKey,
      metadata: { scanned: candidates.length, demotedToFlagged, demotedToRejected, skipped, estCostUsd: estimateCostUsd(usage) },
    });
  }

  return c.json({
    apply, scanned: candidates.length, noChange, demotedToFlagged, demotedToRejected,
    skipped, skipReasons, estCostUsd: estimateCostUsd(usage), truncated, totalCandidates, demotions,
  });
});
```
Confirm `ReviewStatus` / `CandidateRow` types are importable (from `@language-drill/db` — add to imports). If `count` isn't already imported in admin.ts, it is (used by `/admin/content`). Decide audit-on-apply: record only when `apply && demotions.length > 0` (a no-op apply isn't worth an audit row) — match the test's expectation.

- [ ] **Step 5: Run, expect PASS** — `pnpm --filter @language-drill/lambda test src/routes/admin.test.ts` (`rm -rf infra/lambda/dist` first if stale; `pnpm build` at root if `@language-drill/db` doesn't resolve the new export)
- [ ] **Step 6: Typecheck** — `pnpm --filter @language-drill/lambda typecheck` → clean
- [ ] **Step 7: Commit**
```bash
git add infra/lambda/src/lib/admin-audit.ts infra/lambda/src/routes/admin.ts infra/lambda/src/routes/admin.test.ts
git commit -m "feat(admin): POST /admin/revalidate — sync bounded dry-run/apply revalidation"
```

---

## Task 3: api-client — `useRevalidateCell`

**Files:** Create `packages/api-client/src/schemas/revalidate.ts`, `hooks/useRevalidateCell.ts`, `hooks/useRevalidateCell.test.ts`; modify `index.ts`.

- [ ] **Step 1: Create the schema** — `packages/api-client/src/schemas/revalidate.ts`:
```ts
import { z } from 'zod';

export type RevalidateRequest = {
  language: string; level: string; type: string; grammarPoint: string; apply: boolean;
};

export const RevalidateResponseSchema = z.object({
  apply: z.boolean(),
  scanned: z.number(),
  noChange: z.number(),
  demotedToFlagged: z.number(),
  demotedToRejected: z.number(),
  skipped: z.number(),
  skipReasons: z.record(z.string(), z.number()),
  estCostUsd: z.number(),
  truncated: z.boolean(),
  totalCandidates: z.number(),
  demotions: z.array(z.object({
    id: z.string(), from: z.string(), to: z.string(), reasons: z.array(z.string()),
  })),
});
export type RevalidateResponse = z.infer<typeof RevalidateResponseSchema>;
```

- [ ] **Step 2: Write the failing hook test** — `packages/api-client/src/hooks/useRevalidateCell.test.ts` (mirror `useGenerateCell.test.ts`):
```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactNode } from 'react';
import { useRevalidateCell } from './useRevalidateCell';

function wrapper() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return ({ children }: { children: ReactNode }) => createElement(QueryClientProvider, { client }, children);
}
const summary = {
  apply: false, scanned: 2, noChange: 1, demotedToFlagged: 1, demotedToRejected: 0,
  skipped: 0, skipReasons: {}, estCostUsd: 0.01, truncated: false, totalCandidates: 2,
  demotions: [{ id: 'e1', from: 'auto-approved', to: 'flagged', reasons: ['Ambiguous'] }],
};

describe('useRevalidateCell', () => {
  it('posts the body to /admin/revalidate and parses the summary', async () => {
    const fetchFn = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => summary } as unknown as Response);
    const { result } = renderHook(() => useRevalidateCell({ fetchFn }), { wrapper: wrapper() });
    await result.current.mutateAsync({ language: 'TR', level: 'A1', type: 'cloze', grammarPoint: 'tr-a1-vowel-harmony', apply: false });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toEqual(summary);
    expect(fetchFn).toHaveBeenCalledWith('/admin/revalidate', { method: 'POST', body: JSON.stringify({ language: 'TR', level: 'A1', type: 'cloze', grammarPoint: 'tr-a1-vowel-harmony', apply: false }) });
  });
});
```

- [ ] **Step 3: Run, expect FAIL** — `pnpm --filter @language-drill/api-client test src/hooks/useRevalidateCell.test.ts`

- [ ] **Step 4: Create the hook** — `packages/api-client/src/hooks/useRevalidateCell.ts` (mirror `useGenerateCell`):
```ts
import { useMutation } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { RevalidateResponseSchema, type RevalidateRequest, type RevalidateResponse } from '../schemas/revalidate';

export function useRevalidateCell({ fetchFn }: { fetchFn: AuthenticatedFetch }) {
  return useMutation<RevalidateResponse, Error, RevalidateRequest>({
    mutationFn: async (body) => {
      const res = await fetchFn('/admin/revalidate', { method: 'POST', body: JSON.stringify(body) });
      const json: unknown = await res.json();
      return RevalidateResponseSchema.parse(json);
    },
  });
}
```

- [ ] **Step 5: Barrel exports** — add to `packages/api-client/src/index.ts`:
```ts
export { RevalidateResponseSchema, type RevalidateRequest, type RevalidateResponse } from './schemas/revalidate';
export { useRevalidateCell } from './hooks/useRevalidateCell';
```

- [ ] **Step 6: Test + typecheck + build**
- `pnpm --filter @language-drill/api-client test src/hooks/useRevalidateCell.test.ts` → pass
- `pnpm --filter @language-drill/api-client typecheck` → clean
- `pnpm --filter @language-drill/api-client build` → success

- [ ] **Step 7: Commit**
```bash
git add packages/api-client/src/schemas/revalidate.ts packages/api-client/src/hooks/useRevalidateCell.ts packages/api-client/src/hooks/useRevalidateCell.test.ts packages/api-client/src/index.ts
git commit -m "feat(admin): api-client useRevalidateCell hook + schema"
```

---

## Task 4: web — Revalidate section + audit filter entry

**Files:** Modify `apps/web/app/(admin)/admin/generation/_components/pool-cell-detail.tsx` + its test; `apps/web/app/(admin)/admin/audit/page.tsx` + its test.

- [ ] **Step 1: Add the audit filter entry (RED → green)**

In `apps/web/app/(admin)/admin/audit/__tests__/page.test.tsx` (or wherever the `ACTIONS` list is asserted — grep for `'generation.trigger'`), add `'revalidate.apply'` to the expected list. Run that test → FAIL. Then add `'revalidate.apply'` to the `ACTIONS` array in `audit/page.tsx`. Re-run → PASS. (If no test asserts the list, skip the test edit and just add the entry.)

- [ ] **Step 2: Write the failing PoolCellDetail test**

Find the existing test for `pool-cell-detail` (grep `PoolCellDetail`/`pool-cell-detail`; likely `apps/web/app/(admin)/admin/generation/_components/__tests__/pool-cell-detail.test.tsx`). Add cases (mirroring how it already mocks `usePoolCell`/`useGenerateCell` — add a `useRevalidateCell` mock to the `@language-drill/api-client` mock). The summary fixture:
```tsx
const previewSummary = { apply: false, scanned: 3, noChange: 2, demotedToFlagged: 1, demotedToRejected: 0, skipped: 0, skipReasons: {}, estCostUsd: 0.02, truncated: false, totalCandidates: 3, demotions: [{ id: 'e1', from: 'auto-approved', to: 'flagged', reasons: ['Ambiguous'] }] };
```
Cases:
- **Preview** renders the dry-run summary: click the "Preview revalidation" button → `mutateAsync` called with `{ ...cell, apply: false }`; assert the summary text appears ("would demote", "→ flagged 1", est cost).
- **Apply disabled until a preview with demotions**: before preview, the Apply button is `disabled`; after a preview with `demotedToFlagged + demotedToRejected > 0`, it's enabled.
- **Apply** path: mock `window.confirm` → true; click Apply → `mutateAsync` called with `{ ...cell, apply: true }`; assert applied summary shown.
- **Truncation note**: when the preview summary has `truncated: true`, a note mentioning `revalidate:cloze` / the total appears.
Mirror the existing test's mocking idiom; mock `window.confirm` with `vi.spyOn(window, 'confirm').mockReturnValue(true)`.

- [ ] **Step 3: Run, expect FAIL** — `pnpm --filter @language-drill/web test "app/(admin)/admin/generation/_components/__tests__/pool-cell-detail.test.tsx"`

- [ ] **Step 4: Implement the Revalidate section**

In `pool-cell-detail.tsx`: import `useRevalidateCell, type RevalidateResponse`. Add the hook (`const revalidate = useRevalidateCell({ fetchFn })`), state for the last summary + a status message, and a section after Refill (rendered for all types). Pattern (adapt classes/wording to the file's idiom):
```tsx
const [revalSummary, setRevalSummary] = useState<RevalidateResponse | null>(null);
const [revalMessage, setRevalMessage] = useState<string | null>(null);
const cellArgs = { language: item.language, level: item.level, type: item.type, grammarPoint: item.grammarPointKey };

const onPreview = async () => {
  setRevalMessage(null);
  try {
    const s = await revalidate.mutateAsync({ ...cellArgs, apply: false });
    setRevalSummary(s);
  } catch { setRevalMessage('Preview failed.'); setRevalSummary(null); }
};
const onApply = async () => {
  const n = (revalSummary?.demotedToFlagged ?? 0) + (revalSummary?.demotedToRejected ?? 0);
  if (!window.confirm(`Demote ${n} exercise(s) in this cell?`)) return;
  setRevalMessage(null);
  try {
    const s = await revalidate.mutateAsync({ ...cellArgs, apply: true });
    setRevalSummary(s);
    setRevalMessage(`Applied: ${s.demotedToFlagged} → flagged, ${s.demotedToRejected} → rejected.`);
  } catch { setRevalMessage('Apply failed.'); }
};

const canApply = !revalSummary?.apply && ((revalSummary?.demotedToFlagged ?? 0) + (revalSummary?.demotedToRejected ?? 0) > 0);
```
Render: a "Revalidate" `<h4>`, a Preview button (`disabled={revalidate.isPending}`), an Apply button (`disabled={revalidate.isPending || !canApply}`), and when `revalSummary` is set a summary line: `scanned N · would demote → flagged X · → rejected Y · skipped Z · est $C` (use "would demote" when `!revalSummary.apply`, "demoted" when applied). When `revalSummary.truncated`, a muted note: `Showing first 25 of {totalCandidates}; use \`pnpm revalidate:cloze\` for the full pass.` Plus the `revalMessage` element. Keep Refill untouched.

- [ ] **Step 5: Run page + audit tests, expect PASS** — `pnpm --filter @language-drill/web test "app/(admin)/admin/generation/_components/__tests__/pool-cell-detail.test.tsx" "app/(admin)/admin/audit"`
- [ ] **Step 6: Typecheck web** — `pnpm --filter @language-drill/web typecheck` → clean (known e2e/db artifact acceptable only if sole + unrelated)
- [ ] **Step 7: Commit**
```bash
git add "apps/web/app/(admin)/admin/generation/_components/pool-cell-detail.tsx" "apps/web/app/(admin)/admin/generation/_components/__tests__/pool-cell-detail.test.tsx" "apps/web/app/(admin)/admin/audit/page.tsx" "apps/web/app/(admin)/admin/audit/__tests__/page.test.tsx"
git commit -m "feat(admin): revalidate trigger (preview → apply) in the cell view"
```

---

## Task 5: Full verification

**Files:** none.

- [ ] **Step 1: Lint** — `pnpm lint` → no errors
- [ ] **Step 2: Repo typecheck** — `pnpm typecheck` → no errors (all packages)
- [ ] **Step 3: Full serial test suite** — `pnpm turbo run test --concurrency=1` → all packages pass. (If `@language-drill/lambda` shows phantom failures from stale `infra/lambda/dist/**/*.test.js`, `rm -rf infra/lambda/dist` and re-run. If `@language-drill/db` dependents fail to resolve the new export, `pnpm build` at root first.)
- [ ] **Step 4: Commit (only if a lint/format autofix changed files; else skip)**
```bash
git add -A && git commit -m "chore(admin): verification fixes" || echo "nothing to commit"
```

---

## Self-review notes

- **Spec coverage:** shared extraction + generalization to any type with the CLI still passing CLOZE (Task 1); `POST /admin/revalidate` sync/bounded/cost-stop/demote-only/dry-run-vs-apply/truncation/audit-on-apply + `AdminAuditAction` (Task 2); `useRevalidateCell` + schema (Task 3); PoolCellDetail preview→apply + audit filter entry (Task 4); full gate (Task 5). Async/bulk/promotion are out of scope per the spec.
- **Type consistency:** the response shape (`apply, scanned, noChange, demotedToFlagged, demotedToRejected, skipped, skipReasons, estCostUsd, truncated, totalCandidates, demotions[{id,from,to,reasons}]`) is identical across the Lambda (Task 2), the Zod schema (Task 3), and the page consumer (Task 4). `reconstructDraftAndSpec(row, exerciseType)` signature is consistent between the new module, the CLI call site, and the Lambda call site. `decideDemotion` return `kind` values (`skip`/`no-change`/`demote`) are handled in the endpoint.
- **Known pitfalls flagged inline:** `pnpm build` after editing `packages/db/src` (dependents resolve via `db/dist`); `rm -rf infra/lambda/dist` for phantom lambda failures; the db chain-mock shifts the queue per awaited query (stage count → candidates → [apply: updates → audit insert]); construct `ValidationResult` fixtures from `routeValidationResult` thresholds so routing is deterministic; mock only `validateDraft` + `createClaudeClient` from `@language-drill/ai` (keep cost helpers real); `z.record(z.string(), z.number())` is the repo's required form.
- **No placeholders:** every code step is complete; the lambda test block is explicitly marked illustrative where staging must be calibrated against the real mock by running the test (TDD).
```
