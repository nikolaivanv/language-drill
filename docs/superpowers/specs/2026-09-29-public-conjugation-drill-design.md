# Public (Unauthenticated) Conjugation Drill — Design

> Status: **Approved design, not yet implemented.** Captured 2026-09-29.
> Feature 1 of 3 in the "open a surface to attract real users" sequence
> (2: anonymous cloze/translation demo with real AI feedback; 3: public +
> indexed theory library). Those are separate specs — see *Out of scope*.

## Goal

Let an anonymous visitor drill conjugation immediately at `/try/conjugation`,
with no signup, no account, and no cost to us — so a link posted in a learner
community lands on something that *works* instead of a signup wall.

Success is a link we can post that a stranger can use in one click, and which
ends on an honest signup CTA.

## Non-goals

- **No reclaim.** The sitting is stateless by explicit decision: nothing is
  written, so there is nothing to migrate onto a Clerk id at signup. The
  debrief says so plainly rather than implying saved progress.
- No anonymous session rows, no `user_exercise_history`, no mastery updates,
  no `usage_events`.
- No SEO work (no sitemap, no metadata strategy, no server-rendered content
  pages). That belongs to the theory spec, where it pays off.

## Decisions

### D1 — Grading happens client-side, reusing the shared grader

`GET /exercises/set` already returns `contentJson` wholesale
(`infra/lambda/src/routes/exercises.ts:313-322`), which for conjugation
includes `targetForm`, `acceptableForms`, `breakdown` and `exampleSentences`.
The answers are already on the wire in the authenticated product.

`gradeFluencyAnswer` (`packages/shared/src/fluency.ts:88`) is a pure function
in `@language-drill/shared`, which `apps/web` already depends on, and it is
the *same* function the authenticated submit path calls
(`routes/exercises.ts:438`). The public runner calls it directly.

This is reuse, not duplication: the grader carries the Turkish İ/I dual
case-fold (`CASE_FOLD_LOCALES`, `fluency.ts:61`) that a reimplementation
would get wrong, and diacritics are deliberately *not* stripped.

Consequence: the visitor can read answers from devtools. Accepted — there is
no score, no progress and no leaderboard to defend, and it is already true of
the authenticated endpoint.

**Rejected alternatives.**
- *Server-side grading via `POST /public/conjugation/check`.* Keeps answers
  off the wire until submission, but costs a second public route, a POST
  surface needing its own abuse limiting, an extra round-trip per item, and
  either a public fetch-by-id path or server-held state (ruled out by the
  stateless decision). It protects nothing of value.
- *Anonymous bypass inside `authMiddleware` on the existing route.* Smallest
  diff, largest blast radius: it widens the authenticated surface instead of
  adding a narrow public one, and one wrong condition exposes every
  authenticated route.

### D2 — `type` is forced server-side to `conjugation`

The load-bearing security constraint of this design. The public endpoint must
never accept a caller-supplied `type`: because `contentJson` is returned
wholesale, an open `type` param would let anyone page the cloze, translation
and free-writing pools — answers included — and walk off with ~30k rows of
generated content. `type` is a server constant in the query, not a parameter.

### D3 — No `grammarPoint` parameter in v1

The authenticated set endpoint accepts `grammarPoint`; the public one does
not. Two reasons: a demo needs no per-point targeting, and an unvalidated
caller-supplied point key would make the cache key space (D4) unbounded.
Without it the public key space is exactly 3 languages x 4 levels = 12.

Link targeting — the thing that actually matters for posting — is served by
`?lang=`/`?level=` on the web route instead.

### D4 — A module-scope pool cache, not Upstash, is the abuse brake

**Correction to an earlier assumption:** Upstash Redis is *not* wired into
the Lambda. `UPSTASH_REDIS_REST_URL` / `_TOKEN` exist in Secrets Manager and
Upstash appears in the CLAUDE.md stack table, but no code reads them —
today's per-user limits are DB-counted over `usage_events`
(`infra/lambda/src/usage/limits.ts`). There is no rate-limit primitive to
reuse.

