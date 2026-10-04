# Public Theory Pages — Design

**Status:** approved design, pre-implementation
**Date:** 2026-10-04
**Prototype:** Claude Design project `d676e7c3-d8fe-495f-a250-94c38e174fbd`
(`Public Pages - Overview.html`, `Public - Theory Index.html`, `Public - Theory Topic.html`)

---

## Problem

The theory library is the largest body of content the product owns — 312 approved
topics, ~1,000+ words each — and every page of it sits behind Clerk. A crawler
reaching `/theory/a2-ser-vs-estar` gets a 307 to sign-in. The public surface
shipped in #740–#749 is seven URLs: a home landing, three language landings, a
drill, and two marketing pages. There is a funnel with no top.

There is also a latent bug in the authenticated surface worth recording here even
though this design does not fix it: `topic_id` is **not unique across languages**
(`a1-numbers-ordinals` exists in all three; 10 ids collide in total), and
`/theory/[topicId]` resolves against the signed-in reader's *active language*. A
shared `/theory/a1-negation` link therefore shows German to one reader and Turkish
to another. Any public URL must carry the language.

## Goal

Make the theory corpus indexable, and make each page a working entry point into
the product rather than a dead end. Success is measured by indexed page count and
organic entries, not by a visual match to the prototype.

## Measured scope (production, 2026-10-03)

| | ES | DE | TR | total |
|---|---|---|---|---|
| Approved topics | 119 | 104 | 89 | **312** |
| …`manual-approved` of those | 1 | 1 | 2 | 4 |
| Mean `content_json` size | 9.7k | 10.4k | 10.5k | ~10k chars |
| Mean validator `quality_score` | 0.926 | 0.920 | 0.904 | |
| Scored below 0.80 | 0 | 1 | 5 | **6** |
| Topics with approved **conjugation** rows | 12 | 10 | 16 | **38** |
| Topics with approved exercises of *any* type | 119 | 104 | 89 | **312** (mean ~76 rows) |
| Topics with **no** cloze rows | 2 | 8 | 30 | **40** |
| Topics with ≥3 **option-free** cloze rows | 92 | 68 | 55 | **215** |

Rows are 1:1 with `(language, topic_id)` — no duplicate approved rows to
disambiguate. Zero corrupt rows (every approved row has `title` and `cefr`).
`topic_id` stems are unique *within* a language once the CEFR prefix is stripped,
but nothing enforces that.

## Decisions

1. **URL shape: `/spanish/grammar/<topic-id>`**, hub at `/spanish/grammar`, and the
   same for `/german` and `/turkish`. This **overrides the prototype's `/es/grammar/…`**.
   Three reasons: `/spanish`, `/german` and `/turkish` shipped in #748 and are in
   the sitemap, so moving to `/es/` discards accrued indexing and needs permanent
   redirects; "spanish" is the term people search and "es" is not; and nesting under
   the live landings gives the hub-and-spoke internal link graph the landings
   currently lack.
2. **The URL slug is the raw `theory_topics.topic_id`**, CEFR prefix included
   (`/spanish/grammar/a2-ser-vs-estar`). This overrides the prototype's prefix-free
   `preterite-vs-imperfect`. Stripping the prefix works today but relies on an
   unenforced uniqueness; if clean slugs are wanted later, add a `slug` column with
   a unique constraint rather than deriving one.
3. **All 312 approved topics are published**, including the 308 that are
   `auto-approved` and have never been read by a human, and the 6 scored below 0.80.
4. **The authenticated `/theory/*` surface is untouched.** Crawlers cannot see it
   (Clerk 307s it), so there is no duplicate-content problem to solve, and the
   in-app reader keeps its shell, in-place topic switching and authenticated
   drill block. `robots.ts` adds `/theory` to the disallow list for crawl budget only.
5. **Render against today's block taxonomy.** The page structure is built in full;
   the prototype's richer blocks wait for a content upgrade chosen from Search
   Console data. See *The data gap*.
6. **The quick check is built from existing cloze rows, graded in the browser, with
   no per-item explanation.** No new content, no LLM cost.
