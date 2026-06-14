# Personalized Drill Plan — Design

_Date: 2026-06-13. Addresses items 1, 2, and 4 of
`docs/generation-pipeline-pedagogical-assessment.md` ("Recommended actions")._

## Problem

The generation/validation pipeline produces a psychometric-grade item bank, but
**serving is random draw** at a user-chosen difficulty. Three gaps follow:

1. **No exposure control.** No draw site excludes exercises the user has already
   attempted, so a daily user re-sees items within weeks. An *unscheduled* repeat
   inflates the mastery signal (practice effect) without a retention test —
   contaminating any future mastery model.
2. **The daily plan under-uses production.** The fixed shape is 3× cloze + 1
   translation + 1 vocab; sentence construction (the most open production type we
   generate) never appears in the plan.
3. **No mastery-driven selection.** Per-grammar-point mastery is not stored, the
   curriculum's `prerequisiteKeys` graph is dead data at serve time, and the
   today-plan's adaptive hook (`_radarSnapshot`) is a deliberate no-op.

## Scope

In scope (this spec):

- **Exposure control** on all three pool-draw sites: `GET /exercises`,
  `POST /sessions`, and `GET /sessions/today` Path B (`sampleFreshPool`).
- **Swap plan slot 2** (core cloze) → sentence construction. The SC pilot brake
  was lifted 2026-06-08 (`cell-targets.ts`), so the precondition is already met.
- **Materialized per-grammar-point mastery** (`user_grammar_mastery`), updated on
  submit via an asymmetric, difficulty-weighted, recency-decayed Bayesian rule,
  plus a one-off backfill that replays existing history.
- **Mastery-aware selection** in the today-plan only: bias grammar-point pick
  toward low/missing-evidence points; soft-deprioritize points whose prerequisites
  lack positive evidence (cold-start safe).

Out of scope: replacing the radar aggregation (stays history-derived, untouched);
mastery bias on `GET /exercises` / `POST /sessions` (exposure control only there);
empirical difficulty calibration (assessment item 3/5); curriculum backfill (item
6). CEFR estimation and the grammar-mastery-map UI are downstream consumers of the
new table but are not built here.

---

## Section 1 — Exposure control

A single `ORDER BY` clause expresses both "prefer never-seen" and the
least-recently-seen (LRS) fallback. Each candidate is LEFT JOINed to a per-user
last-seen aggregate over `user_exercise_history`:

```sql
LEFT JOIN (
  SELECT exercise_id, max(evaluated_at) AS last_seen
  FROM user_exercise_history
  WHERE user_id = $user
  GROUP BY exercise_id
) seen ON seen.exercise_id = exercises.id
...
ORDER BY (seen.last_seen IS NOT NULL),  -- never-seen (false=0) sorts first
         seen.last_seen ASC,            -- among seen: oldest first (LRS fallback)
         random()                       -- random tiebreak within never-seen
```

Properties:

- **Never starves.** Attempted items still appear, just after all fresh ones, so a
  user who has exhausted a cell's fresh pool still gets a plan (their oldest-seen
  items first).
- **No schema change.** Uses the existing
  `user_exercise_history_exercise_id_evaluated_at_idx`.
- **Per-user.** The subquery is parameterized by `userId`.

Applied at:

- `routes/exercises.ts` `GET /exercises` — single draw (`LIMIT 1`).
- `routes/sessions.ts` `POST /sessions` — N-item manifest (`LIMIT exerciseCount`).
- `routes/sessions.ts` `sampleFreshPool` — each UNION-ALL per-type subquery gets
  the join and ordering (replacing bare `ORDER BY random()`).

The session-hydration read (Path A) and debrief are unchanged — they project a
stored manifest, not a fresh draw.

---

## Section 2 — Sentence construction in the daily plan

Change `V1_PLAN_SHAPE` slot 2 from `CLOZE` to `SENTENCE_CONSTRUCTION`
(`infra/lambda/src/lib/today-plan.ts`). The plan becomes:

| Slot | Prefix | Type |
|---|---|---|
| 1 | warm-up | cloze |
| 2 | core | **sentence_construction** |
| 3 | production | translation |
| 4 | core | vocab_recall |
| 5 | cool-down | cloze |

