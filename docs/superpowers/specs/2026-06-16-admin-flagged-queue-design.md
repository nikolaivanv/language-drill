# Admin Flagged Content Review Queue (Design)

**Status:** approved · **Date:** 2026-06-16 · **Scope:** Tier 1 surface #2

Derived from `docs/admin-panel.md` (Tier 1, item 2: "Flagged review queue (exercises +
theory) — retire the CLI REPL"). Builds on the merged admin foundation (PR #317:
`(admin)` route group, `AdminShell`/`AdminNav`, `/me`-driven gate). The other Tier 1
surfaces (content browser, user inspector, generation job log) remain separate specs.

## Goal

Replace the `pnpm review:flagged` / `review:flagged:theory` terminal REPLs with a web
UI: list flagged exercises and theory pages, inspect each item's content + flagged
reasons + quality score, and **approve** (→ `manual-approved`) or **reject** (→
`rejected`) them — preserving the CLI's exact promote/demote semantics.

## Background (verified against current code)

- **Exercise CLI** `packages/db/scripts/review-flagged.ts`:
  - Selects `exercises` where `review_status='flagged'`, filtered by language (required in
    CLI) + optional level/type/grammarPoint, ordered `generatedAt ASC`, capped at `limit`
    (default 50).
  - `tryApprove`: UPDATE → `review_status='manual-approved'`, `flaggedReasons=null`,
    guarded by `AND review_status='flagged'`. On a Postgres unique-violation (`23505`)
    from the partial dedup index — i.e. an approved item already occupies that cell — it
    catches the error and instead UPDATEs the row to `review_status='rejected'`, returning
    `'demoted'`.
  - `rejectRow`: UPDATE → `review_status='rejected'`, **preserves** `flaggedReasons`.
- **Theory CLI** `packages/db/scripts/review-flagged-theory.ts`: same shape, no `type`
  filter; unique index is `theory_topics_pool_lookup_idx` on `(language, grammar_point_key)`
  for approved statuses; renders content via `theoryTopicJsonToText`.
- **Content shapes**: `ExerciseContent` (6 variants: cloze, translation, vocab_recall,
  sentence_construction, dictation, free_writing) in `packages/shared/src/index.ts`;
  `TheoryTopicJson` in `packages/shared/src/theory.ts`. `contentJson` also carries a
  writer-only `_dedupKey` that must be hidden in the UI.
- **Reasons**: `packages/shared/src/generation-reasons.ts` exports `REASON_LABELS`,
  `formatReason(reason)`, `GenerationReason = {code, detail?}`, and
  `normalizeFlaggedReasons(raw)` (coerces legacy string arrays). `flaggedReasons` is a
  `GenerationReason[]` jsonb column on both tables.
- **Admin routes**: `infra/lambda/src/routes/admin.ts` — Hono router, all `/admin/*`
  gated by `authMiddleware + adminMiddleware`; request query validated with zod
  `safeParse`; dates serialized to ISO strings explicitly.
- **api-client idiom**: `packages/api-client/src/hooks/useAdminInvites.ts` — query hooks
  parse responses with a zod schema; mutation hooks POST then
  `queryClient.invalidateQueries`. Schemas in `packages/api-client/src/schemas/`.
- **Existing renderers**: the drill's `ExercisePane` is an *interactive* renderer (built
  for answering, hides the answer) — NOT reused here. Theory has a read-only web renderer
  at `apps/web/components/theory/` that we DO reuse.
- **Foundation nav**: `apps/web/components/admin/admin-nav-items.tsx` exports `ADMIN_NAV`
  (currently Pool/Theory/Invites); new sections are appended here.

## Architecture

A single new **Moderation** page (`/admin/moderation`) — a **client component** (it
mutates and needs optimistic refetch, like `/admin/invites`) — with two tabs,
**Exercises** and **Theory**. Each tab is an independent filtered list with a count
badge. New API endpoints back it. The CLI scripts are left in place (proven fallback;
deleting tested code is unnecessary).

```
ADMIN_NAV:  Moderation · Pool · Theory · Invites      (Moderation prepended)

app/(admin)/admin/moderation/
  page.tsx                          — client: tabs + filter bar + lists
  _components/
    content-field-view.tsx          — generic labeled key/value view of exercise contentJson
    flagged-exercise-card.tsx       — header + reason chips + content-field-view + actions
    flagged-theory-card.tsx         — header + reason chips + theory renderer + actions
```

## API (new routes in `infra/lambda/src/routes/admin.ts`)

All under the existing `/admin/*` auth+admin gate. Shared promote/demote logic lives in a
small local helper in the route module (the CLI's logic is in `packages/db/scripts`, not
cleanly importable into the Lambda; we re-implement the identical semantics and cover them
with tests rather than refactoring across packages).

### List
- `GET /admin/flagged/exercises` — query (all optional): `language` (ES|DE|TR), `level`
  (A1|A2|B1|B2), `type` (exercise type enum), `grammarPoint` (string), `limit` (int,
  default 100, max 200). Returns:
  ```
  { items: Array<{
      id, language, level,        // level = exercises.difficulty
      type, grammarPointKey,
      contentJson,                // _dedupKey stripped server-side
      qualityScore,               // number | null
      flaggedReasons,             // GenerationReason[] (normalized)
      generatedAt                 // ISO string
    }>,
    total }                       // count matching filters (items may be capped by limit)
  ```
  Ordered `generatedAt ASC` (oldest first).
- `GET /admin/flagged/theory` — query (all optional): `language`, `level`, `grammarPoint`,
  `limit`. Items: `{ id, language, level (=cefrLevel), grammarPointKey, topicId,
  contentJson, qualityScore, flaggedReasons, generatedAt }` + `total`. No `type`.

