# PostHog Product Analytics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add client-only, consent-gated PostHog (EU Cloud) product analytics + session replay to the Next.js web app.

**Architecture:** A thin, mockable PostHog wrapper module (`lib/analytics/posthog.ts`) isolates the SDK. A `PostHogProvider` initializes/opts-in/opts-out PostHog driven by the existing `useConsent()` analytics category. Child hooks handle Clerk identity stitching and manual App Router `$pageview` capture. A typed `track()` wrapper is the single contract for ~10 named feature events; everything else rides autocapture. Ingestion is reverse-proxied via Next.js rewrites.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, `posthog-js` (+ `posthog-js/react`), Clerk, Vitest + Testing Library + jsdom.

**Reference spec:** `docs/superpowers/specs/2026-06-21-posthog-product-analytics-design.md`

## Global Constraints

- **Package policy:** install the latest stable `posthog-js` (no pin unless a reason is documented in a comment). Add to `apps/web` only.
- **Consent gating is absolute:** PostHog must never `init` or capture until `hasConsent('analytics') === true`; on revoke it must `opt_out_capturing()` and stop recording. Reuse the existing consent plumbing in `apps/web/lib/consent/consent.ts` + `apps/web/components/consent/*` — do NOT add new consent storage.
- **Region:** EU Cloud. `ui_host: 'https://eu.posthog.com'`; ingestion via the proxied `/ingest` path (rewrites target `eu.i.posthog.com` / `eu-assets.i.posthog.com`).
- **Replay PII:** session replay masks all inputs and all text by default (`maskAllInputs: true`, `maskTextSelector: '*'`).
- **Inert without a key:** if `NEXT_PUBLIC_POSTHOG_KEY` is unset, the wrapper no-ops (local dev works with no key).
- **Pre-push gate (run from repo root before any push):** `pnpm lint && pnpm typecheck && pnpm test` — zero failures.
- **Worktree:** all work happens in `/Users/seal/dev/language-drill/.claude/worktrees/feat-posthog-analytics` on branch `worktree-feat-posthog-analytics`. Use paths relative to that root; assert the branch before each commit.
- **Test command (web):** `pnpm --filter @language-drill/web test` (Vitest, jsdom). Mock `posthog-js` / the wrapper module — never hit the network in tests.

---

## File Structure

**New files:**
- `apps/web/lib/analytics/posthog.ts` — thin SDK wrapper (init/opt-in/opt-out/capture/identify/reset/isReady). The only file that imports `posthog-js`.
- `apps/web/lib/analytics/posthog.test.ts` — wrapper unit tests.
- `apps/web/lib/analytics/track.ts` — typed `track()` + `AnalyticsEvent` union + `AnalyticsProps`.
- `apps/web/lib/analytics/track.test.ts` — `track()` unit tests.
- `apps/web/components/analytics/posthog-provider.tsx` — consent-gated provider; mounts identity + pageview hooks.
- `apps/web/components/analytics/use-identify.ts` — Clerk identity stitching.
- `apps/web/components/analytics/use-pageviews.ts` — manual `$pageview` on route change.
- `apps/web/components/analytics/__tests__/posthog-provider.test.tsx` — provider tests.
- `apps/web/components/analytics/__tests__/use-identify.test.tsx` — identity tests.
- `apps/web/components/analytics/__tests__/use-pageviews.test.tsx` — pageview tests.

**Modified files:**
- `apps/web/package.json` — add `posthog-js`.
- `apps/web/next.config.ts` — add `rewrites()` for `/ingest`; set `skipTrailingSlashRedirect: true`.
- `apps/web/.env.example` — document `NEXT_PUBLIC_POSTHOG_KEY` / `NEXT_PUBLIC_POSTHOG_HOST`.
- `apps/web/app/layout.tsx` — mount `PostHogProvider` inside `ConsentProvider`.
- Feature call-sites (Task 8) — drill, exercise submit, debrief, curriculum map, vocab review, theory, reading annotation, onboarding.
- `apps/web/components/consent/cookie-banner.tsx` — update copy ("only after you opt in", drop "Not active today").
- `apps/web/app/(legal)/cookies/page.tsx` — disclose PostHog under Analytics.
- `apps/web/app/(legal)/_content/constants.ts` — add PostHog sub-processor; bump `lastUpdated`.
- `apps/web/app/(legal)/__tests__/legal-pages.test.tsx` — assert PostHog disclosure.

---

