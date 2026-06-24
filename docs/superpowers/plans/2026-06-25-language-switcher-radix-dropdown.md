# LanguageSwitcher → Radix DropdownMenu Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hand-rolled `role="listbox"` `LanguageSwitcher` with a `@radix-ui/react-dropdown-menu` + RadioGroup implementation that gets keyboard nav, typeahead, focus management, and dismissal for free, with the public API frozen.

**Architecture:** Radix `DropdownMenu` (controlled `open`) with a `RadioGroup` of `RadioItem`s for the languages and a `Separator` + `Item`-wrapped Link for "manage languages". Selecting a different language calls the existing `setActiveLanguage` (which reloads). Single/zero-profile branches are unchanged.

**Tech Stack:** Next.js (App Router client component), React 19, TypeScript, `@radix-ui/react-dropdown-menu`, Tailwind v4, Vitest + Testing Library + `@testing-library/user-event`.

## Global Constraints

- Package versions: **always latest stable** (CLAUDE.md). Add deps via `pnpm add` (no manual pin).
- Public API of `LanguageSwitcher` is **frozen**: `({ profiles }: { profiles: LanguageProfile[] })`, returns `JSX.Element | null`. No change to the only call site `apps/web/components/shell/nav.tsx`.
- No shadcn CLI, no shadcn theme variables — style with existing tokens only (`bg-card`, `border-rule`, `bg-paper-2`, `text-ink`, `text-ink-mute`, `text-ink-soft`, `shadow-2`, `rounded-r-md`, spacing `s-*`).
- Semantic change is intended: `role="listbox"`→`menu`, `role="option"`→`menuitemradio`, `aria-haspopup`→`"menu"`.
- Mobile `language-sheet.tsx` and its tests are **out of scope** — do not touch.
- Pre-push gate (repo root, must be clean): `pnpm lint`, `pnpm typecheck`, `pnpm test`.

---

### Task 1: Add dependencies and Radix test polyfills

**Files:**
- Modify: `apps/web/package.json` (deps)
- Modify: `apps/web/vitest.setup.ts` (append polyfills)

**Interfaces:**
- Produces: `@radix-ui/react-dropdown-menu` and `@testing-library/user-event` available to `@language-drill/web`; jsdom polyfills (`ResizeObserver`, `scrollIntoView`, pointer-capture) so Radix components can mount and be driven in tests.

- [x] **Step 1: Install the runtime dep and the dev dep**

Run from repo root:

```bash
pnpm --filter @language-drill/web add @radix-ui/react-dropdown-menu
pnpm --filter @language-drill/web add -D @testing-library/user-event
```

- [x] **Step 2: Append Radix polyfills to the vitest setup**

Append to `apps/web/vitest.setup.ts` (after the existing IntersectionObserver block):

```ts
// ---------------------------------------------------------------------------
// Radix UI polyfills
// ---------------------------------------------------------------------------
// @radix-ui/react-dropdown-menu (and siblings) call DOM APIs jsdom doesn't
// implement. Without these, mounting a Radix menu or driving it via
// user-event throws.

class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}
vi.stubGlobal('ResizeObserver', MockResizeObserver);

Element.prototype.scrollIntoView = vi.fn();
Element.prototype.hasPointerCapture = vi.fn(() => false);
Element.prototype.setPointerCapture = vi.fn();
Element.prototype.releasePointerCapture = vi.fn();
```

- [x] **Step 3: Confirm the existing web suite still passes (polyfills are additive, break nothing)**

Run:

```bash
pnpm --filter @language-drill/web test
```

Expected: the full web suite passes (same green as before — these are additive global stubs). If anything fails, the polyfills are interfering and must be reconciled before proceeding.

- [x] **Step 4: Commit**

```bash
git add apps/web/package.json apps/web/vitest.setup.ts pnpm-lock.yaml
git commit -m "build(web): add @radix-ui/react-dropdown-menu + user-event and Radix test polyfills"
```

---

### Task 2: Migrate the component and rewrite its tests (TDD)

**Files:**
- Modify: `apps/web/components/shell/language-switcher.tsx` (rewrite the multi-profile branch)
- Test: `apps/web/components/shell/__tests__/language-switcher.test.tsx` (rewrite to new roles + user-event)

