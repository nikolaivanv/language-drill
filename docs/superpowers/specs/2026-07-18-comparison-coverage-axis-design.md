# `comparison` coverage axis — design

**Date:** 2026-07-18
**Status:** approved (brainstorming)
**Author:** nikolaivanv (+ Claude)

## Problem

`tr-a1-comparative-superlative` (TR A1, "Comparative (daha) and superlative (en)")
generates a pool that collapses onto the comparative. Measured over the 40
approved exercises in prod (20 cloze + 20 translation):

| Construction | Count | Share |
|---|---|---|
| Comparative `daha` (`-DEn` + daha + adj) | 36 | 90% |
| Superlative `en` | 4 | 10% |
| "less" `daha az` | 0 | 0% |
| `daha`-drop (ablative present, daha omitted) | 0 | 0% |

The point's own `description` / `examplesPositive` / `commonErrors` teach all of
comparative, superlative, and `daha az` — but the pool tests essentially only the
comparative. `en` appears as a trickle; `daha az` and the daha-drop nuance never
appear.

**Root cause.** The point has no `coverageSpec`, and — more fundamentally — the
comparative/superlative/equative/less distinction is a *construction* choice that
none of the six existing coverage axes (person, number, case, wordClass, polarity,
sentenceType) can express. Without a hard per-draft pin, generation collapses to
`daha`, the unmarked, most-frequent form. A prior auditor already recognised this
on the German sibling `de-a2-comparison`, whose inline comment reads: *"degree
(comparative vs superlative) has no axis at all. Both unpinnable."*

This is systemic across the comparison family: `de-a2-comparison` and the ES
comparison points share the same latent skew.

## Solution

Add a 7th coverage axis, `comparison`, with values
`{comparative, superlative, equative, less}`. It slots into the existing
spec → scheduler → generation → validator machinery with no bespoke code path:
the pipeline is axis-agnostic (`coverage-decision.ts` water-fills from floors,
`renderCoverageBlock` pins each draft, the validator reports realized values,
approved counts feed back per `(axis, value)`). The spec *is* the feature.

Values are surface-construction oriented (what the learner must produce) rather
than the classical adjective-degree triad, so one vocabulary serves all three
languages; each point floors only its own subset (omitted values are "NA", never
targeted):

- `comparative` — superiority: `daha` / `más…que` / `-er…als`
- `superlative` — `en` / `el más…de` / `am -sten`
- `equative` — `kadar` / `tan…como` / `genauso…wie`
- `less` — inferiority: `daha az` / `menos…que`

### Why not the alternatives

- **Accept + document (match DE):** honest but leaves the 90/10/0 skew in place —
  generation collapses without a hard pin.
- **Point-local construction rotation** (like `sentenceConstructionModeForOrdinal`):
  lighter, but a second parallel mechanism that doesn't feed the validator's
  realized-value monitoring or the give-up loop.
- **New axis** wins because it is reusable across the whole TR/DE/ES comparison
  family and reuses the blessed, already-tested coverage machinery end to end.

## Changes

### 1. The axis — `packages/shared/src/coverage.ts`

- `COMPARISON_CODES = ['comparative','superlative','equative','less'] as const`
  and `type ComparisonCode`.
- Add `'comparison'` to: the `CoverageAxis` union, `AXIS_ORDER`,
  `COVERAGE_AXIS_VALUES`, and the `CoverageTags` type (`comparison?: ComparisonCode`).
- **Not** added to any exercise type's default monitoring set inside
  `coverageAxesFor` — `comparison` activates *only* when a point's `coverageSpec`
  controls it, so no unrelated point ever gets a `comparison` tag.

### 2. Validator — `packages/ai`

- `validate.ts`: add a `comparison` sub-field to the `coverage` tool schema
  (`enum: [...COVERAGE_AXIS_VALUES.comparison]`). The lenient `coerceCoverage`
  reader already iterates `COVERAGE_AXIS_VALUES` keys, so parsing/dropping needs
  no change.
