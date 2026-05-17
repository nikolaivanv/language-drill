# Bug Analysis

## Root Cause Analysis

### Investigation Summary

Starting from the bug report's five hypotheses, I read the full request path on both ends (web → Lambda → DB) and tightened the candidate set. Two key findings reshape the picture:

1. **A literal API 404 (`SESSION_NOT_FOUND`) is unlikely on a freshly-completed session.** The complete and debrief handlers use a symmetric WHERE clause (`id ∧ userId ∧ completedAt`), with the debrief swapping `IS NULL` → `IS NOT NULL` (`infra/lambda/src/routes/sessions.ts:154-159` vs `:507-511`). If `POST /sessions/:id/complete` returned 200, the row matched all three predicates and now has `completed_at` set. The same JWT `sub` is extracted by the same `authMiddleware` on the immediately-following debrief request (`infra/lambda/src/middleware/auth.ts:14-55`), so the user_id predicate cannot diverge between the two calls for the same browser session. Hypothesis 1 in the report (user_id mismatch) is downgraded.

2. **The "session not found" UI is a catch-all for any `query.isError`** (`apps/web/app/(dashboard)/drill/debrief/[sessionId]/page.tsx:34-36`). It renders for 4xx, 5xx, network failures, and Zod parse failures on a 200 response, with no per-cause copy. So the observed string tells us nothing about the underlying status code. This is part of the bug, not just a wording polish — it actively masks the root cause from the user and the developer.

Because I cannot read production CloudWatch logs or the user's DevTools network tab from this worktree, the residual root cause cannot be conclusively pinned to one of {Zod parse failure on 200, 5xx, 401, transient visibility lag}. The analysis below recommends a two-part fix: a *diagnostic-improving* UI/instrumentation change (low risk, high value, fixes the masking-of-cause symptom) that will reveal the underlying status on the next reproduction, plus a targeted code-path fix once that diagnostic lands.

### Root Cause

**Surface root cause (high confidence):** The debrief page funnels every `useSessionDebrief` failure mode through a single `<DebriefNotFound />` branch. The component's headline is "session not found" regardless of whether the server returned 404, 401, 5xx, or the client's Zod schema rejected an otherwise-successful response. This is what the user is seeing — the literal text. It is correct *as a label* only for the legitimate 404 case.

**Underlying root cause (medium confidence, requires DevTools/CloudWatch to confirm):** Based on the code paths examined, the most plausible underlying failure is one of these, in descending order of likelihood:

| # | Hypothesis | Why plausible | How to confirm |
|---|---|---|---|
| 1 | **Zod parse failure on a 200 response** at `packages/api-client/src/hooks/useDebrief.ts:34-37` (`DebriefResponseSchema.parse(json)` throws → `query.isError = true`) | The debrief response includes `evaluation: EvaluationResultSchema.nullable()` for each item; `EvaluationResultSchema` requires 7 fields including `errors: z.array(...)`. The Lambda calls `parseResponseJson` (`sessions.ts:469-481`) which passes the persisted `evaluation` object through *unchanged*. If any historical `user_exercise_history.response_json.evaluation` is missing or has a misshapen field, the entire debrief payload is rejected on the client. The bug was reproduced on Turkish A1, where the test/eval surface is the smallest — a single off-shape evaluation can poison the whole response. | DevTools network tab → preview the 200 response body and run it through `DebriefResponseSchema.safeParse` in console; or add a `result.error.issues` log in the catch. |
| 2 | **Lambda 5xx** (cold start timeout, Neon connection error) | The debrief handler does two SQL trips (`sessions.ts:503-547`); a cold Lambda may exceed timeout, especially under low traffic. `createAuthenticatedFetch` throws on any non-OK, which still routes to `<DebriefNotFound />`. | DevTools status; CloudWatch logs for `LanguageDrillStack-ApiLambda*` |
| 3 | **401 on the GET** (token refresh failure, JWT audience drift, signed-out state mid-flow) | `getToken({ template: 'api' })` fires twice in quick succession (complete then debrief). A refresh failure on the second call sends a missing/expired token; API Gateway's JWT authorizer returns 401 before reaching the Lambda. | DevTools status; presence/absence of `Authorization: Bearer …` header |
| 4 | **Literal 404 from the API** | The symmetric-WHERE argument makes this very unlikely on a freshly-completed session. The only path is a connection-pool-level visibility lag on Neon between the complete's writer and the debrief's reader, which Neon's single-primary architecture should preclude. | DevTools status + payload `{ "code": "SESSION_NOT_FOUND" }` |
| 5 | **Stale TanStack Query cache** with `staleTime: Infinity` | Not applicable on first load — the cache key `['session-debrief', sessionId]` is unique per session and there's nothing previously cached. Ruled out. | n/a |

