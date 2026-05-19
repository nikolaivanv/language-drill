# Requirements Document

## Introduction

Add Sentry error tracking to the Next.js web app (`apps/web`) so that browser JavaScript errors, React render crashes, and Next.js server-side render / Server Action errors are captured with readable, source-mapped stack traces and aggregated in a single inbox per environment.

Today the project has CloudWatch (for the Hono Lambda API), Langfuse (for LLM traces), and Vercel server logs (raw text). The unaddressed gap is **client-side and Next.js-runtime errors** — when a learner hits a white screen mid-exercise, no signal reaches the team. This spec closes that gap and only that gap; Lambda observability and LLM tracing remain as-is.

This is an **error-tracking-only** integration. Performance tracing, session replay, and Web Vitals reporting are explicitly out of scope to control quota cost and keep the integration minimal.

## Alignment with Product Vision

The project is positioned as "the practice app for serious language learners" and is portfolio-quality. From `product.md`, the core loop — learner produces text/audio → AI evaluates → progress updates — is what validates the entire thesis. A silent white-screen during that loop is one of the worst possible failure modes: the learner loses trust and the team has no way to reproduce. Sentry makes those failures observable so they can be fixed quickly, supporting the reliability bar implied by the product positioning.

From `tech.md`, the stack already commits to serverless infrastructure with strong cost discipline and an "API-first, web now, mobile later" split. This spec keeps that contract: Sentry is wired only into `apps/web`; the standalone Lambda API and the future Expo app are unaffected.

## Requirements

### Requirement 1 — Capture browser runtime errors

**User Story:** As the developer, I want uncaught JavaScript errors and unhandled promise rejections in the browser to be reported to Sentry, so that I can detect production breakages without relying on user reports.

#### Acceptance Criteria

1. WHEN an unhandled exception is thrown anywhere in client-side code in the production build THEN the Sentry browser SDK SHALL capture it and send it to the configured Sentry project.
2. WHEN an unhandled promise rejection occurs in the browser THEN the Sentry browser SDK SHALL capture it.
3. WHEN a captured error reaches Sentry THEN its stack trace SHALL be deminified using uploaded source maps so that file paths and line numbers refer to source files, not bundled output.
4. IF `NEXT_PUBLIC_SENTRY_DSN` is not set at build time THEN the SDK SHALL be a no-op (no network calls) so that local dev and forks without a DSN do not break.

### Requirement 2 — Capture React render errors

**User Story:** As the developer, I want errors thrown during React rendering (including in the root layout) to be reported, so that white-screen crashes are not invisible.

#### Acceptance Criteria

1. WHEN an error is thrown during rendering inside the App Router tree THEN it SHALL be caught by a Next.js `global-error.tsx` boundary that reports the error to Sentry before rendering a fallback UI.
2. WHEN the boundary renders the fallback THEN the user SHALL see a minimal "Something went wrong" message with a way to retry (page reload or navigation to the dashboard).
3. WHEN the same error occurs on a non-root route AND a route-segment `error.tsx` boundary exists THEN the segment boundary SHALL invoke a shared reporter helper (`Sentry.captureException` wrapped in `apps/web/lib/sentry/report.ts`) and recover within that segment rather than escalating to the global boundary.
4. The shared reporter SHALL be the single import point for any future `error.tsx` boundaries so that reporting behavior is consistent across routes.

### Requirement 3 — Capture Next.js server-side errors

**User Story:** As the developer, I want errors thrown in Next.js Server Components, Server Actions, and Route Handlers to be reported, so that server-rendered crashes are observable without grepping Vercel logs.

#### Acceptance Criteria

1. WHEN an unhandled error occurs during Server Component rendering on Vercel THEN it SHALL be captured by the Sentry Next.js server-side integration via `instrumentation.ts`.
2. WHEN an unhandled error occurs in a Server Action or Route Handler under `apps/web` THEN it SHALL be captured by the same integration.
3. WHEN the Next.js Edge runtime is used (e.g. middleware) THEN errors thrown in that runtime SHALL also be captured.
4. The capture for #1–#3 SHALL NOT require modifying existing application code (Server Components, layouts, route handlers, middleware). Adding new top-level files (`instrumentation.ts`, `global-error.tsx`) and wrapping `next.config.ts` with `withSentryConfig` are the only acceptable changes.

### Requirement 4 — Environment and release separation

