import { expect, test, type Page, type Route } from '@playwright/test';

// ---------------------------------------------------------------------------
// Vocabulary Review E2E (Part 2 — Req 4, 10, 11, 12, 13)
// ---------------------------------------------------------------------------
// Mocks the `/review/*` API surface with Playwright `page.route()` so the
// reducer-driven session, summary, bank, and the cross-feature reading
// highlight can be exercised deterministically — no Lambda / Neon dependency.
// The mocks pin the wire contract the front-end depends on; server behaviour is
// covered by `infra/lambda` route tests and the unit suite (`*.test.tsx` mock
// the same hooks). Grading is local + free, so no usage/metering is asserted.
// ---------------------------------------------------------------------------

const SESSION_ID = '11111111-1111-1111-1111-111111111111';
const ENTRY_ID = '22222222-2222-2222-2222-222222222222';
const LEECH_STATE_ID = '33333333-3333-3333-3333-333333333333';

// Three queued items — one of each local type — so a full session walks
// cloze → meaning → recognition.
const CLOZE_ITEM = {
  stateId: 'aaaaaaaa-0000-0000-0000-000000000001',
  lemma: 'casa',
  language: 'ES',
  itemType: 'cloze' as const,
  gloss: 'house',
  pos: 'noun',
  cefr: 'A1',
  freqRank: 120,
  occurrence: {
    surface: 'casas',
    sentence: 'Hay muchas casas aquí.',
    translation: 'There are many houses here.',
    source: 'e2e fixture',
    contextualSense: 'houses',
    grammarPoints: ['plural'],
  },
};

const MEANING_ITEM = {
  stateId: 'aaaaaaaa-0000-0000-0000-000000000002',
  lemma: 'apenas',
  language: 'ES',
  itemType: 'meaning' as const,
  gloss: 'barely',
  pos: 'adverb',
  cefr: 'B1',
  freqRank: 1840,
  occurrence: null,
};

const RECOGNITION_ITEM = {
  stateId: 'aaaaaaaa-0000-0000-0000-000000000003',
  lemma: 'imprescindible',
  language: 'ES',
  itemType: 'recognition' as const,
  gloss: 'essential',
  pos: 'adjective',
  cefr: 'B2',
  freqRank: 4200,
  occurrence: null,
};

const OVERVIEW = {
  breakdown: {
    due: 3,
    new: 1,
    leech: 1,
    total: 3,
    mix: { cloze: 1, meaning: 1, recognition: 1 },
  },
  estimatedMinutes: 4,
  nextDueAt: null,
};

const SUMMARY = {
  total: 3,
  correct: 3,
  partial: 0,
  missed: 0,
  promoted: ['casa'],
  lapsed: [],
  newCards: 1,
  items: [
    { lemma: 'casa', surface: 'casas', itemType: 'cloze', outcome: 'correct' },
    { lemma: 'apenas', surface: null, itemType: 'meaning', outcome: 'correct' },
    { lemma: 'imprescindible', surface: null, itemType: 'recognition', outcome: 'correct' },
  ],
  grammarDeltas: [{ grammarPoint: 'plural', from: 0.5, to: 0.62 }],
  nextDueAt: '2999-01-01T00:00:00.000Z',
  durationSeconds: 142,
};

const BANK_ROWS = [
  {
    stateId: 'bbbbbbbb-0000-0000-0000-000000000001',
    lemma: 'casa',
    gloss: 'house',
    pos: 'noun',
    cefr: 'A1',
    status: 'mature',
    stability: 22.5,
    dueAt: '2999-01-01T00:00:00.000Z',
  },
  {
    stateId: LEECH_STATE_ID,
    lemma: 'imprescindible',
    gloss: 'essential',
    pos: 'adjective',
    cefr: 'B2',
    status: 'leech',
    stability: 0.6,
    dueAt: '2000-01-01T00:00:00.000Z',
  },
];

const WORD_DETAIL = {
  stateId: LEECH_STATE_ID,
  lemma: 'imprescindible',
  language: 'ES',
  gloss: 'essential',
  pos: 'adjective',
  cefr: 'B2',
  freqRank: 4200,
  isPhrase: false,
  deepCard: null,
  occurrences: [],
  fsrs: {
    stability: 0.6,
    difficulty: 8.2,
    reps: 5,
    lapses: 3,
    state: 'leech',
    dueAt: '2000-01-01T00:00:00.000Z',
    lastReviewedAt: '2026-05-01T00:00:00.000Z',
    nextIntervalDays: 1,
  },
  grammarPoints: [],
  history: [],
};

// Reading fixture — one flagged word whose lemma is in the review rotation.
const PASSAGE_TEXT = 'Hay muchas casas aquí.';
const FLAGGED_WORDS = {
  casas: { lemma: 'casa', pos: 'noun', gloss: 'house', freq: 120, cefr: 'A1' as const },
};

