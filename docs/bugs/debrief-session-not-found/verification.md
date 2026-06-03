# Bug Verification

**Status: RESOLVED in production** as of 2026-05-17 via PR #125 (Phase A — diagnostics) + PR #129 (Phase B — root cause).

## Fix Implementation Summary

The surface symptom — "session not found" rendered after every completed session in production — was masking an underlying HTTP 500 from `GET /sessions/:id/debrief`. The fix landed in two PRs, intentionally separated so the first could surface the actual cause that the second would address.

### PR #125 — Phase A: split error UI by status, add retry + parse/log diagnostics (`91211a7`)

10 files changed, +563/-9.

- `apps/web/.../debrief/[sessionId]/page.tsx` — error branch routes `error.status === 404` → `<DebriefNotFound />`; everything else → new `<DebriefLoadError onRetry={query.refetch} />`. The catch-all that conflated 404 / 5xx / parse failures behind one message is gone.
- `apps/web/.../debrief/_components/debrief-load-error.tsx` (new) — generic load-failure card with "try again" (calls `refetch`) and "back to drill" secondary. Restored the design.md intent that tasks.md had deferred as "v1 collapse".
- `packages/api-client/src/hooks/useDebrief.ts` — switched `DebriefResponseSchema.parse(json)` → `safeParse`; on failure, `console.warn(result.error.issues)` and throw `new Error('Debrief response shape mismatch', { cause: result.error })` so DevTools names the offending field.
- `infra/lambda/src/routes/sessions.ts` — `console.warn` on the 404 branch with `{ event: 'debrief.not_found', sessionId, userId }` so CloudWatch is greppable.
- Plus matching tests: new `debrief-load-error.test.tsx` (4 cases), updated `page.test.tsx` (split 404/5xx assertions), updated `useDebrief.test.ts` (cause + warn assertions), updated `sessions.test.ts` (forensic-log assertion).

### PR #129 — Phase B: items query — use `IN`, not `ANY`, for `exerciseIds` (`2e6743b`)

3 files changed, +187/-1.

- `infra/lambda/src/routes/sessions.ts:542-554` — one-character SQL change in the items query: `WHERE e.id = ANY(${exerciseIds})` → `WHERE e.id IN ${exerciseIds}`. Drizzle's `sql\`\`` template interpolates a JS array as a positional record `($N, $N+1, ...)`, which `ANY((record))` rejects but `IN (record)` accepts. Parameters bound identically; only the operator changes. Comment added pointing at the bug folder.
- `infra/lambda/src/routes/sessions.test.ts` — new regression test `items query uses 'IN', not 'ANY', on the exerciseIds interpolation` that captures `mockExecute.mock.calls[0][0].queryChunks`, reconstructs the static-text skeleton, and asserts it contains `e.id IN` and not `ANY(`. Catches the regression class at unit-test time despite the mocked driver.
- `.claude/bugs/debrief-items-query-failure/report.md` (new) — incident write-up with the CloudWatch error verbatim and the fix rationale.

## Test Results

### Original Bug Reproduction

- [x] **Before fix**: reproduced twice in production. First attempt (Turkish A1, session `7ce627ba-43a2-4ee1-b52f-a86177e7b5dd`) showed the pre-#125 catch-all "session not found" card. Second attempt (post-#125, session `06a21025-6707-44a4-a4ad-ecf41aca9f96`) showed the new `<DebriefLoadError />` card and DevTools+CloudWatch exposed the actual cause:
  ```
  e [Error]: Failed query: ... WHERE e.id = ANY(($2, $3, $4, $5, $6))
  cause: error: op ANY/ALL (array) requires array on right side
  ```
  CloudWatch request id `a0b894c9-d225-4b87-bf67-b24489de5292`, log group `/aws/lambda/LanguageDrillStack-LambdaHandlerF6372945-RI79IMG2rZaG`, 2026-05-17T17:05:48Z.
- [x] **After fix (unit)**: the new regression test in `sessions.test.ts` asserts `e.id IN` is present and `ANY(` is absent in the generated SQL — passes.
- [x] **After fix (live production)**: user-confirmed 2026-05-17 — "now debrief works in production".