7. **No CDK change.** `GET /public/{proxy+}` is already authorizer-free and
   throttled; new paths under `/public/theory/*` inherit both.

## Out of scope

- **The "test session" (`/es/try`, `/es/try/session`).** One free AI-coached session
  per day for anonymous visitors needs an identity proxy the system does not have:
  AI metering is keyed on `userId` via `usage_events`, and the public throttle is a
  **shared** bucket, not per-IP (API Gateway v2 has no per-IP setting and WAF does
  not attach to HTTP APIs — documented in `infra/lib/constructs/api-gateway.ts`).
  It is the only prototype screen that spends money per visitor, and it needs its
  own spec with its own abuse analysis.
- **Restructuring the conjugation drill** into `/es/conjugation` + `/es/conjugation/practice`.
  `/try/forms` stays as it is.
- **Extending the theory block taxonomy** and regenerating the corpus.
- **Hand-authoring flagship topics.** Deferred until traffic says which ones.

## The data gap

The prototype's topic page is hand-authored prose about preterite vs imperfect.
The 312 real pages are generated against a five-block taxonomy
(`paragraph`, `callout`, `example`, `list`, `conjugation-table`). Roughly half the
mockup's furniture has nowhere to live:

| Prototype section | Support today |
|---|---|
| The forms (table) | `conjugation-table` — supported |
| Examples with highlighted spans | `example` + `hilite` inline — supported |
| Prose sections | `paragraph` — supported |
| The short version (2-col TL;DR) | **no block kind** |
| Signal words (chip cards) | **no block kind** |
| Verbs that change meaning (definition cards) | **no block kind** |
| Common mistakes (wrong→right pairs) | **no block kind**; `callout variant:"warn"` loses the pairing |
| Quick check | **not content** — synthesised from the exercise pool (§E) |
| "6 min read" | derivable from content length |
| `featured` flag | not in data |

This is a data gap, not a styling gap. Closing it means new block kinds in
`packages/shared`, parser changes, a `THEORY_GENERATION_PROMPT_VERSION` bump, the
matching validation-prompt bump, a Langfuse push, and regenerating all 312 topics —
which would also rewrite content currently live to signed-in users. It is also a
harder generation job than today's, because the new sections are point-specific:
"verbs that change meaning" is meaningless for noun gender, "signal words" for
adjective endings.

So the page ships with the sections the data can fill. Every SEO mechanism works on
day one; the rich blocks arrive later on the pages that earn them.

## A. API

Two endpoints on the existing unauthenticated router,
`infra/lambda/src/routes/public.ts`:

```
GET /public/theory/:lang                → { topics: PublicTopicSummary[] }
GET /public/theory/:lang/:topicId       → PublicTopicDetail
```

`lang` is `ES|DE|TR`; `topicId` must match `/^[a-z0-9-]+$/`. Both filter
`review_status IN ('auto-approved','manual-approved')`.

**Extract, do not copy.** The two queries behind `GET /theory/:lang` and
`GET /theory/:lang/:topicId` move into `infra/lambda/src/lib/theory-queries.ts`
and both routers call the same functions. A copied handler is a handler that can
silently drop the approved-status filter and start serving flagged content on the
public surface.

```ts
type PublicTopicSummary = {
  id: string;            // theory_topics.topic_id — the URL slug
  title: string;
  cefr: string;
  category: string;      // resolveTheoryCategory(grammarPointKey)
  order: number | null;  // curriculumOrderOf — drives prev/next and in-level order
  subtitle: string;      // content_json->>'subtitle' — the index's one-line description
  hasConjugationDrill: boolean;
};
```

All 312 approved rows carry a non-empty `subtitle`, `grammar_point_key` and
`cefr_level` (measured). The shared SQL keeps the existing `title`/`cefr`
NOT NULL guards **unchanged** — adding a `subtitle` guard there would alter what
the already-shipped authenticated `GET /theory/:lang` returns, for a case that
provably does not occur. The *public* route instead drops subtitle-less rows in
TypeScript and counts them into its own `console.warn`, so the index degrades
rather than 500ing and the authenticated response stays bit-identical.

