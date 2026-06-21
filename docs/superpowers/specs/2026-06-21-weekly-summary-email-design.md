# Weekly Summary Email — Design

> Status: **Approved design (2026-06-21).** Implementation pending.
> Scope decided: weekly progress summary, end-to-end (schema → templates →
> scheduled job → preference-gated sends → double opt-in confirm + one-click
> unsubscribe). Broadcast (release notes / curriculum updates) is **out of
> scope** for this build. Builds on the strategy in `docs/email-strategy.md`.

## 1. Goal & scope

Ship the per-user **weekly progress summary** email end-to-end:

- Provider: **Resend** + **React Email** (per `docs/email-strategy.md`).
- **Consent: double opt-in, off by default.** Users are opted out at signup,
  enable the summary in settings (→ `pending` + confirmation email), and only
  start receiving sends after clicking confirm (→ `confirmed`).
- **Content:** activity recap + grammar movers/focus + a single CTA back to the
  app. No mastery-radar deltas, no streaks/XP (consistent with the
  no-gamification rule).
- **Inactive week:** a confirmed subscriber who did zero exercises that week
  gets **no email** (the send is skipped, not a nudge).
- One-click, token-based **unsubscribe** in every email (no auth required).

Out of scope: broadcast/audience email, auth email (owned by Clerk),
mastery-radar deltas in the email body.

## 2. Architecture & package boundaries

### New package: `packages/email`

Holds React Email **template components**, a `render()` helper, and a thin
**Resend client** wrapper. Templates accept **plain data props only** — no
`@language-drill/db` types — so the package never imports `@language-drill/db`.
This keeps it clear of the `ai`-must-not-import-`db` build-cycle class of
problem (see project memory `ai-db-build-cycle`). All DB querying and data
assembly happens in the consuming Lambda, which passes plain props in.

Exports:
- `WeeklySummaryEmail` (React Email component) + its props type.
- `ConfirmSubscriptionEmail` (React Email component) + its props type.
- `renderEmail(component)` → `{ html, text }`.
- `sendEmail({ to, subject, html, text, headers })` → wraps the Resend SDK;
  when `RESEND_API_KEY` is unset, logs the rendered HTML instead of sending
  (local-dev path).

### CDK constructs (separate from the generation rig)

Mirror the existing generation scheduler/queue/worker pattern
(`infra/lib/constructs/scheduler-lambda.ts`, `generation-lambda.ts`,
`generation-queue.ts`) but as **independent** resources — do not overload the
generation queue.

- **Weekly EventBridge schedule** → **dispatcher Lambda**
  (`infra/lambda/src/email/dispatcher.ts`). Default cron: **Monday 08:00 UTC**.
- **Email SQS queue + DLQ** → **sender Lambda**
  (`infra/lambda/src/email/sender.ts`), `batchSize: 1`,
  `reportBatchItemFailures: true`, modest reserved concurrency.

Confirm / unsubscribe / toggle are **Hono routes** on the existing API Lambda.

## 3. Data flow

```
EventBridge (weekly cron, Mon 08:00 UTC)
  → dispatcher Lambda:
       SELECT user_id, email FROM users JOIN email_preferences
         WHERE weekly_summary = 'confirmed'
       compute period_key  (ISO week, e.g. '2026-W25')
       LEFT JOIN sent_emails on (user_id,'weekly_summary',period_key);
         skip users already present (status sent/skipped)
       enqueue one SQS message per remaining user
         (SendMessageBatch, ≤10 per batch — SQS hard limit)

  → sender Lambda (one message per user):
       1. CLAIM: INSERT sent_emails(user_id,'weekly_summary',period_key,
                   status='pending') ON CONFLICT (user_id,kind,period_key)
                   DO NOTHING RETURNING id
          - no row returned → re-read existing; if status in (sent,skipped)
            → ACK and stop (idempotent); if 'pending' (prior crash) → proceed.
       2. GATHER: query the activity window [period_start, period_end) for the
          user — exercises completed, languages practiced, days active, top
          improved grammar points, 2-3 weak spots to focus on.
       3. If zero activity → UPDATE status='skipped'; ACK; stop.
       4. RENDER: WeeklySummaryEmail(props) → { html, text }.
       5. SEND: Resend, from "Language Drill <summary@langdrill.app>",
          List-Unsubscribe + List-Unsubscribe-Post headers → token URL.
       6. UPDATE sent_emails SET status='sent', sent_at=now().
       On any throw before step 6: do NOT ACK → SQS retry → DLQ after maxReceive.
```

Idempotency rests on the `sent_emails` unique constraint. At-least-once SQS
delivery plus `batchSize: 1` means the worst case is a rare re-send if a worker
crashes between SEND and the final UPDATE; the claim row narrows the window and
is acceptable for a weekly summary.

## 4. Schema (new Drizzle migration)

New file under `packages/db/src/schema/` (e.g. `email.ts`), re-exported from
`schema/index.ts`.

