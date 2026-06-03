# Implementation Plan

## Task Overview

Wire `@sentry/nextjs` into `apps/web` following the file inventory in `design.md`. Sequence:
1. Install the SDK.
2. Build the pure-logic helpers in `lib/sentry/` (with unit tests) so the testable surface is in place before any SDK wiring touches them.
3. Add the runtime init files (`sentry.*.config.ts`, `instrumentation*.ts`) that consume those helpers.
4. Add the React surface — `global-error.tsx` and `SentryUserContext`.
5. Surgical modifications to existing files (`next.config.ts`, `app/layout.tsx`).
6. Documentation (`.env.example`, `CLAUDE.md`).

Each task lists exact files, what to put in them, what existing code to reuse, and which requirement it satisfies. Tasks are independently runnable once their prerequisites are met; the numbered order is the recommended execution order.

## Steering Document Compliance

- **`tech.md`**: changes are confined to `apps/web` (Frontend — Web row). The standalone Lambda API, `packages/ai`, and `packages/db` are not touched. The `SENTRY_AUTH_TOKEN` follows the same server-only / Secrets-style pattern as `ANTHROPIC_API_KEY`.
- **Existing project conventions** (from inspection of `apps/web`): tests live in sibling `__tests__/` directories (matches `apps/web/lib/__tests__/`); `lib/<module>/` namespaces grouped helpers (matches `apps/web/lib/drill/`, `lib/translation/`); the shadcn-style `Button` in `components/ui/` is the canonical button.
- **CLAUDE.md "Pre-Push Checks"**: every task ends by running `pnpm lint`, `pnpm typecheck`, and `pnpm test` (scoped where useful) before being marked complete.

## Atomic Task Requirements

Each task meets:
- **File Scope**: 1–3 related files
- **Time Boxing**: 15–30 minutes
- **Single Purpose**: one testable outcome
- **Specific Files**: exact paths
- **Agent-Friendly**: clear input/output

## Tasks

- [x] 1. Install `@sentry/nextjs` in `apps/web`
  - File: `apps/web/package.json` (modify); also updates lockfile `pnpm-lock.yaml`
  - Run `pnpm --filter @language-drill/web add @sentry/nextjs` from the repo root
  - Verify the version is the latest stable on npm and not deprecated (per CLAUDE.md package-management rule)
  - Run `pnpm --filter @language-drill/web typecheck` to confirm the install does not break anything
  - Purpose: SDK available before any code imports it
  - _Leverage: existing pnpm workspace + filter pattern from root `package.json` scripts_
  - _Requirements: 1.1, 3.1, 7.1_

- [x] 2. Create PII redactor + unit tests in `lib/sentry/before-send.ts`
  - Files: `apps/web/lib/sentry/before-send.ts`, `apps/web/lib/sentry/__tests__/before-send.test.ts`
  - Export `REDACTED_KEYS` (lower-cased `ReadonlySet<string>`) with the 11 keys listed in design.md "Data Models > RedactionPolicy"
  - Export `REDACTED_VALUE = '[redacted]'`
  - Export `beforeSend(event)`: deep-walk `event.extra`, `event.contexts`, `event.request?.data`; replace any value whose key (case-insensitive exact match) is in `REDACTED_KEYS` with `REDACTED_VALUE`. Strip query-string values (preserving keys) from `event.request?.url` and `event.request?.query_string`. Strip query-string values from `event.breadcrumbs[]` entries with `category` of `'fetch'` or `'xhr'`. Leave navigation breadcrumbs untouched. Wrap the body in try/catch — return the original event on any internal failure.
  - Tests cover: each `REDACTED_KEYS` entry across `extra`/`contexts`/`request.data`; case-insensitive matching (`USERANSWER`, `Answer`); benign keys (`responseTime`, `apiResponse`) NOT redacted; URL stripping for `request.url` and `request.query_string`; `fetch`/`xhr` breadcrumb URL stripping; navigation breadcrumb untouched; non-matching event returned unchanged; internal throw returns original event.
  - Run `pnpm --filter @language-drill/web test before-send` and confirm all cases pass
  - Purpose: the only logic-heavy module in the integration, with a tested redaction contract
  - _Leverage: existing vitest config at `apps/web/vitest.config.ts` (no setup changes needed)_
  - _Requirements: 5.1, 5.2, 5.3, 5.5_

- [x] 3. Create options factory + unit tests in `lib/sentry/shared-options.ts`
  - Files: `apps/web/lib/sentry/shared-options.ts`, `apps/web/lib/sentry/__tests__/shared-options.test.ts`
  - Export `resolveEnvironment(): 'production' | 'preview' | 'development'` — reads `process.env.VERCEL_ENV`, defaults to `'development'`
  - Export `resolveRelease(): string | undefined` — reads `process.env.VERCEL_GIT_COMMIT_SHA`
  - Export `getSharedSentryOptions()`: returns `{ dsn, environment, release, sendDefaultPii: false, enabled, beforeSend }` where `dsn = process.env.NEXT_PUBLIC_SENTRY_DSN`, `enabled = !!dsn`, `beforeSend` is imported from `./before-send`
  - Tests stub `process.env` per case and assert each return value. No SDK import needed (factory returns plain objects).
  - Run `pnpm --filter @language-drill/web test shared-options` and confirm all cases pass
  - Purpose: single source of truth for SDK init options across all three runtimes
  - _Leverage: `apps/web/lib/sentry/before-send.ts` (created in task 2)_
  - _Requirements: 1.4, 4.1, 4.2, 4.3, 4.4, 4.5, 5.1, 8.1, 8.2_