The diagnostic-improving fix in §Implementation Plan flushes hypothesis 1–3 to the user's screen on the next reproduction, so we can lock the root cause before changing handler code.

### Contributing Factors

- **The error-branch UI is a single catch-all.** `query.isError ? <DebriefNotFound /> : …` conflates 5 distinct failure modes into one message. This is the *primary contributing factor* — even if the underlying cause is identified and fixed, this UI will continue to mislead on any future debrief error.

- **`createAuthenticatedFetch` already attaches the status code** (`packages/api-client/src/fetchClient.ts:46-48`) but the debrief page never reads it. The information needed to differentiate 404 vs others is already on the error object — it's only one line of branching away.

- **The Lambda's 404 collapsing of "cross-user / unknown / not-completed" into a single response** is correct by design (NFR Security, leak avoidance — `sessions.ts:450-452`). It's not the root cause, but it does mean the API side cannot give the UI more granularity even if asked. The UI needs to differentiate based on its own error object instead.

- **No server-side log for the debrief 404 branch.** When the SELECT returns zero rows, the handler returns 404 silently. CloudWatch shows nothing distinctive, making post-hoc forensics harder. A `console.warn({ event: 'debrief.not_found', sessionId, userId })` line would close this gap.

## Technical Details

### Affected Code Locations

- **File**: `apps/web/app/(dashboard)/drill/debrief/[sessionId]/page.tsx`
  - **Function/Method**: `DebriefPage` (default export)
  - **Lines**: `30-55` (the `query.isError ? <DebriefNotFound /> : …` branch is at `34-36`)
  - **Issue**: Any error from `useSessionDebrief` renders the "session not found" copy. The component should differentiate by `error.status` (already populated by `createAuthenticatedFetch`) and render: (a) `<DebriefNotFound />` only for genuine 404, (b) a generic "Couldn't load this debrief. Try again." card with a retry button for everything else, and (c) surface `error.message` somewhere reachable (DevTools console at minimum) for diagnosability.

- **File**: `apps/web/app/(dashboard)/drill/debrief/_components/debrief-not-found.tsx`
  - **Function/Method**: `DebriefNotFound`
  - **Lines**: `12-31`
  - **Issue**: Component is currently the catch-all. Two narrow choices:
    - Rename concept-wise to make it 404-specific (component name stays, but the page only routes 404s to it), and add a sibling `<DebriefLoadError onRetry={…} />` for everything else. **Preferred.**
    - Or alternatively, accept an `error` prop and conditionally render different copy. Worse — keeps the misleading title for non-404 cases unless every branch is hand-rolled.

- **File**: `packages/api-client/src/hooks/useDebrief.ts`
  - **Function/Method**: `useSessionDebrief`
  - **Lines**: `27-42`
  - **Issue**: `DebriefResponseSchema.parse(json)` throws on shape mismatch and the error message is buried inside a generic `Error`. Worth changing to `safeParse` and throwing a typed `DebriefParseError` (or attaching `cause` to a plain `Error`) so the page can distinguish "parse failed" from "HTTP failed". Also consider logging `result.error.issues` to console on the failure path — invisible by default in prod, but invaluable when reproducing with DevTools open.