```ts
// email_preferences — one row per subscribed/managed user
email_preferences(
  user_id           text PRIMARY KEY → users.id (ON DELETE CASCADE),
  weekly_summary    text $type<'off'|'pending'|'confirmed'> NOT NULL DEFAULT 'off',
  unsubscribe_token uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),  // stable; in every email
  confirm_token     uuid,            // set when 'pending', cleared on confirm
  confirm_sent_at   timestamp,
  confirmed_at      timestamp,
  created_at        timestamp DEFAULT now(),
  updated_at        timestamp
)

// sent_emails — idempotency ledger
sent_emails(
  id          serial PRIMARY KEY,
  user_id     text NOT NULL → users.id (ON DELETE CASCADE),
  kind        text NOT NULL,          // 'weekly_summary'
  period_key  text NOT NULL,          // '2026-W25'
  status      text NOT NULL,          // 'pending' | 'sent' | 'skipped'
  sent_at     timestamp,
  created_at  timestamp DEFAULT now(),
  UNIQUE (user_id, kind, period_key)
)
```

Rows in `email_preferences` are created lazily on first toggle (no backfill for
existing users; absent row = `off`). The migration must be forward-only
(project convention).

## 5. Endpoints

All on the existing API Lambda (Hono).

| Route | Auth | Behavior |
|---|---|---|
| `POST /email/weekly-summary` | authed | Body `{ enabled: boolean }`. Enable: upsert pref → `pending`, mint `confirm_token`, set `confirm_sent_at`, send `ConfirmSubscriptionEmail`. Disable: set `off`, clear tokens. |
| `GET /me/email-preferences` | authed | Returns current state (`off`/`pending`/`confirmed`) for the settings UI. (May fold into existing `GET /me`.) |
| `GET /email/confirm?token=…` | public | Looks up by `confirm_token`; flips `pending→confirmed`, sets `confirmed_at`, clears `confirm_token`; returns a minimal self-contained HTML success page. Idempotent / friendly on already-confirmed or unknown token. |
| `GET /email/unsubscribe?token=…` | public | Looks up by stable `unsubscribe_token`; sets `weekly_summary='off'`; returns HTML page. |
| `POST /email/unsubscribe?token=…` | public | RFC 8058 one-click unsubscribe target (List-Unsubscribe-Post); same effect, returns 200. |

Public routes are mounted outside `authMiddleware` (same pattern as `/health`
and `/webhooks/clerk`). Tokens are the only credential — acceptable for
low-sensitivity email preferences and standard practice for unsubscribe links.

## 6. Web UI

Add an **"Email"** section to the existing settings surface in `apps/web` with:
- A toggle for the weekly summary.
- Status text reflecting `off` / `pending` ("Check your inbox to confirm") /
  `confirmed`.
- Wired through `packages/api-client` (TanStack Query hook + Zod types) to
  `POST /email/weekly-summary` and the preferences read.

## 7. Secrets, env & DNS

- **`RESEND_API_KEY`** added to AWS Secrets Manager (`language-drill/` prod,
  `language-drill-dev/` dev) and granted/injected into the email Lambdas (and
  the API Lambda for confirmation-email sends) in CDK, following the existing
  `infra/lib/constructs/lambda.ts` secret-wiring pattern.
- **Local dev:** `RESEND_API_KEY` optional; when unset, `sendEmail` logs the
  rendered HTML instead of sending. React Email preview server (`email dev`)
  for template iteration.
- **DNS (manual, documented step — cannot be in code):** verify
  `langdrill.app` (or `summary.langdrill.app`) in Resend and add the
  issued SPF / DKIM / DMARC records to Cloudflare (DNS-only / grey-cloud,
  consistent with existing records). Without these, mail lands in spam.

## 8. Error handling & observability

- Sender failures bubble (no ACK) → SQS redrive → DLQ after `maxReceiveCount`.
- Failures land in **CloudWatch**, not Sentry (email runs in Lambda; respects
  the existing observability boundary: Sentry = frontend, CloudWatch = Lambda,
  Langfuse = LLM). A CloudWatch alarm on DLQ depth mirrors the generation rig.
- A render/data failure for one user never blocks the batch (`batchSize: 1`,
  `reportBatchItemFailures: true`).

## 9. Testing (TDD)

Unit tests, added to the relevant package's existing test files:

- **Preferences state machine:** `off→pending→confirmed→off`; disable clears
  tokens; confirm with bad/expired token; double-confirm is idempotent.
- **Idempotency / dedup:** dispatcher skips users already in `sent_emails`;
  sender claim-row logic (conflict → skip vs. resume `pending`).
- **`period_key`:** ISO-week computation, year boundary.
- **Summary data assembly:** activity recap counts, grammar-mover/weak-spot
  selection, zero-activity → `skipped`.
- **Templates:** `WeeklySummaryEmail` / `ConfirmSubscriptionEmail` render
  snapshot (incl. unsubscribe URL present).
- **Routes:** confirm / unsubscribe / toggle handlers.

Plus the standard pre-push gate from the repo root: `pnpm lint`,
`pnpm typecheck`, `pnpm test` — zero failures before pushing.

## 10. Build order

1. `email_preferences` + `sent_emails` schema migration (Drizzle).
2. `packages/email`: Resend client + `renderEmail` + `ConfirmSubscriptionEmail`
   + `WeeklySummaryEmail` (plain props).
3. API routes: toggle + confirm + unsubscribe (+ preferences read); web
   settings "Email" section via `api-client`.
4. Dispatcher + sender Lambdas + CDK constructs (weekly schedule, SQS+DLQ,
   secret wiring for `RESEND_API_KEY`).
5. Wire summary data assembly (reuse progress queries / aggregation helpers).
6. Manual: Resend domain verification + Cloudflare DNS auth records.
