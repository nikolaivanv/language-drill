# US + EU Minimum Legal Compliance — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the minimum legal-compliance surface (privacy/terms/cookie pages, a cookie-consent banner with consent plumbing, and a "download my data" JSON export) for a US + EU/GDPR audience.

**Architecture:** Three static legal pages live in a public `(legal)` route group. A small client-side consent module (localStorage) drives a banner + `ConsentGate` so a future PostHog integration mounts behind consent with zero further work. A new authenticated `GET /me/export` Hono route serializes every user-keyed table to a downloadable JSON. Everything is surfaced via a new settings section and footer links. Account deletion already exists (Clerk `<UserProfile>`), so it is only linked, not built.

**Tech Stack:** Next.js App Router + TypeScript (apps/web), Hono on Lambda (infra/lambda), Drizzle ORM (packages/db), Zod (packages/api-client), Vitest + Testing Library, Clerk auth.

## Global Constraints

- **Spec:** `docs/superpowers/specs/2026-06-20-compliance-us-eu-design.md`.
- **Controller identity (verbatim):** `Ivan Nikola`, an individual based in `Hungary`.
- **Contact email (verbatim):** `info@langdrill.app`.
- **Governing law (verbatim):** `Hungary`.
- **Minimum age (verbatim):** `16`.
- **Last-updated date (verbatim):** `2026-06-20`.
- **Sub-processors (verbatim, exactly these 9):** Clerk (authentication), AWS (compute, storage, speech), Anthropic (answer evaluation), Neon (database), Upstash (rate limiting), Vercel (hosting), Sentry (error monitoring), Langfuse (LLM-call observability), Cloudflare (DNS + email forwarding).
- **Consent default:** analytics category `false` (off) by default; Sentry stays ungated.
- **Pre-push gate:** `pnpm lint && pnpm typecheck && pnpm test` must all pass before pushing.
- **Package management:** latest stable; no new deps unless a task explicitly adds one (this plan adds none).
- **Worktree:** all work happens in `/Users/seal/dev/language-drill/.claude/worktrees/compliance-us-eu` on branch `worktree-compliance-us-eu`. Use that path for every command; assert the branch before each commit.

---

## File Structure

**New (apps/web):**
- `app/(legal)/_content/constants.ts` — single source for controller/contact/date/jurisdiction + sub-processor list.
- `app/(legal)/layout.tsx` — shared prose layout (last-updated, back link, not-legal-advice note).
- `app/(legal)/privacy/page.tsx`, `app/(legal)/terms/page.tsx`, `app/(legal)/cookies/page.tsx`.
- `lib/consent/consent.ts` + `lib/consent/consent.test.ts` — consent state module.
- `components/consent/consent-provider.tsx` — context + `useConsent()`.
- `components/consent/consent-gate.tsx` — `<ConsentGate>`.
- `components/consent/cookie-banner.tsx` — banner + preferences panel.
- `components/consent/__tests__/cookie-banner.test.tsx`, `consent-gate.test.tsx`.
- `components/settings/privacy-data-section.tsx` — settings section (export button + links).
- `lib/data-export.ts` — client helper that fetches + saves the export file.
- `components/legal/legal-links.tsx` — shared footer legal-links block (reused by 3 footers).

**Modified (apps/web):**
- `middleware.ts` — public routes for legal pages.
- `app/layout.tsx` — mount `ConsentProvider` + `CookieBanner`.
- `components/settings/settings-nav.tsx` — add nav entry.
- `app/(dashboard)/settings/page.tsx` — render new section.
- `app/_landing/drill-landing.tsx` (`DFooter`), `app/_landing/drill-landing-mobile.tsx` (`MFooter`), `components/shell/user-footer.tsx` — legal links.

**New (infra/lambda):**
- `src/routes/user-export.ts` — `collectUserExport(db, userId)` serializer.
- `src/routes/user-export.test.ts`.

**Modified (infra/lambda):**
- `src/routes/me.ts` — add `GET /me/export`.

---

## Task 1: Legal content constants + shared legal layout

**Files:**
- Create: `apps/web/app/(legal)/_content/constants.ts`
- Create: `apps/web/app/(legal)/layout.tsx`

**Interfaces:**
- Produces: `LEGAL` object — `{ controller: string; basedIn: string; contactEmail: string; lastUpdated: string; governingLaw: string; minAge: number; subProcessors: Array<{ name: string; purpose: string }> }`.

- [ ] **Step 1: Create the constants module**

```ts
// apps/web/app/(legal)/_content/constants.ts
export const LEGAL = {
  controller: 'Ivan Nikola',
  basedIn: 'Hungary',
  contactEmail: 'info@langdrill.app',
  lastUpdated: '2026-06-20',
  governingLaw: 'Hungary',
  minAge: 16,
  subProcessors: [
    { name: 'Clerk', purpose: 'Authentication and account management' },
    { name: 'Amazon Web Services (AWS)', purpose: 'Compute, storage, speech synthesis and transcription' },
    { name: 'Anthropic', purpose: 'AI evaluation of your written answers' },
    { name: 'Neon', purpose: 'Database hosting' },
    { name: 'Upstash', purpose: 'Rate limiting' },
    { name: 'Vercel', purpose: 'Web application hosting' },
    { name: 'Sentry', purpose: 'Error monitoring (no cookies; user ID only)' },
    { name: 'Langfuse', purpose: 'LLM-call observability (records your user ID and the text of your answers)' },
    { name: 'Cloudflare', purpose: 'DNS and email forwarding for our contact address' },
  ],
} as const;
```

- [ ] **Step 2: Create the shared legal layout**

```tsx
// apps/web/app/(legal)/layout.tsx
import Link from 'next/link';
import { LEGAL } from './_content/constants';

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto max-w-[760px] px-s-5 py-s-7">
      <Link href="/" className="t-small text-ink-soft hover:text-ink">← back to drill</Link>
      <div className="mt-s-5 prose-legal">
        {children}
      </div>
      <p className="mt-s-7 t-small text-ink-mute border-t border-dashed border-rule pt-s-4">
        Last updated: {LEGAL.lastUpdated}. This is a plain-language summary written in good
        faith — it is not legal advice.
      </p>
    </main>
  );
}
```

- [ ] **Step 3: Typecheck**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/compliance-us-eu && pnpm --filter @language-drill/web typecheck`
Expected: PASS (no errors).

- [ ] **Step 4: Commit**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/compliance-us-eu
git branch --show-current   # must print: worktree-compliance-us-eu
git add "apps/web/app/(legal)/_content/constants.ts" "apps/web/app/(legal)/layout.tsx"
git commit -m "feat(legal): legal content constants + shared legal layout"
```

