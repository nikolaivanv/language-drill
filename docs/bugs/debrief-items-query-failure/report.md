# Bug Report

## Bug Summary

`GET /sessions/:id/debrief` returns HTTP 500 on every production request that reaches the items query. The handler's raw SQL uses `WHERE e.id = ANY(${exerciseIds})`, but Drizzle's `sql\`\`` template interpolates a JS array as a positional record `($N, $N+1, …)` — a Postgres ROW, not an array. The resulting `ANY((record))` is invalid syntax; pg raises `op ANY/ALL (array) requires array on right side` and the Hono handler propagates as an unhandled 500.

Discovered 2026-05-17 via the diagnostics added in PR #125 (Phase A of the parent `debrief-session-not-found` bug). The Phase A `<DebriefLoadError />` + structured logging surfaced the 500 status and CloudWatch captured the full query+params, naming the cause directly. This bug is Phase B of that investigation.

## Bug Details

### Expected Behavior

The items query returns one row per exercise in the session manifest (LEFT-JOINed with the most-recent `user_exercise_history` row for that `(session_id, exercise_id)`). The handler then returns the full debrief payload with HTTP 200.

### Actual Behavior

`db.execute` throws on the items query. Hono's default error handler returns HTTP 500. CloudWatch (2026-05-17T17:05:48Z, request id `a0b894c9-d225-4b87-bf67-b24489de5292`) shows the failing SQL verbatim:

```sql
SELECT e.id AS exercise_id, e.type, e.content_json,
       h.score, h.response_json
FROM exercises e
LEFT JOIN (
  SELECT DISTINCT ON (exercise_id)
         exercise_id, score, response_json, evaluated_at
  FROM user_exercise_history
  WHERE session_id = $1
  ORDER BY exercise_id, evaluated_at DESC NULLS LAST
) h ON h.exercise_id = e.id
WHERE e.id = ANY(($2, $3, $4, $5, $6))
```

`params: [<sessionId>, <exId-1>, …, <exId-5>]`

The error cause: `op ANY/ALL (array) requires array on right side`.

### Steps to Reproduce

1. In production, complete any drill session (any language / level).
2. After redirect to `/drill/debrief/{sessionId}`, observe the new `<DebriefLoadError />` card.
3. DevTools network → `GET /sessions/{id}/debrief` is 500.
4. CloudWatch: `/aws/lambda/LanguageDrillStack-LambdaHandlerF6372945-RI79IMG2rZaG`, filter pattern `<sessionId>` (or just `ANY(($`) — the failing query+params is logged.

The bug is deterministic in production. It has likely been latent since `f191ddd Add debrief (Phase G)` — production traffic is invite-only and low, so the broken path didn't get reported until the author's recent reproductions.

### Environment