- [x] 4. Create boundary reporter in `lib/sentry/report.ts`
  - File: `apps/web/lib/sentry/report.ts`
  - Export `reportBoundaryError(error: Error & { digest?: string }, boundary: 'global' | 'segment'): void`
  - Body: `try { Sentry.withScope((scope) => { scope.setTag('boundary', boundary); if (error.digest) scope.setTag('digest', error.digest); Sentry.captureException(error); }); } catch { /* never throw from a reporter */ }`
  - Purpose: single capture entry point for all React error boundaries; consistent `boundary` tag for triage
  - _Leverage: `@sentry/nextjs` (installed in task 1)_
  - _Requirements: 2.1, 2.3, 2.4_

- [x] 5. Create per-runtime Sentry init files
  - Files: `apps/web/sentry.server.config.ts`, `apps/web/sentry.edge.config.ts`
  - Each file: `import * as Sentry from '@sentry/nextjs'; import { getSharedSentryOptions } from './lib/sentry/shared-options'; Sentry.init(getSharedSentryOptions());`
  - Both files are identical bodies; kept as two files because Sentry's Next.js framework integration discovers them by name
  - Purpose: register the Sentry SDK in the Node.js and Edge Next.js runtimes
  - _Leverage: `apps/web/lib/sentry/shared-options.ts` (created in task 3)_
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 6. Create Next.js server/edge instrumentation hook in `instrumentation.ts`
  - File: `apps/web/instrumentation.ts`
  - Export `async function register()` — `if (process.env.NEXT_RUNTIME === 'nodejs') await import('./sentry.server.config'); if (process.env.NEXT_RUNTIME === 'edge') await import('./sentry.edge.config');`
  - Export `onRequestError = Sentry.captureRequestError` (named import from `@sentry/nextjs`) — this captures Server Component, Server Action, and Route Handler errors automatically per Next.js framework hook
  - Purpose: tell Next.js which runtime config to load and wire up Server Component error capture
  - _Leverage: `apps/web/sentry.server.config.ts`, `apps/web/sentry.edge.config.ts` (created in task 5)_
  - _Requirements: 3.1, 3.2, 3.3, 3.4_

- [x] 7. Create Next.js client instrumentation in `instrumentation-client.ts`
  - File: `apps/web/instrumentation-client.ts`
  - `import * as Sentry from '@sentry/nextjs'; import { getSharedSentryOptions } from './lib/sentry/shared-options'; Sentry.init(getSharedSentryOptions()); export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;`
  - This file replaces the legacy `sentry.client.config.ts` for Next.js 15.3+
  - Purpose: initialize the browser SDK + capture App Router navigation breadcrumbs
  - _Leverage: `apps/web/lib/sentry/shared-options.ts` (created in task 3)_
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 8. Create global error boundary in `app/global-error.tsx`
  - File: `apps/web/app/global-error.tsx`
  - Mark `'use client'` at the top (required by Next.js for `global-error.tsx`)
  - Component receives `{ error: Error & { digest?: string }, reset: () => void }`; call `reportBoundaryError(error, 'global')` inside a `useEffect` keyed on `error`
  - Render its own `<html><body>...</body></html>` (Next.js requirement: replaces the root layout when active)
  - Body: a centered container with a heading "Something went wrong", a short paragraph, and two `<Button>` elements — `variant="primary"` calling `reset()` ("Try again"), `variant="default"` with `href="/"` ("Go to dashboard")
  - Purpose: capture React render crashes and present a branded fallback rather than a white screen
  - _Leverage: `apps/web/components/ui/button.tsx`, `apps/web/lib/cn.ts`, `apps/web/lib/sentry/report.ts` (created in task 4)_
  - _Requirements: 2.1, 2.2_

- [x] 9. Create Clerk → Sentry user-scope sync in `components/sentry/sentry-user-context.tsx`
  - File: `apps/web/components/sentry/sentry-user-context.tsx`
  - Mark `'use client'`. Default-export `SentryUserContext(): null`
  - Body: `const { isLoaded, user } = useUser(); useEffect(() => { if (!isLoaded) return; if (user) { Sentry.setUser({ id: user.id }); } else { Sentry.setUser(null); } }, [isLoaded, user?.id]);` then `return null`
  - The `isLoaded` early-return is mandatory — without it, Clerk's first render tick would call `Sentry.setUser(null)` and any error in that window would be falsely attributed as anonymous
  - Purpose: tag Sentry events with the Clerk user id (only) without leaking email/username/IP
  - _Leverage: `@clerk/nextjs` `useUser` hook (already used elsewhere in the shell), `@sentry/nextjs`_
  - _Requirements: 6.1, 6.2, 6.3, 6.4_