---

## Task 2: Privacy / Terms / Cookies pages + public routes

**Files:**
- Create: `apps/web/app/(legal)/privacy/page.tsx`
- Create: `apps/web/app/(legal)/terms/page.tsx`
- Create: `apps/web/app/(legal)/cookies/page.tsx`
- Create: `apps/web/app/(legal)/__tests__/legal-pages.test.tsx`
- Modify: `apps/web/middleware.ts`

**Interfaces:**
- Consumes: `LEGAL` from Task 1.

- [ ] **Step 1: Write the failing smoke test**

```tsx
// apps/web/app/(legal)/__tests__/legal-pages.test.tsx
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import PrivacyPage from '../privacy/page';
import TermsPage from '../terms/page';
import CookiesPage from '../cookies/page';

// Assert on full rendered text content. getByText skips elements that have
// child elements and throws on multiple matches, which makes it unreliable
// for "is this string present on the page" smoke checks (e.g. a name inside
// a <p> that also contains an <a>, or a word that appears in two paragraphs).

describe('legal pages', () => {
  it('privacy page names the controller, contact, and all sub-processors', () => {
    const { container } = render(<PrivacyPage />);
    const text = container.textContent ?? '';
    expect(text).toContain('Ivan Nikola');
    expect(text).toContain('info@langdrill.app');
    expect(text).toContain('Langfuse');
    expect(text).toContain('Cloudflare');
  });

  it('terms page states governing law and minimum age', () => {
    const { container } = render(<TermsPage />);
    const text = container.textContent ?? '';
    expect(text).toContain('Hungary');
    expect(text).toContain('16');
  });

  it('cookies page distinguishes necessary vs analytics', () => {
    const { container } = render(<CookiesPage />);
    const text = container.textContent ?? '';
    expect(text).toContain('Strictly necessary');
    expect(text).toContain('Analytics');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/compliance-us-eu && pnpm --filter @language-drill/web test -- legal-pages`
Expected: FAIL (cannot resolve `../privacy/page`).

- [ ] **Step 3: Create the privacy page**

```tsx
// apps/web/app/(legal)/privacy/page.tsx
import { LEGAL } from '../_content/constants';

export const metadata = { title: 'Privacy Policy — drill' };

export default function PrivacyPage() {
  return (
    <article>
      <h1>Privacy Policy</h1>

      <h2>Who we are</h2>
      <p>
        drill (&ldquo;the Service&rdquo;) is operated by {LEGAL.controller}, an individual
        based in {LEGAL.basedIn}, who is the data controller for your personal data. You can
        reach us at <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>.
      </p>

      <h2>What we collect and why</h2>
      <ul>
        <li><strong>Account data</strong> — your email address, managed on our behalf by Clerk, to create and secure your account.</li>
        <li><strong>Learning data</strong> — your exercises, written answers, evaluations, vocabulary, reading entries, practice sessions, spaced-repetition state, and grammar-mastery scores, to provide the Service and track your progress.</li>
        <li><strong>Usage data</strong> — counts of AI requests per day, to enforce fair-use limits.</li>
        <li><strong>Diagnostics</strong> — error reports (your user ID only, no answer content) via Sentry, to keep the Service working.</li>
      </ul>

      <h2>Legal bases (GDPR Article 6)</h2>
      <ul>
        <li><strong>Performance of a contract</strong> — to provide the learning features you sign up for.</li>
        <li><strong>Legitimate interests</strong> — security, abuse prevention, and error monitoring.</li>
        <li><strong>Consent</strong> — for optional product analytics, which are off unless you opt in. We do not run analytics today.</li>
      </ul>

      <h2>Who processes your data (sub-processors)</h2>
      <p>We share data only with the service providers we rely on to run drill:</p>
      <ul>
        {LEGAL.subProcessors.map((p) => (
          <li key={p.name}><strong>{p.name}</strong> — {p.purpose}.</li>
        ))}
      </ul>
      <p>
        Some of these providers process data outside the European Economic Area; where they
        do, they rely on appropriate safeguards such as the EU Standard Contractual Clauses.
      </p>

      <h2>How long we keep it</h2>
      <p>
        We keep your data while your account is active. When you delete your account, all of
        your personal data is deleted from our database.
      </p>

      <h2>Your rights</h2>
      <ul>
        <li><strong>Access &amp; portability</strong> — download a machine-readable copy of your data from <em>Settings → privacy &amp; data → Download my data</em>.</li>
        <li><strong>Erasure</strong> — delete your account and all associated data from <em>Settings → account → Security → Delete account</em>.</li>
        <li><strong>Rectification &amp; objection</strong> — contact us at <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>.</li>
        <li>
          You may also lodge a complaint with your local supervisory authority — in {LEGAL.basedIn},
          the Hungarian National Authority for Data Protection and Freedom of Information (NAIH).
        </li>
      </ul>

      <h2>Cookies</h2>
      <p>
        We use only strictly-necessary cookies today. See our <a href="/cookies">Cookie Policy</a> for details.
      </p>
    </article>
  );
}
```

- [ ] **Step 4: Create the terms page**

```tsx
// apps/web/app/(legal)/terms/page.tsx
import { LEGAL } from '../_content/constants';

export const metadata = { title: 'Terms of Service — drill' };

export default function TermsPage() {
  return (
    <article>
      <h1>Terms of Service</h1>

      <h2>The service</h2>
      <p>
        drill is an AI-assisted language-learning app for active production practice,
        operated by {LEGAL.controller} ({LEGAL.basedIn}). By using drill you agree to these terms.
      </p>

      <h2>Eligibility</h2>
      <p>You must be at least {LEGAL.minAge} years old to use drill.</p>

      <h2>Acceptable use</h2>
      <p>
        Use drill for your own language learning. Do not abuse, overload, or attempt to
        circumvent the Service&rsquo;s rate limits or security, and do not submit unlawful content.
      </p>

      <h2>AI-generated content</h2>
      <p>
        Exercises, explanations, and evaluations are generated by AI and may contain errors.
        They are study aids, not professional, educational, or certified language assessment.
        Use your judgement.
      </p>

      <h2>No warranty</h2>
      <p>
        The Service is provided &ldquo;as is&rdquo; without warranties of any kind. To the
        fullest extent permitted by law, we are not liable for any indirect or consequential
        loss arising from your use of the Service.
      </p>

      <h2>Changes</h2>
      <p>
        We may update these terms; the &ldquo;Last updated&rdquo; date below reflects the
        current version. Continued use after a change means you accept it.
      </p>

      <h2>Governing law</h2>
      <p>These terms are governed by the laws of {LEGAL.governingLaw}.</p>

      <h2>Contact</h2>
      <p>Questions? Email <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>.</p>
    </article>
  );
}
```

