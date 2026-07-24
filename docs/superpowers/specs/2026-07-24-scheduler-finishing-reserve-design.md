# Scheduler finishing reserve + fair-share fix — design

**Date:** 2026-07-24
**Status:** approved (brainstorming), pending implementation plan
**Scope:** `infra/lambda/src/generation/cell-selection.ts` (+ its caller `scheduler.ts`, + tests). One coherent change to the pure fan-out selector. **Out of scope:** the adjective-declension carrier-phrase fix (rec 3 from `docs/analysis/generation-run-2026-07-24.md`) ships as a separate follow-up PR that starts with a generate-and-print reproduction.

## Problem

The nightly generation scheduler picks under-target cells with `selectCellsWithinCaps`, ranking strictly by `need` descending within a per-language fair-share cap. Two failure modes were confirmed in the 2026-07-24 run (see `docs/analysis/generation-run-2026-07-24.md`):

1. **Within-language starvation of near-complete cells.** All 50 DE cells that ran had `need ≥ 6` (18 at need 6–10, 32 at need >10). The 8 under-target sentence-construction cells (`need` 1–7, mostly ≤ 5) were deferred for a **second straight day with zero movement** — their approved counts were byte-identical to the prior day. Pure `need`-desc ordering actively deprioritizes cells that are almost done: a `need=1` cell that would close *permanently* in one draft is outranked by the chronic `need=19` tail indefinitely.

2. **Cross-language slot waste blocks redistribution.** ES reserved **50** cell-slots for cells needing only 1–2 drafts each (68 drafts across 50 cells). Because the reserved total (DE 50 + ES 50 + TR 20) hit **exactly** the 120 global cap, the redistribution branch in `selectCellsWithinCaps` never fired, so DE — which had ≥ 58 under-target cells — stayed capped at 50 and deferred its overflow (including every SC cell). Near-saturated languages consuming their full `perLangCap` with trivially-small-need cells is the trigger.

These are two levers on the same symptom, in the same pure function.

## Current behavior (baseline)

`selectCellsWithinCaps(undersized, globalCap, perLangCap)` — pure, deterministic (need desc, cellKey asc tie-break):

- **Reserve:** per language, keep the `perLangCap` highest-need cells.
- **Contention trim:** if `reserved.length ≥ globalCap`, keep the global top-`globalCap` of reserved by need.
- **Redistribute:** else, fill remaining global slots from leftover (per-language overflow) by need.

The redistribute branch only runs when `reserved.length < globalCap`. When every language brings a full (or near-full) share, that condition is false and no redistribution occurs — flaw 2.

## Design

Partition `undersized` by a need threshold `T` into **finishers** (`need ≤ T`) and **main cells** (`need > T`), then run four phases. The function stays pure and deterministic.

### Phases

| Phase | Input | Selects | Ordering | Purpose |
|---|---|---|---|---|
| **0 · Finishing reserve** | finishers | up to `R` cells | **need ASC**, cellKey asc | Guarantee near-complete cells close, even under full saturation. need-ASC because a `need=1` cell closes in one draft and leaves the under-target set forever — closest-first drains the finisher backlog fastest (maximizes cells-closed-per-run). |
| **1–3 · Fair-share** | main cells | the existing reserve/contention-trim/redistribute logic, verbatim | need DESC | Runs on `globalCap' = globalCap − |phase0 selected|` over only `need > T` cells. Its internal redistribute already consumes main-cell leftover (per-language overflow) up to `globalCap'`. Excluding finishers from the per-language reserve means a near-saturated language no longer burns its `perLangCap` on `need=1` cells, so redistribution can free DE's high-need overflow. **This is rec 2.** |
| **4 · Fill residual with finishers** | finishers not picked in phase 0 | fill any budget the main pool left unfilled | need DESC | Only fires when phases 1–3 didn't exhaust `globalCap'` (a light night where main cells < `globalCap'`). Main cells are the real backlog and get first claim on the shared budget; residual budget then closes more finishers so no capacity is wasted. |

**No competition between phases 3 and 4:** the fair-share (phases 1–3) fully consumes the main pool within `globalCap'` first; only genuinely unused budget reaches phase 4. Total selected is bounded: `|phase0| + |phases1–3| + |phase4| ≤ |phase0| + globalCap' = globalCap`.

The final `selected` is the union of the phases, with each cell selected at most once (a finisher picked in phase 0 is excluded from the phase-4 pool by construction). `deferredCount = undersized.length − selected.length`; `enqueuedByLanguage` counts over the union.

