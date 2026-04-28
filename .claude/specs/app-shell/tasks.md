# App Shell — Tasks

## Task Overview

Build the persistent left-rail navigation: helpers + 9 components + 4 placeholder/redirect pages + layout wiring + drill route migration. ~22 atomic tasks.

Dependency flow: helpers → context → leaf components → composed components → layout integration → route migration → placeholder pages.

---

## Task 1: Active language helpers

**Ref:** FR-6.1, FR-6.4, NFR-4
**Files:** `apps/web/lib/active-language.ts` (create)
**Estimated time:** 15 min

Create the shared helpers module:
- Export `LearningLanguage` type as `Exclude<Language, Language.EN>`
- Export `isLearningLanguage(value: unknown): value is LearningLanguage` — accepts only ES/DE/TR
- Export `readActiveLanguageCookie(): LearningLanguage | null` — parses `document.cookie`, validates with `isLearningLanguage`, returns null in non-browser environments (typeof document === 'undefined')
- Export `writeActiveLanguageCookie(lang: LearningLanguage): void` — writes `active_language=<lang>; path=/; SameSite=Lax; max-age=31536000`

Use the `Language` enum from `@language-drill/shared`.

**Verify:** Run `pnpm typecheck` — confirm zero errors.

---

## Task 2: Active language helpers tests

**Ref:** NFR-7
**Files:** `apps/web/lib/__tests__/active-language.test.ts` (create)
**Estimated time:** 15 min
**Depends on:** Task 1

**Testing note:** This module touches `document.cookie`. Use jsdom (already configured). Reset `document.cookie` between tests via `document.cookie = 'active_language=; max-age=0; path=/'`.

Test cases:
- `isLearningLanguage` accepts 'ES', 'DE', 'TR'; rejects 'EN', 'FR', '', null, undefined, 123
- `readActiveLanguageCookie` returns null when cookie absent
- `readActiveLanguageCookie` returns the parsed Language for valid value
- `readActiveLanguageCookie` returns null for invalid value (e.g., 'XX')
- `readActiveLanguageCookie` returns null when value is 'EN' (not a learning language)
- `writeActiveLanguageCookie('DE')` produces a cookie that `readActiveLanguageCookie` can read back

Run `pnpm test --filter=@language-drill/web` to verify.

---

## Task 3: ActiveLanguageProvider component

**Ref:** FR-6.2, FR-6.3
**Files:** `apps/web/components/shell/active-language-provider.tsx` (create)
**Estimated time:** 20 min
**Depends on:** Task 1

Create the React context provider:
- `'use client'` directive
- `ActiveLanguageContext` (createContext, default null)
- `ActiveLanguageProvider({ profiles, children })` — accepts `LanguageProfile[]` from `@language-drill/shared` and React children
- Lazy `useState` initializer that:
  1. Filters profiles to learning languages only (excludes EN)
  2. Reads cookie via `readActiveLanguageCookie()`
  3. Returns the cookie value if it's in the user's learning profiles, else first learning profile, else `'ES'` as final fallback
- `setActiveLanguage(lang)` writes cookie, updates state, then calls `window.location.reload()`
- `useActiveLanguage()` hook — throws if used outside provider

Use the helpers from `apps/web/lib/active-language.ts`.

**Verify:** Run `pnpm typecheck`.

---

## Task 4: Flagdot component

**Ref:** FR-3.2
**Files:** `apps/web/components/shell/flagdot.tsx` (create)
**Estimated time:** 10 min
**Depends on:** Task 1

Create the 24px colored circle:
- Props: `language: LearningLanguage`, `className?: string`
- Color map: `ES → bg-accent`, `DE → bg-[#4b4138]`, `TR → bg-[#c01818]`
- Renders `<span aria-hidden="true">` with classes: `inline-flex items-center justify-center w-[24px] h-[24px] rounded-full font-mono text-[10px] font-semibold text-white flex-shrink-0` plus the color class
- Inner content: `language.toLowerCase()` (e.g., "es")
- Uses `cn()` from `apps/web/lib/cn.ts`

---

## Task 5: Flagdot tests

**Ref:** NFR-7
**Files:** `apps/web/components/shell/__tests__/flagdot.test.tsx` (create)
**Estimated time:** 10 min
**Depends on:** Task 4

