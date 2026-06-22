# Weekly Summary Email Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the per-user weekly progress-summary email end-to-end (Resend + React Email), with double opt-in (off by default), one-click unsubscribe, idempotent scheduled sends, and an inactive-week skip.

**Architecture:** A new `@language-drill/email` package holds React Email templates (plain-prop components, **no** `@language-drill/db` import) + a Resend client wrapper. Two new CDK-deployed Lambdas mirror the generation rig but as independent resources: a weekly EventBridge→dispatcher Lambda that fans out per-user messages onto a dedicated SQS queue, and a sender Lambda that renders + sends one email per message. Double-opt-in toggle / confirm / unsubscribe are public+authed Hono routes on the existing API Lambda. Web settings get an "Email" section wired through `@language-drill/api-client`.

**Tech Stack:** TypeScript, Drizzle ORM (Neon Postgres), Resend SDK, React Email, Hono (AWS Lambda), AWS CDK (EventBridge Scheduler + SQS + Lambda), TanStack Query, Next.js (App Router), Vitest.

## Global Constraints

- Use the **latest stable** versions of `resend`, `react-email`, `@react-email/components` (no pinning without a documented reason). — from CLAUDE.md Package Management.
- **No streaks / XP / gamification** in any email copy or content. — CLAUDE.md Key Decisions.
- Migrations are **forward-only**. — CLAUDE.md CI/CD.
- Email failures land in **CloudWatch**, never Sentry (observability boundary). — email-strategy.md §Observability.
- Auth email is owned by **Clerk** — out of scope. Only product email here.
- Pre-push gate (run from repo root, zero failures): `pnpm lint`, `pnpm typecheck`, `pnpm test`. — CLAUDE.md Pre-Push Checks.
- `@language-drill/email` SOURCE must **not** import `@language-drill/db` (build-cycle class of problem; templates take plain props). — project memory `ai-db-build-cycle`.
- New API routes must be mounted in **both** `infra/lambda/src/index.ts` **and** `infra/lambda/src/dev.ts` (no auto-discovery). — local-dev convention.
- Do **not** apply this migration to the Neon `dev` branch locally — local `.env` points at `dev`, and per-PR CI forks inherit dev's schema, causing `relation already exists`. — project memory `dev-branch-ci-fork-pollution`.
- From address default: `Language Drill <summary@langdrill.app>`. Cron default: Monday 08:00 UTC.

---

## File Structure

**New package — `packages/email/`:**
- `package.json`, `tsconfig.json`, `vitest.config.ts` — scaffold (mirrors `packages/shared`).
- `src/index.ts` — barrel: re-exports client + templates + types.
- `src/client.ts` — `sendEmail()` Resend wrapper (local-log fallback when key unset).
- `src/templates/weekly-summary.tsx` — `WeeklySummaryEmail` component + `WeeklySummaryEmailProps`.
- `src/templates/confirm-subscription.tsx` — `ConfirmSubscriptionEmail` component + `ConfirmSubscriptionEmailProps`.
- `src/render.ts` — `renderEmail()` helper.
- `src/client.test.ts`, `src/templates/templates.test.ts` — unit tests.

**Schema — `packages/db/`:**
- `src/schema/email.ts` — `emailPreferences`, `sentEmails` tables + inferred types.
- `src/schema/index.ts` — add re-exports.
- `src/schema/email.test.ts` — column-shape assertions.
- `migrations/NNNN_*.sql` + `migrations/meta/*` — generated.

**Pure email logic — `infra/lambda/src/email/`:**
- `period-key.ts` + `period-key.test.ts` — ISO-week key + window computation.
- `summary-data.ts` + `summary-data.test.ts` — pure shaper (raw rows → template props).
- `gather.ts` — DB queries (thin; assembled props via `summary-data.ts`).
- `dispatcher.ts` + `dispatcher.test.ts` — EventBridge handler (enqueue per confirmed user).
- `sender.ts` + `sender.test.ts` — SQS handler (claim → gather → render → send → mark).
- `job-message.ts` — `WeeklySummaryJobMessage` type.

**API routes — `infra/lambda/src/`:**
- `routes/email.ts` + `routes/email.test.ts` — toggle / preferences / confirm / unsubscribe.
- `index.ts`, `dev.ts` — mount the router.

**API client — `packages/api-client/src/`:**
- `schemas/email.ts` — Zod types.
- `hooks/useEmailPreferences.ts`, `hooks/useUpdateWeeklySummary.ts`.
- `index.ts` — exports.

**Web — `apps/web/`:**
- `components/settings/email-section.tsx` — toggle + status.
- `app/(dashboard)/settings/page.tsx` — mount `EmailSection`.

**CDK — `infra/lib/`:**
- `constructs/email-queue.ts` — SQS + DLQ + alarm.
- `constructs/email-dispatcher-lambda.ts` — EventBridge schedule + dispatcher Lambda.
- `constructs/email-sender-lambda.ts` — SQS-consumer sender Lambda + alarms.
- `constructs/lambda.ts` — add `RESEND_API_KEY` + email link/app env to the API Lambda.
- `lib/stack.ts` — wire the three constructs + CfnOutput.
- `infra/test/*.test.ts` — CDK synth assertions.

**Docs:**
- `docs/runbooks/email-dns-setup.md` — manual Resend/Cloudflare DNS step.
- `.env.example`, `CLAUDE.md` — env + ops updates.

---

## Task 1: Schema — `email_preferences` + `sent_emails`

**Files:**
- Create: `packages/db/src/schema/email.ts`
- Create: `packages/db/src/schema/email.test.ts`
- Modify: `packages/db/src/schema/index.ts`
- Generated: `packages/db/migrations/` (drizzle-kit output)

**Interfaces:**
- Produces: `emailPreferences`, `sentEmails` (Drizzle pgTables); types `EmailPreferences`, `NewEmailPreferences`, `SentEmail`, `NewSentEmail`. Column accessors used downstream: `emailPreferences.userId`, `.weeklySummary` (`'off'|'pending'|'confirmed'`), `.unsubscribeToken`, `.confirmToken`, `.confirmSentAt`, `.confirmedAt`, `.updatedAt`; `sentEmails.userId`, `.kind`, `.periodKey`, `.status` (`'pending'|'sent'|'skipped'`), `.sentAt`.

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/schema/email.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { emailPreferences, sentEmails } from './email';

describe('email schema', () => {
  it('email_preferences has the expected columns', () => {
    const cfg = getTableConfig(emailPreferences);
    expect(cfg.name).toBe('email_preferences');
    const cols = cfg.columns.map((c) => c.name).sort();
    expect(cols).toEqual(
      [
        'user_id',
        'weekly_summary',
        'unsubscribe_token',
        'confirm_token',
        'confirm_sent_at',
        'confirmed_at',
        'created_at',
        'updated_at',
      ].sort(),
    );
  });

  it('sent_emails enforces a (user_id, kind, period_key) unique constraint', () => {
    const cfg = getTableConfig(sentEmails);
    expect(cfg.name).toBe('sent_emails');
    const uniqueCols = cfg.uniqueConstraints.flatMap((u) =>
      u.columns.map((c) => c.name),
    );
    expect(uniqueCols).toEqual(
      expect.arrayContaining(['user_id', 'kind', 'period_key']),
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/db exec vitest run src/schema/email.test.ts`
Expected: FAIL — `Cannot find module './email'`.

- [ ] **Step 3: Create the schema module**

Create `packages/db/src/schema/email.ts`:

```ts
import {
  pgTable,
  text,
  timestamp,
  uuid,
  serial,
  unique,
} from 'drizzle-orm/pg-core';
import type { InferInsertModel, InferSelectModel } from 'drizzle-orm';
import { users } from './users';

/**
 * Per-user product-email consent. One row per user that has ever toggled a
 * preference; an absent row is treated as fully opted-out at the API layer.
 * Double opt-in: weeklySummary moves off → pending (confirm email sent) →
 * confirmed (link clicked). FK is ON DELETE CASCADE so account deletion
 * sweeps preferences (right-to-erasure).
 */
export const emailPreferences = pgTable('email_preferences', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  weeklySummary: text('weekly_summary')
    .$type<'off' | 'pending' | 'confirmed'>()
    .notNull()
    .default('off'),
  // Stable per-user token embedded in every email's unsubscribe link + the
  // List-Unsubscribe header. Never rotates.
  unsubscribeToken: uuid('unsubscribe_token').notNull().unique().defaultRandom(),
  // Set when weeklySummary='pending'; cleared on confirm.
  confirmToken: uuid('confirm_token'),
  confirmSentAt: timestamp('confirm_sent_at', { withTimezone: true }),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Idempotency ledger. The (user_id, kind, period_key) unique constraint is the
 * dedup backstop so a Lambda retry never double-sends the same weekly summary.
 * status: 'pending' = claimed but not yet sent; 'sent' = delivered to Resend;
 * 'skipped' = no activity that period, intentionally not sent.
 */
export const sentEmails = pgTable(
  'sent_emails',
  {
    id: serial('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(), // 'weekly_summary'
    periodKey: text('period_key').notNull(), // ISO week, e.g. '2026-W25'
    status: text('status')
      .$type<'pending' | 'sent' | 'skipped'>()
      .notNull(),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueSend: unique('uq_sent_emails_user_kind_period').on(
      table.userId,
      table.kind,
      table.periodKey,
    ),
  }),
);

export type EmailPreferences = InferSelectModel<typeof emailPreferences>;
export type NewEmailPreferences = InferInsertModel<typeof emailPreferences>;
export type SentEmail = InferSelectModel<typeof sentEmails>;
export type NewSentEmail = InferInsertModel<typeof sentEmails>;
```

- [ ] **Step 4: Add re-exports**

In `packages/db/src/schema/index.ts`, after the `exerciseFlags` exports (around line 63), add:

```ts
export { emailPreferences, sentEmails } from './email';
export type {
  EmailPreferences,
  NewEmailPreferences,
  SentEmail,
  NewSentEmail,
} from './email';
```

- [ ] **Step 5: Build db + run the test to verify it passes**

Run: `pnpm --filter @language-drill/db build && pnpm --filter @language-drill/db exec vitest run src/schema/email.test.ts`
Expected: PASS (2 tests). (Build first — sibling packages resolve `db/dist`; see project memory `vitest-workspace-dist-resolution`.)

- [ ] **Step 6: Generate the migration**

Run: `pnpm --filter @language-drill/db exec drizzle-kit generate`
Expected: a new `packages/db/migrations/NNNN_*.sql` containing `CREATE TABLE "email_preferences"` and `CREATE TABLE "sent_emails"`, plus updated `migrations/meta/`. Open the `.sql` and confirm both tables, the unique constraint `uq_sent_emails_user_kind_period`, and the FKs are present. **Do not run `db:migrate` against the dev branch** (Global Constraints).

- [ ] **Step 7: Commit**

```bash
git add packages/db/src/schema/email.ts packages/db/src/schema/email.test.ts \
  packages/db/src/schema/index.ts packages/db/migrations
git commit -m "feat(db): email_preferences + sent_emails schema"
```

---

## Task 2: `@language-drill/email` package + Resend client

**Files:**
- Create: `packages/email/package.json`
- Create: `packages/email/tsconfig.json`
- Create: `packages/email/vitest.config.ts`
- Create: `packages/email/src/client.ts`
- Create: `packages/email/src/client.test.ts`
- Create: `packages/email/src/index.ts`

**Interfaces:**
- Produces: `sendEmail(args: SendEmailArgs): Promise<{ id: string | null; delivered: boolean }>` where
  `SendEmailArgs = { to: string; subject: string; html: string; text: string; from?: string; headers?: Record<string, string> }`.
  When `RESEND_API_KEY` is unset, logs and returns `{ id: null, delivered: false }` (local-dev). Default `from` = `'Language Drill <summary@langdrill.app>'` (overridable via `EMAIL_FROM`).

- [ ] **Step 1: Scaffold the package files**

Create `packages/email/package.json`:

```json
{
  "name": "@language-drill/email",
  "version": "0.0.1",
  "private": true,
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "lint": "eslint src/**/*.ts src/**/*.tsx",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "email:preview": "email dev --dir src/templates"
  },
  "dependencies": {
    "@react-email/components": "latest",
    "react": "^18.3.1",
    "react-email": "latest",
    "resend": "latest"
  },
  "devDependencies": {
    "@types/react": "^18.3.0",
    "typescript": "^5.0.0",
    "vitest": "^4.1.5"
  }
}
```

Create `packages/email/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": "./src",
    "jsx": "react-jsx",
    "lib": ["ES2022", "DOM"]
  },
  "include": ["src"],
  "exclude": ["**/*.test.ts", "**/*.test.tsx"]
}
```

Create `packages/email/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
  },
});
```

- [ ] **Step 2: Install dependencies**

Run (from repo root): `pnpm install`
Expected: `@language-drill/email` linked into the workspace; `resend`, `react-email`, `@react-email/components`, `react` resolved. Confirm the resolved versions are recent (Package Management constraint).

- [ ] **Step 3: Write the failing test**

Create `packages/email/src/client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sendMock = vi.fn();
vi.mock('resend', () => ({
  Resend: vi.fn(() => ({ emails: { send: sendMock } })),
}));

