import { expect, test, type Page, type Route } from '@playwright/test';

// ---------------------------------------------------------------------------
// Theory Library · happy-path E2E (Requirements 1.2, 2.1, 6.1, 6.2, 6.6)
// ---------------------------------------------------------------------------
// Drives the full library flow against Playwright `page.route()` mocks — no
// Lambda, no DB. The single scenario walks the canonical journey:
//   theory nav item → /theory list → open a topic → /theory/[topicId]
//   detail (title + sections + TOC) → back-to-library → /theory.
//
// The active language is forced to German (`DE`) via the mocked profile: DE has
// no static editorial topics, so the list and detail come entirely from these
// mocks (no static-content interference, fully deterministic).
// ---------------------------------------------------------------------------

const TOPIC_ID = 'der-konjunktiv-2';

// Enriched list item (GET /theory/DE). One topic keeps the grouped index
// unambiguous — a single "moods & conditionals" group with one row.
const LIST_TOPICS = [
  {
    id: TOPIC_ID,
    title: 'der konjunktiv II',
    cefr: 'B2',
    category: 'moods',
    order: 1,
  },
];

// Full topic body (GET /theory/DE/:topicId) — a valid TheoryTopicJson with two
// sections so the detail page renders sections + a multi-entry TOC.
const TOPIC_DETAIL = {
  id: TOPIC_ID,
  title: 'der konjunktiv II',
  subtitle: 'the German subjunctive II',
  cefr: 'B2',
  sections: [
    {
      id: 'overview',
      title: 'overview',
      body: [
        {
          kind: 'paragraph',
          text: [{ kind: 'text', text: 'Konjunktiv II expresses hypotheticals.' }],
        },
      ],
    },
    {
      id: 'formation',
      title: 'formation',
      body: [
        {
          kind: 'paragraph',
          text: [{ kind: 'text', text: 'Formed with würde plus the infinitive.' }],
        },
      ],
    },
  ],
};

// JSON-response shorthand for `route.fulfill` (mirrors read.spec.ts).
type FulfillOptions = Parameters<Route['fulfill']>[0];
function reply(body: unknown, status = 200): FulfillOptions {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

// Registers every API route the library flow may hit. `**/` globs match the
// front-end's API base regardless of host. The list glob (`/theory/DE`) and the
// detail glob (`/theory/DE/*`) are disjoint — only the detail URL carries a
// trailing segment — so registration order is irrelevant.
async function mockTheoryApi(page: Page): Promise<void> {
  await page.route('**/profiles/languages', (route) =>
    route.fulfill(reply({ profiles: [{ language: 'DE', proficiencyLevel: 'B1' }] })),
  );

  await page.route('**/theory/DE', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill(reply({ topics: LIST_TOPICS }));
  });

  await page.route('**/theory/DE/*', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill(reply(TOPIC_DETAIL));
  });
}

test('navigates from the nav item through the list to a topic detail and back (Req 1.2, 2.1, 6.1, 6.2, 6.6)', async ({
  page,
}) => {
  await mockTheoryApi(page);

  // Land on the dashboard, then reach the library via the "theory" nav item
  // (Req 1.2) — exact name so it doesn't match the detail page's
  // "← theory library" back link.
  await page.goto('/');
  await page.getByRole('link', { name: 'theory', exact: true }).click();

  // The index renders the active language's topics (Req 2.1).
  await expect(page).toHaveURL(/\/theory$/);
  const topicLink = page.getByRole('link', { name: /der konjunktiv II/i });
  await expect(topicLink).toBeVisible({ timeout: 15_000 });

  // Open the topic → deep-linkable detail route (Req 6.1).
  await topicLink.click();
  await expect(page).toHaveURL(new RegExp(`/theory/${TOPIC_ID}$`));

  // Detail renders the title, the section content, and the section TOC (Req 6.2).
  await expect(
    page.getByRole('heading', { level: 1, name: /der konjunktiv II/i }),
  ).toBeVisible();
  await expect(
    page.getByText(/Konjunktiv II expresses hypotheticals\./i),
  ).toBeVisible();
  const toc = page.getByRole('navigation', { name: /theory sections/i });
  await expect(toc).toBeVisible();
  await expect(toc.getByRole('button', { name: 'overview' })).toBeVisible();
  await expect(toc.getByRole('button', { name: 'formation' })).toBeVisible();

  // Back-to-library returns to the index (Req 6.6). The header back link's name
  // contains "theory library"; the footer CTA reads "back to library" — either
  // returns to /theory, but the header link is always in view.
  await page.getByRole('link', { name: /theory library/i }).click();
  await expect(page).toHaveURL(/\/theory$/);
  await expect(
    page.getByRole('link', { name: /der konjunktiv II/i }),
  ).toBeVisible();
});