- [ ] **Step 5: Create the cookies page**

```tsx
// apps/web/app/(legal)/cookies/page.tsx
import { LEGAL } from '../_content/constants';

export const metadata = { title: 'Cookie Policy — drill' };

export default function CookiesPage() {
  return (
    <article>
      <h1>Cookie Policy</h1>

      <p>
        This page explains the cookies and similar local storage drill uses, and how you can
        control them.
      </p>

      <h2>Strictly necessary</h2>
      <p>These are required for drill to work and cannot be switched off:</p>
      <ul>
        <li><strong>Authentication cookies</strong> (Clerk) — keep you signed in.</li>
        <li><strong>Functional storage</strong> — your browser&rsquo;s session storage briefly holds drafts of typed answers so a refresh doesn&rsquo;t lose them.</li>
      </ul>

      <h2>Analytics</h2>
      <p>
        We do not run product analytics today. If we add analytics in the future, it will
        load <strong>only after you opt in</strong> using the cookie banner. You can change
        your choice at any time via the &ldquo;Cookie preferences&rdquo; link in the footer.
      </p>

      <h2>Error monitoring</h2>
      <p>
        We use Sentry to detect crashes. Sentry sets no cookies and records only your user ID
        (never your answers), under our legitimate interest in keeping drill reliable.
      </p>

      <h2>Contact</h2>
      <p>Questions? Email <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>.</p>
    </article>
  );
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/compliance-us-eu && pnpm --filter @language-drill/web test -- legal-pages`
Expected: PASS (3 tests).

- [ ] **Step 7: Add legal pages to Clerk public routes**

In `apps/web/middleware.ts`, extend the `createRouteMatcher` array:

```ts
const isPublicRoute = createRouteMatcher([
  '/', // public marketing landing page (signed-in users are bounced to /home)
  '/sign-in(.*)',
  '/sign-up(.*)',
  '/invite(.*)',
  '/api/webhooks(.*)',
  '/privacy',
  '/terms',
  '/cookies',
]);
```

- [ ] **Step 8: Typecheck + commit**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/compliance-us-eu
pnpm --filter @language-drill/web typecheck
git branch --show-current   # worktree-compliance-us-eu
git add "apps/web/app/(legal)/privacy/page.tsx" "apps/web/app/(legal)/terms/page.tsx" "apps/web/app/(legal)/cookies/page.tsx" "apps/web/app/(legal)/__tests__/legal-pages.test.tsx" apps/web/middleware.ts
git commit -m "feat(legal): privacy/terms/cookies pages + public routes"
```

> Note on styling: the pages use plain semantic HTML under a `prose-legal` wrapper class. If `prose-legal` is not already defined in `globals.css`, the text still renders correctly (unstyled prose is acceptable for legal pages); a follow-up may add typographic polish. Do not block on it.

---

## Task 3: Consent state module (TDD)

**Files:**
- Create: `apps/web/lib/consent/consent.ts`
- Test: `apps/web/lib/consent/consent.test.ts`

**Interfaces:**
- Produces:
  - `type ConsentState = { analytics: boolean; version: number; timestamp: string }`
  - `CONSENT_VERSION: number` (currently `1`)
  - `getConsent(): ConsentState | null` — returns stored consent, or `null` if unset/stale/unavailable.
  - `setConsent(partial: { analytics: boolean }): ConsentState` — persists and returns the full state.
  - `hasConsent(category: 'analytics'): boolean` — `false` unless explicitly granted.

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/lib/consent/consent.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { getConsent, setConsent, hasConsent, CONSENT_VERSION } from './consent';

const KEY = 'drill-cookie-consent';

describe('consent module', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to no consent when nothing stored', () => {
    expect(getConsent()).toBeNull();
    expect(hasConsent('analytics')).toBe(false);
  });

  it('persists and reads back a choice', () => {
    const state = setConsent({ analytics: true });
    expect(state.analytics).toBe(true);
    expect(state.version).toBe(CONSENT_VERSION);
    expect(getConsent()?.analytics).toBe(true);
    expect(hasConsent('analytics')).toBe(true);
  });

  it('treats a stale version as unset (re-prompt)', () => {
    localStorage.setItem(
      KEY,
      JSON.stringify({ analytics: true, version: CONSENT_VERSION - 1, timestamp: 'x' }),
    );
    expect(getConsent()).toBeNull();
    expect(hasConsent('analytics')).toBe(false);
  });

  it('rejecting persists analytics=false (not unset)', () => {
    setConsent({ analytics: false });
    expect(getConsent()?.analytics).toBe(false);
    expect(hasConsent('analytics')).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/compliance-us-eu && pnpm --filter @language-drill/web test -- consent`
Expected: FAIL (cannot resolve `./consent`).

- [ ] **Step 3: Implement the module**

```ts
// apps/web/lib/consent/consent.ts
export const CONSENT_VERSION = 1;
const KEY = 'drill-cookie-consent';

export type ConsentState = {
  analytics: boolean;
  version: number;
  timestamp: string;
};

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null; // privacy mode / blocked
  }
}

export function getConsent(): ConsentState | null {
  const s = storage();
  if (!s) return null;
  const raw = s.getItem(KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<ConsentState>;
    if (parsed.version !== CONSENT_VERSION || typeof parsed.analytics !== 'boolean') {
      return null; // stale or malformed → treat as unset
    }
    return { analytics: parsed.analytics, version: CONSENT_VERSION, timestamp: parsed.timestamp ?? '' };
  } catch {
    return null;
  }
}

export function setConsent(partial: { analytics: boolean }): ConsentState {
  const state: ConsentState = {
    analytics: partial.analytics,
    version: CONSENT_VERSION,
    timestamp: new Date().toISOString(),
  };
  const s = storage();
  if (s) s.setItem(KEY, JSON.stringify(state));
  return state;
}

export function hasConsent(category: 'analytics'): boolean {
  const c = getConsent();
  if (!c) return false;
  return c[category] === true;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/compliance-us-eu && pnpm --filter @language-drill/web test -- consent`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/compliance-us-eu
