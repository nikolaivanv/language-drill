# Bug Report

## Bug Summary

When a learner completes a practice session in production, the app navigates to `/drill/debrief/{sessionId}` and the page renders a "session not found" empty state instead of the expected post-session debrief (header + tabs + items + footer).

Observed on 2026-05-17 by the author (Valentina). Reproduced with a Turkish A1 session; URL: `https://www.langdrill.app/drill/debrief/7ce627ba-43a2-4ee1-b52f-a86177e7b5dd`.

Crucially, `<DebriefNotFound />` is rendered whenever the `useSessionDebrief` query is in *any* error state (`apps/web/app/(dashboard)/drill/debrief/[sessionId]/page.tsx:34-36`), not only on a 404. So "session not found" is the surface message for several distinct underlying failures — API 404, 401, 5xx, or a client-side Zod parse error on a 200 response. The actual HTTP status / response body that the user hit is not yet known and must be captured during `/bug-analyze`.

## Bug Details

### Expected Behavior

After the learner finishes the last item (or ends the session early) the flow is:

1. `POST /sessions/:id/complete` returns 200 with the session summary
2. The client navigates to `/drill/debrief/{sessionId}` (`apps/web/app/(dashboard)/drill/page.tsx:114`)
3. The debrief page calls `GET /sessions/:id/debrief`, receives 200 with `{ id, language, difficulty, startedAt, completedAt, items, ... }`, and renders `<DebriefHeader>` + `<DebriefTabs>` + `<DebriefFooter>`

### Actual Behavior

Step 3 fails: `useSessionDebrief.isError` is true, and `<DebriefNotFound />` is rendered with the copy:

> session not found
> this session may not exist or may not be yours yet — start a new one from drill.

Because the redirect from step 2 only fires from `completeSession.onSuccess`, the complete call almost certainly returned 200 — the row therefore has a non-null `completed_at` written by `practiceSessions.set({ completedAt: new Date(), correctCount })` at `infra/lambda/src/routes/sessions.ts:151-165`. So a literal "row missing or not completed yet" reading of the symptom is inconsistent with the observed redirect.

### Steps to Reproduce

1. Sign in to https://www.langdrill.app on the prod Clerk instance.
2. Pick Turkish, difficulty A1 (any language/level appears to reproduce, but this is the observed case).
3. Run a session through to the last item, or click "end session early".
4. Wait for the redirect to `/drill/debrief/{sessionId}`.
5. Observe the "session not found" card rendered in the page region under the dashboard shell.

### Environment

- **Version**: production frontend on `langdrill.app` and production API on `api.langdrill.app` as of 2026-05-17.
- **Platform**: web (browser unspecified — to capture in `/bug-analyze`); production AWS Lambda + API Gateway; production Clerk instance (`pk_live_*`); production Neon branch.
- **Configuration**: Clerk JWT template `api`, `aud=language-drill`. Vercel production env (`NEXT_PUBLIC_API_URL=https://api.langdrill.app`). Not reproduced locally — local dev bypasses auth and the redirect → debrief sequence works against `dev_user_001`.

## Impact Assessment

### Severity

- [ ] Critical
- [x] High
- [ ] Medium
- [ ] Low

The post-session debrief is the payoff for the entire session loop — it is the surface where the learner sees accuracy, per-item review, and the narrative summary. Sessions completing successfully but the debrief being unreadable means the learner pays the cost of doing the drill and receives none of the value. Progress-tracking signals are still written (history rows exist), but the user-facing motivation cycle is broken in prod.

### Affected Users

All production users on `langdrill.app` who complete a session. Currently invite-gated, so the absolute user count is small, but every completion attempt is affected (assuming the bug is deterministic; needs confirmation in `/bug-analyze`).

### Affected Features

- `/drill/debrief/[sessionId]` page (`apps/web/app/(dashboard)/drill/debrief/[sessionId]/page.tsx`)
- The complete → debrief navigation tail of the session loop
- Indirectly: any later UI that links *back* into a past session's debrief (none currently shipped, but listed for completeness)

Not affected: session creation, item submission, `POST /sessions/:id/complete` itself, progress writes — the summary mutation response is consumed by `state.completed` before navigation, and `user_exercise_history` rows are written by `POST /exercises/:id/submit` along the way.

## Additional Context

### Error Messages

Not yet captured. The known catch points on the failing request path are:

- API: `GET /sessions/:id/debrief` returns `{ error: 'Session not found', code: 'SESSION_NOT_FOUND' }` with a 404 when no row matches `id ∧ userId ∧ completedAt IS NOT NULL` (`infra/lambda/src/routes/sessions.ts:515-521`). By design this collapses cross-user / unknown / not-completed into one response (NFR Security, leak avoidance).
- Client fetch wrapper: `createAuthenticatedFetch` throws on any non-OK status with `(error as any).status = response.status` and `body = parsedBody` (`packages/api-client/src/fetchClient.ts:32-49`).
- Client query: `useSessionDebrief` runs `DebriefResponseSchema.parse(json)` on the response, which throws a `ZodError` if the API payload doesn't match (`packages/api-client/src/hooks/useDebrief.ts:34-37`).

Any of these three throw points sets `query.isError = true`, which routes to `<DebriefNotFound />`.

### Screenshots/Media

URL reported by the user: https://www.langdrill.app/drill/debrief/7ce627ba-43a2-4ee1-b52f-a86177e7b5dd — no screenshot attached. The session UUID is well-formed (passes the `z.string().uuid()` guard at `sessions.ts:488`), so a 400 short-circuit on the API side is ruled out.

### Related Issues

