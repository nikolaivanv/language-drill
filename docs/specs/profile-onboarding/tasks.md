# Profile Onboarding — Tasks

## Overview

Implementation tasks for the profile onboarding feature, ordered by dependency. Each task is atomic (1–3 files, single testable outcome).

## Task Dependency Order

```
Task 1 (shared types) ──┐
                         ├── Task 3 (API route) ── Task 4 (API tests) ── Task 8 (dev server seeding)
Task 2 (schema + migration) ┘                         │
                                                       ├── Task 5 (client hooks) ── Task 6 (hook tests)
                                                       │
                                                       ├── Task 7 (onboarding page)
                                                       │
                                                       ├── Task 9 (dashboard layout gate)
                                                       │
                                                       └── Task 10 (practice page integration)
```

## Tasks

### Task 1: Add shared types and constants
**References:** FR-1.4, Design > "Shared Types", "CEFR Level Descriptions", "Language Display Names"
**Files:**
- Modify: `packages/shared/src/index.ts`

**What to do:**
1. Add `LanguageProfile` type:
   ```typescript
   export type LanguageProfile = {
     language: Language;
     proficiencyLevel: CefrLevel;
   };
   ```
2. Add `CEFR_DESCRIPTIONS` constant (Record<CefrLevel, string>) with plain-language descriptions
3. Add `LANGUAGE_NAMES` constant (Record<Language, string>) with display names (English, Spanish, German, Turkish)

**Done when:** Types and constants are exported and `pnpm typecheck` passes.

- [x] Complete

---

### Task 2: Update schema and generate migration
**References:** FR-2.4, NFR-2, Design > "Schema Change"
**Files:**
- Modify: `packages/db/src/schema/users.ts`
- Create: `packages/db/migrations/XXXX_add_profile_constraints.sql` (via `pnpm drizzle-kit generate`)

**What to do:**
1. In `userLanguageProfiles` table definition:
   - Make `userId` `.notNull()`
   - Make `proficiencyLevel` `.notNull()`
   - Add unique constraint: `unique('uq_user_language').on(table.userId, table.language)`
   - Import `unique` from `drizzle-orm/pg-core`
2. Generate Drizzle migration: `pnpm drizzle-kit generate`
3. Run migration locally: `pnpm db:migrate`

**Done when:** Migration runs successfully, `pnpm typecheck` passes, and `pnpm db:studio` shows the constraints.

- [x] Complete

---

### Task 3: Create profiles API route
**References:** FR-2.1, FR-2.2, FR-2.3, FR-2.4, FR-2.5, FR-5.2, Design > "API Layer"
**Files:**
- Create: `infra/lambda/src/routes/profiles.ts`
- Modify: `infra/lambda/src/index.ts`

**What to do:**
1. Create `profiles.ts` with Hono router following the `exercises.ts` pattern:
   - Use `authMiddleware` on all routes
   - Use `Bindings` and `Variables` types from `../middleware/auth`

2. `GET /profiles/languages`:
   - Get `userId` from context
   - Select `language` and `proficiencyLevel` from `userLanguageProfiles` where `userId` matches
   - Order by `language`
   - Return `{ profiles: [...] }` (empty array if none)

3. `PUT /profiles/languages`:
   - Zod validation schema:
     - `profiles`: array of `{ language: z.nativeEnum(Language), proficiencyLevel: z.nativeEnum(CefrLevel) }`, min 1, max 4
     - Refine: reject duplicate languages
   - Parse body with `safeParse`, return 400 on failure
   - In a `db.transaction`:
     - Delete all existing profiles for the user
     - Insert new profiles with `assessedAt: new Date()`
   - Return the saved profiles as `{ profiles: [...] }`

4. Register in `index.ts`:
   ```typescript
   import profiles from './routes/profiles';
   app.route('/', profiles);
   ```

**Done when:** `pnpm typecheck` and `pnpm lint` pass. Route is registered in `index.ts`.

- [x] Complete

---

### Task 4: Write API route tests
**References:** FR-2.3, FR-2.4, FR-2.5, Design > "Testing Strategy" > "API Tests"
**Files:**
- Create: `infra/lambda/src/routes/profiles.test.ts`
**Leverage:** `infra/lambda/src/routes/exercises.test.ts` for test patterns

