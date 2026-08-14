# Collapse repass — production, 2026-08-14

_First run of the `audit:collapse` (#634) worklist against production, and the
first since #640 labelled 1,766 rows with real `constructionVariants` ids. The
audit re-run was `--dry-run` (748 cells, **$0.00**, zero LLM calls); the demote
that followed wrote to the production Neon branch
(`br-green-waterfall-ancrvpr5`). Supersedes the `--dry-run` inventory in
`pool-collapse-baseline-2026-08-11.md` (#635), whose worklist was computed
against the unlabelled pool._

## The headline counters moved by almost nothing — and that is not the story

| | #635 (2026-08-11) | this run |
|---|---|---|
| Cells scanned | 752 | 748 |
| Declared-but-unrealized | 184 | 182 |
| — at target (stuck) | 94 | 93 |
| — below target (self-heals) | 90 | 89 |
| Cells carrying unlabelled rows | 51 | **25** |
| Unrecognized-seed rows | 1,939 | **173** |

Exactly the trap recorded after #640: both summary counters are booleans over
conditions that merely *shifted terms* (`unrecognizedSeedCount` → `underMin`)
when the backfill labelled the rows. Read per-cell composition, never the
summary. The findings are now `underMin` — i.e. we can finally see *which*
variant is thin rather than only that a cell is unlabelled — which is what made
this repass actionable at all.

## Partial demotion, not wholesale

The #635 doc says at-target cells "need a manual demote" without saying how
much. Reading the two refill mechanisms settles it:

- `pickVariantSeeds` (`packages/shared/src/construction-variant-seed.ts`) ranks
  variants by deficit against fair share and seeds the most starved first.
- `decideCoverageTargets` (`infra/lambda/src/generation/coverage-decision.ts`)
  water-fills each axis, repeatedly picking the lowest-count value.

Both short-circuit on `need <= 0`. So an at-target cell is stuck **purely for
lack of headroom** — not because its rows are wrong. Creating *some* headroom is
sufficient; the schedulers then self-target the starved values.

That is **831 rows**, not the **3,764** a wholesale demote of the 93 at-target
cells would have destroyed.

## 13 of the 93 at-target cells were excluded

### 12 tagging-gap cells — 413 rows that must NOT be demoted

Their rows *are* tagged; they simply lack the axis the spec is short on. All 50
`es-a2-comparatives-superlatives` cloze rows carry
`{polarity, sentenceType}` and **zero** carry `comparison`: the axis was added
to the `coverageSpec` after the pool was generated. The audit's "0/14
comparative" is missing bookkeeping, not missing content, and demoting on it
would have destroyed 418 possibly-sound exercises — the same mistake #635
warned about for `seedWord`, one column over.

| cell | rows | missing axis | tagged but missing it |
|---|---|---|---|
| `ES:A2:cloze:es-a2-comparatives-superlatives` | 50 | `comparison` | 50 |
| `ES:A2:translation:es-a2-comparatives-superlatives` | 50 | `comparison` | 50 |
| `ES:B1:cloze:es-b1-reciprocal-se` | 50 | `person` | 49 |
| `ES:B1:translation:es-b1-reciprocal-se` | 50 | `person` | 49 |
| `TR:A1:translation:tr-a1-locative` | 38 | `number` | 38 |
| `ES:A2:cloze:es-a2-direct-object-pronouns` | 30 | `number` | 30 |
| `ES:A2:translation:es-a2-direct-object-pronouns` | 30 | `number` | 29 |
| `ES:A2:cloze:es-a2-indirect-object-pronouns-se` | 30 | `number` | 29 |
| `ES:A2:translation:es-a2-indirect-object-pronouns-se` | 30 | `number` | 29 |
| `TR:A1:cloze:tr-a1-accusative-definite-object` | 20 | `number` | 20 |
| `TR:A1:translation:tr-a1-accusative-definite-object` | 20 | `number` | 20 |
| `TR:A1:translation:tr-a1-ablative-dative` | 20 | `case` | 20 |

**`coverage_tags IS NULL` is 0 in every one of these cells**, so
`backfill:coverage-tags` as written selected *nothing* here — a no-op on
precisely the rows that need it, the same bug class as the `seedWord IS NULL`
guard that made the #631 variant backfill a no-op on 96% of its rows. Fixed by
`--include-partial` (see the CLI's header); the widened selector reaches **413**
of these rows.

### 1 cell still substantially unlabelled

`ES:A1:translation:es-a1-quantifiers-muy-mucho` — 18 of 20 rows carry no
recognized variant id (the #640 classifier declined to guess), so its variant
counts are not yet meaningful. Held.

## What was demoted

**831 rows across 80 cells, `--reason pool-hygiene`.**

| language | cells | rows |
|---|---|---|
| ES | 49 | 534 |
| TR | 27 | 268 |
| DE | 4 | 29 |

By mechanism: 516 rows coverage-spec, 315 rows construction-variants. No cell
had both — the two deficits are disjoint across the whole worklist.

`pool-hygiene` is the correct reason and the choice is load-bearing: these rows
under-cover a declared mechanism, they are not defective. `quality` and
`learner-flag` are the two `NON_EVIDENCE_DEMOTION_REASONS`, which would revoke
learners' credit for past attempts and require a `backfill:mastery` rebuild.
Nothing was deleted — rows move to `review_status = 'rejected'`.

## Rollback

`collapse-repass-2026-08-14-rollback.json` records all 831 primary keys **and
each row's prior status** — 826 `auto-approved`, 5 `manual-approved`. The prior
status matters: a revert that assumed `auto-approved` would silently flatten the
5 hand-curated rows. Committed to the repo deliberately; the #640 artifacts
ended up untracked outside it and are irreplaceable.

```
pnpm --filter @language-drill/db exec tsx scripts/collapse-repass-2026-08-14.ts \
  --revert docs/analysis/collapse-repass-2026-08-14-rollback.json --apply
```

## The run itself — one incident

The first `--apply` **timed out after 54 of 80 cells (582 of 831 rows)**. Phase 2
issued one `UPDATE` per row: 831 sequential round trips to Neon. Both paths now
chunk by id (200/batch).

Re-running `--apply` would have caused real damage rather than merely repeating
work: the 582 already-demoted rows now read as `rejected`, so
`selectRowsToDemote` skips them and returns the *next-oldest* approved rows —
demoting a second, unplanned tranche, and overwriting the artifact so the first
tranche's ids became the only unrecorded evidence of what happened. `--resume`
therefore works **only** from the captured id list and never re-selects. It
reported 582 already demoted / 249 remaining, completed to 831/831, and per-cell
counts were then verified independently in SQL (e.g. `tr-b1-olarak` translation
50→42 against a planned limit of 8).

## Sequencing caveat, recorded because it was overridden knowingly

Generation had **not** provably resumed when the demote ran. #646 flipped the
cron on 2026-08-13, but the last `generation_jobs` row was `2026-07-25T04:23Z`
and there were zero jobs in the preceding 48h — the first post-resume nightly
run (04:00 UTC) had not yet fired. Demoting ahead of that confirmation shrinks
the pool with nothing yet proven to refill it. The recommendation was to pilot
one cell and wait; the decision was to proceed with all 80.

**Open follow-up:** confirm the 04:00 UTC run fired, and that the freed slots
are being targeted at the starved variants and axis values rather than refilling
the same concentrated surfaces. Nightly capacity is 120 jobs; historical yield
ranged 352–3,719 approved rows per night depending on backlog, so 831 rows is
roughly one to three nights.

## Still outstanding

- Run `backfill:coverage-tags --include-partial` over the 12 tagging-gap cells
  (413 rows), then re-audit them. **This CLI calls the validator even in
  dry-run** — only the write is gated by `--apply` — so a dry run costs the same
  as an apply.
- Re-run `audit:collapse` after the pool refills to confirm the deficits closed.
- The 89 below-target cells need no action; they self-heal.
- Deferred #634 calibration items are unchanged: stem-monotony measures each
  point's own target lexeme, no `gender` axis exists, `sentence_construction`
  collapse is measured on the prompt rather than the answer.