git branch --show-current   # worktree-compliance-us-eu
git add apps/web/lib/consent/consent.ts apps/web/lib/consent/consent.test.ts
git commit -m "feat(consent): localStorage consent state module"
```

---

## Task 4: Consent provider + hook + ConsentGate

**Files:**
- Create: `apps/web/components/consent/consent-provider.tsx`
- Create: `apps/web/components/consent/consent-gate.tsx`
- Test: `apps/web/components/consent/__tests__/consent-gate.test.tsx`

**Interfaces:**
- Consumes: `getConsent`, `setConsent`, `ConsentState` from Task 3.
- Produces:
  - `ConsentProvider({ children })` — context provider; hydrates from storage on mount.
  - `useConsent(): { state: ConsentState | null; ready: boolean; update(p: { analytics: boolean }): void; openPreferences(): void; preferencesOpen: boolean; closePreferences(): void }`.
  - `ConsentGate({ category, children })` — renders children only when consent for `category` is granted.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/components/consent/__tests__/consent-gate.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ConsentProvider, useConsent } from '../consent-provider';
import { ConsentGate } from '../consent-gate';

function Grant() {
  const { update } = useConsent();
  return <button onClick={() => update({ analytics: true })}>grant</button>;
}

describe('ConsentGate', () => {
  beforeEach(() => localStorage.clear());

  it('hides children until analytics consent is granted', async () => {
    render(
      <ConsentProvider>
        <Grant />
        <ConsentGate category="analytics"><span>tracked</span></ConsentGate>
      </ConsentProvider>,
    );
    expect(screen.queryByText('tracked')).not.toBeInTheDocument();
    await act(async () => { screen.getByText('grant').click(); });
    expect(screen.getByText('tracked')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/compliance-us-eu && pnpm --filter @language-drill/web test -- consent-gate`
Expected: FAIL (cannot resolve `../consent-provider`).

- [ ] **Step 3: Implement the provider**

```tsx
// apps/web/components/consent/consent-provider.tsx
'use client';

import { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { getConsent, setConsent, type ConsentState } from '../../lib/consent/consent';

type ConsentContextValue = {
  state: ConsentState | null;
  ready: boolean;
  update: (p: { analytics: boolean }) => void;
  openPreferences: () => void;
  closePreferences: () => void;
  preferencesOpen: boolean;
};

const ConsentContext = createContext<ConsentContextValue | null>(null);

export function ConsentProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<ConsentState | null>(null);
  const [ready, setReady] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);

  useEffect(() => {
    setState(getConsent());
    setReady(true);
  }, []);

  const update = useCallback((p: { analytics: boolean }) => {
    setState(setConsent(p));
    setPreferencesOpen(false);
  }, []);

  const openPreferences = useCallback(() => setPreferencesOpen(true), []);
  const closePreferences = useCallback(() => setPreferencesOpen(false), []);

  return (
    <ConsentContext.Provider
      value={{ state, ready, update, openPreferences, closePreferences, preferencesOpen }}
    >
      {children}
    </ConsentContext.Provider>
  );
}

export function useConsent(): ConsentContextValue {
  const ctx = useContext(ConsentContext);
  if (!ctx) throw new Error('useConsent must be used within ConsentProvider');
  return ctx;
}
```

- [ ] **Step 4: Implement the gate**

```tsx
// apps/web/components/consent/consent-gate.tsx
'use client';

import { useConsent } from './consent-provider';

export function ConsentGate({
  category,
  children,
}: {
  category: 'analytics';
  children: React.ReactNode;
}) {
  const { state } = useConsent();
  if (state?.[category] !== true) return null;
  return <>{children}</>;
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/compliance-us-eu && pnpm --filter @language-drill/web test -- consent-gate`
Expected: PASS (1 test).

- [ ] **Step 6: Commit**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/compliance-us-eu
git branch --show-current   # worktree-compliance-us-eu
git add apps/web/components/consent/consent-provider.tsx apps/web/components/consent/consent-gate.tsx "apps/web/components/consent/__tests__/consent-gate.test.tsx"
git commit -m "feat(consent): provider, useConsent hook, and ConsentGate"
```

---

## Task 5: Cookie banner + preferences, mounted in root layout

**Files:**
- Create: `apps/web/components/consent/cookie-banner.tsx`
- Test: `apps/web/components/consent/__tests__/cookie-banner.test.tsx`
- Modify: `apps/web/app/layout.tsx`

**Interfaces:**
- Consumes: `useConsent` from Task 4.
- Produces: `CookieBanner` (default export not required; named export `CookieBanner`).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/components/consent/__tests__/cookie-banner.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { ConsentProvider } from '../consent-provider';
import { CookieBanner } from '../cookie-banner';
import { getConsent } from '../../../lib/consent/consent';

function setup() {
  return render(
    <ConsentProvider>
      <CookieBanner />
    </ConsentProvider>,
  );
}

describe('CookieBanner', () => {
  beforeEach(() => localStorage.clear());

  it('shows when no choice has been made', async () => {
    setup();
    expect(await screen.findByRole('region', { name: /cookie/i })).toBeInTheDocument();
  });

  it('Accept all sets analytics=true and hides the banner', async () => {
    setup();
    const btn = await screen.findByRole('button', { name: /accept all/i });
    await act(async () => { btn.click(); });
    expect(getConsent()?.analytics).toBe(true);
    expect(screen.queryByRole('region', { name: /cookie/i })).not.toBeInTheDocument();
  });

  it('Reject persists analytics=false and hides the banner', async () => {
    setup();
    const btn = await screen.findByRole('button', { name: /reject/i });
    await act(async () => { btn.click(); });
    expect(getConsent()?.analytics).toBe(false);
    expect(screen.queryByRole('region', { name: /cookie/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/compliance-us-eu && pnpm --filter @language-drill/web test -- cookie-banner`
Expected: FAIL (cannot resolve `../cookie-banner`).

- [ ] **Step 3: Implement the banner + preferences panel**