- [x] 10. Mount `SentryUserContext` in `app/layout.tsx`
  - File: `apps/web/app/layout.tsx` (modify)
  - Add `import SentryUserContext from '../components/sentry/sentry-user-context';` near the existing imports
  - Inside the existing `<ClerkProvider>` element, render `<SentryUserContext />` as a sibling before `<html>` — this is the smallest valid placement that gives the component access to Clerk state without changing the DOM tree (the component returns `null`, so its placement is purely about context)
  - Do NOT change `metadata`, fonts, or `Providers` wiring
  - Run `pnpm --filter @language-drill/web typecheck` to confirm
  - Purpose: activate user-scope tracking at the root of the app
  - _Leverage: existing `apps/web/app/layout.tsx` ClerkProvider structure_
  - _Requirements: 6.1, 6.3_

- [x] 11. Wrap `next.config.ts` with `withSentryConfig`
  - File: `apps/web/next.config.ts` (modify)
  - Add `import { withSentryConfig } from '@sentry/nextjs';`
  - Keep the existing `nextConfig` object unchanged
  - Replace `export default nextConfig;` with:
    ```ts
    export default withSentryConfig(nextConfig, {
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
      authToken: process.env.SENTRY_AUTH_TOKEN,
      silent: !process.env.CI,
      widenClientFileUpload: true,
      sourcemaps: { deleteSourcemapsAfterUpload: true },
      release: { name: process.env.VERCEL_GIT_COMMIT_SHA },
      disableLogger: true,
    });
    ```
  - Verify the change with `pnpm --filter @language-drill/web typecheck` and `pnpm --filter @language-drill/web lint`. The full `next build` smoke-test (which exercises the "skip source-map upload when token unset" path of Req 7.2) is deferred to task 14
  - Purpose: source-map upload at build time, tied to the same release identifier the runtime emits
  - _Leverage: existing `apps/web/next.config.ts`_
  - _Requirements: 7.1, 7.2, 7.3, 7.4_

- [x] 12. Add Sentry env vars to `.env.example`
  - File: `.env.example` (modify, at repo root)
  - Append a new block after the existing Langfuse section, mirroring its formatting:
    ```
    # ------------------------------------------------------------
    # Sentry (frontend error tracking)
    # ------------------------------------------------------------
    # Public DSN for the Next.js browser + server SDK in apps/web.
    # Local dev MUST point at a development Sentry project — never
    # the production one — so your debugging does not pollute the
    # prod issues inbox (same rule as Langfuse above).
    # Find it at: https://sentry.io → Settings → Projects → <project> → Client Keys (DSN)
    NEXT_PUBLIC_SENTRY_DSN=

    # Server-only build-time token for uploading source maps during
    # `next build` on Vercel. NOT exposed to the browser.
    # Find/create at: https://sentry.io → Settings → Auth Tokens
    # (scopes: project:releases, project:write)
    SENTRY_AUTH_TOKEN=

    # Sentry org and project slugs (used by withSentryConfig for
    # source-map upload). Optional locally; set in Vercel for prod.
    SENTRY_ORG=
    SENTRY_PROJECT=
    ```
  - All values MUST be empty placeholders — no real DSN or token
  - Purpose: document the env contract (per Req 9.1, 9.3)
  - _Leverage: existing `.env.example` Langfuse and Anthropic block style_
  - _Requirements: 7.3, 8.3, 9.1, 9.3_

- [x] 13. Add Sentry to the observability section of `CLAUDE.md`
  - File: `CLAUDE.md` (modify, at repo root)
  - In the "Tech Stack" table, add a row: `| Frontend monitoring | Sentry (`@sentry/nextjs`) — frontend only; Lambda errors remain in CloudWatch |`
  - In the "Required secrets" section under "Vercel environment variables" (or a new adjacent block), document `NEXT_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` with their scope (Production + Preview)
  - One-line scope statement somewhere visible: "Sentry covers browser, React render, and Next.js server-side errors in `apps/web`. Lambda API errors stay in CloudWatch; LLM call traces stay in Langfuse."
  - Purpose: future contributors see Sentry alongside the other observability tools
  - _Leverage: existing CLAUDE.md "Tech Stack" table and "Required secrets" formatting_
  - _Requirements: 9.2_

- [x] 14. Verification gate: pre-push checks + build smoke (non-coding)
  - This is a non-coding checkpoint enforcing the project's pre-push contract from CLAUDE.md
  - From repo root: `pnpm lint && pnpm typecheck && pnpm test` — confirm zero failures across all packages
  - Then: `pnpm --filter @language-drill/web build` with `SENTRY_AUTH_TOKEN` unset — confirm the build succeeds and Sentry's source-map upload is skipped with a warning only (Req 7.2)
  - If any failure is unrelated to this change, surface it but do not fix in-scope; if related, fix and re-run
  - Purpose: enforce the project's pre-push contract and verify the missing-token build path
  - _Leverage: existing root scripts `pnpm lint`, `pnpm typecheck`, `pnpm test`; `apps/web` `build` script_
  - _Requirements: 7.2, All_