**User Story:** As the developer, I want production errors separated from preview-deploy errors and tagged with a release identifier, so that I can distinguish real-user issues from PR experiments and know which build introduced a regression.

#### Acceptance Criteria

1. WHEN Sentry initializes on Vercel production THEN `environment` SHALL be set to `production`.
2. WHEN Sentry initializes on a Vercel preview deploy THEN `environment` SHALL be set to `preview`.
3. WHEN Sentry initializes locally (`pnpm dev:web`) AND a DSN is set THEN `environment` SHALL be set to `development`.
4. WHEN a build completes on Vercel THEN the `release` field SHALL be set to the Vercel deployment Git commit SHA (`VERCEL_GIT_COMMIT_SHA`).
5. WHEN no Git SHA is available (e.g. local builds) THEN the `release` field MAY be omitted; Sentry SHALL still accept the event.

### Requirement 5 — PII and learner-content protection

**User Story:** As the project owner, I want learner-submitted text (drill answers, written production, reading passages, etc.) excluded from error reports by default, so that I do not leak private learner content into a third-party SaaS.

#### Acceptance Criteria

1. WHEN Sentry initializes THEN `sendDefaultPii` SHALL be `false`.
2. WHEN an event is about to be sent THEN a `beforeSend` hook SHALL redact the value of any field in `extra`, `contexts`, or `request.data` whose key (case-insensitive) is exactly one of: `answer`, `answers`, `userAnswer`, `response`, `submission`, `submissions`, `transcript`, `passage`, `userText`, `writtenText`, `freeWriting`. (Exact-key match avoids false positives on names like `responseTime` or `apiResponse`.)
3. WHEN an event's `request.url` or `request.query_string` contains query parameters THEN the `beforeSend` hook SHALL strip parameter values (preserving keys only) before send. Navigation breadcrumb URLs SHALL be left intact so route flow remains debuggable.
4. IF a future feature needs to ship learner content with an error (e.g. for AI-eval debugging) THEN that feature SHALL explicitly opt in via a tagged context — the default SHALL remain redaction.
5. WHEN the `beforeSend` redaction logic is changed THEN a unit test in `apps/web/lib/sentry/__tests__/before-send.test.ts` SHALL exercise each redaction case and SHALL pass before merge.

### Requirement 6 — User correlation without identification

**User Story:** As the developer, I want errors associated with a stable user identifier so that I can see whether one learner hit many errors or many learners hit one, **without** sending the learner's email or name to Sentry.

#### Acceptance Criteria

1. WHEN a user is signed in via Clerk THEN Sentry SHALL set the `user.id` scope tag to the Clerk user ID (`user_xxx`).
2. WHEN setting the user scope THEN Sentry SHALL NOT set `user.email`, `user.username`, or `user.ip_address`.
3. WHEN a user signs out THEN the Sentry user scope SHALL be cleared.
4. IF the user is anonymous (sign-in pages, public routes) THEN no user identifier SHALL be attached.

### Requirement 7 — Source map upload at build time

**User Story:** As the developer, I want production source maps uploaded to Sentry during the Vercel build, so that stack traces are readable but maps are not publicly served.

#### Acceptance Criteria

1. WHEN `next build` runs on Vercel with `SENTRY_AUTH_TOKEN` set THEN source maps SHALL be generated, uploaded to Sentry, and configured so that `.map` URLs are not referenced by shipped JS (via whichever current `@sentry/nextjs` mechanism the installed SDK version supports — historically `hideSourceMaps`, currently `sourcemaps.disable` / `widenClientFileUpload` patterns; design phase will pin the exact option).
2. WHEN `SENTRY_AUTH_TOKEN` is not set THEN the build SHALL still succeed; source map upload SHALL be skipped with a warning only.
3. The `SENTRY_AUTH_TOKEN` SHALL be stored as a server-side Vercel environment variable (Production + Preview scope) and SHALL NOT be exposed to the browser.
4. WHEN source maps are uploaded THEN they SHALL be associated with the `release` identifier from Requirement 4.4.

### Requirement 8 — Local development behavior

**User Story:** As the developer, I want Sentry to be effectively disabled during local development by default, so that my debugging noise doesn't fill the production Sentry quota or muddy real signal.

#### Acceptance Criteria