```tsx
// apps/web/components/consent/cookie-banner.tsx
'use client';

import Link from 'next/link';
import { useConsent } from './consent-provider';

export function CookieBanner() {
  const { state, ready, update, preferencesOpen, openPreferences, closePreferences } = useConsent();

  // Show the banner only after hydration, when no choice has been recorded.
  const showBanner = ready && state === null;

  if (preferencesOpen) {
    return (
      <div
        role="dialog"
        aria-label="Cookie preferences"
        className="fixed inset-x-0 bottom-0 z-50 border-t border-rule bg-paper p-s-5 shadow-lg"
      >
        <div className="mx-auto max-w-[760px]">
          <h2 className="t-display-m mb-s-2">Cookie preferences</h2>
          <ul className="mb-s-4 list-none p-0 m-0 flex flex-col gap-s-3">
            <li>
              <strong>Strictly necessary</strong> — always on. Required to sign you in and keep drafts.
            </li>
            <li>
              <strong>Analytics</strong> — optional. Off unless you turn it on. Not active today.
            </li>
          </ul>
          <div className="flex gap-s-3">
            <button type="button" className="btn" onClick={() => update({ analytics: true })}>
              Allow analytics
            </button>
            <button type="button" className="btn" onClick={() => update({ analytics: false })}>
              Necessary only
            </button>
            <button type="button" className="btn-ghost" onClick={closePreferences}>
              Close
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!showBanner) return null;

  return (
    <div
      role="region"
      aria-label="Cookie notice"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-rule bg-paper p-s-5 shadow-lg"
    >
      <div className="mx-auto max-w-[760px] flex flex-col gap-s-3 mobile:items-stretch sm:flex-row sm:items-center sm:justify-between">
        <p className="t-small text-ink-soft m-0">
          We use only strictly-necessary cookies. We&rsquo;ll ask before enabling any analytics.{' '}
          <Link href="/cookies" className="underline">Learn more</Link>.
        </p>
        <div className="flex gap-s-3 shrink-0">
          <button type="button" className="btn-ghost" onClick={openPreferences}>Manage</button>
          <button type="button" className="btn-ghost" onClick={() => update({ analytics: false })}>Reject</button>
          <button type="button" className="btn" onClick={() => update({ analytics: true })}>Accept all</button>
        </div>
      </div>
    </div>
  );
}
```

> The `btn` / `btn-ghost` classes follow the existing design-system convention. If they are not defined globally, the buttons remain functional (unstyled); styling is non-blocking.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/compliance-us-eu && pnpm --filter @language-drill/web test -- cookie-banner`
Expected: PASS (3 tests).

- [ ] **Step 5: Mount the provider + banner in the root layout**

In `apps/web/app/layout.tsx`, import and wrap. Replace the `<body>` block:

```tsx
import { ConsentProvider } from '../components/consent/consent-provider';
import { CookieBanner } from '../components/consent/cookie-banner';
```

and the body:

```tsx
        <body>
          <ConsentProvider>
            <Providers>{children}</Providers>
            <CookieBanner />
          </ConsentProvider>
        </body>
```

- [ ] **Step 6: Typecheck + commit**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/compliance-us-eu
pnpm --filter @language-drill/web typecheck
git branch --show-current   # worktree-compliance-us-eu
git add apps/web/components/consent/cookie-banner.tsx "apps/web/components/consent/__tests__/cookie-banner.test.tsx" apps/web/app/layout.tsx
git commit -m "feat(consent): cookie banner + preferences, mounted app-wide"
```

---

## Task 6: Backend data export — collector + GET /me/export

**Files:**
- Create: `infra/lambda/src/routes/user-export.ts`
- Create: `infra/lambda/src/routes/user-export.test.ts`
- Modify: `infra/lambda/src/routes/me.ts`

**Interfaces:**
- Produces:
  - `USER_EXPORT_TABLES: ReadonlyArray<{ key: string; table: unknown; userIdColumn: unknown }>` — the per-userId tables.
  - `collectUserExport(db, userId): Promise<Record<string, unknown>>` — returns `{ exportedAt, user, ...perTableArrays, playlistItems }`.
- Consumes: existing `authMiddleware`, `db`, schema tables from `@language-drill/db`.

- [ ] **Step 1: Write the failing test**

```ts
// infra/lambda/src/routes/user-export.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Hono } from 'hono';

// Each db.select().from(table).where(cond) resolves to a canned array keyed by call order.
// We record the cond objects so we can assert every query was filtered by the user id.
const recordedConds: unknown[] = [];
const makeChain = (rows: unknown[]) => ({
  from: () => ({
    where: (cond: unknown) => {
      recordedConds.push(cond);
      return Promise.resolve(rows);
    },
    // playlistItems uses innerJoin(...).where(...)
    innerJoin: () => ({
      where: (cond: unknown) => {
        recordedConds.push(cond);
        return Promise.resolve(rows);
      },
    }),
  }),
});

let selectCalls = 0;
const cannedRows = [{ id: 'row1', userId: 'user_1' }];
vi.mock('../db', () => ({
  db: {
    select: () => {
      selectCalls += 1;
      return makeChain(cannedRows);
    },
  },
}));

// eq returns a tagged object so we can assert the value passed.
vi.mock('drizzle-orm', () => ({
  eq: (col: unknown, val: unknown) => ({ col, val }),
}));

// Minimal schema stubs — each is just an object with a userId/id field.
vi.mock('@language-drill/db', () => {
  const col = (name: string) => ({ name });
  const t = () => ({ id: col('id'), userId: col('user_id'), playlistId: col('playlist_id') });
  return {
    users: t(), userLanguageProfiles: t(), userPreferences: t(), userExerciseHistory: t(),
    spacedRepetitionCards: t(), fluencyAttempts: t(), userGrammarMastery: t(), errorObservations: t(),
    practiceSessions: t(), readEntries: t(), userVocabulary: t(), vocabularyReviewState: t(),
    vocabularyReviewSessions: t(), vocabularyReviewLog: t(), playlists: t(), playlistItems: t(),
    usageEvents: t(), exerciseFlags: t(),
  };
});

const authEnv = {
  event: { requestContext: { authorizer: { jwt: { claims: { sub: 'user_1' } } } } },
};

describe('GET /me/export', () => {
  let app: Hono;
  beforeEach(async () => {
    vi.clearAllMocks();
    recordedConds.length = 0;
    selectCalls = 0;
    const mod = await import('./me');
    app = new Hono();
    app.route('/', mod.default);
  });

  it('requires auth', async () => {
    const res = await app.request('/me/export'); // no authorizer claims
    expect(res.status).toBe(401);
  });

  it('returns every user-keyed section as JSON', async () => {
    const res = await app.request('/me/export', undefined, authEnv);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    for (const key of [
      'exportedAt', 'user', 'userLanguageProfiles', 'userPreferences', 'userExerciseHistory',
      'spacedRepetitionCards', 'fluencyAttempts', 'userGrammarMastery', 'errorObservations',
      'practiceSessions', 'readEntries', 'userVocabulary', 'vocabularyReviewState',
      'vocabularyReviewSessions', 'vocabularyReviewLog', 'playlists', 'playlistItems',
      'usageEvents', 'exerciseFlags',
    ]) {
      expect(body).toHaveProperty(key);
    }
  });

  it('sets a download attachment header', async () => {
    const res = await app.request('/me/export', undefined, authEnv);
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="drill-data-export-.*\.json"/);
  });

  it('filters every query by the authenticated user id', async () => {
    await app.request('/me/export', undefined, authEnv);
    // Each recorded cond came from eq(col, val); all vals must be 'user_1'.
    expect(recordedConds.length).toBeGreaterThan(0);
    for (const cond of recordedConds as Array<{ val: unknown }>) {
      expect(cond.val).toBe('user_1');
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/compliance-us-eu && pnpm --filter @language-drill/lambda test -- user-export`
Expected: FAIL (`/me/export` returns 404, route not defined).