Test:
- Renders for ES/DE/TR with correct color class (bg-accent / bg-[#4b4138] / bg-[#c01818])
- Renders the lowercase 2-letter code as text content
- Has `aria-hidden="true"`
- Has font-mono class
- Merges custom className

---

## Task 6: NavIcons component

**Ref:** FR-4.2
**Files:** `apps/web/components/shell/nav-icons.tsx` (create)
**Estimated time:** 15 min
**Depends on:** none — independent

Create 4 SVG icon components — each 16×16, `stroke="currentColor"`, `strokeWidth={1.7}`, `fill="none"`, `strokeLinecap="round"`, `strokeLinejoin="round"`:
- `TodayIcon` — sun with rays (a circle in center + 8 short rays)
- `DrillIcon` — play triangle inside circle outline
- `ReadIcon` — open book (two pages with binding line in center)
- `ProgressIcon` — bar chart (3 ascending vertical bars)

Each is a named export. No props needed (size and stroke are baked in; consumers use parent's `text-*` to control color via `currentColor`).

**Verify:** Run `pnpm typecheck`.

---

## Task 7: NavItem component

**Ref:** FR-4.3, FR-4.4, FR-4.5, NFR-2
**Files:** `apps/web/components/shell/nav-item.tsx` (create)
**Estimated time:** 15 min

Create the single nav item:
- `'use client'` (uses `usePathname` from `next/navigation`)
- Props: `href: string`, `label: string`, `icon: React.ReactNode`
- Helper: `isActive(pathname, href)` — returns true if `href === '/' && pathname === '/'`, else if `pathname === href || pathname.startsWith(href + '/')`
- Renders `<li>` containing a Next.js `<Link>` with:
  - `aria-current="page"` when active
  - Active classes: `bg-ink text-paper`
  - Inactive classes: `text-ink-soft hover:bg-paper-2 hover:text-ink`
  - Shared classes: `flex items-center gap-s-3 px-s-3 py-s-2 rounded-r-sm text-[13px] transition-colors duration-150 focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_rgba(26,22,18,0.08)]`
  - Icon wrapped in `<span className="flex-shrink-0 w-4 h-4">`

Use `cn()` from `lib/cn`.

---

## Task 8: NavItem tests

**Ref:** NFR-7
**Files:** `apps/web/components/shell/__tests__/nav-item.test.tsx` (create)
**Estimated time:** 15 min
**Depends on:** Task 7

Mock `next/navigation`'s `usePathname` and `next/link` (see existing pattern in `apps/web/app/(dashboard)/practice/page.test.tsx` for the Next.js mocking approach).

Test cases:
- Renders Link with href and label text
- When pathname matches href exactly → active classes (`bg-ink`, `text-paper`) and `aria-current="page"`
- When pathname starts with href + '/' (nested route) → active
- When href is '/' and pathname is '/' → active
- When href is '/' and pathname is '/drill' → NOT active (only exact match for root)
- When inactive → no `aria-current`, has hover/inactive classes
- Renders the icon node passed in

---

## Task 9: NavItems composition

**Ref:** FR-4.1, FR-4.2
**Files:** `apps/web/components/shell/nav-items.tsx` (create)
**Estimated time:** 5 min
**Depends on:** Task 6, Task 7

Create the static list:
- Renders `<ul className="flex flex-col gap-1 list-none p-0 m-0">`
- 4 NavItem children in order: today (`/`, TodayIcon), drill (`/drill`, DrillIcon), read (`/read`, ReadIcon), progress (`/progress`, ProgressIcon)

**Note:** Do NOT add `'use client'` directive — this is a server component. Only `NavItem` needs to be client (for `usePathname`).

---

## Task 10: Brand component

**Ref:** FR-2.1, FR-2.2
**Files:** `apps/web/components/shell/brand.tsx` (create)
**Estimated time:** 10 min

Create the brand:
- Renders Next.js `<Link href="/">` with classes: `flex items-center gap-s-2 px-s-2 pb-[18px] focus-visible:outline-none focus-visible:shadow-[0_0_0_3px_rgba(26,22,18,0.08)] rounded-r-sm`
- Inside: 28px square mark — `<span className="w-[28px] h-[28px] rounded-[7px] bg-ink text-paper flex items-center justify-center font-display font-semibold">d</span>`
- Plus the name — `<span className="font-display text-[20px] font-semibold tracking-[-0.4px] text-ink">drill</span>`

---

## Task 11: LanguageSwitcher component

**Ref:** FR-3.1, FR-3.3, FR-3.4, FR-3.5, FR-3.6, FR-3.7, NFR-2
**Files:** `apps/web/components/shell/language-switcher.tsx` (create)
**Estimated time:** 30 min
**Depends on:** Task 1, Task 3, Task 4

Create the dropdown switcher per the design spec. Key behaviors:
- `'use client'` directive
- Props: `profiles: LanguageProfile[]`
- Filters to learning profiles via `isLearningLanguage`
- Disabled (no dropdown) when only 1 learning profile
- Returns null when 0 learning profiles
- Click outside / Escape closes dropdown
- Arrow up/down moves focus index between options
- Enter/Space on focused option calls `setActiveLanguage`
- Renders flagdot + lowercase language name + CEFR level on the trigger
- Dropdown shows: each option (flagdot + name + CEFR + active dot) + "manage languages →" link to `/onboarding?edit=1`
- All interactive elements have focus-visible ring (`focus-visible:shadow-[0_0_0_3px_rgba(26,22,18,0.08)]`)
- Uses `useActiveLanguage` hook from the provider

Reference the full implementation in `design.md` under "LanguageSwitcher" section.

**Verify:** Run `pnpm typecheck`.

---

## Task 12: LanguageSwitcher tests

**Ref:** NFR-7, NFR-2
**Files:** `apps/web/components/shell/__tests__/language-switcher.test.tsx` (create)
**Estimated time:** 25 min
**Depends on:** Task 11

Mock `next/link`, `next/navigation`, and wrap render in `<ActiveLanguageProvider profiles={...}>` for tests.

**Testing note:** `setActiveLanguage` calls `window.location.reload()`. Mock `window.location` or stub the function via `Object.defineProperty(window, 'location', { value: { reload: vi.fn() }, writable: true })` in `beforeEach`.

Test cases:
- Renders the active language with flagdot, name, and CEFR level
- Filters EN out of the dropdown (profile with `language: 'EN'` is not shown)
- When only 1 learning profile, button is disabled and has no aria-haspopup
- Returns null when 0 learning profiles
- Click on trigger opens dropdown (aria-expanded becomes true)
- Click on a different language option calls reload (mocked)
- Click on the same language option closes without reload
- Escape key closes dropdown
- Click outside closes dropdown
- ArrowDown/ArrowUp move the focused index (visible via `data-focused` attr or background class)
- Enter on a focused option triggers selection
- "manage languages" link points to `/onboarding?edit=1`

---

## Task 13: UserFooter component

**Ref:** FR-5.1, FR-5.2, FR-5.3, FR-5.4, FR-5.5, NFR-5
**Files:** `apps/web/components/shell/user-footer.tsx` (create)
**Estimated time:** 25 min

Create the footer per the design spec. Key behaviors:
- `'use client'` directive
- Uses `useUser` and `useClerk` from `@clerk/nextjs`
- Loading state (when `!isLoaded`): paper-2 pulsing skeleton (avatar circle + name bar)
- `getInitials(firstName, lastName)`: returns `firstName[0]+lastName[0]` if both, else `firstName[0]`, else `'?'` (uppercase)
- Avatar: 30px circle, `bg-accent-soft text-accent-2 font-display text-[14px] font-semibold`
- Name: lowercase first name, falls back to "you"
- Overflow menu (3-dot trigger): toggles a popover above the footer with "settings" link to `/settings` and "sign out" button calling `signOut({ redirectUrl: '/sign-in' })`
- Click outside / Escape closes menu
- Menu items have focus-visible rings
- Footer has `mt-auto pt-[18px] border-t border-rule` for sticky-bottom positioning
- No streak / XP / gamification anywhere

Reference the full implementation in `design.md` under "UserFooter" section.

---

## Task 14: UserFooter tests

**Ref:** NFR-7
**Files:** `apps/web/components/shell/__tests__/user-footer.test.tsx` (create)
**Estimated time:** 20 min
**Depends on:** Task 13

Mock `@clerk/nextjs` `useUser` and `useClerk`. The existing practice page test file shows a Clerk mocking pattern.

Test cases:
- Renders skeleton when `isLoaded === false`
- Renders initials from firstName + lastName ("Sam Smith" → "SS")
- Renders firstName initial only when no lastName ("Sam" + null → "S")
- Renders "?" when no firstName ("?" expected)
- Renders lowercase first name as text ("sam"), falls back to "you" when null
- Click on trigger opens menu (aria-expanded becomes true)
- Menu shows "settings" link to `/settings`
- Click "sign out" calls `signOut` mock with `{ redirectUrl: '/sign-in' }`
- Escape closes menu
- Click outside closes menu

---

## Task 15: Nav composition

**Ref:** FR-1.4, NFR-2
**Files:** `apps/web/components/shell/nav.tsx` (create)
**Estimated time:** 5 min
**Depends on:** Task 9, Task 10, Task 11, Task 13

Create the nav composition:
- `'use client'`
- Props: `profiles: LanguageProfile[]`
- Renders `<nav aria-label="primary" className="w-[220px] flex-shrink-0 flex flex-col gap-1 border-r border-rule bg-paper px-s-4 py-[22px]">`
- Children: `<Brand />`, `<LanguageSwitcher profiles={profiles} />`, `<NavItems />`, `<UserFooter />`

---

## Task 16: AppShell wrapper

**Ref:** FR-1.1, FR-1.2, FR-1.3, FR-1.4
**Files:** `apps/web/components/shell/app-shell.tsx` (create)
**Estimated time:** 5 min
**Depends on:** Task 15

Create the layout wrapper:
- `'use client'`
- Props: `profiles: LanguageProfile[]`, `children: React.ReactNode`
- Renders `<div className="flex h-screen bg-paper">` containing `<Nav profiles={profiles} />` and `<main className="flex-1 min-w-0 min-h-0 overflow-y-auto bg-paper">` with inner div `<div className="max-w-max-content mx-auto w-full py-[36px] px-[48px]">{children}</div>`

---

## Task 17: Shell barrel export

**Ref:** NFR-6
**Files:** `apps/web/components/shell/index.ts` (create)
**Estimated time:** 5 min
**Depends on:** Tasks 3, 4, 6, 7, 9, 10, 11, 13, 15, 16

Create the barrel:
```typescript
export { ActiveLanguageProvider, useActiveLanguage } from './active-language-provider';
export { AppShell } from './app-shell';
export { Nav } from './nav';
export { Brand } from './brand';
export { LanguageSwitcher } from './language-switcher';
export { Flagdot } from './flagdot';
export { NavItems } from './nav-items';
export { NavItem } from './nav-item';
export { UserFooter } from './user-footer';
export { TodayIcon, DrillIcon, ReadIcon, ProgressIcon } from './nav-icons';
```

**Verify:** Run `pnpm typecheck`.

---

## Task 18: Wire shell into dashboard layout

**Ref:** FR-1.1, FR-6.2, NFR-5
**Files:** `apps/web/app/(dashboard)/layout.tsx` (modify)
**Estimated time:** 15 min
**Depends on:** Task 17

**Leverage:** existing `apps/web/app/(dashboard)/layout.tsx` — keep `"use client"`, `useAuth`, `useLanguageProfiles`, loading/error/redirect logic.

Changes:
1. Import `ActiveLanguageProvider` and `AppShell` from `../../components/shell`
2. Restyle the loading spinner to use design tokens: `bg-paper`, `border-paper-2 border-t-ink`
3. Restyle the error card to use design tokens: `bg-card border-rule shadow-1` for the card; ink + accent-2 hover for the retry button; `t-display-s` and `t-small` text classes
4. Keep the existing `if (data && data.profiles.length === 0) router.push("/onboarding")` redirect branch — but restyle its loading spinner to use design tokens too
5. Replace the final `return <>{children}</>` with:
   ```tsx
   return (
     <ActiveLanguageProvider profiles={data?.profiles ?? []}>
       <AppShell profiles={data?.profiles ?? []}>{children}</AppShell>
     </ActiveLanguageProvider>
   );
   ```

**Verify:** Run `pnpm typecheck` and `pnpm dev:web` — confirm app loads, the left rail renders, and clicking nav items routes correctly.

---

## Task 19: Migrate /practice → /drill

**Ref:** FR-8.1, FR-8.2
**Files:**
- `apps/web/app/(dashboard)/drill/page.tsx` (create — moved content)
- `apps/web/app/(dashboard)/drill/page.test.tsx` (create — moved content)
- `apps/web/app/(dashboard)/practice/page.tsx` (replace with redirect)
- delete `apps/web/app/(dashboard)/practice/page.test.tsx`
**Estimated time:** 20 min
**Depends on:** Task 18

Steps:
1. Read `apps/web/app/(dashboard)/practice/page.tsx`, write its content to `apps/web/app/(dashboard)/drill/page.tsx`. Verify all relative imports still resolve.
2. Read `apps/web/app/(dashboard)/practice/page.test.tsx`, write its content to `apps/web/app/(dashboard)/drill/page.test.tsx`. The test imports `./page` — that still works after the move.
3. Replace `apps/web/app/(dashboard)/practice/page.tsx` content with the redirect:
   ```typescript
   import { redirect } from 'next/navigation';
   export default function PracticeRedirect() {
     redirect('/drill');
   }
   ```
4. **Delete** the old test file via Bash: `rm "apps/web/app/(dashboard)/practice/page.test.tsx"` (the `Edit` and `Write` tools cannot remove files).

**Verify:** Run `pnpm test` — all existing practice page tests pass at the new location. Run `pnpm typecheck`.

---

## Task 20: Read placeholder page

**Ref:** FR-7.1
**Files:** `apps/web/app/(dashboard)/read/page.tsx` (create)
**Estimated time:** 5 min

Create the placeholder:
```typescript
import { Card } from '../../../components/ui';

export default function ReadPlaceholder() {
  return (
    <div>
      <h1 className="t-display-l mb-s-4">read & collect</h1>
      <Card padding="lg">
        <p className="t-body-l">
          coming soon — paste anything you're reading and i'll flag words above your level.
        </p>
      </Card>
    </div>
  );
}
```

---

## Task 21: Progress placeholder page

**Ref:** FR-7.2
**Files:** `apps/web/app/(dashboard)/progress/page.tsx` (create)
**Estimated time:** 5 min

Same structure as read placeholder:
- Heading: "progress"
- Body: "coming soon — your skill radar, mastery map, and exam readiness will live here."

---

## Task 22: Settings placeholder page

**Ref:** FR-7.3
**Files:** `apps/web/app/(dashboard)/settings/page.tsx` (create)
**Estimated time:** 5 min

Same structure:
- Heading: "settings"
- Body: "coming soon."

---

## Final verification

After Task 22, run from repo root:
```bash
pnpm lint
pnpm typecheck
pnpm test
```
All must pass with zero failures. Then `pnpm dev:web` and click through each nav item to verify visual correctness.

---

## Dependency Graph

```
Task 1 (helpers) ──┬──→ Task 2 (helpers tests)
                    ├──→ Task 3 (Provider)
                    └──→ Task 4 (Flagdot) ──→ Task 5 (Flagdot tests)

Task 3, Task 4 ────────→ Task 11 (Switcher) ──→ Task 12 (Switcher tests)

Task 6 (NavIcons) ──┐
Task 7 (NavItem) ───┴──→ Task 9 (NavItems)
Task 8 (NavItem tests) depends on Task 7

Task 10 (Brand)
Task 13 (UserFooter) ──→ Task 14 (UserFooter tests)

Tasks 9, 10, 11, 13 ──→ Task 15 (Nav) ──→ Task 16 (AppShell)

Task 16, Task 17 (barrel) ──→ Task 18 (layout wiring)

Task 18 ──→ Task 19 (drill migration)
Task 18 ──→ Tasks 20/21/22 (placeholder pages)
```

Tasks 1, 4, 6, 7, 10, 13 (no inter-deps) can be parallelized after the lib helpers exist. Test tasks always follow their component task. Layout wiring (18) requires the barrel; route migration (19) and placeholders (20-22) require the layout to be wired so the shell renders around them.
