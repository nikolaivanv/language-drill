# Pool Coverage Controller — Phase 1 Design

_Spec for Phase 1 of the [pool coverage controller](../../pool-coverage-controller.md):
**coverage-aware scheduler, person axis only**. Replaces blind ordinal person
rotation with deficit-driven targeting plus a per-bucket give-up, validating the
whole closed loop on the one axis whose generation-side infrastructure already
exists (#272). Builds directly on
[Phase 0](2026-06-13-pool-coverage-controller-phase-0-design.md). Status:
approved, ready for planning._

---

## Goal & scope

Phase 0 made pool diversity a **measured** quantity (`coverage_tags` per
exercise + a per-cell distribution on `GET /admin/pool-status`). Phase 1 closes
the loop on the **person** axis: the scheduler reads the approved pool's realized
per-person distribution, diffs it against a uniform per-person floor, and directs
the next batch's per-draft person targets at the under-filled buckets — with a
per-bucket give-up so a genuinely-hard bucket (e.g. `2pl`) cannot doom-loop.

This is the thing blind ordinal rotation (#272) **fundamentally cannot do**:
rotation assumes every person fills equally and just advances the ordinal, so a
bucket that gets rejected more often (2pl/2sg cloze, observed in the #272 eval
and the 06-13 run) stays permanently underfilled. A closed loop measures what
actually landed in the *approved* pool and keeps targeting the persisting
deficit.

### In scope

- New pure decision module that turns the scalar `need` into a per-draft
  `personTargets` vector from the measured deficit.
- Per-bucket give-up: persist each batch's per-person `{requested, approved}`
  outcome; suppress a bucket that was targeted but yielded nothing, cleared by a
  `CURRICULUM_VERSION` bump (exact mirror of the existing cell-level suppression).
- Thread an explicit per-draft person target through the generation job message
  and into `renderPersonBlock`, falling back to today's blind rotation when
  absent.
- Tally the realized-per-person outcome in `run-one-cell` and persist it.

### Out of scope (explicitly)

- **Other axes** — polarity / sentenceType / wordClass stay measurement-only
  (Phase 0). Only `person` drives targeting.
- **Non-scheduled triggers** — CLI and admin generation keep today's blind
  ordinal rotation. Only the nightly scheduler does deficit targeting.
- **Declarative per-cell coverage specs** (`coverageAxes` in the curriculum) —
  Phase 2. Phase 1 uses a single uniform-floor rule with no per-cell config.
- **Changing `decideEnqueue`'s enqueue/suppress/`need` decision.** That module is
  untouched; coverage targeting is layered on top of its `{enqueue, need}`
  output and only refines *which persons* those `need` drafts aim at.
- **Any web UI.** Endpoint and generation only.

---

## Decisions locked during brainstorming

1. **Floor model — uniform per person.** `floor = ceil(target / N)` over the
   language's existing rotation list (`PERSON_ROTATION_BY_LANGUAGE[lang]`: ES = 5
   persons without vosotros, TR/DE = 6). `deficit[p] = max(0, floor − approved[p])`;
   only under-filled buckets are targeted. No per-cell config — matches what blind
   rotation already implicitly assumed, but self-corrects under uneven approval.
2. **Per-bucket give-up — persist outcome, suppress like today.** `run-one-cell`
   records per-person `{requested, approved}` for the batch; persisted as jsonb on
   `generation_jobs`. A bucket targeted last run that yielded below threshold is
   excluded from the deficit until a `CURRICULUM_VERSION` bump clears it — the
   exact mechanism the existing low-yield / saturated-dedup suppression uses.
3. **Scope — person axis, `personRotation` cells, scheduled trigger only.**

---

## Component 1 — `coverage-decision.ts` (pure, `infra/lambda/src/generation`)

A new pure module parallel to `scheduler-decision.ts`: **no `@aws-sdk/*`, no
Drizzle, no env reads** — pure inputs → pure output, unit-tested in isolation.

### Input

```ts
type CoverageDecisionInput = {
  language: Exclude<Language, Language.EN>;
  target: number;          // resolveCellTarget(cell) — the cell's approved target
  need: number;            // decideEnqueue's scalar need (= target − approvedInPool)
  approvedByPerson: Partial<Record<PersonCode, number>>; // measured approved pool
  recentOutcome: PersonOutcome | null; // most-recent job's per-bucket outcome,
                                        // ONLY when its curriculumVersion matches
                                        // on-disk; null otherwise (clears give-up)
};
```

`PersonOutcome = Partial<Record<PersonCode, { requested: number; approved: number }>>`.

### Output

```ts
type CoverageDecision = {
  personTargets: PersonCode[];   // length === need; [] ⇒ caller omits the field
  suppressed: PersonCode[];      // for logging / observability
};
```

An **empty** `personTargets` means "no targetable deficit" — the caller omits
`spec.personTargets` and the generator uses blind ordinal rotation, so the cell
still tops up to target (no regression).

### Algorithm

1. `persons = PERSON_ROTATION_BY_LANGUAGE[language]` → derive the canonical
   `PersonCode` set (the code is the leading token of each entry, e.g.
   `"2pl (siz)"` → `"2pl"`); `N = persons.length`.
2. `floor = Math.ceil(target / N)`.
3. For each person `p`: `deficit[p] = max(0, floor − (approvedByPerson[p] ?? 0))`.
4. **Suppress** any `p` where `recentOutcome[p]` exists with
   `requested >= GIVE_UP_MIN_ATTEMPTS` and `approved === 0`; drop it from the
   deficit set. (When `recentOutcome` is `null` — no recent job, or a curriculum
   bump cleared it — nothing is suppressed.)
5. Let `D = Σ deficit[p]` over non-suppressed buckets. Water-fill
   `min(need, D)` drafts across those buckets, **largest-deficit-first** via the
   largest-remainder method, so the allocation sums exactly to `min(need, D)` and
   favours the most-starved persons.
6. If `need > D`, append `need − D` drafts using blind ordinal rotation
   (`personForOrdinal`) so the batch still reaches `need` total and the cell tops
   up to target.
7. Return `personTargets` (length `need`) and the `suppressed` list.

If steps 3–4 leave **no** targetable deficit bucket (`D === 0`), `personTargets`
is `[]` → blind rotation for the whole batch.

### Give-up threshold

`GIVE_UP_MIN_ATTEMPTS = 2` (a bucket is only given up after at least two honest
attempts produced zero approved drafts). Person buckets are small (a batch
targets ~1–5 drafts each), so a zero-yield rule on `requested >= 2` is the robust
analogue of the cell-level saturated-dedup fraction; a single-attempt miss is too
noisy to suppress on. Lives beside the existing suppression constants in
`cell-targets.ts` and is exported for tests.

---

## Component 2 — message contract + prompt (`packages/ai`, `infra/lambda`)

### `GenerationJobMessage`

`spec` gains an **optional** field:

```ts
personTargets?: PersonCode[]; // length MUST equal spec.count when present
```

`parseGenerationJobMessage` (`infra/lambda/src/generation/job-message.ts`)
validates, when present: it is an array, every member is a known `PersonCode`,
and `length === count`. Absent ⇒ unchanged behaviour (blind rotation). The field
is only ever emitted for scheduled, `personRotation` cells.

### `renderPersonBlock`

```ts
function renderPersonBlock(
  inputs: GenerationPromptInputs,
  ordinal: number,
  batchSeed: string | null,
  personTargets?: readonly PersonCode[],
): string
```

- `personRotation !== true` → `""` (unchanged).
- `personTargets` present → target = `personTargets[ordinal]`, mapped to the
  language's display string via `PERSON_ROTATION_BY_LANGUAGE` (e.g. `"2pl"` →
  `"2pl (siz)"`); the existing directive text is reused verbatim.
