# Settings Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a real `/settings` page (languages & levels, goals, plan & limits, account), fix per-language CEFR capture in the new-user onboarding wizard, and retire the broken `/onboarding?edit=1` editor.

**Architecture:** Split the monolithic `PUT /profiles/languages` (which replaced profiles AND preferences in one transaction) into a slimmed `PUT /profiles/languages` ({profiles, primaryLanguage}) plus a new partial `PATCH /profiles/preferences`. The api-client gains `useUpdateLanguages` + `useUpdatePreferences` (replacing `useSavePreferences`). The settings page is a single scrolling page with a sticky anchor-nav, each section autosaving via these hooks. The onboarding reducer changes from a single `primaryLevel` to a per-language `levels` map so the new-user wizard collects a CEFR level per selected language.

**Tech Stack:** Next.js App Router + TypeScript, Tailwind (paper/ink design tokens), TanStack Query, Hono (AWS Lambda), Drizzle ORM, Zod, Clerk (`<UserProfile>`), Vitest + Testing Library.

## Global Constraints

- **No streaks/XP/gamification.** The goals section uses our existing `gentleNudges` toggle — never a "streak protection" control. (CLAUDE.md)
- **Learning languages are ES/DE/TR only.** EN is source-only and rejected at every schema boundary. (`LearningLanguageEnum`)
- **`dailyMinutes` ∈ {5, 10, 20, 30}** (`DAILY_MINUTES`); **`notes` ≤ 500 chars** (`NOTES_MAX_LENGTH`); **goals ∈ `GOAL_IDS`** (`grammar, speaking, listening, writing, vocab, travel`).
- **DB invariants:** `user_preferences.primary_language` and `daily_minutes` are NOT NULL (goals default `[]`, gentle_nudges default `true`, notes default `''`). Any insert of a preferences row MUST supply `primaryLanguage` + `dailyMinutes`.
- **Lambda/api-client schema mirroring:** the Lambda owns its own Zod copy; the api-client mirrors it. Keep them in sync (drift is caught by parallel test suites).
- **Prompt-version rule does not apply** (no `*_SYSTEM_PROMPT` edits in this work).
- **Lowercase UI voice** matches existing pages (`t-display-l`, lowercase headings).
- **Pre-push gate:** `pnpm lint && pnpm typecheck && pnpm test` from repo root, zero failures.

## Per-package test commands

- Lambda: `pnpm --filter @language-drill/lambda test`
- api-client: `pnpm --filter @language-drill/api-client test`
- web: `pnpm --filter @language-drill/web test`

## Scope notes

- **Edit-mode plumbing is intentionally kept (not ripped out).** `mode: 'new' | 'edit'`, the `setLanguages` edit guard, the step-languages last-language guard, and `initialEditState` stay in place and unit-tested. We only (a) change the level model to per-language and (b) make the onboarding *page* redirect `?edit=1` → `/settings` instead of entering edit mode. Fully removing edit-mode code is deferred — it is harmless and still covered by reducer tests.
- **Out of scope (no backend):** calibration, data & privacy, "explanation language", time zone, "retake placement", per-language word/session counts.

## File structure

**Backend (Lambda — `@language-drill/lambda`):**
- Modify: `infra/lambda/src/routes/profiles.ts` — slim `PUT /profiles/languages`; add `PATCH /profiles/preferences`.
- Modify: `infra/lambda/src/routes/profiles.test.ts` — update PUT tests; add PATCH tests.

**api-client (`@language-drill/api-client`):**
- Modify: `packages/api-client/src/schemas/preferences.ts` — add `UpdateLanguagesInputSchema`, `UpdateLanguagesResponseSchema`, `UpdatePreferencesInputSchema`; keep `PreferencesResponseSchema`.
- Modify: `packages/api-client/src/hooks/usePreferences.ts` — add `useUpdateLanguages`, `useUpdatePreferences`; remove `useSavePreferences` (final cleanup task).
- Modify: `packages/api-client/src/hooks/usePreferences.test.ts` — replace `useSavePreferences` tests with new-hook tests.
- Modify: `packages/api-client/src/index.ts` — export new hooks/schemas; drop `useSavePreferences` exports.

**web (`@language-drill/web`):**
- Modify: `apps/web/components/onboarding/use-onboarding-reducer.ts` — per-language `levels` map.
- Modify: `apps/web/components/onboarding/__tests__/use-onboarding-reducer.test.ts`.
- Modify: `apps/web/components/onboarding/steps/step-level.tsx` — per-language CEFR UI.
- Modify: `apps/web/components/onboarding/__tests__/step-level.test.tsx`.
- Modify: `apps/web/app/onboarding/page.tsx` — new hooks, build per-language profiles, redirect `?edit=1` → `/settings`.
- Modify: `apps/web/app/onboarding/page.test.tsx`.
- Create: `apps/web/components/ui/switch.tsx` (+ export from `ui/index.ts`).
- Create: `apps/web/components/ui/__tests__/switch.test.tsx`.
- Create: `apps/web/components/settings/section.tsx` — `Section` + `Row` layout helpers.
- Create: `apps/web/components/settings/settings-nav.tsx` — sticky anchor nav.
- Create: `apps/web/components/settings/languages-section.tsx` (+ test).
- Create: `apps/web/components/settings/goals-section.tsx` (+ test).
- Create: `apps/web/components/settings/account-section.tsx` (+ test).
- Create: `apps/web/components/settings/goal-copy.ts` — shared goal label map (extracted from step-goals).
- Modify: `apps/web/components/settings/plan-and-limits.tsx` — render inside a `Section`.
- Modify: `apps/web/app/(dashboard)/settings/page.tsx` — assemble nav + sections.

---

## Task 1: Slim `PUT /profiles/languages`

Reduce the endpoint to managing language profiles + the primary-language pointer only. It must upsert the `user_preferences` row with `primaryLanguage` (seeding `dailyMinutes` default on first insert) without touching goals/dailyMinutes/gentleNudges/notes on update.

**Files:**
- Modify: `infra/lambda/src/routes/profiles.ts`
- Test: `infra/lambda/src/routes/profiles.test.ts`

**Interfaces:**
- Produces: `PUT /profiles/languages` accepts `{ profiles: [{language, proficiencyLevel}] (1..3, unique), primaryLanguage }` and returns `{ profiles: [{language, proficiencyLevel}], primaryLanguage }`. Rejects EN, duplicates, empty, and `primaryLanguage ∉ profiles` with 400 `VALIDATION_ERROR`.

- [ ] **Step 1: Update the request schema and handler**

In `infra/lambda/src/routes/profiles.ts`, replace `UpdateProfilesSchema` with a slimmed schema and add a daily-minutes default constant. Import `DailyMinutes` type:

```typescript
import {
  CefrLevel,
  Language,
  type DailyMinutes,
} from '@language-drill/shared';
```

(Drop `GOAL_IDS` and `NOTES_MAX_LENGTH` from the import if they become unused after Task 2 — Task 2 re-adds them for the PATCH schema, so keep them for now.)

Replace `UpdateProfilesSchema` (lines ~36-63) with:

```typescript
// Default seeded into a brand-new user_preferences row when the languages
// endpoint creates it before the preferences PATCH runs (daily_minutes is
// NOT NULL with no DB default). Overwritten by PATCH /profiles/preferences.
const DEFAULT_DAILY_MINUTES: DailyMinutes = 10;

const UpdateLanguagesSchema = z
  .object({
    profiles: z.array(LearningProfileSchema).min(1).max(3),
    primaryLanguage: LearningLanguageEnum,
  })
  .refine(
    (data) =>
      new Set(data.profiles.map((p) => p.language)).size ===
      data.profiles.length,
    { message: 'Duplicate languages are not allowed' },
  )
  .refine(
    (data) => data.profiles.some((p) => p.language === data.primaryLanguage),
    {
      message:
        'primaryLanguage must be one of the submitted profiles.languages',
      path: ['primaryLanguage'],
    },
  );
```

Replace the `PUT /profiles/languages` handler body (lines ~125-198) so it parses with `UpdateLanguagesSchema`, replaces profiles, and upserts ONLY `primaryLanguage` (seeding `dailyMinutes` on insert):

