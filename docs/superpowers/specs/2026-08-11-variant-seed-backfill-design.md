# Variant-seed backfill — label the legacy pool so the #631 repass can proceed

**Date:** 2026-08-11
**Status:** Approved (design); pending implementation plan
**Scope:** One pure classifier module in `packages/ai/src`, one CLI in
`packages/db/scripts`. No schema change, no migration, no `CURRICULUM_VERSION_*`
bump, no Langfuse push, no runtime path. Writes one JSON field on existing rows.

## Goal

Label the approved cloze/translation pool of the 31 `constructionVariants` points
with the variant id each row actually realizes, so that `pickVariantSeeds` and
`pnpm audit:collapse` can both see real coverage. This is the prerequisite step
of the PR #631 repass; the demote is a separate, later decision.

## What the pool actually looks like

The #631 design's backfill recipe assumes unlabelled rows and guards its `UPDATE`
with `AND content_json->>'seedWord' IS NULL` ("don't clobber a row already
backfilled"). Measured against production on 2026-08-11, across the 31
variant-bearing points, cloze + translation, approved statuses only:

| `seedWord` state | rows | cells |
|---|---|---|
| has a value | **2176** | 61 |
| null | 94 | 2 |

So that guard makes the recipe a **no-op on ~96% of the rows**. They are not
unlabelled — they carry a *frequency word* (`abran`, `acepto`, `alejado`) from the
pre-variant seeding path. Of the 2270 rows, roughly 331 already carry a correct
declared variant id (`hearsay-dicen-que`, the `damit-*` ids), leaving ~1939 to
classify.

This is therefore an **overwrite**, not a fill.

**Overwriting the frequency word is safe.** For a variant-bearing point,
`seedKindFor` takes the `'construction-variants'` branch ahead of the
`'frequency'` branch for cloze/translation, so the frequency-band exclude set
(`fetchPriorSeeds`) is never consulted for these cells again. The stored word is
dead information. `_dedupKey` is a separate field and is untouched.

## Why an LLM classifier

The declared variants are frequently distinguished by syntax, not lexeme.
`es-b1-que-vs-cual` declares `que-definition-of-concept`, `que-before-noun` and
`fronted-preposition` — all three answer *qué*. Separating them requires reading
the sentence. A regex over `correctAnswer` cannot do it, and a per-point rule
table that could would be a small parser per point.

Regex remains adequate for the lexically-distinct connector families
(`ama`/`fakat`/`ancak`), but building two mechanisms for a one-off backfill is not
worth it — the LLM path covers both.

## Design

### Units

| Unit | Home | Responsibility |
|---|---|---|
| `variant-seed-classifier.ts` | `packages/ai/src` | **Pure.** Prompt, forced tool, parser. Takes a `GrammarPoint` and a batch of rows. No I/O, no `db` import. |
| `backfill-variant-seeds.ts` | `packages/db/scripts` | SQL, batching, cost guard, artifact, apply/revert. |

`packages/db` depends on `@language-drill/ai` (not the reverse), and
`backfill-coverage-tags.ts` is the precedent: a `db` CLI importing the LLM
helpers from `ai`. The CLI mirrors it — dry-run by default, `--apply` to write,
plus `--language`, `--cefr`, `--grammar-point`, `--limit`, `--concurrency`,
`--max-cost-usd`.

### Classification

One call per batch of ~20 rows **within a single cell**, so the system block (the
point's description plus its full declared variant list) is identical across the
batch and prompt-caches. Each row contributes only learner-visible content:
`sentence` + `correctAnswer` for cloze, `sourceText` + `referenceTranslation` for
translation.

The forced tool returns, per row: `{ rowId, variantId | null, confidence }`.

Three rules carry the design:

1. **`null` is a first-class answer.** The prompt states that "none of these"
   is correct and expected. A wrong label is materially worse than no label: an
   unrecognised key is *ignored* by `pickVariantSeeds`, whereas a wrong variant id
   counts toward the wrong quota and corrupts the deficit ranking until someone
   re-keys the row.
2. **Only `high` confidence writes by default.** `--min-confidence medium`
   widens it deliberately. Rows left unclassified keep their frequency word and
   count toward no variant — which is exactly today's behaviour, so a conservative
   run is never worse than not running at all.
3. **Rows already carrying a declared variant id are skipped.** The pass is
   resumable and re-runnable, and the ~331 already-correct rows are untouched.

**Scope guard:** the CLI refuses any cell that is not cloze/translation on a point
declaring `constructionVariants`. There is no legitimate reason to write a variant
id anywhere else.

### Write mechanics

Every write is `jsonb_set(content_json, '{seedWord}', …)` **keyed on the row's
primary key**, applied one row at a time in autocommit, stopping at the first
failure. (An earlier draft of this spec said "batched in a transaction per
cell"; the shipped code deliberately does not. A per-cell transaction would
roll a cell back on failure, which sounds safer but is worse here: undo is
artifact-based, and an artifact whose `appliedCount` says "the first N rows
were written" is a precise description only if writes commit in order. The
absence of a transaction is the design, not a regression.)

This is the substantive departure from #631's recipe, which pattern-matches
content in the `WHERE` clause
(`content_json->>'referenceTranslation' ~ '^\s*Dicen que'`). There, a
slightly-wrong regex silently relabels rows nobody inspected. Here the classifier
decides, the dry run shows exactly which ids receive which value, and SQL only
applies decisions by id. Nothing is matched at write time.

### Rollback — two independent paths

**Neon branch snapshot.** `--apply` *requires* `--snapshot <branch-id>`, with
`--no-snapshot` as an explicit escape hatch, so the snapshot cannot be skipped by
accident. The branch id is recorded in the artifact header.

**Mapping artifact** at `./backfill-runs/<name>.json`, written in dry-run *and*
apply: one entry per row, `{ id, cellKey, oldSeedWord, newSeedWord, confidence }`.
The same CLI replays it in reverse via `--revert <artifact>`.

Both, because they fail differently. The branch covers a mid-run crash or partial
write. The artifact gives a *surgical* undo that does not also roll back learner
attempts and mastery rows written meanwhile — on a live database an
all-or-nothing restore is its own hazard.

## Verification

**Unit tests on the pure parser**, mirroring `parseTriageVerdict`: a `variantId`
not declared on that point, an unknown confidence, a returned `rowId` that was not
in the batch, and `null` handling.

**Unit tests on the eligibility selector**: skips points without
`constructionVariants`, skips rows already carrying a declared id, skips exercise
types other than cloze/translation.

**Dev rehearsal**: a full `--apply` against the Neon dev branch before production.

**Acceptance gate — a closed loop.** After applying, re-run
`pnpm audit:collapse --dry-run` and confirm `unrecognizedSeedCount` collapses
toward zero and the per-variant spread becomes meaningful. The audit shipped in
PR #634 is the acceptance test for this change. If the numbers do not move as
predicted, revert and diagnose before proceeding.

## Rollout and consequence

The backfill is **inert**: it labels rows and removes nothing, so it is safe to
run while nightly generation is paused. Nothing leaves the pool and no learner
sees a change.

Its real effect is on the *inventory*. Today's declared-but-unrealized figures are
computed against ~1939 rows counting toward no variant, so every variant reads as
under-covered and the 94/90 at-target/below-target split recorded in PR #635 is
pessimistic. After the backfill those numbers are accurate for the first time, and
the repass worklist should **shrink** — cells that currently read "at target,
stuck, needs a demote" may prove to have adequate spread already.

Sequencing: **backfill → re-run the audit → then** decide the demote and the
generation resume against real numbers.

## Out of scope

- The demote itself (`pnpm demote:pool --reason pool-hygiene`) and resuming
  nightly generation. Both are separate decisions this work informs.
- Other seed kinds: conjugation lemmas, `elicitationSeedValues`, vocab targets.
- Any change to `seedWord` semantics, `pickVariantSeeds`, or the curriculum.
- A regex fast-path for the lexically-distinct connector families.

## Related

- `docs/superpowers/specs/2026-08-08-construction-variants-design.md` — #631, whose
  repass this unblocks; note its backfill SQL and its row-count figures are both
  stale against the current pool
- `docs/superpowers/specs/2026-08-11-pool-collapse-audit-design.md` — #634, the
  audit that measured this and is the acceptance gate
- `docs/analysis/pool-collapse-baseline-2026-08-11.md` — the baseline inventory
- `packages/db/scripts/backfill-coverage-tags.ts` — the CLI shape this mirrors
- `packages/db/src/generation/run-one-cell.ts` — `loadVariantCoverage`,
  `fetchPriorSeeds`, `seedKindFor`