**Interfaces:**
- Consumes: `useActiveLanguage()` (`{ activeLanguage, setActiveLanguage }`) from `./active-language-provider`; `Flagdot` from `./flagdot`; `LANGUAGE_NAMES`, `LanguageProfile` from `@language-drill/shared`; `LearningLanguage`, `isLearningLanguage` from `../../lib/active-language`; `cn` from `../../lib/cn`; `@radix-ui/react-dropdown-menu` as `DropdownMenu`.
- Produces: unchanged export `LanguageSwitcher({ profiles })`.

- [x] **Step 1: Rewrite the test file**

Replace the entire `describe('LanguageSwitcher', ...)` body in
`apps/web/components/shell/__tests__/language-switcher.test.tsx` with the tests
below. Keep the file's existing imports/mocks/helpers (lines 1–69) **except**:
add `import userEvent from '@testing-library/user-event';` to the imports, and
remove `fireEvent` from the `@testing-library/react` import if it becomes unused
(it does — all interactions move to user-event; keep `within`).

```tsx
describe('LanguageSwitcher', () => {
  let reloadMock: ReturnType<typeof vi.fn>;
  let originalLocation: Location;

  beforeEach(() => {
    clearActiveLanguageCookie();
    reloadMock = vi.fn();
    originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      value: { ...originalLocation, reload: reloadMock },
      writable: true,
      configurable: true,
    });
  });

  afterEach(() => {
    clearActiveLanguageCookie();
    Object.defineProperty(window, 'location', {
      value: originalLocation,
      writable: true,
      configurable: true,
    });
  });

  it('renders the active language with flagdot, name, and CEFR level', () => {
    renderWithProvider([PROFILE_ES, PROFILE_DE]);

    const trigger = screen.getByRole('button');
    expect(within(trigger).getByText('es')).toBeInTheDocument();
    expect(within(trigger).getByText('spanish')).toBeInTheDocument();
    expect(within(trigger).getByText('A2')).toBeInTheDocument();
  });

  it('disables the trigger and omits aria-haspopup when only one learning profile', () => {
    renderWithProvider([PROFILE_ES]);

    const trigger = screen.getByRole('button');
    expect(trigger).toBeDisabled();
    expect(trigger).not.toHaveAttribute('aria-haspopup');
    expect(trigger).not.toHaveAttribute('aria-expanded');
  });

  it('returns null when there are zero learning profiles', () => {
    const { container } = renderWithProvider([PROFILE_EN]);
    expect(container.querySelector('button')).toBeNull();
  });

  it('opens the menu when the trigger is clicked', async () => {
    const user = userEvent.setup();
    renderWithProvider([PROFILE_ES, PROFILE_DE]);

    const trigger = screen.getByRole('button');
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    await user.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('filters EN out of the menu', async () => {
    const user = userEvent.setup();
    renderWithProvider([PROFILE_EN, PROFILE_ES, PROFILE_DE]);

    await user.click(screen.getByRole('button'));
    const menu = screen.getByRole('menu');

    expect(within(menu).getByText('spanish')).toBeInTheDocument();
    expect(within(menu).getByText('german')).toBeInTheDocument();
    expect(within(menu).queryByText('english')).not.toBeInTheDocument();
    expect(within(menu).getAllByRole('menuitemradio')).toHaveLength(2);
  });

  it('clicking a different language reloads', async () => {
    const user = userEvent.setup();
    renderWithProvider([PROFILE_ES, PROFILE_DE]);

    await user.click(screen.getByRole('button'));
    const options = within(screen.getByRole('menu')).getAllByRole('menuitemradio');
    const de = options.find((o) => o.textContent?.toLowerCase().includes('german'));
    expect(de).toBeDefined();
    await user.click(de!);

    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('clicking the active language closes the menu without reloading', async () => {
    const user = userEvent.setup();
    renderWithProvider([PROFILE_ES, PROFILE_DE]);

    await user.click(screen.getByRole('button'));
    const options = within(screen.getByRole('menu')).getAllByRole('menuitemradio');
    const es = options.find((o) => o.textContent?.toLowerCase().includes('spanish'));
    await user.click(es!);

    expect(reloadMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('Escape closes the menu', async () => {
    const user = userEvent.setup();
    renderWithProvider([PROFILE_ES, PROFILE_DE]);

    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('clicking outside closes the menu', async () => {
    const user = userEvent.setup();
    renderWithProvider([PROFILE_ES, PROFILE_DE]);

    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('menu')).toBeInTheDocument();

    await user.click(document.body);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('selects the next language by keyboard (ArrowDown + Enter) and reloads', async () => {
    const user = userEvent.setup();
    renderWithProvider([PROFILE_ES, PROFILE_DE]);

    await user.click(screen.getByRole('button'));
    // Focus opens on the checked item (ES); move to DE and commit.
    await user.keyboard('{ArrowDown}{Enter}');

    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('"manage languages" item links to /settings', async () => {
    const user = userEvent.setup();
    renderWithProvider([PROFILE_ES, PROFILE_DE]);

    await user.click(screen.getByRole('button'));
    const link = screen.getByRole('menuitem', { name: /manage languages/i });
    expect(link).toHaveAttribute('href', '/settings');
  });
});
```

