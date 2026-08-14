# Admin diversity visibility — design

**Date:** 2026-08-14
**Status:** approved, not yet implemented
**Branch:** `feat/admin-diversity-panel`

## Problem

The pool's diversity machinery — coverage axes and floors, construction
variants, curated seed pools, frequency-band seeding — is authored in the
curriculum and enforced by the generator, but a human operator cannot see it.
Answering "is this cell's diversity actually working?" today means running
`pnpm audit:collapse` and reading a JSON artifact, or querying Neon by hand.

Four questions have no UI answer:

1. **Is this cell's diversity working?** Which mechanisms apply to a cell, and
   what do the approved rows actually realize?
2. **Which points are mis-configured?** A curriculum-wide view of what each
   point declares and which declarations are unrealized.
3. **Why does this one exercise exist?** A row's `coverage_tags` and its
   `seedWord` / variant id.
4. **What do these mechanisms even do?** The vocabulary itself, documented in
   the panel rather than reconstructed from `CLAUDE.md` each time.

## Scope

**In:** read-only visibility across four surfaces. Deterministic only — no LLM
calls, so the pages cost nothing to load and cannot disagree with themselves
between refreshes.

**Out:** editing coverage specs or seed pools from the UI; triggering
demotions or generation from the new page (it links to the existing
`/admin/pool` drawer actions); any "you should declare a mechanism here"
heuristic — that stays `audit:collapse`'s job, and the new page links out to it
rather than duplicating it.

## Architecture

### Reuse, don't reinvent

Nearly all the math already exists as pure exported functions. Reusing them is
what keeps the panel and `audit:collapse` from ever disagreeing.

| What | Function | Location |
| --- | --- | --- |
| Which seed mechanism a cell uses | `seedKindFor(cell)` | `packages/db/src/generation/run-one-cell.ts:609` (moves — see "Package placement") |
| Which axes a cell tags | `coverageAxesFor(type, spec)` | `packages/shared/src/coverage.ts` |
| Declared floors vs. realized tags | `computeSpecShortfall(gp, rows, target)` | `packages/ai/src/collapse-metrics.ts:176` |
| Declared variants vs. realized `seedWord` | `computeVariantSkew(gp, rows)` | `packages/ai/src/collapse-metrics.ts:237` |
| Cell target | `resolveCellTarget(cell)` | `packages/shared/src/cell-targets.ts` |

### The resolver

New pure module `packages/db/src/generation/diversity-mechanisms.ts`.
`resolveCellMechanisms(cell)` returns the *declared* shape of every mechanism
in play for one cell:

```ts
type DiversityMechanisms = {
  axes: Array<{
    name: CoverageAxis;
    role: 'controlled' | 'monitored'; // controlled = named by the point's coverageSpec
    floors?: Record<string, number>;  // present iff controlled
  }>;
  seed:
    | { kind: 'construction-variants'; variants: Array<{ id: string; directive: string; share: number }> }
    | { kind: 'curated'; source: 'conjugationSeedWords' | 'elicitationSeedValues' | 'paraphrase.seeds'; values: string[] }
    | { kind: 'frequency-band'; band: 'verb' | 'noun' | 'content-word'; rankMax: number }
    | { kind: 'vocab-target' }
    | { kind: 'none' };
  target: number;
  targetOverride: number | null;
};
```

It **delegates** to `seedKindFor` and `coverageAxesFor` rather than restating
their precedence rules, so a future change to the seed picker cannot silently
desync the panel from the generator.

### Package placement (build-cycle constraint)

The resolver cannot live in `packages/shared`: it needs `seedKindFor` and the
`Cell` type, both in `packages/db` (`generation/run-one-cell.ts:609`,
`generation/cells.ts:39`), and `shared` sits below `db`. And `apps/web`
deliberately does not import `db` at runtime —
`apps/web/lib/admin/langfuse.ts` duplicates `cell-key` precisely to avoid it.

Therefore:

- `seedKindFor` moves out of `run-one-cell.ts` into a new pure
  `packages/db/src/generation/seed-kind.ts` (it is already pure — no I/O),
  re-imported by `run-one-cell.ts`. This keeps the resolver from dragging
  drizzle/postgres in through the back door.
- The resolver imports only `seed-kind.ts`, `cells.ts`, and `shared`.
- The Lambda imports the resolver directly.
- **Web imports nothing new.** It receives the resolved shape through
  `api-client` Zod schemas — the established pattern.

### API

New admin-gated `GET /admin/diversity` (`infra/lambda/src/routes/admin.ts`).
Three cell-grouped aggregates in one `Promise.all`:

1. **Axis realization** — the existing `jsonb_each_text(coverage_tags)` LATERAL
   query, lifted out of `/admin/pool-status` into a shared helper (it is
   byte-identical to what that endpoint already runs).
2. **Seed realization** — new: `GROUP BY content_json->>'seedWord'` over
   approved rows per cell.
3. **Denominators** — `COUNT(*) FILTER (WHERE coverage_tags IS NULL)` and the
   per-axis missing count, plus rows whose `seedWord` is null.

Query params mirror the other admin endpoints: `language`, `level`, `kind`
(curriculum item kind), plus two specific to this page — `mechanism`
(`variants` | `curated-seeds` | `frequency-band` | `coverage-spec` | `none`,
filtering to points declaring that mechanism) and `issuesOnly` (a boolean
restricting the response to points with at least one unrealized declaration,
unmet floor, or `at target` shortfall).

`computeSpecShortfall` and `computeVariantSkew` get a small refactor:
counts-based cores (`computeSpecShortfallFromCounts`,
`computeVariantSkewFromCounts`) with the existing row-scanning signatures
delegating to them. The CLI keeps its current API; the admin route feeds SQL
counts in without loading ~13k `content_json` blobs.

### Realized vs. unknown — the load-bearing distinction

An axis at 0 across a whole cell usually means missing **tags**, not missing
**content**. Acting on the wrong reading nearly cost 169 rows during the #631
repass. So this distinction is structural in the response shape and in the UI,
not a footnote:

- Every realized number renders against its denominator.
- A zero with an untagged/unlabelled remainder renders as **unknown** (`⚠`),
  never as a failure.
- `✗` is shown **only** when the denominator proves the absence — i.e. every
  row in the cell carries the axis (or a declared variant id) and the value's
  count is still zero.

```
person   1sg 8 ✓   3sg 12 ✓   2pl 0 ⚠ 14 rows untagged — may be a tagging gap
variants hearsay 31 ✓   passive-like 0 ✗ (all 47 rows labelled)
```