type FulfillOptions = Parameters<Route['fulfill']>[0];
function reply(body: unknown, status = 200): FulfillOptions {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

type ReviewMockOptions = {
  overview?: typeof OVERVIEW;
  items?: Array<Record<string, unknown>>;
  bankRows?: Array<Record<string, unknown>>;
  activeLemmas?: { lemmas: string[]; surfaces: string[] };
  /** Seed the read surface so the highlight test can open a passage. */
  withRead?: boolean;
};

// Captured request payloads for assertions.
type Captured = {
  sessionFilters: unknown[];
  submitBodies: unknown[];
  patchActions: unknown[];
};

async function mockReviewApi(
  page: Page,
  opts: ReviewMockOptions = {},
): Promise<Captured> {
  const captured: Captured = { sessionFilters: [], submitBodies: [], patchActions: [] };
  const items = opts.items ?? [CLOZE_ITEM, MEANING_ITEM, RECOGNITION_ITEM];
  const bankRows = opts.bankRows ?? BANK_ROWS;

  await page.route('**/language-profiles', (route) =>
    route.fulfill(reply({ profiles: [{ language: 'ES', proficiencyLevel: 'B1' }] })),
  );

  // GET /review/overview (hub + nav due badge).
  await page.route('**/review/overview**', (route) =>
    route.fulfill(reply(opts.overview ?? OVERVIEW)),
  );

  // POST /review/sessions — capture the filter, return the queue.
  await page.route('**/review/sessions', (route) => {
    if (route.request().method() !== 'POST') return route.fallback();
    try {
      captured.sessionFilters.push(route.request().postDataJSON()?.filter);
    } catch {
      captured.sessionFilters.push(undefined);
    }
    return route.fulfill(reply({ sessionId: SESSION_ID, items }));
  });

  // GET /review/sessions/:id/summary.
  await page.route('**/review/sessions/*/summary', (route) =>
    route.fulfill(reply(SUMMARY)),
  );

  // POST /review/items/:stateId/submit — always a clean local grade.
  await page.route('**/review/items/*/submit', (route) => {
    const body = (() => {
      try {
        return route.request().postDataJSON();
      } catch {
        return null;
      }
    })();
    captured.submitBodies.push(body);
    return route.fulfill(
      reply({
        outcome: 'correct',
        correctAnswer: body?.answer || 'casas',
        schedulerDelta: {
          intervalFrom: 0,
          intervalTo: 4,
          stabilityFrom: 2,
          stabilityTo: 7,
          stateFrom: 'learning',
          stateTo: 'mature',
        },
        masteryDeltas: [{ grammarPoint: 'plural', from: 0.5, to: 0.62 }],
      }),
    );
  });

  // GET /review/bank?language=&status=&q= — honour the status filter.
  await page.route('**/review/bank**', (route) => {
    const url = new URL(route.request().url());
    const status = url.searchParams.get('status');
    const rows = status ? bankRows.filter((r) => r.status === status) : bankRows;
    return route.fulfill(reply({ rows }));
  });

  // GET /review/words/:id (detail) + PATCH (actions).
  await page.route('**/review/words/*', (route) => {
    const method = route.request().method();
    if (method === 'PATCH') {
      let action: unknown;
      try {
        action = route.request().postDataJSON()?.action;
      } catch {
        action = undefined;
      }
      captured.patchActions.push(action);
      return route.fulfill(
        reply({ stateId: LEECH_STATE_ID, status: 'suspended', dueAt: WORD_DETAIL.fsrs.dueAt }),
      );
    }
    if (method === 'GET') return route.fulfill(reply(WORD_DETAIL));
    return route.fallback();
  });

  // GET /review/active-lemmas (reading highlight source).
  await page.route('**/review/active-lemmas**', (route) =>
    route.fulfill(reply(opts.activeLemmas ?? { lemmas: [], surfaces: [] })),
  );

  if (opts.withRead) {
    await page.route('**/read/entries', (route) => {
      if (route.request().method() !== 'GET') return route.fallback();
      return route.fulfill(
        reply({
          entries: [
            {
              id: ENTRY_ID,
              title: 'Casas passage',
              source: 'e2e fixture',
              preview: PASSAGE_TEXT,
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
          title: 'Casas passage',
          source: 'e2e fixture',
          text: PASSAGE_TEXT,
          flaggedWords: FLAGGED_WORDS,
          bank: [],
          pastedAt: '2026-05-25T00:00:00.000Z',
        }),
      );
    });
  }

  return captured;
}

// ---------------------------------------------------------------------------
// 1. Hub — per-language due counts + start, no streak/XP (Req 4.2, 10.1)
// ---------------------------------------------------------------------------
test('hub shows the per-language queue breakdown and a start CTA (Req 4.2)', async ({
  page,
}) => {
  await mockReviewApi(page);
  await page.goto('/review');

  await expect(page.getByText('time to review.')).toBeVisible({ timeout: 15_000 });
  // Per-language label + the three queue stats.
  await expect(page.getByText(/spaced review · español/i)).toBeVisible();
  await expect(page.getByText('due reviews')).toBeVisible();
  await expect(page.getByText('new intake')).toBeVisible();
  await expect(page.getByText('leech rescue')).toBeVisible();
  // Start CTA carries the total; no gamification copy anywhere.
  await expect(page.getByRole('link', { name: /start review/i })).toBeVisible();
  await expect(page.getByText(/streak/i)).toHaveCount(0);
  await expect(page.getByText(/\bXP\b/)).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// 2. Full session: cloze → meaning → recognition, feedback + "what moved",
//    keyboard advance, burndown, lands on the summary (Req 10.1–10.3, 11.4)
// ---------------------------------------------------------------------------
test('a full session walks all three item types to the summary (Req 10.1, 10.2, 10.3, 11.4)', async ({
  page,
}) => {
  await mockReviewApi(page);
  await page.goto('/review/session');

  // Item 1 — cloze. Burndown reads 1 of 3.
  await expect(page.getByText('type the form that fits.')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/item 1 of 3/i)).toBeVisible();
  await page.getByLabel('cloze answer').fill('casas');
  await page.getByRole('button', { name: /check/i }).click();

  // Inline feedback before advancing, with the scheduler delta + "what moved".
  await expect(page.getByText('correct.')).toBeVisible();
  await expect(page.getByText(/also moved/i)).toBeVisible();

  // Keyboard advance (Enter) → item 2 (meaning).
  await page.keyboard.press('Enter');
  await expect(page.getByText("what's the word that means…")).toBeVisible();
  await expect(page.getByText(/item 2 of 3/i)).toBeVisible();
  await page.getByLabel('meaning answer').fill('apenas');
  await page.getByRole('button', { name: /check/i }).click();
  await expect(page.getByText('correct.')).toBeVisible();
  await page.getByRole('button', { name: /next item/i }).click();

  // Item 3 — recognition.
  await expect(page.getByText('which meaning fits?')).toBeVisible();
  await expect(page.getByText(/item 3 of 3/i)).toBeVisible();
  await page.getByRole('radio', { name: 'essential' }).click();
  await page.getByRole('button', { name: /check/i }).click();
  await expect(page.getByText('correct.')).toBeVisible();

  // Last item → "finish" routes to the summary.
  await page.getByRole('button', { name: /finish/i }).click();
  await expect(page).toHaveURL(new RegExp(`/review/summary/${SESSION_ID}`));
  await expect(page.getByText('3 of 3 clean.')).toBeVisible();
  // No gamification on the debrief.
  await expect(page.getByText(/streak/i)).toHaveCount(0);
  await expect(page.getByText(/great job/i)).toHaveCount(0);
});

// ---------------------------------------------------------------------------
// 3. Review-from-passage builds a passage-scoped queue (Req 13.1)
// ---------------------------------------------------------------------------
test('a ?readEntryId session is started with a passage filter (Req 13.1)', async ({
  page,
}) => {
  const captured = await mockReviewApi(page);
  await page.goto(`/review/session?readEntryId=${ENTRY_ID}`);

  await expect(page.getByText('type the form that fits.')).toBeVisible({ timeout: 15_000 });
  expect(captured.sessionFilters).toContainEqual({ readEntryId: ENTRY_ID });
});

// ---------------------------------------------------------------------------
// 4. Bank: leech filter surfaces the lapsed word; suspend from detail (Req 12.5, 12.6)
// ---------------------------------------------------------------------------
test('the bank leech filter surfaces leeches and a word can be suspended (Req 12.5, 12.6)', async ({
  page,
}) => {
  const captured = await mockReviewApi(page);
  await page.goto('/review/bank');

  await expect(page.getByText('your words.')).toBeVisible({ timeout: 15_000 });

  // Filter to leeches → only the lapsed word remains, with the rescue banner.
  await page.getByRole('button', { name: 'leeches' }).click();
  await expect(page.getByText(/have lapsed ≥ 3 times/i)).toBeVisible();
  await expect(page.getByText('imprescindible')).toBeVisible();

  // Open the detail and suspend it.
  await page.getByText('imprescindible').click();
  await expect(page).toHaveURL(new RegExp(`/review/bank/${LEECH_STATE_ID}`));
  await page.getByRole('button', { name: 'suspend' }).click();
  expect(captured.patchActions).toContain('suspend');
});

// ---------------------------------------------------------------------------
// 5. Reading surface renders the distinct under-review highlight (Req 13.2)
// ---------------------------------------------------------------------------
test('a word in the review rotation gets the under-review highlight in Reading (Req 13.2)', async ({
  page,
}) => {
  await mockReviewApi(page, {
    withRead: true,
    activeLemmas: { lemmas: ['casa'], surfaces: ['casas'] },
  });
  await page.goto('/read');

  const word = page.getByRole('button', { name: 'casas' });
  await expect(word).toBeVisible({ timeout: 15_000 });
  // The CSS-module `.underReview` class (readable in `next dev`) is applied.
  await expect(word).toHaveClass(/underReview/);
});