- [x] **Step 2: Run the rewritten tests against the OLD component — verify they FAIL**

Run:

```bash
pnpm --filter @language-drill/web test -- language-switcher
```

Expected: the menu/menuitemradio tests FAIL — the old component renders
`role="listbox"`/`role="option"`, so `getByRole('menu')` finds nothing. (The
sync trigger-render / single-disabled / zero-null tests may still pass.) This
confirms the tests exercise the new contract.

- [x] **Step 3: Rewrite the component**

Replace the entire contents of `apps/web/components/shell/language-switcher.tsx` with:

```tsx
'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  LANGUAGE_NAMES,
  type LanguageProfile,
} from '@language-drill/shared';
import {
  type LearningLanguage,
  isLearningLanguage,
} from '../../lib/active-language';
import { cn } from '../../lib/cn';
import { useActiveLanguage } from './active-language-provider';
import { Flagdot } from './flagdot';

interface LanguageSwitcherProps {
  profiles: LanguageProfile[];
}

type LearningProfile = LanguageProfile & { language: LearningLanguage };

const focusRing =
  'focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_rgba(26,22,18,0.08)]';

const triggerClass = cn(
  'w-full flex items-center justify-between gap-s-2 px-s-3 py-[10px] border border-rule rounded-r-md transition-colors duration-150 enabled:hover:bg-paper-2 disabled:cursor-default',
  focusRing,
);

export function LanguageSwitcher({ profiles }: LanguageSwitcherProps) {
  const { activeLanguage, setActiveLanguage } = useActiveLanguage();
  const [open, setOpen] = useState(false);

  const learningProfiles = useMemo<LearningProfile[]>(
    () =>
      profiles.filter((p): p is LearningProfile => isLearningLanguage(p.language)),
    [profiles],
  );

  if (learningProfiles.length === 0) return null;

  const activeProfile = learningProfiles.find((p) => p.language === activeLanguage);

  const triggerInner = (
    <>
      <span className="flex items-center gap-s-2 min-w-0">
        <Flagdot language={activeLanguage} />
        <span className="text-[13px] font-medium text-ink truncate">
          {LANGUAGE_NAMES[activeLanguage].toLowerCase()}
        </span>
      </span>
      {activeProfile && (
        <span className="font-mono text-[10px] text-ink-mute">
          {activeProfile.proficiencyLevel}
        </span>
      )}
    </>
  );

  // Single learning language: nothing to switch to — a plain disabled button.
  if (learningProfiles.length === 1) {
    return (
      <div className="mb-s-3">
        <button type="button" disabled className={triggerClass}>
          {triggerInner}
        </button>
      </div>
    );
  }

  function onValueChange(next: string) {
    if (isLearningLanguage(next) && next !== activeLanguage) {
      setActiveLanguage(next);
    }
  }

  return (
    <div className="mb-s-3">
      <DropdownMenu.Root open={open} onOpenChange={setOpen}>
        <DropdownMenu.Trigger asChild>
          <button type="button" className={triggerClass}>
            {triggerInner}
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content
            align="start"
            sideOffset={4}
            style={{ width: 'var(--radix-dropdown-menu-trigger-width)' }}
            className="z-10 bg-card border border-rule rounded-r-md shadow-2 py-1"
          >
            <DropdownMenu.RadioGroup value={activeLanguage} onValueChange={onValueChange}>
              {learningProfiles.map((p) => (
                <DropdownMenu.RadioItem
                  key={p.language}
                  value={p.language}
                  className={cn(
                    'w-full flex items-center gap-s-2 px-s-3 py-s-2 cursor-pointer outline-none transition-colors duration-150 hover:bg-paper-2 data-[highlighted]:bg-paper-2',
                    focusRing,
                  )}
                >
                  <Flagdot language={p.language} />
                  <span className="flex-1 text-left text-[13px] text-ink">
                    {LANGUAGE_NAMES[p.language].toLowerCase()}
                  </span>
                  <span className="font-mono text-[10px] text-ink-mute">
                    {p.proficiencyLevel}
                  </span>
                  {p.language === activeLanguage && (
                    <span className="w-2 h-2 rounded-full bg-accent" aria-hidden="true" />
                  )}
                </DropdownMenu.RadioItem>
              ))}
            </DropdownMenu.RadioGroup>
            <DropdownMenu.Separator className="my-1 h-px bg-rule" />
            <DropdownMenu.Item asChild>
              <Link
                href="/settings"
                className={cn(
                  'block px-s-3 py-s-2 text-[12px] text-ink-soft outline-none transition-colors duration-150 hover:bg-paper-2 data-[highlighted]:bg-paper-2',
                  focusRing,
                )}
              >
                manage languages →
              </Link>
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  );
}
```