- **File**: `packages/api-client/src/fetchClient.ts`
  - **Function/Method**: `createAuthenticatedFetch` (returned wrapper)
  - **Lines**: `32-49`
  - **Issue**: No change needed to this file. Already attaches `status` and `body` to the thrown error. Mentioned only to confirm the data is available upstream.

- **File**: `infra/lambda/src/routes/sessions.ts`
  - **Function/Method**: `sessions.get('/sessions/:id/debrief', ...)`
  - **Lines**: `483-617`
  - **Issue**: No bug in the handler logic, but missing forensic-grade logging on the 404 branch (`515-521`). Add a structured `console.warn({ event: 'debrief.not_found', sessionId: id, userId, completedFilter: 'IS_NOT_NULL' })` so CloudWatch shows whether the prod symptom is actually a 404 at all, and if so, on which session/user.

- **File**: `apps/web/app/(dashboard)/drill/debrief/[sessionId]/page.test.tsx`
  - **Issue**: Needs to be extended with two new tests: (a) `query.isError` with `error.status === 404` renders `<DebriefNotFound />`, (b) `query.isError` with `error.status === 500` (or anything non-404) renders the new load-error card with a retry button.

### Data Flow Analysis

The complete flow, end to end, with the error branches called out:

```
[1] User finishes last drill item
    └─ apps/web/app/(dashboard)/drill/page.tsx:170 → fireCompleteSession(state.session.id)

[2] POST /sessions/{id}/complete
    └─ authMiddleware extracts sub from JWT (auth.ts:37,53)
    └─ Handler atomic UPDATE on (id, userId, completedAt IS NULL) → sets completedAt = NOW()
       │ returns 200 with { id, exerciseCount, correctCount, attemptedCount, skippedCount, durationSeconds }
       │ OR returns 400 INVALID_SESSION if no row matched
    └─ Client onSuccess fires (drill/page.tsx:114) → router.push('/drill/debrief/{id}')
       OR onError fires → COMPLETE_FAILED dispatch, no navigation

[3] Browser navigates to /drill/debrief/{id}
    └─ DebriefPage mounts (client component, no SSR)
    └─ useSessionDebrief fires GET /sessions/{id}/debrief

[4] GET /sessions/{id}/debrief
    └─ authMiddleware extracts same sub from same Clerk template
    └─ UUID guard at sessions.ts:488 (passes — id is well-formed)
    └─ SELECT on (id, userId, completedAt IS NOT NULL) — should match the row just updated in [2]
       │ ① Match → 200 with full payload (id, language, difficulty, items[], counts, timestamps)
       │ ② No match → 404 SESSION_NOT_FOUND
       │ ③ Network/timeout → 5xx
    └─ Client receives Response:
       │ Path ① → fetchClient passes through → DebriefResponseSchema.parse(json)
       │           ├ parse OK → query.isSuccess → renders header/tabs/footer
       │           └ parse FAIL → throws ZodError → query.isError → <DebriefNotFound />  ◀ FAILURE A
       │ Path ② → fetchClient throws { status: 404 } → query.isError → <DebriefNotFound />  ◀ FAILURE B (legitimate)
       │ Path ③ → fetchClient throws { status: 5xx } → query.isError → <DebriefNotFound />  ◀ FAILURE C
       │ Path ④ → API Gateway 401 before Lambda → fetchClient throws → <DebriefNotFound />  ◀ FAILURE D
```

The bug surface — "session not found" — is the union of A, B, C, D. The fix has to either (i) make the page render distinct copy for each, and/or (ii) eliminate whichever underlying path is actually firing.

### Dependencies

