# Exclude Broken-Exercise Evidence From Progress — Design

**Date:** 2026-08-08
**Status:** Approved (design), pre-implementation
**Author:** brainstormed with nikolaivanv

## Problem

A learner's attempt on a *defective* exercise still counts as evidence against
them. When an exercise is later demoted because it was wrong — a spoiled
answer, a mis-declared `correctAnswer`, an ambiguous blank with no
`acceptableAnswers` — the attempt stays in `user_exercise_history` and keeps
dragging down `user_grammar_mastery`, the radar, the coach, and the weekly
email. Demotion deliberately never DELETEs (`demote-cell-pool.ts:19-23`), so
the bad evidence survives by design.

Measured in prod (`twilight-smoke-01114337`, branch
`br-green-waterfall-ancrvpr5`, 2026-08-08):

| `review_status` | history rows | users | points | avg score |
|---|---|---|---|---|
| `auto-approved` | 901 | 4 | 120 | 0.887 |
| `rejected` | 247 | 2 | 27 | 0.843 |
| `flagged` | 29 | 3 | 11 | 0.909 |

### Why "exclude everything rejected" is the wrong rule

`review_status = 'rejected'` conflates two unrelated things:

1. **Quality demotions** — the item was defective; the score is unjust evidence.
2. **Pool-hygiene demotions** — dedup sweeps (`dedup-sc-pool.ts`),
   topic-diversity cleanups (#617 demoted 406 rows), regeneration under fixed
   prompts. The item was answerable and the attempt was legitimate practice.

Category 2 dominates. A blanket exclusion would:

- drop **247 / 1177 rows (21%)** of all scored evidence;
- discard evidence that is *not* systematically worse — 0.843 vs 0.887 overall,
  and on `tr-a1-vowel-harmony` the rejected rows average **higher** (0.88) than
  the kept ones (0.84);
- **zero out three grammar points entirely** — `tr-a1-questions`,
  `tr-a1-gore-bence`, `tr-a1-comparative-superlative` are 100% rejected-sourced,
  so they would not merely drop, they would reappear as "never practiced".

### The right rule, measured

Restricting exclusion to genuinely-defective items:

| Exclusion rule | Rows dropped | Avg score of dropped | Points zeroed |
|---|---|---|---|
| All `rejected` | 247 / 1177 (21%) | 0.843 | 3 |
| **Genuinely broken** | **43 / 1177 (3.7%)** | **0.734** | **0** |

0.734 against a 0.887 kept average is the signature of items that marked the
learner down unfairly — the blanket set had no such signature. Per-point impact
(all one user):

| point | rows dropped | dropped avg | kept avg |
|---|---|---|---|
| `tr-a1-vowel-harmony` | 12 / 64 | 0.83 | 0.88 |
| `tr-a1-locative` | 11 / 53 | 0.91 | 0.90 |
| `tr-a1-personal-suffixes` | 8 / 93 | 0.88 | 0.89 |
| `tr-a1-plural-suffix` | 5 / 56 | **0.60** | 0.90 |
| `tr-a1-ablative-dative` | 2 / 39 | **0.08** | 0.88 |
| `tr-a1-imperative` | 1 / 27 | 1.00 | 0.86 |
| `tr-a1-present-continuous` | 1 / 56 | **0.00** | 0.83 |
| `es-b1-passive-se` | 1 / 5 | **0.00** | 0.75 |
| `es-b1-influence-verbs-infinitive` | 1 / 4 | 0.20 | 0.85 |
| `tr-a1-vocab-family-people` | 1 / 17 | 0.20 | 0.95 |

## Goals

1. Stop counting attempts on genuinely-defective exercises toward the learner's
   scores, retroactively and going forward.
2. Keep counting attempts on items demoted for pool hygiene.
3. Make demotion intent a recorded fact, so the distinction never again requires
   archaeology.

## Non-goals

- Re-evaluating past answers. Excluded attempts are dropped, not re-scored.
- Changing the mastery formula (`packages/db/src/mastery/update.ts`).
- Deleting history rows, `error_observations`, or any user data.
- Touching admin surfaces, which must keep showing raw unfiltered truth.

---

## 1. Provenance — `exercises.demotion_reason`

Today intent is only *partially* recoverable, and each demotion path leaves a
different trace:

| Path | Writes | Recoverable? |
|---|---|---|
| `revalidate-cloze-pool.ts:213-214` | `reviewStatus` **+ `flaggedReasons`** | yes — reasons present |
| `admin.ts:939-953` moderation reject | `reviewStatus` (from `flagged`, reasons already set) | yes — reasons present |
| `exercise-flags.ts:148` learner flag upheld | `reviewStatus` only | yes — via `exercise_flags.status='resolved_rejected'` + `admin_audit_log` `user_flag.reject` |
| `demote-cell-pool.ts:126` | `reviewStatus` only | **no** |
| `dedup-sc-pool.ts:158` | `reviewStatus` only | **no** |

Add one nullable column to `packages/db/src/schema/exercises.ts` (alongside
`flaggedReasons`, line 30):

```ts
// Why this row left the pool. Null for rows that were never demoted.
// 'quality' | 'learner-flag' exclude the row's attempts from learner scoring;
// 'duplicate' | 'pool-hygiene' keep them (the item was answerable).
demotionReason: text('demotion_reason'),
```

| value | meaning | evidence counts? |
|---|---|---|
| `quality` | validator / revalidator / admin judged the item defective | **no** |
| `learner-flag` | learner flagged it, admin upheld | **no** |
| `duplicate` | dedup sweep | yes |
| `pool-hygiene` | diversity, regeneration, other pool management | yes |

Migration via `pnpm --filter @language-drill/db exec drizzle-kit generate`
(forward-only, per CI/CD).

### 1a. Backfill the column (one-off, deterministic SQL)

Runs in this order; each step only touches rows still `NULL`:

```sql
-- 1. defect judged by validator/revalidator/admin — reasons are on the row
UPDATE exercises SET demotion_reason = 'quality'
 WHERE review_status = 'rejected' AND flagged_reasons IS NOT NULL;

-- 2. learner flagged it, admin upheld
UPDATE exercises SET demotion_reason = 'learner-flag'
 WHERE demotion_reason IS NULL
   AND id IN (
     SELECT exercise_id FROM exercise_flags WHERE status = 'resolved_rejected'
     UNION
     SELECT target_id::uuid FROM admin_audit_log
      WHERE action = 'user_flag.reject' AND target_type = 'exercise'
   );

-- 3. everything else that left the pool
UPDATE exercises SET demotion_reason = 'pool-hygiene'
 WHERE review_status = 'rejected' AND demotion_reason IS NULL;
```

Rows that are `flagged` (awaiting review) or approved keep `demotion_reason
IS NULL`, so their attempts continue to count. Flagged items are unadjudicated;
pre-judging them would exclude evidence on nothing more than a suspicion.

**Known, accepted gap:** `demote:pool` was also used for genuine quality sweeps
(self-revealing-target, cloze tense-determinacy, cloze answer/stem overlap).
Those rows wrote no `flagged_reasons` and carry no demotion timestamp, so
step 3 files them as `pool-hygiene` and their attempts keep counting. This
under-excludes; it never over-excludes. Accepted rather than guessed at — a
wrong guess would delete legitimate evidence, and the column makes this the
last time the ambiguity can arise.

### 1b. Maintain it going forward

| Site | Change |
|---|---|
| `demote-cell-pool.ts` | **required** `--reason <quality\|duplicate\|pool-hygiene>`; exits non-zero if absent |
| `dedup-sc-pool.ts:158` | writes `demotionReason: 'duplicate'` |
| `dedupe-conjugation-pool.ts` | writes `demotionReason: 'duplicate'` |
| `revalidate-cloze-pool.ts:213` | writes `demotionReason: 'quality'` on the demote branch |
| `exercise-flags.ts:148` | writes `demotionReason: 'learner-flag'` |
| `admin.ts:939-953` | moderation reject writes `demotionReason: 'quality'` |

---

## 2. The shared predicate

One definition, in `infra/lambda/src/lib/exercise-filters.ts` next to
`APPROVED_STATUSES` (line 25), re-exported for the `packages/db` scripts:

```ts
/** Demotion reasons whose attempts must not count toward learner scoring. */
export const NON_EVIDENCE_DEMOTION_REASONS = ['quality', 'learner-flag'] as const;

/** Drizzle predicate: this exercise's attempts are valid learner evidence. */
export function scoringEvidenceFilter(table: typeof exercisesTable) {
  return sql`coalesce(${table.demotionReason}, '') NOT IN ('quality', 'learner-flag')`;
}
```

`coalesce` rather than `notInArray` because SQL `NOT IN` yields NULL — not
true — for NULL inputs, which would silently drop every never-demoted row.
A plain column test also avoids a correlated subquery against `exercise_flags`
in each read path; per `drizzle-projection-subquery-unqualified`, a
`${table.column}` reference inside a projection subquery renders unqualified
and has already caused an ambiguous-column 500 in prod.

---

## 3. Rebuild stored mastery

`packages/db/scripts/backfill-mastery.ts` already replays
`user_exercise_history` through the live `replayHistory()` rule
(`packages/db/src/mastery/update.ts:90`), is idempotent, and dry-runs by
default. Add the predicate to its `where` array (lines 33-41), on by default,
with an `--include-demoted` escape hatch for before/after comparison.

Then run against prod with `--apply`.

---

## 4. Read-time surfaces

None of the score-bearing joins filter `review_status` today. Add
`scoringEvidenceFilter(exercises)` to each:

| Site | Surface |
|---|---|
| `routes/progress.ts:95` | `/progress/radar` — six skill axes |
| `routes/insights.ts:117` | `error_observations` → coach / growth zone |
| `routes/sessions.ts:1112` | session debrief skill-movements (replays the same mastery rule; without this the debrief contradicts the grammar map) |
| `email/gather.ts:29` | weekly summary accuracy + weak-spot selection |

Deliberately **not** filtered, with reasons:

| Site | Why not |
|---|---|
| `routes/admin.ts` (all) | admin surfaces show raw truth by design |
| session debrief item lists, activity counts | a record of what you did, not a score — you still did the work |
| `routes/user-export.ts` | data portability means the complete record |
| `routes/fluency.ts:84`, serve paths | eligibility/serving already gated by `approvedStatusFilter` |

`error_observations` rows are filtered at read, never deleted — the table
cascades from `user_exercise_history` and deletion would be irreversible.

---

## 5. Drift over time

Mastery is stored state, but demotion happens *after* the attempt. Every future
`quality` demotion silently re-invalidates `user_grammar_mastery` until the
backfill re-runs. Two mitigations:

1. `docs/runbooks/prompt-update-and-revalidate.md` gains a final step: after any
   quality demotion, run `pnpm backfill:mastery --apply`.
2. `demote-cell-pool.ts` prints the reminder on exit when `--reason quality`.

Read-time surfaces need no such step — they re-derive on every request.

---

## 6. Testing

| Area | Test |
|---|---|
| Predicate | `exercise-filters.test.ts` — NULL `demotion_reason` passes; `quality` / `learner-flag` excluded; `duplicate` / `pool-hygiene` pass |
| Replay | `mastery/update.test.ts` — a point whose only low score comes from a `quality` row rises when excluded; a point with zero surviving rows yields no mastery row rather than a zero-score one |
| Routes | one case per filtered surface (`progress`, `insights`, `sessions` debrief, `email/gather`) asserting excluded rows do not reach the aggregator — mocked db per `lambda-test-must-mock-db-turbo` |
| CLI | `demote-cell-pool.test.ts` — `--reason` required, value validated, persisted |
| Non-regression | admin pool-status counts unchanged |

Per project convention: tests written and passing before each task is marked
complete; full `pnpm lint && pnpm typecheck && pnpm test` before push.

## 7. Verification

Before/after diff of `user_grammar_mastery` over the ten affected points.
Expected: `tr-a1-ablative-dative` and `tr-a1-plural-suffix` rise visibly,
`tr-a1-present-continuous` and `es-b1-passive-se` shed a 0.00, no point loses
all evidence, and the 204 `pool-hygiene` rows still count. Captured by running
`backfill:mastery` dry-run with and without `--include-demoted` and diffing.

## Rollback

The column is additive and the predicate is one function. Reverting the code
restores prior behaviour; re-running `backfill:mastery --apply --include-demoted`
restores prior mastery values. No data is destroyed at any point.