### Mutate
- `POST /admin/flagged/exercises/:id/approve` → `{ outcome }` where `outcome ∈
  {'approved','demoted','not_found','already_resolved'}`:
  - UPDATE `review_status='manual-approved'`, `flaggedReasons=null` WHERE `id=:id AND
    review_status='flagged'`. If 0 rows affected → re-read the row: missing → `not_found`;
    present but not flagged → `already_resolved`.
  - On `23505` unique violation → UPDATE same row to `review_status='rejected'` (WHERE
    `id AND review_status='flagged'`) → `demoted`.
- `POST /admin/flagged/exercises/:id/reject` → `{ outcome ∈
  {'rejected','not_found','already_resolved'} }`: UPDATE `review_status='rejected'`
  (flaggedReasons preserved) WHERE `id AND review_status='flagged'`; 0 rows → re-read to
  distinguish not_found / already_resolved.
- `POST /admin/flagged/theory/:id/approve` and `/reject` — identical semantics against
  `theory_topics` (unique index on `(language, grammar_point_key)`).

Validation: zod `safeParse` on query + path params; `400 VALIDATION_ERROR` on failure,
matching the existing admin routes. Unknown id is `200 { outcome: 'not_found' }` (not a
404) so the client can treat it as "already gone, refetch".

## Web UI (`app/(admin)/admin/moderation/`)

- **`page.tsx`** (`'use client'`): `useAuth()` → `createAuthenticatedFetch` → the new
  hooks. Tab state (`'exercises' | 'theory'`) + filter state. Filter bar: language, level,
  type (exercises tab only), grammar-point (text input) — all optional, default unset
  (shows all flagged). Tab labels carry the `total` count badge. Renders the matching card
  list, an empty state ("No flagged items"), and a "showing N of M" line when
  `items.length < total`.
- **`content-field-view.tsx`**: renders an exercise `contentJson` as a labeled key/value
  list (type-agnostic — iterates known display fields, falls back to JSON for nested
  values), `_dedupKey` already stripped server-side, with a collapsible `<details>` raw
  JSON. Shows the correct answer plainly.
- **`flagged-exercise-card.tsx`**: header (`type · language · level · grammarPointKey`,
  quality score), reason chips rendered via `formatReason`, `content-field-view`,
  Approve/Reject buttons (disabled while pending). Approve→`demoted` shows an inline notice:
  "An approved item already exists in this cell — this item was rejected instead."
  Approve→`approved` and reject→`rejected` simply drop the item from the list. `not_found`
  / `already_resolved` → silent refetch (item already gone).
- **`flagged-theory-card.tsx`**: same header/chips/actions; content rendered by the
  existing read-only theory web renderer (`apps/web/components/theory/`).
- **api-client** (`hooks/useFlaggedQueue.ts`, `schemas/flagged.ts`): `useFlaggedExercises`,
  `useFlaggedTheory` (queries, keyed `['admin','flagged','exercises',filters]` etc.);
  `useResolveFlaggedExercise`, `useResolveFlaggedTheory` (mutations taking `{id, action:
  'approve'|'reject'}`, returning the `outcome`, invalidating the matching list + counts on
  success). Schemas: `FlaggedExerciseSchema`, `FlaggedTheorySchema`, list responses, and a
  `ResolveOutcomeSchema` enum. `contentJson` typed as `z.unknown()` at the boundary (the
  card narrows with the shared type guards).

## Testing

- **Lambda** (`infra/lambda/src/routes/admin.test.ts` or a new sibling, following the
  existing admin route test harness): for both exercises and theory —
  - list: filter combinations, `generatedAt ASC` ordering, `total` vs capped `items`,
    `_dedupKey` stripped from returned `contentJson`.
  - approve happy path → `manual-approved` + `flaggedReasons` null + outcome `approved`.
  - approve into an occupied cell → row ends `rejected`, outcome `demoted`.
  - reject → `rejected` + `flaggedReasons` preserved + outcome `rejected`.
  - guards: already-resolved row → no state change, outcome `already_resolved`; unknown id
    → outcome `not_found`.
- **api-client**: hook tests mirroring `useAdminInvites.test.ts` (query parses + mutation
  invalidates the right keys; outcome surfaced).
- **web**: `content-field-view` renders fields incl. the answer and hides `_dedupKey`;
  exercise/theory cards render header + reason chips; Approve/Reject trigger the mutation;
  `demoted` notice appears; tab switch + filter changes refetch.
- Gate before push: `pnpm lint`, `pnpm typecheck`, `pnpm turbo run test --concurrency=1`.

## Out of scope (later)

- `admin_audit_log` (Tier 2) — these mutating actions will append to it once it exists.
- The approved-content browser with demote/delete (Tier 1 surface #3 — separate spec).
- Bulk approve/reject, hard deletion, on-demand generation, Langfuse deep-links.
- Deleting the CLI scripts.

## Risks / notes

- **Demote semantics must match the CLI exactly** — same `23505` catch → reject, same
  `AND review_status='flagged'` guard against concurrent reviewers. This is the one piece
  of real logic; cover it directly with a test that pre-seeds an approved row in the cell.
- **`_dedupKey` leakage** — strip it server-side in the list response (don't rely on the
  client to hide it).
- **Reason normalization** — run `flaggedReasons` through `normalizeFlaggedReasons` in the
  list endpoint so legacy string-array rows render correctly.
- **Theory renderer reuse** — the theory web renderer expects a parsed shape; validate with
  `parseTheoryTopicJson` and fall back to raw JSON on parse failure (a flagged theory page
  may be malformed — that can itself be the reason it's flagged).