- `.claude/bugs/zombie-running-audit-rows-on-lambda-timeout/` — operates on the same handlers (`sessions.complete`, `sessions.debrief`) but is unrelated: that bug is about audit row state, not 404 responses.
- Spec: `f191ddd Add debrief (Phase G)` — last meaningful change to the debrief slice. No relevant changes since then to either endpoint or schema.

## Initial Analysis

### Suspected Root Cause

Several hypotheses, ordered by likelihood given the symptom. Each must be discriminated by inspecting the actual HTTP response in `/bug-analyze`:

1. **The DB `userId` on the session row does not match the `userId` derived from the production JWT at debrief time.** If the `practice_sessions.user_id` column was populated with a value other than the Clerk `sub` claim (e.g. a Clerk-side internal id, an email, a stale id from before a Clerk webhook landed), then `eq(practiceSessions.userId, userId)` in the debrief WHERE clause will not match, even though the row exists and is completed. The complete endpoint uses the same predicate (`sessions.ts:155-159`) — but the complete `UPDATE` was clearly authored by the *creator*, who is the same logged-in user, so if the create wrote the wrong shape both queries would still match by symmetry. Worth checking the row directly: `SELECT id, user_id, completed_at, language, difficulty FROM practice_sessions WHERE id = '7ce627ba-...'`.

2. **Read-after-write visibility on Neon under serverless connection churn.** Each Lambda invocation can use a fresh Neon HTTP/WebSocket connection. If the debrief GET's connection observes a not-yet-committed write, it would see `completed_at IS NULL` and 404 collapse. Neon has a single writer and standard serializable visibility, so this should not happen, but worth ruling out — particularly because the issue is prod-only, where the create/complete/debrief calls go to three independent Lambda invocations, vs. local dev where they share one process.

3. **A ZodError on `DebriefResponseSchema.parse` — the API returns 200 but the payload fails client-side validation.** Candidates: `language`/`difficulty` enum drift (the DB stores plain text and a stray lowercase or non-enum value would fail `z.nativeEnum`), or an `EvaluationResultSchema` field drifting between Lambda persistence (`response_json` written by the submit handler) and the api-client schema. The `evaluation` field is nullable in `DebriefItemSchema` but if a non-null evaluation has a shape mismatch with `EvaluationResultSchema`, the whole response is rejected. This hypothesis is attractive because it explains why the bug is intermittent / language-specific (Turkish A1 may have produced an evaluation shape that's slightly off).

4. **JWT expiry / Clerk token refresh failure between complete and debrief.** The complete POST and the debrief GET happen seconds apart, each fetching a fresh token via `getToken({ template: 'api' })`. If a token refresh fails on the second call (or Clerk's API audience config drifted), the API returns 401, which the client surfaces as `query.isError = true` and the UI renders as "session not found". Unlikely (would affect more endpoints) but easy to verify from DevTools.

5. **The router pushed to a different URL than what the DB row has.** `sessionId` in `fireCompleteSession(sessionId)` (`drill/page.tsx:110-119`) comes from `state.session.id` set by `CREATE_SUCCEEDED`. The id used in the URL should equal the id in the DB. Worth confirming the create response payload's `id` is the actual primary key (and not, e.g., a fresh client-side UUID).

### UI defect (independent of root cause)

`<DebriefNotFound />` is the catch-all for `query.isError`. The component title literally says "session not found" but is also rendered for 401, 5xx, network failures, and Zod parse errors. This conflates causes and:

- makes the bug harder to diagnose without DevTools,
- misleads the learner ("not yours yet" copy is wrong for a brand-new session they just finished).

The fix here is independent of root cause: the page should at minimum differentiate `error.status === 404` from other errors and render different copy. Calling this out so it lands in `/bug-fix` alongside the root cause fix.

### Affected Components

- `apps/web/app/(dashboard)/drill/debrief/[sessionId]/page.tsx` — error branch dispatches all errors to `DebriefNotFound`.
- `apps/web/app/(dashboard)/drill/debrief/_components/debrief-not-found.tsx` — copy + behaviour; may need a sibling component for non-404 errors.
- `apps/web/app/(dashboard)/drill/page.tsx:110-119` — `fireCompleteSession` redirect site; confirm `sessionId` is the DB primary key.
- `infra/lambda/src/routes/sessions.ts:483-617` — the debrief GET handler; verify the 404 predicate (`id ∧ userId ∧ completedAt IS NOT NULL`) doesn't reject a legitimately-completed row.
- `infra/lambda/src/routes/sessions.ts:131-186` — the complete POST handler; verify `userId` written into `practice_sessions.user_id` at session-create time matches the JWT `sub` Clerk now returns for the same user.
- `packages/api-client/src/schemas/debrief.ts` — `DebriefResponseSchema` may be the throw point for a client-side error; check enum strictness on `language`/`difficulty` and `EvaluationResultSchema` shape against what the Lambda actually writes for prod evaluations.
- `packages/api-client/src/hooks/useDebrief.ts:34-37` — Zod parse site; consider whether parse failure should be distinguished from HTTP failure in the surfaced error.

### Open Questions for `/bug-analyze`

- What HTTP status does `GET /sessions/{7ce627ba-...}/debrief` actually return in prod? (DevTools / CloudWatch.)
- If it's 404: does the DB row exist? Is `user_id` equal to the Clerk JWT `sub` for the same logged-in account? Is `completed_at` non-null?
- If it's 200: is the client-side Zod parse failing? On which field?
- If it's 401: is the prod Clerk JWT template `api` still serving `aud=language-drill`? Did anything in Clerk webhook / JWT config drift recently?
- Reproducibility: does the bug fire every time, only on Turkish A1, only on certain exercise types? Try a second session in another language to discriminate.
- Is the user signed in via Clerk Google OAuth, passwordless, or a magic link — does the path differ?