**What to do:**
Write Vitest tests for the profiles route. Follow the patterns in `exercises.test.ts`. Tests should cover:

1. `GET /profiles/languages` returns `{ profiles: [] }` for user with no profiles
2. `GET /profiles/languages` returns saved profiles after PUT
3. `PUT /profiles/languages` creates profiles for new user — returns 200 with saved data
4. `PUT /profiles/languages` replaces existing profiles atomically (old profiles gone, new ones present)
5. `PUT /profiles/languages` rejects empty profiles array — returns 400
6. `PUT /profiles/languages` rejects duplicate languages — returns 400
7. `PUT /profiles/languages` rejects invalid language enum value — returns 400
8. `PUT /profiles/languages` rejects invalid CEFR level — returns 400
9. `PUT /profiles/languages` requires authentication — returns 401 without auth

**Done when:** All tests pass with `pnpm test`.

- [x] Complete

---

### Task 5: Create client-side schemas and hooks
**References:** FR-2.1, FR-2.2, Design > "Client Layer"
**Files:**
- Create: `packages/api-client/src/schemas/profile.ts`
- Create: `packages/api-client/src/hooks/useLanguageProfiles.ts`
- Modify: `packages/api-client/src/index.ts`

**What to do:**
1. Create `schemas/profile.ts`:
   - `LanguageProfileSchema`: `z.object({ language: z.string(), proficiencyLevel: z.string() })`
   - `LanguageProfilesResponseSchema`: `z.object({ profiles: z.array(LanguageProfileSchema) })`
   - Export types: `LanguageProfileResponse`, `LanguageProfilesResponse`

2. Create `hooks/useLanguageProfiles.ts`:
   - `useLanguageProfiles({ fetchFn, enabled })`: `useQuery` with key `['languageProfiles']`, staleTime 5 min
   - `useSaveLanguageProfiles({ fetchFn })`: `useMutation` that PUTs to `/profiles/languages`, on success sets query data for `['languageProfiles']`
   - Follow the `useExercise` / `useSubmitAnswer` patterns exactly

3. Export everything from `index.ts`

**Done when:** `pnpm typecheck` and `pnpm lint` pass across all packages.

- [x] Complete

---

### Task 6: Write client hook tests
**References:** Design > "Testing Strategy" > "Hook Tests"
**Files:**
- Create: `packages/api-client/src/hooks/useLanguageProfiles.test.ts`
**Leverage:** `packages/api-client/src/hooks/useExercise.test.ts` for test patterns

**What to do:**
Write Vitest tests for the hooks. Follow the patterns in `useExercise.test.ts`. Tests:

1. `useLanguageProfiles` calls `GET /profiles/languages` and parses response
2. `useSaveLanguageProfiles` sends PUT with correct body and updates cache on success
3. `useLanguageProfiles` propagates fetch errors correctly

**Done when:** All tests pass with `pnpm test`.

- [x] Complete

---

### Task 7: Build the onboarding page
**References:** FR-1.1–FR-1.6, FR-3.2, FR-3.3, FR-5.1, Design > "Onboarding Page"
**Files:**
- Create: `apps/web/app/onboarding/page.tsx`

**What to do:**
1. Create as a `"use client"` component (same pattern as practice page)
2. Use `useAuth` from Clerk for `getToken`, create `fetchFn` via `createAuthenticatedFetch`
3. Fetch existing profiles via `useLanguageProfiles` (for edit mode)
4. Local state: `Map<Language, CefrLevel>` for selected languages
5. On mount, if profiles exist, pre-populate state from fetched data

6. UI layout:
   - Header: "Set up your languages" (no existing profiles) or "Edit your languages"
   - Grid of 4 language cards (use `LANGUAGE_NAMES` for display). Each card:
     - Click to toggle selected/unselected (visual border/background change)
     - When selected: show CEFR level `<select>` dropdown (default B1)
   - Expandable "What do these levels mean?" section using `CEFR_DESCRIPTIONS`
   - Save button: "Start practicing" / "Save changes" — disabled when no languages selected or mutation is pending
   - Error banner above save button if mutation fails