describe('sendEmail', () => {
  const OLD_ENV = process.env;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env = { ...OLD_ENV };
  });
  afterEach(() => {
    process.env = OLD_ENV;
  });

  it('logs and does NOT call Resend when RESEND_API_KEY is unset', async () => {
    delete process.env.RESEND_API_KEY;
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const { sendEmail } = await import('./client');
    const res = await sendEmail({
      to: 'a@b.com',
      subject: 'hi',
      html: '<p>hi</p>',
      text: 'hi',
    });
    expect(sendMock).not.toHaveBeenCalled();
    expect(res).toEqual({ id: null, delivered: false });
    expect(logSpy).toHaveBeenCalled();
  });

  it('calls Resend with the default from + headers when the key is set', async () => {
    process.env.RESEND_API_KEY = 'test_key';
    sendMock.mockResolvedValue({ data: { id: 'eml_1' }, error: null });
    const { sendEmail } = await import('./client');
    const res = await sendEmail({
      to: 'a@b.com',
      subject: 'hi',
      html: '<p>hi</p>',
      text: 'hi',
      headers: { 'List-Unsubscribe': '<https://x/u>' },
    });
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Language Drill <summary@langdrill.app>',
        to: 'a@b.com',
        subject: 'hi',
        headers: { 'List-Unsubscribe': '<https://x/u>' },
      }),
    );
    expect(res).toEqual({ id: 'eml_1', delivered: true });
  });

  it('throws when Resend returns an error', async () => {
    process.env.RESEND_API_KEY = 'test_key';
    sendMock.mockResolvedValue({ data: null, error: { message: 'boom' } });
    const { sendEmail } = await import('./client');
    await expect(
      sendEmail({ to: 'a@b.com', subject: 'h', html: 'h', text: 'h' }),
    ).rejects.toThrow('boom');
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/email exec vitest run src/client.test.ts`
Expected: FAIL — `Cannot find module './client'`.

- [ ] **Step 5: Implement the client**

Create `packages/email/src/client.ts`:

```ts
import { Resend } from 'resend';

export interface SendEmailArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: string;
  headers?: Record<string, string>;
}

export interface SendEmailResult {
  id: string | null;
  delivered: boolean;
}

const DEFAULT_FROM = 'Language Drill <summary@langdrill.app>';

/**
 * Send one email through Resend. When RESEND_API_KEY is unset (local dev) the
 * rendered HTML is logged instead of sent, so the whole pipeline is runnable
 * without a Resend account. Throws on a Resend-reported error so the caller
 * (sender Lambda) leaves the SQS message un-ACKed and SQS retries.
 */
export async function sendEmail(args: SendEmailArgs): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = args.from ?? process.env.EMAIL_FROM ?? DEFAULT_FROM;

  if (!apiKey) {
    console.log(
      JSON.stringify({
        level: 'info',
        message: 'RESEND_API_KEY unset — email not sent (local dev)',
        to: args.to,
        subject: args.subject,
        htmlPreview: args.html.slice(0, 200),
      }),
    );
    return { id: null, delivered: false };
  }

  const resend = new Resend(apiKey);
  const { data, error } = await resend.emails.send({
    from,
    to: args.to,
    subject: args.subject,
    html: args.html,
    text: args.text,
    headers: args.headers,
  });

  if (error) {
    throw new Error(error.message);
  }
  return { id: data?.id ?? null, delivered: true };
}
```

Create `packages/email/src/index.ts`:

```ts
export { sendEmail } from './client';
export type { SendEmailArgs, SendEmailResult } from './client';
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/email exec vitest run src/client.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/email pnpm-lock.yaml package.json
git commit -m "feat(email): @language-drill/email package + Resend client wrapper"
```

---

## Task 3: React Email templates + render helper

**Files:**
- Create: `packages/email/src/render.ts`
- Create: `packages/email/src/templates/confirm-subscription.tsx`
- Create: `packages/email/src/templates/weekly-summary.tsx`
- Create: `packages/email/src/templates/templates.test.ts`
- Modify: `packages/email/src/index.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `renderEmail(node: React.ReactElement): Promise<{ html: string; text: string }>`.
  - `ConfirmSubscriptionEmail(props: ConfirmSubscriptionEmailProps)` where `ConfirmSubscriptionEmailProps = { confirmUrl: string }`.
  - `WeeklySummaryEmail(props: WeeklySummaryEmailProps)` where
    `WeeklySummaryEmailProps = { exercisesCompleted: number; languagesPracticed: string[]; daysActive: number; movers: string[]; focus: string[]; practiceUrl: string; unsubscribeUrl: string }`.

- [ ] **Step 1: Write the failing test**

Create `packages/email/src/templates/templates.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { renderEmail } from '../render';
import { ConfirmSubscriptionEmail } from './confirm-subscription';
import { WeeklySummaryEmail } from './weekly-summary';

describe('email templates', () => {
  it('confirm email contains the confirm URL', async () => {
    const { html, text } = await renderEmail(
      ConfirmSubscriptionEmail({ confirmUrl: 'https://api.x/email/confirm?token=abc' }),
    );
    expect(html).toContain('https://api.x/email/confirm?token=abc');
    expect(text).toContain('https://api.x/email/confirm?token=abc');
  });

  it('weekly summary renders counts, movers, focus, CTA and unsubscribe link', async () => {
    const { html } = await renderEmail(
      WeeklySummaryEmail({
        exercisesCompleted: 42,
        languagesPracticed: ['Spanish', 'Turkish'],
        daysActive: 5,
        movers: ['Ser vs estar'],
        focus: ['Subjunctive mood', 'Past tense'],
        practiceUrl: 'https://langdrill.app',
        unsubscribeUrl: 'https://api.x/email/unsubscribe?token=u',
      }),
    );
    expect(html).toContain('42');
    expect(html).toContain('Ser vs estar');
    expect(html).toContain('Subjunctive mood');
    expect(html).toContain('https://langdrill.app');
    expect(html).toContain('https://api.x/email/unsubscribe?token=u');
    // No-gamification guard: copy must not introduce streak/XP language.
    expect(html.toLowerCase()).not.toContain('streak');
    expect(html.toLowerCase()).not.toContain(' xp');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/email exec vitest run src/templates/templates.test.ts`
Expected: FAIL — `Cannot find module '../render'`.

- [ ] **Step 3: Implement the render helper**

Create `packages/email/src/render.ts`:

```ts
import type { ReactElement } from 'react';
import { render } from '@react-email/components';

/**
 * Render a React Email element to both an HTML body and a plain-text fallback.
 * Both parts are handed to Resend so clients that block HTML still get content.
 */
export async function renderEmail(
  node: ReactElement,
): Promise<{ html: string; text: string }> {
  const html = await render(node);
  const text = await render(node, { plainText: true });
  return { html, text };
}
```

- [ ] **Step 4: Implement the confirm template**

Create `packages/email/src/templates/confirm-subscription.tsx`:

```tsx
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Html,
  Link,
  Preview,
  Text,
} from '@react-email/components';

export interface ConfirmSubscriptionEmailProps {
  confirmUrl: string;
}

export function ConfirmSubscriptionEmail({
  confirmUrl,
}: ConfirmSubscriptionEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Confirm your weekly Language Drill summary</Preview>
      <Body style={{ backgroundColor: '#f6f6f6', fontFamily: 'sans-serif' }}>
        <Container style={{ padding: '24px', maxWidth: '480px' }}>
          <Heading as="h1" style={{ fontSize: '20px' }}>
            Confirm your weekly summary
          </Heading>
          <Text>
            You asked to receive a weekly progress summary from Language Drill.
            Confirm below to start receiving it. If this wasn&apos;t you, just
            ignore this email — nothing will be sent.
          </Text>
          <Button
            href={confirmUrl}
            style={{
              backgroundColor: '#111827',
              color: '#ffffff',
              padding: '12px 20px',
              borderRadius: '8px',
              textDecoration: 'none',
              display: 'inline-block',
            }}
          >
            Confirm subscription
          </Button>
          <Text style={{ fontSize: '12px', color: '#6b7280' }}>
            Or paste this link into your browser:{' '}
            <Link href={confirmUrl}>{confirmUrl}</Link>
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default ConfirmSubscriptionEmail;
```

- [ ] **Step 5: Implement the weekly-summary template**

Create `packages/email/src/templates/weekly-summary.tsx`:

```tsx
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Link,
  Preview,
  Section,
  Text,
} from '@react-email/components';

export interface WeeklySummaryEmailProps {
  exercisesCompleted: number;
  languagesPracticed: string[];
  daysActive: number;
  /** Grammar points that went well this week. */
  movers: string[];
  /** Weak spots to focus on next week. */
  focus: string[];
  practiceUrl: string;
  unsubscribeUrl: string;
}

export function WeeklySummaryEmail({
  exercisesCompleted,
  languagesPracticed,
  daysActive,
  movers,
  focus,
  practiceUrl,
  unsubscribeUrl,
}: WeeklySummaryEmailProps) {
  return (
    <Html>
      <Head />
      <Preview>Your week in Language Drill</Preview>
      <Body style={{ backgroundColor: '#f6f6f6', fontFamily: 'sans-serif' }}>
        <Container style={{ padding: '24px', maxWidth: '480px' }}>
          <Heading as="h1" style={{ fontSize: '20px' }}>
            Your week in Language Drill
          </Heading>

          <Section>
            <Text style={{ margin: '4px 0' }}>
              <strong>{exercisesCompleted}</strong> exercises completed
            </Text>
            <Text style={{ margin: '4px 0' }}>
              Active on <strong>{daysActive}</strong>{' '}
              {daysActive === 1 ? 'day' : 'days'}
            </Text>
            <Text style={{ margin: '4px 0' }}>
              Practiced: {languagesPracticed.join(', ')}
            </Text>
          </Section>

          {movers.length > 0 && (
            <Section>
              <Hr />
              <Heading as="h2" style={{ fontSize: '16px' }}>
                Going well
              </Heading>
              {movers.map((m) => (
                <Text key={m} style={{ margin: '2px 0' }}>
                  • {m}
                </Text>
              ))}
            </Section>
          )}

          {focus.length > 0 && (
            <Section>
              <Hr />
              <Heading as="h2" style={{ fontSize: '16px' }}>
                Worth a look next week
              </Heading>
              {focus.map((f) => (
                <Text key={f} style={{ margin: '2px 0' }}>
                  • {f}
                </Text>
              ))}
            </Section>
          )}

          <Section style={{ marginTop: '20px' }}>
            <Button
              href={practiceUrl}
              style={{
                backgroundColor: '#111827',
                color: '#ffffff',
                padding: '12px 20px',
                borderRadius: '8px',
                textDecoration: 'none',
                display: 'inline-block',
              }}
            >
              Practice now
            </Button>
          </Section>

          <Hr />
          <Text style={{ fontSize: '12px', color: '#6b7280' }}>
            You&apos;re receiving this because you confirmed the weekly summary.{' '}
            <Link href={unsubscribeUrl}>Unsubscribe</Link>.
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default WeeklySummaryEmail;
```