- [ ] **Step 3: Implement the collector**

```ts
// infra/lambda/src/routes/user-export.ts
import { eq } from 'drizzle-orm';
import {
  users,
  userLanguageProfiles,
  userPreferences,
  userExerciseHistory,
  spacedRepetitionCards,
  fluencyAttempts,
  userGrammarMastery,
  errorObservations,
  practiceSessions,
  readEntries,
  userVocabulary,
  vocabularyReviewState,
  vocabularyReviewSessions,
  vocabularyReviewLog,
  playlists,
  playlistItems,
  usageEvents,
  exerciseFlags,
} from '@language-drill/db';
import type { db as DbType } from '../db';

// Every table keyed directly by user_id. Order is stable for predictable output.
export const USER_EXPORT_TABLES = [
  { key: 'userLanguageProfiles', table: userLanguageProfiles, userIdColumn: userLanguageProfiles.userId },
  { key: 'userPreferences', table: userPreferences, userIdColumn: userPreferences.userId },
  { key: 'userExerciseHistory', table: userExerciseHistory, userIdColumn: userExerciseHistory.userId },
  { key: 'spacedRepetitionCards', table: spacedRepetitionCards, userIdColumn: spacedRepetitionCards.userId },
  { key: 'fluencyAttempts', table: fluencyAttempts, userIdColumn: fluencyAttempts.userId },
  { key: 'userGrammarMastery', table: userGrammarMastery, userIdColumn: userGrammarMastery.userId },
  { key: 'errorObservations', table: errorObservations, userIdColumn: errorObservations.userId },
  { key: 'practiceSessions', table: practiceSessions, userIdColumn: practiceSessions.userId },
  { key: 'readEntries', table: readEntries, userIdColumn: readEntries.userId },
  { key: 'userVocabulary', table: userVocabulary, userIdColumn: userVocabulary.userId },
  { key: 'vocabularyReviewState', table: vocabularyReviewState, userIdColumn: vocabularyReviewState.userId },
  { key: 'vocabularyReviewSessions', table: vocabularyReviewSessions, userIdColumn: vocabularyReviewSessions.userId },
  { key: 'vocabularyReviewLog', table: vocabularyReviewLog, userIdColumn: vocabularyReviewLog.userId },
  { key: 'playlists', table: playlists, userIdColumn: playlists.userId },
  { key: 'usageEvents', table: usageEvents, userIdColumn: usageEvents.userId },
  { key: 'exerciseFlags', table: exerciseFlags, userIdColumn: exerciseFlags.userId },
] as const;

export async function collectUserExport(
  db: typeof DbType,
  userId: string,
): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = { exportedAt: new Date().toISOString() };

  // The account row (keyed by id, not user_id).
  const userRows = await db.select().from(users).where(eq(users.id, userId));
  out.user = userRows[0] ?? null;

  // Every directly user-keyed table.
  for (const { key, table, userIdColumn } of USER_EXPORT_TABLES) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    out[key] = await db.select().from(table as any).where(eq(userIdColumn as any, userId));
  }

  // Playlist items belong to the user's playlists (no direct user_id).
  out.playlistItems = await db
    .select()
    .from(playlistItems)
    .innerJoin(playlists, eq(playlistItems.playlistId, playlists.id))
    .where(eq(playlists.userId, userId));

  return out;
}
```

- [ ] **Step 4: Wire the route into me.ts**

In `infra/lambda/src/routes/me.ts`, add the import and a new handler (the `authMiddleware` is already applied via `me.use('/me', authMiddleware)` — extend it to cover the sub-path):

```ts
import { collectUserExport } from './user-export';
```

Change the middleware line to also protect the export path:

```ts
me.use('/me', authMiddleware);
me.use('/me/export', authMiddleware);
```

Add the handler (after the existing `me.get('/me', ...)` block):

```ts
me.get('/me/export', async (c) => {
  const userId = c.get('userId');
  const data = await collectUserExport(db, userId);
  const date = new Date().toISOString().slice(0, 10);
  c.header('Content-Type', 'application/json');
  c.header('Content-Disposition', `attachment; filename="drill-data-export-${date}.json"`);
  return c.body(JSON.stringify(data, null, 2));
});
```

> Why `c.body(JSON.stringify(...))` and not `c.json(...)`: `c.json()` overrides the `Content-Type` and ignores the attachment intent; `c.body` with an explicit header preserves both.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/compliance-us-eu && pnpm --filter @language-drill/lambda test -- user-export`
Expected: PASS (4 tests).

- [ ] **Step 6: Run the existing me tests to confirm no regression**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/compliance-us-eu && pnpm --filter @language-drill/lambda test -- me`
Expected: PASS (existing `GET /me` tests still green).

