# Admin Usage & Capacity Dashboard (Design)

**Status:** approved · **Date:** 2026-06-17 · **Scope:** Tier 2 item #8 (read-only)

Derived from `docs/admin-panel.md` (Tier 2, item 8: "Usage & capacity"). Read-only: the
kill-switch / global-cap **toggle** is deferred per the doc's Open Decision (those are
env-driven via CDK and only re-read on deploy; a UI toggle needs a runtime config store, which
is explicitly not built here). Surfaces trailing-24h AI usage + the current capacity-control
state. Builds on the merged admin foundation; mirrors the audit-viewer read pattern (PR #335).

## Goal

Give the admin at-a-glance visibility into AI load and the global brakes: trailing-24h total
events vs. the cap, the kill-switch / cap state, a per-event-type breakdown, and the top
consumers. No mutations.

## Background (verified against current code)

- **`infra/lambda/src/usage/global-capacity.ts`**: the global cap counts **all** `usage_events`
  in the trailing 24h (`globalUsageLast24h` does `count()` over `usage_events WHERE created_at >=
  now-24h`, no event-type filter). Kill switch: `(process.env.AI_KILL_SWITCH ?? '').toLowerCase()
  === 'on'`. Cap: `Number.parseInt(process.env.AI_GLOBAL_DAILY_CAP ?? '', 10)`; only `> 0`
  enables it (unset/0/negative = no cap). A 60s module cache backs the live check — the
  dashboard does NOT use it (queries live).
- **`infra/lambda/src/usage/limits.ts`**: 5 metered buckets (`ai_evaluation`, `read_annotation`,
  `read_span_annotation`, `text_generation`, `writing_helper`). The dashboard's per-type
  breakdown is **not** limited to these — it shows every `event_type` present (the schema
  comment notes others like `custom_exercise`), matching the cap's "count everything" denominator.
- **`usage_events`** (`packages/db/src/schema/access.ts`): `id`, `userId` (FK→users, notNull),
  `eventType` (`event_type` text notNull), `metadata` (jsonb), `createdAt` (`created_at`,
  defaultNow). Index `(user_id, event_type, created_at)`. The `/me` route already does a
  trailing-24h `groupBy(eventType)` count — the same shape to mirror for global + per-user.
- **CDK**: `infra/lib/stack.ts:74-75` passes `AI_KILL_SWITCH` + `AI_GLOBAL_DAILY_CAP` into the
  **API Lambda's** `additionalEnv`, so the route can read them at runtime — no CDK change needed.
- **Admin router** (`infra/lambda/src/routes/admin.ts`): `/admin/*` gated by `authMiddleware +
  adminMiddleware`; the read-list pattern (`Promise.all([rows, count])`, ISO dates, `c.json`) is
  established by `/admin/audit` and `/admin/content`. `db` from `../db`.
- **api-client / web**: `useAuditLog`/`useContentExercises` query-hook idiom; `ADMIN_NAV`
  (`apps/web/components/admin/admin-nav-items.tsx`) currently `[Moderation, Content, Pool,
  Theory, Invites, Audit]`; the read-only client-page idiom is the audit page.

## Architecture

A new read-only **Capacity** section at `/admin/capacity`, one new endpoint, a `useCapacity`
hook, and a page. New `ADMIN_NAV` entry "Capacity" appended last. No table, no migration, no
infra change, no mutations.

```
app/(admin)/admin/capacity/page.tsx   — client: controls + 24h usage + top consumers
```

## API — `GET /admin/capacity` (new, read-only, in `infra/lambda/src/routes/admin.ts`)

No query params. Returns:
```
{
  killSwitch: boolean,            // (AI_KILL_SWITCH ?? '').toLowerCase() === 'on'
  globalDailyCap: number | null,  // parseInt(AI_GLOBAL_DAILY_CAP); null when unset / <= 0
  usage24h: {
    total: number,                // sum of byEventType counts (= all events in 24h)
    byEventType: { eventType: string; count: number }[],   // groupBy event_type, desc
  },
  topConsumers: { userId: string; count: number }[],        // top 10 by 24h count, desc
}
```

Implementation:
- Read env: `killSwitch = (process.env.AI_KILL_SWITCH ?? '').toLowerCase() === 'on'`;
  `const capRaw = Number.parseInt(process.env.AI_GLOBAL_DAILY_CAP ?? '', 10); const
  globalDailyCap = capRaw > 0 ? capRaw : null;` (mirrors `global-capacity.ts` exactly).
- `const since = new Date(Date.now() - 24*60*60*1000);`
- `byEventType`: `db.select({ eventType: usageEvents.eventType, count: count() }).from(usageEvents)
  .where(gte(usageEvents.createdAt, since)).groupBy(usageEvents.eventType).orderBy(desc(count()))`
  (order-by-aggregate: if Drizzle rejects `desc(count())` in `orderBy`, sort the rows desc by
  count in JS instead).
- `topConsumers`: `db.select({ userId: usageEvents.userId, count: count() }).from(usageEvents)
  .where(gte(usageEvents.createdAt, since)).groupBy(usageEvents.userId).orderBy(desc(count()))
  .limit(10)` (same JS-sort fallback if needed).
- Run both in `Promise.all`; map counts via `Number(r.count)`; `total = sum(byEventType counts)`.
- `Date.now()` is fine here (Lambda runtime, not a workflow sandbox).

`usageEvents`, `gte`, `count`, `desc` are imported in admin.ts already (or add `usageEvents` to
the `@language-drill/db` import — `userExerciseHistory` etc. are imported there; confirm and add
`usageEvents`).

## Web — `app/(admin)/admin/capacity/page.tsx`

- `'use client'`; `useAuth()` → `createAuthenticatedFetch` → `useCapacity({ fetchFn })`.
- **Controls** section: a kill-switch badge ("On" / "Off"), the global cap (`globalDailyCap ??
  'no cap'`), and a muted note: "Set via deploy (AI_KILL_SWITCH / AI_GLOBAL_DAILY_CAP) — UI
  toggle not yet available."
- **24h usage** section: a headline line — `{total} / {cap} ({pct}%)` when a cap is set, else
  `{total} events · no cap`; `pct = Math.round(total / cap * 100)`. Then a per-event-type table
  (Event type · 24h count).
- **Top consumers** section: table (User · 24h count). Empty state if no events.
- Loading / error states.
- api-client: `schemas/capacity.ts` (`CapacityResponseSchema`: `killSwitch` bool,
  `globalDailyCap` number|null, `usage24h` `{ total, byEventType: {eventType,count}[] }`,
  `topConsumers: {userId,count}[]`) + `hooks/useCapacity.ts` (`useCapacity({ fetchFn, enabled })`,
  query key `['admin','capacity']`, no params). Barrel-exported.

## Testing

- **Lambda** (`infra/lambda/src/routes/admin.test.ts`, chain-mock + `queryQueue`): with
  `AI_KILL_SWITCH='on'` → `killSwitch:true`; unset → false. `AI_GLOBAL_DAILY_CAP='5000'` →
  `globalDailyCap:5000`; unset/`'0'`/`'-1'` → null. Stage the two grouped queries (byEventType
  rows, topConsumers rows) → assert `byEventType` mapped, `total` = sum, `topConsumers` mapped.
  Restore env vars in `afterAll` (mirror the generate-test env pattern). The chain mock ignores
  `orderBy`/`groupBy`, so tests cover env handling + mapping + sum, not SQL ordering.
- **api-client** (`hooks/useCapacity.test.ts`): calls `/admin/capacity`, parses the response
  (incl. `globalDailyCap: null`).
- **web** (`capacity/page` test, mock `useCapacity` + `useAuth`): renders kill-switch On/Off, cap
  value vs "no cap", the `total / cap (pct%)` headline, the per-type + consumers tables; empty
  state when no events.
- Gate: `pnpm lint`, `pnpm typecheck`, `pnpm turbo run test --concurrency=1`.

## Out of scope

- The kill-switch / cap **toggle** + runtime config store (the doc's Open Decision — stays
  deploy-only; revisit when a UI toggle is actually needed).
- Dollar cost (covered by `/admin/generation`'s `generation-stats`); historical trends > 24h;
  charts; per-user drill-down (that's the user inspector).

## Risks / notes

- **Cap/kill-switch semantics must match `global-capacity.ts`** exactly (the `'on'` check; the
  `>0`-enables cap rule), so the dashboard reports what the runtime actually enforces. The two
  read the same env vars; keep the parsing identical.
- **The dashboard counts live**, not via the 60s capacity cache, so a freshly-set cap or a spike
  shows immediately (the cache only matters for the per-request enforcement path).
- **`byEventType` counts all event types**, matching the cap denominator — if a future event type
  is metered or added, it appears automatically with no code change.
- **`topConsumers` shows raw Clerk user ids** — acceptable for an admin-gated read-only surface;
  resolving to emails is out of scope (and a future user-inspector concern).
- **Order-by-aggregate portability**: if `orderBy(desc(count()))` isn't accepted by the Drizzle
  version, sort in JS after fetching — the result sets are tiny (event types ≤ ~10; top
  consumers limited to 10 after sort).
