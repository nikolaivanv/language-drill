# PostHog Product Analytics — Design Spec

**Date:** 2026-06-21
**Status:** Approved (brainstorm), pending implementation plan
**Branch:** `worktree-feat-posthog-analytics`

> Builds on `docs/superpowers/specs/2026-06-20-compliance-us-eu-design.md`, which
> shipped a cookie consent banner with an **analytics category off by default,
> explicitly "ready to gate a future PostHog integration."** This spec is that
> follow-up.

---

## 1. Goal & Scope

Add product analytics to the web app to serve two near-term goals:

1. **Product-decision instrumentation** — measure whether features (drills, debrief,
   curriculum map, vocab review, theory, reading annotation) actually get used, to
   guide what to build next.
2. **Debugging & UX friction** — session replay to find broken/confusing flows.

**Tool:** PostHog (EU Cloud). Chosen over Plausible/Umami (no funnels/cohorts),
Amplitude/Mixpanel (overkill, worse free tier) because it covers product analytics
+ session replay + (future) feature flags in one tool, has an EU region matching the
`eu-central-1` infra and GDPR posture, a generous free tier, and a clean Next.js SDK.

**Surface:** Web only (`apps/web`). **Client-only** instrumentation — no Lambda
changes. Server-side events are explicitly deferred (see §8).

**Privacy posture:** Identified + session replay, **consent-gated** (option 1 from
brainstorm). Events link to Clerk user IDs; replay masks all input/text by default.

### In scope

- PostHog browser SDK wired into `apps/web`, initialized **only** on analytics consent.
- Reverse proxy via Next.js rewrites to avoid ad-blocker breakage / third-party host.
- Identity stitching to Clerk user ID; reset on sign-out.
- Session replay with input/text masking.
- Manual SPA `$pageview` capture for App Router client navigations.
- A small, typed core event taxonomy (~10 named events) + autocapture for the long tail.
- Privacy/cookie policy disclosure updates for PostHog.
- Env config (`.env.example` + Vercel Production/Preview).
- Unit tests for the consent-gated init/teardown and the `track()` wrapper.

### Out of scope (YAGNI)

- **Server-side (Lambda) events** — deferred; client-only covers ~90% of the value.
  Add later only when a specific question needs server-observed data (§8).
- **Feature flags / experiments** — PostHog supports them, but not needed now.
- **Comprehensive per-surface event schema** — start with the core set; grow organically.
- **Mobile (`apps/mobile`)** — does not exist yet.
- **New consent storage / banner** — reuse the existing consent plumbing entirely.

---

## 2. Architecture & Data Flow

```
User action (web) ──▶ track()/autocapture/replay (posthog-js)
                          │  (only if hasConsent('analytics'))
                          ▼
                   /ingest/*  (Next.js rewrite)
                          ▼
                 eu.i.posthog.com  (PostHog EU Cloud)
```

### Components

| Unit | Path (new unless noted) | Responsibility |
|---|---|---|
| `PostHogProvider` | `apps/web/components/analytics/posthog-provider.tsx` | Client component. Initializes/opts-in/opts-out PostHog driven by `useConsent()`. Wraps children with `posthog-js/react` `PostHogProvider` once initialized. |
| `usePageviews` | `apps/web/components/analytics/use-pageviews.ts` | Effect that fires `$pageview` on App Router route change (`usePathname` + `useSearchParams`). |
| `useIdentify` | `apps/web/components/analytics/use-identify.ts` | Effect that calls `posthog.identify(clerkUserId)` on sign-in and `posthog.reset()` on sign-out, via Clerk's `useAuth`/`useUser`. |
| `track()` wrapper | `apps/web/lib/analytics/track.ts` | Typed, centralized event emitter. No-ops when PostHog is not initialized. Exports the `AnalyticsEvent` name union + shared property types. |
| Consent plumbing | `apps/web/lib/consent/consent.ts`, `apps/web/components/consent/*` (existing) | Unchanged. Source of truth for whether analytics may run. |

### Provider placement