- [ ] **Step 7: Commit**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/compliance-us-eu
git branch --show-current   # worktree-compliance-us-eu
git add infra/lambda/src/routes/user-export.ts infra/lambda/src/routes/user-export.test.ts infra/lambda/src/routes/me.ts
git commit -m "feat(api): GET /me/export — full user data export as JSON"
```

---

## Task 7: Frontend export helper + settings "privacy & data" section

**Files:**
- Create: `apps/web/lib/data-export.ts`
- Create: `apps/web/components/settings/privacy-data-section.tsx`
- Test: `apps/web/components/settings/__tests__/privacy-data-section.test.tsx`
- Modify: `apps/web/components/settings/settings-nav.tsx`
- Modify: `apps/web/app/(dashboard)/settings/page.tsx`

**Interfaces:**
- Consumes: `createAuthenticatedFetch` from `@language-drill/api-client`; `useConsent` from Task 4; `Section` from `components/settings/section`.
- Produces: `downloadMyData(fetchFn): Promise<void>`; `PrivacyDataSection` component.

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/components/settings/__tests__/privacy-data-section.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@clerk/nextjs', () => ({
  useAuth: () => ({ getToken: vi.fn(async () => 'tok') }),
}));
vi.mock('@language-drill/api-client', () => ({
  createAuthenticatedFetch: () => vi.fn(),
}));
vi.mock('../../consent/consent-provider', () => ({
  useConsent: () => ({ openPreferences: vi.fn() }),
}));

import { PrivacyDataSection } from '../privacy-data-section';

describe('PrivacyDataSection', () => {
  beforeEach(() => vi.clearAllMocks());

  it('renders the download button and policy links', () => {
    render(<PrivacyDataSection />);
    expect(screen.getByRole('button', { name: /download my data/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /privacy policy/i })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: /terms/i })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: /cookie policy/i })).toHaveAttribute('href', '/cookies');
  });

  it('points to account → Security for deletion (no duplicate delete button)', () => {
    render(<PrivacyDataSection />);
    expect(screen.getByText(/delete your account/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^delete account$/i })).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/compliance-us-eu && pnpm --filter @language-drill/web test -- privacy-data-section`
Expected: FAIL (cannot resolve `../privacy-data-section`).

- [ ] **Step 3: Implement the download helper**

```ts
// apps/web/lib/data-export.ts
import type { AuthenticatedFetch } from '@language-drill/api-client';

/**
 * Fetches the user's full data export and triggers a browser download.
 * Throws on non-OK responses (createAuthenticatedFetch already throws).
 */
export async function downloadMyData(fetchFn: AuthenticatedFetch): Promise<void> {
  const res = await fetchFn('/me/export', { method: 'GET' });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10);
  const a = document.createElement('a');
  a.href = url;
  a.download = `drill-data-export-${date}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: Implement the settings section**

```tsx
// apps/web/components/settings/privacy-data-section.tsx
'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useAuth } from '@clerk/nextjs';
import { createAuthenticatedFetch } from '@language-drill/api-client';
import { Section, Row } from './section';
import { useConsent } from '../consent/consent-provider';
import { downloadMyData } from '../../lib/data-export';

export function PrivacyDataSection() {
  const { getToken } = useAuth();
  const { openPreferences } = useConsent();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onDownload = async () => {
    setBusy(true);
    setError(null);
    try {
      await downloadMyData(fetchFn);
    } catch {
      setError('Could not export your data. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section id="privacy" title="privacy &amp; data" sub="your data, your rights.">
      <Row label="download my data" hint="a JSON copy of everything tied to your account.">
        <button type="button" className="btn" onClick={onDownload} disabled={busy}>
          {busy ? 'preparing…' : 'download my data'}
        </button>
        {error && <p role="alert" className="t-small text-accent-2 mt-s-2">{error}</p>}
      </Row>
      <Row label="delete your account" hint="permanent erasure of your account and all data.">
        <p className="t-small text-ink-soft m-0">
          Use <strong>account → Security → Delete account</strong> above to delete your account.
        </p>
      </Row>
      <Row label="policies" hint="how we handle your data.">
        <div className="flex flex-col gap-s-1">
          <Link href="/privacy" className="underline">Privacy Policy</Link>
          <Link href="/terms" className="underline">Terms of Service</Link>
          <Link href="/cookies" className="underline">Cookie Policy</Link>
          <button type="button" className="underline text-left" onClick={openPreferences}>
            Cookie preferences
          </button>
        </div>
      </Row>
    </Section>
  );
}
```

- [ ] **Step 5: Add the nav entry and render the section**

In `apps/web/components/settings/settings-nav.tsx`, append to `SETTINGS_SECTIONS`:

```ts
export const SETTINGS_SECTIONS = [
  { id: 'languages', label: 'languages & levels' },
  { id: 'goals', label: 'goals' },
  { id: 'plan', label: 'plan & limits' },
  { id: 'account', label: 'account' },
  { id: 'privacy', label: 'privacy & data' },
] as const;
```

In `apps/web/app/(dashboard)/settings/page.tsx`, import and render it after `<AccountSection />`:

```tsx
import { PrivacyDataSection } from '../../../components/settings/privacy-data-section';
```

```tsx
        <AccountSection />
        <PrivacyDataSection />
```

- [ ] **Step 6: Run the section test to verify it passes**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/compliance-us-eu && pnpm --filter @language-drill/web test -- privacy-data-section`
Expected: PASS (2 tests).

- [ ] **Step 7: Run the existing settings page test (nav change ripple)**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/compliance-us-eu && pnpm --filter @language-drill/web test -- settings`
Expected: PASS. If the page test mocks `SETTINGS_SECTIONS` with a hardcoded list, add the `{ id: 'privacy', label: 'privacy & data' }` entry to that mock and mock the new `PrivacyDataSection` component the same way the other sections are mocked, then re-run.

- [ ] **Step 8: Commit**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/compliance-us-eu
git branch --show-current   # worktree-compliance-us-eu
git add apps/web/lib/data-export.ts apps/web/components/settings/privacy-data-section.tsx "apps/web/components/settings/__tests__/privacy-data-section.test.tsx" apps/web/components/settings/settings-nav.tsx "apps/web/app/(dashboard)/settings/page.tsx"
git commit -m "feat(settings): privacy & data section with data export + policy links"
```

---

## Task 8: Footer legal links (landing desktop + mobile + authenticated)

**Files:**
- Create: `apps/web/components/legal/legal-links.tsx`
- Test: `apps/web/components/legal/__tests__/legal-links.test.tsx`
- Modify: `apps/web/app/_landing/drill-landing.tsx` (`DFooter`)
- Modify: `apps/web/app/_landing/drill-landing-mobile.tsx` (`MFooter`)
- Modify: `apps/web/components/shell/user-footer.tsx`

**Interfaces:**
- Consumes: `useConsent` from Task 4.
- Produces: `LegalLinks` component (renders Privacy/Terms/Cookies links + "Cookie preferences" button + contact email).

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/components/legal/__tests__/legal-links.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('../../consent/consent-provider', () => ({
  useConsent: () => ({ openPreferences: () => {} }),
}));

import { LegalLinks } from '../legal-links';

describe('LegalLinks', () => {
  it('renders all three policy links, cookie preferences, and contact email', () => {
    render(<LegalLinks />);
    expect(screen.getByRole('link', { name: /privacy/i })).toHaveAttribute('href', '/privacy');
    expect(screen.getByRole('link', { name: /terms/i })).toHaveAttribute('href', '/terms');
    expect(screen.getByRole('link', { name: /cookies/i })).toHaveAttribute('href', '/cookies');
    expect(screen.getByRole('button', { name: /cookie preferences/i })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /info@langdrill\.app/i })).toHaveAttribute(
      'href', 'mailto:info@langdrill.app',
    );
  });
});
```