```typescript
profiles.put('/profiles/languages', async (c) => {
  const userId = c.get('userId');

  const bodyResult = UpdateLanguagesSchema.safeParse(
    await c.req.json().catch(() => ({})),
  );
  if (!bodyResult.success) {
    return c.json(
      {
        error: 'Invalid request body',
        code: 'VALIDATION_ERROR',
        details: bodyResult.error.flatten(),
      },
      400,
    );
  }

  const { profiles: profileData, primaryLanguage } = bodyResult.data;

  const result = await db.transaction(async (tx) => {
    await tx
      .delete(userLanguageProfiles)
      .where(eq(userLanguageProfiles.userId, userId));

    const insertedProfiles = await tx
      .insert(userLanguageProfiles)
      .values(
        profileData.map((p) => ({
          userId,
          language: p.language,
          proficiencyLevel: p.proficiencyLevel,
          assessedAt: new Date(),
        })),
      )
      .returning({
        language: userLanguageProfiles.language,
        proficiencyLevel: userLanguageProfiles.proficiencyLevel,
      });

    // Upsert the primary-language pointer. On INSERT we must seed
    // dailyMinutes (NOT NULL, no default); on UPDATE we touch only
    // primaryLanguage so goals/dailyMinutes/gentleNudges/notes set via
    // PATCH /profiles/preferences are preserved.
    await tx
      .insert(userPreferences)
      .values({
        userId,
        primaryLanguage,
        dailyMinutes: DEFAULT_DAILY_MINUTES,
      })
      .onConflictDoUpdate({
        target: userPreferences.userId,
        set: { primaryLanguage, updatedAt: new Date() },
      });

    return { profiles: insertedProfiles, primaryLanguage };
  });

  return c.json(result);
});
```

- [ ] **Step 2: Update the existing PUT tests to the new contract**

In `infra/lambda/src/routes/profiles.test.ts`, the `validBody` helper and assertions currently include goals/dailyMinutes/gentleNudges/notes. Narrow them. Change the `validBody` helper so its base is `{ profiles, primaryLanguage }` only, and update the happy-path assertion (the test "creates profiles for new user…") to:

```typescript
const res = await putProfiles(app, {
  profiles: [{ language: Language.ES, proficiencyLevel: CefrLevel.B2 }],
  primaryLanguage: Language.ES,
});

expect(res.status).toBe(200);
const json = (await res.json()) as AnyJson;
expect(json).toEqual({
  profiles: [{ language: 'ES', proficiencyLevel: 'B2' }],
  primaryLanguage: 'ES',
});
expect(mockTransaction).toHaveBeenCalledTimes(1);
expect(txCapture.txDeleteCalls).toBe(1);
expect(txCapture.txInsertProfilesValues).toHaveLength(1);
```

Remove any assertions that read `json.preferences.goals/dailyMinutes/...` from the PUT tests (those move to PATCH tests in Task 2). Keep the validation tests for: EN rejected, duplicate languages, empty array, >3 languages, and `primaryLanguage ∉ profiles` — updating their request bodies to the slimmed `{profiles, primaryLanguage}` shape.

- [ ] **Step 3: Run the lambda tests, expect failures then fixes**

Run: `pnpm --filter @language-drill/lambda test -- profiles`
Expected: the updated PUT tests pass; any test still sending the old combined body fails — fix it to the slimmed shape until green.

- [ ] **Step 4: Commit**

```bash
git add infra/lambda/src/routes/profiles.ts infra/lambda/src/routes/profiles.test.ts
git commit -m "feat(api): slim PUT /profiles/languages to profiles + primaryLanguage"
```

---

## Task 2: Add `PATCH /profiles/preferences`

A partial, update-only endpoint for the onboarding-signal fields. Updates only provided keys; returns 404 when no preferences row exists (the languages PUT creates the row first in every real flow).

**Files:**
- Modify: `infra/lambda/src/routes/profiles.ts`
- Test: `infra/lambda/src/routes/profiles.test.ts`

**Interfaces:**
- Produces: `PATCH /profiles/preferences` accepts partial `{ goals?, dailyMinutes?, gentleNudges?, notes? }` (≥1 key), returns the full `{ primaryLanguage, goals, dailyMinutes, gentleNudges, notes }`. 400 `VALIDATION_ERROR` on bad fields or empty body; 404 `PREFERENCES_NOT_FOUND` if the user has no row.

- [ ] **Step 1: Write the failing tests**

Add to `infra/lambda/src/routes/profiles.test.ts`. Mirror the PUT harness (`app.request` with `authEnv`). Add a `patchPrefs` helper and tests:

```typescript
async function patchPrefs(
  app: Hono,
  body: unknown,
  env: typeof authEnv | typeof unauthEnv = authEnv,
): Promise<Response> {
  return app.request(
    '/profiles/preferences',
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    env,
  );
}

describe('PATCH /profiles/preferences', () => {
  it('updates only the provided fields and returns the full preferences', async () => {
    // Arrange the update mock to return one row (see mock setup note below).
    const res = await patchPrefs(app, { dailyMinutes: 30, goals: ['vocab'] });
    expect(res.status).toBe(200);
    const json = (await res.json()) as AnyJson;
    expect(json.dailyMinutes).toBe(30);
    expect(json.goals).toEqual(['vocab']);
  });

  it('rejects an empty body with 400', async () => {
    const res = await patchPrefs(app, {});
    expect(res.status).toBe(400);
  });

  it('rejects an invalid dailyMinutes with 400', async () => {
    const res = await patchPrefs(app, { dailyMinutes: 7 });
    expect(res.status).toBe(400);
  });

  it('returns 404 when the user has no preferences row', async () => {
    // Arrange the update mock to return [] (no row updated).
    const res = await patchPrefs(app, { gentleNudges: false });
    expect(res.status).toBe(404);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await patchPrefs(app, { gentleNudges: false }, unauthEnv);
    expect(res.status).toBe(401);
  });
});
```

Extend the existing `vi.mock('../db', …)` so the bare (non-transaction) `db.update(...).set(...).where(...).returning()` chain is mockable per-test, with a default returning one row and a per-test override returning `[]` for the 404 case. Follow the existing builder-chain mock style already in the file (the same `vi.fn()` chain pattern used for `db.select`/`db.insert`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @language-drill/lambda test -- profiles`
Expected: FAIL — `PATCH /profiles/preferences` returns 404 (route not mounted) for all cases.

- [ ] **Step 3: Implement the PATCH handler**

In `infra/lambda/src/routes/profiles.ts`, ensure `GOAL_IDS` and `NOTES_MAX_LENGTH` are imported, add the partial schema, and the handler (place after the PUT handler, before `export default`):

```typescript
const UpdatePreferencesSchema = z
  .object({
    goals: z.array(z.enum(GOAL_IDS)).optional(),
    dailyMinutes: z
      .union([z.literal(5), z.literal(10), z.literal(20), z.literal(30)])
      .optional(),
    gentleNudges: z.boolean().optional(),
    notes: z.string().max(NOTES_MAX_LENGTH).optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one field must be provided',
  });

profiles.patch('/profiles/preferences', async (c) => {
  const userId = c.get('userId');

  const bodyResult = UpdatePreferencesSchema.safeParse(
    await c.req.json().catch(() => ({})),
  );
  if (!bodyResult.success) {
    return c.json(
      {
        error: 'Invalid request body',
        code: 'VALIDATION_ERROR',
        details: bodyResult.error.flatten(),
      },
      400,
    );
  }

  const updated = await db
    .update(userPreferences)
    .set({ ...bodyResult.data, updatedAt: new Date() })
    .where(eq(userPreferences.userId, userId))
    .returning({
      primaryLanguage: userPreferences.primaryLanguage,
      goals: userPreferences.goals,
      dailyMinutes: userPreferences.dailyMinutes,
      gentleNudges: userPreferences.gentleNudges,
      notes: userPreferences.notes,
    });

  if (updated.length === 0) {
    return c.json(
      { error: 'No preferences row for user', code: 'PREFERENCES_NOT_FOUND' },
      404,
    );
  }

  return c.json(updated[0]);
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @language-drill/lambda test -- profiles`
Expected: PASS (all PATCH cases + the Task 1 PUT cases).

- [ ] **Step 5: Commit**

```bash
git add infra/lambda/src/routes/profiles.ts infra/lambda/src/routes/profiles.test.ts
git commit -m "feat(api): add PATCH /profiles/preferences partial update"
```

---

## Task 3: api-client schemas + `useUpdateLanguages` / `useUpdatePreferences`

Add the mirrored wire schemas and the two new mutation hooks. Leave `useSavePreferences` in place for now (removed in Task 7 once the wizard migrates).

**Files:**
- Modify: `packages/api-client/src/schemas/preferences.ts`
- Modify: `packages/api-client/src/hooks/usePreferences.ts`
- Modify: `packages/api-client/src/index.ts`
- Test: `packages/api-client/src/hooks/usePreferences.test.ts`

**Interfaces:**
- Produces:
  - `useUpdateLanguages({ fetchFn })` → mutation; args `UpdateLanguagesArgs = { profiles: {language, proficiencyLevel}[]; primaryLanguage }`; PUTs `/profiles/languages`; invalidates `['languageProfiles']` and `['preferences']`. Returns `{ profiles, primaryLanguage }`.
  - `useUpdatePreferences({ fetchFn })` → mutation; args `UpdatePreferencesArgs = { goals?; dailyMinutes?; gentleNudges?; notes? }`; PATCHes `/profiles/preferences`; invalidates `['preferences']`. Returns `PreferencesResponse`.

- [ ] **Step 1: Add the schemas**

In `packages/api-client/src/schemas/preferences.ts` append:

```typescript
// ---------------------------------------------------------------------------
// PUT /profiles/languages — slimmed request + response
// ---------------------------------------------------------------------------

export const UpdateLanguagesInputSchema = z
  .object({
    profiles: z.array(LearningProfileSchema).min(1).max(3),
    primaryLanguage: LearningLanguageEnum,
  })
  .refine(
    (input) => input.profiles.some((p) => p.language === input.primaryLanguage),
    {
      message:
        'primaryLanguage must be one of the submitted profiles.languages',
      path: ['primaryLanguage'],
    },
  );

export type UpdateLanguagesInput = z.infer<typeof UpdateLanguagesInputSchema>;

export const UpdateLanguagesResponseSchema = z.object({
  profiles: z.array(LearningProfileSchema),
  primaryLanguage: LearningLanguageEnum,
});

export type UpdateLanguagesResponse = z.infer<
  typeof UpdateLanguagesResponseSchema
>;

// ---------------------------------------------------------------------------
// PATCH /profiles/preferences — partial request
// ---------------------------------------------------------------------------

export const UpdatePreferencesInputSchema = z
  .object({
    goals: z.array(z.enum(GOAL_IDS)).optional(),
    dailyMinutes: z
      .union([z.literal(5), z.literal(10), z.literal(20), z.literal(30)])
      .optional(),
    gentleNudges: z.boolean().optional(),
    notes: z.string().max(NOTES_MAX_LENGTH).optional(),
  })
  .refine((input) => Object.keys(input).length > 0, {
    message: 'At least one field must be provided',
  });

export type UpdatePreferencesInput = z.infer<
  typeof UpdatePreferencesInputSchema
>;
```

`LearningProfileSchema`, `LearningLanguageEnum`, `GOAL_IDS`, `NOTES_MAX_LENGTH` are already imported/defined in this file.

- [ ] **Step 2: Write the failing hook tests**

In `packages/api-client/src/hooks/usePreferences.test.ts`, add (reuse `buildQueryClient`, `buildWrapper`, `jsonResponse`, `readPutBody` helpers already present; add a `readPatchBody` analogue if needed):

```typescript
describe('useUpdateLanguages', () => {
  it('PUTs the profiles array + primaryLanguage and invalidates caches', async () => {
    const queryClient = buildQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const fetchFn = vi.fn<AuthenticatedFetch>().mockResolvedValue(
      jsonResponse({
        profiles: [{ language: 'ES', proficiencyLevel: 'B2' }],
        primaryLanguage: 'ES',
      }),
    );

    const { result } = renderHook(() => useUpdateLanguages({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({
        profiles: [{ language: Language.ES, proficiencyLevel: CefrLevel.B2 }],
        primaryLanguage: Language.ES,
      });
    });

    expect(fetchFn.mock.calls[0]?.[0]).toBe('/profiles/languages');
    const init = fetchFn.mock.calls[0]?.[1] as RequestInit;
    expect(init.method).toBe('PUT');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['languageProfiles'] });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['preferences'] });
  });
});