7. On save:
   - Call `useSaveLanguageProfiles` with array of `{ language, proficiencyLevel }`
   - On success: `router.push('/')`
   - On error: show error message, preserve selections

**Done when:** `pnpm typecheck` and `pnpm lint` pass. Page component exports correctly. Browser verification recommended: `localhost:3000/onboarding`.

- [x] Complete

---

### Task 8: Seed dev user language profiles
**References:** Design > "Local Dev Considerations"
**Files:**
- Modify: `infra/lambda/src/dev.ts`

**What to do:**
1. After the existing dev user upsert, check if the dev user has any language profiles
2. If not, insert default profiles: `[{ language: 'EN', proficiencyLevel: 'B1' }, { language: 'ES', proficiencyLevel: 'A2' }]`
3. Log a message: "Dev user profiles seeded"

**Done when:** `pnpm typecheck` and `pnpm lint` pass. Dev server seeding logic is present.

- [x] Complete

---

### Task 9: Add dashboard layout with onboarding gate
**References:** FR-3.1, FR-5.3, Design > "Onboarding Gate", "Route Configuration"
**Files:**
- Create: `apps/web/app/(dashboard)/layout.tsx`

**What to do:**
1. Create as a `"use client"` component
2. Use `useAuth` + `createAuthenticatedFetch` for API access
3. Fetch profiles via `useLanguageProfiles`
4. Three states:
   - **Loading:** Show a minimal loading skeleton (centered spinner or pulse animation)
   - **Error:** Show error message with retry button — do NOT redirect to onboarding on fetch failure
   - **Loaded, no profiles:** `router.push('/onboarding')` and show loading state while redirecting
   - **Loaded, has profiles:** Render `{children}`
5. The layout wraps all `(dashboard)` routes (home and practice)

**Important:** This is NOT a server component. It must be `"use client"` to use hooks and `useRouter`.

**Done when:** `pnpm typecheck` and `pnpm lint` pass. Layout component renders children or redirects based on profile state. Browser verification recommended: navigate to `localhost:3000/` with and without profiles.

- [x] Complete

---

### Task 10: Integrate profiles into the practice page
**References:** FR-4.1, FR-4.2, FR-4.3, Design > "Practice Page Changes"
**Files:**
- Modify: `apps/web/app/(dashboard)/practice/page.tsx`

**What to do:**
1. Fetch `useLanguageProfiles` at the top of the component
2. Replace hardcoded initial state:
   - `language`: initialize from `profiles[0]?.language ?? Language.EN`
   - `difficulty`: initialize from matching profile's `proficiencyLevel ?? CefrLevel.B1`
3. Use `useEffect` to set initial values once profiles load (since the query is async)
4. Modify the language `<select>`:
   - Options come from user's profiles (not `Object.values(Language)`)
   - Add a final `<option>` with value `"__add"` and label "+ Add language"
   - When `"__add"` is selected: `router.push('/onboarding')`, reset select to previous value
5. When language changes (to a valid profile language): update difficulty to that profile's `proficiencyLevel`
6. Keep existing exercise fetching, submission, and evaluation display unchanged

**Done when:** `pnpm typecheck` and `pnpm lint` pass. Browser verification recommended: practice page defaults to profile language/level, selector shows only profile languages + "Add language" option.

- [x] Complete

---

## Summary

| # | Task | Files | Depends on |
|---|------|-------|------------|
| 1 | Shared types & constants | 1 modify | — |
| 2 | Schema + migration | 1 modify, 1 create | — |
| 3 | API route (GET + PUT) | 1 create, 1 modify | 1, 2 |
| 4 | API route tests | 1 create | 3 |
| 5 | Client schemas + hooks | 2 create, 1 modify | 1 |
| 6 | Client hook tests | 1 create | 5 |
| 7 | Onboarding page | 1 create | 5 |
| 8 | Dev server seeding | 1 modify | 3 |
| 9 | Dashboard layout gate | 1 create | 5 |
| 10 | Practice page integration | 1 modify | 5, 9 |