### Reproduction Steps Verification

The original report's reproduction (complete a Turkish A1 session in production) cannot be exercised from this session because it requires a deployed Lambda + live Anthropic + live Neon. Equivalence verification done via:

1. **CloudWatch error identification** — the failing query+params printed verbatim names the cause unambiguously; no speculation in the Phase B fix.
2. **Drizzle behaviour verified empirically** — `sql\`SELECT ... IN ${ids}\``.queryChunks` and `sql\`SELECT ... = ANY(${ids})\``.queryChunks` both wrap the array identically; only the surrounding operator differs. The same parameter expansion is now in a valid SQL context.
3. **Unit regression** — locking the generated SQL string shape means a future revert to `ANY(...)` is caught before deploy.
4. **Live user confirmation** — debrief renders the expected header / tabs / footer in production for new completions.

### Regression Testing

- [x] **`infra/lambda` — sessions**: 76 tests pass (was 75 pre-fix — +1 SQL-shape regression).
- [x] **`apps/web` — debrief**: 140 tests pass across 10 suites, including all three error-branch cases from PR #125's test split.
- [x] **`packages/api-client` — useDebrief**: 8 tests pass (success, request shape, error propagation, shape-mismatch cause, caching).
- [x] **Workspace**: `pnpm test` green across all 11 task targets (1301 passing in web alone, including 1 pre-existing skipped).
- [x] **`pnpm lint`**: clean across 6 packages.
- [x] **`pnpm typecheck`**: clean across 11 task targets.

### Edge Case Testing

- [x] **Empty `exerciseIds` array**: not reachable in practice — `practice_sessions.exercise_count` has a runtime min of 1 via `CreateSessionRequestSchema` (`z.number().int().min(1).max(20)`), and the manifest is populated at creation. The `IN (record)` form would still be SQL-valid for an empty list (Drizzle interpolates `IN ()`), though Postgres rejects an empty `IN ()` — but again, unreachable given the create-time guard.
- [x] **Single-element `exerciseIds`**: regression test uses `[EX_1]` — passes. Drizzle expands to `IN ($N)`, valid.
- [x] **Multi-element `exerciseIds`**: confirmed via the production fix — five-element manifest worked once the operator swapped.
- [x] **Skipped items**: the LEFT JOIN with `score IS NULL` branch still produces `status: 'skipped'` items — unchanged from PR #125's untouched logic. Covered by the existing `returns the debrief payload for a completed session (manifest order, mixed statuses)` test.
- [x] **Cross-user / unknown id / not-completed 404**: unchanged from PR #125 — still rendered as `<DebriefNotFound />` via the new `error.status === 404` branch. The forensic log fires before the response.

## Code Quality Checks

### Automated Tests

- [x] **Unit tests**: full workspace green on both PRs.
- [x] **Integration tests**: route-level tests in `infra/lambda` cover `/sessions/:id/debrief` — all pass, plus the new SQL-shape regression.
- [x] **Linting**: clean.
- [x] **Type checking**: clean.

### Manual Code Review

- [x] **Code style**: PR #125's split mirrors the existing `<DebriefNotFound />` component shape (Card + heading + body + button row) for visual continuity; PR #129's one-line SQL change preserves the surrounding query structure and adds a 4-line comment pointing at the bug folder so the rationale is co-located with the code.
- [x] **Error handling**: PR #125 distinguishes parse failures from HTTP failures via `Error.cause`; the page UI surfaces the right copy per status; the Lambda 404 branch logs structured context. PR #129 doesn't add new error paths — only fixes the SQL that triggered the unhandled 500.
- [x] **Performance**: no regressions. Same SQL parameter count, same query plan, same single round-trip.
- [x] **Security**: no auth changes, no schema changes, no new logged fields beyond what was already in `c.get('userId')` / `c.req.param('id')` (both already in the request context).

## Deployment Verification

### Pre-deployment

- [x] **Local testing**: full suite passes on both PRs.
- [x] **Preview deploy**: PR #125 and PR #129 each ran the full CI pipeline (lint + typecheck + test + Neon branch + Vercel preview). Both green.
- [x] **Database migrations**: none required.

### Post-deployment

- [x] **PR #125 deploy** — merged `ba73f98`, Vercel + CDK deployed cleanly. UI split confirmed in production: the second reproduction surfaced the `<DebriefLoadError />` card and DevTools showed the 500.
- [x] **PR #129 deploy** — merged `3d349da`, deployed cleanly.
- [x] **Production smoke check** — user-confirmed: completing a session in production now opens the debrief with the expected header / tabs / footer.
- [ ] **CloudWatch monitoring (24h post-#129)** — owed: confirm no new `op ANY/ALL (array) requires array on right side` lines on the production Lambda log group. Quick spot-check at the next session completion will suffice.
- [ ] **Forensic-log baseline** — owed: confirm no `event:debrief.not_found` lines appear on the production log group during normal use. If they do, it means a real ownership/completion-gate 404 is happening for a different reason; that's a separate investigation, not a regression.

## Why CI didn't catch the SQL bug

Captured as a permanent lesson, since it affected the project's testing strategy assumptions:

- **Unit tests mock `db.execute`**. The SQL string is built but never sent to Postgres. A syntactically invalid query at the SQL level (`ANY((record))`) cannot be caught by a mocked-driver test.
- **CI's `neon-migrate` job creates an ephemeral Neon branch and runs Drizzle migrations**, but no test queries that branch. The migrations confirm schema can be applied; they don't validate any handler's runtime SQL.
- **Result**: the broken pattern survived lint, typecheck, all unit tests, and CI's DB job. The first place it failed was production.

PR #129's regression test captures the SQL string shape at the mock layer — a partial mitigation, not a substitute for real integration tests. A proper fix for the class is a CI smoke job that runs a handful of handler queries against the PR-scoped Neon branch. Noted in `report.md` as out-of-scope but worth a follow-up under `docs/tech-improvements.md`.

## Documentation Updates

- [x] **Code comments**: PR #129 adds a 4-line block above the items-query `sql\`\`` template naming the Drizzle interpolation gotcha and pointing at the bug folder.
- [x] **CLAUDE.md**: no changes needed — the architecture-level description of the session loop is unaffected.
- [x] **Bug docs**: `report.md` + `analysis.md` in `debrief-session-not-found/`, `report.md` + `verification.md` in `debrief-items-query-failure/`. This file closes out the parent bug.

