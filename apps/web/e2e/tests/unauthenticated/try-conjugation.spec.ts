import { test, expect } from '@playwright/test';
import { ExerciseSetResponseSchema } from '@language-drill/api-client';
import { validatedReply } from '../../helpers/mock-reply';

// The public drill is the one product surface that must work with no session
// at all, so it belongs in the `unauthenticated` project: the `authenticated`
// project's storageState would hide a regression that redirects it to sign-in.
//
// The Lambda API isn't run by Playwright (see `webServer` in
// playwright.config.ts) — `GET /public/conjugation/set` is mocked via
// `page.route` instead, the same house pattern the authenticated specs use
// (see e.g. fluency.spec.ts). The pattern is origin-tolerant (`**/public/...`)
// because `NEXT_PUBLIC_API_URL` may be unset in the E2E environment, in which
// case `createPublicFetch` resolves the path against the app's own origin.

const CONJUGATION_SET = {
  exercises: [
    {
      id: 'aaaaaaaa-1111-2222-3333-444444444444',
      type: 'conjugation',
      language: 'ES',
      difficulty: 'B1',
      grammarPointKey: 'es-preterite-regular',
      contentJson: {
        type: 'conjugation',
        instructions: 'Write the correct form.',
        lemma: 'hablar',
        lemmaGloss: 'to speak',
        featureBundle: 'pretérito · 1ª persona del singular',
        targetForm: 'hablé',
        breakdown: 'habl- + -é',
        exampleSentences: ['Ayer hablé con mi hermana.'],
      },
    },
    {
      id: 'bbbbbbbb-1111-2222-3333-444444444444',
      type: 'conjugation',
      language: 'ES',
      difficulty: 'B1',
      grammarPointKey: 'es-preterite-regular',
      contentJson: {
        type: 'conjugation',
        instructions: 'Write the correct form.',
        lemma: 'comer',
        lemmaGloss: 'to eat',
        featureBundle: 'pretérito · 3ª persona del plural',
        targetForm: 'comieron',
        breakdown: 'com- + -ieron',
        exampleSentences: ['Ellos comieron temprano.'],
      },
    },
  ],
  available: 2,
  difficulty: 'B1',
};

async function mockConjugationSet(page: import('@playwright/test').Page) {
  await page.route('**/public/conjugation/set*', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill(validatedReply(ExerciseSetResponseSchema, CONJUGATION_SET));
  });
}

test.describe('public conjugation drill', () => {
  test('a signed-out visitor is not redirected to sign-in', async ({ page }) => {
    await mockConjugationSet(page);

    await page.goto('/try/conjugation?lang=ES&level=B1');

    // The single most likely catastrophic regression here is someone removing
    // `/try` from the middleware's public-route matcher (apps/web/proxy.ts) —
    // that would bounce this request to Clerk's hosted sign-in. Assert both
    // that the URL never left the drill and that it isn't Clerk's domain.
    await expect(page).toHaveURL(/\/try\/conjugation/);
    expect(page.url()).not.toContain('sign-in');
    expect(page.url()).not.toContain('clerk');

    await expect(page.getByRole('heading', { name: /try a conjugation set/i })).toBeVisible();
    // The prompt: lemma + feature bundle from the mocked set (see
    // `ConjugationPromptCard`; `instructions` isn't rendered anywhere in the
    // UI, so it's not a usable assertion target).
    await expect(page.getByText('hablar')).toBeVisible();
    await expect(page.getByText(/pretérito · 1ª persona del singular/)).toBeVisible();
    await expect(page.getByRole('textbox', { name: /your answer/i })).toBeVisible();
  });

  test('answering an item produces a verdict and an advance control', async ({ page }) => {
    await mockConjugationSet(page);

    await page.goto('/try/conjugation?lang=ES&level=B1');

    const input = page.getByRole('textbox', { name: /your answer/i });
    await expect(input).toBeVisible();

    await input.fill('definitely-not-the-form');
    await page.getByRole('button', { name: /submit/i }).click();

    // A graded item reveals the correct form and offers the next step —
    // "next" for a non-final item, "see results" on the last one. Either is
    // a valid advance control; the brief's spec covers this exact assertion.
    // Anchored (not the brief's bare `/next|see results/i`) because `next
    // dev`'s "Open Next.js Dev Tools" button also matches an unanchored
    // "next" substring, which only surfaces locally (CI's `webServer` runs a
    // production `next start` build with no dev tools button).
    await expect(page.getByRole('button', { name: /^(next|see results)$/i })).toBeVisible();
    // exact: true — "hablé" is also a substring of the example sentence below it.
    await expect(page.getByText('hablé', { exact: true })).toBeVisible();
  });

  test('a repeated query param falls back gracefully instead of erroring', async ({ page }) => {
    await mockConjugationSet(page);

    // `?lang=ES&lang=DE` is exactly what a hand-edited or tool-generated share
    // link produces. Next hands this to the server component as an array,
    // which previously threw a TypeError (`.toUpperCase()` on an array) inside
    // `parseLang`. The fix picks the first entry; this asserts the page still
    // renders the drill rather than an error page.
    await page.goto('/try/conjugation?lang=ES&lang=DE');

    await expect(page).toHaveURL(/\/try\/conjugation/);
    await expect(page.getByRole('heading', { name: /try a conjugation set/i })).toBeVisible();
    await expect(page.getByRole('textbox', { name: /your answer/i })).toBeVisible();

    // No Next.js error overlay / digest, and no 500-style copy.
    await expect(page.getByText(/application error/i)).toHaveCount(0);
    await expect(page.getByText(/something went wrong/i)).toHaveCount(0);
  });
});
