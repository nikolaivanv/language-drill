import { expect, test, type Page, type Route } from '@playwright/test';

// ---------------------------------------------------------------------------
// Read · deep annotation E2E (Reading Part 1 — Req 3, 4, 5, 8, 9, 11)
// ---------------------------------------------------------------------------
// This suite mocks the Read API surface with Playwright `page.route()` so the
// deep-annotation flow can be exercised deterministically — no Sonnet calls,
// no Lambda dependency. The mocks pin the wire contract the front-end depends
// on; integration with the real API is covered by `infra/lambda` route tests
// and the unit suite (`page.test.tsx` mocks the same hooks).
//
// All scenarios open a single seeded History entry (one flagged word, one
// passage with two sentences) and drive the chrome from there. The deep
// endpoint is mocked per-test so each scenario can return a word card, a
// phrase card, a sentence card, a delayed/skeleton response, or an error.
// ---------------------------------------------------------------------------

const ENTRY_ID = '11111111-1111-1111-1111-111111111111';
const VOCAB_ID = '99999999-9999-9999-9999-999999999999';

// Offsets (0-based, inclusive start, exclusive end) in PASSAGE_TEXT:
//   "aldea"      [3, 8)      — single flagged word
//   "tranquila"  [16, 25)    — single unflagged word
//   "aldea estaba" [3, 15)   — multi-word phrase (not a sentence)
//   Sentence 1   [0, 26)     — "La aldea estaba tranquila."
const PASSAGE_TEXT = 'La aldea estaba tranquila. echar de menos.';

const FLAGGED_WORDS = {
  aldea: {
    lemma: 'aldea',
    pos: 'noun',
    gloss: 'small village',
    freq: 4321,
    cefr: 'B2' as const,
  },
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
  idiomaticMeaning: 'the village was (set up like a fixed expression in the test)',
  register: 'neutral',
};

const DEEP_SENTENCE = {
  type: 'sentence' as const,
  surface: 'La aldea estaba tranquila.',
  translation: 'The village was quiet.',
  breakdown: [
    { chunk: 'La aldea', role: 'subject', note: 'definite noun phrase' },
    { chunk: 'estaba tranquila', role: 'predicate', note: 'imperfect copula + adjective' },
  ],
  grammarNotes: ['imperfect for past states'],
};

// JSON-response shorthand for `route.fulfill`.
function json(body: unknown, status = 200) {
  return {
    status,
    contentType: 'application/json',
    body: JSON.stringify(body),
  };
}

// `route.fulfill` typing wants a status:number; ensure the helper conforms.
type FulfillOptions = Parameters<Route['fulfill']>[0];
const reply = (body: unknown, status = 200): FulfillOptions =>
  json(body, status);

type MockOptions = {
  /** Pre-seed the entry's persisted deep cards (Req 11.3). */
  spanAnnotations?: Record<string, unknown>;
  /** Body returned by `POST /read/annotate-span` (defaults to DEEP_WORD). */
  deepResponse?: unknown;
  /** When true, the deep endpoint returns 502 AI_UNAVAILABLE on every call. */
  deepFail?: boolean;
  /** Gate that holds the deep response until the test calls `release()`. */
  deepGate?: { wait: Promise<void> };
};