`PUBLIC_LEVELS_BY_LANGUAGE` currently lives in `packages/api-client`, which the
Lambda does not depend on. It moves to `packages/shared` (api-client re-exports it
for back-compat) so both sides read one source rather than the level list being
duplicated server-side.

```ts

type PublicTopicDetail = TheoryTopicJson & {
  related: RelatedTheoryTopics;   // already derived + approved-filtered today
  hasConjugationDrill: boolean;
  quickCheck: QuickCheckItem[];   // [] when unavailable (§E)
};
```

`hasConjugationDrill` is true when the topic's `grammar_point_key` has ≥1 approved
`conjugation` row **and** the topic's CEFR level is in `PUBLIC_LEVELS_BY_LANGUAGE`
for that language (ES/DE: A1–B1; TR: A1–B2) — both conditions, because
`/try/forms` can only serve a level it offers. True on 38 topics at most.

`parseTheoryTopicJson` is the wire projection for the article: it picks known keys,
so writer metadata cannot leak through `content_json`. The quick-check rows come
from `exercises.content_json` and **must** be put through the existing
`stripWriterOnlyContent` (`_dedupKey`, `seedWord`) plus the explicit field pick in §E.

No Lambda-side caching: ISR absorbs the read volume (§B), and a module-scope cache
would only matter for traffic that never reaches the Lambda.

## B. Web routes and rendering

Six route files, three languages × {hub, topic}:

```
apps/web/app/spanish/grammar/page.tsx
apps/web/app/spanish/grammar/[topicId]/page.tsx
apps/web/app/german/grammar/…    apps/web/app/turkish/grammar/…
```

Each is a thin wrapper that passes `lang` into one shared implementation under
`apps/web/components/public/grammar/`. Three literal folders rather than one
`app/[language]/` segment: #748 chose explicit routes deliberately ("a root-level
dynamic segment would capture every otherwise-unmatched path and turn 404s into
this page"), per-language metadata is wanted anyway, and it avoids depending on
whether Next falls through from `app/spanish/` to an `app/[language]/` sibling.

**Server components throughout.** `renderTheoryTopicJson` is a pure function with
no hooks, so the entire article is emitted as HTML with no client JS. That is the
property that makes the page indexable, and it is the thing to verify (§H).

Fetching mirrors `components/public/language-landing.tsx` exactly: server-side
`fetch` with `next: { revalidate: 3600 }`, Zod-parsed response. One rule that page
does not need:

- API **404** → `notFound()`.
- API **5xx, non-JSON, or network failure** → **throw**.

A transient outage must not return 404 for 312 URLs — that teaches Google the
corpus is gone. `language-landing.tsx` degrades to `[]` on failure because its
points list is an enhancement; here the content is the page.

`generateStaticParams` returns `[]`. Pages are generated on first request and
cached for an hour, so the build makes no API calls and cannot trip the 20 rps
public throttle, and a weekly theory regeneration appears without a redeploy.

## C. Topic page composition

Top to bottom, following the prototype:

1. `PublicHeader` (existing: wordmark, language rail, theme control), `data-active="grammar"`.
2. **Breadcrumbs** — drill › Spanish grammar › `<CEFR>` › topic, with `BreadcrumbList` JSON-LD.
3. **Hero** — eyebrow (`Spanish · A2 · <category label>`), `<h1>` title, subtitle,
   and meta pills: reading time — `max(1, round(words / 200))` over the article's
   rendered text, computed server-side — and `Free conjugation drill` only when
   `hasConjugationDrill`. **No "Coached session" pill** — that surface does not exist.
4. **TOC** — plain `<a href="#id">` anchors, server-rendered from the section ids.
   Scroll-spy is a small client island and is progressive enhancement only; the
   anchors work without JS.
5. **Article** — `TheorySections` over `renderTheoryTopicJson`.
6. **Quick check** (§E) — client island, omitted entirely when `quickCheck` is empty.
7. **Practise rail** — the conjugation-drill card when `hasConjugationDrill`, then
   the sign-up box. On the 274 topics without a drill the rail is the sign-up box
   alone; that is the honest state, and it is why the index carries the pill (§D).
8. **Related topics** — from the API's existing `related` edges, as real `<a>` links.
   The prototype's per-card "Conjugation drill →" line renders only for cards whose
   own topic has one.
