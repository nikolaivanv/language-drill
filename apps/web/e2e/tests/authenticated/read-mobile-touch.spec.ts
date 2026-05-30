import { devices, expect, test, type Locator, type Page } from '@playwright/test';
import type { CDPSession } from '@playwright/test';

// ---------------------------------------------------------------------------
// Read · mobile select-first drag (real touch hit-testing)
// ---------------------------------------------------------------------------
// Multi-word selection on touch is a SELECT-FIRST drag: drag horizontally
// across words to build the span, and the deep card opens only on release — so
// a phrase costs ONE model call and nothing covers the passage mid-selection.
// jsdom can't model this (no layout ⇒ no `elementFromPoint`/live rects), so the
// gesture is proven here against a real browser, driving genuine touch input
// via CDP `Input.dispatchTouchEvent` (touch-action, preventDefault, and
// elementFromPoint all behave as on a device).
// ---------------------------------------------------------------------------

// Pixel 5 → 393×727 (≤760 ⇒ mobile sheet path) with hasTouch + isMobile.
test.use({ ...devices['Pixel 5'] });

const ENTRY_ID = '11111111-1111-1111-1111-111111111111';

// "La aldea estaba tranquila. echar de menos."
//   aldea   [3, 8)   — flagged
//   estaba  [9, 15)  — unflagged; a drag aldea→estaba ⇒ phrase [3,15)
const PASSAGE_TEXT = 'La aldea estaba tranquila. echar de menos.';

const FLAGGED_WORDS = {
  aldea: { lemma: 'aldea', pos: 'noun', gloss: 'small village', freq: 4321, cefr: 'B2' as const },
};
const DEEP_WORD = {
  type: 'word' as const,
  surface: 'aldea',
  lemma: 'aldea',
  pos: 'noun',
  contextualSense: 'a small rural settlement',
  definition: 'pueblo pequeño',
  definitionLabel: 'Español',
  cefr: 'B2',
  freq: 4321,
};
const DEEP_PHRASE = {
  type: 'phrase' as const,
  surface: 'aldea estaba',
  literal: 'village was',
  idiomaticMeaning: 'fixed expression (test)',
  register: 'neutral',
};

function json(body: unknown, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

// Returns captured `POST /read/annotate-span` spans so the test can assert
// exactly which spans were requested (select-first ⇒ one call per gesture).
async function mockReadApi(page: Page): Promise<{ spans: () => Array<{ start: number; end: number }> }> {
  const spans: Array<{ start: number; end: number }> = [];

  await page.route('**/profiles/languages', (route) =>
    route.fulfill(json({ profiles: [{ language: 'ES', proficiencyLevel: 'B1' }] })),
  );
  await page.route(/\/read\/entries(\?|$)/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill(
      json({
        entries: [
          {
            id: ENTRY_ID,
            title: 'Aldea passage',
            source: 'e2e fixture',
            preview: PASSAGE_TEXT.slice(0, 60),
            flaggedCount: 1,
            savedCount: 0,
            pastedAt: '2026-05-25T00:00:00.000Z',
          },
        ],
      }),
    );
  });
  await page.route(`**/read/entries/${ENTRY_ID}`, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill(
      json({
        id: ENTRY_ID,
        language: 'ES',
        title: 'Aldea passage',
        source: 'e2e fixture',
        text: PASSAGE_TEXT,
        flaggedWords: FLAGGED_WORDS,
        bank: [],
        pastedAt: '2026-05-25T00:00:00.000Z',
      }),
    );
  });
  await page.route('**/read/annotate-span', async (route) => {
    let body: { start?: number; end?: number } = {};
    try {
      body = route.request().postDataJSON() ?? {};
    } catch {
      body = {};
    }
    spans.push({ start: body.start ?? -1, end: body.end ?? -1 });
    const isPhrase = (body.end ?? 0) - (body.start ?? 0) > 6;
    return route.fulfill(json(isPhrase ? DEEP_PHRASE : DEEP_WORD));
  });

  return { spans: () => spans };
}

// Center of a locator in viewport coordinates.
async function center(loc: Locator): Promise<{ x: number; y: number }> {
  const box = await loc.boundingBox();
  if (!box) throw new Error('no bounding box');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

// Drive a genuine horizontal touch-drag from `from` to `to` via CDP.
async function touchDrag(cdp: CDPSession, from: Locator, to: Locator): Promise<void> {
  const a = await center(from);
  const b = await center(to);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: a.x, y: a.y }] });
  const steps = 6;
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', {
      type: 'touchMove',
      touchPoints: [{ x: a.x + ((b.x - a.x) * i) / steps, y: a.y + ((b.y - a.y) * i) / steps }],
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

test('mobile: a plain tap selects a single word (one call for the word span)', async ({ page }) => {
  const api = await mockReadApi(page);
  await page.goto('/read');
  const aldea = page.getByRole('button', { name: 'aldea' });
  await expect(aldea).toBeVisible({ timeout: 15_000 });

  await aldea.tap();

  await expect.poll(() => api.spans().length).toBeGreaterThanOrEqual(1);
  expect(api.spans()).toEqual([{ start: 3, end: 8 }]);
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
});

test('mobile: a horizontal drag selects a phrase before the card opens (one call, no obstruction)', async ({
  page,
}) => {
  const api = await mockReadApi(page);
  await page.goto('/read');
  const aldea = page.getByRole('button', { name: 'aldea' });
  const estaba = page.getByRole('button', { name: 'estaba' });
  await expect(aldea).toBeVisible({ timeout: 15_000 });

  const cdp = await page.context().newCDPSession(page);
  await touchDrag(cdp, aldea, estaba);

  // The card opens for the merged phrase span...
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
  await expect.poll(() => api.spans().length, { timeout: 5_000 }).toBeGreaterThanOrEqual(1);
  // ...and select-first means exactly ONE request — the phrase [3,15), with no
  // throwaway single-word [3,8) call (the failure mode of tap-first/tap-last).
  expect(api.spans()).toEqual([{ start: 3, end: 15 }]);
});
