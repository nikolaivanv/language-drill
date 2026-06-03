# Invite-as-Perk Usage Tiers — Design

**Date:** 2026-06-03
**Status:** Approved (ready for implementation plan)
**Author:** nikolaivanv (with Claude)

## Summary

Turn invite codes from a (currently inert) access **gate** into a usage **perk**.
Anyone can sign up free on a capped tier. An invite code — or being a known admin
user — unlocks a 10× daily limit. A global kill-switch caps total spend so open
signup can't run up an unbounded Claude/Polly bill.

This is the early-stage stand-in for paid subscriptions: charging is not yet
possible for legal reasons, so a higher limit is granted by invite instead of by
payment. A future Stripe `'pro'` tier will map to the same boosted limits.

## Goals

- Open signup to everyone on a **free** tier (50 evaluations/day + 50 annotations/day).
- Let the author hand out invite codes that grant a **boosted** tier (10× = 500/500).
- Give the admin/prod user the boosted tier automatically.
- Reduce the free evaluation + annotation limits to 50/day each and **separate** the
  buckets (today evaluations and skim-annotations share one 50/day bucket).
- Add a **global usage ceiling / kill-switch** so a flood of free signups can't
  produce an unbounded bill, while invited friends and the admin keep working.
- Provide an **admin page** to generate codes, copy invite links, and see redemptions.

## Non-Goals (YAGNI)

- Stripe / paid `'pro'` tier (the data model leaves room; no billing now).
- Rebuilding Clerk's hosted auth screens as custom components (slim layer only).
- Emailing invites (the author copies invite links manually).
- Per-invite analytics dashboards.

## Background — current state

- **The invite gate is already inert.** `infra/lambda/src/middleware/invite.ts`
  (`inviteMiddleware`, returns `403 NO_INVITE`) is defined but **never mounted** in
  `infra/lambda/src/index.ts`. The API is not actually invite-gated today.
- The Clerk webhook (`infra/lambda/src/routes/webhooks/clerk.ts`) still
  **auto-assigns the first spare invite** to every signup — a gate-era leftover.
- **Limits today** (hardcoded, three call sites):
  - `infra/lambda/src/routes/exercises.ts` — `POST /exercises/:id/submit`,
    `DAILY_EVAL_LIMIT = 50`, counts `ai_evaluation`.
  - `infra/lambda/src/annotate-stream/handler.ts` — `POST /read/annotate`,
    limit `50`, counts `ai_evaluation` **+** `read_annotation` (shared bucket).
  - `infra/lambda/src/annotate-stream/deep-flow.ts` — `POST /read/annotate-span`,
    `READ_SPAN_DAILY_LIMIT = 150`, counts `read_span_annotation` (separate).
- Usage is tracked in Postgres `usage_events` (`packages/db/src/schema/access.ts`),
  not Upstash. Upstash Redis is provisioned in CDK but unused in Lambda code.
- **Admin infrastructure already exists.** `infra/lambda/src/middleware/admin.ts`
  (`adminMiddleware`) gates `/admin/*` via the `ADMIN_USER_IDS` env var
  (comma-separated Clerk user IDs). The `infra/lambda/src/routes/admin.ts` router
  already mounts `authMiddleware, adminMiddleware` on `/admin/*`.
- `users` table (`packages/db/src/schema/users.ts`) has `id`, `email`,
  `createdAt`, `updatedAt` — no plan/tier/role column.
- The `invitations` table (`packages/db/src/schema/access.ts`) already has
  `code` (unique), `usedBy`, `usedAt`, `expiresAt`, `createdAt`.

## Design decisions (settled)

1. **Tier resolution: stored `plan` column** (Approach A). Set at signup and at
   redemption; limits derived from plan. Fast hot-path, explicit, extends to a
   future `'pro'`. Chosen over per-request computation (extra hot-path query,
   scattered logic) and Clerk `publicMetadata` (Clerk coupling, awkward to query).
2. **Prod-user 10× reuses `ADMIN_USER_IDS`** rather than hardcoding the email
   `nikolaivanv@gmail.com` from the prototype. Admin users get `plan='boosted'`.
