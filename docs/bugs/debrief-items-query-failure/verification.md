# Bug Verification

**Status: RESOLVED in production** as of 2026-05-17 via PR #129 (`2e6743b`).

This bug is Phase B of `.claude/bugs/debrief-session-not-found/`. The detailed verification — fix summary, test results, deployment notes, lessons captured about the CI gap — lives in `../debrief-session-not-found/verification.md`. This file is a pointer + minimal closure record for the items-query-failure folder.

## Fix Summary

One-character SQL change in `infra/lambda/src/routes/sessions.ts:542-554`: `WHERE e.id = ANY(${exerciseIds})` → `WHERE e.id IN ${exerciseIds}`. Drizzle's `sql\`\`` template interpolates a JS array as a positional record `($N, $N+1, ...)`. `ANY((record))` is invalid Postgres syntax (`op ANY/ALL (array) requires array on right side`); `IN (record)` accepts the same expansion.

## Verification

- **Before fix**: production CloudWatch confirmed the exact failure path (request `a0b894c9-d225-4b87-bf67-b24489de5292`, 2026-05-17T17:05:48Z).
- **After fix (unit)**: new regression test `items query uses 'IN', not 'ANY', on the exerciseIds interpolation` in `infra/lambda/src/routes/sessions.test.ts` captures the generated SQL via `mockExecute.mock.calls[0][0].queryChunks` and asserts `e.id IN` is present and `ANY(` is absent.
- **After fix (live)**: user-confirmed 2026-05-17 — "now debrief works in production".

## Closure Checklist

- [x] **Root cause identified**: Drizzle array-interpolation gotcha — `${array}` expands to `($N, ...)` regardless of surrounding context.
- [x] **Fix shipped**: PR #129 merged into main (`3d349da`).
- [x] **Regression locked**: SQL-shape assertion at the mock layer.
- [x] **Cross-reference**: parent bug `debrief-session-not-found/verification.md` carries the full story.

## Notes

- See `../debrief-session-not-found/verification.md` § "Why CI didn't catch the SQL bug" for the testing-strategy takeaway and the suggested follow-up (CI smoke job that runs handler queries against the PR-scoped Neon branch).