- **`@clerk/nextjs`** (`useAuth().getToken({ template: 'api' })`) — produces JWTs with `aud=language-drill`, `sub=user.id` per CLAUDE.md. No code change needed here; only relevant for hypothesis 3 (401).
- **`@tanstack/react-query`** (`useQuery` in `useDebrief.ts`) — `staleTime: Infinity`, no explicit `retry` config (defaults to 3). Will retry on network/5xx but not on Zod throw inside `queryFn`. This means a Zod failure surfaces immediately while a 5xx waits ~3 retries — useful when interpreting DevTools timing.
- **`zod`** (`DebriefResponseSchema`, `EvaluationResultSchema`) — strict required-field validation; rejection is silent unless caught and inspected.
- **Drizzle + neon-serverless** — debrief handler does two query trips, one ORM SELECT + one raw SQL DISTINCT ON. Both run on the same Lambda invocation/connection. No cross-connection visibility concern *within* a single handler.
- **AWS Lambda + API Gateway v2 with Clerk JWT authorizer** — auth happens at the gateway; only `sub` reaches the Lambda via `event.requestContext.authorizer.jwt.claims`.

## Impact Analysis

### Direct Impact

- Production users see "session not found" on the debrief page after every (or many) completed sessions, depending on which underlying cause is firing and how reproducible it is.
- The session's progress signals (history rows, scores) *are* persisted by `POST /exercises/:id/submit` — so the user's progress tracking is intact. Only the post-session payoff view is broken.
- Until the underlying root cause is identified, repeat attempts (refresh, re-complete a fresh session) likely show the same error — so the user has no way to self-recover.

### Indirect Impact

- **Trust and engagement.** The debrief is the motivational payoff of the entire drill loop ("here's how you did, here's what to review"). Repeatedly hitting an error there undermines the whole product proposition — the user did the work and got nothing back.
- **Diagnostic blindness.** Because every error funnels through the same UI, this same masked-cause failure mode is the *one* you cannot triage from a user's screenshot. Every future debrief failure for any reason will look identical until the page surfaces the cause.
- **Spec/Req drift.** `debrief-not-found.tsx:8-10` cites "Req 1.6 + design.md error path" as authorizing the catch-all branch. The original spec wording may need amending if the design assumed only-404-is-an-error.

### Risk Assessment

If unfixed:

- Every production completion is at risk of the same dead-end UX. Severity stays at High.
- Future debrief schema evolutions (new fields, new exercise types, new evaluation shapes) can re-trigger Zod parse failures and stay masked behind the same generic "session not found" page, making regressions invisible.
- The user has reported once; further reports become less likely (people stop reporting persistent bugs that look identical to the last one).

If partially fixed (only the underlying cause, not the UI):

- The current symptom goes away, but the diagnostic gap remains. The next regression hides behind the same wall.

## Solution Approach

### Fix Strategy

Two-phase, both landing in the same PR:

**Phase A — Make the failure mode visible (low risk, fast, valuable on its own).**

1. Split the error branch in the debrief page: 404 → `<DebriefNotFound />` (existing component, unchanged copy); everything else → a new `<DebriefLoadError onRetry={…} />` component with appropriate copy ("Couldn't load this debrief — try again.") and a retry button that calls `query.refetch()`.
2. Distinguish Zod parse failures from HTTP failures in `useSessionDebrief`. Use `safeParse` and throw a `new Error('Debrief response shape mismatch', { cause: result.error })`, so consumers can read `error.cause.issues` for the offending field. Log `result.error.issues` to `console.warn` on the failure path (visible in DevTools, harmless in prod).
3. Add a structured log on the API 404 branch (`sessions.ts:515-521`): `console.warn({ event: 'debrief.not_found', sessionId, userId })`. This makes the legitimate-404 case greppable in CloudWatch and tells us whether the user's reproduction was actually hitting that path.

**Phase B — Address the underlying cause once Phase A surfaces it.**

After deploying Phase A, the user re-runs a Turkish A1 session. The new error UI plus the `console.warn` from `useDebrief` (or the CloudWatch `debrief.not_found` log) will reveal which of A/B/C/D from the data flow is actually firing. The Phase B fix is then targeted: Zod schema relaxation, evaluation back-fill, Lambda timeout bump, JWT/audience config check — whichever the diagnostics implicate.

