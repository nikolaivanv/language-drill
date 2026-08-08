# Mastery ceiling fix — seed a first observation against a neutral prior

**Date:** 2026-08-08
**Status:** Approved (design); pending implementation plan
**Scope:** `packages/db/src/mastery/update.ts` + a re-run of the existing mastery backfill. No schema change, no migration, no UI change.

## Goal

Stop a single first observation from pinning a grammar point at the extremes of the mastery scale — in practice, at `1.0`, from which the only available movement is down.

## The problem

`updateMastery` early-returns on the first-ever observation for a point:

```ts
if (prev === null) {
  return { masteryScore: clamp01(obs.score), confidence: confidenceFor(1), evidenceCount: 1, ... };
}
```

The raw score becomes the mastery estimate outright, with no shrinkage. One perfect answer sets the point to exactly `1.0`. Every subsequent observation — including correct ones, since `CORRECT_THRESHOLD` is `0.7` and a "correct" answer routinely scores 0.82–0.92 — is then below the estimate, takes the `DW_PIVOT - dw` punishment branch, and drags mastery down.

**This is not an edge case.** In production, **86 of 137** tracked `(user, grammar_point)` pairs (62.8%) had a perfect first observation and sit on that ceiling.

### Observed failure

Session `ec7dd00f-8c41-4d0e-ad5e-d7aa4b45ebc1`, point `es-b1-impersonal-plural`. One prior row (2026-07-29) scored `1.0` → mastery `1.000`, confidence `0.181`. Five session answers scored `0.82, 0.92, 1.00, 0.88, 1.00` — all at or above `CORRECT_THRESHOLD`, so the debrief header read **"you got 5 of 5 · accuracy 100%"**. Replay:

```
BEFORE  mastery 1.0000  confidence 0.181
AFTER   mastery 0.9270  confidence 0.699
DELTA  -0.0730  →  band 'slip'
```

The debrief showed **"nice work."** above **"slipped · we're confident"** — on a flawless session.

> The confidence half of that contradiction is fixed separately on branch
> `fix/debrief-movement-confidence` (gate the movement cue on
> `min(before, after)` confidence). That change stops the panel *overstating*
> the slip; it does not stop the slip existing. This spec addresses the cause.

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Fix location | The mastery model (`updateMastery`), not the debrief presentation |
| Mechanism | Seed a **virtual prior state** and run the first observation through the existing averaging step |
| `NEUTRAL_PRIOR` | `0.5` |
| `PRIOR_PSEUDO_COUNT` | `0.5` (weak — half a virtual observation) |
| `evidenceCount` semantics | Unchanged: counts **real** observations only; the pseudo-count is weight, never evidence |
| Existing rows | Rebuilt via the existing idempotent backfill; `user_exercise_history` is untouched |
| Band/threshold constants | Unchanged (`STEADY_EPS`, `STRONG_GAIN_DELTA`, `CORRECT_THRESHOLD`) |

## Architecture

### The change

Replace the `prev === null` early return with a virtual prior fed through the **same** code path as every later observation:

```ts
const base = prev ?? {
  masteryScore: NEUTRAL_PRIOR,
  evidenceCount: PRIOR_PSEUDO_COUNT,
  lastPracticedAt: obs.at,   // ⇒ days = 0 ⇒ decay = 1
};
```

No new branch in the math. `evidenceCount` for the returned state is still `(prev?.evidenceCount ?? 0) + 1`, so `confidence` after one real row remains `confidenceFor(1) = 0.181`.

### Resulting seed values

The existing asymmetric weight (`obs.score >= base.masteryScore ? dw : DW_PIVOT - dw`) makes the seed **difficulty-aware for free** — a perfect answer on a C2 item seeds higher than on an A1 item. Verified against the formula:

| first score | A1 | A2 | B1 | B2 | C1 | C2 |
|---|---|---|---|---|---|---|
| 1.00 | 0.750 | 0.792 | **0.821** | 0.844 | 0.861 | 0.875 |
| 0.90 | 0.700 | 0.733 | 0.757 | 0.775 | 0.789 | 0.800 |
| 0.70 | 0.600 | 0.617 | 0.629 | 0.637 | 0.644 | 0.650 |
| 0.50 | 0.500 | 0.500 | 0.500 | 0.500 | 0.500 | 0.500 |
| 0.00 | 0.125 | 0.139 | 0.156 | 0.179 | 0.208 | 0.250 |

`0.5` is the fixed point, as it must be.

### Effect on the observed failure

Replaying session `ec7dd00f` under the new rule:

```
BEFORE  mastery 0.8214  confidence 0.181
AFTER   mastery 0.9021  confidence 0.699
DELTA  +0.0807  →  band 'strong-gain'
```

A 5-of-5 session now reads as a gain.

### Call sites — one change covers both

