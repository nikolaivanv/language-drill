# Admin Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the manual Clerk `publicMetadata.admin` frontend gate with an `ADMIN_USER_IDS`-driven one (via `GET /me`'s `isAdmin`), and wrap the three existing admin pages in a unified `/admin` shell with a left-nav — without changing any URLs.

**Architecture:** Move the three admin pages from `app/(dashboard)/admin/` into a new `app/(admin)/` route group (route groups don't affect URLs, so paths stay byte-identical and the pages stop inheriting the learner shell). The new `(admin)/layout.tsx` gates access by fetching `/me` server-side and checking `isAdmin`, then renders an `AdminShell` (sidebar + content) whose `AdminNav` is driven by a single `ADMIN_NAV` source-of-truth array.

**Tech Stack:** Next.js App Router (RSC + client components), TypeScript, Tailwind, Vitest + Testing Library, `@language-drill/api-client` (`MeResponseSchema`).

---

## Context the implementer needs

**No backend or DB changes.** `GET /me` already returns `isAdmin` (`infra/lambda/src/routes/me.ts`), and `MeResponseSchema` (in `@language-drill/api-client`, `packages/api-client/src/schemas/me.ts`) already declares `isAdmin: z.boolean()`. The API's `adminMiddleware` remains the real security boundary; the frontend gate is UX only.

**Why the move is import-stable:** `(dashboard)` and `(admin)` are both single path segments directly under `app/`, so moving `app/(dashboard)/admin/theory/` → `app/(admin)/admin/theory/` preserves directory depth. Every relative import inside the moved pages (e.g. `../../../../lib/api-server`, `../../../../components/ui`, `./_components/...`) and the moved test's mock path resolve to the same targets. **Do not rewrite those imports.**

**Existing idioms to mirror:**
- Nav source-of-truth array + components: `apps/web/components/shell/nav-items.tsx`, `nav.tsx`, `nav-item.tsx` (exports a reusable `isActive(pathname, href)`).
- RSC test pattern (mock `apiFetch` + `redirect`): `apps/web/app/(dashboard)/admin/theory/page.test.tsx`.
- `cn` helper: `apps/web/lib/cn.ts`. Tailwind tokens: `bg-ink`, `text-paper`, `text-ink-soft`, `bg-paper-2`, `border-rule`, `bg-paper`, `px-s-3`, `py-s-2`, `max-w-max-content` (all already used in `nav-item.tsx` / `app-shell.tsx`).

**Files that exist today (for reference):**
- `apps/web/app/(dashboard)/admin/layout.tsx` (the gate to delete)
- `apps/web/app/(dashboard)/admin/generation/page.tsx` (+ `_components/pool-coverage-table.tsx`)
- `apps/web/app/(dashboard)/admin/theory/page.tsx` (+ `page.test.tsx`)
- `apps/web/app/(dashboard)/admin/invites/page.tsx`

**Single-file test command:** `pnpm --filter @language-drill/web test <path-relative-to-apps/web>` (the `test` script is `vitest run`).

---

## File structure (what this plan creates / moves / deletes)

**Create:**
- `apps/web/components/admin/admin-nav-items.tsx` — `ADMIN_NAV` array (source of truth)
- `apps/web/components/admin/admin-nav.tsx` — client nav component
- `apps/web/components/admin/admin-shell.tsx` — sidebar + content wrapper
- `apps/web/components/admin/__tests__/admin-nav.test.tsx`
- `apps/web/components/admin/__tests__/admin-shell.test.tsx`
- `apps/web/app/(admin)/layout.tsx` — auth gate + shell
- `apps/web/app/(admin)/layout.test.tsx`
- `apps/web/app/(admin)/admin/page.tsx` — `/admin` → redirect to `/admin/generation`

**Move (via `git mv`, no content edits):**
- `app/(dashboard)/admin/generation/` → `app/(admin)/admin/generation/`
- `app/(dashboard)/admin/theory/` → `app/(admin)/admin/theory/`
- `app/(dashboard)/admin/invites/` → `app/(admin)/admin/invites/`

**Delete:**
- `app/(dashboard)/admin/layout.tsx` (old gate; the now-empty `(dashboard)/admin/` dir disappears automatically)

---

## Task 1: Admin nav source-of-truth + `AdminNav`

**Files:**
- Create: `apps/web/components/admin/admin-nav-items.tsx`
- Create: `apps/web/components/admin/admin-nav.tsx`
- Test: `apps/web/components/admin/__tests__/admin-nav.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/components/admin/__tests__/admin-nav.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { AdminNav } from '../admin-nav';
import { ADMIN_NAV } from '../admin-nav-items';

let mockPath = '/admin/generation';
vi.mock('next/navigation', () => ({
  usePathname: () => mockPath,
}));
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

describe('AdminNav', () => {
  it('exposes Pool/Theory/Invites destinations in order', () => {
    expect(ADMIN_NAV.map((d) => d.href)).toEqual([
      '/admin/generation',
      '/admin/theory',
      '/admin/invites',
    ]);
    expect(ADMIN_NAV.map((d) => d.label)).toEqual(['Pool', 'Theory', 'Invites']);
  });

  it('renders every destination as a link to its href', () => {
    mockPath = '/admin/generation';
    render(<AdminNav />);
    for (const d of ADMIN_NAV) {
      expect(screen.getByRole('link', { name: d.label })).toHaveAttribute(
        'href',
        d.href,
      );
    }
  });

  it('marks the active destination with aria-current=page', () => {
    mockPath = '/admin/theory';
    render(<AdminNav />);
    expect(screen.getByRole('link', { name: 'Theory' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByRole('link', { name: 'Pool' })).not.toHaveAttribute(
      'aria-current',
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/web test "components/admin/__tests__/admin-nav.test.tsx"`
Expected: FAIL — cannot resolve `../admin-nav` / `../admin-nav-items` (modules don't exist yet).

- [ ] **Step 3: Create the source-of-truth array**

Create `apps/web/components/admin/admin-nav-items.tsx`:

```tsx
export interface AdminNavDestination {
  href: string;
  label: string;
}

// Single source of truth for the admin left-nav, mirroring the learner
// `NAV_DESTINATIONS` idiom in components/shell/nav-items.tsx. New sections
// (Moderation, Ops, Users — see docs/admin-panel.md) are appended here as
// they're built.
export const ADMIN_NAV: AdminNavDestination[] = [
  { href: '/admin/generation', label: 'Pool' },
  { href: '/admin/theory', label: 'Theory' },
  { href: '/admin/invites', label: 'Invites' },
];
```

- [ ] **Step 4: Create the `AdminNav` component**

Create `apps/web/components/admin/admin-nav.tsx` (reuses the existing `isActive` from the learner nav to stay DRY):

```tsx
'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '../../lib/cn';
import { isActive } from '../shell/nav-item';
import { ADMIN_NAV } from './admin-nav-items';

export function AdminNav() {
  const pathname = usePathname();
  return (
    <ul className="flex flex-col gap-1 list-none p-0 m-0">
      {ADMIN_NAV.map((d) => {
        const active = isActive(pathname, d.href);
        return (
          <li key={d.href}>
            <Link
              href={d.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex items-center px-s-3 py-s-2 rounded-r-sm text-[13px] transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_rgba(26,22,18,0.08)]',
                active
                  ? 'bg-ink text-paper'
                  : 'text-ink-soft hover:bg-paper-2 hover:text-ink',
              )}
            >
              {d.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/web test "components/admin/__tests__/admin-nav.test.tsx"`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add "apps/web/components/admin/admin-nav-items.tsx" "apps/web/components/admin/admin-nav.tsx" "apps/web/components/admin/__tests__/admin-nav.test.tsx"
git commit -m "feat(admin): admin nav source-of-truth + AdminNav component"
```

---

## Task 2: `AdminShell` wrapper

**Files:**
- Create: `apps/web/components/admin/admin-shell.tsx`
- Test: `apps/web/components/admin/__tests__/admin-shell.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/components/admin/__tests__/admin-shell.test.tsx` (mock `AdminNav` so the shell test stays focused on layout structure, not nav internals):

```tsx
import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../admin-nav', () => ({
  AdminNav: () => <ul data-testid="admin-nav" />,
}));
vi.mock('next/link', () => ({
  default: ({
    href,
    children,
    ...rest
  }: {
    href: string;
    children: React.ReactNode;
    [key: string]: unknown;
  }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

import { AdminShell } from '../admin-shell';

describe('AdminShell', () => {
  it('renders the admin rail, nav, and its children', () => {
    render(
      <AdminShell>
        <p>panel body</p>
      </AdminShell>,
    );
    expect(screen.getByTestId('admin-rail')).toBeInTheDocument();
    expect(screen.getByTestId('admin-nav')).toBeInTheDocument();
    expect(screen.getByText('panel body')).toBeInTheDocument();
  });

  it('links the rail title back to /admin', () => {
    render(
      <AdminShell>
        <p>x</p>
      </AdminShell>,
    );
    expect(screen.getByRole('link', { name: 'Admin' })).toHaveAttribute(
      'href',
      '/admin',
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/web test "components/admin/__tests__/admin-shell.test.tsx"`
Expected: FAIL — cannot resolve `../admin-shell`.

- [ ] **Step 3: Create the `AdminShell` component**

Create `apps/web/components/admin/admin-shell.tsx` (mirrors the desktop branch of `components/shell/app-shell.tsx`; no mobile branch — admin is desktop-oriented):

```tsx
import Link from 'next/link';
import { AdminNav } from './admin-nav';

export function AdminShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen bg-paper">
      <nav
        aria-label="admin"
        data-testid="admin-rail"
        className="w-[220px] flex-shrink-0 flex flex-col gap-1 border-r border-rule bg-paper px-s-4 py-[22px]"
      >
        <Link
          href="/admin"
          className="px-s-2 pb-[18px] font-display text-[20px] font-semibold tracking-[-0.4px] text-ink focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_rgba(26,22,18,0.08)] rounded-r-sm"
        >
          Admin
        </Link>
        <AdminNav />
      </nav>
      <main className="flex-1 min-w-0 min-h-0 overflow-y-auto bg-paper">
        <div className="max-w-max-content mx-auto w-full py-[36px] px-[48px]">
          {children}
        </div>
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/web test "components/admin/__tests__/admin-shell.test.tsx"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/components/admin/admin-shell.tsx" "apps/web/components/admin/__tests__/admin-shell.test.tsx"
git commit -m "feat(admin): AdminShell sidebar + content wrapper"
```

---

## Task 3: `(admin)/layout.tsx` auth gate

**Files:**
- Create: `apps/web/app/(admin)/layout.tsx`
- Test: `apps/web/app/(admin)/layout.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/app/(admin)/layout.test.tsx` (mirrors the theory page test's RSC mocking; mocks `AdminShell` to a passthrough so the test asserts only the gate logic):

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';

const mockApiFetch = vi.fn();
vi.mock('../../lib/api-server', () => ({
  apiFetch: (...args: unknown[]) => mockApiFetch(...args),
}));

const mockRedirect = vi.fn((path: string) => {
  throw new Error(`redirect:${path}`);
});
vi.mock('next/navigation', () => ({
  redirect: (path: string) => mockRedirect(path),
}));

vi.mock('../../components/admin/admin-shell', () => ({
  AdminShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="admin-shell">{children}</div>
  ),
}));

import AdminLayout from './layout';

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function meBody(isAdmin: boolean) {
  return {
    plan: isAdmin ? 'boosted' : 'free',
    isAdmin,
    limits: { evaluation: 50, annotation: 50, deepSpan: 150 },
    usageToday: { evaluation: 0, annotation: 0, deepSpan: 0 },
  };
}

beforeEach(() => {
  mockApiFetch.mockReset();
  mockRedirect.mockClear();
});

describe('AdminLayout', () => {
  it('renders children inside the shell when isAdmin is true', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResponse(meBody(true)));
    render(await AdminLayout({ children: <p>admin content</p> }));
    expect(screen.getByTestId('admin-shell')).toBeInTheDocument();
    expect(screen.getByText('admin content')).toBeInTheDocument();
    expect(mockRedirect).not.toHaveBeenCalled();
  });

  it('redirects to / when isAdmin is false', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResponse(meBody(false)));
    await expect(AdminLayout({ children: <p>nope</p> })).rejects.toThrow(
      'redirect:/',
    );
    expect(mockRedirect).toHaveBeenCalledWith('/');
  });

  it('redirects to / when /me returns a non-200', async () => {
    mockApiFetch.mockResolvedValueOnce(jsonResponse({}, 403));
    await expect(AdminLayout({ children: <p>nope</p> })).rejects.toThrow(
      'redirect:/',
    );
    expect(mockRedirect).toHaveBeenCalledWith('/');
  });

  it('redirects to / when apiFetch throws (unauthenticated)', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('no token'));
    await expect(AdminLayout({ children: <p>nope</p> })).rejects.toThrow(
      'redirect:/',
    );
    expect(mockRedirect).toHaveBeenCalledWith('/');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @language-drill/web test "app/(admin)/layout.test.tsx"`
Expected: FAIL — cannot resolve `./layout`.

- [ ] **Step 3: Create the layout**

Create `apps/web/app/(admin)/layout.tsx`:

```tsx
import { redirect } from 'next/navigation';
import { MeResponseSchema } from '@language-drill/api-client';
import { apiFetch } from '../../lib/api-server';
import { AdminShell } from '../../components/admin/admin-shell';

// Admin access is gated on `GET /me`'s `isAdmin` flag, which the API derives
// from the ADMIN_USER_IDS env var — the single source of truth. The API's
// adminMiddleware is the real security boundary; this gate is UX only.
// `publicMetadata.admin` is no longer consulted (the old (dashboard)/admin
// gate that read it has been removed).
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  let res: Response;
  try {
    res = await apiFetch('/me');
  } catch {
    redirect('/');
  }
  if (!res.ok) redirect('/');

  const me = MeResponseSchema.parse(await res.json());
  if (!me.isAdmin) redirect('/');

  return <AdminShell>{children}</AdminShell>;
}
```

Note: Next.js types `redirect()` as returning `never`, so TypeScript treats the `catch` and the `if (!res.ok)` guards as terminating — `res` is definitely-assigned and `res.ok`-narrowed after them. No `// @ts-expect-error` needed.

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @language-drill/web test "app/(admin)/layout.test.tsx"`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(admin)/layout.tsx" "apps/web/app/(admin)/layout.test.tsx"
git commit -m "feat(admin): /me-driven admin layout gate in (admin) route group"
```

---

## Task 4: Routing cutover — index redirect + move pages + delete old gate

**Files:**
- Create: `apps/web/app/(admin)/admin/page.tsx`
- Move: `app/(dashboard)/admin/{generation,theory,invites}/` → `app/(admin)/admin/{...}/`
- Delete: `app/(dashboard)/admin/layout.tsx`

- [ ] **Step 1: Create the `/admin` index redirect**

Create `apps/web/app/(admin)/admin/page.tsx`:

```tsx
import { redirect } from 'next/navigation';

export default function AdminIndexPage() {
  redirect('/admin/generation');
}
```

- [ ] **Step 2: Move the three page directories and delete the old gate**

Run from the repo root (the new `(admin)/admin` parent must exist first; `git mv` won't create grandparent dirs):

```bash
mkdir -p "apps/web/app/(admin)/admin"
git mv "apps/web/app/(dashboard)/admin/generation" "apps/web/app/(admin)/admin/generation"
git mv "apps/web/app/(dashboard)/admin/theory" "apps/web/app/(admin)/admin/theory"
git mv "apps/web/app/(dashboard)/admin/invites" "apps/web/app/(admin)/admin/invites"
git rm "apps/web/app/(dashboard)/admin/layout.tsx"
```

Verify the old admin dir is gone (Git does not track empty dirs):

```bash
ls "apps/web/app/(dashboard)/admin" 2>/dev/null || echo "removed (good)"
```

Expected: `removed (good)`.

- [ ] **Step 3: Verify the moved theory test still passes at its new path**

The move preserved directory depth, so the test's `../../../../lib/api-server` mock still resolves. Confirm:

Run: `pnpm --filter @language-drill/web test "app/(admin)/admin/theory/page.test.tsx"`
Expected: PASS (6 tests) — unchanged from before the move.

- [ ] **Step 4: Typecheck the web app to confirm no import broke in the move**

Run: `pnpm --filter @language-drill/web typecheck`
Expected: no errors. (Confirms the moved `generation`/`invites` pages' relative imports — `../../../../lib/api-server`, `../../../../components/ui`, `./_components/...` — still resolve, and the new layout/page compile.)

- [ ] **Step 5: Commit**

```bash
git add -A "apps/web/app"
git commit -m "feat(admin): move admin pages into (admin) shell, add /admin redirect, drop publicMetadata gate"
```

---

## Task 5: Full verification + regression sweep

**Files:** none (verification only).

- [ ] **Step 1: Confirm no lingering `publicMetadata.admin` gate**

Run: `grep -rn "publicMetadata" apps/web/app apps/web/components`
Expected: **no matches** in `app/` or `components/` (the only prior match was the deleted layout). Matches in `apps/web/e2e/helpers/auth.ts` are the unrelated `e2eTestUser` metadata — leave them.

- [ ] **Step 2: Lint the web app**

Run: `pnpm --filter @language-drill/web lint`
Expected: no errors.

- [ ] **Step 3: Typecheck the whole repo**

Run: `pnpm typecheck`
Expected: no errors across all packages.

- [ ] **Step 4: Full test suite (serial, to avoid the known infra parallel flake)**

Run: `pnpm turbo run test --concurrency=1`
Expected: all packages pass, including the new `admin-nav`, `admin-shell`, and `(admin)/layout` tests and the moved theory test.

- [ ] **Step 5: Commit (only if any lint/format autofix changed files; otherwise skip)**

```bash
git add -A && git commit -m "chore(admin): verification fixes" || echo "nothing to commit"
```

---

## Self-review notes (for the implementer)

- **Spec coverage:** consolidated auth → Task 3 (gate) + Task 4 (old gate deleted); unified shell + left-nav → Tasks 1–2; re-home pages, URLs unchanged → Task 4; "nav shows only what exists" → `ADMIN_NAV` (Task 1, three live entries); no premature table abstraction → none added. All spec items mapped.
- **Type consistency:** `ADMIN_NAV` / `AdminNavDestination` (Task 1) used by `AdminNav` (Task 1) and asserted in its test; `AdminShell` (Task 2) consumed by the layout (Task 3) and mocked in both the layout test and shell test consistently; `MeResponseSchema` shape in the layout test fixture matches `packages/api-client/src/schemas/me.ts` (`plan`, `isAdmin`, `limits`, `usageToday`).
- **Intermediate-state note:** between Task 3 and Task 4, `(admin)/layout.tsx` exists with no child page yet (harmless — `/admin` 404s until Task 4 adds the index); the old `(dashboard)/admin/*` routes keep working until Task 4 moves them. No two route groups ever resolve the same path simultaneously.