`PostHogProvider` mounts **inside** the existing `ConsentProvider` (so it can read
`useConsent()`) and **inside** Clerk's provider (so `useIdentify` can read auth). It
renders children regardless of consent — when consent is absent it simply never
initializes PostHog, so `track()` and autocapture no-op.

---

## 3. Consent-Gated Initialization

PostHog must never load or capture until the user has actively granted analytics
consent, and must stop immediately on revoke.

Behavior, driven by `useConsent().state?.analytics`:

- **Consent granted (true):**
  - First time: `posthog.init(KEY, { api_host: '/ingest', ui_host: 'https://eu.posthog.com', ... })`, then `posthog.opt_in_capturing()`.
  - Already initialized but previously opted out: `posthog.opt_in_capturing()` + resume replay.
- **Consent absent (null) or revoked (false):**
  - If initialized: `posthog.opt_out_capturing()` and stop session recording.
  - If never initialized: do nothing.

Init options of note:

- `api_host: '/ingest'` (the reverse-proxy path), `ui_host: 'https://eu.posthog.com'`.
- `capture_pageview: false` (we do it manually — see §5).
- `autocapture: true`.
- `disable_session_recording: false` but with masking config (§4).
- `persistence: 'localStorage+cookie'` — acceptable because init only happens
  post-consent; the analytics cookie category is what the banner authorizes.
- `opt_out_capturing_by_default: true` as a belt-and-suspenders default.

`CONSENT_VERSION` bumps already invalidate stored consent (existing behavior), which
will correctly force re-consent before PostHog runs again.

---

## 4. Identity & Session Replay

### Identity

- On authenticated state (Clerk `useAuth().isSignedIn` + `userId`): `posthog.identify(userId)`.
  Optionally set a small set of person properties later (none in v1 — keep PII minimal).
- On sign-out transition: `posthog.reset()` to detach the anonymous→identified link.
- Anonymous pre-login events stitch to the identified profile automatically on `identify`.

### Session replay

Users type free-form answers and personal text, so replay defaults to maximum masking:

- `session_recording: { maskAllInputs: true, maskTextSelector: '*' }` (mask all text by
  default). Selectively unmask clearly non-sensitive chrome later if needed.
- No network payload capture of request/response bodies.

This keeps replay useful for layout/interaction debugging without recording answer
content or PII verbatim.

---

## 5. Pageviews (App Router)

PostHog autocapture's default `$pageview` only fires on full document loads, missing
Next.js App Router client-side navigations. `usePageviews` captures `$pageview`
manually:

- Effect keyed on `usePathname()` + `useSearchParams()`.
- Fires `posthog.capture('$pageview', { $current_url: ... })` on change, only when
  PostHog is initialized.

`capture_pageview: false` in init prevents double-counting.

---

## 6. Event Taxonomy (Core Set)

A single typed wrapper centralizes events and prevents typos / drift.

`apps/web/lib/analytics/track.ts`:

```ts
export type AnalyticsEvent =
  | 'drill_started'
  | 'drill_completed'
  | 'exercise_submitted'
  | 'debrief_viewed'
  | 'curriculum_map_opened'
  | 'vocab_review_started'
  | 'theory_page_opened'
  | 'reading_annotation_used'
  | 'onboarding_step_completed'
  | 'consent_updated';

// Shared, optional props attached where available so events slice by existing dims.
export type AnalyticsProps = {
  language?: string;       // e.g. 'tr'
  cefr?: string;           // e.g. 'B1'
  exerciseType?: string;   // ExerciseType value where relevant
  [key: string]: unknown;
};

export function track(event: AnalyticsEvent, props?: AnalyticsProps): void;
```

`track()` no-ops unless PostHog is initialized (which itself requires consent), so
call sites need no consent checks.

### Events and where they fire

