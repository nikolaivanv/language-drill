# "Skills you moved" — per-grammar-point delta panel on the session debrief

**Date:** 2026-06-16
**Status:** Approved (design); pending implementation plan
**Scope:** Session debrief screen only. Spanish/all existing languages (uses the existing per-grammar-point mastery model; no language-specific work).

## Goal

After a drill session, show the learner **which grammar points moved and in which direction** — the honest, evidence-based replacement for the streak/XP dopamine hit, and the clearest expression of the product's "evidence-based, not time-based" progress model. It fills the slot the debrief explicitly reserved (`// No skill-delta section in v1 (Req 4.5)` in `debrief-tab.tsx`).

## Why now / why cheap

The hard part already exists:
- `userGrammarMastery` tracks per-`(user, grammarPoint)` `masteryScore` + `confidence` via a real Bayesian, difficulty-weighted, 30-day-decay model (`packages/db/src/mastery/update.ts` — `updateMastery`, `replayHistory`).
- The **vocabulary-review path already ships the same idea**: `POST /review/items/:stateId/submit` returns `masteryDeltas: { grammarPoint, from, to }[]`, computed by `computeMasteryDeltas` (`infra/lambda/src/lib/review/evidence.ts`) via a windowed replay that excludes the session's own rows to get `from` and includes them to get `to`.

So this is a **surfacing job**, not a modeling job, and it closes an inconsistency (reviews show movement; exercises/debrief don't).

## Decisions (from brainstorming)

| Decision | Choice |
|---|---|
| Surface | Session **debrief only** (not per-exercise) |
| Presentation | **Directional + banded**, with a confidence cue, **no raw numbers** |
| First-ever-practiced point | Distinct **`New · first evidence`** state (not a "gain") |
| Rows shown | **Movers only** (gain/slip/new), ordered by movement magnitude; steady points collapse to a `N held steady` summary line |
| Band thresholds | `|Δ| < 0.02` Steady · `+0.02…0.08` Gain · `≥ +0.08` Strong gain · `≤ −0.02` Slipped (tunable constants) |
| Confidence cue | `high` when point `confidence ≥ 0.6`, else `low` (tunable) |
| API payload | band + confidence only — **no `from`/`to` numbers** (banding done server-side) |

## Architecture

### Data flow
`GET /sessions/:id/debrief` →
1. load the session manifest + the session's exercise submission rows (already done for `items[]`),
2. determine the set of grammar points the session's graded exercises touched,
3. for each touched point, replay that `(user, language, grammarPoint)`'s `userExerciseHistory` **twice** — excluding vs including this session's submission rows — through the existing mastery model as of `now`, yielding `from → to`,
4. band each `from → to` into a `SkillMovement`,
5. attach `skillMovements: SkillMovement[]` to the response.

This mirrors `computeMasteryDeltas`'s exclude-set approach. Both `from` and `to` are computed **as of `now`**, so a debrief viewed long after the session reflects the session's marginal contribution consistently under decay. No new table, no migration.

> **Data dependency (verify at plan time):** the replay needs `userExerciseHistory` rows to carry `grammarPointKey`, `difficulty`, `score`, and a timestamp — the same fields the live submit-time update path consumes (`exercises.ts:398–449`). If a field is missing, the plan adds it to the history read or the replay-row mapping; no schema change is anticipated.

### Type
```ts
type SkillMovementBand = 'new' | 'strong-gain' | 'gain' | 'steady' | 'slip';
type SkillMovement = {
  grammarPointKey: string;
  label: string;            // human label for the grammar point
  band: SkillMovementBand;
  confidence: 'high' | 'low';
};
```
Deliberately **no `from`/`to`** — banding is server-side so the client cannot render raw scores. This is an intentional divergence from review `masteryDeltas` (which exposes numbers); it is the trust-presentation decision (raw mastery numbers expose model calibration and read as a score to farm).

### Components (each independently testable)
- **`skill-movements.ts`** (server lib, pure) — `computeSkillMovements(historyRows, sessionLogIds, now) → SkillMovement[]`. Sole home of the exclude-set replay + banding logic. Reuses `packages/db/src/mastery` (`replayHistory` / the `updateMastery` fold). Banding thresholds + confidence cutoff are named constants here.
- **debrief route** (`infra/lambda/src/routes/sessions` debrief handler) — gathers the touched grammar points + this session's submission row ids, calls the helper, adds `skillMovements` to the payload.
- **`DebriefResponseSchema`** (`packages/api-client/src/schemas/debrief.ts`) — add `skillMovements: z.array(SkillMovementSchema)`.
- **`SkillMovementsPanel`** (web, `apps/web/app/(dashboard)/drill/debrief/_components/`) — renders mover rows (banded arrow + label + confidence tag) and the `N held steady` summary; consumed in `debrief-tab.tsx` at the reserved slot.

### Presentation detail
- Bands → glyph + copy: `strong-gain` `▲▲ Strong gain`, `gain` `▲ Gain`, `slip` `▼ Slipped`, `new` `★ New · first evidence`, `steady` (not rendered as a row).
- Confidence shown as a small `· high confidence` / `· low confidence` tag (or a subtle dot), per the chosen mock.
- Order movers by band priority then magnitude (Strong gain → Gain → New → Slipped), or simply by `|Δ|` desc with New flagged — plan picks one; both acceptable.
- Steady points: a single muted line `N held steady` (omit if zero).

## Edge cases
- **All-skipped / no graded items** → `skillMovements: []` → panel hidden entirely.
- **First-ever practice** (no prior evidence rows for the point) → `band: 'new'`, regardless of magnitude.
- **Multiple exercises on one point in the session** → one aggregated movement (the replay folds them).
- **Only steady movement** → no mover rows; show just `N held steady` (or hide the panel if that reads as empty — plan decides, default: show the steady line).

## Out of scope
- Per-exercise inline delta cue (rejected — noisy, gamified feel).
- A `userGrammarMasteryHistory` / snapshot table and mastery-trajectory charts (Option C) — premature; the as-of-`now` replay needs no history table.
- A standalone per-grammar-point mastery **map** on `/progress` — on-mission but a separate feature.
- Exposing raw `from`/`to` numbers anywhere in the exercise/debrief surface.
- Changing the mastery model itself.

## Testing
- **`skill-movements.test.ts`** (pure): each band boundary (steady/gain/strong-gain/slip), `new` for no-prior-evidence, multi-exercise aggregation onto one point, exclude-set correctness (`from` excludes the session rows, `to` includes them), empty input → `[]`, confidence high/low cutoff.
- **schema test**: `SkillMovement` round-trips; `DebriefResponse` accepts `skillMovements`.
- **debrief-route test**: response includes `skillMovements`; assert **no numeric `from`/`to`** leak into the payload.
- **web component test**: renders the right glyph/copy per band, renders the `N held steady` line, shows **no numerals**, and hides when `skillMovements` is empty.
- Full gate before push: `pnpm lint && pnpm typecheck && pnpm turbo run test --concurrency=1`.

## Files touched (anticipated)
**New:**
- `infra/lambda/src/lib/debrief/skill-movements.ts` (+ `.test.ts`)
- `apps/web/app/(dashboard)/drill/debrief/_components/skill-movements-panel.tsx` (+ test)

**Modified:**
- `packages/api-client/src/schemas/debrief.ts` (`SkillMovement` type + `skillMovements` field)
- the `GET /sessions/:id/debrief` route handler (assemble `skillMovements`)
- `apps/web/app/(dashboard)/drill/debrief/_components/debrief-tab.tsx` (render the panel at the reserved slot)
</content>
