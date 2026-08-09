# Scheduled Mastery Rebuild — Design

**Date:** 2026-08-09
**Status:** Approved (design), pre-implementation
**Author:** brainstormed with nikolaivanv

## Problem

Stored `user_grammar_mastery` goes stale whenever a demotion revokes evidence,
and nothing corrects it automatically.

#629 made attempts on defect-demoted exercises stop counting toward scores. The
read-time surfaces (radar, coach, grammar map, weekly email accuracy) re-derive
per request and self-correct on the next page load. **Stored mastery does not.**
`pnpm demote:pool --reason quality` prints a reminder to re-run
`backfill:mastery`, but the paths an admin actually uses day to day print
nothing:

- upholding a learner flag (`infra/lambda/src/routes/exercise-flags.ts`)
- content-moderation reject (`infra/lambda/src/routes/admin.ts`)
- `POST /admin/revalidate`

After any of those, the grammar map and the weekly email's weak-spot selection
keep serving the stale unjust score until someone remembers to run a CLI. That
is the same "debrief contradicts the grammar map" contradiction #629 cited as
its reason for filtering `sessions.ts`.

## The blocker: the replay is lossy

Automating today's `backfill:mastery` would make an existing latent bug
systemic.

`user_grammar_mastery` has **two** writers, both via `applyGrammarMastery`
(`infra/lambda/src/routes/exercises.ts:117`), which folds each observation into
the *stored* row:

1. **Host** — the exercise's own `grammar_point_key`. One
   `user_exercise_history` row per submission. Replayable.
2. **Incidental** — `incidentalObservations()`
   (`infra/lambda/src/lib/mastery/incidental-fold.ts`) turns evaluator errors
   attributed to *other* grammar points into negative evidence for those
   points. **No history row names them** — history records the exercise
   answered, not the rules broken.

The replay reads host history only and overwrites, so every incidental
contribution on a point that also has host history is discarded. Run manually
and rarely, that is a small loss. Run nightly, incidental evidence would have a
lifespan of at most 24 hours — while still feeding the coach, the grammar map,
and drill ranking.

Measured on prod 2026-08-09: after the #629 rebuild, all 137 mastery rows match
their host-history count exactly — the flattening has already happened once.

### It is recoverable

The same `result.errors` that `incidentalObservations` folds into mastery are
also persisted to `error_observations` by `errorObservationsFromEvaluation`
(`packages/db/src/errors/observations.ts`, called from
`infra/lambda/src/lib/errors/record.ts`). That table carries
`error_grammar_point_key`, `severity`, `occurred_at`, `exercise_id` and
`exercise_history_id` — everything the fold needs, since severity maps to score
and difficulty comes from the exercise join.

Prod holds **322 error observations, 44 of them incidental, across 22 distinct
grammar points**.

## Goals

1. A rebuild reproduces what the live submit path would have written — no
   silent loss.
2. Stored mastery self-heals within 24h of any evidence-revoking demotion.
3. An unattended run cannot quietly destroy data.

## Non-goals

- Changing the mastery formula (`updateMastery`).
- Event-driven or incremental rebuilds. At five users a full replay is
  milliseconds; watermark state would be complexity with nothing to buy.
- Reminder plumbing on the admin routes — the schedule replaces the need.
- Preserving incidental evidence whose source `error_observations` row has been
  deleted. That table cascades from `user_exercise_history`; if the history row
  is gone, so is the evidence, by design.

---

## 1. Faithful replay

`replayHistory(rows)` currently accepts only `HistoryRow[]`. It becomes a fold
over a **merged, chronologically ordered observation stream** built from two
sources:

| source | score | difficulty | timestamp |
|---|---|---|---|
| `user_exercise_history × exercises` | `history.score` | `exercises.difficulty` | `evaluated_at` |
| `error_observations × exercises` | `SEVERITY_SCORE[severity]` (minor 0.4, major 0) | **the violated point's `cefrLevel`** via `getGrammarPoint(errorGrammarPointKey)` — *not* the host exercise's difficulty | `occurred_at` |