9. **Prev/next pager** — the adjacent topics within the same CEFR level, taking the
   language's full list and sorting by `(order ASC NULLS LAST, title ASC)`. The
   null-order tie-break matters: `grammar_point_key` is non-null on all 312 rows,
   but `curriculumOrderOf` still returns null for a key the curriculum does not
   know, and an unstable sort would make the pager point somewhere different on
   each ISR refresh. First and last topics in a level render one arm only.
10. Sign-up band, `AppFooter`.

Article typography: the in-app `.theory-*` styles are 15px/1.65 with a 24px section
title, tuned for a sidebar panel. A public long-form page read by a stranger on a
phone wants the prototype's 17px/1.7 with a 28px heading. Add a `.theory-public`
modifier overriding size, leading and heading scale, reusing the same tokens —
do not fork the renderers.

## D. Index page (`/spanish/grammar`)

Grouped by CEFR level, matching the prototype: a sticky level rail with per-level
counts, and within each level a list of topic rows (title, `subtitle` as the
one-line description, and a `conjugation` pill when `hasConjugationDrill`). The
pill is load-bearing: it tells the truth about which topics have a free drill at
the index, instead of promising one on every topic page.

Note the density difference from the mockup: its ES sample shows ~13 of 30 topics
carrying the pill; reality is **12 of 119**.

Client-side search over title+subtitle, as in the prototype — the full list is in
the HTML, so search is an enhancement and the content is indexable without it.

`components/public/language-landing.tsx` gains a link to the hub.

## E. Quick check

Three approved **cloze** rows for the topic's `grammar_point_key`, graded in the
browser by `gradeFluencyAnswer` from `packages/shared` — the same pure function the
public conjugation runner uses, which already handles cloze
(`correctAnswer` + `acceptableAnswers`) and the Turkish İ/I case-fold.

Selection: approved cloze rows for `(language, grammar_point_key)` **with no
`options` array**, `ORDER BY id LIMIT 3`, rendered only when all three exist.
Deterministic, so the published HTML is stable across ISR refreshes.

- **Option-bearing rows are excluded on purpose.** Rendering their options turns
  the exercise into multiple-choice recognition, which is the one thing the product
  positions against; omitting them can leave a blank that is ambiguous without them.
- **Available on 215 of 312 topics.** Omitted on the other 97 — including 40 with no
  cloze rows at all (30 of them Turkish). The section is absent, not empty.

Wire shape per item, an explicit pick — never the DB row:

```ts
type QuickCheckItem = {
  sentence: string;          // the cloze sentence with its blank
  instructions: string;
  correctAnswer: string;     // required client-side for grading
  acceptableAnswers: string[];
  topicHint?: string;
};
```

`glossEn` is **not** sent: it is present on only a minority of rows and it is the
field `audit:gloss` exists to police for stating a rule's trigger or outcome, which
on a self-graded public check would hand over the answer. Consequently there is no
English line under each sentence (the prototype has one; no trustworthy source
exists for it), and no per-item explanation.

**Accepted cost:** 215 topics × 3 rows ≈ 645 cloze rows published with their
answers, a bounded and deterministic slice of a ~13k-row pool. This extends the
exposure trade already made for the conjugation pool. The rows remain reusable
content, not secrets; the real cost is a signed-up learner meeting a repeat.

## F. Design-system port

The prototype uses the same palette as the app with a different variable naming
convention. This is a token remap, not a re-skin — the hex values match
(`#1a1612` ink, `#c96442` accent, `#d8d0bf` rule):

| Prototype | App (`@theme`, Tailwind v4) |
|---|---|
| `--ink`, `--ink-2`, `--ink-soft`, `--ink-mute` | `--color-ink`, `--color-ink-2`, … |
| `--paper-2`, `--paper-3`, `--card` | `--color-paper-2`, `--color-paper-3`, `--color-card` |
| `--rule`, `--rule-strong` | `--color-rule`, `--color-rule-strong` |
| `--accent`, `--accent-2`, `--accent-soft` | `--color-accent`, … |
| `--hilite-soft`, `--ok` | `--color-hilite-soft`, `--color-ok` |
| `--r-md`, `--r-lg`, `--r-pill` | `--radius-md` (10px), `--radius-lg` (16px), `--radius-pill` |
| `--t-display`, `--t-mono` | `--font-display`, `--font-mono` |
| `--shadow-2` | `--shadow-2` (same name) |

