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

// ---------------------------------------------------------------------------
// SSE helpers — the deep endpoint now streams (Req 1.1).
// ---------------------------------------------------------------------------
// The deep card is served over Server-Sent Events: each top-level field is
// emitted as a `field` frame, then a terminal `done` frame carries the full
// validated card (matching the server's `event: <type>\ndata: <json>\n\n`
// framing in `infra/lambda/src/annotate-stream/sse.ts`). The client
// (`useReadAnnotateSpanStream` → `fetchSse`) consumes it.
//
// NOTE on observing "a field before done": Playwright's `route.fulfill`
// delivers the whole body atomically (no chunked flush), so the browser reads
// the field + done frames in one network read and the client paints the final
// card in a single React batch — the deep card's OWN per-field preview never
// gets an intermediate paint here. That progressive paint is covered by the
// unit/component suite (`word-popover.test.tsx` DeepCardPartial,
// `page.test.tsx`). What this suite reliably observes is the SKIM field shown
// while the deep card streams (a flagged word's gloss is visible before the
// deep `done` lands), plus the final card's correctness over the real SSE wire.
function sseFrame(type: string, payload: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`;
}

// field-per-key → terminal `done` carrying the full card.
function sseCardBody(card: Record<string, unknown>): string {
  const fields = Object.entries(card)
    .map(([key, value]) => sseFrame('field', { key, value }))
    .join('');
  return fields + sseFrame('done', { card });
}

// 200 `text/event-stream` reply (the wire the client requires; `fetchSse`
// rejects a 200 that isn't `text/event-stream`).
const sseReply = (body: string): FulfillOptions => ({
  status: 200,
  contentType: 'text/event-stream',
  body,
});

// A terminal `error` frame (mid-stream failure path, Req 1.5) — still a 200
// SSE response, the failure is carried in-band.
const sseErrorReply = (
  code = 'AI_UNAVAILABLE',
  message = 'temporarily unavailable',
): FulfillOptions => sseReply(sseFrame('error', { code, message }));

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
      return route.fulfill(sseErrorReply());
    }
    return route.fulfill(
      sseReply(
        sseCardBody(
          (opts.deepResponse ?? DEEP_WORD) as Record<string, unknown>,
        ),
      ),
    );
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
// 1b. Progressive: a field is visible BEFORE the streamed `done` lands, then
//     the deep card swaps in (Req 1.1, 1.2, 1.3). For a flagged word the skim
//     card (with its gloss) renders instantly and stays up — with the "looking
//     it up…" indicator — while the deep stream is in flight; the deep `done`
//     then replaces it. This is the reliably-observable "field before done" in
//     E2E (the deep card's own per-field preview is unit-tested — see the SSE
//     helper note above).
// ---------------------------------------------------------------------------
test('a field is visible before the streamed done, then the deep card swaps in (Req 1.2, 1.3)', async ({
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

  // Tap the flagged word: the skim field is visible immediately, before the
  // deep stream has produced anything.
  await page.getByRole('button', { name: 'aldea' }).click();
  await expect(page.getByText('small village')).toBeVisible();
  await expect(page.getByTestId('skim-loading-deep')).toBeVisible();
  // The deep card has NOT resolved yet (its `done` is gated).
  await expect(page.getByText('pueblo pequeño')).toHaveCount(0);

  // Release the gated SSE response → the terminal `done` card swaps in.
  release();
  await expect(page.getByText('pueblo pequeño')).toBeVisible();
  await expect(page.getByTestId('skim-loading-deep')).toHaveCount(0);
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
      // Mid-stream failure carried as a terminal `error` SSE frame (Req 1.5).
      return route.fulfill(sseErrorReply());
    }
    return route.fulfill(sseReply(sseCardBody(DEEP_WORD)));
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