**Correction (2026-08-09, caught in review of Task 4).** An earlier draft of this
table said the incidental row's difficulty is `exercises.difficulty`. That is
wrong, and wrong in a way that would have defeated the whole design. The live
path (`infra/lambda/src/routes/exercises.ts`) folds each incidental observation
at `getGrammarPoint(obs.grammarPointKey).cefrLevel` — the CEFR level of the
point that was *violated* — and `continue`s past any point missing from the
curriculum. Because `updateMastery` weights a losing observation by
`DW_PIVOT - dw`, difficulty is load-bearing: a major error on a fresh A1 point
folds to 0.1250 at A1 but 0.1786 at B2. And the bias is systematic, not
occasional — attribution keys come from `grammarPointsAtOrBelow(language,
exercise.difficulty)`, so an incidental point is at or below the host's
difficulty by construction, meaning the host-difficulty version would
*systematically under-penalize* on every non-A1 exercise. The replay must
perform the same curriculum lookup and the same skip.

Three details separate faithful from approximately-faithful:

**Ordering.** `updateMastery` is sequential, asymmetric and recency-decayed, so
the result depends on the order observations are folded. Incidentals must
interleave with host observations exactly as they did live. At submit the host
score is applied first and the incidental fold follows, so **host sorts before
incidental at equal timestamps**. Sort key: `(timestamp, sourceRank)` with host
rank 0, incidental rank 1.

**Per-submission dedup.** `incidentalObservations` drops errors whose
`grammarPointKey` equals the host point, and collapses multiple errors on the
same point *within one submission* to the worst (lowest) score. The replay must
reproduce that: group by `(exercise_history_id, error_grammar_point_key)`, take
the minimum severity score, and exclude rows where `error_grammar_point_key` is
NULL or equals `host_grammar_point_key`. Without the grouping, a submission
with three errors on one point folds three observations instead of one.

**Exercise types whose submit path actually folds.** The free-writing branch of
`POST /exercises/:id/submit` calls `recordErrorObservations` and then returns —
it never calls `incidentalObservations`, so free-writing errors have **never**
contributed to mastery. Their `error_observations` rows are nonetheless fully
eligible for the query above (free-writing exercises carry a non-null umbrella
`grammar_point_key`, and their errors carry attributed curriculum keys). Left
unscoped, the replay would inject penalties the live path never applied, and the
nightly diff would never settle to zero.

The observation query is therefore scoped to the exercise types whose submit
path folds incidentally. Whether free-writing errors *should* count toward
grammar mastery is a real product question, but it is a **change to the live
path**, not part of making the replay faithful — so it is out of scope here and
recorded as a follow-up.

**Evidence eligibility.** `scoringEvidenceFilter` applies to the observation
query too. An error recorded against a defect-demoted exercise is exactly as
untrustworthy as the attempt that produced it.

### The invariant this buys

A faithful replay is a **no-op unless something changed**. That makes the
nightly diff itself the signal: a normal run reports 0 moved; non-zero means a
demotion landed (expected) or the replay and the live path have diverged (a
bug). This is the acceptance criterion for the whole feature.

`evidenceCount` counts every folded observation, host and incidental alike —
matching the live path, where each `applyGrammarMastery` call increments it.

## 2. Structure

The rebuild core lives in `packages/db/scripts/backfill-mastery.ts`, which a
Lambda cannot import. Extract it to `packages/db/src/mastery/rebuild.ts`,
exported from the barrel:

- `packages/db/src/mastery/rebuild.ts` — loads both observation sources, merges,
  replays, computes upserts + deletions + the diff, and applies them. Takes an
  options object (`apply`, `includeDemoted`, `userFilter`, `languageFilter`,
  `maxDeletes`) and a `Db`. Returns a structured result; prints nothing.
- `packages/db/scripts/backfill-mastery.ts` — thin CLI wrapper: parses argv,
  calls the core, renders the report.