## Closure Checklist

- [x] **Original issue resolved (logical / unit-tested)**: the catch-all UI is split by status; the underlying SQL bug that caused the 500 is fixed; both regressions are locked in tests.
- [x] **Original issue resolved (live)**: user-confirmed in production after PR #129 deployed (2026-05-17). Completing a session now opens the debrief.
- [x] **No regressions introduced**: full workspace test suite green; no contract changes; no schema changes.
- [x] **Tests passing**: green on both #125 and #129.
- [x] **Documentation updated**: code comments + bug docs + this verification.
- [x] **Stakeholders notified**: N/A — single-author project; user is the stakeholder.

## Notes

- This bug was a useful demonstration of the "diagnostic-improving fix first, root-cause fix second" pattern. The Phase A PR could have been postponed until the cause was known, but separating it bought back forensic data on the very next reproduction — DevTools network status + CloudWatch query+params — without any speculation. Worth repeating when a symptom is masked by a catch-all.
- The SQL bug had been latent since `f191ddd Add debrief (Phase G)`. Production traffic is invite-only and low; the broken path went unreported because the only user actually exercising it was reading the catch-all "session not found" message as a legitimate state-not-found case. The pre-#125 UI was, in this very real sense, an active obstacle to bug reporting.
- The follow-up worth scheduling: a CI smoke test that runs key handlers' raw SQL against the PR-scoped Neon branch. The Drizzle `ANY((record))` footgun would have been caught at PR time. Other similar latent bugs may exist; `grep -rn "= ANY(" infra/lambda/src packages/db/src` shows none today, but the class is wide (any future raw `sql\`\`` with array interpolation).