- `validation-prompts.ts`: add `COVERAGE_AXIS_DIRECTIVE.comparison` — a
  descriptive realized-tag line ("the comparison construction the target answer
  realizes: comparative/superlative/equative/less. Report what the draft ACTUALLY
  produced, not what was requested.").

### 3. Generator — `packages/ai/src/generation-prompts.ts`

- `COVERAGE_DIRECTIVE_BY_AXIS.comparison` — a per-draft pin directive, e.g.
  "The target sentence MUST express a `<value>` comparison (comparative =
  superiority, superlative, equative = equality, less = inferiority). If the
  grammar point cannot naturally express this construction, use the closest
  natural one instead."
- Add `'comparison'` to the axis loop in `renderCoverageBlock` (line ~623).

### 4. Curriculum specs + floors — `packages/db/src/curriculum`

Floors chosen so each sum ≤ the base cell target (no cell growth):

| Point | Level | Floors | Sum |
|---|---|---|---|
| `tr-a1-comparative-superlative` | A1 (base 20) | comparative 12, superlative 6, less 2 | 20 |
| `de-a2-comparison` | A2 (base 30) | comparative 14, superlative 10, equative 6 | 30 |
| `es-a2-comparatives-superlatives` | A2 (base 30) | comparative 14, less 8, equative 8 | 30 |

- `de-a2-comparison`: replace the "No coverageSpec — degree is unpinnable"
  comment with the spec (the axis now makes it pinnable). DE has no `less`
  construction in-scope, so `less` is omitted.
- **ES target is `es-a2-comparatives-superlatives`** (name "Comparatives":
  `más/menos…que`, `tan…como`, irregular `mejor/peor/mayor/menor`) — the clean
  degree point. `es-b1-superlatives-comparisons` is deliberately **out of scope**:
  it is superlative-dominated by design and mixes in non-degree constructions
  (`más de` + quantity, elative `-ísimo`), a poor axis fit. It floors no
  `superlative` because that construction lives at B1.

`curriculum/index.ts` already validates spec floor values against
`COVERAGE_AXIS_VALUES` and enforces that non-`wordClass` axes are `grammar`-kind
only — all three points qualify, so adding `comparison` to `COVERAGE_AXIS_VALUES`
makes the specs automatically legal.

### 5. Versioning + rollout

- Bump `CURRICULUM_VERSION_TR`, `CURRICULUM_VERSION_DE`, `CURRICULUM_VERSION_ES`
  to `2026-07-18` (adding a `coverageSpec` is a curriculum change).
- `coverage_tags` is `jsonb` → **no DB migration**; the `CoverageTags` type change
  is compile-time only. No backfill of existing rows (monitoring is forward-only).
- After merge + deploy, for each of the three points, per generated exercise type:
  `pnpm demote:pool -- --language XX --cefr YY --type <type> --grammar-point <key>`
  (dry-run first, then `--apply`, against **prod** `DATABASE_URL` — local `.env`
  points at the dev branch). The next ~04:00 UTC scheduler tick refills the
  demoted cells under the new floors. Retrofitting a spec onto an at-target cell
  does nothing without this demotion step (the scheduler only assigns coverage
  targets to `need = target − approved` new drafts).

## Testing

- `packages/shared/src/coverage.test.ts` — `comparison` present in
  `COVERAGE_AXIS_VALUES`/`AXIS_ORDER`; `coverageAxesFor` returns it *only* when a
  spec controls it, never as default monitoring.
- `packages/ai/src/validate.test.ts` — a valid `comparison` value round-trips; an
  illegal one is dropped, never throws.
- `packages/ai/src/generation-prompts.test.ts` — the per-draft `comparison`
  directive renders for a targeted ordinal.
- `packages/db/src/curriculum/curriculum.test.ts` — the three specs are valid
  (legal values, positive-integer floors, no duplicate axis) and the three
  `CURRICULUM_VERSION_*` constants are bumped.
- Optional: an `eval:gen` A/B on the `tr-a1-comparative-superlative` cloze cell
  (repo baseline vs. repo candidate with the spec) to confirm the approved
  distribution shifts away from 90% comparative before spending the prod re-seed.

## Out of scope

- `es-b1-superlatives-comparisons` (poor axis fit — see above).
- Backfilling `comparison` tags onto the existing pool.
- Any change to the six existing axes or the water-fill scheduler.