## Task 1: Install SDK, reverse proxy, env config

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/next.config.ts`
- Modify: `apps/web/.env.example`

**Interfaces:**
- Produces: `posthog-js` available to import; `/ingest/*` proxied to PostHog EU; env vars `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` documented.

- [ ] **Step 1: Install posthog-js (latest stable)**

Run from repo root:
```bash
pnpm --filter @language-drill/web add posthog-js
```
Expected: `posthog-js` appears in `apps/web/package.json` dependencies.

- [ ] **Step 2: Add the reverse-proxy rewrites to `apps/web/next.config.ts`**

Replace the `nextConfig` object so it includes `rewrites()` and `skipTrailingSlashRedirect` (keep the existing `transpilePackages` and the `withSentryConfig` wrapper exactly as-is):

```ts
const nextConfig: NextConfig = {
  transpilePackages: ['@language-drill/api-client', '@language-drill/shared'],
  // PostHog reverse proxy (EU Cloud). Keeps ingestion first-party so ad-blockers
  // don't break it and no third-party host is contacted directly.
  skipTrailingSlashRedirect: true,
  async rewrites() {
    return [
      { source: '/ingest/static/:path*', destination: 'https://eu-assets.i.posthog.com/static/:path*' },
      { source: '/ingest/:path*', destination: 'https://eu.i.posthog.com/:path*' },
      { source: '/ingest/decide', destination: 'https://eu.i.posthog.com/decide' },
    ];
  },
};
```

- [ ] **Step 3: Document env vars in `apps/web/.env.example`**

Append:
```bash
# PostHog product analytics (client-only, consent-gated). EU Cloud.
# Leave NEXT_PUBLIC_POSTHOG_KEY unset locally to disable analytics entirely.
NEXT_PUBLIC_POSTHOG_KEY=
NEXT_PUBLIC_POSTHOG_HOST=/ingest
```

- [ ] **Step 4: Verify typecheck + build config parse**

Run:
```bash
pnpm --filter @language-drill/web typecheck
```
Expected: PASS (no type errors from the config change).

- [ ] **Step 5: Commit**

```bash
git add apps/web/package.json apps/web/next.config.ts apps/web/.env.example ../../../pnpm-lock.yaml
git commit -m "feat(analytics): install posthog-js + reverse-proxy rewrites + env"
```
> Note: the lockfile lives at the repo root; adjust the relative path if `git add` reports it missing, or `git add -A` the lockfile from the repo root.

---

## Task 2: PostHog wrapper module (`lib/analytics/posthog.ts`)

**Files:**
- Create: `apps/web/lib/analytics/posthog.ts`
- Test: `apps/web/lib/analytics/posthog.test.ts`

**Interfaces:**
- Consumes: `posthog-js`, `process.env.NEXT_PUBLIC_POSTHOG_KEY`, `process.env.NEXT_PUBLIC_POSTHOG_HOST`.
- Produces:
  - `initAnalytics(): void` — idempotent; inits PostHog once if a key exists and not already initialized. Inert with no key.
  - `optInAnalytics(): void` — `opt_in_capturing()` + `startSessionRecording()` (only if ready).
  - `optOutAnalytics(): void` — `opt_out_capturing()` + `stopSessionRecording()` (only if ready).
  - `captureEvent(event: string, props?: Record<string, unknown>): void` — no-op unless ready.
  - `identifyUser(distinctId: string): void` — no-op unless ready.
  - `resetUser(): void` — no-op unless ready.
  - `isReady(): boolean` — true once initialized with a key.

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/analytics/posthog.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const posthog = {
  init: vi.fn(),
  opt_in_capturing: vi.fn(),
  opt_out_capturing: vi.fn(),
  startSessionRecording: vi.fn(),
  stopSessionRecording: vi.fn(),
  capture: vi.fn(),
  identify: vi.fn(),
  reset: vi.fn(),
};
vi.mock('posthog-js', () => ({ default: posthog }));

async function load() {
  vi.resetModules();
  return import('./posthog');
}

describe('analytics/posthog wrapper', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', 'phc_test');
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_HOST', '/ingest');
  });

  it('initAnalytics inits once with masking + opt-out defaults', async () => {
    const m = await load();
    m.initAnalytics();
    m.initAnalytics();
    expect(posthog.init).toHaveBeenCalledTimes(1);
    const [key, opts] = posthog.init.mock.calls[0];
    expect(key).toBe('phc_test');
    expect(opts.api_host).toBe('/ingest');
    expect(opts.capture_pageview).toBe(false);
    expect(opts.opt_out_capturing_by_default).toBe(true);
    expect(opts.session_recording.maskAllInputs).toBe(true);
    expect(m.isReady()).toBe(true);
  });

  it('is inert when no key is set', async () => {
    vi.stubEnv('NEXT_PUBLIC_POSTHOG_KEY', '');
    const m = await load();
    m.initAnalytics();
    m.captureEvent('x');
    expect(posthog.init).not.toHaveBeenCalled();
    expect(posthog.capture).not.toHaveBeenCalled();
    expect(m.isReady()).toBe(false);
  });

  it('opt-in/opt-out drive capturing + recording only when ready', async () => {
    const m = await load();
    m.optInAnalytics(); // not ready yet
    expect(posthog.opt_in_capturing).not.toHaveBeenCalled();
    m.initAnalytics();
    m.optInAnalytics();
    expect(posthog.opt_in_capturing).toHaveBeenCalledTimes(1);
    expect(posthog.startSessionRecording).toHaveBeenCalledTimes(1);
    m.optOutAnalytics();
    expect(posthog.opt_out_capturing).toHaveBeenCalledTimes(1);
    expect(posthog.stopSessionRecording).toHaveBeenCalledTimes(1);
  });

  it('capture/identify/reset forward only when ready', async () => {
    const m = await load();
    m.captureEvent('e', { a: 1 }); // not ready
    expect(posthog.capture).not.toHaveBeenCalled();
    m.initAnalytics();
    m.captureEvent('e', { a: 1 });
    m.identifyUser('user_1');
    m.resetUser();
    expect(posthog.capture).toHaveBeenCalledWith('e', { a: 1 });
    expect(posthog.identify).toHaveBeenCalledWith('user_1');
    expect(posthog.reset).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- posthog.test`
Expected: FAIL (`./posthog` cannot be resolved).

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/lib/analytics/posthog.ts`:
```ts
import posthog from 'posthog-js';

let ready = false;

function key(): string {
  return process.env.NEXT_PUBLIC_POSTHOG_KEY ?? '';
}

/** Idempotent. Inits PostHog once if a key exists. No-op otherwise. */
export function initAnalytics(): void {
  if (ready || !key() || typeof window === 'undefined') return;
  posthog.init(key(), {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST ?? '/ingest',
    ui_host: 'https://eu.posthog.com',
    capture_pageview: false, // App Router: captured manually in use-pageviews
    autocapture: true,
    opt_out_capturing_by_default: true, // belt-and-suspenders; opt-in happens on consent
    persistence: 'localStorage+cookie',
    session_recording: { maskAllInputs: true, maskTextSelector: '*' },
  });
  ready = true;
}

