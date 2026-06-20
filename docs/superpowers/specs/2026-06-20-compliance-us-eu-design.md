# Minimum Legal Compliance (US + EU/GDPR) — Design Spec

**Date:** 2026-06-20
**Status:** Approved (brainstorm), pending implementation plan
**Branch:** `worktree-compliance-us-eu`

> **Not legal advice.** This spec implements a good-faith, app-accurate compliance
> baseline appropriate for a portfolio app. Have the published policies reviewed by
> a qualified professional before relying on them commercially.

---

## 1. Goal & Scope

Ship the **minimum required** legal-compliance surface for a product targeting **US**
and **EU** users, operated by an EU-based individual controller (so GDPR applies in
full).

**Data controller:** Ivan Nikola, an individual based in **Hungary**.
**Contact:** `info@langdrill.app`
**Governing law (ToS):** Hungary.

### What already exists (no work needed)

- **Right to erasure / delete account** — Clerk's `<UserProfile>` widget is embedded at
  `/settings#/security` (PR #407) with a working "Delete account" button. It deletes the
  Clerk user, which fires the existing `user.deleted` webhook
  (`infra/lambda/src/routes/webhooks/clerk.ts`) that cascade-deletes all DB rows via
  `ON DELETE CASCADE`. Self-serve erasure is **done**; the new policies will link to it.
- **Sentry** — error monitoring sets **no cookies** and runs with `sendDefaultPii: false`
  (only user ID captured). Treated as **legitimate interest**, ungated by consent.
- **No analytics / ad / tracking cookies** today. Only strictly-necessary cookies
  (Clerk auth) and functional `sessionStorage` (exercise draft persistence).

### What we build

1. Public legal pages: **Privacy Policy**, **Terms of Service**, **Cookie Policy**.
2. **Cookie consent banner + consent plumbing** — analytics category off by default,
   ready to gate a future PostHog integration. (Built now to avoid a later retrofit.)
3. **Data export** ("Download my data") — synchronous JSON download (GDPR right to
   access / portability).
4. **Surfacing** — settings "privacy & data" section + footer links.

### Explicitly out of scope (YAGNI — with rationale)

- **CCPA / CPRA "Do Not Sell or Share"** — no sale/share of personal data, and the
  operator is far below CCPA business thresholds ($25M revenue / 100k consumers).
  A privacy policy + access/deletion rights already satisfy the practical baseline.
- **Async / emailed export job (SQS + S3 + email)** — data volume per user is small;
  a synchronous response is sufficient. No new infra.
- **Signed Data Processing Agreements (DPAs)** — operational/legal paperwork with
  vendors, not app code. Sub-processors are *disclosed* in the privacy policy.
- **Cookie consent for Sentry** — sets no cookies; legitimate interest. Stays ungated.

---

## 2. Legal Pages

### Routing & layout

- New route group `apps/web/app/(legal)/` with a shared `layout.tsx`:
  prose styling, a "Last updated: <date>" line, a back-to-home link, and a standing
  "plain-language summary, not legal advice" note.
- Pages: `(legal)/privacy/page.tsx`, `(legal)/terms/page.tsx`, `(legal)/cookies/page.tsx`.
- Content authored as TSX prose (real, app-accurate text — option A). A small set of
  shared constants (controller name, contact email, last-updated date, jurisdiction)
  lives in one module (`apps/web/app/(legal)/_content/constants.ts`) so the three pages
  and the footer stay consistent and single-sourced.

### Public-route exposure (critical)

These pages must render for logged-out visitors. Add them to the Clerk middleware
`isPublicRoute` matcher in `apps/web/middleware.ts`:

```ts
const isPublicRoute = createRouteMatcher([
  '/',
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/invite(.*)',
  '/api/webhooks(.*)',
  '/privacy',
  '/terms',
  '/cookies',
]);
```

### Content requirements

**Privacy Policy (`/privacy`)**
- Controller identity + contact (Ivan Nikola, Hungary, `info@langdrill.app`).
- Categories of data collected and **why**: account (email via Clerk), learning data
  (exercise history, mastery, vocabulary, reading entries, sessions, SR state),
  usage metering, error diagnostics (Sentry — user ID only).
- **Legal bases** (GDPR Art. 6): performance of contract (providing the service),
  legitimate interest (security, error monitoring, abuse prevention), and consent
  (future analytics only).
- **Sub-processors / recipients** (GDPR transparency): Clerk (auth), AWS (Lambda/S3/
  Polly/Transcribe), Anthropic (answer evaluation), Neon (database), Upstash (rate
  limiting), Vercel (hosting), Sentry (error monitoring), **Langfuse** (LLM-call
  observability — traces stamp the user ID and the request `messages`, which include the
  learner's free-text answers, per `packages/ai/src/observability.ts:600,621`), and
  **Cloudflare** (registrar/DNS + email forwarding for `info@langdrill.app`, so inbound
  user emails transit Cloudflare). Note that some process data outside the EU under
  appropriate safeguards.
- **Retention**: data kept while the account is active; deleted on account deletion.
- **Data-subject rights**: access/portability → links to the in-app "Download my data";
  erasure → links to `/settings#/security` delete; plus rectification, objection,
  and the right to lodge a complaint with a supervisory authority (Hungarian NAIH).

**Terms of Service (`/terms`)**
- Description of service; acceptable-use; **AI-generated-content disclaimer** (exercises
  and evaluations are AI-produced and may contain errors; not professional/educational
  certification).
- No-warranty + limitation of liability (to the extent permitted by law).
- **Minimum age 16** (EU GDPR consent age; conservative across member states).
- **Governing law: Hungary.**
- Right to change terms with notice via the "Last updated" date.

**Cookie Policy (`/cookies`)**
- Table of what's stored: strictly-necessary (Clerk auth cookies, functional
  `sessionStorage` for drafts) vs. analytics (opt-in, **not active today**, reserved
  for a future product-analytics tool).
- Explains the consent banner and how to change choices ("Cookie preferences").

---

## 3. Cookie Consent (plumbing now, analytics later)

### Consent state module — `apps/web/lib/consent/`

- Shape persisted to `localStorage` (key `drill-cookie-consent`):
  ```ts
  type ConsentState = { analytics: boolean; version: number; timestamp: string };
  ```
- `CONSENT_VERSION` constant. If stored `version < CONSENT_VERSION` (or nothing stored),
  the banner re-prompts. Bump the version when the disclosed categories change.
- **SSR-safe**: all `localStorage` access guarded for `typeof window`. On the server and
  before hydration, treat consent as "unknown" → analytics **off**, banner pending.
- Exports: `getConsent()`, `setConsent(partial)`, `hasConsent('analytics')`.

### Components — `apps/web/components/consent/`

- `consent-provider.tsx` — React context holding current consent + `useConsent()` hook;
  hydrates from `localStorage` on mount, exposes `update()` and `openPreferences()`.
- `cookie-banner.tsx` — bottom banner shown when consent is unset/stale. Buttons:
  **Accept all**, **Reject non-essential**, **Manage** (opens preferences). Links to
  `/cookies`. Accessible (focus management, dismissible, keyboard-operable).
- Preferences UI (modal or inline panel) — toggle the Analytics category; Strictly
  necessary shown as always-on/disabled. Reachable from the banner's "Manage" and from
  a footer "Cookie preferences" link.
- `consent-gate.tsx` — `<ConsentGate category="analytics">{children}</ConsentGate>`
  renders children only when consent for that category is granted. **Future PostHog
  mounts inside this gate; no other compliance change needed at that point.**

### Mounting

- `ConsentProvider` + `CookieBanner` mount in the **root layout** so they apply to both
  the marketing landing and the authenticated app.
- Sentry remains initialized unconditionally (legitimate interest, no cookies).

---

## 4. Data Export ("Download my data")

### Backend — `GET /me/export` (Hono, `infra/lambda/src/routes/me.ts`)

- Authenticated via the existing JWT middleware (resolves `userId`).
- A serializer module gathers **all rows keyed to the user** and the `users` row,
  returning a single JSON document:
  ```jsonc
  {
    "exportedAt": "<ISO>",
    "user": { /* users row incl. email */ },
    "languageProfiles": [...],
    "preferences": {...},
    "exerciseHistory": [...],
    "spacedRepetitionCards": [...],
    "fluencyAttempts": [...],
    "grammarMastery": [...],
    "errorObservations": [...],
    "practiceSessions": [...],
    "readEntries": [...],
    "vocabulary": [...],
    "vocabularyReviewState": [...],
    "vocabularyReviewSessions": [...],
    "vocabularyReviewLog": [...],
    "playlists": [...], "playlistItems": [...],
    "usageEvents": [...],
    "exerciseFlags": [...]   // flags filed by this user
  }
  ```
- Source-of-truth table list (from `packages/db/src/schema/index.ts`): `users`,
  `userLanguageProfiles`, `userPreferences`, `userExerciseHistory`,
  `spacedRepetitionCards`, `fluencyAttempts`, `userGrammarMastery`, `errorObservations`,
  `practiceSessions`, `readEntries`, `userVocabulary`, `vocabularyReviewState`,
  `vocabularyReviewSessions`, `vocabularyReviewLog`, `playlists` (+ `playlistItems` for
  the user's playlists), `usageEvents`, `exerciseFlags`. (Excludes shared/content tables
  like `exercises`, `theoryTopics`, `generatedReadingTexts`, `generationJobs`.)
- Response headers: `Content-Type: application/json` and
  `Content-Disposition: attachment; filename="drill-data-export-<date>.json"`.
- **Errors**: 401 if unauthenticated (middleware); 500 on DB failure with a JSON error
  code. No new rate-limit bucket required (cheap, read-only) — but a light guard is fine.

### Frontend

- "Download my data" button in settings. On click: obtain Clerk token
  (`getToken({ template: 'api' })`), `fetch` `GET {API_URL}/me/export` with the Bearer
  header, read the blob, and save it as `drill-data-export-<date>.json`.
- Loading + error states; failure → toast. Follows the existing api-client/fetch pattern
  used elsewhere in the app.

---

## 5. Surfacing in the UI

### Settings — new "privacy & data" section

- Add a "privacy & data" entry to the settings nav (alongside languages & levels, goals,
  plan & limits, account) at `apps/web/app/(dashboard)/settings/`.
- Contents: **Download my data** button; links to Privacy / Terms / Cookies;
  **Cookie preferences** trigger; and a pointer to `account → Security` for account
  deletion (already built — do not duplicate).

### Footers

- Add a legal-links block (Privacy · Terms · Cookies · Cookie preferences ·
  `info@langdrill.app`) to:
  - Landing **desktop** footer `DFooter` (`apps/web/app/_landing/drill-landing.tsx`)
  - Landing **mobile** footer `MFooter` (`apps/web/app/_landing/drill-landing-mobile.tsx`)
  - Authenticated footer `apps/web/components/shell/user-footer.tsx`
- "Cookie preferences" link calls `openPreferences()` from the consent provider.

---

## 6. Testing

- **Lambda (`me.test.ts`)**: `GET /me/export` returns all user-keyed tables; **requires
  auth** (401 without); **excludes other users' rows** (seed two users, assert isolation);
  sets the `Content-Disposition` attachment header.
- **Web — consent module**: defaults analytics off; `setConsent` persists and round-trips;
  a `CONSENT_VERSION` bump re-prompts (treated as unset); SSR-safe (no `window` access
  errors).
- **Web — banner**: renders when consent unset; hides after Accept/Reject; "Accept all"
  sets analytics true, "Reject" leaves it false.
- **Web — `ConsentGate`**: renders children only when the category is granted.
- **Web — legal pages**: smoke render of `/privacy`, `/terms`, `/cookies`; assert key
  required strings (controller, contact email, governing law) are present.
- **Web — footers**: legal links present in `DFooter`, `MFooter`, `user-footer`. Grep the
  app for existing footer assertions first to avoid breaking them (label/route-change
  ripple).
- Per project rules: run `pnpm lint`, `pnpm typecheck`, `pnpm test` green before any push.

---

## 7. File-Change Summary

**New**
- `apps/web/app/(legal)/layout.tsx`, `(legal)/privacy/page.tsx`, `(legal)/terms/page.tsx`,
  `(legal)/cookies/page.tsx`, `(legal)/_content/constants.ts`
- `apps/web/lib/consent/*` (state module + tests)
- `apps/web/components/consent/consent-provider.tsx`, `cookie-banner.tsx`,
  `consent-gate.tsx` (+ preferences UI) (+ tests)
- Data-export serializer module + `me.test.ts` additions
- Settings "privacy & data" section component + the "Download my data" client action

**Modified**
- `apps/web/middleware.ts` — public routes for legal pages
- `apps/web/app/layout.tsx` (root) — mount `ConsentProvider` + `CookieBanner`
- `infra/lambda/src/routes/me.ts` — `GET /me/export`
- `apps/web/app/_landing/drill-landing.tsx` (`DFooter`),
  `apps/web/app/_landing/drill-landing-mobile.tsx` (`MFooter`),
  `apps/web/components/shell/user-footer.tsx` — legal links
- Settings page/nav — new section