- **Live path:** `infra/lambda/src/routes/exercises.ts:144` calls `updateMastery(existing[0] ?? null, …)` incrementally against the stored row.
- **Replay path:** `replayHistory` folds the same function; used by the backfill and by `lib/debrief/skill-movements.ts`.

## Rollout

Order matters. New points pick up the new rule the moment the Lambda deploys, but existing `user_grammar_mastery` rows keep their ceiling values until rebuilt.

1. Merge + deploy the `updateMastery` change.
2. `pnpm backfill:mastery` (dry-run default) against production — capture the old→new diff per point.
3. Review the diff, then `pnpm backfill:mastery --apply`.

The backfill (`packages/db/scripts/backfill-mastery.ts`) already exists, is idempotent, recomputes each row from scratch, and reads only `user_exercise_history` — which this change never touches, so the operation is repeatable and recoverable.

> **Gap the plan must close.** The script's dry-run today prints only a row
> *count* (`[dry-run] Would write N mastery rows …`). It never reads the
> existing `user_grammar_mastery` values, so it cannot produce the old→new
> diff that step 3's review gate depends on. Adding that reporting is a
> prerequisite task, not an optional extra.

## Blast radius

Everything downstream reads `masteryScore`. In dependency order:

- **`lib/mastery/rank.ts` / `rank-context.ts`** — selection ranks weakest-points-first, so 86 points dropping off `1.0` will reshuffle what gets served. **This is the risk worth measuring, not assuming** — hence the dry-run diff gate above.
- **`lib/curriculum-map.ts` + `/progress`** — cell colors shift down for thin points. Expected and arguably more honest.
- **`email/gather.ts`** — re-engagement emails select on mastery.
- **`lib/debrief/skill-movements.ts`** — early "slips" largely stop existing. The intended effect.

## Edge cases

- **First observation of exactly `0.5`** → seeds `0.5` at every difficulty (the fixed point). Correct.
- **First observation with a hint penalty** (`evidenceWeight < 1`) → shrinks `obsW`, pulling the seed *toward* `NEUTRAL_PRIOR`. Desirable: a hinted first answer is weaker evidence.
- **`clamp01` on the first observation** — for a well-formed `obs.score ∈ [0,1]` the weighted average of it and `NEUTRAL_PRIOR` is necessarily in `[0,1]`, so the clamp stops being load-bearing there. It is **not** removed: `obs.score` is not validated at the call site, so the clamp still guards malformed input as well as later observations.
- **A point whose only row is a `0.0`** → seeds `0.156` (B1) rather than `0.0`, so it is no longer pinned at the floor either. The fix is symmetric by construction.

## Out of scope

- The debrief headline (accuracy → movement). Separate project, depends on this landing first.
- The movement-confidence gate — already on `fix/debrief-movement-confidence`.
- Changing `CORRECT_THRESHOLD`, the band thresholds, `HALFLIFE_DAYS`, `K_EVIDENCE`, or `DIFFICULTY_WEIGHTS`.
- Retiring the dead `spaced_repetition_cards` table (referenced only by the schema barrel and the GDPR export).
- Any UI or copy change.

## Testing

- **`packages/db/src/mastery/update.test.ts`** — extend:
  - the seed table above (at minimum `1.0` and `0.0` at A1/B1/C2, plus the `0.5` fixed point);
  - `evidenceCount === 1` and `confidence === confidenceFor(1)` after one observation (guards against the pseudo-count leaking into evidence);
  - a hinted first observation seeds closer to `NEUTRAL_PRIOR` than an unhinted one;
- **Existing test churn — measured, not predicted.** A throwaway application of the change was run against both suites. Exactly **one** test breaks: `update.test.ts` → `'initializes from the first observation'`, which asserts `masteryScore ≈ 0.8` for a first score of `0.8` and now yields `0.6929` at B1. Every other case survives, including all 11 in `skill-movements.test.ts` — the ones that fold from a fresh point are written as *relative* comparisons (`toBeGreaterThan`, band identity) rather than absolute values, so the shifted seed moves both sides equally. When updating that one test, re-derive the expectation from the new rule rather than pasting the observed number, so the assertion still encodes intent.
- **Regression test** replaying session `ec7dd00f`'s six real rows and asserting the band is no longer `slip`.
- **Backfill dry-run** against production: report how many points move, the mean and max absolute shift, and the top-20 reshuffle in weakest-first rank order.
- Full gate before push: `pnpm lint && pnpm typecheck && pnpm test`.

## Files touched (anticipated)

**Modified:**
- `packages/db/src/mastery/update.ts` — two constants + the `prev === null` branch
- `packages/db/src/mastery/update.test.ts` — seeding cases
- `infra/lambda/src/lib/debrief/skill-movements.test.ts` — `ec7dd00f` regression case

**Unchanged but affected at runtime:** `routes/exercises.ts`, `lib/mastery/rank*.ts`, `lib/curriculum-map.ts`, `email/gather.ts`, `scripts/backfill-mastery.ts`.