> Add `import { vi } from 'vitest';` at the top alongside the other imports.

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/compliance-us-eu && pnpm --filter @language-drill/web test -- legal-links`
Expected: FAIL (cannot resolve `../legal-links`).

- [ ] **Step 3: Implement the shared LegalLinks component**

```tsx
// apps/web/components/legal/legal-links.tsx
'use client';

import Link from 'next/link';
import { useConsent } from '../consent/consent-provider';

export function LegalLinks({ className = '' }: { className?: string }) {
  const { openPreferences } = useConsent();
  return (
    <nav className={`flex flex-wrap items-center gap-s-3 t-small text-ink-mute ${className}`}>
      <Link href="/privacy" className="hover:text-ink">Privacy</Link>
      <Link href="/terms" className="hover:text-ink">Terms</Link>
      <Link href="/cookies" className="hover:text-ink">Cookies</Link>
      <button type="button" className="hover:text-ink" onClick={openPreferences}>
        Cookie preferences
      </button>
      <a href="mailto:info@langdrill.app" className="hover:text-ink">info@langdrill.app</a>
    </nav>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd /Users/seal/dev/language-drill/.claude/worktrees/compliance-us-eu && pnpm --filter @language-drill/web test -- legal-links`
Expected: PASS (1 test).

- [ ] **Step 5: Render LegalLinks in the three footers**

First grep for existing footer assertions so you don't break them:

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/compliance-us-eu
grep -rn "DFooter\|MFooter\|UserFooter\|read, save, produce\|© 2026" apps/web --include="*.test.tsx"
```

In `apps/web/app/_landing/drill-landing.tsx`, inside `DFooter`, add the import at the top of the file:

```tsx
import { LegalLinks } from '../../components/legal/legal-links';
```

and render `<LegalLinks className="mt-s-4" />` within the footer's container (next to the existing copyright line).

Repeat in `apps/web/app/_landing/drill-landing-mobile.tsx` (`MFooter`) with the same import path adjusted relative to that file, and render `<LegalLinks className="mt-s-3" />`.

In `apps/web/components/shell/user-footer.tsx`, add:

```tsx
import { LegalLinks } from '../legal/legal-links';
```

and render `<LegalLinks />` in the footer alongside the existing Settings / Sign Out links.

> The landing pages render under the root layout, which now provides `ConsentProvider`, so `useConsent()` inside `LegalLinks` resolves correctly on those pages too.

- [ ] **Step 6: Typecheck + run web tests**

Run:
```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/compliance-us-eu
pnpm --filter @language-drill/web typecheck
pnpm --filter @language-drill/web test
```
Expected: PASS. If a landing or shell test broke on the new footer content, update that test to account for the added links (do not remove the new links).

- [ ] **Step 7: Commit**

```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/compliance-us-eu
git branch --show-current   # worktree-compliance-us-eu
git add apps/web/components/legal/legal-links.tsx "apps/web/components/legal/__tests__/legal-links.test.tsx" apps/web/app/_landing/drill-landing.tsx apps/web/app/_landing/drill-landing-mobile.tsx apps/web/components/shell/user-footer.tsx
git commit -m "feat(legal): footer legal links across landing + app footers"
```

---

## Task 9: Full verification pass

**Files:** none (verification only).

- [ ] **Step 1: Run the full gate from the worktree root**

Run:
```bash
cd /Users/seal/dev/language-drill/.claude/worktrees/compliance-us-eu
pnpm lint && pnpm typecheck && pnpm test
```
Expected: all three pass with zero failures. (If stale `infra/lambda/dist/**/*.test.js` causes phantom failures, `rm -rf infra/lambda/dist` and re-run — see project memory.)

- [ ] **Step 2: Manual smoke (optional but recommended)**

Run `pnpm dev` and verify:
- `/privacy`, `/terms`, `/cookies` render while signed out.
- The cookie banner appears on first load; Accept/Reject dismisses it and persists across reload.
- Settings → "privacy & data" → "Download my data" saves a JSON file containing your data.
- Footer legal links work; "Cookie preferences" re-opens the panel.

- [ ] **Step 3: Finish the branch**

Use the superpowers:finishing-a-development-branch skill to open a PR (squash-merge per project convention).

---

## Self-Review

**Spec coverage:**
- Privacy/Terms/Cookies pages → Tasks 1–2. ✓
- Public-route exposure → Task 2 Step 7. ✓
- Sub-processor list (all 9 incl. Langfuse + Cloudflare) → Task 1 constants, rendered in Task 2 privacy page. ✓
- Legal bases, retention, rights (export + delete links), supervisory authority → Task 2 privacy page. ✓
- ToS: acceptable use, AI disclaimer, no-warranty, min age 16, governing law Hungary → Task 2 terms page. ✓
- Cookie consent module (localStorage, version, SSR-safe, hasConsent) → Task 3. ✓
- Provider + useConsent + ConsentGate (analytics off by default, PostHog-ready) → Task 4. ✓
- Banner + preferences, mounted root layout, Sentry ungated (never gated) → Task 5. ✓
- Data export GET /me/export (all user-keyed tables + users + playlistItems, attachment header, auth, isolation) → Task 6. ✓
- Settings "privacy & data" section (export button, policy links, cookie preferences, delete pointer) → Task 7. ✓
- Footers desktop + mobile + authenticated → Task 8. ✓
- Testing across all surfaces → each task + Task 9. ✓
- Out-of-scope (CCPA do-not-sell, async export, DPAs) → intentionally not built. ✓

**Placeholder scan:** No TBD/TODO; all code blocks are complete; legal prose is real, not placeholder.

**Type consistency:** `ConsentState`/`getConsent`/`setConsent`/`hasConsent` (Task 3) used identically in Tasks 4–5. `useConsent()` shape (with `openPreferences`/`preferencesOpen`) defined in Task 4 and consumed in Tasks 5, 7, 8. `collectUserExport(db, userId)` signature (Task 6) matches its call site. `downloadMyData(fetchFn)` (Task 7) matches its test. `LegalLinks` props (Task 8) match usage.