| Event | Fired from | Key props |
|---|---|---|
| `drill_started` | drill session start | `language`, `cefr` |
| `drill_completed` | drill session end | `language`, `cefr`, count/score summary |
| `exercise_submitted` | exercise submit (client-observed) | `exerciseType`, `correct` (bool), `language`, `cefr` |
| `debrief_viewed` | debrief surface mount | `language` |
| `curriculum_map_opened` | curriculum map open | `language` |
| `vocab_review_started` | vocab review start | `language` |
| `theory_page_opened` | theory page open | `language`, `cefr` |
| `reading_annotation_used` | annotate (skim/deep) action | `language`, `mode` (skim/deep) |
| `onboarding_step_completed` | onboarding step advance | `step` |
| `consent_updated` | consent grant/revoke | `analytics` (bool) |

Everything else (button clicks, navigation) relies on autocapture. The exact call
sites are enumerated in the implementation plan; this set is the contract.

`consent_updated` is special: it must be emitted **only** on grant (when capture is
allowed) — a revoke is recorded by the opt-out call itself, not by a post-revoke
event.

---

## 7. Compliance Touch-ups

The 2026-06-20 compliance spec left the analytics category as a placeholder. Update
the published policies (web legal pages) to disclose PostHog:

- **Privacy policy** — add PostHog (PostHog Inc. / EU Cloud) as an analytics
  sub-processor; state data is processed in the EU.
- **Cookie policy** — list PostHog cookies under the existing **analytics** category
  (set/used only after consent).

No change to the banner or consent mechanics — only disclosure copy.

---

## 8. Deferred: Server-Side Events

Client-only is the chosen starting point. Server-side capture (PostHog Node SDK in
the Hono Lambda) is deferred until a concrete question requires data the client can't
observe reliably — e.g. AI eval success/failure, generation outcomes, server timings.
When added, it will reuse the same person distinct-id (Clerk user ID) for stitching.
Documented here so it's a deliberate later step, not an oversight.

---

## 9. Configuration

Env vars (web, public):

| Var | Purpose | Production | Preview |
|---|---|---|---|
| `NEXT_PUBLIC_POSTHOG_KEY` | Project API key | prod PostHog project | dev PostHog project |
| `NEXT_PUBLIC_POSTHOG_HOST` | Ingestion host (proxied) | `/ingest` | `/ingest` |

- Added to `apps/web/.env.example` and Vercel (Production scope → prod project key,
  Preview scope → dev project key), mirroring the existing env matrix.
- Next.js `rewrites` in `apps/web/next.config.*`: `/ingest/static/* → eu-assets.i.posthog.com/static/*`
  and `/ingest/* → eu.i.posthog.com/*` (per PostHog's reverse-proxy guidance).
- If `NEXT_PUBLIC_POSTHOG_KEY` is unset, `PostHogProvider` is inert (local dev without
  a key still works; analytics simply never initializes).

---

## 10. Testing

- **`track()` wrapper:** no-ops when PostHog uninitialized; forwards event + props when
  initialized (PostHog mocked).
- **Consent-gated init:** with mocked `useConsent`, granting consent calls
  `init`/`opt_in_capturing`; revoking calls `opt_out_capturing` + stops recording;
  absent consent never initializes.
- **Identity:** sign-in calls `identify(userId)`; sign-out calls `reset()` (Clerk hooks mocked).
- **Pageviews:** route change fires `$pageview` only when initialized.
- PostHog SDK and Clerk hooks are mocked — no network in tests. Existing consent
  banner/gate tests remain unchanged.

---

## 11. Implementation Notes / Risks

- **No double pageviews** — verify `capture_pageview: false` + manual capture don't overlap.
- **Replay PII** — manually QA a replay to confirm typed answers are masked before
  relying on replay with real users.
- **Ad-blockers** — the reverse proxy mitigates but doesn't fully eliminate; acceptable.
- **Provider ordering** — `PostHogProvider` must sit inside both `ConsentProvider` and
  Clerk's provider; getting the tree order wrong breaks `useConsent`/`useAuth`.
- **Bundle size** — `posthog-js` is loaded unconditionally but init is gated; consider
  lazy-loading the SDK only after consent in a later optimization (not v1).