`VariantSkew.unrecognizedSeedCount` already carries exactly this denominator
for variants (rows whose `seedWord` is null or is not a declared variant id —
the unbackfilled-legacy-row hazard the #631 rollout documented at length).

## Surfaces

### A. `/admin/diversity` — the hub (new page)

One row per grammar point — the right grain, since `coverageSpec`,
`constructionVariants` and the curated seed pools are all point-level config.
Expandable to per-cell rows — the right grain for realization, since a point's
cloze / translation / conjugation cells use different seed kinds and different
axes.

```
Filters: [ES ▾] [B1 ▾] [kind ▾] [mechanism ▾] [☑ only points with issues]

point                     axes            variants      seeds              status
▸ es-b1-impersonal-plural pol · sent      4 declared    variant pool       ⚠ 2 unrealized
▾ es-b1-subjunctive-wish  person* · pol   —             band:content-word  ⚠ 1 floor unmet
    cloze         A2  47/50  person 1sg 12 ✓ 3sg 19 ✓ 2pl 0 ⚠(14 untagged)
    translation   A2  50/50  person 1sg  9 ✓ 3sg 22 ✓ 2pl 3 ✓ · at target ⚠
▸ tr-a2-possessive        case · number   —             curated (12 nouns, 9 used)
▸ es-a1-ser-estar         pol · sent      —             band:content-word  — ok
                                                     * = controlled by coverageSpec
```

Two signals earn their place beyond raw config:

- **`at target ⚠`** — a cell at target has no deficit, so the scheduler never
  revisits it and its declared floors never fire, however loudly they are
  declared. That cell needs `pnpm demote:pool`. The combination
  (`atTarget && shortfalls.length > 0`) is already computed by
  `computeSpecShortfall`; surfacing it is the highest-value flag on the page.
- **Curated pool burn-down** — "12 nouns, 9 used". A bounded pool the live pool
  has fully covered makes `pickSeeds` return nulls and the cell silently stops
  generating. Nothing surfaces that today.

### B. `/admin/pool` cell drawer (extend)

Keeps "Diversity vs. floors", now rendering untagged denominators. Gains:

- **Construction variants** — id · directive · share · realized count vs.
  quota, plus `unrecognizedSeedCount` shown as "N rows unlabelled (pre-#640)".
- **Seeds** — resolved kind, pool size, used / unused counts, top realized
  seeds.

Deep-links to the point's row on `/admin/diversity`.

### C. `/admin/content` exercise card (extend)

The cheap one: `contentJson` and `coverageTags` are already on the wire for
`GET /admin/content/exercises`. Purely a rendering change — chips for each
coverage tag and for `seedWord`, with the seed chip labelled by its resolved
role ("variant: hearsay" vs. "seed: okul") so a variant id is not mistaken for
a frequency word.

### D. Explainer

A collapsible glossary at the top of `/admin/diversity`: one short paragraph
per mechanism (coverage axis vs. floor; construction variant; seed-source
precedence; why "at target" blocks self-healing). Static content in the page
component, ~200 words total. Not generated, not fetched.

### Navigation

`{ href: '/admin/diversity', label: 'Diversity' }` appended to `ADMIN_NAV` in
`apps/web/components/admin/admin-nav-items.tsx`.

## Testing

Tests go in the existing file for each module, per the project rule.

| Layer | File | What |
| --- | --- | --- |
| Resolver | `packages/db/src/generation/diversity-mechanisms.test.ts` (new module ⇒ new file) | one case per seed kind, including the sentence-construction + variants path added 2026-08-14; axis role classification (controlled vs. monitored); `targetOverride` |
| Metrics refactor | `packages/ai/src/collapse-metrics.test.ts` | existing row-based tests must pass unchanged (proving the delegation is faithful) + new counts-based cases |
| API | `infra/lambda/src/routes/admin.test.ts` | endpoint shape, filters, untagged-denominator fields |
| Web | `apps/web/app/(admin)/admin/diversity/__tests__/page.test.tsx`, plus additions to `pool-cell-detail.test.tsx` and `content-exercise-card.test.tsx` | rendering; the `✗` vs. `⚠ untagged` distinction; `at target ⚠` |
| Nav | `apps/web/components/admin/__tests__/admin-nav.test.tsx` | the new entry |

## Risks

1. **`admin.test.ts` mock ordering.** `db.execute` shifts its mock queue
   *synchronously* while `db.select` shifts lazily. Adding a fourth
   `db.execute` to a `Promise.all` will silently mis-feed every later test in
   the file unless the push order is re-derived rather than appended to.
2. **Perf.** The `content_json->>'seedWord'` group-by is an unindexed scan of
   ~13k rows. Acceptable — `/admin/pool-status` already runs an unfiltered
   LATERAL over the same table, and this is admin-only. No index is added; the
   decision should be revisited if `exercises` grows an order of magnitude.
3. **`api-client` Zod enum drift.** The new `seed.kind` enum must be mirrored
   in the api-client schema or production throws `ZodError` — the same class of
   bug as the `CurriculumItemKind` incident.
4. **Stale `db/dist`.** The resolver is new `db` source, so `pnpm build` is
   required before single-package vitest runs resolve it.