We can't pre-commit to the Phase B change without that signal; speculating wastes the user's review time. But the most likely concrete Phase B work, ranked:

1. **Make `evaluation` field defensive on the server.** If hypothesis 1 (Zod parse) is confirmed, the right fix is server-side, not client-side: re-validate `evaluation` via a Lambda-side `parseEvaluationResult`-like guard inside `parseResponseJson` (`sessions.ts:469-481`), and return `evaluation: null` if it doesn't conform. Better to lose one item's eval than lose the whole debrief.
2. **Allow partial evaluation client-side** by making fields optional in `EvaluationResultSchema`. Less preferred — pushes shape drift to consumers of the type, which is the wrong direction.
3. **Lambda warm-up / timeout adjustment** if hypothesis 2 (5xx) is confirmed.
4. **Token refresh handling** if hypothesis 3 (401) is confirmed — but the symmetric token use in complete and debrief makes this unlikely.

### Alternative Solutions

- **Reproduce locally first instead of shipping Phase A.** Not feasible: the bug is prod-only (dev bypasses auth, dev DB has different data). Trying to mock production state burns time vs. shipping a small diagnostic improvement that fixes a real UX gap regardless.
- **Add a server-side debug endpoint that dumps the row state for a sessionId.** Considered and rejected — exposing internals on prod for diagnostics is the wrong tradeoff, especially when the same information can come from a one-line CloudWatch log.
- **Wrap the whole `useSessionDebrief` query in a fallback that retries with a small delay.** This was on the table for hypothesis 4 (visibility lag), but Neon's primary-only architecture and the symmetric-WHERE analysis make that hypothesis unlikely enough that retry-band-aids would just paper over the diagnostic gap without confirming anything.
- **Migrate to passing the debrief payload through `router.push` state instead of refetching.** Would sidestep the GET entirely. Tempting, but loses persistability (refreshing the URL would still hit the API) and the GET is the right long-term primitive for direct-linking to a past session.

### Risks and Trade-offs

**Phase A risks:**
- A copy/UI change for a small but visible component, plus a small surface area in `useDebrief`. Low blast radius. Existing tests in `debrief-not-found.test.tsx` and `page.test.tsx` need to be updated to cover the new branch.
- The new `<DebriefLoadError />` component needs its own a11y review (button focus, screen-reader copy). Standard UI work.
- `console.warn` calls in the api-client may bloat user devtools — acceptable; debrief errors are rare and the warn is informative.

**Phase B risks** — depend on which hypothesis is implicated:
- Server-side `parseResponseJson` defensive guard (hypothesis 1) → low risk; the function is already designed to degrade gracefully (`sessions.ts:466-468`).
- Lambda config change (hypothesis 2) → small infra risk; needs to be CDK-only, deployed via the normal pipeline.
- Auth/token change (hypothesis 3) → higher risk; touches the critical auth path. Should be a separate PR with its own analysis if needed.

## Implementation Plan

### Changes Required

1. **Split the debrief page's error branch by status.**
   - File: `apps/web/app/(dashboard)/drill/debrief/[sessionId]/page.tsx`
   - Modification: Replace `query.isError ? <DebriefNotFound /> : …` with a small `renderErrorState(error)` helper that returns `<DebriefNotFound />` when `(error as { status?: number }).status === 404`, and `<DebriefLoadError onRetry={() => query.refetch()} />` otherwise.

2. **Add the new `<DebriefLoadError />` component.**
   - File: `apps/web/app/(dashboard)/drill/debrief/_components/debrief-load-error.tsx` (new)
   - Modification: New client component mirroring `<DebriefNotFound />`'s shape: `<Card>` with title "Couldn't load this debrief", body copy "Something went wrong loading your results — try again, or head back to drill.", a primary "Try again" button wired to `onRetry`, and a secondary "Back to drill" button mirroring the existing fallback.