- `personTargets` absent → `personForOrdinal(language, ordinal, batchSeed)` —
  today's blind rotation, byte-identical.

The directive remains in the **uncached per-draft user prompt**; the cached
system prompt is unchanged, so prompt-cache prefix hits are preserved. No
`GENERATION_PROMPT_VERSION` bump is required (the system body is byte-identical
and the only change is which person string the existing directive carries) — note
this in the PR so a reviewer doesn't expect a Langfuse sync.

A `PersonCode → display string` lookup (per language) is derived once from
`PERSON_ROTATION_BY_LANGUAGE` and lives next to it in `generation-prompts.ts`.

---

## Component 3 — persist per-bucket outcome (`packages/db`)

### Schema (`schema/generation.ts`)

```ts
type CoverageOutcome = { person?: PersonOutcome };
coverageOutcome: jsonb('coverage_outcome').$type<CoverageOutcome | null>(),
```

Shape: `{ person: { "2pl": { requested, approved }, … } }` — the per-person
`PersonOutcome` is nested under a `person` key so future axes can be added
without a schema change. The scheduler reads back `coverage_outcome?.person` and
passes that `PersonOutcome` (or `null`) into `coverage-decision`. Nullable; `null` on
legacy rows, non-`personRotation` cells, and any cell that wasn't person-targeted.
Generate the Drizzle migration (snapshot included). No index needed (read only as
part of the existing `SELECT DISTINCT ON (cell_key) … recent job` query).