3. **Open signup + global kill-switch** for abuse/cost control.
4. **Separate eval and annotation buckets**, with 10× applied to all three buckets
   (eval, skim-annotation, deep-span).
5. **Slim invite layer on top of Clerk** — no custom auth screens.
6. **Admin page** (plus the API it needs) for managing codes.

## Architecture

### Data model

- **`users.plan`** — `TEXT NOT NULL DEFAULT 'free'`. Values: `'free'` (1×),
  `'boosted'` (10×). Reserve `'pro'` for future Stripe (treated as boosted).
- **`invitations`** — reuse; add:
  - `note TEXT` (nullable) — free-text label, e.g. who the code is for.
  - `revokedAt TIMESTAMP` (nullable) — set when an admin revokes an unused code.
- **Migration + backfill** (Drizzle, forward-only):
  - Add `users.plan`.
  - Backfill `plan='boosted'` for users who currently hold a claimed invitation
    (`invitations.usedBy = users.id`) — existing testers keep their perk.
  - Backfill `plan='boosted'` for any `ADMIN_USER_IDS`.
  - Everyone else remains `'free'` (column default).

### Limits — single source of truth

New module `infra/lambda/src/usage/limits.ts`:

```ts
export const BASE_DAILY_LIMITS = {
  ai_evaluation: 50,
  read_annotation: 50,        // skim annotations
  read_span_annotation: 150,  // deep-span annotations
} as const;

export const BOOST_MULTIPLIER = 10;

export function limitFor(eventType: keyof typeof BASE_DAILY_LIMITS, plan: string): number {
  const base = BASE_DAILY_LIMITS[eventType];
  return plan === 'free' ? base : base * BOOST_MULTIPLIER;
}
```

Refactor the three enforcement points to use `limitFor(...)` with the caller's
`plan`, and **split the buckets**:

| Endpoint | Counts (eventType) | Free | Boosted | Change |
|---|---|---|---|---|
| `POST /exercises/:id/submit` | `ai_evaluation` | 50 | 500 | limit via `limitFor`; still eval-only |
| `POST /read/annotate` | `read_annotation` only | 50 | 500 | **drop `ai_evaluation` from the shared count** |
| `POST /read/annotate-span` | `read_span_annotation` | 150 | 1500 | limit via `limitFor` |

Each call site loads the user's `plan` (single-column select alongside the
existing usage-count query, or via the resolved user row).

### Global kill-switch (abuse / cost ceiling)

Shared guard run **before** the per-user cap on all three AI endpoints
(e.g. `infra/lambda/src/usage/global-capacity.ts`):

- **`AI_KILL_SWITCH`** (env, e.g. `'on'`) — hard stop: 503
  (`code: 'GLOBAL_CAPACITY'`) for all non-admin users; admin (`ADMIN_USER_IDS`)
  still served so the author can keep testing.
- **`AI_GLOBAL_DAILY_CAP`** (env, optional integer) — soft cap: when the total
  count of `usage_events` in the trailing 24h exceeds it, **free**-tier users get
  503 while **boosted/admin** are still served. Protects spend without cutting off
  invited friends or the author.
- Implementation: a single `count(usage_events) WHERE created_at > now()-24h`,
  cached ~60s in Lambda module scope to avoid hammering the DB. Upstash counters
  are the later scale path; unset `AI_GLOBAL_DAILY_CAP` = no soft cap.
- New env vars wired into both AI Lambdas via CDK.

### API endpoints

- **`POST /invites/redeem` `{ code }`** (auth). Validate: code exists, `usedBy`
  null, not expired (`expiresAt`), not revoked (`revokedAt`). On success: set
  `usedBy`/`usedAt`, set `users.plan='boosted'`. Idempotent if the same user has
  already redeemed (return current plan, no error). Error responses carry a `kind`
  matching the prototype: `invalid` / `expired` / `used`. Returns `{ plan, limits }`.
- **`GET /me`** (auth). Returns `{ plan, isAdmin, limits, usageToday }` where
  `limits` and `usageToday` cover all three buckets. Powers the plan badge,
  welcome surface, and settings. (No `/me` exists today — new.)