### Interface

```
selectCellsWithinCaps(
  undersized: readonly T[],
  globalCap: number,
  perLangCap: number,
  finishingThreshold: number,   // NEW — T
  finishingReserveSlots: number,// NEW — R
): CellSelectionResult<T>
```

The two new params are resolved in `scheduler.ts` from the environment, mirroring the existing `resolveMaxCellsPerRun` / `resolveMaxCellsPerLanguage` pattern (parse int; a non-numeric / zero / negative value falls back to the default so a fat-fingered env var can never disable the mechanism):

- `SCHEDULER_FINISHING_NEED_THRESHOLD` — default **5**
- `SCHEDULER_FINISHING_RESERVE_SLOTS` — default **8**

`T = 5` catches 6 of the 8 current DE SC cells directly in the reserve; `weil-deshalb` (need 7) rides the fair-share + redistribute path and closes within a night or two as budget frees up. `R = 8` is small enough not to distort the main fill while covering the current finisher-starvation case. Both are tunable via a one-line CDK prop change + deploy, exactly like the sibling `maxCellsPerRun`/`maxCellsPerLanguage` caps.

### Preserved invariants

- **Determinism** — need + cellKey tie-break, no clock/randomness.
- **`globalCap` is a hard ceiling** on total selected.
- **`perLangCap` still bounds high-need monopolies** (it now applies to main cells only; finishers are intentionally exempt — they are cheap and self-limiting because they leave the set on close).
- **Small-pool no-op** — when everything fits under all caps, all cells are selected (finishers via phase 0 + phase 4, main via redistribution).
- `deferredCount` and `enqueuedByLanguage` semantics unchanged, computed over the final union.

### Why not simpler alternatives

- **Rec 1 alone (reserve, no rec 2):** would let SC run within DE's 50 cap, but ES would keep burning 50 slots on near-saturated cells and DE's high-need overflow would still be deferred. Both flaws are real; fixing one leaves the other.
- **Rec 2 alone (no explicit reserve):** on today's numbers (only ~60 high-need cells vs cap 120) redistribution would fill ~60 finishers by need-DESC — but under saturation need-DESC drops the *lowest*-need (closest-to-done) cells, exactly the ones we want to close. The explicit closest-first reserve is the robustness guarantee for a saturated night.
- **Fractional threshold (need ≤ fraction of target):** would need the target inside the pure selector; keeping an absolute `need` threshold preserves the function's minimal `{cell, need}` interface.

## Testing

Extend `infra/lambda/src/generation/cell-selection.test.ts`. New cases:

1. **Today's scenario** — 58 DE main (need > 5) + 8 DE finishers (need 1–5) + 50 ES finishers (need 1–2), `globalCap=120, perLangCap=50, T=5, R=8`: DE finishers are served (closest-first), DE high-need overflow redistributes in, ES near-saturated cells fill via leftover — none of the three starve.
2. **Full-saturation guarantee** — main cells alone exceed `globalCap`: finishers still receive their `R` reserved slots (the reserve is carved before the main fill).
3. **Closest-first ordering** — within the reserve, `need=1` is picked before `need=5`.
4. **Reserve deduplication** — a finisher picked in phase 0 is not double-counted in redistribution; `selected` has no duplicates and `deferredCount` is exact.
5. **Env resolution** in `scheduler.test.ts` — `SCHEDULER_FINISHING_*` parse + fat-finger fallback to defaults, mirroring the existing cap-resolution tests.
6. **All existing invariants stay green** — no-op-when-fits, one-language-floods, full-contention monopoly bound, redistribution, determinism/tie-break, empty input, slack perLangCap.

## Rollout

- Pure-function change + a caller wiring two env-resolved constants. Ships with the Lambda code deploy (CDK on merge to main) — no Langfuse sync, no curriculum-version bump.
- Verifiable the morning after merge: the 8 DE SC cells should begin closing (approved counts move; `de-a2-weil-deshalb` etc. climb toward target) and the scheduler summary log's `enqueuedByLanguage` should show DE > 50 on a night ES is near-saturated.
- **Reversal / tuning:** the fat-finger guard means a zero/negative env value falls back to the default, so the env vars cannot *disable* the reserve — they only tune it (raise/lower `T` and `R`). Full reversal is a redeploy of the prior code. This is acceptable: the change is additive and low-risk. A dedicated kill-switch is out of scope; add one only if operational experience calls for it.