// ---------------------------------------------------------------------------
// `mockReadApi` — registers all Read API routes the page may hit.
// Returns a tracker so tests can assert how many times the deep endpoint
// fired (Req 11.4: a persisted span is served from cache, no extra call).
// ---------------------------------------------------------------------------
async function mockReadApi(
  page: Page,
  opts: MockOptions = {},
): Promise<{ deepCallCount: () => number }> {
  let deepCalls = 0;

  await page.route('**/profiles/languages', (route) =>
    route.fulfill(
      reply({ profiles: [{ language: 'ES', proficiencyLevel: 'B1' }] }),
    ),
  );

  await page.route(/\/read\/entries(\?|$)/, (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill(
      reply({
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
      reply({
        id: ENTRY_ID,
        language: 'ES',
        title: 'Aldea passage',
        source: 'e2e fixture',
        text: PASSAGE_TEXT,
        flaggedWords: FLAGGED_WORDS,
        bank: [],
        ...(opts.spanAnnotations
          ? { spanAnnotations: opts.spanAnnotations }
          : {}),
        pastedAt: '2026-05-25T00:00:00.000Z',
      }),
    );
  });

  await page.route('**/read/annotate-span', async (route) => {
    deepCalls += 1;
    if (opts.deepGate) await opts.deepGate.wait;
    if (opts.deepFail) {
      return route.fulfill(
        reply(
          { error: 'temporarily unavailable', code: 'AI_UNAVAILABLE' },
          502,
        ),
      );
    }
    return route.fulfill(reply(opts.deepResponse ?? DEEP_WORD));
  });

  await page.route('**/read/vocabulary', (route) => {
    if (route.request().method() === 'POST') {
      return route.fulfill(reply({ id: VOCAB_ID }));
    }
    return route.fallback();
  });

  await page.route(`**/read/vocabulary/${VOCAB_ID}`, (route) =>
    route.fulfill(reply({ id: VOCAB_ID })),
  );

  return { deepCallCount: () => deepCalls };
}

// Wait until the seeded passage is in the DOM — the entry query has settled
// and `AnnotatedView` mounted, so we can drive interactions safely.
async function openSeededEntry(page: Page): Promise<void> {
  await page.goto('/read');
  await expect(
    page.getByRole('button', { name: 'aldea' }),
  ).toBeVisible({ timeout: 15_000 });
}

// ---------------------------------------------------------------------------
// 1. Cold tap on an unflagged word: skeleton appears, then the deep card swaps
//    in without remounting the chrome (Req 3.2, 3.3, 9.3).
// ---------------------------------------------------------------------------
test('cold tap on an unflagged word renders the skeleton, then the deep card (Req 3.2, 9.3)', async ({
  page,
}) => {
  let release!: () => void;
  const gate = {
    wait: new Promise<void>((resolve) => {
      release = resolve;
    }),
  };
  await mockReadApi(page, { deepGate: gate });
  await openSeededEntry(page);

  // 'tranquila' is unflagged — there is no skim card to fall back to during
  // load, so the chrome opens with the "looking it up" skeleton.
  await page.getByRole('button', { name: 'tranquila' }).click();
  await expect(page.getByTestId('deep-card-skeleton')).toBeVisible();

  // Release the deep response and confirm the card swaps in in-place.
  release();
  await expect(page.getByText('pueblo pequeño')).toBeVisible();
  await expect(page.getByTestId('deep-card-skeleton')).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// 2. A persisted span served from cache — no extra deep-endpoint call
//    (Req 11.3 + 11.4).
// ---------------------------------------------------------------------------
test('a span persisted on the entry renders instantly, bypassing the endpoint (Req 11.3, 11.4)', async ({
  page,
}) => {
  // 'aldea' lives at [3,8). Seeding the entry's `spanAnnotations` makes the
  // tap a pure cache hit.
  const tracker = await mockReadApi(page, {
    spanAnnotations: { '3:8': DEEP_WORD },
  });
  await openSeededEntry(page);

  await page.getByRole('button', { name: 'aldea' }).click();
  await expect(page.getByText('pueblo pequeño')).toBeVisible();
  expect(tracker.deepCallCount()).toBe(0);
});

// ---------------------------------------------------------------------------
// 3. Save a word → toast + footer flip + undo from the toast (Req 8.4, 8.5).
// ---------------------------------------------------------------------------
test('saving a word card raises the toast, flips the footer, and undoes from the toast (Req 8.4, 8.5)', async ({
  page,
}) => {
  await mockReadApi(page);
  await openSeededEntry(page);

  // Tap → deep word card resolves.
  await page.getByRole('button', { name: 'aldea' }).click();
  await expect(page.getByText('pueblo pequeño')).toBeVisible();

  // Save → confirmation toast + footer flips to the saved state.
  await page
    .getByRole('button', { name: /\+ save to vocabulary/i })
    .click();
  // A word-card save persists to BOTH vocabulary and the passage word bank, so
  // two toasts share role="status" (VocabSaveToast + the entry SaveToast).
  // Scope to the vocabulary confirmation so the locator stays unambiguous.
  const toast = page.getByRole('status').filter({ hasText: /saved.*to vocabulary/i });
  await expect(toast).toBeVisible();
  await expect(
    page.getByRole('button', { name: /✓ saved · undo/i }),
  ).toBeVisible();

  // Undo from the toast → footer reverts to "save", toast goes away.
  await page.getByRole('button', { name: /^undo$/i }).click();
  await expect(toast).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: /\+ save to vocabulary/i }),
  ).toBeVisible();
});

// ---------------------------------------------------------------------------
// 3b. Saving an ON-DEMAND (non-flagged) word adds it to the word-bank panel.
//     This is the case the old bank-only rail dropped: the bank is flagged-only,
//     so an on-demand save never showed there. The panel is now driven by the
//     entry's saved vocabulary, so it appears (and ✕ unsaves it).
// ---------------------------------------------------------------------------
test('an on-demand (non-flagged) save appears in the word-bank panel and ✕ removes it', async ({
  page,
}) => {
  // Deep card for the UNFLAGGED word "tranquila" — so the save is a pure vocab
  // save (not a bank add), exactly the on-demand case that used to vanish.
  await mockReadApi(page, {
    deepResponse: {
      type: 'word',
      surface: 'tranquila',
      lemma: 'tranquila',
      pos: 'adjective',
      contextualSense: 'calm, quiet',
      definition: 'tranquilo/a',
      definitionLabel: 'Español',
      cefr: 'B1',
      freq: 2000,
    },
  });
  await openSeededEntry(page);

  // The panel starts empty — nothing saved from this passage yet.
  const rail = page.getByRole('complementary');
  await expect(rail.getByText(/tap a word to see its meaning/i)).toBeVisible();

  // Tap the UNFLAGGED word ("tranquila") and save its deep card.
  await page.getByRole('button', { name: 'tranquila' }).click();
  await expect(page.getByText('tranquilo/a')).toBeVisible();
  await page.getByRole('button', { name: /\+ save to vocabulary/i }).click();

  // It now shows in the panel — the reported bug (on-demand saves were dropped).
  await expect(rail.getByRole('listitem')).toHaveCount(1);
  await expect(rail.getByRole('listitem').first()).toContainText('tranquila');

  // ✕ unsaves it → the row leaves the panel, back to the empty state.
  await rail.getByRole('button', { name: /remove tranquila/i }).click();
  await expect(rail.getByRole('listitem')).toHaveCount(0);
  await expect(rail.getByText(/tap a word to see its meaning/i)).toBeVisible();
});

// ---------------------------------------------------------------------------
// 4. A sentence card carries no save action (Req 5.4) — exercised by
//    drag-selecting the first sentence end-to-end.
// ---------------------------------------------------------------------------
test('a sentence drag-select renders a sentence card with no save action (Req 5.1, 5.4)', async ({
  page,
}) => {
  await mockReadApi(page, { deepResponse: DEEP_SENTENCE });
  await openSeededEntry(page);

  // Drag from "La" to "tranquila" — together they cover the first sentence
  // [0,25), which the client's `resolveSpanType` maps to `sentence`. The word
  // renders capitalized at the sentence start; `exact: true` (case-sensitive)
  // pins it to "La" and keeps it from matching "tranquila" (substring "la").
  const first = page.getByRole('button', { name: 'La', exact: true });
  const last = page.getByRole('button', { name: 'tranquila' });
  await first.hover();
  await page.mouse.down();
  await last.hover();
  await page.mouse.up();

  // The sentence card rendered — translation visible, no save button.
  await expect(page.getByText('The village was quiet.')).toBeVisible();
  await expect(
    page.getByRole('button', { name: /save/i }),
  ).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// 5. Drag-select a multi-word span shorter than a sentence → phrase card
//    (Req 4.1).
// ---------------------------------------------------------------------------
test('drag-selecting a multi-word span renders a phrase card (Req 4.1)', async ({
  page,
}) => {
  await mockReadApi(page, { deepResponse: DEEP_PHRASE });
  await openSeededEntry(page);

  // "aldea estaba" spans [3,15) — multi-word but not a full sentence range,
  // so `resolveSpanType` → 'phrase'.
  const start = page.getByRole('button', { name: 'aldea' });
  const end = page.getByRole('button', { name: 'estaba' });
  await start.hover();
  await page.mouse.down();
  await end.hover();
  await page.mouse.up();

  await expect(page.getByText(DEEP_PHRASE.idiomaticMeaning)).toBeVisible();
});

// ---------------------------------------------------------------------------
// 6. Deep failure shows the inline error + retry; retry fires a second call
//    (Req 9.4).
// ---------------------------------------------------------------------------
test('a failed deep call shows the inline error, retry fires another call (Req 9.4)', async ({
  page,
}) => {
  // First mock: fail on every call. We swap to a success mock just before
  // clicking "try again" so the retry resolves into a loaded card.
  let shouldFail = true;
  let calls = 0;
  await page.route('**/profiles/languages', (route) =>
    route.fulfill(
      reply({ profiles: [{ language: 'ES', proficiencyLevel: 'B1' }] }),
    ),
  );
  await page.route(/\/read\/entries(\?|$)/, (route) =>
    route.fulfill(
      reply({
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
    ),
  );
  await page.route(`**/read/entries/${ENTRY_ID}`, (route) =>
    route.fulfill(
      reply({
        id: ENTRY_ID,
        language: 'ES',
        title: 'Aldea passage',
        source: 'e2e fixture',
        text: PASSAGE_TEXT,
        flaggedWords: FLAGGED_WORDS,
        bank: [],
        pastedAt: '2026-05-25T00:00:00.000Z',
      }),
    ),
  );
  await page.route('**/read/annotate-span', async (route) => {
    calls += 1;
    if (shouldFail) {
      return route.fulfill(
        reply(
          { error: 'temporarily unavailable', code: 'AI_UNAVAILABLE' },
          502,
        ),
      );
    }
    return route.fulfill(reply(DEEP_WORD));
  });

  await openSeededEntry(page);
  await page.getByRole('button', { name: 'aldea' }).click();

  // Inline error + retry visible.
  await expect(page.getByTestId('deep-card-error')).toBeVisible();
  expect(calls).toBe(1);

  shouldFail = false;
  await page.getByRole('button', { name: /try again/i }).click();
  await expect(page.getByText('pueblo pequeño')).toBeVisible();
  expect(calls).toBe(2);
});

// ---------------------------------------------------------------------------
// 7. Escape dismisses the open card (Req 9.6).
// ---------------------------------------------------------------------------
test('Escape dismisses the open deep card (Req 9.6)', async ({ page }) => {
  await mockReadApi(page);
  await openSeededEntry(page);

  await page.getByRole('button', { name: 'aldea' }).click();
  await expect(page.getByText('pueblo pequeño')).toBeVisible();

  // The desktop popover handles Escape via a *local* onKeyDown, and opening by
  // mouse leaves focus on the word in the passage (the popover isn't
  // auto-focused). So drive the keyboard-dismiss path the way a keyboard user
  // would: with focus inside the card. The in-card "skip" control is a stable
  // focus target — pressing Escape there bubbles to the popover's handler.
  await page.getByRole('button', { name: 'skip' }).press('Escape');
  await expect(page.getByText('pueblo pequeño')).toHaveCount(0);
});