- **Admin** (reuse `authMiddleware + adminMiddleware`, mounted in `admin.ts`):
  - `POST /admin/invites` `{ count, expiresInDays?, note? }` → generate N codes,
    return codes + invite links.
  - `GET /admin/invites` → list with status (`unused` / `redeemed` / `expired` /
    `revoked`), redeemer email, and timestamps.
  - `POST /admin/invites/:id/revoke` → set `revokedAt` (only if still unused).

### Webhook change

In `webhooks/clerk.ts` `user.created`:
- Upsert the user row (unchanged).
- Set `plan = ADMIN_USER_IDS.includes(userId) ? 'boosted' : 'free'`.
- **Remove** the "find first unused invitation and assign it" block (gate-era).
  Invites are now redeemed explicitly via `POST /invites/redeem`.

### Frontend (slim layer on Clerk)

- **`apps/web/app/invite/[code]/page.tsx`** — perk landing adapted from the
  prototype (`InviteLanding`: Brand, `TierTable` 50→500, optional inviter name).
  CTAs: "accept invite & sign up" stashes the code in `localStorage`
  (`pending_invite`) and hands off to Clerk sign-up; "continue without it (free)".
- **Post-sign-in redemption hook** — a client component mounted after auth that,
  if `pending_invite` is set, calls `POST /invites/redeem` once, clears it, and
  toasts the result (success or error `kind`).
- **Settings → "Plan & limits"** — plan badge, today's usage vs limits from
  `GET /me`, and a redeem-code box (prototype's segmented `InviteCodeBoxes`).
- **`apps/web/app/admin/invites/page.tsx`** — client-gated by `isAdmin` from
  `GET /me`, server-enforced by `adminMiddleware`: generate-codes form + a table
  of codes with copy-link buttons and status.

### Config / env

- **`ADMIN_USER_IDS`** (existing) — drives admin page access **and** boosted plan
  for the prod user. Ensure the author's Clerk userId is included (almost
  certainly already, since `/admin/*` routes exist).
- **`AI_KILL_SWITCH`** (new, optional) — hard global stop for non-admins.
- **`AI_GLOBAL_DAILY_CAP`** (new, optional integer) — soft global cap for free tier.
- `BASE_DAILY_LIMITS` / `BOOST_MULTIPLIER` as code constants in the limits module.

## Data flow — invite redemption

1. Author runs the admin page → `POST /admin/invites` → codes created in
   `invitations`. Author copies an invite link `…/invite/<code>`.
2. Recipient opens the link → landing page stores `<code>` in `localStorage`,
   then Clerk sign-up. Clerk webhook creates the user with `plan='free'`.
3. After sign-in, the redemption hook posts the stashed code to
   `POST /invites/redeem` → invitation claimed, `users.plan='boosted'`.
4. Subsequent AI calls resolve `plan='boosted'` → 10× limits via `limitFor`.

## Error handling

- Redemption: distinct `kind`s (`invalid`/`expired`/`used`) → prototype copy.
  Double-redeem by the same user is a no-op success.
- Rate limit hit: existing `429 RATE_LIMIT_EXCEEDED` (now per-bucket).
- Global cap / kill-switch: `503 GLOBAL_CAPACITY`; admins/boosted exempt as defined.
- Admin endpoints: `403 FORBIDDEN` (existing `adminMiddleware`).

## Testing

- **Unit:** `limitFor` (free vs boosted per bucket); redemption (valid, expired,
  used, revoked, double-redeem); webhook plan assignment + **no** auto-claim;
  global-capacity guard (free blocked, boosted/admin served; hard switch);
  admin endpoint gating.
- **Update existing** rate-limit tests in `exercises.test.ts` and the
  annotate-stream tests for the **split** buckets (eval no longer shares with skim).
- **Optional E2E** (`apps/web/e2e/`): settings redeem flow flips plan + limits.

## Rollout notes

- Forward-only migration; backfill runs in the same migration.
- After deploy, confirm the author's row is `plan='boosted'` (via admin/`/me`).
- `AI_GLOBAL_DAILY_CAP` can start unset (no soft cap) and be tuned once real
  usage is observed; `AI_KILL_SWITCH` is the emergency brake.

## Open items

None — all clarifying decisions are settled (Approach A; reuse `ADMIN_USER_IDS`).