- `infra/lambda/src/mastery/rebuild-handler.ts` — thin Lambda wrapper: calls the
  core, logs the summary, enforces the breaker.

One implementation, two entry points. The existing report renderer stays pure
and shared.

## 3. Scheduled Lambda

`MasteryRebuildLambdaConstruct` (`infra/lib/constructs/mastery-rebuild-lambda.ts`),
following `EmailDispatcherLambdaConstruct`:

- `NodejsFunction` + EventBridge rule, **03:00 UTC daily** — clear of the 04:00
  generation and theory crons and of the author's active hours (UTC+2).
- Rule gated on the existing `enableScheduledJobs` prop (prod on, dev off). The
  Lambda is always created so dev can invoke it manually.
- `DATABASE_URL` from Secrets Manager only. No Anthropic key, no AI cost.
- Log group and retention matching the sibling constructs.

### Circuit breaker

`MASTERY_REBUILD_MAX_DELETES`, default `5`, read from the environment.

If a run's computed deletions exceed it, the run **writes nothing at all** — not
a partial apply — logs the flagged `(user, language, grammarPointKey)` triples,
and throws. The throw increments the Lambda `Errors` metric, which raises an
alarm on the existing SNS topic (`AlertsConstruct`).

Rationale: routine self-healing stays automatic, but a systemic mistake stops
and asks for a human. Aborting wholesale rather than applying-then-alarming
keeps the failure state easy to reason about — either the run happened or it
did not.

The breaker lives in the shared core, parameterised: `maxDeletes` is a number or
`null`. The Lambda passes the env value (default 5); the CLI passes `null`,
keeping its current unbounded behaviour, since it is human-gated by a dry-run
the operator reads first.

## 4. Testing

| Area | Test |
|---|---|
| Merge ordering | host sorts before incidental at an equal timestamp; a known interleaving folds to the expected state |
| Per-submission dedup | three errors on one point within one submission fold as **one** worst-score observation |
| Host-point exclusion | an error attributed to the host point does not double-count |
| Evidence eligibility | an observation on a defect-demoted exercise is excluded |
| Fidelity | a synthetic sequence replayed through the core equals the same sequence folded through `updateMastery` call-by-call, as the live path does |
| Idempotence | replaying the same inputs twice yields identical state |
| Breaker | deletions above the threshold ⇒ nothing written, triples logged, throws |
| Breaker off-by-one | deletions exactly at the threshold ⇒ applied normally |
| CDK synth | rule created only when `enableScheduledJobs`; schedule is 03:00 UTC; `DATABASE_URL` wired; no Anthropic secret |

Existing `backfill-mastery.test.ts` coverage — the delete predicate, the three
safety properties, the rebuilt/deleted/stale partition — must keep passing
against the extracted core.

## 5. Rollout

1. Merge + deploy. The cron is live in prod immediately (dev off).
2. **Before the first scheduled run**, invoke the rebuild manually once. This
   run restores incidental contributions on the ~22 affected points, so expect
   **visible score movement** — unlike every run after it. Read the diff.
3. Confirm the next scheduled run reports ~0 moved. A non-zero diff on a quiet
   night means the replay and the live path have diverged; investigate rather
   than accept.

Rollback: set `enableScheduledJobs` false (or remove the rule) to stop the
schedule; `backfill:mastery --apply --include-demoted` restores the pre-#629
evidence selection.

## Risks

- **Fidelity is asserted by tests, not proven against live data.** The
  step-2 manual run is the real check: after it, a rebuild on an unchanged
  database must be a no-op. If it is not, the replay is still lossy somewhere.
- **`error_observations` predates the incidental fold's current shape.** Rows
  written before `errorGrammarPointKey` attribution existed carry NULL and are
  correctly skipped, so early history rebuilds slightly "cleaner" than it was
  lived. Acceptable and one-directional.
- **The breaker threshold is a guess.** Five is chosen because the design
  predicts zero deletions in steady state; any run deleting more than a handful
  is anomalous by construction. Tune via env without a deploy.
