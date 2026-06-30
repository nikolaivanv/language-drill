import { expect, test, type Page } from '@playwright/test';
import { seedShell } from '../../helpers/seed-mocks';

// ---------------------------------------------------------------------------
// Mobile-viewport responsive smoke (Req 12.3, 12.4; NFR Usability)
// ---------------------------------------------------------------------------
// Runs in the `authenticated-mobile` Playwright project at 402×874 (≤760, so
// the `mobile:` CSS variant + `useIsMobile()` resolve to the phone layout).
// The final block overrides the viewport back to desktop to assert the ≥761
// layout is unchanged (the regression guard).
//
// The chrome assertions (tab-bar present, no horizontal overflow, desktop rail
// guard) are reliable anywhere the app shell renders. The deeper drill / theory
// / reader affordances depend on a seeded backend (exercise pool, annotation),
// so this spec is meant to run against a full stack — locally with the API up,
// or in CI against a preview deploy via `PLAYWRIGHT_BASE_URL`. See e2e/README.
// ---------------------------------------------------------------------------

// Allow a 1px rounding slop when comparing scrollWidth to clientWidth.
const OVERFLOW_SLOP = 1;

// The drill / theory smoke tests need a seeded exercise pool (real exercises +
// theory links). They only run against a full stack — a preview deploy
// (`PLAYWRIGHT_BASE_URL`) or a local API (`E2E_FULL_STACK=1`). The chrome /
// reader tests below mock the few endpoints the shell needs, so they run
// anywhere. Without this gate, a plain `pnpm test:e2e` (web server only, no API)
// fails them spuriously — the dashboard layout blocks on `/profiles/languages`,
// so the app shell (and the tab-bar it renders) never mounts.
const FULL_STACK =
  !!process.env['PLAYWRIGHT_BASE_URL'] || process.env['E2E_FULL_STACK'] === '1';

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

// Stub the endpoints the app shell depends on so the chrome renders without a
// live API: the dashboard layout gates on `/profiles/languages`, and the
// Review tab badge polls `/review/overview`.
async function mockShell(page: Page): Promise<void> {
  await seedShell(page);
}

const READ_ENTRY_ID = '11111111-1111-1111-1111-111111111111';

// The reader auto-opens the most-recent entry on load; a flagged word makes the
// word-bank chip appear. Mock the list + entry so the chip test runs anywhere.
async function mockReader(page: Page): Promise<void> {
  await page.route(/\/read\/entries(\?|$)/, (route) =>
    route.request().method() === 'GET'
      ? route.fulfill(
          json({
            entries: [
              {
                id: READ_ENTRY_ID,
                title: 'Aldea',
                source: '',
                preview: 'La aldea',
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
          json({
            id: READ_ENTRY_ID,
            language: 'ES',
            title: 'Aldea',
            source: '',
            text: 'La aldea',
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

async function horizontalOverflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const el = document.documentElement;
    return el.scrollWidth - el.clientWidth;
  });
}

// Every test needs the shell to render; mock its deps before each.
test.beforeEach(async ({ page }) => {
  await mockShell(page);
});

test.describe('mobile chrome (≤760px)', () => {
  test('dashboard shows the bottom tab-bar, hides the desktop rail, and never overflows sideways', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('mobile-tab-bar')).toBeVisible();
    await expect(page.getByTestId('desktop-rail')).toHaveCount(0);
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(OVERFLOW_SLOP);
  });

  test('a drill surfaces the sticky action bar with the session meta', async ({
    page,
  }) => {
    test.skip(!FULL_STACK, 'needs a seeded exercise pool — run against a full stack');
    await page.goto('/drill');
    await expect(page.getByTestId('mobile-tab-bar')).toBeVisible();
    // On mobile the exercises publish their primary CTA into the sticky
    // DrillActionBar, whose left slot reads "item N of M" once an exercise
    // has loaded.
    await expect(page.getByText(/item \d+ of \d+/)).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(OVERFLOW_SLOP);
  });

  test('the theory panel opens as a near-full-width sheet', async ({ page }) => {
    test.skip(!FULL_STACK, 'needs a seeded exercise pool — run against a full stack');
    await page.goto('/drill');
    await page.locator('.theory-trigger').first().click();
    const sheet = page.getByRole('dialog');
    await expect(sheet).toBeVisible();
    // The mobile reflow turns the right slide-over into a bottom sheet that
    // spans (close to) the full 402px width.
    const box = await sheet.boundingBox();
    expect(box?.width ?? 0).toBeGreaterThan(360);
  });

  test('the reader exposes the word-bank chip that opens the bank sheet', async ({
    page,
  }) => {
    await mockReader(page);
    await page.goto('/read');
    await expect(page.getByTestId('mobile-tab-bar')).toBeVisible();
    const chip = page.getByRole('button', { name: /word bank ·/ });
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(page.getByRole('dialog', { name: 'word bank' })).toBeVisible();
    expect(await horizontalOverflow(page)).toBeLessThanOrEqual(OVERFLOW_SLOP);
  });
});

test.describe('desktop regression guard (≥761px)', () => {
  // Override the project's phone viewport for this block so we exercise the
  // unchanged desktop layout from the same spec file.
  test.use({ viewport: { width: 1280, height: 900 } });

  test('the dashboard renders the left rail and no bottom tab-bar', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByTestId('desktop-rail')).toBeVisible();
    await expect(page.getByTestId('mobile-tab-bar')).toHaveCount(0);
  });
});