- `sampleFreshPool` derives its type set from `V1_PLAN_SHAPE`, so SC is fetched
  automatically.
- `composeFreshPlan` backfill already covers a cell with no SC pool yet (the slot
  is filled by another available type via `BACKFILL_TYPE_PRIORITY`; SC is appended
  to that priority list so a missing cloze slot can also borrow SC). The plan is
  never empty as long as any approved item exists.
- `ESTIMATED_MINUTES_BY_TYPE` / `ITEM_COUNT_BY_TYPE` already carry SC entries.
- Update the plan-shape tests and any snapshot of the composed plan.

---

## Section 3 — Materialized mastery table

New table, modeled on `docs/progress-tracking.md` (`user_grammar_mastery`):

```
user_grammar_mastery (
  user_id            text  not null,   -- FK users.id
  language           text  not null,
  grammar_point_key  text  not null,   -- FK-by-convention to curriculum key
  mastery_score      real  not null,   -- 0..1
  confidence         real  not null,   -- 0..1
  evidence_count     integer not null,
  last_practiced_at  timestamptz not null,
  updated_at         timestamptz not null,
  primary key (user_id, grammar_point_key)
)
index on (user_id, language)           -- selection reads per (user, language)
```

`grammar_point_key` already encodes language (e.g. `es-b1-present-subjunctive`);
`language` is denormalized for the selection query's filter. Drizzle schema lives
in `packages/db/src/schema/progress.ts`; forward-only migration via
`pnpm db:migrate`.

### Update rule (pure function)