1. WHEN `pnpm dev:web` runs AND `NEXT_PUBLIC_SENTRY_DSN` is not set THEN the SDK SHALL be a no-op (per Requirement 1.4).
2. WHEN a developer explicitly opts into local Sentry by setting `NEXT_PUBLIC_SENTRY_DSN` THEN `environment` SHALL be set to `development` (per Requirement 4.3) so events are filterable in the Sentry UI.
3. WHEN `NEXT_PUBLIC_SENTRY_DSN` is set to a development project DSN THEN events SHALL NOT reach the production Sentry project (analogous to the Langfuse rule in `.env.example`: dev tooling never writes to prod observability).

### Requirement 9 — Documentation and env contract

**User Story:** As a future contributor (or future-me), I want the required Sentry environment variables and setup steps documented alongside the existing observability tools, so that I know how to wire up a fork or new environment.

#### Acceptance Criteria

1. WHEN this spec is implemented THEN `.env.example` SHALL include `NEXT_PUBLIC_SENTRY_DSN` and `SENTRY_AUTH_TOKEN` with comments explaining their purpose, scope (public vs server-only), and how to obtain them.
2. WHEN this spec is implemented THEN `CLAUDE.md` SHALL be updated to list Sentry alongside CloudWatch / Langfuse / Vercel logs in the observability section, with a one-line scope statement ("frontend only — Lambda errors remain in CloudWatch").
3. The values in `.env.example` SHALL be placeholders only (e.g. `https://<key>@o<org>.ingest.sentry.io/<project>`) and SHALL NOT be real DSN or token values.

## Non-Functional Requirements

### Performance

- The Sentry browser SDK bundle increase SHALL be under 50 KB gzipped added to the client JavaScript payload (Sentry's `@sentry/nextjs` browser bundle is currently ~30–40 KB gzipped without replay/tracing).
- WHEN Sentry is initialized THEN page Time-to-Interactive SHALL NOT regress by more than 100 ms on a representative dashboard route (measured with Vercel Speed Insights or a local Lighthouse run).
- Source map upload SHALL run only during the Vercel build, never during dev or runtime.

### Security

- `SENTRY_AUTH_TOKEN` MUST be server-side only (no `NEXT_PUBLIC_` prefix).
- `NEXT_PUBLIC_SENTRY_DSN` is intentionally public (DSNs are designed to be embedded in clients), but it MUST point to a Sentry project with rate limits configured to prevent ingestion abuse.
- Source maps MUST NOT be discoverable by the public (use `hideSourceMaps: true` or equivalent so the `.map` URLs are not referenced in shipped JS).
- `beforeSend` PII redaction (Requirement 5) MUST be unit-tested so regressions are caught before deploy.

### Reliability

- IF the Sentry ingest endpoint is unreachable or rate-limited THEN the SDK's internal retry/drop behavior SHALL handle it; the app SHALL NOT throw, crash, block rendering, or affect the user experience.
- The error-capture path MUST NOT itself throw; failures inside `beforeSend` or transport MUST be swallowed by the SDK.

### Usability

- The error fallback UI (Requirement 2.2) SHALL match the existing visual language of the app (Tailwind + the shadcn-style components already in `apps/web/components/ui`), not Next.js's stock dev-mode error page.
- The Sentry inbox SHALL be usable on free tier — sample rate is 100% for errors (Sentry's free tier handles 5k events/month, which is ample for a portfolio-scale app).

## Out of Scope (explicit non-requirements)

These are deliberately excluded to keep the scope tight and quota cost low:

- Performance / transaction tracing (`tracesSampleRate`)
- Session Replay
- Web Vitals reporting via Sentry (Vercel Speed Insights covers this if enabled)
- Profiling
- Wrapping the standalone Hono Lambda API — CloudWatch already covers it
- Wrapping LLM calls — Langfuse already covers them
- Sentry Cron monitoring
- Alerting / Slack / email integrations (configured in the Sentry UI, not in code)

## Open Decisions (deferred to design phase)

- **Sentry account**: assumed the user will create or already has a Sentry org; design will treat the DSN/token as inputs.
- **Project layout**: assumed single Sentry project with `production` / `preview` / `development` environments (matches the Vercel model). If the user prefers separate projects per environment, design adapts trivially by swapping DSN per environment.
- **Quota assumption**: the 100% error sample rate under "Usability" assumes Sentry's free tier (currently ~5k errors / 50k performance events per month). If event volume routinely exceeds this, a `sampleRate < 1.0` should be revisited rather than upgrading the plan.