- [ ] **Step 6: Export templates from the barrel**

Replace `packages/email/src/index.ts` with:

```ts
export { sendEmail } from './client';
export type { SendEmailArgs, SendEmailResult } from './client';
export { renderEmail } from './render';
export {
  WeeklySummaryEmail,
  type WeeklySummaryEmailProps,
} from './templates/weekly-summary';
export {
  ConfirmSubscriptionEmail,
  type ConfirmSubscriptionEmailProps,
} from './templates/confirm-subscription';
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/email exec vitest run src/templates/templates.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 8: Typecheck + build the package**

Run: `pnpm --filter @language-drill/email typecheck && pnpm --filter @language-drill/email build`
Expected: no errors; `dist/` produced.

- [ ] **Step 9: Commit**

```bash
git add packages/email/src
git commit -m "feat(email): weekly-summary + confirm React Email templates"
```

---

## Task 4: Pure helpers — period key + summary shaper

**Files:**
- Create: `infra/lambda/src/email/period-key.ts`
- Create: `infra/lambda/src/email/period-key.test.ts`
- Create: `infra/lambda/src/email/summary-data.ts`
- Create: `infra/lambda/src/email/summary-data.test.ts`

**Interfaces:**
- Produces:
  - `isoWeekKey(date: Date): string` → e.g. `'2026-W25'`.
  - `weeklyWindow(now: Date): { start: Date; end: Date; periodKey: string }` — `end = now`, `start = now - 7d`, `periodKey = isoWeekKey(start)`.
  - `buildWeeklySummaryData(input: SummaryInput): SummaryData` where
    `SummaryInput = { historyRows: HistoryRow[]; masteryRows: MasteryRow[]; labelFor: (key: string) => string; languageNameFor: (code: string) => string }`,
    `HistoryRow = { grammarPointKey: string | null; language: string; score: number | null; evaluatedAt: Date }`,
    `MasteryRow = { grammarPointKey: string; score: number }`,
    `SummaryData = { hasActivity: boolean; exercisesCompleted: number; languagesPracticed: string[]; daysActive: number; movers: string[]; focus: string[] }`.

- [ ] **Step 1: Write the failing period-key test**

Create `infra/lambda/src/email/period-key.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { isoWeekKey, weeklyWindow } from './period-key';

describe('isoWeekKey', () => {
  it('formats an ISO week as YYYY-Www', () => {
    // 2026-06-15 is a Monday in ISO week 25 of 2026.
    expect(isoWeekKey(new Date('2026-06-15T08:00:00Z'))).toBe('2026-W25');
  });

  it('zero-pads single-digit weeks', () => {
    expect(isoWeekKey(new Date('2026-01-05T00:00:00Z'))).toBe('2026-W02');
  });

  it('assigns the ISO year correctly across a year boundary', () => {
    // 2027-01-01 is a Friday; ISO week 53 belongs to 2026.
    expect(isoWeekKey(new Date('2027-01-01T00:00:00Z'))).toBe('2026-W53');
  });
});