### Tally (`run-one-cell.ts`)

For each ordinal the cell generates, the **requested** person is known
(`personTargets[ordinal]` from the message, or `personForOrdinal` for the blind
remainder). After validation/insert:

- `requested[p] += 1` for the requested person `p`.
- `approved[p'] += 1` where `p'` is the **realized** person
  (`result.coverage.person`, the same value Phase 0 writes to `coverageTags`)
  **of an approved/inserted draft**.

So `approved` is counted by *realized* person, not requested: targeting `2pl` but
realizing `3sg` via the escape hatch counts 0 toward `2pl` (correct — the `2pl`
deficit did not close) and 1 toward `3sg`. This is intentional: the controller
measures what actually landed in the pool, consistent with the
`coverage_tags`-derived deficit. The tally is added to `CellResult` and written to
`generation_jobs.coverage_outcome` on the succeeded-job update; `null`/`{}` when
the cell did no person targeting.

---

## Component 4 — scheduler handler wiring (`infra/lambda/src/generation/scheduler.ts`)

`decideEnqueue` is called unchanged. **Only** when it returns `{kind: 'enqueue',
need}` **and** the cell is a Round-1 `personRotation` grammar cell:

1. Run one extra per-person aggregate over the approved pool for the cell:
   `GROUP BY coverage_tags->>'person'` filtered to
   `review_status IN ('auto-approved','manual-approved')` — the Phase-0 query
   pattern, scoped to the one cell.
2. Read the most-recent succeeded job's `coverage_outcome`; pass it to
   `coverage-decision` **only if** that job's `curriculumVersion` equals the
   on-disk `CURRICULUM_VERSION_<LANG>` (otherwise pass `null` so a curriculum bump
   clears give-up — same gate the existing suppression uses). The recent-job
   query already loads per-cell; extend its projection to include
   `coverage_outcome` and `curriculum_version`.
3. Call `coverage-decision`; attach `personTargets` to the message when non-empty.
4. Log the `suppressed` list for observability.

Non-`personRotation` and non-scheduled paths emit the message exactly as today
(no `personTargets`).

---

## Data flow

```
scheduler:
  decideEnqueue(cell, approvedInPool, target, recentJob, version) → {enqueue, need}
    └─ if personRotation Round-1 cell:
         query approved-per-person (coverage_tags->>'person')
         recentOutcome = recentJob.curriculumVersion === onDisk
                           ? recentJob.coverage_outcome : null
         coverage-decision({language, target, need, approvedByPerson, recentOutcome})
           → personTargets[need]  (or []  → omit field → blind rotation)
  → GenerationJobMessage{ spec.count = need, spec.personTargets? }

handler → runOneCell:
  per ordinal i:
    requested = personTargets?.[i] ?? personForOrdinal(language, i, batchSeed)
    renderPersonBlock(inputs, i, batchSeed, personTargets)
    validateDraft → result.coverage.person (realized)
    insert exercises(coverageTags = applicableCoverageTags(...))   [Phase 0]
    tally: requested[requested]++, approved[realized]++ (approved drafts only)
  persist generation_jobs.coverage_outcome = { person: tally }

next run:
  recentJob.coverage_outcome → buckets with requested≥2 & approved==0 suppressed
                              → excluded from deficit until CURRICULUM_VERSION bump
```

