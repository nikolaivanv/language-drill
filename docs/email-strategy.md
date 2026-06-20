# Product Email — Strategy & Recommendation

> Status: **Proposed (not built).** Exploratory design captured 2026-06-20.
> No code, schema, or infra exists yet — this is the plan for when product
> email becomes a priority. Owner: see git blame.

## Scope

This covers **product email** only. Authentication email (signup verification,
magic links, password-less codes) is owned entirely by **Clerk** and is
explicitly out of scope — we do not send our own auth mail.

Product email splits into two genuinely different problems. Conflating them is
the usual mistake:

1. **Per-user transactional / scheduled** — e.g. the weekly progress summary.
   Dynamic per-user content, triggered by a schedule, one render per recipient.
2. **Broadcast** — e.g. curriculum updates, release notes. Same content to a
   segment, needs list/audience management and send-to-many.

Anticipated email kinds:

| Kind | Type | Cadence | Recipient set |
|---|---|---|---|
| Weekly progress summary | Per-user transactional | Weekly (cron) | All opted-in users |
| Curriculum updates | Broadcast | Ad hoc | Segment / all opted-in |
| Release notes | Broadcast | Ad hoc | All opted-in |

## Recommendation: Resend + React Email

For a solo, portfolio-quality project where we don't want to babysit
deliverability infrastructure, use **Resend** as the sending layer and
**React Email** for templates.

Why this fits *our* stack specifically:

- **React Email** lets us author templates as React components — the same
  mental model as the Next.js app, type-safe, previewable locally. Resend is
  built by the same team, so render → send is one SDK call.
- **Broadcasts + Audiences are built in.** Release notes and curriculum updates
  need a managed recipient list with per-recipient unsubscribe — Resend
  provides this out of the box. With raw SES we would build all of it ourselves
  (audience storage, suppression, unsubscribe token handling, the send loop).
- **Deliverability is mostly handled.** We add DKIM/SPF/DMARC records (DNS is
  already managed in Cloudflare, so a ~10-minute job) and Resend manages IP
  reputation / warmup. SES makes us own warmup and getting out of the sandbox.

## The AWS SES counter-argument (don't dismiss it)

Our project ethos is "all infra via CDK — no console click-ops," we are already
deep in AWS, and we have explicit AI cost brakes. That profile genuinely argues
for **AWS SES**:

- **Cost.** ~$0.10 per 1,000 emails vs Resend's free tier (3k/mo, then ~$20/mo).
  At current scale email is effectively free either way; SES only wins at volume
  we don't have yet.
- **CDK-native.** It slots directly into the existing **EventBridge Scheduler +
  SQS + Lambda** background-job rig — the weekly-summary job is the same shape as
  the generation jobs.
- **The cost of choosing it:** we hand-build suppression lists, unsubscribe,
  audience management, and template rendering (React Email still works — render
  to HTML in Lambda, hand to SES `SendEmail`).

**Decision:** Start with **Resend** for the broadcast DX and to ship fast.
Revisit SES only if email volume ever makes cost matter, or if the
everything-in-CDK purity becomes worth the build. The migration later is
contained because the cross-cutting pieces below are provider-agnostic.

## What matters regardless of provider

These are where email projects actually go wrong — build them first.

- **Preferences table in Neon.** Something like
  `email_preferences(user_id, weekly_summary bool, product_updates bool,
  release_notes bool, unsubscribe_token uuid)`. Every send checks it; every
  email links to a one-click unsubscribe that flips the bit. This is legally
  required (CAN-SPAM / GDPR) and Clerk does not provide it.
- **Reuse the existing scheduler for the weekly summary.** EventBridge Scheduler
  (cron) → Lambda that queries users + their progress → fans out per-user sends
  through SQS, so a render failure for one user doesn't kill the batch. This is
  the same pattern already used for generation jobs.
- **Idempotency.** Store a `sent_emails(user_id, kind, period_key)` row so a
  Lambda retry doesn't double-send the same weekly summary. The `period_key`
  (e.g. `2026-W25`) is the dedup key.
- **DNS auth records** (SPF / DKIM / DMARC) on `langdrill.app` in Cloudflare —
  without these, mail lands in spam regardless of provider. DNS-only / grey-cloud,
  consistent with the other records.
- **Observability boundary.** Email sends happen in Lambda, so failures land in
  **CloudWatch**, not Sentry — consistent with the existing observability
  boundary (Sentry = frontend; Lambda = CloudWatch; LLM = Langfuse). Don't expect
  email failures in the Sentry inbox.

## Rough build order (when prioritized)

1. `email_preferences` + `sent_emails` schema migration (Neon / Drizzle).
2. DNS auth records for the chosen provider.
3. React Email templates (start with the weekly summary).
4. Weekly-summary job: EventBridge Scheduler → Lambda → SQS fan-out → send,
   guarded by preferences + idempotency.
5. Unsubscribe endpoint (one-click, token-based, no auth required).
6. Broadcast path (Resend Broadcasts/Audiences, or a self-built SES send loop).