- **Version**: production, post-`ba73f98` (PR #125 merged). The defect itself dates to `f191ddd`.
- **Platform**: AWS Lambda (`LambdaHandlerF6372945`), eu-central-1, Hono router, Drizzle ORM, `@neondatabase/serverless` over WebSocket, production Neon branch.
- **Configuration**: Drizzle `sql\`\`` template; no integration tests against a real Postgres for this handler's queries — only mocked unit tests (`infra/lambda/src/routes/sessions.test.ts`) and CI migrations on the ephemeral Neon branch.

## Impact Assessment

### Severity

- [ ] Critical
- [x] High
- [ ] Medium
- [ ] Low

Every production session completion hits this 500. The post-session debrief — the entire payoff of the drill loop — is unreadable. Progress is still persisted (history rows are written by the submit handler), so signal collection is intact, but the user sees only the load-error card.

### Affected Users

All production users who complete a drill session. Currently invite-gated, so user count is small, but every completion is affected (100% deterministic given the SQL is unconditional).

### Affected Features

- `GET /sessions/:id/debrief` (the only endpoint that uses this query)
- `/drill/debrief/[sessionId]` page (renders `<DebriefLoadError />` instead of the debrief)

Not affected: session creation, item submission, complete, progress writes, today, theory, read.

## Additional Context

### Why mocked unit tests passed

`infra/lambda/src/routes/sessions.test.ts` mocks `db.execute` to return rows from a fixture, so the SQL string is constructed but never executed. The `op ANY/ALL` error is a Postgres-side runtime error; it cannot be caught by a mocked-driver test.

CI's `neon-migrate` job creates an ephemeral Neon branch and runs Drizzle migrations, but no integration tests query that branch. So the broken pattern survived `lint`, `typecheck`, all unit tests, and CI's DB job.

### Error Messages

From CloudWatch, 2026-05-17T17:05:48Z, log group `/aws/lambda/LanguageDrillStack-LambdaHandlerF6372945-…`:

```
e [Error]: Failed query: <SQL above>
params: <session+exercise UUIDs>
  at X3.queryWithCache (/var/task/index.js:157:32396)
  ...
{
  cause: error: op ANY/ALL (array) requires array on right side
    at /var/task/index.js:136:38258
}
```

### Related Issues

- `.claude/bugs/debrief-session-not-found/` — parent bug. Phase A (PR #125, merged `ba73f98`) shipped the diagnostic UI that made this 500 visible. This bug is the Phase B underlying root cause.

## Initial Analysis

### Suspected Root Cause

Drizzle's tagged-template `sql\`${arrayValue}\`` interpolates JS arrays as a positional record `($N, $N+1, ...)`, not as a Postgres array literal. This is intentional Drizzle behaviour for `IN (...)` lists. The handler used `ANY((...))` instead of `IN (...)`, which is invalid syntax.

The minimal fix is to swap `WHERE e.id = ANY(${exerciseIds})` for `WHERE e.id IN ${exerciseIds}`. The interpolation expansion is identical — `IN ($2, $3, ...)` — but the operator accepts it.

Empirical verification of Drizzle behaviour (from this worktree):

```ts
sql`WHERE id IN ${[a,b,c]}`  → queryChunks: ['WHERE id IN ', [a,b,c], '']
sql`WHERE id = ANY(${[a,b,c]})` → queryChunks: ['WHERE id = ANY(', [a,b,c], ')']
```

Both expand the array to the same `($N, …)` record. The IN context accepts it; the ANY context requires an array.

### Fix Options

1. **Swap `ANY(${ids})` → `IN ${ids}` (recommended).** One-character SQL change. Same parameter binding. Validates with the new regression test that captures the SQL string. Zero schema or runtime change.
2. **Replace raw SQL with Drizzle ORM operators.** Use `inArray(exercises.id, exerciseIds)` in a Drizzle `.where()`. Cleaner long-term but the surrounding query has a `DISTINCT ON` LEFT-JOIN subquery that's awkward to express in Drizzle; a partial conversion is more code and more risk than the single-char fix.
3. **Use Postgres array literal with explicit cast.** `WHERE e.id = ANY(${sql.array(exerciseIds, 'uuid')})` — requires Drizzle's `sql.array` helper (availability varies by Drizzle version) and adds the cast surface area without benefit over option 1.

### Affected Components

- `infra/lambda/src/routes/sessions.ts:542-554` — the broken `ANY((...))` in the items query.
- `infra/lambda/src/routes/sessions.test.ts` — needs a regression test that captures the SQL passed to `db.execute` and asserts it contains `e.id IN` and not `ANY(`. Unit tests cannot catch the Postgres error directly (driver is mocked), but they can lock the SQL string shape so this regression class never lands again.

### Open Questions for `/bug-fix`

- Should other raw-SQL files in the codebase be audited for the same `ANY(${array})` pattern? `grep -rn "= ANY(" infra/lambda/src packages/db/src` shows only `sessions.ts` uses this — confirmed safe.
- Should CI add a smoke-test query against the ephemeral Neon branch to catch raw-SQL regressions of this class? Out of scope for this bug fix — recommend a separate `docs/tech-improvements.md` entry.