---

## Error handling

- `coverage-decision` is pure and total: empty/partial `approvedByPerson` and
  `null` `recentOutcome` are valid; missing data ⇒ no suppression, full deficit.
- An empty `personTargets` is the safe fallback everywhere — the message omits the
  field and generation behaves exactly as pre-Phase-1.
- `coverage_outcome` is **non-load-bearing for routing**: a malformed/absent tally
  only weakens give-up for one run; it never rejects a draft or blocks a cell.
- The give-up gate reuses the existing curriculum-version comparison, so a
  curriculum edit re-enables every suppressed bucket — no separate clearing step.

---

## Testing

- **`coverage-decision.test.ts`** (new) — floor math (`ceil(target/N)`); deficit
  excludes over-floor persons; water-fill allocation sums exactly to
  `min(need, D)` and is largest-deficit-first; `need > D` appends blind-rotation
  remainder to reach `need`; suppressed buckets (`requested≥2 & approved==0`)
  excluded; `recentOutcome = null` suppresses nothing; `D === 0` ⇒ `[]`; ES
  5-person list (no `2pl`) handled; `GIVE_UP_MIN_ATTEMPTS` boundary
  (`requested === 1` not suppressed).
- **`job-message.test.ts`** — `personTargets` round-trips; rejects unknown code,
  rejects `length !== count`; absent field parses to today's shape.
- **`generation-prompts.test.ts`** — `renderPersonBlock` uses
  `personTargets[ordinal]` (mapped to display string) when present; falls back to
  `personForOrdinal` when absent; `""` when `personRotation !== true`; cached
  system-prompt byte-parity preserved.
- **`run-one-cell` test** — `coverage_outcome` tally counts `requested` by target
  and `approved` by realized person of inserted drafts; `null` for a
  non-`personRotation` cell; realized≠requested counted correctly.
- **`scheduler.test.ts`** — a `personRotation` cell under target with a skewed
  approved distribution gets a message with `personTargets` weighted to the
  deficit; a non-`personRotation` cell gets no `personTargets`; a recent job whose
  curriculum version differs clears give-up.
- **Migration** — snapshot included.
- Full `pnpm lint && pnpm typecheck && pnpm test` green before push (CLAUDE.md),
  watching the known `db/dist` staleness (`pnpm build` after editing db source)
  and the `infra` parallel-test flake (`pnpm turbo run test --concurrency=1`).

---

## Files touched

- `packages/shared/src/coverage.ts` — reuse `PersonCode` / `PERSON_CODES`
  (already exist); add a `PersonOutcome` type if it belongs in shared, else colocate
  in `infra/lambda/src/generation`.
- `packages/ai/src/generation-prompts.ts` — `renderPersonBlock` signature +
  `personTargets` path; `PersonCode → display string` lookup; thread through
  `buildGenerationUserPrompt`.
- `infra/lambda/src/generation/coverage-decision.ts` — **new** pure module +
  test.
- `infra/lambda/src/generation/scheduler.ts` — per-person aggregate, recent-job
  projection extension, `coverage-decision` call, attach `personTargets`.
- `infra/lambda/src/generation/cell-targets.ts` — `GIVE_UP_MIN_ATTEMPTS`
  constant.
- `infra/lambda/src/generation/job-message.ts` — `personTargets` field + parse
  validation.
- `packages/db/src/schema/generation.ts` — `coverage_outcome` column.
- `packages/db/migrations/` — generated migration + snapshot.
- `packages/db/src/generation/run-one-cell.ts` — per-bucket tally; `CellResult`
  type.
- Test files alongside each.