describe('weeklyWindow', () => {
  it('spans the 7 days before now and keys on the window start', () => {
    const now = new Date('2026-06-22T08:00:00Z');
    const w = weeklyWindow(now);
    expect(w.end).toEqual(now);
    expect(w.start).toEqual(new Date('2026-06-15T08:00:00Z'));
    expect(w.periodKey).toBe('2026-W25');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @language-drill/lambda exec vitest run src/email/period-key.test.ts`
Expected: FAIL — `Cannot find module './period-key'`.

- [ ] **Step 3: Implement period-key**

Create `infra/lambda/src/email/period-key.ts`:

```ts
const MS_PER_DAY = 86_400_000;

/**
 * ISO-8601 week key, e.g. '2026-W25'. Uses the standard "nearest Thursday"
 * algorithm so the week's year matches the ISO year across boundaries.
 */
export function isoWeekKey(date: Date): string {
  // Work in UTC. Copy so we don't mutate the input.
  const d = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
  // ISO weekday: Mon=1 … Sun=7.
  const dayNum = d.getUTCDay() === 0 ? 7 : d.getUTCDay();
  // Shift to the Thursday of this week.
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const isoYear = d.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / MS_PER_DAY + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, '0')}`;
}

/**
 * The 7-day window the summary covers: [now-7d, now), keyed by the ISO week of
 * the window start (the just-completed week when run on a Monday).
 */
export function weeklyWindow(now: Date): { start: Date; end: Date; periodKey: string } {
  const start = new Date(now.getTime() - 7 * MS_PER_DAY);
  return { start, end: now, periodKey: isoWeekKey(start) };
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @language-drill/lambda exec vitest run src/email/period-key.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing summary-shaper test**

Create `infra/lambda/src/email/summary-data.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildWeeklySummaryData } from './summary-data';

const labelFor = (k: string) => ({ 'es-ser-estar': 'Ser vs estar', 'es-subj': 'Subjunctive mood', 'tr-past': 'Past tense' }[k] ?? k);
const languageNameFor = (c: string) => ({ ES: 'Spanish', TR: 'Turkish' }[c] ?? c);

describe('buildWeeklySummaryData', () => {
  it('flags no activity when there are no history rows', () => {
    const data = buildWeeklySummaryData({
      historyRows: [],
      masteryRows: [{ grammarPointKey: 'es-subj', score: 0.2 }],
      labelFor,
      languageNameFor,
    });
    expect(data.hasActivity).toBe(false);
    expect(data.exercisesCompleted).toBe(0);
  });

  it('counts exercises, distinct languages and active days', () => {
    const data = buildWeeklySummaryData({
      historyRows: [
        { grammarPointKey: 'es-ser-estar', language: 'ES', score: 0.9, evaluatedAt: new Date('2026-06-16T10:00:00Z') },
        { grammarPointKey: 'es-ser-estar', language: 'ES', score: 0.8, evaluatedAt: new Date('2026-06-16T18:00:00Z') },
        { grammarPointKey: 'tr-past', language: 'TR', score: 0.3, evaluatedAt: new Date('2026-06-17T09:00:00Z') },
      ],
      masteryRows: [],
      labelFor,
      languageNameFor,
    });
    expect(data.hasActivity).toBe(true);
    expect(data.exercisesCompleted).toBe(3);
    expect(data.languagesPracticed).toEqual(['Spanish', 'Turkish']);
    expect(data.daysActive).toBe(2); // 06-16 and 06-17
  });

  it('picks movers as top-scoring practiced points and focus as lowest-mastery points', () => {
    const data = buildWeeklySummaryData({
      historyRows: [
        { grammarPointKey: 'es-ser-estar', language: 'ES', score: 0.95, evaluatedAt: new Date('2026-06-16T10:00:00Z') },
      ],
      masteryRows: [
        { grammarPointKey: 'es-subj', score: 0.15 },
        { grammarPointKey: 'tr-past', score: 0.35 },
      ],
      labelFor,
      languageNameFor,
    });
    expect(data.movers).toContain('Ser vs estar');
    expect(data.focus[0]).toBe('Subjunctive mood'); // lowest mastery first
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `pnpm --filter @language-drill/lambda exec vitest run src/email/summary-data.test.ts`
Expected: FAIL — `Cannot find module './summary-data'`.

- [ ] **Step 7: Implement the shaper**

Create `infra/lambda/src/email/summary-data.ts`:

```ts
export interface HistoryRow {
  grammarPointKey: string | null;
  language: string;
  score: number | null;
  evaluatedAt: Date;
}

export interface MasteryRow {
  grammarPointKey: string;
  score: number;
}

export interface SummaryInput {
  historyRows: HistoryRow[];
  masteryRows: MasteryRow[];
  labelFor: (grammarPointKey: string) => string;
  languageNameFor: (code: string) => string;
}

export interface SummaryData {
  hasActivity: boolean;
  exercisesCompleted: number;
  languagesPracticed: string[];
  daysActive: number;
  movers: string[];
  focus: string[];
}

const MOVERS_MIN_SCORE = 0.8;
const MAX_MOVERS = 3;
const MAX_FOCUS = 3;

function utcDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Pure: shape raw history + mastery rows into the weekly-summary template
 * props. "Movers" = grammar points the user scored well on this week
 * (best average first). "Focus" = the user's lowest-mastery grammar points
 * (weakest first). Both are de-duplicated by label.
 */
export function buildWeeklySummaryData(input: SummaryInput): SummaryData {
  const { historyRows, masteryRows, labelFor, languageNameFor } = input;

  const exercisesCompleted = historyRows.length;
  const hasActivity = exercisesCompleted > 0;

  const languages = new Set<string>();
  const days = new Set<string>();
  // grammarPointKey -> { sum, n }
  const byPoint = new Map<string, { sum: number; n: number }>();

  for (const row of historyRows) {
    languages.add(row.language);
    days.add(utcDay(row.evaluatedAt));
    if (row.grammarPointKey && row.score !== null) {
      const acc = byPoint.get(row.grammarPointKey) ?? { sum: 0, n: 0 };
      acc.sum += row.score;
      acc.n += 1;
      byPoint.set(row.grammarPointKey, acc);
    }
  }

  const movers = [...byPoint.entries()]
    .map(([key, { sum, n }]) => ({ key, avg: sum / n }))
    .filter((p) => p.avg >= MOVERS_MIN_SCORE)
    .sort((a, b) => b.avg - a.avg)
    .slice(0, MAX_MOVERS)
    .map((p) => labelFor(p.key));

  const focus = [...masteryRows]
    .sort((a, b) => a.score - b.score)
    .slice(0, MAX_FOCUS)
    .map((m) => labelFor(m.grammarPointKey));

  return {
    hasActivity,
    exercisesCompleted,
    languagesPracticed: [...languages].map(languageNameFor),
    daysActive: days.size,
    movers,
    focus,
  };
}
```

- [ ] **Step 8: Run it to verify it passes**

Run: `pnpm --filter @language-drill/lambda exec vitest run src/email/summary-data.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 9: Commit**

```bash
git add infra/lambda/src/email/period-key.ts infra/lambda/src/email/period-key.test.ts \
  infra/lambda/src/email/summary-data.ts infra/lambda/src/email/summary-data.test.ts
git commit -m "feat(email): pure ISO-week key + weekly-summary data shaper"
```

---

## Task 5: API routes — toggle / preferences / confirm / unsubscribe

**Files:**
- Create: `infra/lambda/src/routes/email.ts`
- Create: `infra/lambda/src/routes/email.test.ts`
- Modify: `infra/lambda/src/index.ts`
- Modify: `infra/lambda/src/dev.ts`

**Interfaces:**
- Consumes: `emailPreferences` from `@language-drill/db`; `sendEmail`, `renderEmail`, `ConfirmSubscriptionEmail` from `@language-drill/email`; `authMiddleware`, `Bindings`, `Variables` from `../middleware/auth`; `db` from `../db`.
- Produces: a default-exported Hono router mounting:
  - `GET /me/email-preferences` (authed) → `{ weeklySummary: 'off'|'pending'|'confirmed' }`.
  - `POST /email/weekly-summary` (authed) → body `{ enabled: boolean }` → `{ weeklySummary }`.
  - `GET /email/confirm?token=…` (public) → HTML page.
  - `GET /email/unsubscribe?token=…` (public) + `POST /email/unsubscribe?token=…` (public) → HTML page / 200.
- Env consumed: `EMAIL_LINK_BASE_URL` (confirm/unsubscribe links, defaults `http://localhost:3001`).

- [ ] **Step 1: Write the failing test**

Create `infra/lambda/src/routes/email.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// --- db mock: a chainable builder whose terminal calls we control per test ---
const state: Record<string, any> = {};
vi.mock('../db', () => {
  const chain = () => {
    const c: any = {};
    c.from = () => c;
    c.where = () => c;
    c.limit = () => Promise.resolve(state.selectRows ?? []);
    c.values = () => c;
    c.onConflictDoUpdate = () => ({ returning: () => Promise.resolve(state.upsertRows ?? []) });
    c.set = () => c;
    c.returning = () => Promise.resolve(state.updateRows ?? []);
    return c;
  };
  return {
    db: {
      select: () => chain(),
      insert: () => chain(),
      update: () => chain(),
    },
  };
});

vi.mock('@language-drill/db', () => ({
  emailPreferences: {
    userId: 'user_id',
    weeklySummary: 'weekly_summary',
    unsubscribeToken: 'unsubscribe_token',
    confirmToken: 'confirm_token',
  },
  users: { id: 'id' },
}));

const sendEmailMock = vi.fn(async () => ({ id: 'eml', delivered: true }));
vi.mock('@language-drill/email', () => ({
  sendEmail: sendEmailMock,
  renderEmail: vi.fn(async () => ({ html: '<p>confirm</p>', text: 'confirm' })),
  ConfirmSubscriptionEmail: vi.fn(() => null),
}));

const authEnv = {
  event: { requestContext: { authorizer: { jwt: { claims: { sub: 'user_1' } } } } },
};

describe('email routes', () => {
  let app: Hono;
  beforeEach(async () => {
    vi.clearAllMocks();
    for (const k of Object.keys(state)) delete state[k];
    const mod = await import('./email');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('GET /me/email-preferences returns off when no row exists', async () => {
    state.selectRows = [];
    const res = await app.request('/me/email-preferences', undefined, authEnv);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ weeklySummary: 'off' });
  });

  it('POST /email/weekly-summary { enabled: true } sets pending and sends a confirm email', async () => {
    state.upsertRows = [{ weeklySummary: 'pending', confirmToken: 'tok' }];
    const res = await app.request(
      '/email/weekly-summary',
      { method: 'POST', body: JSON.stringify({ enabled: true }), headers: { 'Content-Type': 'application/json' } },
      authEnv,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ weeklySummary: 'pending' });
    expect(sendEmailMock).toHaveBeenCalledOnce();
  });

  it('POST /email/weekly-summary { enabled: false } sets off without sending', async () => {
    state.upsertRows = [{ weeklySummary: 'off', confirmToken: null }];
    const res = await app.request(
      '/email/weekly-summary',
      { method: 'POST', body: JSON.stringify({ enabled: false }), headers: { 'Content-Type': 'application/json' } },
      authEnv,
    );
    expect(await res.json()).toEqual({ weeklySummary: 'off' });
    expect(sendEmailMock).not.toHaveBeenCalled();
  });

  it('GET /email/confirm flips pending→confirmed and returns HTML', async () => {
    state.updateRows = [{ userId: 'user_1' }];
    const res = await app.request('/email/confirm?token=abc');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('GET /email/confirm with an unknown token returns a friendly 200 HTML page', async () => {
    state.updateRows = [];
    const res = await app.request('/email/confirm?token=nope');
    expect(res.status).toBe(200);
  });

  it('GET /email/unsubscribe sets off and returns HTML', async () => {
    state.updateRows = [{ userId: 'user_1' }];
    const res = await app.request('/email/unsubscribe?token=u');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');
  });

  it('POST /email/unsubscribe (one-click) returns 200', async () => {
    state.updateRows = [{ userId: 'user_1' }];
    const res = await app.request('/email/unsubscribe?token=u', { method: 'POST' });
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @language-drill/lambda exec vitest run src/routes/email.test.ts`
Expected: FAIL — `Cannot find module './email'`.

- [ ] **Step 3: Implement the router**

Create `infra/lambda/src/routes/email.ts`:

```ts
import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { emailPreferences, users } from '@language-drill/db';
import {
  sendEmail,
  renderEmail,
  ConfirmSubscriptionEmail,
} from '@language-drill/email';
import { db } from '../db';
import { authMiddleware } from '../middleware/auth';
import type { Bindings, Variables } from '../middleware/auth';

const email = new Hono<{ Bindings: Bindings; Variables: Variables }>();

email.use('/me/email-preferences', authMiddleware);
email.use('/email/weekly-summary', authMiddleware);

const linkBase = (): string =>
  process.env.EMAIL_LINK_BASE_URL ?? 'http://localhost:3001';

function htmlPage(title: string, body: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="font-family:sans-serif;max-width:480px;margin:64px auto;padding:0 16px;text-align:center"><h1 style="font-size:20px">${title}</h1><p style="color:#374151">${body}</p></body></html>`;
}

// --- GET /me/email-preferences -------------------------------------------
email.get('/me/email-preferences', async (c) => {
  const userId = c.get('userId');
  const rows = await db
    .select({ weeklySummary: emailPreferences.weeklySummary })
    .from(emailPreferences)
    .where(eq(emailPreferences.userId, userId))
    .limit(1);
  return c.json({ weeklySummary: rows[0]?.weeklySummary ?? 'off' });
});

// --- POST /email/weekly-summary ------------------------------------------
const ToggleSchema = z.object({ enabled: z.boolean() });

email.post('/email/weekly-summary', async (c) => {
  const userId = c.get('userId');
  const parsed = ToggleSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) {
    return c.json({ error: 'Invalid body', code: 'VALIDATION_ERROR' }, 400);
  }

  if (!parsed.data.enabled) {
    const rows = await db
      .insert(emailPreferences)
      .values({ userId, weeklySummary: 'off' })
      .onConflictDoUpdate({
        target: emailPreferences.userId,
        set: { weeklySummary: 'off', confirmToken: null, updatedAt: new Date() },
      })
      .returning({ weeklySummary: emailPreferences.weeklySummary });
    return c.json({ weeklySummary: rows[0]?.weeklySummary ?? 'off' });
  }

  // Enable → pending + fresh confirm token. crypto.randomUUID is available in
  // the Node 22 Lambda runtime.
  const confirmToken = crypto.randomUUID();
  const rows = await db
    .insert(emailPreferences)
    .values({ userId, weeklySummary: 'pending', confirmToken, confirmSentAt: new Date() })
    .onConflictDoUpdate({
      target: emailPreferences.userId,
      set: {
        weeklySummary: 'pending',
        confirmToken,
        confirmSentAt: new Date(),
        updatedAt: new Date(),
      },
    })
    .returning({
      weeklySummary: emailPreferences.weeklySummary,
      confirmToken: emailPreferences.confirmToken,
    });

  const token = rows[0]?.confirmToken ?? confirmToken;
  const confirmUrl = `${linkBase()}/email/confirm?token=${token}`;
  const { html, text } = await renderEmail(ConfirmSubscriptionEmail({ confirmUrl }));
  // Recipient must be the user's real address (the auth middleware guarantees a
  // users row exists).
  await sendEmail({
    to: await resolveEmail(userId),
    subject: 'Confirm your weekly Language Drill summary',
    html,
    text,
  });

  return c.json({ weeklySummary: rows[0]?.weeklySummary ?? 'pending' });
});

// --- GET /email/confirm (public) -----------------------------------------
email.get('/email/confirm', async (c) => {
  const token = c.req.query('token');
  if (!token) return c.html(htmlPage('Invalid link', 'This confirmation link is missing its token.'), 200);
  const rows = await db
    .update(emailPreferences)
    .set({ weeklySummary: 'confirmed', confirmedAt: new Date(), confirmToken: null, updatedAt: new Date() })
    .where(eq(emailPreferences.confirmToken, token))
    .returning({ userId: emailPreferences.userId });
  if (rows.length === 0) {
    return c.html(htmlPage('Already confirmed', 'This link has already been used, or it has expired. Nothing else to do.'), 200);
  }
  return c.html(htmlPage('You’re subscribed', 'Your weekly summary is on. You can unsubscribe anytime from any email.'), 200);
});

// --- unsubscribe (public; GET for click, POST for RFC 8058 one-click) -----
async function doUnsubscribe(token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const rows = await db
    .update(emailPreferences)
    .set({ weeklySummary: 'off', confirmToken: null, updatedAt: new Date() })
    .where(eq(emailPreferences.unsubscribeToken, token))
    .returning({ userId: emailPreferences.userId });
  return rows.length > 0;
}

email.get('/email/unsubscribe', async (c) => {
  await doUnsubscribe(c.req.query('token'));
  return c.html(htmlPage('Unsubscribed', 'You won’t receive the weekly summary anymore. You can turn it back on in settings.'), 200);
});

email.post('/email/unsubscribe', async (c) => {
  await doUnsubscribe(c.req.query('token'));
  return c.body(null, 200);
});

// Resolve a user's email for the confirmation recipient.
async function resolveEmail(userId: string): Promise<string> {
  const rows = await db
    .select({ email: users.email })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return rows[0]?.email ?? '';
}

export default email;
```

- [ ] **Step 4: Run it to verify it passes**

Run: `pnpm --filter @language-drill/lambda exec vitest run src/routes/email.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Mount the router in production + dev**

In `infra/lambda/src/index.ts`: add `import email from './routes/email';` with the other route imports (after line 22), and `app.route('/', email);` with the other mounts (after line 89).

In `infra/lambda/src/dev.ts`: add `import email from './routes/email';` and `app.route('/', email);` alongside the existing mounts.

- [ ] **Step 6: Typecheck the package**

Run: `pnpm --filter @language-drill/lambda typecheck`
Expected: no errors (confirms the placeholder cleanup compiles).

- [ ] **Step 7: Commit**

```bash
git add infra/lambda/src/routes/email.ts infra/lambda/src/routes/email.test.ts \
  infra/lambda/src/index.ts infra/lambda/src/dev.ts
git commit -m "feat(email): toggle/confirm/unsubscribe API routes (double opt-in)"
```

---

## Task 6: api-client — schemas + hooks

**Files:**
- Create: `packages/api-client/src/schemas/email.ts`
- Create: `packages/api-client/src/hooks/useEmailPreferences.ts`
- Create: `packages/api-client/src/hooks/useUpdateWeeklySummary.ts`
- Create: `packages/api-client/src/hooks/useUpdateWeeklySummary.test.ts`
- Modify: `packages/api-client/src/index.ts`

**Interfaces:**
- Consumes: `AuthenticatedFetch` from `../fetchClient`.
- Produces:
  - `EmailPreferencesSchema` / `EmailPreferences` (`{ weeklySummary: 'off'|'pending'|'confirmed' }`).
  - `useEmailPreferences({ fetchFn, enabled? })` → query `['emailPreferences']` hitting `GET /me/email-preferences`.
  - `useUpdateWeeklySummary({ fetchFn })` → mutation over `{ enabled: boolean }` hitting `POST /email/weekly-summary`, invalidating `['emailPreferences']`.

- [ ] **Step 1: Write the failing test**

Create `packages/api-client/src/hooks/useUpdateWeeklySummary.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import { useUpdateWeeklySummary } from './useUpdateWeeklySummary';

function wrapper() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: qc }, children);
}

describe('useUpdateWeeklySummary', () => {
  it('POSTs { enabled } and parses the response', async () => {
    const fetchFn = vi.fn(async () =>
      new Response(JSON.stringify({ weeklySummary: 'pending' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const { result } = renderHook(() => useUpdateWeeklySummary({ fetchFn }), {
      wrapper: wrapper(),
    });
    result.current.mutate({ enabled: true });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(fetchFn).toHaveBeenCalledWith(
      '/email/weekly-summary',
      expect.objectContaining({ method: 'POST', body: JSON.stringify({ enabled: true }) }),
    );
    expect(result.current.data).toEqual({ weeklySummary: 'pending' });
  });
});
```

> If `@testing-library/react` is not already a devDependency of `packages/api-client`, mirror the import style of the nearest existing hook test in that package instead; check `packages/api-client/src/hooks/*.test.ts*` for the established harness and copy it.

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @language-drill/api-client exec vitest run src/hooks/useUpdateWeeklySummary.test.ts`
Expected: FAIL — `Cannot find module './useUpdateWeeklySummary'`.

- [ ] **Step 3: Implement the schema**

Create `packages/api-client/src/schemas/email.ts`:

```ts
import { z } from 'zod';

export const EmailPreferencesSchema = z.object({
  weeklySummary: z.enum(['off', 'pending', 'confirmed']),
});

export type EmailPreferences = z.infer<typeof EmailPreferencesSchema>;

export const UpdateWeeklySummaryInputSchema = z.object({ enabled: z.boolean() });
export type UpdateWeeklySummaryInput = z.infer<typeof UpdateWeeklySummaryInputSchema>;
```

- [ ] **Step 4: Implement the hooks**

Create `packages/api-client/src/hooks/useEmailPreferences.ts`:

```ts
import { useQuery } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import { EmailPreferencesSchema, type EmailPreferences } from '../schemas/email';

export function useEmailPreferences({
  fetchFn,
  enabled = true,
}: {
  fetchFn: AuthenticatedFetch;
  enabled?: boolean;
}) {
  return useQuery<EmailPreferences, Error>({
    queryKey: ['emailPreferences'],
    queryFn: async () => {
      const res = await fetchFn('/me/email-preferences');
      const json: unknown = await res.json();
      return EmailPreferencesSchema.parse(json);
    },
    enabled,
    staleTime: 60 * 1000,
  });
}
```

Create `packages/api-client/src/hooks/useUpdateWeeklySummary.ts`:

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AuthenticatedFetch } from '../fetchClient';
import {
  EmailPreferencesSchema,
  UpdateWeeklySummaryInputSchema,
  type EmailPreferences,
  type UpdateWeeklySummaryInput,
} from '../schemas/email';

export function useUpdateWeeklySummary({ fetchFn }: { fetchFn: AuthenticatedFetch }) {
  const queryClient = useQueryClient();
  return useMutation<EmailPreferences, Error, UpdateWeeklySummaryInput>({
    mutationFn: async (args) => {
      const payload = UpdateWeeklySummaryInputSchema.parse(args);
      const res = await fetchFn('/email/weekly-summary', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const json: unknown = await res.json();
      return EmailPreferencesSchema.parse(json);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['emailPreferences'] });
    },
  });
}
```

- [ ] **Step 5: Export from the barrel**

In `packages/api-client/src/index.ts`, add (matching the existing export grouping):

```ts
export { useEmailPreferences } from './hooks/useEmailPreferences';
export { useUpdateWeeklySummary } from './hooks/useUpdateWeeklySummary';
export {
  EmailPreferencesSchema,
  UpdateWeeklySummaryInputSchema,
  type EmailPreferences,
  type UpdateWeeklySummaryInput,
} from './schemas/email';
```

- [ ] **Step 6: Run it to verify it passes**

Run: `pnpm --filter @language-drill/api-client exec vitest run src/hooks/useUpdateWeeklySummary.test.ts`
Expected: PASS (1 test).

- [ ] **Step 7: Commit**

```bash
git add packages/api-client/src
git commit -m "feat(api-client): email-preferences query + weekly-summary toggle mutation"
```

---

## Task 7: Web settings — Email section

**Files:**
- Create: `apps/web/components/settings/email-section.tsx`
- Modify: `apps/web/app/(dashboard)/settings/page.tsx`

**Interfaces:**
- Consumes: `useEmailPreferences`, `useUpdateWeeklySummary`, `createAuthenticatedFetch` from `@language-drill/api-client`; `useAuth` from `@clerk/nextjs`; the local `Section`/`Row`/`Switch` primitives used by `goals-section.tsx`.
- Produces: `EmailSection` React component.

- [ ] **Step 1: Read the existing settings section pattern**

Open `apps/web/components/settings/goals-section.tsx` and `apps/web/app/(dashboard)/settings/page.tsx`. Reuse the exact `Section`, `Row`, and `Switch` imports/primitives that `goals-section.tsx` uses (the explorer confirmed this is the established toggle pattern). Match its file header (`'use client'`) and styling.

- [ ] **Step 2: Implement the section**

Create `apps/web/components/settings/email-section.tsx` (adjust the `Section`/`Row`/`Switch` import paths to match `goals-section.tsx` exactly):

```tsx
'use client';

import { useMemo } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  useEmailPreferences,
  useUpdateWeeklySummary,
} from '@language-drill/api-client';
// IMPORTANT: copy these three imports verbatim from goals-section.tsx so the
// paths and prop shapes match the rest of the settings page.
import { Section, Row, Switch } from './primitives';

export function EmailSection() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const prefs = useEmailPreferences({ fetchFn });
  const update = useUpdateWeeklySummary({ fetchFn });

  const status = prefs.data?.weeklySummary ?? 'off';
  const checked = status === 'pending' || status === 'confirmed';

  const hint =
    status === 'pending'
      ? 'check your inbox to confirm — sends start after you click the link.'
      : status === 'confirmed'
        ? 'a short recap of your week, every monday. skipped on weeks you don’t practice.'
        : 'a short recap of your week, every monday. skipped on weeks you don’t practice.';

  return (
    <Section id="email" title="email">
      <Row label="weekly summary" hint={hint}>
        <Switch
          checked={checked}
          disabled={prefs.isLoading || update.isPending}
          onChange={(next: boolean) => update.mutate({ enabled: next })}
          aria-label="weekly summary"
        />
      </Row>
    </Section>
  );
}
```

> If `goals-section.tsx` imports `Section`/`Row`/`Switch` from different paths (e.g. inline in the page, or from `@/components/...`), use those exact paths instead of `'./primitives'`. Do not invent new primitives.

- [ ] **Step 3: Mount it in the settings page**

In `apps/web/app/(dashboard)/settings/page.tsx`, import `EmailSection` and render it alongside the existing sections (e.g. directly after `<GoalsSection />`). If the page maintains a scroll-spy nav list of section ids, add `email` to that list so the sidebar entry appears.

- [ ] **Step 4: Lint + typecheck the web app**

Run: `pnpm --filter @language-drill/web lint && pnpm --filter @language-drill/web typecheck`
Expected: no errors. (Renaming/adding a settings section can break page tests that assert the section list — per project memory `component-label-route-change-grep-all-tests`, grep `apps/web` for settings-section assertions and update any that enumerate sections.)

- [ ] **Step 5: Run web tests**

Run: `pnpm --filter @language-drill/web test`
Expected: PASS. Fix any settings-page test that enumerates sections to include "email".

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/settings/email-section.tsx "apps/web/app/(dashboard)/settings/page.tsx"
git commit -m "feat(web): weekly-summary email toggle in settings"
```

---

## Task 8: Dispatcher Lambda — enqueue per confirmed subscriber

**Files:**
- Create: `infra/lambda/src/email/job-message.ts`
- Create: `infra/lambda/src/email/dispatcher.ts`
- Create: `infra/lambda/src/email/dispatcher.test.ts`

**Interfaces:**
- Consumes: `weeklyWindow` from `./period-key`; `createDb`, `requireEnv`, `emailPreferences`, `sentEmails`, `users` from `@language-drill/db`; `SQSClient`, `SendMessageBatchCommand` from `@aws-sdk/client-sqs`.
- Produces:
  - `WeeklySummaryJobMessage = { userId: string; email: string; periodKey: string; windowStartIso: string; windowEndIso: string }` (in `job-message.ts`).
  - `handler(): Promise<void>` — EventBridge entrypoint. Selects `weekly_summary='confirmed'` users joined to `users.email`, drops those already in `sent_emails` for this `periodKey`, and enqueues one message each (batches of ≤10).

- [ ] **Step 1: Write the failing test**

Create `infra/lambda/src/email/dispatcher.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqsSend = vi.fn();
vi.mock('@aws-sdk/client-sqs', () => ({
  SQSClient: vi.fn(() => ({ send: sqsSend })),
  SendMessageBatchCommand: vi.fn((input) => ({ input })),
}));

const subscriberRows = vi.fn();
const sentRows = vi.fn();
vi.mock('@language-drill/db', () => {
  const sel = () => {
    const c: any = {};
    c.from = () => c;
    c.innerJoin = () => c;
    c.where = () => c;
    // first select = subscribers; second = sent ledger. Distinguish by a flag.
    c.then = undefined;
    c.__exec = null;
    return c;
  };
  return {
    createDb: vi.fn(() => ({
      // We model two sequential awaited selects via mockResolvedValueOnce.
      select: vi.fn(() => ({
        from: () => ({
          innerJoin: () => ({ where: () => subscriberRows() }),
          where: () => sentRows(),
        }),
      })),
    })),
    requireEnv: (k: string) => (k === 'DATABASE_URL' ? 'postgres://x' : 'queue-url'),
    emailPreferences: { userId: 'user_id', weeklySummary: 'weekly_summary' },
    sentEmails: { userId: 'user_id', kind: 'kind', periodKey: 'period_key' },
    users: { id: 'id', email: 'email' },
  };
});

describe('weekly-summary dispatcher', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.AWS_REGION = 'eu-central-1';
    process.env.EMAIL_QUEUE_URL = 'queue-url';
  });

  it('enqueues one message per confirmed user not already sent this period', async () => {
    subscriberRows.mockResolvedValue([
      { userId: 'u1', email: 'u1@x.com' },
      { userId: 'u2', email: 'u2@x.com' },
    ]);
    sentRows.mockResolvedValue([{ userId: 'u1' }]); // u1 already handled
    sqsSend.mockResolvedValue({});
    const { handler } = await import('./dispatcher');
    await handler();
    expect(sqsSend).toHaveBeenCalledOnce();
    const batch = sqsSend.mock.calls[0][0].input.Entries;
    expect(batch).toHaveLength(1);
    expect(JSON.parse(batch[0].MessageBody).userId).toBe('u2');
  });

  it('does not open SQS when there is nothing to send', async () => {
    subscriberRows.mockResolvedValue([{ userId: 'u1', email: 'u1@x.com' }]);
    sentRows.mockResolvedValue([{ userId: 'u1' }]);
    const { handler } = await import('./dispatcher');
    await handler();
    expect(sqsSend).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @language-drill/lambda exec vitest run src/email/dispatcher.test.ts`
Expected: FAIL — `Cannot find module './dispatcher'`.

- [ ] **Step 3: Implement the job message type**

Create `infra/lambda/src/email/job-message.ts`:

```ts
export interface WeeklySummaryJobMessage {
  userId: string;
  email: string;
  periodKey: string;
  windowStartIso: string;
  windowEndIso: string;
}
```

- [ ] **Step 4: Implement the dispatcher**

Create `infra/lambda/src/email/dispatcher.ts`:

```ts
import {
  createDb,
  requireEnv,
  emailPreferences,
  sentEmails,
  users,
} from '@language-drill/db';
import { SendMessageBatchCommand, SQSClient } from '@aws-sdk/client-sqs';
import { and, eq } from 'drizzle-orm';

import { weeklyWindow } from './period-key';
import type { WeeklySummaryJobMessage } from './job-message';

const KIND = 'weekly_summary';
const MAX_BATCH_SIZE = 10; // SQS hard limit

const db = createDb(requireEnv('DATABASE_URL'));
const sqs = new SQSClient({ region: requireEnv('AWS_REGION') });

function log(payload: Record<string, unknown>): void {
  console.log(JSON.stringify(payload));
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * EventBridge-invoked weekly dispatcher. Enumerates confirmed subscribers,
 * drops any already recorded in sent_emails for this period (idempotent across
 * same-week re-fires), and fans out one SQS message per remaining user. The
 * sender Lambda does the per-user work.
 */
export async function handler(): Promise<void> {
  const startedAt = Date.now();
  const queueUrl = requireEnv('EMAIL_QUEUE_URL');
  const { start, end, periodKey } = weeklyWindow(new Date());

  log({ level: 'info', periodKey, message: 'weekly-summary dispatcher started' });

  const subscribers = await db
    .select({ userId: emailPreferences.userId, email: users.email })
    .from(emailPreferences)
    .innerJoin(users, eq(users.id, emailPreferences.userId))
    .where(eq(emailPreferences.weeklySummary, 'confirmed'));

  const already = await db
    .select({ userId: sentEmails.userId })
    .from(sentEmails)
    .where(and(eq(sentEmails.kind, KIND), eq(sentEmails.periodKey, periodKey)));
  const sentUserIds = new Set(already.map((r) => r.userId));

  const targets = subscribers.filter((s) => !sentUserIds.has(s.userId));

  if (targets.length === 0) {
    log({ level: 'info', periodKey, enqueued: 0, durationMs: Date.now() - startedAt, message: 'nothing to enqueue' });
    return;
  }

  const messages: WeeklySummaryJobMessage[] = targets.map((t) => ({
    userId: t.userId,
    email: t.email,
    periodKey,
    windowStartIso: start.toISOString(),
    windowEndIso: end.toISOString(),
  }));

  for (const batch of chunk(messages, MAX_BATCH_SIZE)) {
    await sqs.send(
      new SendMessageBatchCommand({
        QueueUrl: queueUrl,
        Entries: batch.map((msg, i) => ({ Id: String(i), MessageBody: JSON.stringify(msg) })),
      }),
    );
  }

  log({ level: 'info', periodKey, enqueued: messages.length, durationMs: Date.now() - startedAt, message: 'weekly-summary dispatcher complete' });
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm --filter @language-drill/lambda exec vitest run src/email/dispatcher.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add infra/lambda/src/email/job-message.ts infra/lambda/src/email/dispatcher.ts \
  infra/lambda/src/email/dispatcher.test.ts
git commit -m "feat(email): weekly-summary dispatcher Lambda (per-user fan-out)"
```

---

## Task 9: Sender Lambda — claim, gather, render, send, mark

**Files:**
- Create: `infra/lambda/src/email/gather.ts`
- Create: `infra/lambda/src/email/sender.ts`
- Create: `infra/lambda/src/email/sender.test.ts`

**Interfaces:**
- Consumes: `WeeklySummaryJobMessage` from `./job-message`; `buildWeeklySummaryData` from `./summary-data`; `createDb`, `requireEnv`, `emailPreferences`, `sentEmails`, `userExerciseHistory`, `userGrammarMastery`, `exercises`, `getGrammarPoint` from `@language-drill/db`; `renderEmail`, `WeeklySummaryEmail`, `sendEmail` from `@language-drill/email`; an `SQSEvent`/`SQSBatchResponse` shape from `aws-lambda`.
- Produces:
  - `gatherSummary(db, userId, start, end): Promise<{ historyRows; masteryRows }>` (raw rows for the shaper).
  - `handler(event: SQSEvent): Promise<SQSBatchResponse>` — processes one message (`batchSize: 1`); returns `{ batchItemFailures }` so a throw redrives the message.
- Env consumed: `DATABASE_URL`, `RESEND_API_KEY` (via `@language-drill/email`), `EMAIL_LINK_BASE_URL`, `EMAIL_APP_URL`.

- [ ] **Step 1: Write the failing test**

Create `infra/lambda/src/email/sender.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const claimReturning = vi.fn();
const updateReturning = vi.fn();
const historyRows = vi.fn(async () => []);
const masteryRows = vi.fn(async () => []);

vi.mock('@language-drill/db', () => {
  const insertChain = {
    values: () => ({ onConflictDoNothing: () => ({ returning: () => claimReturning() }) }),
  };
  const updateChain = { set: () => ({ where: () => ({ returning: () => updateReturning() }) }) };
  const selectChain = (rows: () => Promise<unknown[]>) => ({
    from: () => ({ innerJoin: () => ({ where: () => rows() }), where: () => rows() }),
  });
  let selectCall = 0;
  return {
    createDb: vi.fn(() => ({
      insert: () => insertChain,
      update: () => updateChain,
      select: () => {
        selectCall += 1;
        return selectChain(selectCall === 1 ? historyRows : masteryRows);
      },
    })),
    requireEnv: () => 'x',
    emailPreferences: {}, sentEmails: { userId: 'user_id', kind: 'kind', periodKey: 'period_key' },
    userExerciseHistory: { userId: 'user_id', exerciseId: 'exercise_id', score: 'score', evaluatedAt: 'evaluated_at' },
    userGrammarMastery: { userId: 'user_id', grammarPointKey: 'grammar_point_key', score: 'score' },
    exercises: { id: 'id', grammarPointKey: 'grammar_point_key', language: 'language' },
    getGrammarPoint: vi.fn(() => ({ label: 'Some Point' })),
  };
});

const sendEmailMock = vi.fn(async () => ({ id: 'eml', delivered: true }));
vi.mock('@language-drill/email', () => ({
  sendEmail: sendEmailMock,
  renderEmail: vi.fn(async () => ({ html: '<p>x</p>', text: 'x' })),
  WeeklySummaryEmail: vi.fn(() => null),
}));

function evt() {
  return {
    Records: [
      {
        messageId: 'm1',
        body: JSON.stringify({
          userId: 'u1', email: 'u1@x.com', periodKey: '2026-W25',
          windowStartIso: '2026-06-15T08:00:00Z', windowEndIso: '2026-06-22T08:00:00Z',
        }),
      },
    ],
  } as any;
}

describe('weekly-summary sender', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    historyRows.mockResolvedValue([]);
    masteryRows.mockResolvedValue([]);
  });

  it('skips (status=skipped) and does NOT send when there is no activity', async () => {
    claimReturning.mockResolvedValue([{ id: 1 }]); // claim succeeded
    updateReturning.mockResolvedValue([{ id: 1 }]);
    historyRows.mockResolvedValue([]); // zero activity
    const { handler } = await import('./sender');
    const res = await handler(evt());
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(res.batchItemFailures).toHaveLength(0);
  });

  it('renders and sends when there is activity', async () => {
    claimReturning.mockResolvedValue([{ id: 1 }]);
    updateReturning.mockResolvedValue([{ id: 1 }]);
    historyRows.mockResolvedValue([
      { grammarPointKey: 'es-x', language: 'ES', score: 0.9, evaluatedAt: new Date('2026-06-16T10:00:00Z') },
    ]);
    const { handler } = await import('./sender');
    const res = await handler(evt());
    expect(sendEmailMock).toHaveBeenCalledOnce();
    expect(res.batchItemFailures).toHaveLength(0);
  });

  it('treats a claim conflict as already-sent and no-ops', async () => {
    claimReturning.mockResolvedValue([]); // ON CONFLICT DO NOTHING returned nothing
    const { handler } = await import('./sender');
    const res = await handler(evt());
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(res.batchItemFailures).toHaveLength(0);
  });

  it('reports the record as a batch failure when sending throws', async () => {
    claimReturning.mockResolvedValue([{ id: 1 }]);
    historyRows.mockResolvedValue([
      { grammarPointKey: 'es-x', language: 'ES', score: 0.9, evaluatedAt: new Date('2026-06-16T10:00:00Z') },
    ]);
    sendEmailMock.mockRejectedValueOnce(new Error('resend down'));
    const { handler } = await import('./sender');
    const res = await handler(evt());
    expect(res.batchItemFailures).toEqual([{ itemIdentifier: 'm1' }]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter @language-drill/lambda exec vitest run src/email/sender.test.ts`
Expected: FAIL — `Cannot find module './sender'`.

- [ ] **Step 3: Implement the gather query**

Create `infra/lambda/src/email/gather.ts`:

```ts
import {
  userExerciseHistory,
  userGrammarMastery,
  exercises,
  type Db,
} from '@language-drill/db';
import { and, eq, gte, lt, isNotNull } from 'drizzle-orm';
import type { HistoryRow, MasteryRow } from './summary-data';

/**
 * Raw rows for the weekly summary. History is the user's evaluated exercises in
 * the window (joined to exercises for the grammar point + language); mastery is
 * the user's current per-point scores (for weak-spot selection). Shaping lives
 * in summary-data.ts (pure + tested).
 */
export async function gatherSummary(
  db: Db,
  userId: string,
  start: Date,
  end: Date,
): Promise<{ historyRows: HistoryRow[]; masteryRows: MasteryRow[] }> {
  const historyRows = await db
    .select({
      grammarPointKey: exercises.grammarPointKey,
      language: exercises.language,
      score: userExerciseHistory.score,
      evaluatedAt: userExerciseHistory.evaluatedAt,
    })
    .from(userExerciseHistory)
    .innerJoin(exercises, eq(userExerciseHistory.exerciseId, exercises.id))
    .where(
      and(
        eq(userExerciseHistory.userId, userId),
        gte(userExerciseHistory.evaluatedAt, start),
        lt(userExerciseHistory.evaluatedAt, end),
        isNotNull(userExerciseHistory.evaluatedAt),
      ),
    );

  const masteryRows = await db
    .select({
      grammarPointKey: userGrammarMastery.grammarPointKey,
      score: userGrammarMastery.score,
    })
    .from(userGrammarMastery)
    .where(eq(userGrammarMastery.userId, userId));

  return {
    historyRows: historyRows.map((r) => ({
      grammarPointKey: r.grammarPointKey ?? null,
      language: r.language,
      score: r.score ?? null,
      evaluatedAt: r.evaluatedAt as Date,
    })),
    masteryRows: masteryRows
      .filter((r): r is { grammarPointKey: string; score: number } =>
        r.grammarPointKey !== null && r.score !== null,
      )
      .map((r) => ({ grammarPointKey: r.grammarPointKey, score: r.score })),
  };
}
```

> Verify the actual column names on `userGrammarMastery` in
> `packages/db/src/schema/progress.ts` (`grammarPointKey`, `score`, and whether
> a `language` column exists) before finalizing; adjust the selected columns to
> match. The shaper only needs `{ grammarPointKey, score }`.

- [ ] **Step 4: Implement the sender**

Create `infra/lambda/src/email/sender.ts`:

```ts
import type { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import {
  createDb,
  requireEnv,
  sentEmails,
  emailPreferences,
  getGrammarPoint,
} from '@language-drill/db';
import {
  renderEmail,
  WeeklySummaryEmail,
  sendEmail,
} from '@language-drill/email';
import { and, eq } from 'drizzle-orm';

import type { WeeklySummaryJobMessage } from './job-message';
import { buildWeeklySummaryData } from './summary-data';
import { gatherSummary } from './gather';

const KIND = 'weekly_summary';
const db = createDb(requireEnv('DATABASE_URL'));

function log(payload: Record<string, unknown>): void {
  console.log(JSON.stringify(payload));
}

const LANGUAGE_NAMES: Record<string, string> = { ES: 'Spanish', DE: 'German', TR: 'Turkish', EN: 'English' };
const languageNameFor = (code: string): string => LANGUAGE_NAMES[code] ?? code;

/** Curriculum label lookup with a graceful fallback to the raw key. */
function makeLabelFor(language: string): (key: string) => string {
  return (key: string) => {
    try {
      const gp = getGrammarPoint(language, key);
      return gp?.label ?? key;
    } catch {
      return key;
    }
  };
}

async function processOne(msg: WeeklySummaryJobMessage): Promise<void> {
  // 1. Claim the period row. ON CONFLICT DO NOTHING → empty array means another
  //    delivery already handled it (idempotent); no-op.
  const claim = await db
    .insert(sentEmails)
    .values({ userId: msg.userId, kind: KIND, periodKey: msg.periodKey, status: 'pending' })
    .onConflictDoNothing({ target: [sentEmails.userId, sentEmails.kind, sentEmails.periodKey] })
    .returning({ id: sentEmails.id });
  if (claim.length === 0) {
    log({ level: 'info', userId: msg.userId, periodKey: msg.periodKey, message: 'already handled — skipping' });
    return;
  }

  // 2. Gather + shape.
  const start = new Date(msg.windowStartIso);
  const end = new Date(msg.windowEndIso);
  const { historyRows, masteryRows } = await gatherSummary(db, msg.userId, start, end);
  // The user's primary language for label lookups = the most-practiced this
  // week, falling back to the first mastery row's implied language is overkill;
  // use the first history row's language, else 'ES'.
  const primaryLanguage = historyRows[0]?.language ?? 'ES';
  const data = buildWeeklySummaryData({
    historyRows,
    masteryRows,
    labelFor: makeLabelFor(primaryLanguage),
    languageNameFor,
  });

  const markStatus = async (status: 'sent' | 'skipped') => {
    await db
      .update(sentEmails)
      .set({ status, sentAt: status === 'sent' ? new Date() : null })
      .where(and(eq(sentEmails.userId, msg.userId), eq(sentEmails.kind, KIND), eq(sentEmails.periodKey, msg.periodKey)))
      .returning({ id: sentEmails.id });
  };

  // 3. No activity → skip (no email), record it so we don't re-evaluate.
  if (!data.hasActivity) {
    await markStatus('skipped');
    log({ level: 'info', userId: msg.userId, periodKey: msg.periodKey, message: 'no activity — skipped' });
    return;
  }

  // 4. Render + send.
  const linkBase = process.env.EMAIL_LINK_BASE_URL ?? 'http://localhost:3001';
  const appUrl = process.env.EMAIL_APP_URL ?? 'https://langdrill.app';
  // Look up the user's stable unsubscribe token for the footer link + header.
  const unsubscribeUrl = `${linkBase}/email/unsubscribe?token=${await resolveUnsubscribeToken(msg.userId)}`;

  const { html, text } = await renderEmail(
    WeeklySummaryEmail({
      exercisesCompleted: data.exercisesCompleted,
      languagesPracticed: data.languagesPracticed,
      daysActive: data.daysActive,
      movers: data.movers,
      focus: data.focus,
      practiceUrl: appUrl,
      unsubscribeUrl,
    }),
  );

  await sendEmail({
    to: msg.email,
    subject: 'Your week in Language Drill',
    html,
    text,
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  });

  // 5. Mark sent only after Resend accepted it.
  await markStatus('sent');
  log({ level: 'info', userId: msg.userId, periodKey: msg.periodKey, message: 'sent' });
}

async function resolveUnsubscribeToken(userId: string): Promise<string> {
  const rows = await db
    .select({ token: emailPreferences.unsubscribeToken })
    .from(emailPreferences)
    .where(eq(emailPreferences.userId, userId))
    .limit(1);
  return rows[0]?.token ?? '';
}

/**
 * SQS handler. batchSize=1, reportBatchItemFailures: a thrown error returns the
 * record as a batch-item failure so SQS redrives it (→ DLQ after maxReceive).
 */
export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: { itemIdentifier: string }[] = [];
  for (const record of event.Records) {
    try {
      const msg = JSON.parse(record.body) as WeeklySummaryJobMessage;
      await processOne(msg);
    } catch (err) {
      log({ level: 'error', messageId: record.messageId, error: String(err), message: 'sender failed' });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `pnpm --filter @language-drill/lambda exec vitest run src/email/sender.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Add `aws-lambda` types if missing**

If typecheck complains about `aws-lambda`, confirm it's already a devDependency of `infra/lambda` (the generation handler uses SQS types). If not: `pnpm --filter @language-drill/lambda add -D @types/aws-lambda`.

- [ ] **Step 7: Typecheck + commit**

Run: `pnpm --filter @language-drill/lambda typecheck`
Expected: no errors.

```bash
git add infra/lambda/src/email/gather.ts infra/lambda/src/email/sender.ts \
  infra/lambda/src/email/sender.test.ts
git commit -m "feat(email): weekly-summary sender Lambda (claim/gather/render/send)"
```

---

## Task 10: CDK — queue, dispatcher schedule, sender, secret wiring

**Files:**
- Create: `infra/lib/constructs/email-queue.ts`
- Create: `infra/lib/constructs/email-dispatcher-lambda.ts`
- Create: `infra/lib/constructs/email-sender-lambda.ts`
- Modify: `infra/lib/constructs/lambda.ts` (API Lambda: `RESEND_API_KEY` + email link/app env)
- Modify: `infra/lib/stack.ts` (wire constructs + CfnOutput)
- Create/Modify: `infra/test/email-stack.test.ts`

**Interfaces:**
- Consumes: the patterns in `generation-queue.ts`, `scheduler-lambda.ts`, `generation-lambda.ts`.
- Produces: `EmailQueueConstruct` (`.queue`, `.deadLetterQueue`), `EmailDispatcherLambdaConstruct` (`.handler`, `.rule?`), `EmailSenderLambdaConstruct` (`.handler`). All wired in `LanguageDrillStack`.

- [ ] **Step 1: Implement the email queue construct**

Create `infra/lib/constructs/email-queue.ts` (mirrors `generation-queue.ts`, shorter timeout — sends are fast):

```ts
import { Duration } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwactions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export interface EmailQueueConstructProps {
  readonly alarmTopic?: sns.ITopic;
}

/**
 * Dedicated SQS queue + DLQ for weekly-summary sends. Separate from the
 * generation queue: sends are short (one render + one Resend call), so the
 * visibility timeout is small. maxReceiveCount=3 gives a transient Resend/DB
 * blip a couple of retries before a message lands in the DLQ for inspection.
 */
export class EmailQueueConstruct extends Construct {
  public readonly queue: sqs.Queue;
  public readonly deadLetterQueue: sqs.Queue;
  public readonly dlqDepthAlarm: cloudwatch.Alarm;

  constructor(scope: Construct, id: string, props?: EmailQueueConstructProps) {
    super(scope, id);

    this.deadLetterQueue = new sqs.Queue(this, 'EmailDeadLetterQueue', {
      retentionPeriod: Duration.days(14),
    });

    this.queue = new sqs.Queue(this, 'EmailQueue', {
      visibilityTimeout: Duration.seconds(120), // must be ≥ sender Lambda timeout
      deadLetterQueue: { queue: this.deadLetterQueue, maxReceiveCount: 3 },
    });

    this.dlqDepthAlarm = new cloudwatch.Alarm(this, 'EmailDlqDepthAlarm', {
      metric: this.deadLetterQueue.metricApproximateNumberOfMessagesVisible({
        period: Duration.minutes(5),
        statistic: cloudwatch.Stats.MAXIMUM,
      }),
      threshold: 1,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'A weekly-summary email message survived every redelivery and landed in the DLQ.',
    });

    if (props?.alarmTopic) {
      this.dlqDepthAlarm.addAlarmAction(new cwactions.SnsAction(props.alarmTopic));
    }
  }
}
```

- [ ] **Step 2: Implement the dispatcher construct**

Create `infra/lib/constructs/email-dispatcher-lambda.ts` (mirrors `scheduler-lambda.ts`; weekly cron; secrets = DATABASE_URL only):

```ts
import * as path from 'path';
import { Duration } from 'aws-cdk-lib';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export interface EmailDispatcherLambdaConstructProps {
  queue: sqs.IQueue;
  secretsPrefix: string;
  enableScheduledJobs: boolean;
  /** Defaults to Monday 08:00 UTC. */
  scheduleExpression?: events.Schedule;
}

export class EmailDispatcherLambdaConstruct extends Construct {
  public readonly handler: lambda.NodejsFunction;
  public readonly rule?: events.Rule;

  constructor(scope: Construct, id: string, props: EmailDispatcherLambdaConstructProps) {
    super(scope, id);

    const databaseUrl = secretsmanager.Secret.fromSecretNameV2(this, 'DatabaseUrl', `${props.secretsPrefix}/DATABASE_URL`);
    const projectRoot = path.join(__dirname, '../../..');

    this.handler = new lambda.NodejsFunction(this, 'Handler', {
      entry: path.join(__dirname, '../../lambda/src/email/dispatcher.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(60),
      memorySize: 256,
      depsLockFilePath: path.join(projectRoot, 'pnpm-lock.yaml'),
      logRetention: logs.RetentionDays.ONE_MONTH,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
        esbuildArgs: {
          '--alias:@language-drill/shared': path.join(projectRoot, 'packages/shared/src/index.ts'),
          '--alias:@language-drill/db': path.join(projectRoot, 'packages/db/src/index.ts'),
          '--alias:@language-drill/ai': path.join(projectRoot, 'packages/ai/src/index.ts'),
          '--alias:@language-drill/email': path.join(projectRoot, 'packages/email/src/index.ts'),
        },
      },
      environment: {
        DATABASE_URL: databaseUrl.secretValue.unsafeUnwrap(),
        EMAIL_QUEUE_URL: props.queue.queueUrl,
      },
    });

    databaseUrl.grantRead(this.handler);
    props.queue.grantSendMessages(this.handler);

    if (props.enableScheduledJobs) {
      this.rule = new events.Rule(this, 'EmailDispatcherRule', {
        schedule: props.scheduleExpression ?? events.Schedule.cron({ minute: '0', hour: '8', weekDay: 'MON' }),
        targets: [new targets.LambdaFunction(this.handler)],
        description: 'Weekly summary email dispatcher — fans out per confirmed subscriber.',
      });
    }
  }
}
```

- [ ] **Step 3: Implement the sender construct**

Create `infra/lib/constructs/email-sender-lambda.ts` (mirrors `generation-lambda.ts`; secrets = DATABASE_URL + RESEND_API_KEY; SQS event source; errors alarm):

```ts
import * as path from 'path';
import { Duration } from 'aws-cdk-lib';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cwactions from 'aws-cdk-lib/aws-cloudwatch-actions';
import { Runtime } from 'aws-cdk-lib/aws-lambda';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as lambda from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

export interface EmailSenderLambdaConstructProps {
  queue: sqs.IQueue;
  secretsPrefix: string;
  reservedConcurrency: number;
  /** Base URL for unsubscribe links (API domain). */
  emailLinkBaseUrl: string;
  /** Base URL for the "Practice now" CTA (web app). */
  emailAppUrl: string;
  readonly alarmTopic?: sns.ITopic;
}

export class EmailSenderLambdaConstruct extends Construct {
  public readonly handler: lambda.NodejsFunction;
  public readonly errorsAlarm: cloudwatch.Alarm;

  constructor(scope: Construct, id: string, props: EmailSenderLambdaConstructProps) {
    super(scope, id);

    const databaseUrl = secretsmanager.Secret.fromSecretNameV2(this, 'DatabaseUrl', `${props.secretsPrefix}/DATABASE_URL`);
    const resendApiKey = secretsmanager.Secret.fromSecretNameV2(this, 'ResendApiKey', `${props.secretsPrefix}/RESEND_API_KEY`);
    const projectRoot = path.join(__dirname, '../../..');

    this.handler = new lambda.NodejsFunction(this, 'Handler', {
      entry: path.join(__dirname, '../../lambda/src/email/sender.ts'),
      handler: 'handler',
      runtime: Runtime.NODEJS_22_X,
      timeout: Duration.seconds(60),
      memorySize: 512,
      reservedConcurrentExecutions: props.reservedConcurrency,
      depsLockFilePath: path.join(projectRoot, 'pnpm-lock.yaml'),
      logRetention: logs.RetentionDays.ONE_MONTH,
      bundling: {
        minify: true,
        sourceMap: true,
        externalModules: ['@aws-sdk/*'],
        esbuildArgs: {
          '--alias:@language-drill/shared': path.join(projectRoot, 'packages/shared/src/index.ts'),
          '--alias:@language-drill/db': path.join(projectRoot, 'packages/db/src/index.ts'),
          '--alias:@language-drill/ai': path.join(projectRoot, 'packages/ai/src/index.ts'),
          '--alias:@language-drill/email': path.join(projectRoot, 'packages/email/src/index.ts'),
        },
      },
      environment: {
        DATABASE_URL: databaseUrl.secretValue.unsafeUnwrap(),
        RESEND_API_KEY: resendApiKey.secretValue.unsafeUnwrap(),
        EMAIL_LINK_BASE_URL: props.emailLinkBaseUrl,
        EMAIL_APP_URL: props.emailAppUrl,
      },
    });

    databaseUrl.grantRead(this.handler);
    resendApiKey.grantRead(this.handler);

    this.handler.addEventSource(
      new SqsEventSource(props.queue, {
        batchSize: 1,
        reportBatchItemFailures: true,
        maxConcurrency: props.reservedConcurrency,
      }),
    );

    this.errorsAlarm = new cloudwatch.Alarm(this, 'EmailSenderErrorsAlarm', {
      metric: this.handler.metricErrors({ period: Duration.days(1), statistic: cloudwatch.Stats.SUM }),
      threshold: 5,
      evaluationPeriods: 1,
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'Weekly-summary sender Lambda recorded > 5 errors in a single day.',
    });

    if (props.alarmTopic) {
      this.errorsAlarm.addAlarmAction(new cwactions.SnsAction(props.alarmTopic));
    }
  }
}
```

- [ ] **Step 4: Wire `RESEND_API_KEY` + email env into the API Lambda**

In `infra/lib/constructs/lambda.ts`, add the secret next to the others (e.g. after the Langfuse keys): create `const resendApiKey = secretsmanager.Secret.fromSecretNameV2(this, 'ResendApiKey', \`${props.secretsPrefix}/RESEND_API_KEY\`);`, add `RESEND_API_KEY: resendApiKey.secretValue.unsafeUnwrap(),` to the `environment` block, and `resendApiKey.grantRead(this.handler);` with the other grants. (The API Lambda sends the confirmation email on toggle-on, so it needs the key.) Also add `EMAIL_LINK_BASE_URL` and `EMAIL_FROM` via the existing `additionalEnv` plumbing in `stack.ts` (next step) — confirm `lambda.ts` spreads `additionalEnv` into `environment` (it does for the generation Lambda; the API construct uses `props.additionalEnv` the same way).

- [ ] **Step 5: Wire the constructs into the stack**

In `infra/lib/stack.ts`:

Add imports near the other construct imports:
```ts
import { EmailQueueConstruct } from "./constructs/email-queue";
import { EmailDispatcherLambdaConstruct } from "./constructs/email-dispatcher-lambda";
import { EmailSenderLambdaConstruct } from "./constructs/email-sender-lambda";
```

Add `EMAIL_LINK_BASE_URL` + `EMAIL_FROM` to the API Lambda's `additionalEnv` (in the existing `new LambdaConstruct(...)` call):
```ts
        EMAIL_LINK_BASE_URL: `https://${props.apiDomainName}`,
        EMAIL_FROM: "Language Drill <summary@langdrill.app>",
```

After the theory pipeline block (before the `CfnOutput`s), add:
```ts
    // Weekly summary email pipeline — independent SQS + dispatcher (weekly
    // cron) + sender. Cron gated on enableScheduledJobs (prod on, dev off).
    const emailQueue = new EmailQueueConstruct(this, "EmailQueue", {
      alarmTopic: alerts.topic,
    });
    new EmailDispatcherLambdaConstruct(this, "EmailDispatcherWrap", {
      queue: emailQueue.queue,
      secretsPrefix: props.secretsPrefix,
      enableScheduledJobs: props.enableScheduledJobs,
    });
    new EmailSenderLambdaConstruct(this, "EmailSenderWrap", {
      queue: emailQueue.queue,
      secretsPrefix: props.secretsPrefix,
      reservedConcurrency: 2,
      emailLinkBaseUrl: `https://${props.apiDomainName}`,
      // Web app the "Practice now" CTA links to. Both envs point at the prod
      // web app (there is no separate dev web domain); adjust if one is added.
      emailAppUrl: "https://langdrill.app",
    });
```

Add an output near the others:
```ts
    new CfnOutput(this, "EmailQueueUrl", {
      value: emailQueue.queue.queueUrl,
      description: "SQS queue URL for weekly-summary email sends.",
    });
```

- [ ] **Step 6: Add/extend the CDK synth test**

Create `infra/test/email-stack.test.ts` mirroring the existing synth-test style in `infra/test/` (find the closest existing `*.test.ts`, copy its `App`/`Template.fromStack` harness and the stack-prop fixture). Assert:

```ts
// Pseudocode — adapt to the existing harness in infra/test/:
// const template = Template.fromStack(stack);
// 1. Two more SQS queues exist (email queue + DLQ).
// 2. An events::Rule with a weekly cron (ScheduleExpression containing 'cron(0 8 ? * MON' or the CDK form).
// 3. A Lambda whose Environment has RESEND_API_KEY (sender) and one with EMAIL_QUEUE_URL (dispatcher).
template.resourceCountIs('AWS::SQS::Queue', /* prior count + 2 */ EXPECTED);
template.hasResourceProperties('AWS::Events::Rule', Match.objectLike({
  ScheduleExpression: Match.stringLikeRegexp('MON'),
}));
```

> Check the current `AWS::SQS::Queue` count in the existing synth test and bump the expected count by 2. Per project memory `pnpm-test-infra-parallel-flake`, infra tests already run with `fileParallelism:false` — don't change that config.

- [ ] **Step 7: Typecheck + synth + test**

Run: `pnpm --filter @language-drill/infra typecheck && pnpm --filter @language-drill/infra exec cdk synth --quiet && pnpm --filter @language-drill/infra test`
Expected: synth succeeds; synth test passes.

- [ ] **Step 8: Commit**

```bash
git add infra/lib/constructs/email-queue.ts infra/lib/constructs/email-dispatcher-lambda.ts \
  infra/lib/constructs/email-sender-lambda.ts infra/lib/constructs/lambda.ts \
  infra/lib/stack.ts infra/test/email-stack.test.ts
git commit -m "feat(infra): weekly-summary email pipeline (queue + dispatcher cron + sender)"
```

---

## Task 11: Ops — secrets, DNS runbook, env docs

**Files:**
- Create: `docs/runbooks/email-dns-setup.md`
- Modify: `.env.example`
- Modify: `CLAUDE.md` (secrets table + env matrix)

**Interfaces:** none (docs + config only).

- [ ] **Step 1: Write the DNS + secret runbook**

Create `docs/runbooks/email-dns-setup.md`:

```markdown
# Email DNS + Resend setup (manual, one-time per environment)

Required before any real send. Without these records mail lands in spam.

## 1. Resend account + domain
1. Create/sign in to Resend; add domain `langdrill.app` (prod) — Resend issues
   SPF, DKIM, and (optionally) DMARC records.
2. In **Cloudflare** (registrar + DNS), add the issued records as **DNS-only /
   grey-cloud** (consistent with existing records). Wait for Resend to mark the
   domain **Verified**.
3. Verify the `summary@langdrill.app` from-address sends under the verified
   domain.

## 2. Secrets Manager
Add `RESEND_API_KEY` to AWS Secrets Manager in **eu-central-1** for both envs:
- prod: `language-drill/RESEND_API_KEY`
- dev:  `language-drill-dev/RESEND_API_KEY`

```bash
aws --region eu-central-1 secretsmanager create-secret \
  --name language-drill/RESEND_API_KEY --secret-string '<resend_api_key>'
```

## 3. Verify end-to-end
- Toggle the weekly summary on in settings → confirm the confirmation email
  arrives and the confirm link flips status to `confirmed`.
- Manually invoke the dispatcher Lambda (or wait for Monday 08:00 UTC) and
  confirm a summary arrives; check CloudWatch for the sender Lambda logs.
```

- [ ] **Step 2: Document local env**

In `.env.example`, add (with a comment that it's optional locally — sends are logged when unset):

```bash
# Product email (Resend). Optional locally: when unset, sendEmail() logs the
# rendered HTML instead of sending. See docs/runbooks/email-dns-setup.md.
RESEND_API_KEY=
EMAIL_FROM="Language Drill <summary@langdrill.app>"
EMAIL_LINK_BASE_URL=http://localhost:3001
EMAIL_APP_URL=http://localhost:3000
```

- [ ] **Step 3: Update CLAUDE.md**

In `CLAUDE.md`:
- Add `language-drill/RESEND_API_KEY` to the **AWS Secrets Manager** secrets table (Resend console → API Keys).
- Add a one-line note under CI/CD or a new "Email" subsection pointing to `docs/runbooks/email-dns-setup.md` and noting email failures land in CloudWatch (not Sentry).

- [ ] **Step 4: Commit**

```bash
git add docs/runbooks/email-dns-setup.md .env.example CLAUDE.md
git commit -m "docs(email): DNS/secret runbook + env documentation"
```

---

## Task 12: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Clean stale Lambda dist (avoids phantom test failures)**

Run: `rm -rf infra/lambda/dist`
(Per project memory `lambda-stale-dist-test-files` — stale compiled `*.test.js` cause phantom failures.)

- [ ] **Step 2: Run the full pre-push gate from the repo root**

Run: `pnpm lint && pnpm typecheck && pnpm test`
Expected: zero failures across all packages. If a package's test resolves a stale `db/dist`, run `pnpm build` (turbo) first (project memory `vitest-workspace-dist-resolution`), then re-run.

- [ ] **Step 3: Manual local smoke (optional but recommended)**

Start `pnpm dev`, then in the web settings toggle the weekly summary on. Confirm the API logs the confirmation email (RESEND_API_KEY unset → logged HTML), and that hitting the logged `/email/confirm?token=…` URL returns the success HTML page and flips the DB row to `confirmed`. (Local `.env` points at the dev Neon branch — fine for a read/write smoke; do not run the migration against it.)

- [ ] **Step 4: Final commit (if any cleanup was needed)**

```bash
git add -A && git commit -m "chore(email): pre-push gate green"
```

---

## Post-implementation (out of plan scope, tracked for the human)

- Run the migration against **production** Neon as part of the normal merge → `db:migrate` deploy step (CI/CD), **not** locally against dev.
- Complete the manual Resend/Cloudflare DNS verification (Task 11 runbook) before relying on real delivery.
- Broadcast email (release notes / curriculum updates) remains out of scope — a future plan, reusing this package's templates + Resend client.