describe('useUpdatePreferences', () => {
  it('PATCHes only the provided fields and invalidates preferences', async () => {
    const queryClient = buildQueryClient();
    const spy = vi.spyOn(queryClient, 'invalidateQueries');
    const fetchFn = vi.fn<AuthenticatedFetch>().mockResolvedValue(
      jsonResponse({
        primaryLanguage: 'ES',
        goals: ['vocab'],
        dailyMinutes: 30,
        gentleNudges: true,
        notes: '',
      }),
    );

    const { result } = renderHook(() => useUpdatePreferences({ fetchFn }), {
      wrapper: buildWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync({ dailyMinutes: 30, goals: ['vocab'] });
    });

    const init = fetchFn.mock.calls[0]?.[1] as RequestInit;
    expect(fetchFn.mock.calls[0]?.[0]).toBe('/profiles/preferences');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body as string)).toEqual({
      dailyMinutes: 30,
      goals: ['vocab'],
    });
    expect(spy).toHaveBeenCalledWith({ queryKey: ['preferences'] });
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `pnpm --filter @language-drill/api-client test -- usePreferences`
Expected: FAIL — `useUpdateLanguages` / `useUpdatePreferences` are not exported.

- [ ] **Step 4: Implement the hooks**

In `packages/api-client/src/hooks/usePreferences.ts` add imports and hooks:

```typescript
import {
  UpdateLanguagesInputSchema,
  type UpdateLanguagesInput,
  UpdateLanguagesResponseSchema,
  type UpdateLanguagesResponse,
  UpdatePreferencesInputSchema,
  type UpdatePreferencesInput,
} from '../schemas/preferences';

export type UpdateLanguagesArgs = UpdateLanguagesInput;

export function useUpdateLanguages({ fetchFn }: { fetchFn: AuthenticatedFetch }) {
  const queryClient = useQueryClient();
  return useMutation<UpdateLanguagesResponse, Error, UpdateLanguagesArgs>({
    mutationFn: async (args) => {
      const payload = UpdateLanguagesInputSchema.parse(args);
      const response = await fetchFn('/profiles/languages', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      const json: unknown = await response.json();
      return UpdateLanguagesResponseSchema.parse(json);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['languageProfiles'] });
      void queryClient.invalidateQueries({ queryKey: ['preferences'] });
    },
  });
}

export type UpdatePreferencesArgs = UpdatePreferencesInput;

export function useUpdatePreferences({
  fetchFn,
}: {
  fetchFn: AuthenticatedFetch;
}) {
  const queryClient = useQueryClient();
  return useMutation<PreferencesResponse, Error, UpdatePreferencesArgs>({
    mutationFn: async (args) => {
      const payload = UpdatePreferencesInputSchema.parse(args);
      const response = await fetchFn('/profiles/preferences', {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
      const json: unknown = await response.json();
      return PreferencesResponseSchema.parse(json);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['preferences'] });
    },
  });
}
```

- [ ] **Step 5: Export from index**

In `packages/api-client/src/index.ts`, extend the preferences export block:

```typescript
export {
  useGetPreferences,
  useSavePreferences,
  useUpdateLanguages,
  useUpdatePreferences,
  type UseGetPreferencesParams,
  type UseSavePreferencesParams,
  type SavePreferencesArgs,
  type SavePreferencesResponse,
  type UpdateLanguagesArgs,
  type UpdatePreferencesArgs,
} from './hooks/usePreferences';
```

And add to the schemas export block: `UpdateLanguagesInputSchema`, `UpdateLanguagesResponseSchema`, `UpdatePreferencesInputSchema` and their types.

- [ ] **Step 6: Run to verify pass**

Run: `pnpm --filter @language-drill/api-client test -- usePreferences`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/api-client/src
git commit -m "feat(api-client): add useUpdateLanguages + useUpdatePreferences hooks"
```

---

## Task 4: Reducer — per-language `levels` map

Replace single `primaryLevel` with `levels: Partial<Record<LearningLanguage, CefrLevel>>`. `setLevel` takes a language. `setLanguages` prunes levels for removed languages. Step-2 gate requires every selected language to have a level + a primary.

**Files:**
- Modify: `apps/web/components/onboarding/use-onboarding-reducer.ts`
- Test: `apps/web/components/onboarding/__tests__/use-onboarding-reducer.test.ts`

**Interfaces:**
- Produces: `OnboardingState.levels: Partial<Record<LearningLanguage, CefrLevel>>` (replaces `primaryLevel`); action `{ type: 'setLevel'; language: LearningLanguage; level: CefrLevel }`. `initialEditState` populates `levels` from all profiles.

- [ ] **Step 1: Write/adjust failing reducer tests**

In `__tests__/use-onboarding-reducer.test.ts`:
- Replace the `describe('reducer — setLevel', …)` block:

```typescript
describe('reducer — setLevel', () => {
  it('sets a level for a specific language', () => {
    const before = newState({ languages: [Language.ES, Language.DE] });
    const next = apply(before, {
      type: 'setLevel',
      language: Language.DE,
      level: CefrLevel.B1,
    });
    expect(next.levels).toEqual({ DE: CefrLevel.B1 });
  });

  it('overwrites the level for that language only', () => {
    const before = newState({
      languages: [Language.ES, Language.DE],
      levels: { ES: CefrLevel.B2, DE: CefrLevel.A2 },
    });
    const next = apply(before, {
      type: 'setLevel',
      language: Language.ES,
      level: CefrLevel.C1,
    });
    expect(next.levels).toEqual({ ES: CefrLevel.C1, DE: CefrLevel.A2 });
  });
});
```

- Update the two `setLanguages` tests at lines ~105/120 to assert on `levels` instead of `primaryLevel`:

```typescript
it('drops the level for a language removed from the set', () => {
  const before = newState({
    languages: [Language.ES, Language.DE],
    primaryLanguage: Language.ES,
    levels: { ES: CefrLevel.B2, DE: CefrLevel.A2 },
  });
  const next = apply(before, { type: 'setLanguages', languages: [Language.DE] });
  expect(next.levels).toEqual({ DE: CefrLevel.A2 });
  expect(next.primaryLanguage).toBeNull(); // primary ES was removed
});

it('keeps levels for languages that remain', () => {
  const before = newState({
    languages: [Language.ES, Language.DE],
    primaryLanguage: Language.ES,
    levels: { ES: CefrLevel.B2, DE: CefrLevel.A2 },
  });
  const next = apply(before, {
    type: 'setLanguages',
    languages: [Language.ES, Language.DE, Language.TR],
  });
  expect(next.levels).toEqual({ ES: CefrLevel.B2, DE: CefrLevel.A2 });
  expect(next.primaryLanguage).toBe(Language.ES);
});
```

- Update the step-2 `selectCanAdvance` test (~line 316):

```typescript
it('step 2 requires a primary AND a level for every selected language', () => {
  const incomplete = newState({
    step: 2,
    languages: [Language.ES, Language.DE],
    primaryLanguage: Language.ES,
    levels: { ES: CefrLevel.B2 }, // DE missing
  });
  expect(selectCanAdvance(incomplete)).toBe(false);

  const complete = newState({
    step: 2,
    languages: [Language.ES, Language.DE],
    primaryLanguage: Language.ES,
    levels: { ES: CefrLevel.B2, DE: CefrLevel.A2 },
  });
  expect(selectCanAdvance(complete)).toBe(true);
});
```

- Update `initialEditState` test to assert `levels` is built from all profiles:

```typescript
it('hydrates levels from every profile', () => {
  const state = initialEditState(
    [
      { language: Language.ES, proficiencyLevel: CefrLevel.B2 },
      { language: Language.DE, proficiencyLevel: CefrLevel.A2 },
    ],
    { primaryLanguage: Language.ES, goals: [], dailyMinutes: 10, gentleNudges: true, notes: '' },
  );
  expect(state.levels).toEqual({ ES: CefrLevel.B2, DE: CefrLevel.A2 });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/web test -- use-onboarding-reducer`
Expected: FAIL — `levels` does not exist; `setLevel` has no `language`.

- [ ] **Step 3: Implement the reducer change**

In `use-onboarding-reducer.ts`:

State shape — replace `primaryLevel: CefrLevel | null;` with:

```typescript
  /** CEFR level per selected language. Step 2 requires every selected
   *  language to have an entry before advancing. */
  levels: Partial<Record<LearningLanguage, CefrLevel>>;
```

Action union — replace `| { type: 'setLevel'; level: CefrLevel }` with:

```typescript
  | { type: 'setLevel'; language: LearningLanguage; level: CefrLevel }
```

`setLanguages` case — replace the primary-drop block so it also prunes levels:

```typescript
    case 'setLanguages': {
      if (state.mode === 'edit' && action.languages.length === 0) {
        return state;
      }

      // Keep only levels for languages still selected.
      const levels: Partial<Record<LearningLanguage, CefrLevel>> = {};
      for (const lang of action.languages) {
        if (state.levels[lang] !== undefined) levels[lang] = state.levels[lang];
      }

      const next: OnboardingState = {
        ...state,
        languages: action.languages,
        levels,
      };

      if (
        state.primaryLanguage !== null &&
        !action.languages.includes(state.primaryLanguage)
      ) {
        next.primaryLanguage = null;
      }

      return next;
    }
```

`setLevel` case:

```typescript
    case 'setLevel': {
      if (!state.languages.includes(action.language)) return state;
      return {
        ...state,
        levels: { ...state.levels, [action.language]: action.level },
      };
    }
```

`initialNewUserState` — replace `primaryLevel: null,` with `levels: {},`.

`initialEditState` — build levels from all profiles; drop the single `primaryLevel` derivation:

```typescript
  const levels: Partial<Record<LearningLanguage, CefrLevel>> = {};
  for (const p of profiles) {
    if (p.language !== 'EN') {
      levels[p.language as LearningLanguage] = p.proficiencyLevel;
    }
  }

  return {
    mode: 'edit',
    step: 1,
    languages,
    primaryLanguage,
    levels,
    goals: [...prefs.goals],
    notes: prefs.notes,
    dailyMinutes: prefs.dailyMinutes ?? DEFAULT_DAILY_MINUTES,
    gentleNudges: prefs.gentleNudges,
    submission: { status: 'idle' },
  };
```

`selectCanAdvance` step 2:

```typescript
    case 2:
      return (
        state.primaryLanguage !== null &&
        state.languages.length > 0 &&
        state.languages.every((l) => state.levels[l] !== undefined)
      );
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @language-drill/web test -- use-onboarding-reducer`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/onboarding/use-onboarding-reducer.ts apps/web/components/onboarding/__tests__/use-onboarding-reducer.test.ts
git commit -m "feat(onboarding): per-language CEFR levels in reducer"
```

---

## Task 5: Step-level — per-language CEFR UI

Render a CEFR card stack per selected language (each headed by its native name) plus the primary/"focus" selector. `setLevel` dispatches with the language.

**Files:**
- Modify: `apps/web/components/onboarding/steps/step-level.tsx`
- Test: `apps/web/components/onboarding/__tests__/step-level.test.tsx`

**Interfaces:**
- Consumes: reducer `levels` map + `setLevel({language, level})` from Task 4.

- [ ] **Step 1: Adjust the step-level tests**

In `__tests__/step-level.test.tsx`, the suite currently selects a single level. Update so that with two languages selected, picking a level dispatches `setLevel` with the language, and each language renders its own level radiogroup. Representative cases:

```typescript
it('renders one proficiency radiogroup per selected language', () => {
  renderStepLevel({ languages: [Language.ES, Language.DE], primaryLanguage: Language.ES });
  expect(screen.getByRole('radiogroup', { name: /español level/i })).toBeInTheDocument();
  expect(screen.getByRole('radiogroup', { name: /deutsch level/i })).toBeInTheDocument();
});

it('dispatches setLevel with the language when a card is clicked', () => {
  const dispatch = vi.fn();
  renderStepLevel(
    { languages: [Language.ES, Language.DE], primaryLanguage: Language.ES },
    dispatch,
  );
  const deGroup = screen.getByRole('radiogroup', { name: /deutsch level/i });
  fireEvent.click(within(deGroup).getByRole('radio', { name: /B1/ }));
  expect(dispatch).toHaveBeenCalledWith({
    type: 'setLevel',
    language: Language.DE,
    level: CefrLevel.B1,
  });
});
```

Keep the single-language fast-path test (one language ⇒ no primary selector, auto-primary on mount), updating its level assertion to the `{language, level}` dispatch shape.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/web test -- step-level`
Expected: FAIL.

- [ ] **Step 3: Implement per-language level UI**

Rewrite the body of `step-level.tsx` so the CEFR stack is rendered per language. Keep `CEFR_CARD_COPY`, `CEFR_LEVELS`, the single-language auto-primary `useEffect`, and the primary radiogroup. Replace the single proficiency radiogroup with a map over `state.languages`:

```typescript
      {state.languages.map((language) => (
        <div key={language} className="flex flex-col gap-s-2">
          <p className="t-small text-ink-soft">
            {LANGUAGE_NATIVE_NAMES[language]}
          </p>
          <div
            role="radiogroup"
            aria-label={`${LANGUAGE_NATIVE_NAMES[language]} level`}
            className="flex flex-col gap-s-2"
          >
            {CEFR_LEVELS.map((level) => {
              const copy = CEFR_CARD_COPY[level];
              const selected = state.levels[language] === level;
              return (
                <Choice
                  key={level}
                  mode="radio"
                  selected={selected}
                  onSelect={() =>
                    dispatch({ type: 'setLevel', language, level })
                  }
                >
                  <span className="flex items-center gap-s-3 w-full">
                    <span
                      className={
                        selected
                          ? 't-mono text-ink w-[38px]'
                          : 't-mono text-ink-mute w-[38px]'
                      }
                    >
                      {level}
                    </span>
                    <span className="flex-1 flex flex-col">
                      <span className="t-body text-ink">{copy.name}</span>
                      <span className="t-small text-ink-mute">
                        {copy.description}
                      </span>
                    </span>
                  </span>
                </Choice>
              );
            })}
          </div>
        </div>
      ))}
```

Keep the primary-language radiogroup (shown when `state.languages.length > 1`) and `<PlacementTestCallout />` as-is.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @language-drill/web test -- step-level`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/onboarding/steps/step-level.tsx apps/web/components/onboarding/__tests__/step-level.test.tsx
git commit -m "feat(onboarding): collect a CEFR level per selected language"
```

---

## Task 6: Onboarding page — new hooks, per-language profiles, redirect edit→settings

Migrate the wizard finish to `useUpdateLanguages` + `useUpdatePreferences`, build the profiles array from the `levels` map, and redirect `?edit=1` straight to `/settings`.

**Files:**
- Modify: `apps/web/app/onboarding/page.tsx`
- Test: `apps/web/app/onboarding/page.test.tsx`

**Interfaces:**
- Consumes: `useUpdateLanguages`, `useUpdatePreferences` (Task 3); reducer `levels` (Task 4).

- [ ] **Step 1: Adjust the page tests**

In `apps/web/app/onboarding/page.test.tsx`:
- Add a test that `?edit=1` redirects to `/settings` (mock `useSearchParams` to return `edit=1`, assert `router.replace`/`push` called with `/settings`, and that the wizard is not rendered).
- Update the submit-orchestration test: on finish, expect `useUpdateLanguages.mutateAsync` called with `{ profiles: [{language, proficiencyLevel}], primaryLanguage }` then `useUpdatePreferences.mutateAsync` with `{ goals, dailyMinutes, gentleNudges, notes }`. Mock both hooks.
- Remove assertions tied to `useGetPreferences` hydration in edit mode and to `useSavePreferences`.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/web test -- onboarding/page`
Expected: FAIL.

- [ ] **Step 3: Implement the page changes**

In `apps/web/app/onboarding/page.tsx`:
- In `OnboardingPageContent`, add an early redirect for edit mode (replace the `useGetPreferences` hydration path):

```typescript
  // Edit mode no longer runs in the wizard — settings is the canonical editor.
  useEffect(() => {
    if (editMode) router.replace('/settings');
  }, [editMode, router]);
```

Remove `useGetPreferences` usage and the `preferencesQuery` gating; `initialState` becomes `initialNewUserState()` unconditionally. Keep the returning-user `/home` redirect and the profiles loading/error gates. When `editMode` is true, render `null` (the effect navigates away).

- Replace `OnboardingPageBody`'s submit:

```typescript
function OnboardingPageBody({ fetchFn }: { fetchFn: AuthenticatedFetch }) {
  const { state, dispatch } = useOnboarding();
  const router = useRouter();
  const updateLanguages = useUpdateLanguages({ fetchFn });
  const updatePreferences = useUpdatePreferences({ fetchFn });

  const handleComplete = useCallback(async () => {
    dispatch({ type: 'submitStart' });
    try {
      const profiles = state.languages.map((language) => {
        const proficiencyLevel = state.levels[language];
        if (!proficiencyLevel) {
          throw new Error(`missing level for ${language}`);
        }
        return { language, proficiencyLevel };
      });
      if (state.primaryLanguage === null || state.dailyMinutes === null) {
        throw new Error('missing primaryLanguage or dailyMinutes');
      }
      await updateLanguages.mutateAsync({
        profiles,
        primaryLanguage: state.primaryLanguage,
      });
      await updatePreferences.mutateAsync({
        goals: state.goals,
        dailyMinutes: state.dailyMinutes,
        gentleNudges: state.gentleNudges,
        notes: state.notes.replace(/\r\n/g, '\n').trim(),
      });
      dispatch({ type: 'submitSuccess' });
      router.push('/home');
    } catch (err) {
      const { kind, message } = classifyError(err);
      dispatch({ type: 'submitError', kind, message });
    }
  }, [state, dispatch, updateLanguages, updatePreferences, router]);

  return <OnboardingShell mode="new" onComplete={handleComplete} />;
}
```

- Delete `buildSaveArgs` and `sameOriginReferrer` (edit-mode-only). Keep `classifyError`. Update imports (remove `useSavePreferences`, `SavePreferencesArgs`, `useGetPreferences`, `initialEditState`; add `useUpdateLanguages`, `useUpdatePreferences`).

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @language-drill/web test -- onboarding/page`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/app/onboarding/page.tsx apps/web/app/onboarding/page.test.tsx
git commit -m "feat(onboarding): save per-language levels; redirect ?edit=1 to /settings"
```

---

## Task 7: Remove `useSavePreferences`

Now that its only consumer is migrated, delete the legacy hook and its schema usage.

**Files:**
- Modify: `packages/api-client/src/hooks/usePreferences.ts`
- Modify: `packages/api-client/src/hooks/usePreferences.test.ts`
- Modify: `packages/api-client/src/index.ts`

- [ ] **Step 1: Delete the hook + its tests + exports**

- Remove `useSavePreferences`, `SavePreferencesArgs`, `SavePreferencesResponse`, `UseSavePreferencesParams` from `usePreferences.ts` (and the now-unused `SavePreferencesInputSchema`/`CefrLevel` imports if nothing else uses them — keep imports still referenced by the new hooks).
- Remove the `describe('useSavePreferences', …)` block and the `readPutBody` helper if unused, from `usePreferences.test.ts`.
- Remove the `useSavePreferences` / `SavePreferences*` lines from `index.ts`.
- `SavePreferencesInputSchema` in `schemas/preferences.ts` may still be referenced by `infra/lambda` mirror tests? It is not imported by Lambda. Remove it from `schemas/preferences.ts` and its export only if no remaining importer (grep first).

- [ ] **Step 2: Grep for stragglers**

Run: `grep -rn "useSavePreferences\|SavePreferencesArgs\|SavePreferencesInputSchema" packages apps infra --include=*.ts --include=*.tsx`
Expected: no matches (or only the deletions you are making).

- [ ] **Step 3: Run api-client tests + typecheck**

Run: `pnpm --filter @language-drill/api-client test && pnpm --filter @language-drill/api-client typecheck`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add packages/api-client/src
git commit -m "refactor(api-client): remove legacy useSavePreferences"
```

---

## Task 8: `Switch` UI primitive

A `role="switch"` pill toggle for boolean settings (gentle nudges).

**Files:**
- Create: `apps/web/components/ui/switch.tsx`
- Modify: `apps/web/components/ui/index.ts`
- Test: `apps/web/components/ui/__tests__/switch.test.tsx`

**Interfaces:**
- Produces: `Switch({ checked: boolean; onChange: (next: boolean) => void; 'aria-label'?: string; 'aria-labelledby'?: string })`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Switch } from '../switch';

describe('Switch', () => {
  it('renders a switch reflecting checked state and toggles on click', () => {
    const onChange = vi.fn();
    render(<Switch checked={false} onChange={onChange} aria-label="gentle nudges" />);
    const sw = screen.getByRole('switch', { name: 'gentle nudges' });
    expect(sw).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(sw);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/web test -- ui/__tests__/switch`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

```typescript
import * as React from 'react';
import { cn } from '../../lib/cn';

export interface SwitchProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  className?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
}

export function Switch({
  checked,
  onChange,
  className,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
}: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      aria-labelledby={ariaLabelledBy}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-[22px] w-[38px] flex-shrink-0 items-center rounded-r-pill transition-colors duration-150',
        checked ? 'bg-ink' : 'bg-paper-3',
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          'inline-block h-[18px] w-[18px] rounded-full bg-white shadow-1 transition-transform duration-150',
          checked ? 'translate-x-[18px]' : 'translate-x-[2px]',
        )}
      />
    </button>
  );
}
```

Add to `ui/index.ts`:

```typescript
export { Switch } from './switch';
export type { SwitchProps } from './switch';
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @language-drill/web test -- ui/__tests__/switch`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/ui/switch.tsx apps/web/components/ui/index.ts apps/web/components/ui/__tests__/switch.test.tsx
git commit -m "feat(ui): add Switch toggle primitive"
```

---

## Task 9: Settings `Section` + sticky anchor nav

Shared layout helpers and the anchor-nav rail (IntersectionObserver-driven active highlight).

**Files:**
- Create: `apps/web/components/settings/section.tsx`
- Create: `apps/web/components/settings/settings-nav.tsx`
- Test: `apps/web/components/settings/__tests__/settings-nav.test.tsx`

**Interfaces:**
- Produces:
  - `Section({ id: string; title: string; sub?: string; children })` — renders `<section id={`set-${id}`}>` with `scroll-mt` and an `<h2>` title.
  - `Row({ label: string; hint?: string; align?: 'center'|'top'; children })`.
  - `SETTINGS_SECTIONS: { id: string; label: string }[]` (exported from settings-nav).
  - `SettingsNav({ activeId, onJump })` — renders one button per section.

- [ ] **Step 1: Write the failing nav test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SettingsNav, SETTINGS_SECTIONS } from '../settings-nav';

describe('SettingsNav', () => {
  it('renders a button per section and reports jumps', () => {
    const onJump = vi.fn();
    render(<SettingsNav activeId="languages" onJump={onJump} />);
    for (const s of SETTINGS_SECTIONS) {
      expect(screen.getByRole('button', { name: s.label })).toBeInTheDocument();
    }
    fireEvent.click(screen.getByRole('button', { name: /goals/i }));
    expect(onJump).toHaveBeenCalledWith('goals');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `pnpm --filter @language-drill/web test -- settings-nav` → FAIL.

- [ ] **Step 3: Implement `section.tsx`**

```typescript
import * as React from 'react';

export function Section({
  id,
  title,
  sub,
  children,
}: {
  id: string;
  title: string;
  sub?: string;
  children: React.ReactNode;
}) {
  return (
    <section id={`set-${id}`} className="mb-s-7 scroll-mt-s-6">
      <h2 className="t-display-m mb-s-1">{title}</h2>
      {sub ? <p className="t-body text-ink-soft mb-s-4">{sub}</p> : <div className="h-s-3" />}
      {children}
    </section>
  );
}

export function Row({
  label,
  hint,
  align = 'center',
  children,
}: {
  label: string;
  hint?: string;
  align?: 'center' | 'top';
  children: React.ReactNode;
}) {
  return (
    <div
      className={
        'grid grid-cols-[180px_1fr] gap-s-5 py-s-4 border-b border-rule mobile:grid-cols-1 mobile:gap-s-2 ' +
        (align === 'top' ? 'items-start' : 'items-center')
      }
    >
      <div>
        <div className="text-[13px] font-medium text-ink">{label}</div>
        {hint ? <div className="t-small text-ink-mute mt-[3px]">{hint}</div> : null}
      </div>
      <div>{children}</div>
    </div>
  );
}
```

- [ ] **Step 4: Implement `settings-nav.tsx`**

```typescript
'use client';

export const SETTINGS_SECTIONS = [
  { id: 'languages', label: 'languages & levels' },
  { id: 'goals', label: 'goals' },
  { id: 'plan', label: 'plan & limits' },
  { id: 'account', label: 'account' },
] as const;

export function SettingsNav({
  activeId,
  onJump,
}: {
  activeId: string;
  onJump: (id: string) => void;
}) {
  return (
    <aside className="sticky top-s-6 self-start mobile:hidden">
      <div className="t-micro text-ink-mute mb-s-3">settings</div>
      <ul className="flex flex-col gap-[2px] list-none p-0 m-0">
        {SETTINGS_SECTIONS.map((s) => (
          <li key={s.id}>
            <button
              type="button"
              onClick={() => onJump(s.id)}
              className={
                'w-full text-left px-s-3 py-[7px] rounded-r-sm text-[13px] border-l-2 transition-all duration-150 ' +
                (activeId === s.id
                  ? 'text-ink border-accent font-medium'
                  : 'text-ink-soft border-transparent hover:text-ink')
              }
            >
              {s.label}
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-s-5 pt-s-4 border-t border-dashed border-rule t-micro text-ink-mute leading-relaxed">
        changes save as you make them.
      </div>
    </aside>
  );
}
```

- [ ] **Step 5: Run to verify pass** — `pnpm --filter @language-drill/web test -- settings-nav` → PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/settings/section.tsx apps/web/components/settings/settings-nav.tsx apps/web/components/settings/__tests__/settings-nav.test.tsx
git commit -m "feat(settings): add Section/Row layout + sticky anchor nav"
```

---

## Task 10: Languages & levels section

Per-language CEFR editing, set-focus, add/remove — autosaving via `useUpdateLanguages`.

**Files:**
- Create: `apps/web/components/settings/languages-section.tsx`
- Test: `apps/web/components/settings/__tests__/languages-section.test.tsx`

**Interfaces:**
- Consumes: `useLanguageProfiles`, `useGetPreferences`, `useUpdateLanguages`, `createAuthenticatedFetch`.
- Produces: `LanguagesSection` (no props; reads its own queries).

- [ ] **Step 1: Write failing tests**

Mock `@language-drill/api-client` so the queries return fixed data and `useUpdateLanguages` exposes a `mutate` spy. Cases:

```typescript
it('renders a row per language with its CEFR level and a focus chip on the primary', () => {
  renderSection({
    profiles: [
      { language: 'ES', proficiencyLevel: 'B2' },
      { language: 'DE', proficiencyLevel: 'A2' },
    ],
    primaryLanguage: 'ES',
  });
  expect(screen.getByText('español')).toBeInTheDocument();
  expect(screen.getByText("today's focus")).toBeInTheDocument();
});

it('changing a level autosaves the full profiles array + primary', () => {
  const mutate = vi.fn();
  renderSection({ profiles: [{ language: 'ES', proficiencyLevel: 'B2' }], primaryLanguage: 'ES' }, mutate);
  fireEvent.click(screen.getByRole('button', { name: /set ES to C1/i }));
  expect(mutate).toHaveBeenCalledWith({
    profiles: [{ language: 'ES', proficiencyLevel: 'C1' }],
    primaryLanguage: 'ES',
  });
});

it('removing the primary language reassigns focus before saving', () => {
  const mutate = vi.fn();
  renderSection({
    profiles: [
      { language: 'ES', proficiencyLevel: 'B2' },
      { language: 'DE', proficiencyLevel: 'A2' },
    ],
    primaryLanguage: 'ES',
  }, mutate);
  fireEvent.click(screen.getByRole('button', { name: /remove español/i }));
  expect(mutate).toHaveBeenCalledWith({
    profiles: [{ language: 'DE', proficiencyLevel: 'A2' }],
    primaryLanguage: 'DE',
  });
});

it('disables remove when only one language remains', () => {
  renderSection({ profiles: [{ language: 'ES', proficiencyLevel: 'B2' }], primaryLanguage: 'ES' });
  expect(screen.getByRole('button', { name: /remove español/i })).toBeDisabled();
});

it('disables "add a language" at 3 languages', () => {
  renderSection({
    profiles: [
      { language: 'ES', proficiencyLevel: 'B2' },
      { language: 'DE', proficiencyLevel: 'A2' },
      { language: 'TR', proficiencyLevel: 'A1' },
    ],
    primaryLanguage: 'ES',
  });
  expect(screen.getByRole('button', { name: /add a language/i })).toBeDisabled();
});
```

- [ ] **Step 2: Run to verify failure** — FAIL (module not found).

- [ ] **Step 3: Implement `languages-section.tsx`**

Derive local editable state from the two queries, mirror it via `useEffect` when query data changes, and on each edit compute the next `{profiles, primaryLanguage}` and call `mutate`. Key logic:

```typescript
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  useLanguageProfiles,
  useGetPreferences,
  useUpdateLanguages,
} from '@language-drill/api-client';
import {
  CefrLevel,
  LANGUAGE_NATIVE_NAMES,
  Language,
  type LearningLanguage,
} from '@language-drill/shared';
import { Section } from './section';
import { Button, Chip } from '../ui';
import { Flagdot } from '../shell/flagdot';

const CEFR_LEVELS = [
  CefrLevel.A1, CefrLevel.A2, CefrLevel.B1, CefrLevel.B2, CefrLevel.C1, CefrLevel.C2,
] as const;
const ALL_LEARNING: readonly LearningLanguage[] = [Language.ES, Language.DE, Language.TR];

type Profile = { language: LearningLanguage; proficiencyLevel: CefrLevel };

export function LanguagesSection() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const profilesQuery = useLanguageProfiles({ fetchFn });
  const prefsQuery = useGetPreferences({ fetchFn });
  const update = useUpdateLanguages({ fetchFn });

  const [rows, setRows] = useState<Profile[]>([]);
  const [primary, setPrimary] = useState<LearningLanguage | null>(null);

  useEffect(() => {
    if (profilesQuery.data) {
      setRows(
        profilesQuery.data.profiles.filter(
          (p): p is Profile => p.language !== 'EN',
        ),
      );
    }
  }, [profilesQuery.data]);
  useEffect(() => {
    if (prefsQuery.data) setPrimary(prefsQuery.data.primaryLanguage);
  }, [prefsQuery.data]);

  const save = (nextRows: Profile[], nextPrimary: LearningLanguage) => {
    setRows(nextRows);
    setPrimary(nextPrimary);
    update.mutate({ profiles: nextRows, primaryLanguage: nextPrimary });
  };

  const setLevel = (language: LearningLanguage, level: CefrLevel) =>
    save(
      rows.map((r) => (r.language === language ? { ...r, proficiencyLevel: level } : r)),
      (primary ?? language),
    );

  const setFocus = (language: LearningLanguage) => save(rows, language);

  const remove = (language: LearningLanguage) => {
    if (rows.length <= 1) return;
    const nextRows = rows.filter((r) => r.language !== language);
    const nextPrimary = primary === language ? nextRows[0].language : primary!;
    save(nextRows, nextPrimary);
  };

  const addLanguage = (language: LearningLanguage) =>
    save([...rows, { language, proficiencyLevel: CefrLevel.A1 }], primary ?? language);

  const available = ALL_LEARNING.filter((l) => !rows.some((r) => r.language === l));

  return (
    <Section id="languages" title="languages & levels" sub="add a language, set your level, or pick today's focus.">
      <div className="flex flex-col gap-s-3">
        {rows.map((r) => (
          <div key={r.language} className="rounded-r-md border border-rule p-s-4 flex flex-col gap-s-3">
            <div className="flex items-center gap-s-3">
              <Flagdot language={r.language} />
              <span className="t-body text-ink">{LANGUAGE_NATIVE_NAMES[r.language]}</span>
              {primary === r.language && <Chip variant="accent">today&apos;s focus</Chip>}
              <div className="ml-auto flex gap-s-2">
                {primary !== r.language && (
                  <Button size="sm" variant="ghost" onClick={() => setFocus(r.language)}>
                    set as focus
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={rows.length <= 1}
                  aria-label={`remove ${LANGUAGE_NATIVE_NAMES[r.language]}`}
                  onClick={() => remove(r.language)}
                >
                  remove
                </Button>
              </div>
            </div>
            <div role="radiogroup" aria-label={`${LANGUAGE_NATIVE_NAMES[r.language]} level`} className="flex gap-[6px] flex-wrap">
              {CEFR_LEVELS.map((lvl) => {
                const selected = r.proficiencyLevel === lvl;
                return (
                  <button
                    key={lvl}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    aria-label={`set ${r.language} to ${lvl}`}
                    onClick={() => setLevel(r.language, lvl)}
                    className={
                      't-mono text-[12px] px-s-3 py-[8px] rounded-r-sm border transition-all duration-150 ' +
                      (selected ? 'bg-ink text-paper border-ink' : 'bg-card text-ink-soft border-rule hover:border-ink')
                    }
                  >
                    {lvl}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {available.length > 0 && (
        <AddLanguage available={available} onAdd={addLanguage} />
      )}
    </Section>
  );
}
```

Add a small `AddLanguage` subcomponent in the same file: a "+ add a language" `Button` that, when clicked, reveals `Flagdot` buttons for `available`; clicking one calls `onAdd`. Disable the trigger when `available.length === 0` (so the 3-language test's button is present-but-disabled — render the trigger always, `disabled={available.length === 0}`, and only show the picker when enabled).

> Note: `useUpdateLanguages` invalidates the queries on success, so the `useEffect` mirrors re-sync after the server round-trip; local state gives instant feedback in the meantime.

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/settings/languages-section.tsx apps/web/components/settings/__tests__/languages-section.test.tsx
git commit -m "feat(settings): languages & levels editor with autosave"
```

---

## Task 11: Goals section

Daily target (4-tile radiogroup), reasons checklist (GOAL_IDS), gentle-nudges Switch — autosaving via `useUpdatePreferences`.

**Files:**
- Create: `apps/web/components/settings/goal-copy.ts`
- Modify: `apps/web/components/onboarding/steps/step-goals.tsx` (import the shared copy)
- Create: `apps/web/components/settings/goals-section.tsx`
- Test: `apps/web/components/settings/__tests__/goals-section.test.tsx`

**Interfaces:**
- Produces: `GOAL_COPY: Record<GoalId, { emoji: string; label: string; description: string }>` (from `goal-copy.ts`); `GoalsSection` component.

- [ ] **Step 1: Extract goal copy**

Create `apps/web/components/settings/goal-copy.ts` containing the existing `GOAL_COPY` map verbatim from `step-goals.tsx` (keep the exact emoji codepoints). Export it. In `step-goals.tsx`, delete the local `GOAL_COPY` and import it: `import { GOAL_COPY } from '../../settings/goal-copy';`. Run `pnpm --filter @language-drill/web test -- step-goals` → still PASS (no behavior change).

- [ ] **Step 2: Write failing goals-section tests**

Mock api-client so `useGetPreferences` returns fixed prefs and `useUpdatePreferences` exposes a `mutate` spy.

```typescript
it('autosaves the chosen daily target', () => {
  const mutate = vi.fn();
  renderGoals({ goals: ['grammar'], dailyMinutes: 10, gentleNudges: true, notes: '', primaryLanguage: 'ES' }, mutate);
  fireEvent.click(screen.getByRole('radio', { name: /20/ }));
  expect(mutate).toHaveBeenCalledWith({ dailyMinutes: 20 });
});

it('toggling a reason autosaves the new goals array', () => {
  const mutate = vi.fn();
  renderGoals({ goals: ['grammar'], dailyMinutes: 10, gentleNudges: true, notes: '', primaryLanguage: 'ES' }, mutate);
  fireEvent.click(screen.getByRole('checkbox', { name: /vocabulary/i }));
  expect(mutate).toHaveBeenCalledWith({ goals: ['grammar', 'vocab'] });
});

it('toggling gentle nudges autosaves', () => {
  const mutate = vi.fn();
  renderGoals({ goals: [], dailyMinutes: 10, gentleNudges: true, notes: '', primaryLanguage: 'ES' }, mutate);
  fireEvent.click(screen.getByRole('switch', { name: /gentle nudges/i }));
  expect(mutate).toHaveBeenCalledWith({ gentleNudges: false });
});
```

- [ ] **Step 3: Run to verify failure** — FAIL.

- [ ] **Step 4: Implement `goals-section.tsx`**

```typescript
'use client';

import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import {
  createAuthenticatedFetch,
  useGetPreferences,
  useUpdatePreferences,
} from '@language-drill/api-client';
import { DAILY_MINUTES, GOAL_IDS, type GoalId } from '@language-drill/shared';
import { Section, Row } from './section';
import { GOAL_COPY } from './goal-copy';
import { Choice, Checkbox, Switch } from '../ui';

export function GoalsSection() {
  const { getToken } = useAuth();
  const fetchFn = useMemo(() => createAuthenticatedFetch(getToken), [getToken]);
  const prefsQuery = useGetPreferences({ fetchFn });
  const update = useUpdatePreferences({ fetchFn });

  const [goals, setGoals] = useState<GoalId[]>([]);
  const [daily, setDaily] = useState<number | null>(null);
  const [nudges, setNudges] = useState(true);

  useEffect(() => {
    if (prefsQuery.data) {
      setGoals(prefsQuery.data.goals);
      setDaily(prefsQuery.data.dailyMinutes);
      setNudges(prefsQuery.data.gentleNudges);
    }
  }, [prefsQuery.data]);

  const pickDaily = (m: (typeof DAILY_MINUTES)[number]) => {
    setDaily(m);
    update.mutate({ dailyMinutes: m });
  };
  const toggleGoal = (id: GoalId) => {
    const next = goals.includes(id) ? goals.filter((g) => g !== id) : [...goals, id];
    setGoals(next);
    update.mutate({ goals: next });
  };
  const toggleNudges = (next: boolean) => {
    setNudges(next);
    update.mutate({ gentleNudges: next });
  };

  return (
    <Section id="goals" title="goals" sub="what you want from this. tweak any time.">
      <Row label="daily target" hint="how much you want to drill each day." align="top">
        <div role="radiogroup" aria-label="daily target" className="grid grid-cols-4 gap-[12px] max-w-[360px]">
          {DAILY_MINUTES.map((m) => (
            <Choice key={m} mode="radio" selected={daily === m} onSelect={() => pickDaily(m)}>
              <span className="flex flex-col items-start">
                <span className="t-display-s">{m}</span>
                <span className="t-micro text-ink-mute">min / day</span>
              </span>
            </Choice>
          ))}
        </div>
      </Row>

      <Row label="why you're learning" hint="we lean drills toward these." align="top">
        <div className="flex flex-col gap-s-2">
          {GOAL_IDS.map((id) => {
            const checked = goals.includes(id);
            const labelId = `goal-${id}`;
            return (
              <label key={id} className="flex items-center gap-s-3 cursor-pointer">
                <Checkbox checked={checked} onChange={() => toggleGoal(id)} aria-labelledby={labelId} />
                <span id={labelId} className="t-body text-ink">{GOAL_COPY[id].label}</span>
              </label>
            );
          })}
        </div>
      </Row>

      <Row label="gentle nudges" hint="one calm note if you've missed two days, never more.">
        <Switch checked={nudges} onChange={toggleNudges} aria-label="gentle nudges" />
      </Row>
    </Section>
  );
}
```

- [ ] **Step 5: Run to verify pass** — `pnpm --filter @language-drill/web test -- goals-section step-goals` → PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/settings/goal-copy.ts apps/web/components/settings/goals-section.tsx apps/web/components/settings/__tests__/goals-section.test.tsx apps/web/components/onboarding/steps/step-goals.tsx
git commit -m "feat(settings): goals editor with autosave; share goal copy"
```

---

## Task 12: Account section (Clerk `<UserProfile>`)

Embed Clerk's profile component with hash routing and paper/ink theming.

**Files:**
- Create: `apps/web/components/settings/account-section.tsx`
- Test: `apps/web/components/settings/__tests__/account-section.test.tsx`

**Interfaces:**
- Produces: `AccountSection` — wraps `<UserProfile>` in a `Section id="account"`.

- [ ] **Step 1: Write the failing test**

Mock `@clerk/nextjs`'s `UserProfile` with a stub so the test asserts it renders inside the account section:

```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('@clerk/nextjs', () => ({
  UserProfile: () => <div data-testid="clerk-user-profile" />,
}));

import { AccountSection } from '../account-section';

describe('AccountSection', () => {
  it('renders the Clerk UserProfile inside the account section', () => {
    render(<AccountSection />);
    expect(document.getElementById('set-account')).toBeInTheDocument();
    expect(screen.getByTestId('clerk-user-profile')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Implement `account-section.tsx`**

```typescript
'use client';

import { UserProfile } from '@clerk/nextjs';
import { Section } from './section';

export function AccountSection() {
  return (
    <Section id="account" title="account" sub="how you sign in and what's tied to your identity.">
      <UserProfile
        routing="hash"
        appearance={{
          variables: {
            colorPrimary: '#c96442',
            colorText: '#1a1612',
            borderRadius: '8px',
            fontFamily: 'var(--t-sans, Inter, sans-serif)',
          },
          elements: {
            rootBox: 'w-full',
            card: 'shadow-none border border-rule',
          },
        }}
      />
    </Section>
  );
}
```

> `routing="hash"` keeps `<UserProfile>` self-contained on `/settings` (no catch-all sub-routes). Email change, connected methods, active sessions, and delete-account are all handled by Clerk; delete triggers the existing `user.deleted` webhook → FK cascade.

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/settings/account-section.tsx apps/web/components/settings/__tests__/account-section.test.tsx
git commit -m "feat(settings): account section embedding Clerk UserProfile"
```

---

## Task 13: Restyle `PlanAndLimits` into a `Section`

Make the existing plan/usage component sit as the `plan` section.

**Files:**
- Modify: `apps/web/components/settings/plan-and-limits.tsx`

- [ ] **Step 1: Wrap in `Section`**

Replace the outer `<Card padding="lg">` + `<h2>` with a `Section id="plan" title="plan & limits" sub="your tier and today's usage.">`, keeping the inner loading/error/usage markup. Move the redeem box + usage grid inside the Section. (The `<h2>` inside is now redundant — the Section renders the title.)

```typescript
import { Section } from './section';
// ...
  return (
    <Section id="plan" title="plan & limits" sub="your tier and today's usage.">
      {me.isLoading && <p className="t-body text-ink-soft">loading…</p>}
      {/* …existing error + usage grid + RedeemCodeBox, unchanged… */}
    </Section>
  );
```

- [ ] **Step 2: Run the existing plan-and-limits test (if any) + typecheck**

Run: `pnpm --filter @language-drill/web test -- plan-and-limits` (skip if no test file) and `pnpm --filter @language-drill/web typecheck`
Expected: PASS. If a test asserted the old `<h2>`/Card, update it to query the Section title.

- [ ] **Step 3: Commit**

```bash
git add apps/web/components/settings/plan-and-limits.tsx
git commit -m "refactor(settings): render plan & limits as a settings Section"
```

---

## Task 14: Assemble the settings page

Compose the sticky nav + scrolling sections with IntersectionObserver-driven active highlighting.

**Files:**
- Modify: `apps/web/app/(dashboard)/settings/page.tsx`
- Test: `apps/web/app/(dashboard)/settings/__tests__/page.test.tsx`

**Interfaces:**
- Consumes: `SettingsNav`, `SETTINGS_SECTIONS`, `LanguagesSection`, `GoalsSection`, `PlanAndLimits`, `AccountSection`.

- [ ] **Step 1: Write the failing page test**

Mock the four section components and api-client/clerk as needed; assert the nav + all four sections render and clicking a nav item calls `scrollIntoView`/sets active. Minimal assertion:

```typescript
it('renders the nav and all four sections', () => {
  renderSettings();
  expect(screen.getByRole('button', { name: /languages & levels/i })).toBeInTheDocument();
  expect(document.getElementById('set-languages')).toBeInTheDocument();
  expect(document.getElementById('set-goals')).toBeInTheDocument();
  expect(document.getElementById('set-plan')).toBeInTheDocument();
  expect(document.getElementById('set-account')).toBeInTheDocument();
});
```

(The web vitest setup already stubs `IntersectionObserver` — see `vitest.setup.ts`.)

- [ ] **Step 2: Run to verify failure** — FAIL.

- [ ] **Step 3: Implement the page**

```typescript
'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { SettingsNav, SETTINGS_SECTIONS } from '../../../components/settings/settings-nav';
import { LanguagesSection } from '../../../components/settings/languages-section';
import { GoalsSection } from '../../../components/settings/goals-section';
import { PlanAndLimits } from '../../../components/settings/plan-and-limits';
import { AccountSection } from '../../../components/settings/account-section';

export default function SettingsPage() {
  const [active, setActive] = useState<string>(SETTINGS_SECTIONS[0].id);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const els = SETTINGS_SECTIONS
      .map((s) => document.getElementById(`set-${s.id}`))
      .filter((el): el is HTMLElement => el !== null);
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio);
        if (visible[0]) setActive(visible[0].target.id.replace('set-', ''));
      },
      { rootMargin: '-20% 0px -60% 0px', threshold: [0, 0.25, 0.5, 1] },
    );
    els.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  const jumpTo = useCallback((id: string) => {
    document.getElementById(`set-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    setActive(id);
  }, []);

  return (
    <div ref={scrollRef} className="mx-auto max-w-[980px] grid grid-cols-[180px_1fr] gap-s-7 mobile:grid-cols-1">
      <SettingsNav activeId={active} onJump={jumpTo} />
      <div className="min-w-0">
        <h1 className="t-display-l mb-s-1">settings</h1>
        <p className="t-body-l text-ink-soft mb-s-6">tune the things that make this <em>your</em> drill.</p>
        <LanguagesSection />
        <GoalsSection />
        <PlanAndLimits />
        <AccountSection />
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass** — PASS.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/settings/page.tsx" "apps/web/app/(dashboard)/settings/__tests__/page.test.tsx"
git commit -m "feat(settings): assemble settings page with anchor nav + sections"
```

---

## Task 15: Final verification sweep

**Files:** none (verification + any straggler fixes).

- [ ] **Step 1: Grep for stale references**

Run:
```bash
grep -rn "primaryLevel" apps packages --include=*.ts --include=*.tsx
grep -rn "edit=1\|\\?edit" apps/web --include=*.ts --include=*.tsx
grep -rn "useSavePreferences\|initialEditState" apps packages --include=*.ts --include=*.tsx
```
Expected: `primaryLevel`/`useSavePreferences` gone from runtime code; `edit=1` only in the redirect test and the onboarding page redirect; `initialEditState` only in the reducer module + its test (kept intentionally). Fix any stragglers (e.g. integration/page tests still rendering the old onboarding edit flow or referencing `/onboarding?edit=1` as a settings entry point — update them to point at `/settings`). Check `user-footer.tsx`/`mobile-top-bar.tsx` settings links still go to `/settings` (no change expected).

- [ ] **Step 2: Stale-dist guard for lambda**

Run: `rm -rf infra/lambda/dist` (avoids phantom failures from compiled `*.test.js` — see project lesson).

- [ ] **Step 3: Full gate from repo root**

Run:
```bash
pnpm lint
pnpm typecheck
pnpm test
```
Expected: zero failures across all packages. Fix any failures before proceeding.

- [ ] **Step 4: Manual smoke (optional but recommended)**

Run `pnpm dev`, sign in locally (dev auth bypass), visit `/settings`: change a level, toggle focus, add/remove a language, change daily target, toggle a reason + gentle nudges (watch the network tab for `PUT /profiles/languages` / `PATCH /profiles/preferences`), and confirm `/onboarding?edit=1` redirects to `/settings`. Confirm the Clerk account panel renders.

- [ ] **Step 5: Commit any fixes**

```bash
git add -A
git commit -m "test(settings): fix stragglers after settings page + onboarding refactor"
```

---

## Self-review (planner)

- **Spec coverage:** languages & levels (T10), goals (T11), plan & limits (T13), account (T12), split endpoints (T1/T2) + hooks (T3/T7), per-language wizard fix (T4/T5/T6), edit→settings redirect (T6), anchor-nav page (T9/T14). Out-of-scope sections excluded. ✓
- **DB NOT NULL constraint** handled by seeding `DEFAULT_DAILY_MINUTES` on the languages-PUT insert (T1) and update-only PATCH (T2). ✓
- **Type consistency:** `levels: Partial<Record<LearningLanguage, CefrLevel>>` and `setLevel({language, level})` used consistently across T4/T5/T6; `useUpdateLanguages` args `{profiles, primaryLanguage}` and `useUpdatePreferences` partial args used identically in T3/T6/T10/T11. ✓
- **No streaks** — goals uses `gentleNudges`/`Switch`, never "streak protection". ✓