Notes for the implementer (do not paste into the file):
- `DropdownMenu.Trigger asChild` sets `aria-haspopup="menu"` + `aria-expanded` on the button automatically — do not add them by hand.
- `RadioItem` renders `role="menuitemradio"` with `aria-checked`; the accent dot is decorative (`aria-hidden`) and is NOT `ItemIndicator`.
- `Item asChild` over the `<Link>` makes the anchor `role="menuitem"` while keeping its `href` — that's why the test queries `getByRole('menuitem', { name: /manage languages/i })`.
- Selecting any item closes the menu (Radix); the guard in `onValueChange` is what prevents a reload when the active language is re-selected.

- [x] **Step 4: Run the component's tests — all PASS**

Run:

```bash
pnpm --filter @language-drill/web test -- language-switcher
```

Expected: all tests in the file pass. If the keyboard test (`ArrowDown + Enter`)
is flaky, confirm the polyfills from Task 1 are present and that the menu opened
(focus must be inside the content for `user.keyboard` to reach Radix's handler).

- [x] **Step 5: Pre-push gate**

Run from repo root:

```bash
pnpm lint && pnpm typecheck && pnpm test
```

Expected: all three pass with zero failures.

- [x] **Step 6: Commit**

```bash
git add apps/web/components/shell/language-switcher.tsx \
        apps/web/components/shell/__tests__/language-switcher.test.tsx
git commit -m "refactor(shell): rebuild LanguageSwitcher on Radix DropdownMenu + RadioGroup"
```

---

## Self-Review

**Spec coverage:**
- Radix DropdownMenu + RadioGroup, mixed options + manage-link → Task 2 Step 3. ✓
- Public API frozen; no `nav.tsx` change → Global Constraints + component signature. ✓
- Single/zero-profile branches unchanged → Task 2 Step 3 (early returns). ✓
- `setActiveLanguage` only on a different language → `onValueChange` guard. ✓
- Removed `handleListboxKey`/`focusedIdx`/manual `useEffect` → not present in rewrite. ✓
- Semantic role change (`menu`/`menuitemradio`/`aria-haspopup="menu"`) → Radix + test requeries. ✓
- New deps + polyfills → Task 1. ✓
- Tests: requeried roles, dropped 2 `data-focused` tests, added keyboard test, kept the rest → Task 2 Step 1. ✓
- Token-only styling, no shadcn vars → rewrite uses `bg-card`/`border-rule`/`bg-paper-2`/`text-ink*`/`shadow-2`. ✓
- Mobile `language-sheet` untouched → not in any task's file list. ✓

**Placeholder scan:** none — all code blocks are complete.

**Type consistency:** `LanguageSwitcherProps`, `LearningProfile`, and the `LanguageSwitcher({ profiles })` signature match the original export and the `nav.tsx` call site; `onValueChange(next: string)` narrows via `isLearningLanguage` before `setActiveLanguage`.

**Roadmap:** components #3 (word-popover) and #4 (cookie-banner) remain, tracked in the spec appendix.