export function isReady(): boolean {
  return ready;
}

export function optInAnalytics(): void {
  if (!ready) return;
  posthog.opt_in_capturing();
  posthog.startSessionRecording();
}

export function optOutAnalytics(): void {
  if (!ready) return;
  posthog.opt_out_capturing();
  posthog.stopSessionRecording();
}

export function captureEvent(event: string, props?: Record<string, unknown>): void {
  if (!ready) return;
  posthog.capture(event, props);
}

export function identifyUser(distinctId: string): void {
  if (!ready) return;
  posthog.identify(distinctId);
}

export function resetUser(): void {
  if (!ready) return;
  posthog.reset();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- posthog.test`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/analytics/posthog.ts apps/web/lib/analytics/posthog.test.ts
git commit -m "feat(analytics): mockable consent-gated posthog wrapper"
```

---

## Task 3: Typed `track()` wrapper (`lib/analytics/track.ts`)

**Files:**
- Create: `apps/web/lib/analytics/track.ts`
- Test: `apps/web/lib/analytics/track.test.ts`

**Interfaces:**
- Consumes: `captureEvent` from `./posthog`.
- Produces:
  - `type AnalyticsEvent` (string union, exactly the 10 names below).
  - `type AnalyticsProps = { language?: string; cefr?: string; exerciseType?: string; [k: string]: unknown }`.
  - `track(event: AnalyticsEvent, props?: AnalyticsProps): void` — delegates to `captureEvent`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/analytics/track.test.ts`:
```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./posthog', () => ({ captureEvent: vi.fn() }));
import { captureEvent } from './posthog';
import { track } from './track';

describe('track()', () => {
  beforeEach(() => vi.clearAllMocks());

  it('forwards event name and props to captureEvent', () => {
    track('drill_started', { language: 'tr', cefr: 'B1' });
    expect(captureEvent).toHaveBeenCalledWith('drill_started', { language: 'tr', cefr: 'B1' });
  });

  it('works with no props', () => {
    track('debrief_viewed');
    expect(captureEvent).toHaveBeenCalledWith('debrief_viewed', undefined);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- track.test`
Expected: FAIL (`./track` cannot be resolved).

- [ ] **Step 3: Write minimal implementation**

Create `apps/web/lib/analytics/track.ts`:
```ts
import { captureEvent } from './posthog';

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

export type AnalyticsProps = {
  language?: string;
  cefr?: string;
  exerciseType?: string;
  [key: string]: unknown;
};

/**
 * Single, typed entry point for named product events. No-ops unless PostHog is
 * initialized (which requires analytics consent), so call sites need no guards.
 */
export function track(event: AnalyticsEvent, props?: AnalyticsProps): void {
  captureEvent(event, props);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- track.test`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/analytics/track.ts apps/web/lib/analytics/track.test.ts
git commit -m "feat(analytics): typed track() event wrapper"
```

---

## Task 4: Consent-gated `PostHogProvider`

**Files:**
- Create: `apps/web/components/analytics/posthog-provider.tsx`
- Test: `apps/web/components/analytics/__tests__/posthog-provider.test.tsx`

**Interfaces:**
- Consumes: `useConsent` from `../consent/consent-provider`; `initAnalytics`, `optInAnalytics`, `optOutAnalytics` from `../../lib/analytics/posthog`; `track` from `../../lib/analytics/track`; `useIdentify` (Task 5), `usePageviews` (Task 6).
- Produces: `PostHogProvider` (default + named export) — renders `children` always; drives init/opt-in/opt-out from consent.

> For this task, stub the not-yet-built hooks so the provider compiles independently: create `use-identify.ts` and `use-pageviews.ts` as no-op hooks now (Tasks 5 & 6 replace their bodies + add tests).

- [ ] **Step 1: Create no-op hook stubs (so the provider compiles)**

Create `apps/web/components/analytics/use-identify.ts`:
```ts
'use client';
export function useIdentify(): void {}
```
Create `apps/web/components/analytics/use-pageviews.ts`:
```ts
'use client';
export function usePageviews(): void {}
```

- [ ] **Step 2: Write the failing test**

Create `apps/web/components/analytics/__tests__/posthog-provider.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';

const analytics = {
  initAnalytics: vi.fn(),
  optInAnalytics: vi.fn(),
  optOutAnalytics: vi.fn(),
};
vi.mock('../../../lib/analytics/posthog', () => analytics);
const track = vi.fn();
vi.mock('../../../lib/analytics/track', () => ({ track }));

import { ConsentProvider, useConsent } from '../../consent/consent-provider';
import { PostHogProvider } from '../posthog-provider';

function Grant() {
  const { update } = useConsent();
  return (
    <>
      <button onClick={() => update({ analytics: true })}>grant</button>
      <button onClick={() => update({ analytics: false })}>revoke</button>
    </>
  );
}

function tree() {
  return render(
    <ConsentProvider>
      <Grant />
      <PostHogProvider>
        <span>app</span>
      </PostHogProvider>
    </ConsentProvider>,
  );
}

describe('PostHogProvider', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('renders children and does not init without consent', () => {
    tree();
    expect(screen.getByText('app')).toBeInTheDocument();
    expect(analytics.initAnalytics).not.toHaveBeenCalled();
    expect(analytics.optInAnalytics).not.toHaveBeenCalled();
  });

  it('inits + opts in + emits consent_updated on grant', async () => {
    tree();
    await act(async () => { screen.getByText('grant').click(); });
    expect(analytics.initAnalytics).toHaveBeenCalledTimes(1);
    expect(analytics.optInAnalytics).toHaveBeenCalledTimes(1);
    expect(track).toHaveBeenCalledWith('consent_updated', { analytics: true });
  });

  it('opts out on revoke without emitting an event', async () => {
    tree();
    await act(async () => { screen.getByText('grant').click(); });
    track.mockClear();
    await act(async () => { screen.getByText('revoke').click(); });
    expect(analytics.optOutAnalytics).toHaveBeenCalledTimes(1);
    expect(track).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- posthog-provider`
Expected: FAIL (`../posthog-provider` cannot be resolved).

- [ ] **Step 4: Write minimal implementation**

Create `apps/web/components/analytics/posthog-provider.tsx`:
```tsx
'use client';

import { useEffect } from 'react';
import { useConsent } from '../consent/consent-provider';
import { initAnalytics, optInAnalytics, optOutAnalytics } from '../../lib/analytics/posthog';
import { track } from '../../lib/analytics/track';
import { useIdentify } from './use-identify';
import { usePageviews } from './use-pageviews';

/**
 * Drives PostHog lifecycle from the analytics consent category. Renders children
 * unconditionally; analytics simply never initializes until consent is granted.
 */
export function PostHogProvider({ children }: { children: React.ReactNode }) {
  const { state } = useConsent();
  const consented = state?.analytics === true;

  useEffect(() => {
    if (consented) {
      initAnalytics();
      optInAnalytics();
      // Capture-allowed now; record the opt-in. A revoke is recorded by opt-out itself.
      track('consent_updated', { analytics: true });
    } else {
      optOutAnalytics();
    }
  }, [consented]);

  return (
    <>
      <AnalyticsEffects />
      {children}
    </>
  );
}

/** Hosts app-wide analytics side-effects (identity stitching + manual pageviews). */
function AnalyticsEffects() {
  useIdentify();
  usePageviews();
  return null;
}

export default PostHogProvider;
```

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- posthog-provider`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/analytics/posthog-provider.tsx apps/web/components/analytics/use-identify.ts apps/web/components/analytics/use-pageviews.ts apps/web/components/analytics/__tests__/posthog-provider.test.tsx
git commit -m "feat(analytics): consent-gated PostHogProvider"
```

---

## Task 5: Clerk identity stitching (`useIdentify`)

**Files:**
- Modify: `apps/web/components/analytics/use-identify.ts`
- Test: `apps/web/components/analytics/__tests__/use-identify.test.tsx`

**Interfaces:**
- Consumes: Clerk `useAuth()` (`isLoaded`, `isSignedIn`, `userId`); `identifyUser`, `resetUser` from `../../lib/analytics/posthog`.
- Produces: `useIdentify(): void` — `identifyUser(userId)` on sign-in; `resetUser()` on sign-out transition.

- [ ] **Step 1: Write the failing test**

Create `apps/web/components/analytics/__tests__/use-identify.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

const analytics = { identifyUser: vi.fn(), resetUser: vi.fn() };
vi.mock('../../../lib/analytics/posthog', () => analytics);

let auth: { isLoaded: boolean; isSignedIn: boolean; userId: string | null };
vi.mock('@clerk/nextjs', () => ({ useAuth: () => auth }));

import { useIdentify } from '../use-identify';

function Harness() {
  useIdentify();
  return null;
}

describe('useIdentify', () => {
  beforeEach(() => vi.clearAllMocks());

  it('identifies the user when signed in', () => {
    auth = { isLoaded: true, isSignedIn: true, userId: 'user_42' };
    render(<Harness />);
    expect(analytics.identifyUser).toHaveBeenCalledWith('user_42');
    expect(analytics.resetUser).not.toHaveBeenCalled();
  });

  it('does nothing until Clerk is loaded', () => {
    auth = { isLoaded: false, isSignedIn: false, userId: null };
    render(<Harness />);
    expect(analytics.identifyUser).not.toHaveBeenCalled();
    expect(analytics.resetUser).not.toHaveBeenCalled();
  });

  it('resets on sign-out transition', () => {
    auth = { isLoaded: true, isSignedIn: true, userId: 'user_42' };
    const { rerender } = render(<Harness />);
    analytics.identifyUser.mockClear();
    auth = { isLoaded: true, isSignedIn: false, userId: null };
    rerender(<Harness />);
    expect(analytics.resetUser).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- use-identify`
Expected: FAIL (the stub no-op hook doesn't call anything).

- [ ] **Step 3: Write minimal implementation**

Replace the contents of `apps/web/components/analytics/use-identify.ts`:
```ts
'use client';

import { useEffect, useRef } from 'react';
import { useAuth } from '@clerk/nextjs';
import { identifyUser, resetUser } from '../../lib/analytics/posthog';

/** Stitches PostHog identity to the Clerk user; resets on sign-out. */
export function useIdentify(): void {
  const { isLoaded, isSignedIn, userId } = useAuth();
  const wasSignedIn = useRef(false);

  useEffect(() => {
    if (!isLoaded) return;
    if (isSignedIn && userId) {
      identifyUser(userId);
      wasSignedIn.current = true;
    } else if (wasSignedIn.current) {
      resetUser();
      wasSignedIn.current = false;
    }
  }, [isLoaded, isSignedIn, userId]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- use-identify`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/analytics/use-identify.ts apps/web/components/analytics/__tests__/use-identify.test.tsx
git commit -m "feat(analytics): Clerk identity stitching for PostHog"
```

---

## Task 6: Manual App Router pageviews (`usePageviews`)

**Files:**
- Modify: `apps/web/components/analytics/use-pageviews.ts`
- Test: `apps/web/components/analytics/__tests__/use-pageviews.test.tsx`

**Interfaces:**
- Consumes: Next `usePathname()`, `useSearchParams()`; `captureEvent` from `../../lib/analytics/posthog`.
- Produces: `usePageviews(): void` — fires `captureEvent('$pageview', { $current_url })` on path/search change.

- [ ] **Step 1: Write the failing test**

Create `apps/web/components/analytics/__tests__/use-pageviews.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';

const analytics = { captureEvent: vi.fn() };
vi.mock('../../../lib/analytics/posthog', () => analytics);

let pathname = '/drill';
const search = new URLSearchParams('');
vi.mock('next/navigation', () => ({
  usePathname: () => pathname,
  useSearchParams: () => search,
}));

import { usePageviews } from '../use-pageviews';

function Harness() {
  usePageviews();
  return null;
}

describe('usePageviews', () => {
  beforeEach(() => vi.clearAllMocks());

  it('captures a $pageview on mount', () => {
    pathname = '/drill';
    render(<Harness />);
    expect(analytics.captureEvent).toHaveBeenCalledWith('$pageview', expect.objectContaining({}));
    expect(analytics.captureEvent.mock.calls[0][0]).toBe('$pageview');
  });

  it('captures again when the path changes', () => {
    pathname = '/drill';
    const { rerender } = render(<Harness />);
    expect(analytics.captureEvent).toHaveBeenCalledTimes(1);
    pathname = '/progress';
    rerender(<Harness />);
    expect(analytics.captureEvent).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- use-pageviews`
Expected: FAIL (stub no-op hook).

- [ ] **Step 3: Write minimal implementation**

Replace the contents of `apps/web/components/analytics/use-pageviews.ts`:
```ts
'use client';

import { useEffect } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { captureEvent } from '../../lib/analytics/posthog';

/** Fires a manual $pageview on App Router client navigations (autocapture misses these). */
export function usePageviews(): void {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!pathname) return;
    const qs = searchParams?.toString();
    const url =
      typeof window !== 'undefined'
        ? window.location.href
        : pathname + (qs ? `?${qs}` : '');
    captureEvent('$pageview', { $current_url: url });
  }, [pathname, searchParams]);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @language-drill/web test -- use-pageviews`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/analytics/use-pageviews.ts apps/web/components/analytics/__tests__/use-pageviews.test.tsx
git commit -m "feat(analytics): manual App Router pageview capture"
```

---

## Task 7: Mount `PostHogProvider` in the root layout

**Files:**
- Modify: `apps/web/app/layout.tsx`

**Interfaces:**
- Consumes: `PostHogProvider` from `../components/analytics/posthog-provider`.
- Produces: provider mounted inside `ConsentProvider` (so it can read consent) and inside `ClerkProvider` (so `useIdentify` can read auth), wrapping `<Providers>`.

- [ ] **Step 1: Add the import**

In `apps/web/app/layout.tsx`, after the `CookieBanner` import line, add:
```tsx
import { PostHogProvider } from '../components/analytics/posthog-provider';
```

- [ ] **Step 2: Wrap `<Providers>` with `<PostHogProvider>`**

Change the body so `PostHogProvider` sits inside `ConsentProvider` and around `Providers`:
```tsx
<ConsentProvider>
  <PostHogProvider>
    <Providers>{children}</Providers>
  </PostHogProvider>
  <CookieBanner />
</ConsentProvider>
```

- [ ] **Step 3: Verify typecheck + the web suite still pass**

Run:
```bash
pnpm --filter @language-drill/web typecheck
pnpm --filter @language-drill/web test
```
Expected: both PASS (no regressions; analytics tests green).

- [ ] **Step 4: Commit**

```bash
git add apps/web/app/layout.tsx
git commit -m "feat(analytics): mount PostHogProvider in root layout"
```

---

## Task 8: Instrument the core feature events

Insert `track(...)` calls at the call-sites below. Each is a small edit; group them in one task since they share the same pattern and a single reviewer gate. Use the active language/CEFR already in scope at each site; if a value isn't readily available, omit that optional prop (do NOT thread new props through components just to populate it).

**Files (modify):**
- `apps/web/app/(dashboard)/drill/page.tsx` — `drill_started`, `drill_completed`, `exercise_submitted`
- `apps/web/app/(dashboard)/drill/debrief/[sessionId]/page.tsx` — `debrief_viewed`
- `apps/web/app/(dashboard)/progress/_components/map-tab.tsx` — `curriculum_map_opened`
- `apps/web/app/(dashboard)/review/session/page.tsx` — `vocab_review_started`
- `apps/web/app/(dashboard)/theory/[topicId]/page.tsx` — `theory_page_opened`
- `apps/web/app/(dashboard)/read/_components/annotated-text.tsx` — `reading_annotation_used`
- `apps/web/app/onboarding/page.tsx` — `onboarding_step_completed`

**Interfaces:**
- Consumes: `track` from the appropriate relative path to `apps/web/lib/analytics/track` (e.g. `../../../../lib/analytics/track` from a `(dashboard)/x/page.tsx` — count directory depth per file).

> Pattern for every site: import `track`, then call it in the success handler / mount effect. `track()` is a safe no-op when analytics is off, so no guards are needed.

- [ ] **Step 1: Drill start + complete + submit** (`drill/page.tsx`)
  - In the `createSession` success path (mount effect around lines 181–192): `track('drill_started', { language, cefr })` using the page's active language/level.
  - In `fireCompleteSession()` `onSuccess` (around lines 141–148): `track('drill_completed', { language, cefr })`.
  - In the submit-answer mutation `onSuccess` at the call-site (around lines 257–262): `track('exercise_submitted', { exerciseType, correct, language, cefr })` reading `correct` from the response and `exerciseType` from the current exercise.

- [ ] **Step 2: Debrief viewed** (`drill/debrief/[sessionId]/page.tsx`)
  - When `useSessionDebrief` resolves (around lines 37–50), fire once on first successful load: `track('debrief_viewed', { language })`. Guard against refiring with a `useRef` flag.

- [ ] **Step 3: Curriculum map opened** (`progress/_components/map-tab.tsx`)
  - On first arrival of the map `data` prop (around lines 19–25), fire once: `track('curriculum_map_opened', { language })`. Use a `useRef` guard.

- [ ] **Step 4: Vocab review started** (`review/session/page.tsx`)
  - In the `useStartReviewSession` `onSuccess` (around lines 86–93): `track('vocab_review_started', { language })`.

- [ ] **Step 5: Theory page opened** (`theory/[topicId]/page.tsx`)
  - When `useTheoryTopic` resolves (around lines 20–47), fire once: `track('theory_page_opened', { language, cefr })`. Use a `useRef` guard keyed on `topicId`.

- [ ] **Step 6: Reading annotation used** (`read/_components/annotated-text.tsx`)
  - In the `onSpanSelect` handler (around lines 176–186): `track('reading_annotation_used', { language, mode })` where `mode` is the skim/deep distinction available in scope (omit if not available).

- [ ] **Step 7: Onboarding step completed** (`onboarding/page.tsx`)
  - In the step-advance handler (the `goNext` dispatch / `handleComplete`, around lines 167–196): `track('onboarding_step_completed', { step })` with the step index/name being completed.

- [ ] **Step 8: Verify typecheck + web suite**

Run:
```bash
pnpm --filter @language-drill/web typecheck
pnpm --filter @language-drill/web test
```
Expected: both PASS. (No new unit tests required for these thin call-site edits; they're covered by typecheck + the wrapper tests. If a site already has a test that renders it, ensure `track`/`posthog-js` are mocked there to avoid network — add `vi.mock('.../lib/analytics/track', () => ({ track: vi.fn() }))` if a render error appears.)

- [ ] **Step 9: Commit**

```bash
git add apps/web/app apps/web/components
git commit -m "feat(analytics): instrument core product events"
```

---

## Task 9: Compliance copy & disclosure updates

**Files:**
- Modify: `apps/web/components/consent/cookie-banner.tsx`
- Modify: `apps/web/app/(legal)/cookies/page.tsx`
- Modify: `apps/web/app/(legal)/_content/constants.ts`
- Modify: `apps/web/app/(legal)/__tests__/legal-pages.test.tsx`

**Interfaces:**
- Consumes: `LEGAL.subProcessors` (existing).
- Produces: PostHog disclosed as an analytics sub-processor + in the cookie policy; banner copy no longer claims "only strictly-necessary cookies / not active today".

- [ ] **Step 1: Write/extend the failing test**

In `apps/web/app/(legal)/__tests__/legal-pages.test.tsx`, add an assertion that the cookies page now names PostHog under analytics, and that the privacy page lists PostHog as a sub-processor:
```tsx
it('cookies page discloses PostHog under analytics', () => {
  const { container } = render(<CookiesPage />);
  expect(container.textContent).toContain('PostHog');
});
```
(The existing "names ... all sub-processors" test will additionally require PostHog once it's added to `LEGAL.subProcessors`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @language-drill/web test -- legal-pages`
Expected: FAIL ("PostHog" not present yet).

- [ ] **Step 3: Add PostHog sub-processor + bump date** (`_content/constants.ts`)

Add to the `subProcessors` array and update `lastUpdated`:
```ts
  lastUpdated: '2026-06-21',
  ...
    { name: 'PostHog', purpose: 'Product analytics and session replay (EU region; loads only after you opt in)' },
```

- [ ] **Step 4: Update the cookie policy Analytics section** (`cookies/page.tsx`)

Replace the Analytics `<p>` with:
```tsx
      <p>
        We use <strong>PostHog</strong> (EU region) for product analytics and session
        replay. It loads <strong>only after you opt in</strong> using the cookie banner,
        sets analytics cookies, and records masked session replays (your typed answers are
        masked). You can change your choice at any time via the &ldquo;Cookie
        preferences&rdquo; link in the footer.
      </p>
```

- [ ] **Step 5: Update the banner copy** (`cookie-banner.tsx`)

- In the preferences dialog, change the Analytics list item from "Off unless you turn it on. Not active today." to: `Off unless you turn it on. Powered by PostHog (EU); masks your typed answers.`
- In the notice paragraph, change "We use only strictly-necessary cookies. We'll ask before enabling any analytics." to: `We use strictly-necessary cookies, and analytics only if you opt in.`

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/web test -- legal-pages cookie-banner`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/app/(legal)" apps/web/components/consent/cookie-banner.tsx
git commit -m "docs(legal): disclose PostHog in cookie + privacy policies and banner"
```

---

## Task 10: Full gate + Vercel env note

**Files:** none (verification + documentation).

- [ ] **Step 1: Run the full pre-push gate from repo root**

```bash
pnpm lint
pnpm typecheck
pnpm test
```
Expected: all PASS, zero failures. Fix anything red before proceeding.

- [ ] **Step 2: Record the deploy-time env requirement**

This plan does not set Vercel env vars (that's a dashboard action). Before/after merge, the operator must set in Vercel:
- `NEXT_PUBLIC_POSTHOG_KEY` — Production scope → prod PostHog project key; Preview scope → dev PostHog project key.
- `NEXT_PUBLIC_POSTHOG_HOST` = `/ingest` (both scopes).

Create the two PostHog projects (EU Cloud) first to obtain the keys. No CDK/GitHub-secret changes are needed (client-only, public env vars).

- [ ] **Step 3: Manual replay PII QA (post-deploy, before relying on replay)**

On a Preview deploy: grant analytics consent, type a free-form answer, then open the resulting session replay in PostHog and confirm the typed text is masked. If anything leaks, tighten `maskTextSelector` / add `ph-no-capture` classes before using replay with real users.

---

## Self-Review

**Spec coverage:**
- §2 Architecture / components → Tasks 2–7. ✓
- §3 Consent-gated init → Task 4 (+ wrapper opt-out defaults Task 2). ✓
- §4 Identity + replay masking → Task 5 (identity) + Task 2 (masking opts). ✓
- §5 Manual pageviews → Task 6. ✓
- §6 Event taxonomy (10 events) → Task 3 (union) + Task 8 (9 call-sites) + Task 4 (`consent_updated`). ✓
- §7 Compliance disclosure → Task 9. ✓
- §8 Server-side deferred → out of scope, no task (correct). ✓
- §9 Config (deps, proxy, env) → Task 1 + Task 10 (Vercel). ✓
- §10 Testing → tests in Tasks 2–6, 9; full gate Task 10. ✓
- §11 Risks (double pageview via `capture_pageview:false`, replay PII QA, provider ordering) → Tasks 2, 7, 10. ✓

**Placeholder scan:** No TBD/TODO; all code shown; commands have expected output. The "around line N" references in Task 8 are advisory anchors from a codebase survey, not placeholders — each step states the exact event + props to add.

**Type consistency:** `AnalyticsEvent`/`AnalyticsProps` (Task 3) used consistently in Task 8. Wrapper fn names (`initAnalytics`, `optInAnalytics`, `optOutAnalytics`, `captureEvent`, `identifyUser`, `resetUser`, `isReady`) defined in Task 2 and referenced identically in Tasks 3–6. `track('consent_updated', { analytics: boolean })` shape matches between Task 3 union and Task 4 usage.
