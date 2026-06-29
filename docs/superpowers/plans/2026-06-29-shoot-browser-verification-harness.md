# `shoot` Browser Verification Harness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give agents a repeatable, scriptable, non-asserting screenshot/frame-capture harness (`pnpm shoot`) that renders any authenticated app route with non-empty seeded content — so UI/animation changes are verified in a real browser instead of guessed.

**Architecture:** Layer a new `shoot` Playwright project on top of the existing auth plumbing. It reuses `auth.setup.ts`'s `storageState.json` (a real dev-Clerk session baked into cookies → no in-browser handshake to get stuck in), applies a consolidated `seedMocks` helper so screens render with content (no servers/DB), navigates to a route given via env, and writes PNG stills (or a timed frame sequence for animations) to a gitignored `.shots/` dir the agent reads back. A small CLI wrapper turns `--flag value` into the env vars the spec reads.

**Tech Stack:** Playwright (`@playwright/test`), Clerk testing tokens (already wired in `auth.setup.ts`), Next.js dev server (auto-started by Playwright's `webServer`), Node ESM CLI wrapper.

## Global Constraints

- Output artifacts go to `apps/web/e2e/.shots/` and MUST be gitignored — never committed.
- The `shoot` project MUST NOT execute during a normal `pnpm test:e2e` run: its spec calls `test.skip()` when `SHOOT_ROUTE` is unset.
- No new test **assertions**, no CI wiring, no new auth mechanism — reuse `auth.setup.ts` + `storageState.json` verbatim.
- Auth comes only from the `setup` project dependency + `storageState` — never re-implement sign-in.
- Mock fixtures that map to a shared response contract use `validatedReply(Schema, body)` from `e2e/helpers/mock-reply.ts` so fixture drift fails loudly; fixtures with no exported schema use `reply(body)`.
- All work happens under `apps/web/`; the package is `@language-drill/web`.
- Theme is controlled by `localStorage['drill-theme']` ∈ `light|dark|system` (key from `apps/web/lib/theme/theme.ts`, `THEME_STORAGE_KEY`); the app toggles the `.dark` class on `<html>` from it pre-paint.
- Mobile viewport = `402×874` (matches the existing `authenticated-mobile` project and the app's `≤760` `mobile:` CSS variant).

---

### Task 1: `seedMocks` content helper + adopt the shell seed in existing specs

Consolidate the shell-gate mocks (`/profiles/languages`, `/review/overview`) that are copy-pasted across three specs into one helper, and add per-screen content seeds the harness will use. Adopting it in `fluency.spec.ts` is the test: if the refactored spec still passes, `seedShell` works and is wired correctly.

**Files:**
- Create: `apps/web/e2e/helpers/seed-mocks.ts`
- Modify: `apps/web/e2e/tests/authenticated/fluency.spec.ts:54-65` (replace inline `/profiles/languages` route with `seedShell`)
- Modify: `apps/web/e2e/tests/authenticated/read-mobile-touch.spec.ts:54-60` (replace inline `/profiles/languages` route with `seedShell`)
- Modify: `apps/web/e2e/tests/authenticated/mobile-responsive.spec.ts:38-51` (replace `mockShell` body with a `seedShell` call)

**Interfaces:**
- Consumes: `reply`, `validatedReply` from `../../helpers/mock-reply` (and `../helpers/mock-reply` from spec depth); `LanguageProfilesResponseSchema` from `@language-drill/api-client`.
- Produces:
  - `seedShell(page: Page): Promise<void>` — registers `**/profiles/languages` and `**/review/overview**` with non-empty fixtures.
  - `seedRead(page: Page): Promise<void>` — registers `**/read/entries` (list) and `**/read/entries/:id` (one entry) so the reader auto-opens with content.
  - `seedFluency(page: Page): Promise<void>` — registers `**/fluency/session` (one cloze) and `**/fluency/attempts` (correct verdict).
  - `seedAll(page: Page): Promise<void>` — calls `seedShell` then every per-screen seed; what the harness uses by default.

- [ ] **Step 1: Write `seed-mocks.ts`**

Create `apps/web/e2e/helpers/seed-mocks.ts`:

```typescript
// Shared content seeds for E2E specs and the `shoot` harness.
//
// `seedShell` covers the two endpoints EVERY authenticated page gates on: the
// (dashboard) layout blocks render until `/profiles/languages` resolves, and the
// Review tab badge polls `/review/overview`. Per-screen seeds add the content a
// specific route needs to render non-empty. `seedAll` registers everything, so
// the harness can shoot any seeded route without per-call setup.
//
// Registration order = priority (Playwright runs the LAST-registered matching
// handler first), so a spec may call a seed here and then override a single
// route with its own `page.route(...)` to exercise a specific branch.

import type { Page } from '@playwright/test';
import { LanguageProfilesResponseSchema } from '@language-drill/api-client';

import { reply, validatedReply } from './mock-reply';

const READ_ENTRY_ID = '11111111-1111-1111-1111-111111111111';

/** The universal authenticated-shell gate: profile list + review badge. */
export async function seedShell(page: Page): Promise<void> {
  await page.route('**/profiles/languages', (route) =>
    route.fulfill(
      validatedReply(LanguageProfilesResponseSchema, {
        profiles: [{ language: 'ES', proficiencyLevel: 'B1' }],
      }),
    ),
  );
  await page.route('**/review/overview**', (route) =>
    route.fulfill(
      reply({
        breakdown: { due: 3, new: 5, leech: 1, total: 42, mix: {} },
        estimatedMinutes: 6,
        nextDueAt: null,
      }),
    ),
  );
}

/** Reader: a one-entry list + that entry, so the reader auto-opens with text. */
export async function seedRead(page: Page): Promise<void> {
  await page.route(/\/read\/entries(\?|$)/, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill(
          reply({
            entries: [
              {
                id: READ_ENTRY_ID,
                title: 'Aldea',
                source: '',
                preview: 'La aldea está en la montaña.',
                flaggedCount: 1,
                savedCount: 0,
                pastedAt: '2026-05-25T00:00:00.000Z',
              },
            ],
          }),
        )
      : route.fallback(),
  );
  await page.route(`**/read/entries/${READ_ENTRY_ID}`, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill(
          reply({
            id: READ_ENTRY_ID,
            language: 'ES',
            title: 'Aldea',
            source: '',
            text: 'La aldea está en la montaña.',
            flaggedWords: {
              aldea: { lemma: 'aldea', pos: 'noun', gloss: 'village', freq: 1, cefr: 'B2' },
            },
            bank: [],
            pastedAt: '2026-05-25T00:00:00.000Z',
          }),
        )
      : route.fallback(),
  );
}

/** Fluency: a one-cloze session + a correct attempt verdict. */
export async function seedFluency(page: Page): Promise<void> {
  await page.route('**/fluency/session', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill(
          reply({
            language: 'ES',
            exercises: [
              {
                id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
                type: 'cloze',
                language: 'ES',
                difficulty: 'A2',
                grammarPointKey: null,
                contentJson: {
                  type: 'cloze',
                  sentence: 'Ella habla _____ español.',
                  answer: 'mucho',
                  translation: 'She speaks a lot of Spanish.',
                  grammarPoints: [],
                },
              },
            ],
          }),
        )
      : route.fallback(),
  );
  await page.route('**/fluency/attempts', (route) =>
    route.request().method() === 'POST'
      ? route.fulfill(reply({ correct: true, correctAnswer: 'mucho', latencyMs: 1234 }))
      : route.fallback(),
  );
}

/** Everything: the shell plus every per-screen seed. Used by the harness. */
export async function seedAll(page: Page): Promise<void> {
  await seedShell(page);
  await seedRead(page);
  await seedFluency(page);
}
```

- [ ] **Step 2: Refactor `fluency.spec.ts` to use `seedShell`**

In `apps/web/e2e/tests/authenticated/fluency.spec.ts`, add the import near the other helper import:

```typescript
import { seedShell } from '../../helpers/seed-mocks';
```

Replace the inline `/profiles/languages` route block (lines ~55-65, the `await page.route('**/profiles/languages', ...)` call and its leading comment) with:

```typescript
  // Shell gate (profile list + review badge) — see seed-mocks.ts.
  await seedShell(page);
```

Leave the `/fluency/session` and `/fluency/attempts` routes in the spec as-is (they carry the spec's specific assertions). Remove the now-unused `LanguageProfilesResponseSchema` import only if no longer referenced.

- [ ] **Step 3: Run the fluency spec to verify the refactor**

Run: `pnpm --filter @language-drill/web test:e2e -- fluency.spec.ts`
Expected: PASS (1 test in `authenticated`, plus the `setup` project). The shell still resolves via `seedShell`, so the page mounts and the drill/insufficient branch renders.

- [ ] **Step 4: Refactor `read-mobile-touch.spec.ts` and `mobile-responsive.spec.ts`**

In `read-mobile-touch.spec.ts`, add `import { seedShell } from '../../helpers/seed-mocks';` and replace its inline `**/profiles/languages` route (inside `mockReadApi`, lines ~57-59) with `await seedShell(page);`. Keep the read-specific routes in that file.

In `mobile-responsive.spec.ts`, add `import { seedShell } from '../../helpers/seed-mocks';` and replace the body of the local `mockShell` function (lines ~39-50) with a single `await seedShell(page);` (keep the `mockShell` wrapper name and its callers untouched).

- [ ] **Step 5: Run both refactored specs**

Run: `pnpm --filter @language-drill/web test:e2e -- read-mobile-touch.spec.ts mobile-responsive.spec.ts`
Expected: PASS for both (the `authenticated` + `authenticated-mobile` projects). Same rendered behavior, shell now seeded from one place.

- [ ] **Step 6: Commit**

```bash
git add apps/web/e2e/helpers/seed-mocks.ts \
  apps/web/e2e/tests/authenticated/fluency.spec.ts \
  apps/web/e2e/tests/authenticated/read-mobile-touch.spec.ts \
  apps/web/e2e/tests/authenticated/mobile-responsive.spec.ts
git commit -m "test(e2e): consolidate shell mocks into seedMocks helper"
```

---

### Task 2: `shoot` Playwright project + spec skeleton (still PNG, default-run-safe)

Add the `shoot` project and a spec that, given `SHOOT_ROUTE`, seeds content, navigates, and screenshots to `.shots/`. With no `SHOOT_ROUTE` it skips — so a bare `pnpm test:e2e` never trips on it.

**Files:**
- Modify: `apps/web/playwright.config.ts:65-116` (add a `shoot` project to the `projects` array)
- Create: `apps/web/e2e/shoot.spec.ts`

**Interfaces:**
- Consumes: `seedAll` from `./helpers/seed-mocks`; `STORAGE_STATE_PATH` from `./helpers/test-user`.
- Produces: a `shoot` Playwright project (name `'shoot'`, `dependencies: ['setup']`, `storageState: STORAGE_STATE_PATH`); env contract `SHOOT_ROUTE` (required to run), `SHOOT_OUT` (output basename, default derived from the route).

- [ ] **Step 1: Add the `shoot` project to `playwright.config.ts`**

In the `projects` array, after the `unauthenticated` project entry, add:

```typescript
    {
      // Non-asserting screenshot/frame-capture harness (see e2e/shoot.spec.ts +
      // docs/testing.md). Only runs when SHOOT_ROUTE is set — otherwise its one
      // test self-skips, so a bare `test:e2e` run is unaffected. Reuses the
      // signed-in storageState (no Clerk handshake) like the authenticated
      // project; depends on `setup` so that state is fresh.
      name: 'shoot',
      testDir: './e2e',
      testMatch: /shoot\.spec\.ts$/,
      dependencies: ['setup'],
      use: {
        ...devices['Desktop Chrome'],
        storageState: STORAGE_STATE_PATH,
      },
    },
```

(`STORAGE_STATE_PATH` and `devices` are already imported at the top of the file.)

- [ ] **Step 2: Write `shoot.spec.ts` (PNG-only skeleton)**

Create `apps/web/e2e/shoot.spec.ts`:

```typescript
// `shoot` — non-asserting browser verification harness.
//
// Renders ONE authenticated route with seeded (non-empty) content and writes a
// screenshot to e2e/.shots/, so an agent can SEE a UI change instead of guessing.
// Driven entirely by env vars (set by `pnpm shoot`, see e2e/shoot-cli.mjs):
//
//   SHOOT_ROUTE  (required)  app path to render, e.g. /dashboard or /read
//   SHOOT_OUT    (optional)  output basename; default derived from the route
//
// With no SHOOT_ROUTE the single test self-skips, so this file is inert during a
// normal `test:e2e` run. Auth comes from the storageState the `setup` project
// produced — there is no sign-in here and no Clerk handshake to stall on.

import path from 'node:path';
import { mkdir } from 'node:fs/promises';

import { test } from '@playwright/test';

import { seedAll } from './helpers/seed-mocks';

const SHOTS_DIR = path.resolve(__dirname, '.shots');

/** Turn a route into a filesystem-safe basename: /read/entries -> read-entries. */
function routeToName(route: string): string {
  const trimmed = route.replace(/^\/+|\/+$/g, '') || 'root';
  return trimmed.replace(/[^a-zA-Z0-9]+/g, '-');
}

test('shoot', async ({ page }) => {
  const route = process.env['SHOOT_ROUTE'];
  test.skip(!route, 'SHOOT_ROUTE not set — harness is inert (run via `pnpm shoot`).');
  const targetRoute = route as string;

  await mkdir(SHOTS_DIR, { recursive: true });
  await seedAll(page);

  await page.goto(targetRoute, { waitUntil: 'networkidle' });

  const name = process.env['SHOOT_OUT']?.trim() || routeToName(targetRoute);
  const outPath = path.join(SHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: outPath, fullPage: true });
  console.log(`[shoot] wrote ${outPath}`);
});
```

- [ ] **Step 3: Verify the harness is inert in a normal run**

Run: `pnpm --filter @language-drill/web test:e2e -- shoot.spec.ts`
Expected: the `shoot` test reports **skipped** (reason: "SHOOT_ROUTE not set …"). No PNG written. Confirms a bare `test:e2e` won't fail on it.

- [ ] **Step 4: Verify a screenshot is produced when `SHOOT_ROUTE` is set**

Run: `SHOOT_ROUTE=/fluency pnpm --filter @language-drill/web exec playwright test --project=shoot`
Expected: PASS; console prints `[shoot] wrote …/e2e/.shots/fluency.png`.

Then confirm the file exists and is non-trivial:

Run: `ls -l apps/web/e2e/.shots/fluency.png`
Expected: a PNG file larger than ~5 KB (a rendered page, not a blank frame).

- [ ] **Step 5: Commit**

```bash
git add apps/web/playwright.config.ts apps/web/e2e/shoot.spec.ts
git commit -m "test(e2e): add shoot screenshot harness project"
```

---

### Task 3: CLI wrapper + theme / viewport / wait / animate / full-stack flags

Add `pnpm shoot --route … --theme … --viewport … --animate` ergonomics via a tiny Node wrapper that maps flags to the env vars the spec reads, and extend the spec to honor them. `--animate` captures a timed frame sequence (stills over the transition window) — simpler and equally agent-readable than a video container, and needs no context-level config.

**Files:**
- Create: `apps/web/e2e/shoot-cli.mjs`
- Modify: `apps/web/package.json:scripts` (add `"shoot"`)
- Modify: `apps/web/e2e/shoot.spec.ts` (honor `SHOOT_THEME`, `SHOOT_VIEWPORT`, `SHOOT_WAIT`, `SHOOT_ANIMATE`, `SHOOT_FULL_STACK`)

**Interfaces:**
- Consumes: the env contract from Task 2 plus `SHOOT_THEME` (`light|dark|system`, default `system`), `SHOOT_VIEWPORT` (`desktop|mobile`, default `desktop`), `SHOOT_WAIT` (selector/text to await), `SHOOT_ANIMATE` (`1` → frame sequence), `SHOOT_FULL_STACK` (`1` → skip `seedAll`).
- Produces: `pnpm shoot` mapping `--route|--theme|--viewport|--wait|--out` value flags and `--animate|--full-stack` boolean flags onto those env vars, then running `playwright test --project=shoot`.

- [ ] **Step 1: Write the CLI wrapper**

Create `apps/web/e2e/shoot-cli.mjs`:

```javascript
#!/usr/bin/env node
// `pnpm shoot` ergonomics: map --flag value onto the SHOOT_* env vars that
// shoot.spec.ts reads, then run the `shoot` Playwright project. Example:
//   pnpm shoot --route /review --theme dark --viewport mobile
//   pnpm shoot --route /read --animate
// Route is an app path. The dashboard landing is `/` (the app uses a
// `(dashboard)` route GROUP, so there is no `/dashboard` URL).
import { spawnSync } from 'node:child_process';

const VALUE_FLAGS = {
  '--route': 'SHOOT_ROUTE',
  '--theme': 'SHOOT_THEME',
  '--viewport': 'SHOOT_VIEWPORT',
  '--wait': 'SHOOT_WAIT',
  '--out': 'SHOOT_OUT',
};
const BOOL_FLAGS = {
  '--animate': 'SHOOT_ANIMATE',
  '--full-stack': 'SHOOT_FULL_STACK',
};

const env = { ...process.env };
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const arg = argv[i];
  if (VALUE_FLAGS[arg]) {
    const value = argv[++i];
    if (value === undefined) {
      console.error(`[shoot] ${arg} needs a value`);
      process.exit(2);
    }
    env[VALUE_FLAGS[arg]] = value;
  } else if (BOOL_FLAGS[arg]) {
    env[BOOL_FLAGS[arg]] = '1';
  } else {
    console.error(`[shoot] unknown flag: ${arg}`);
    process.exit(2);
  }
}

if (!env.SHOOT_ROUTE) {
  console.error('[shoot] --route is required, e.g. `pnpm shoot --route /read`');
  process.exit(2);
}

const result = spawnSync(
  'playwright',
  ['test', '--project=shoot'],
  { stdio: 'inherit', env, shell: process.platform === 'win32' },
);
process.exit(result.status ?? 1);
```

- [ ] **Step 2: Add the `shoot` script to `package.json`**

In `apps/web/package.json`, add to `"scripts"` (after `"test:e2e:install"`):

```json
    "shoot": "node e2e/shoot-cli.mjs"
```

- [ ] **Step 3: Extend `shoot.spec.ts` to honor the new env vars**

Also fix the stale example route in the file's header comment: change `SHOOT_ROUTE  (required)  app path to render, e.g. /dashboard or /read` to `… e.g. /read or /review (dashboard landing is /)`. `/dashboard` is a 404 — the app uses a `(dashboard)` route group, so the URL is `/`.

Replace the body of the `test('shoot', …)` block in `apps/web/e2e/shoot.spec.ts` with:

```typescript
test('shoot', async ({ page }) => {
  const route = process.env['SHOOT_ROUTE'];
  test.skip(!route, 'SHOOT_ROUTE not set — harness is inert (run via `pnpm shoot`).');
  const targetRoute = route as string;

  await mkdir(SHOTS_DIR, { recursive: true });

  // Viewport: mobile matches the app's ≤760 `mobile:` variant / authenticated-mobile.
  if (process.env['SHOOT_VIEWPORT'] === 'mobile') {
    await page.setViewportSize({ width: 402, height: 874 });
  }

  // Theme: seed localStorage before any app code runs, and align the OS media
  // query, so the pre-paint init script in lib/theme/theme.ts resolves correctly.
  const theme = process.env['SHOOT_THEME'] ?? 'system';
  if (theme === 'light' || theme === 'dark' || theme === 'system') {
    await page.addInitScript((t) => {
      try {
        window.localStorage.setItem('drill-theme', t);
      } catch {
        /* private mode — ignore, init script falls back to default */
      }
    }, theme);
    if (theme === 'dark') await page.emulateMedia({ colorScheme: 'dark' });
    if (theme === 'light') await page.emulateMedia({ colorScheme: 'light' });
  }

  // Content: seeded mocks by default; --full-stack skips them to hit the real
  // backend the running server points at (requires PLAYWRIGHT_BASE_URL + a wired
  // full stack — see docs/testing.md).
  if (process.env['SHOOT_FULL_STACK'] !== '1') {
    await seedAll(page);
  }

  await page.goto(targetRoute, { waitUntil: 'domcontentloaded' });

  // Wait for CONTENT, not network. `networkidle` fires in the quiet window
  // BEFORE the SPA issues its data fetches, so it captures the loading spinner.
  // Instead: an explicit --wait selector wins; otherwise let the page settle
  // (bounded networkidle) and wait for the app's loading spinners (.animate-spin
  // — used by the (dashboard) shell + page loading states) to detach. All bounded
  // and best-effort so a genuinely stuck route (e.g. an endpoint seedAll doesn't
  // mock) still produces a screenshot, with a warning instead of a hang/throw.
  const waitFor = process.env['SHOOT_WAIT']?.trim();
  if (waitFor) {
    await page.locator(waitFor).first().waitFor({ state: 'visible', timeout: 15_000 });
  } else {
    await page.waitForLoadState('networkidle', { timeout: 8_000 }).catch(() => {});
    try {
      await page.locator('.animate-spin').first().waitFor({ state: 'detached', timeout: 8_000 });
    } catch {
      console.warn(
        `[shoot] WARNING: a loading spinner was still present on ${targetRoute} ` +
          `after the wait — the screenshot may show a loading state. Pass ` +
          `--wait <content-selector>, or extend seedAll / use --full-stack if an ` +
          `endpoint this page fetches is unmocked.`,
      );
    }
  }
  // Brief settle so fonts, layout, and entry animations finish painting.
  await page.waitForTimeout(300);

  const name = process.env['SHOOT_OUT']?.trim() || routeToName(targetRoute);

  if (process.env['SHOOT_ANIMATE'] === '1') {
    // Capture a short frame sequence so a transition is visible across stills.
    const FRAMES = 8;
    const INTERVAL_MS = 180;
    for (let i = 0; i < FRAMES; i++) {
      const frame = String(i).padStart(2, '0');
      await page.screenshot({ path: path.join(SHOTS_DIR, `${name}-frame-${frame}.png`) });
      await page.waitForTimeout(INTERVAL_MS);
    }
    console.log(`[shoot] wrote ${FRAMES} frames to ${SHOTS_DIR}/${name}-frame-*.png`);
    return;
  }

  const outPath = path.join(SHOTS_DIR, `${name}.png`);
  await page.screenshot({ path: outPath, fullPage: true });
  console.log(`[shoot] wrote ${outPath}`);
});
```

- [ ] **Step 4: Verify content renders on real routes (light + dark)**

Capture two real, content-bearing routes — `/read` and `/review` (NOT `/dashboard`, which 404s):

Run: `pnpm --filter @language-drill/web shoot --route /read --out read-light`
Run: `pnpm --filter @language-drill/web shoot --route /review --theme dark --out review-dark`

Expected for each: PASS, console prints `[shoot] wrote …`, and **no** `[shoot] WARNING: a loading spinner was still present …` line. The absence of that warning is the signal that the content-aware wait worked (the page rendered past its spinner). If the warning fires for a route, that route fetches an endpoint `seedAll` doesn't mock — report it as DONE_WITH_CONCERNS naming the route and the unmocked request (visible via the page's failed network calls); the controller will extend `seedAll`.

Then read each PNG back (`Read` renders it) and confirm it shows real content, not a centered loading ring:
- `apps/web/e2e/.shots/read-light.png` — the reader with the seeded "Aldea" entry text, light palette.
- `apps/web/e2e/.shots/review-dark.png` — the review screen, dark palette (paper-dark background, light text).

- [ ] **Step 5: Verify `--viewport mobile` and `--animate`**

Run: `pnpm --filter @language-drill/web shoot --route /read --viewport mobile --out read-mobile`
Expected: PASS; the PNG is phone-width (402px content) — confirm by reading it back.

Run: `pnpm --filter @language-drill/web shoot --route /read --animate --out read-anim`
Expected: PASS; console prints `[shoot] wrote 8 frames …`.

Run: `ls apps/web/e2e/.shots/read-anim-frame-*.png | wc -l`
Expected: `8`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/e2e/shoot-cli.mjs apps/web/package.json apps/web/e2e/shoot.spec.ts
git commit -m "test(e2e): add shoot CLI with theme/viewport/animate flags"
```

---

### Task 4: gitignore the artifacts + document the harness

Make `.shots/` untracked and tell every agent which tool to reach for (and which trap to avoid).

**Files:**
- Modify: `apps/web/.gitignore` (or root `.gitignore` — match where `**/e2e/.auth/` lives, which is root `.gitignore:67`)
- Modify: `docs/testing.md` (new "Verifying UI changes in a browser" section)
- Modify: `CLAUDE.md` (short pointer under Testing)

**Interfaces:**
- Consumes: nothing.
- Produces: documentation + ignore rule only.

- [ ] **Step 1: Gitignore the artifacts**

In the root `/Users/seal/dev/language-drill/.gitignore`, directly below the existing `**/e2e/.auth/` line (line 67), add:

```
**/e2e/.shots/
```

- [ ] **Step 2: Confirm the artifacts are now ignored**

Run: `git status --porcelain apps/web/e2e/.shots/`
Expected: **no output** (the directory and its PNGs are ignored).

- [ ] **Step 3: Add the docs section to `docs/testing.md`**

Append this section to `docs/testing.md`:

```markdown
## Verifying UI changes in a browser (`pnpm shoot`)

To verify a styling or animation change on an **authenticated** app screen, use
the `shoot` harness — do **not** open `localhost:3000` in the connected Chrome:
Clerk's middleware rewrites `/` to a 404 until a dev-browser handshake completes
that an automated tab can't reliably finish (the handshake-loop trap). `shoot`
sidesteps it by reusing the signed-in `storageState` produced by `auth.setup.ts`
(real dev-Clerk cookies → no handshake), seeding non-empty content via mocks, and
writing artifacts to `apps/web/e2e/.shots/` (gitignored) that you read back.

Routes are app paths. The dashboard landing is `/` — the app uses a
`(dashboard)` route GROUP, so there is **no** `/dashboard` URL (it 404s). Common
content routes: `/`, `/read`, `/review`, `/progress`, `/theory`, `/fluency`,
`/drill/conjugation`, `/drill/free-writing`, `/settings`.

```bash
# Still of a route (mocked, non-empty content; no servers/DB needed)
pnpm --filter @language-drill/web shoot --route /review

# Dark theme, phone width, custom filename
pnpm --filter @language-drill/web shoot --route /read --theme dark --viewport mobile --out read-dark

# Wait for a specific element before capturing (overrides the default spinner-clear wait)
pnpm --filter @language-drill/web shoot --route /fluency --wait "role=textbox"

# Animation: capture a timed frame sequence (…-frame-00.png … -frame-07.png)
pnpm --filter @language-drill/web shoot --route /drill/free-writing --animate
```

Flags: `--route` (required), `--theme light|dark|system`, `--viewport
desktop|mobile`, `--wait <selector>`, `--out <basename>`, `--animate`,
`--full-stack`.

By default the harness waits past the app's loading spinners (`.animate-spin`)
before capturing — `networkidle` alone catches a spinner because it fires before
the SPA's data fetches. If a `[shoot] WARNING: … loading spinner still present`
line appears, the route fetches something `seedAll` doesn't mock: pass `--wait
<content-selector>`, extend `seedAll`, or use `--full-stack`.

**Real data (rare).** `--full-stack` skips the mocks so the page hits whatever
the running server's `NEXT_PUBLIC_API_URL` points at. Because Playwright's
auto-started `next dev` isn't wired to the local Lambda, run your own full stack
(`pnpm dev`) and point the harness at it: `PLAYWRIGHT_BASE_URL=http://localhost:3000
pnpm --filter @language-drill/web shoot --route /review --full-stack`.

**Connected Chrome** is the right tool for the **deployed Vercel preview** (your
real session, real dev backend) — not localhost.
```

- [ ] **Step 4: Add the `CLAUDE.md` pointer**

In `CLAUDE.md`, under the `## Testing` section (after the `### End-to-end (Playwright)` subsection), add:

```markdown
### Verifying UI/animation changes in a browser

Use `pnpm --filter @language-drill/web shoot --route <path>` to render an
authenticated screen with seeded content and capture a screenshot (or
`--animate` for a frame sequence) to `apps/web/e2e/.shots/`. This reuses the
`auth.setup.ts` storageState, so it does **not** hit the Clerk dev-browser
handshake loop that blocks `localhost:3000` in the connected Chrome. Connected
Chrome is for the deployed Vercel preview, not localhost. Full guide:
`docs/testing.md` → "Verifying UI changes in a browser".
```

- [ ] **Step 5: Commit**

```bash
git add .gitignore docs/testing.md CLAUDE.md
git commit -m "docs: document the shoot browser-verification harness"
```

---

## Self-Review

**Spec coverage:**
- `pnpm shoot` entry + flag contract → Task 3 (CLI) + Task 2/3 (spec env reads). ✓
- Dedicated `shoot` project excluded from default run via `test.skip` → Task 2 (config + skip guard, verified Step 3). ✓
- `storageState` auth / no handshake → Task 2 (project `storageState` + `dependencies: ['setup']`). ✓
- `seedMocks` shell-baseline + dashboard/review/read/fluency, consolidation of the 3 specs → Task 1. ✓ (Note: "review" content is the `/review/overview` badge in `seedShell`; the review *screen's* own list endpoints can be added inline if a future shoot needs them — within the "grow as needed" scope.)
- `.shots/` output, gitignored → Task 2 (write path) + Task 4 (ignore rule). ✓
- Mock-by-default, `--full-stack` opt-in → Task 3 (`SHOOT_FULL_STACK` skips `seedAll`) + Task 4 docs. ✓
- Docs in `docs/testing.md` + `CLAUDE.md` pointer → Task 4. ✓
- Refactor existing specs to `seedMocks` → Task 1 Steps 2/4. ✓

**Deviation from spec (flagged):** the spec described animation capture as a
`.webm` video; this plan implements `--animate` as a **timed frame sequence**
(`-frame-NN.png`) instead. Rationale: Playwright video recording is configured at
the context/project level (not cleanly per-test) and auto-names files, whereas
frames need no config, write straight to `.shots/`, and are directly readable by
the agent. Both satisfy the goal (verify a transition, not guess it). Surface
this at handoff for a thumbs-up.

**Placeholder scan:** no TBD/TODO/"handle edge cases"; every code step shows full
content. ✓

**Type consistency:** `seedShell`/`seedRead`/`seedFluency`/`seedAll` names match
between Task 1's definition and Task 2/3's `import { seedAll }`. `routeToName`,
`SHOTS_DIR`, and the `SHOOT_*` env keys are consistent between the CLI wrapper
(Task 3 Step 1) and the spec (Task 2 Step 2 / Task 3 Step 3). The CLI's value/bool
flag set matches the env vars the spec reads. ✓
```
