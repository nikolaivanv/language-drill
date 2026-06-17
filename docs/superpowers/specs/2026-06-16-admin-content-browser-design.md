# Admin Content Browser & Search (Design)

**Status:** approved · **Date:** 2026-06-16 · **Scope:** Tier 1 surface #3

Derived from `docs/admin-panel.md` (Tier 1, item 3: "Content browser with demote/delete of
approved content"). The mirror of the flagged review queue (PR #321), but for **approved**
content. Builds on the admin foundation (PR #317) and the flagged queue (PR #321). The
remaining Tier 1 surface (user inspector) is a separate spec.

## Goal

Let an admin browse and search the **approved** exercise/theory pool (`auto-approved` +
`manual-approved`), inspect each item's content and generation metadata, and act on a bad
item with two reversible transitions:

- **Demote** → `review_status='flagged'` — sends the item back into the Moderation review
  queue (PR #321) for another look.
- **Reject** → `review_status='rejected'` — soft-removes it from the live pool.

No hard `DELETE` (per `docs/admin-panel.md` Open Decisions: soft-reject is reversible and
keeps the dedup index honest). This is the only post-hoc check on auto-approved content,
which goes live unreviewed.

## Background (verified against current code, post-PR #321)

- **Schema** (`packages/db/src/schema/`): `exercises` has `reviewStatus`
  (`auto-approved | manual-approved | flagged | rejected`), `contentJson` (with writer-only
  `_dedupKey`), `coverageTags`, `qualityScore`, `generationSource`, `modelId`, `difficulty`,
  `type`, `grammarPointKey`, `language`, `generatedAt`. `theory_topics` has the same review
  columns plus `cefrLevel`, `topicId` (no `type`, no `coverageTags`).
- **Dedup index** is partial-unique on `(language, type, difficulty, grammarPointKey,
  content_json->>'_dedupKey')` for `reviewStatus IN ('auto-approved','manual-approved',
  'flagged')`. Because it keys on `_dedupKey` (per-content), a status transition of one
  existing row never collides — so demote/reject here need **no** `23505` handling (unlike
  the queue's approve path).
- **Admin routes** (`infra/lambda/src/routes/admin.ts`): Hono, `/admin/*` gated by
  `authMiddleware + adminMiddleware`; zod `safeParse` query validation → `400
  VALIDATION_ERROR`; the flagged queue already added `GET /admin/flagged/{exercises,theory}`
  (list with filters + `total`, `stripDedupKey`, `normalizeFlaggedReasons`) and
  `POST /admin/flagged/{exercises,theory}/:id/{approve,reject}` (split helpers
  `resolveExerciseFlagged`/`resolveTheoryFlagged`, guarded `WHERE … review_status='flagged'`,
  `{ outcome }` responses, uuid validation). `stripDedupKey` and `isUniqueViolation` already
  live in this file.
- **api-client** (`packages/api-client/src/`): `schemas/flagged.ts` (incl. `FlaggedReason`,
  `ResolveOutcomeSchema`) + `hooks/useFlaggedQueue.ts` (`useFlagged*` queries with a
  `queryString` filter builder; `useResolveFlagged*` mutations → `invalidateQueries`).
  Barrel-exported from `index.ts`.
- **web** (`apps/web/`): the Moderation page `app/(admin)/admin/moderation/page.tsx`
  (client; tabs; filter bar; resolve handlers with try/catch + demote notice) and
  `_components/` (`ContentFieldView` — generic labeled field view + raw-JSON disclosure;
  `flagged-exercise-card.tsx`/`flagged-theory-card.tsx` using `formatReason` from
  `@language-drill/shared` and the theory renderer `renderTheoryTopicJson` +
  `TheorySections`). `ADMIN_NAV` in `components/admin/admin-nav-items.tsx` is currently
  `[Moderation, Pool, Theory, Invites]`; its test asserts that order.

## Architecture

A new **Content** section at `/admin/content` — a **client component** (mutating +
interactive) with **Exercises | Theory** tabs. New nav entry "Content" placed right after
"Moderation" (order becomes `[Moderation, Content, Pool, Theory, Invites]`). Distinct from
Moderation: Moderation triages flagged items; Content browses approved ones and can push them
back to flagged (Demote) or out of the pool (Reject).

```
app/(admin)/admin/content/
  page.tsx                          — client: tabs + filter bar + search + pagination + lists
  _components/
    content-exercise-card.tsx       — approved-exercise card (metadata header + ContentFieldView + actions)
    content-theory-card.tsx         — approved-theory card (metadata header + theory renderer + actions)
```

`ContentFieldView` and the theory renderer are reused from the merged flagged-queue work.
The flagged cards are NOT retrofitted; new content cards are added. If the header/chrome
duplication between flagged and content cards is glaring during implementation, extract a
small shared presentational shell — but do not rewrite the merged flagged cards beyond a
clean extraction.

## API (new routes in `infra/lambda/src/routes/admin.ts`)

All under the existing `/admin/*` auth+admin gate. The approved-status set is
`('auto-approved','manual-approved')`.

### List
- `GET /admin/content/exercises` — query (all optional): `language` (ES|DE|TR), `level`
  (A1|A2|B1|B2), `type` (string), `grammarPoint` (string), `q` (string), `limit` (int 1–100,
  default 25), `offset` (int ≥ 0, default 0). `WHERE review_status IN ('auto-approved',
  'manual-approved')` + each provided filter (`level`→`difficulty`) + when `q` present
  `sql\`${exercises.contentJson}::text ILIKE ${'%' + q + '%'}\``. Returns:
  ```
  { items: Array<{
      id, language, level,            // level = exercises.difficulty
      type, grammarPointKey,
      contentJson,                    // _dedupKey stripped server-side
      coverageTags,                   // jsonb | null
      qualityScore,                   // number | null
      generationSource,               // string
      modelId,                        // string | null
      reviewStatus,                   // 'auto-approved' | 'manual-approved'
      generatedAt                     // ISO string | null
    }>,
    total }                           // count matching filters (items capped by limit/offset)
  ```
  Ordered `generatedAt DESC NULLS LAST` (newest first). Both `limit` and `offset` applied.
- `GET /admin/content/theory` — query: `language, level, grammarPoint, q, limit, offset`
  (no `type`). Items: `{ id, language, level(=cefrLevel), grammarPointKey, topicId,
  contentJson, qualityScore, generationSource, modelId, reviewStatus, generatedAt }`
  (no `coverageTags`). `q` → `content_json::text ILIKE`.

### Mutate (plain guarded status transitions — no 23505 handling)
- `POST /admin/content/exercises/:id/demote` → UPDATE `review_status='flagged'` WHERE
  `id=:id AND review_status IN ('auto-approved','manual-approved')`, `.returning({id})`.
  ≥1 row → `demoted`; 0 rows → re-read by id: missing → `not_found`, else
  `already_resolved`. `{ outcome: 'demoted' | 'not_found' | 'already_resolved' }`.
- `POST /admin/content/exercises/:id/reject` → UPDATE `review_status='rejected'`, same guard.
  `{ outcome: 'rejected' | 'not_found' | 'already_resolved' }`.
- `POST /admin/content/theory/:id/{demote,reject}` — identical against `theory_topics`.
- `:id` validated as uuid → `400` on failure (mirror the flagged routes). Unknown id is a
  `200 { outcome: 'not_found' }`, not a 404.

A shared helper (e.g. `transitionContent(table, id, toStatus)` guarding on the approved set,
or split exercise/theory copies if the Drizzle table union fights the types — the flagged
work hit that and split) keeps demote/reject DRY. No `isUniqueViolation`/catch needed.

## Web UI (`app/(admin)/admin/content/`)

- **`page.tsx`** (`'use client'`): `useAuth()` → `createAuthenticatedFetch`. Tab state
  (`exercises|theory`), filter state (`language, level, type, grammarPoint`), search text
  `q`, and pagination (`limit`=25, `offset`). Filter bar (selects + grammar-point input),
  a search box, the paginated card list, prev/next controls, an "N matches" + "page X/Y"
  line, and loading/error/empty states. Changing any filter/search resets `offset` to 0.
  Demote/Reject handlers call the mutation (try/catch → inline error like the Moderation
  page); on success the list invalidates. Demote shows a brief "sent back to the review
  queue" note; Reject just drops the item on refetch.
- **`content-exercise-card.tsx`**: header (`type · language · level · grammarPointKey`,
  quality score, `generationSource`, `modelId`), optional `coverageTags` summary line,
  `<ContentFieldView content={item.contentJson} />`, Demote + Reject buttons (disabled while
  pending).
- **`content-theory-card.tsx`**: same header (no type/coverageTags), theory rendered via
  `parseTheoryTopicJson` → `renderTheoryTopicJson` → `<TheorySections>` with a raw-JSON
  fallback, Demote + Reject buttons.
- **api-client** (`schemas/content.ts`, `hooks/useContentBrowser.ts`):
  `ContentExerciseSchema`/`ContentTheorySchema` (+ response schemas with `items`+`total`),
  reuse `ResolveOutcomeSchema`; `useContentExercises`/`useContentTheory` (queries keyed
  `['admin','content','exercises'|'theory', params]`, building the query string from
  filters+`q`+`limit`+`offset`); `useResolveContentExercise`/`useResolveContentTheory`
  (mutations `{id, action:'demote'|'reject'}` → POST `/admin/content/{kind}/{id}/{action}` →
  `{outcome}`, invalidating `['admin','content',kind]`). `contentJson` typed `z.unknown()`.

## Testing

- **Lambda** (`infra/lambda/src/routes/admin.test.ts`, reusing the chain-mock + `queryQueue`
  harness): for both tables — list with filters, `q` ILIKE applied, pagination (`limit`/
  `offset`), `total`, `_dedupKey` stripped, approved-status-only filter; demote happy
  (→ outcome `demoted`) + guard (0-rows → `already_resolved`/`not_found`); reject happy
  (→ `rejected`) + guard; uuid `400`.
- **api-client** (`hooks/useContentBrowser.test.ts`): query builds the right URL incl.
  `q`/`limit`/`offset`; mutation POSTs the right path and returns the outcome.
- **web**: content cards render metadata + answer (+ coverageTags for exercises); Demote/
  Reject trigger mutations; pagination/filter/search behavior; `ADMIN_NAV` order test
  updated to include "Content".
- Gate before push: `pnpm lint`, `pnpm typecheck`, `pnpm turbo run test --concurrency=1`.

## Out of scope (later)

- `admin_audit_log` (Tier 2) — demote/reject will append once it exists.
- Hard `DELETE` of rows, bulk actions.
- The user search/detail/progress inspector (Tier 1 surface #4 — separate spec).
- Langfuse / eval deep-links, reading-text cache moderation.

## Risks / notes

- **`q` matches `_dedupKey`** since it's an `ILIKE` over the whole `content_json::text`
  (the key is still in the DB text even though stripped from the response). Harmless for an
  admin search; acceptable for v1. (Searching specific fields would need per-type column
  extraction — deferred.)
- **Pagination + mutation**: after a demote/reject the item leaves the approved set, so the
  current page's `total` shifts. Invalidating the query refetches the current
  `offset`/filters; an admin may see the list shift by one. Acceptable; no optimistic
  bookkeeping needed.
- **`generatedAt` nullable**: order `DESC NULLS LAST` so legacy/seed rows without a timestamp
  sort to the end rather than the top.
- **Reusing `ContentFieldView`**: it already strips `type`/`_dedupKey` from the labeled view
  and offers raw JSON — exactly what's needed here; no change required.
