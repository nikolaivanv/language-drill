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

## Coverage-tag backfill — the 12 held cells

Ran `backfill:coverage-tags --include-partial` (the widened selector) per cell,
`--concurrency 8`, one cell at a time. **413 rows tagged, $6.09, zero failures**
(`skipped-unusable 0, skipped-no-coverage 0, failed 0` in all 12). Verified
after: all **418** approved rows in those cells carry the spec axis, 0 still
missing, 0 NULL — and all 418 retained `polarity`, confirming the merge added
without dropping.

Cost ran **$0.0165/row**, about double the ~$0.008/row extrapolated from
`revalidate:cloze`. Budget future coverage-tag passes at the higher rate.

Neon snapshot before the write: `pre-coverage-tags-backfill-2026-08-14`
(`br-mute-breeze-antnqqmi`). Taken because the merge *can* overwrite an existing
`polarity`/`sentenceType` value if the validator reads one differently, and
there is no per-row artifact for that.

## Post-repass audit — `prod-post-repass-2026-08-14`

| | before | after |
|---|---|---|
| Rows scanned | 25,033 | 24,202 |
| Declared-but-unrealized | 182 | 176 |
| **At target (stuck)** | **93** | **8** |
| Below target (self-heals) | 89 | 168 |

The demote did what it was meant to: stuck cells became below-target cells the
scheduler will refill. `unrealized` barely moves because the mechanisms stay
unrealized *until* the refill happens — again, read composition, not the
summary.

### The 12 held cells were worth holding — quantified

| | audit demanded | true, after tagging |
|---|---|---|
| Cells with a deficit | 12 | **6** |
| Rows of headroom | **199** | **30** |

Six were **pure phantoms** — `es-a2-comparatives-superlatives` translation,
`es-b1-reciprocal-se` translation, `tr-a1-locative` translation, both
`es-a2-indirect-object-pronouns-se` cells, and `tr-a1-ablative-dative`
translation now show no deficit at all. Their content was always fine.

`es-a2-comparatives-superlatives` cloze is the clearest case: the audit reported
`comparative: 0/14`; the truth is **37** (nearly 3× the floor). Real shortfalls
exist only on `less` (4/8) and `equative` (2/8) — 10 rows, not the 30 the audit
computed against untagged rows.

**Generalizable rule: when `audit:collapse` reports an axis at 0-realized across
an entire cell, check whether the rows carry the key at all before demoting.**
A spec axis added after a pool was generated produces exactly this signature,
and the audit cannot distinguish it from real collapse.

## A defect in this repass's headroom sizing

Each cell's demote was sized as its *axis deficit*. That is wrong for cells
already **over** target: a cell gains headroom only once `approved` drops
**below** `target`, so the correct size is `approved - target + deficit`.

Five of the 80 demoted cells were over target; four still dropped below. One did
not: **`DE:A1:vocab_recall:de-a1-vocab-food-drink`** — 24/10, demoted 4, now
20/10, still at target and **still stuck**. Four rows spent for no headroom
(recoverable from the artifact). So the repass created headroom in 79 of 80
cells, not 80.

Any future worklist built this way must use `approved - target + deficit`.

## Pass 2 — DONE (79 rows, 10 cells)

Run after the 04:00 UTC generation, against a **fresh** audit
(`prod-pass2-2026-08-14`, $0.00). Re-auditing was not optional: the pass-1
worklist below was computed at ~02:20 UTC, before the run added 511 rows, and
acting on it would have been wrong in both directions.

**It came out as 10 cells / 79 rows, not the 8 / 64 predicted below.** Three
cells the 04:00 run refilled to target came back **still short of their floors**
and re-entered the stuck set:

| cell | approved | deficit |
|---|---|---|
| `ES:B1:cloze:es-b1-conditional` | 75/75 | 9 |
| `ES:B1:sentence_construction:es-b1-conditional` | 75/75 | 3 |
| `ES:B2:translation:es-b2-compound-tenses` | 75/75 | 3 |

This is the multi-pass convergence predicted above, now observed: oldest-first
demotion removes rows from the starved buckets too, so a cell needs two or three
cycles. **A repass is a loop, not a one-shot.**

Sized with the corrected `max(0, approved - target) + deficit`. Verified after:

| cell | before | after | target |
|---|---|---|---|
| `de-a1-vocab-food-drink` | 20 | **6** | 10 |
| `es-a2-comparatives-superlatives` cloze | 50 | 20 | 30 |
| `es-b1-conditional` cloze | 75 | 66 | 75 |
| `es-b1-reciprocal-se` cloze | 50 | 48 | 50 |
| `tr-a1-accusative-definite-object` cloze | 20 | 14 | 20 |

`de-a1-vocab-food-drink` is the proof the formula fix mattered: pass 1 demoted 4
and left it at 20/10 — still above target, still stuck. Pass 2 demoted 14 and it
is finally below target at 6/10.

Artifact: `collapse-repass-pass2-2026-08-14-rollback.json` (79 ids, all
`auto-approved`, zero overlap with pass 1's 831). The runner takes `--pass <n>`
so each pass writes its own worklist/artifact pair — a shared path would let
pass 2 clobber the only fine-grained record of pass 1's rows.

`ES:A1:translation:es-a1-quantifiers-muy-mucho` remains **held**: 18 of 20 rows
carry no recognized variant id, so its `underMin` counts cannot be sized
honestly until they are classified. Recorded in the worklist's `held` field
rather than silently dropped.

## Pass-1 remaining worklist (superseded by Pass 2 above)

| cell | now | need | demote |
|---|---|---|---|
| `DE:A1:vocab_recall:de-a1-vocab-food-drink` | 20/10 | 4 | 14 |
| `ES:A2:cloze:es-a2-comparatives-superlatives` | 50/30 | 10 | 30 |
| `TR:A1:cloze:tr-a1-accusative-definite-object` | 20/20 | 6 | 6 |
| `TR:A1:translation:tr-a1-accusative-definite-object` | 20/20 | 6 | 6 |
| `ES:A2:cloze:es-a2-direct-object-pronouns` | 30/30 | 3 | 3 |
| `ES:A2:translation:es-a2-direct-object-pronouns` | 30/30 | 3 | 3 |
| `ES:B1:cloze:es-b1-reciprocal-se` | 50/50 | 2 | 2 |
| `ES:A1:translation:es-a1-quantifiers-muy-mucho` | 20/20 | 10 | **hold** |

The held cell is still 18/20 unlabelled (the #640 classifier declined to guess),
so its variant counts remain meaningless. Label before demoting.

**Do this only after the refill loop is proven** — see below.

## The refill loop is CONFIRMED working — and the run ran out of credits

The first post-resume nightly run fired **2026-08-14 04:00 UTC**. Two checks,
both clean:

**1. The scheduler targeted exactly the cells the demote freed.**
`requested_count` matches the per-cell demote counts one-for-one — not
approximately:

| cell | demoted | requested |
|---|---|---|
| `es:b2:translation:es-b2-compound-tenses` | 27 | 27 |
| `es:b1:translation:es-b1-conditional` | 30 | 30 |
| `es:b2:cloze:es-b2-complex-conditionals` | 23 | 23 |
| `es:b1:translation:es-b1-present-subjunctive` | 26 | 26 |
| `es:a2:translation:es-a2-por-para` | 14 | 14 |

**2. New rows went to the starved values, not the concentrated ones.** For
`es-b1-conditional` cloze, all 19 new rows landed on the three under-floor
persons and **zero** on the two over-represented ones:

| person | before | now | new |
|---|---|---|---|
| 1sg | 32 | 24 | **0** |
| 3sg | 17 | 14 | **0** |
| 2sg | 12 | 13 | +7 |
| 3pl | 7 | 12 | +6 |
| 1pl | 7 | 12 | +6 |

This validates the entire basis for partial demotion. It also shows convergence
takes **more than one pass**: floors are 15 and the cell sits at 12/13/12,
because oldest-first demotion also removed rows *from* the starved buckets.
Expect two or three cycles per cell, not one.

### Credit exhaustion cut the run 69% short

Of 120 jobs: **37 succeeded, 83 failed**, every failure the same —
`Your credit balance is too low to access the Anthropic API`. The run spent
**$17.00 in 16 minutes** (04:00 → 04:16), hit zero at 04:17, and the remaining
83 jobs failed instantly.

So only **511 of the 831** freed slots refilled; the pool is still ~320 rows
below its pre-repass size. The failed jobs are not lost — they self-recover on
the next 04:00 UTC run once the balance is topped up. **Nothing alarms on
this**, so it is invisible unless `generation_jobs.status` is checked directly.

Contributing factor worth recording: the coverage-tag backfill on this branch
spent **$6.09** (plus $0.82 for the pilot) about 90 minutes earlier, on the same
account that funds nightly generation. Against a balance with roughly $17 of
headroom that is a material fraction, and it likely brought the exhaustion point
forward. **Check available credit before discretionary AI spend on this
account** — a $7 backfill is not free if it displaces a night of generation.

## Pass 3 — the held cell, and why it was never a labelling problem

`ES:A1:translation:es-a1-quantifiers-muy-mucho` was held out of both passes
because 18 of its 20 rows carried no recognized variant id. The assumption was
that the #640 classifier had simply failed on them. It had not.

**The rows realize TWO variants at once.** Nearly every source sentence pairs
`muy` + adjective with post-verbal `mucho`: "This museum is very old **and I
like it a lot**". The classifier must return one variant id, so it correctly
declined. Worse, **15 of 20 rows sit on that single frame** — "[X] is very [ADJ]
and I like it a lot" — which the audit had already flagged
(`monotonyFlagged: true`, top lemma "very" at **95%**). The unlabelled rows were
a symptom; the monotony was the harm.

**The cloze cell needed nothing.** It is fully labelled (`unrecog 0`) with one
clean gap (`mucho-after-verb` at 0) and sits *below* target, so rotation seeds
the starved variant on the next run. A cloze has one blank and can therefore
only realize one construction — that structural difference is the whole story.

### The fix is point-level, not prompt-level

The translation variant directive says "use exactly this sub-construction; **do
not substitute another**" — which forbids swapping constructions but not
*stacking* them. The `sentence_construction` branch got a stronger clause in
#648 ("do not offer it as one option among several: a single scorable target");
translation has no equivalent.

Widening that globally was considered and **rejected on the evidence**: other
contrast points label at ~90% under the same wording (`por/para` 5/29,
`de-b1-es-expressions` 5/48, `que-vs-cual` 6/39). This point is the outlier at
90% unlabelled because its three constructions are natural collocates in one
English sentence in a way `por`/`para` are not.

So each of its three variant directives now carries an explicit **sibling
exclusion** ("The sentence must realize ONLY this construction: no muy
anywhere, and no post-verbal mucho…"). Blast radius: one point. No
`GENERATION_PROMPT_VERSION` bump, no Langfuse push — directives are curriculum
data interpolated into the user prompt. Four tests pin the exclusions;
discrimination verified by stripping a clause and confirming three fail.

No `CURRICULUM_VERSION_ES` bump either: the demote puts both cells below target,
so the scheduler enumerates them anyway, and a bump would needlessly clear
suppression across every other ES cell.

### The demote had to pin rows by id

18 rows demoted — but **not** oldest-first. The two correctly-labelled rows sat
at age ranks **2 and 16**, so an oldest-first cut of 18 would have destroyed
both and kept two unlabelled ones: the exact inverse of the intent. The runner
now accepts an `ids` array per worklist cell, resolved *through* that cell's own
approved-row set so a stray id cannot widen the selection — it throws rather
than guessing.

Verified after: the only two survivors are "My sister is very happy today."
(`muy-intensifier`) and "There are many trees in the park."
(`quantifier-agreeing-with-noun`) — both single-construction, neither carrying
the trailing clause. Cell is 2/20; `mucho-after-verb` at 0 will be the first
variant the deficit-ranked picker targets.

**Generalizable:** oldest-first is the right default only when age correlates
with quality. When the rows worth keeping are the *correctly-shaped* ones rather
than the newest, pin by id.

## Still outstanding

- **Credits topped up 2026-08-14.** Confirm the next 04:00 UTC run clears the
  83-job backlog *and* fills the 910 rows now freed (831 + 79).
- **Expect a pass 3.** Convergence takes two or three cycles per cell, so
  re-audit after the next run rather than assuming the deficits closed. Cells
  that refill to target while still under floor silently re-enter the stuck set
  — they are invisible unless the audit is re-run.
- `es-a1-quantifiers-muy-mucho` is resolved (pass 3 above). **Check its refill
  specifically**: the sibling-exclusion directives are unproven until rows
  generate under them. If new rows still pair `muy` with post-verbal `mucho`,
  the exclusion wording is not strong enough and the prompt-level clause becomes
  the fallback.
- Re-run `audit:collapse` once cells refill, to confirm the deficits closed.
- The 168 below-target cells need no action; they self-heal.
- Deferred #634 calibration items are unchanged: stem-monotony measures each
  point's own target lexeme, no `gender` axis exists, `sentence_construction`
  collapse is measured on the prompt rather than the answer.