Build with Tailwind utilities and the existing `.t-display-*` / `.t-body` /
`.t-small` / `.t-micro` / `.t-mono` classes. Add semantic classes to `globals.css`
only for repeated article furniture that utilities express badly. Radius tokens are
never given a directional prefix.

## G. SEO plumbing

- **`proxy.ts`** — `isPublicRoute` gains `/spanish/:path*`, `/german/:path*`,
  `/turkish/:path*` (the bare paths are already listed). Segment-boundary form, not
  `(.*)`. **This is the single highest-consequence line in the change**: miss it and
  all 312 pages 307 to sign-in. No test enforces it today, so §H adds one.
- **`sitemap.ts`** becomes async: 3 hubs + 312 topic URLs from the three list calls,
  alongside the existing 7 entries.
- **`robots.ts`** — add `/theory` to the disallow list (crawl budget; it 307s anyway).
- Per-page `metadata` with `alternates.canonical`, written as SERP copy rather than
  generated from the title alone.

## H. Testing

**Lambda** — `theory-queries.ts` unit tests, then route tests for both public
endpoints: approved-status filter applied; invalid `lang` → 400; bad `topicId`
shape → 400; unknown topic → 404; `content_json` parse failure → 500 with the row
id logged; `hasConjugationDrill` false when the level is outside
`PUBLIC_LEVELS_BY_LANGUAGE`; quick check empty when fewer than 3 option-free rows
exist; `_dedupKey`/`seedWord` absent from every quick-check item.

**Web** — a test asserting **every** public page directory in `apps/web/app` is
matched by `isPublicRoute`, derived from the filesystem rather than a hand-kept
list, so a future public page cannot ship behind Clerk. Component tests for the
hub (grouping, pill, search) and the quick check (correct, incorrect, diacritics,
Turkish fold, completion state).

**E2E** — an `unauthenticated` Playwright spec: `/spanish/grammar` lists topics,
a topic page renders prose and the TOC, and neither redirects.

**The verification that actually matters** — fetch a deployed topic page and grep
the *server* HTML for article prose, the `<h1>`, and a related-topic link. A page
that only fills in after hydration defeats the entire purpose, and no unit test
can see the difference. Verify on the dev stack before prod.

## I. Risks

- **Middleware omission** → all 312 pages 307 to sign-in. Mitigated by the
  filesystem-derived test (§H).
- **Shared public throttle.** 20 rps / 50 burst is shared across all anonymous
  callers, so a crawler sweeping 312 pages can 429 real drill visitors. ISR means
  most crawl traffic hits Vercel rather than the API, but the first sweep is real.
  Watch the 4xx alarm after launch; consider pre-warming the pages post-deploy.
- **Scaled AI content.** 308 of 312 pages are LLM-generated and human-unread. This
  is the policy class Google's scaled-content-abuse rules target; it survives on
  being genuinely useful and attached to a working practice product, not on volume.
  Accepted knowingly (decision 3). First mitigation is editorial, not technical:
  read the pages that get traffic.
- **A thin rail on 274 topics.** Until the test session exists, most topic pages
  offer reading plus sign-up. The index pill keeps that honest.
- **Turkish is the weakest language here** — 30 of 89 topics have no cloze rows and
  5 of the 6 sub-0.80 pages are Turkish.

## J. Deferred

1. Extend the theory block taxonomy (TL;DR, signal words, meaning-shift, mistake
   pairs) and regenerate; decide from Search Console which pages justify it.
2. Hand-author flagship topics in the richer format, via the existing
   `apps/web/content/theory/es/` editorial-override path.
3. The public test session — its own spec.
4. Per-item quick-check explanations (a one-off generation pass over ~645 rows).
5. Fix the authenticated `/theory/[topicId]` language ambiguity.
6. A `slug` column if prefix-free URLs are wanted.