`updateMastery(prev | null, obs) → next` in a new `infra/lambda/src/lib/mastery/`
module (TDD'd; holds all math). `obs = { score: number; difficulty: CefrLevel; at: Date }`.

Reused constants from `progress-aggregation.ts`: `difficultyWeight` (A1=0.5 …
C2=1.5) and the 30-day recency half-life.

1. **First observation** (`prev === null`): `mastery = score`,
   `evidence_count = 1`, `confidence = 1 − exp(−1 / K_EVIDENCE)`,
   `last_practiced_at = updated_at = at`.
2. **Subsequent observation**:
   - **Recency-decay the prior weight.** `decay = exp(−daysSince(prev.last_practiced_at, at) / HALFLIFE)`;
     stale mastery pulls less, so new evidence dominates (Ebbinghaus).
   - **Prior weight.** `priorW = PRIOR_BASE · prev.evidence_count · decay`.
   - **Asymmetric, difficulty-weighted observation weight:**
     ```
     obsW = score ≥ prev.mastery_score
              ? difficultyWeight(difficulty)                       // gain: reward hard-correct
              : (DW_MAX + DW_MIN − difficultyWeight(difficulty))   // loss: punish easy-error
     ```
     With DW range [0.5, 1.5] (pivot 2.0): C2-correct → 1.5 (big gain), A1-error →
     1.5 (big drop), A1-correct / C2-error → 0.5 (small). This realizes
     "correct-on-hard rewarded, error-on-easy punished."
   - **Combine (Bayesian average):**
     `mastery = clamp01((priorW · prev.mastery_score + obsW · score) / (priorW + obsW))`.
   - `evidence_count += 1`; `confidence = 1 − exp(−evidence_count / K_EVIDENCE)`;
     `last_practiced_at = updated_at = at`.

Constants (`PRIOR_BASE`, `K_EVIDENCE`, and the `HALFLIFE` reuse) are defined in the
module and tuned under test; the structure above is fixed. Confidence is stored as
an evidence-based value; idle decay for *reads* is applied in selection (Section 4)
via `last_practiced_at`, so confidence need not be recomputed on read.

### Wiring on submit

In `POST /exercises/:id/submit` (`routes/exercises.ts`), after the
`user_exercise_history` insert and only when `exercise.grammarPointKey` is present:
read the existing mastery row, compute `updateMastery`, and upsert
(`ON CONFLICT (user_id, grammar_point_key) DO UPDATE`). Same transaction-adjacent
position as the history/usage inserts; a mastery-write failure must not fail the
submission response (best-effort, logged), since the authoritative signal is the
history row.

### Backfill CLI

A one-off `pnpm` script (`packages/db` or `infra/lambda` scripts, alongside
`revalidate:cloze`) that, per user, replays `user_exercise_history` joined to
`exercises.grammar_point_key` ordered by `evaluated_at ASC` through the same
`updateMastery` function, then upserts the final row per (user, grammar point).
Idempotent (recomputes from scratch; safe to re-run). Dry-run by default,
`--apply` to write, `--user`/`--language` filters. This seeds the author's existing
history rather than cold-starting.

### Relationship to existing progress

Additive. The radar (`routes/progress.ts` + `progress-aggregation.ts`) keeps
computing from history and is **not** changed. `user_grammar_mastery` is a new
serving/selection input and the foundation for the future grammar-mastery-map UI
and CEFR estimation.

---

## Section 4 — Mastery-aware selection (today-plan only)

Path B of `GET /sessions/today` gains mastery bias; `GET /exercises` and
`POST /sessions` get exposure control only.

### Candidate fetch

`sampleFreshPool` over-fetches per type (cap e.g. 20/type), exposure-ordered
(Section 1), and now also selects `grammar_point_key`. `PoolDraw` gains
`grammarPointKey: string | null`.

### Ranking (pure function)

`rankPlanCandidates(candidates, masteryByPoint, curriculumIndex) → PoolDraw[]` in
`lib/mastery/` re-orders **within each type** (exposure order is the base; mastery
priority is layered on top). Priority per candidate combines:

- **Gap bias.** Points with no mastery row (missing evidence) or low recent
  mastery rank highest; the 0.3–0.7 growth zone is boosted. Idle decay applied via
  `last_practiced_at` so stale evidence counts as a partial gap.
- **Soft prerequisite deprioritize.** For a candidate's grammar point, if any
  `prerequisiteKeys` entry lacks *positive evidence* (no row, or mastery below a
  small threshold), apply a multiplicative priority **penalty** — never exclusion.
  This activates the prerequisite graph and is cold-start safe: a new user (no
  mastery anywhere) simply sees foundation points (no prereqs) float up while
  advanced points are penalized but still selectable, so the plan is never emptied.

Candidates with `grammarPointKey === null` (or a key absent from the curriculum
index) receive a neutral priority — never penalized to the bottom.

### Assembly

`composeFreshPlan` already consumes per-type FIFO queues via `shift()`, so feeding
it pre-ranked queues makes it pick the highest-priority item per slot with no
change to its assembly logic. Its dead `_radarSnapshot` parameter is removed; the
ranking is performed in the route (or a thin helper) before `composeFreshPlan`.

---

## Testing

- **`updateMastery`** (unit, TDD): first-observation init; hard-correct > easy-correct
  gain; easy-error > hard-error drop; recency decay reduces prior pull; confidence
  monotonic in evidence; clamping to [0,1].
- **`rankPlanCandidates`** (unit, TDD): gap bias ordering; growth-zone boost;
  prerequisite penalty (soft, never excludes); cold-start (empty mastery) yields a
  full non-empty ranking; null/unknown grammar key handled neutrally.
- **Exposure ordering** (per draw site): never-seen before seen; LRS among seen;
  never starves when all items attempted; per-user isolation.
- **Plan shape** (today-plan): slot 2 is SC; backfill when no SC pool; SC item
  count/minutes correct.
- **Backfill CLI**: replays history deterministically; idempotent; dry-run writes
  nothing.
- `pnpm lint && pnpm typecheck && pnpm test` green before push (note:
  `pnpm turbo run test --concurrency=1` to avoid the known infra parallel flake).

## Rollout / ordering

1. Exposure control (Section 1) — independent, ship-safe first.
2. SC slot swap (Section 2) — independent one-liner + tests.
3. Mastery table + update rule + submit wiring + backfill (Section 3).
4. Mastery-aware selection (Section 4) — depends on 3.

Sections 1–2 are independently valuable and carry no dependency on 3–4.