The real risk an unauthenticated GET carries is not content scraping (~1,300
conjugation rows of generated drill items are not the moat — the curriculum,
validator and progress model are). It is **Neon compute**: an attacker
hammering an endpoint that runs a 300-row window query per request can spin
up our database and degrade it for real users. API Gateway's default
throttling is orders of magnitude too high to prevent that.

So the brake is caching, which removes the DB from the hot path entirely:

- A module-scope `Map` keyed `"<LANG>|<LEVEL>"`, holding the fetched window
  plus a fetch timestamp. TTL 5 minutes — the same module-scope-cache pattern
  the Langfuse prompt client already uses.
- On a miss, run the window query once; on a hit, serve from memory.
- Randomisation moves out of SQL into JS: shuffle the cached window per
  request, then de-dupe. `ORDER BY random()` is therefore *not* used.

Sizing makes this comfortable: conjugation cells are <=~220 rows/level
(`lib/exercise-set.ts:11-13`), so all 12 keys together are a few MB at worst.
Request volume becomes irrelevant to DB load — the cost ceiling is 12 queries
per Lambda instance per 5 minutes.

A real rate limiter (Upstash, or DB-counted by IP) is a follow-up **if abuse
appears**, and is explicitly out of scope here.

## API

New router `infra/lambda/src/routes/public.ts`, mounted in
`infra/lambda/src/index.ts` alongside the others. It is the **only** router
that does not apply `authMiddleware`; a comment must say so, because every
sibling does.

```
GET /public/conjugation/set?lang=ES|DE|TR&level=A1|A2|B1|B2&count=<1..10>
```

- `lang` required, `z.enum(['ES','DE','TR'])` — EN is source-only
  (`packages/shared/src/onboarding.ts`), so it is not offerable.
- `level` required, `z.enum(['A1','A2','B1','B2'])`. There is no approved
  C1/C2 content in prod; requesting one must 400, not return empty.
- `count` optional, clamped by a new `PUBLIC_CONJUGATION_SET_MAX = 10` in
  `lib/exercise-set.ts`, kept separate from `CONJUGATION_SET_MAX = 20` so
  raising the authenticated limit never widens the public one.
- `type` is **not** a parameter (D2). `grammarPoint` is **not** a parameter (D3).

Query composition reuses `approvedStatusFilter` and `audioReadyFilter`
(`lib/exercise-filters.ts`) — the latter is a no-op for conjugation but is
kept so every serve path composes identically. `freshFirstOrderBy` is *not*
used: it correlates on a user id that does not exist here.

De-dup reuses `conjugationSignature` + `dedupeBySignature`
(`lib/exercise-set.ts`) unchanged, applied to the shuffled cached window.

Response mirrors the authenticated set endpoint minus audio presigning
(conjugation rows carry no `audio_s3_key`):

```json
{ "exercises": [ { "id", "type", "language", "difficulty",
                   "grammarPointKey", "contentJson" } ],
  "available": 10, "difficulty": "B1" }
```

An empty pool for a valid (lang, level) returns `200` with
`exercises: [], available: 0`; the web surface renders an honest empty state
rather than an error. (Today every cell is populated except ES/DE at B2 —
see *Risks*.)

## CDK

Two authorizer-free routes in `infra/lib/constructs/api-gateway.ts`, mirroring
the proven precedent at lines 147-157 (`/email/confirm`,
`/email/unsubscribe`): `GET /public/{proxy+}` and its `OPTIONS` counterpart.
More-specific paths take precedence over `/{proxy+}`, so these are
unauthenticated while everything else stays gated.

CORS stays in Hono middleware (unchanged) so `*.vercel.app` previews keep
working.

### Observability ripple — must land in the same PR

This is the first route that returns **200s to unauthenticated IPs**. It
invalidates the triage baseline documented in CLAUDE.md and established in
PRs #738/#739, which currently reads: *"every prod request that day was a 4xx
with zero Lambda invocations"*, and *"real usage has Count ~ Invocations with
4xx ~ 0, while rejected traffic has Count == 4xx with Invocations == 0"*.