3. **Distinguish parse failures from HTTP failures in the hook.**
   - File: `packages/api-client/src/hooks/useDebrief.ts`
   - Modification: Change `DebriefResponseSchema.parse(json)` to `safeParse`. On `success === false`, `console.warn('[useSessionDebrief] response shape mismatch', result.error.issues)` then `throw new Error('Debrief response shape mismatch', { cause: result.error })`. Existing `query.isError` semantics preserved.

4. **Add server-side log on the legitimate 404 branch.**
   - File: `infra/lambda/src/routes/sessions.ts`
   - Modification: Before `return c.json(...)` at lines 517-520, add `console.warn(JSON.stringify({ level: 'warn', event: 'debrief.not_found', sessionId: id, userId, message: 'debrief 404 — no matching session row' }))`. Use the same structured-log pattern as other CloudWatch-greppable logs in the codebase (search for existing `JSON.stringify({ level:` lines for the prevailing shape).

5. **Update tests.**
   - File: `apps/web/app/(dashboard)/drill/debrief/[sessionId]/page.test.tsx`
   - Modification: Add two cases. (i) `mockUseSessionDebrief` returns `{ isError: true, error: Object.assign(new Error('x'), { status: 404 }) }` → assert `DebriefNotFound` renders. (ii) Same but `status: 500` → assert the new `DebriefLoadError` renders with a clickable retry button that calls `refetch`.
   - File: `apps/web/app/(dashboard)/drill/debrief/_components/__tests__/debrief-load-error.test.tsx` (new)
   - Modification: Basic render + button-handler tests.
   - File: `packages/api-client/src/hooks/useDebrief.test.ts`
   - Modification: Add a test for the safeParse failure path — mock the fetchFn to return malformed JSON, assert that the thrown error has a Zod `cause` and a message containing "shape mismatch".
   - File: `infra/lambda/src/routes/sessions.test.ts`
   - Modification: In the existing debrief 404 test (around line 1500ish — search for `SESSION_NOT_FOUND` in this file), assert `console.warn` was called with the expected structured payload. Use `vi.spyOn(console, 'warn')`.

### Testing Strategy

1. **Local unit tests** — all four test files above must pass: `pnpm test --filter @language-drill/api-client --filter @language-drill/web --filter infra-lambda`.
2. **Local end-to-end smoke** — start the dev stack (`pnpm dev`), complete a Turkish A1 session against the local API, confirm the redirect to `/drill/debrief/{id}` renders the header/tabs/footer correctly (the dev path uses `dev_user_001` and bypass auth, so the same row write-and-read sequence applies on the local DB).
3. **Type + lint** — `pnpm typecheck`, `pnpm lint` from repo root.
4. **Preview deploy** — push to a branch, let the Vercel preview + Neon branch deploy. Reproduce against the preview against the dev Clerk instance — this is the closest we can get to prod without touching prod.
5. **Post-deploy diagnostic capture** — once Phase A ships to prod, ask the user (Valentina) to re-run a Turkish A1 session. Open DevTools, run the session, capture the network tab (status code + response body for the failing `/sessions/{id}/debrief` call) and the console (which will now contain either a Zod `issues` log or just an HTTP failure). Pull the CloudWatch logs for the matching request id to see if the legitimate-404 log fired. That triplet pins the underlying cause and gates Phase B.

### Rollback Plan

Phase A is entirely additive UI/logging — no schema changes, no handler logic changes, no auth changes. Rollback options, by escalation:

1. **Single-PR revert** — `git revert <merge_commit>` and redeploy via the normal pipeline. The previous catch-all error UI returns; the bug is back where it was, but nothing worse.
2. **Hot-fix forward** — if the new `<DebriefLoadError />` component renders incorrectly or the safeParse change throws unexpectedly, the existing `<DebriefNotFound />` is still imported and can be re-routed by toggling the `renderErrorState` branch — a 5-line patch.
3. **No data migration involved** — no need to plan a DB rollback. Lambda log addition is no-op without it; component change is a UI-only.

Phase B's rollback plan will depend on the implicated cause and will be drafted in a follow-up analysis if/when the diagnostic confirms which hypothesis fired.