After this ships, unauthenticated traffic can legitimately invoke the Lambda,
so `Invocations > 0` no longer implies authenticated usage. The CLAUDE.md
"Requests that never reach the Lambda" note must be amended in the same PR,
or the next incident triage reads the metrics wrong. The prod
`4xx >= 200/hour` alarm is unaffected.

## Web

New route **outside** `(dashboard)`, which carries the authenticated shell:
`apps/web/app/(public)/try/conjugation/page.tsx`.

- Reads `?lang=` / `?level=` so a posted link is pre-targeted (r/turkish gets
  a Turkish link, not a language picker). Invalid or absent values fall back
  to an in-page picker; no redirect.
- Prompt rendering reuses `drill/_components/conjugation-exercise.tsx` if it
  is presentation-only; if it reaches for auth or dashboard context, the
  public page gets a thin presentational extraction rather than a fork.
- A new runner modeled on `fluency/_components/fluency-runner.tsx`, but
  holding all state in React with no persistence and no per-answer fetch:
  one fetch for the set, then grade locally via `gradeFluencyAnswer`.
- Fixed sitting of 10, then a debrief showing `N/10`, the items missed with
  their `breakdown`, and the signup CTA. A fixed end is deliberate: it
  creates the moment to ask for signup that an endless drill never has.
- The debrief states plainly that the practice was not saved.

`proxy.ts` gains `'/try(.*)'` in `isPublicRoute` — **plus a test asserting
it**, since nothing currently enforces that list and a missing entry silently
redirects the whole feature to sign-in.

## api-client

A Zod response schema and an **unauthenticated** fetch hook mirroring
`packages/api-client/src/hooks/useExercise.ts` minus the token — it must not
call `createAuthenticatedFetch`, or an anonymous visitor's request fails
before it is sent.

## Testing

| Layer | Cases |
|---|---|
| `routes/public.test.ts` | reachable with no auth header; `type` cannot be overridden by a query param (the D2 regression test); `count` clamped to 10; `lang=EN` and `level=C1` both 400; empty cell returns 200 with `available: 0`; dedup collapses duplicate signatures |
| cache unit test | second call inside the TTL issues no query; a call after TTL expiry refetches; distinct (lang, level) keys do not collide |
| `proxy.test.ts` | `/try/conjugation` is public; a known dashboard route is still protected |
| web runner tests | correct/incorrect verdicts via the shared grader; a Turkish İ/I answer grades correct; sitting ends at 10; debrief counts match; no network call per answer |
| E2E | one spec in the **`unauthenticated`** Playwright project (`docs/testing.md`) — visit `/try/conjugation?lang=ES&level=B1`, answer one item, see a verdict |

Full gate before push, per CLAUDE.md: `pnpm lint`, `pnpm typecheck`, `pnpm test`
(package-by-package on this machine).

## Risks and accepted risks

- **Answers visible in the payload** (D1) — accepted; nothing to defend.
- **Content scraping** — ~1,300 conjugation rows are reachable in ~130
  requests. Accepted: these are generated drill items, not the moat, and the
  forced `type` (D2) keeps the other ~30k rows unreachable.
- **No rate limiter** — mitigated for DB load by the cache (D4); a real
  limiter is a follow-up gated on observed abuse.
- **Thin cells.** Conjugation has no approved B2 rows for ES or DE
  (measured in prod 2026-09-29), and 2-8 grammar points per cell, so a
  sitting of 10 can feel repetitive at some (lang, level) pairs. The
  empty/thin state must read as honest, not broken. Distinct items available:
  TR 585, ES 430, DE 260.
- **Conjugation is the least differentiated exercise type** — it is what
  conjugation-table sites already do, so this surface proves the app *works*
  without proving what makes it *better*. That is the explicit job of feature
  2 (anonymous cloze/translation with real AI feedback), and the reason this
  spec is not the whole growth plan.

## Out of scope (separate specs)

1. Anonymous cloze/translation demo with real Claude feedback — needs
   anonymous LLM abuse limiting, which this spec deliberately does not build.
2. Public + search-indexed theory library (312 approved pages) — needs
   unauthenticated read endpoints, server rendering, and a sampled human
   review pass before crawlers see 311 `auto-approved` grammar explanations.
