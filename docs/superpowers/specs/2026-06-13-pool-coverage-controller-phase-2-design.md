# Pool Coverage Controller — Phase 2 Design

_Spec for Phase 2 of the [pool coverage controller](../../pool-coverage-controller.md):
**declarative coverage specs + a generalized, axis-agnostic controller**. Replaces
the `personRotation: boolean` flag with a richer per-grammar-point `coverageSpec`
in the curriculum, and generalizes the Phase-1 person-only controller to drive any
axis from that spec — so adding a new axis (word-class for vocab, polarity for a
grammar point) becomes a **data change, not a code change**. Builds directly on
[Phase 1](2026-06-13-pool-coverage-controller-phase-1-design.md). Also ships the
LLM-proposes / human-reviews spec-authoring CLI. Status: approved, ready for
planning._

---

## Goal & scope

Phase 1 closed the loop on the **person** axis only, with person-specific machinery
threaded end to end (`personTargets`, `decideCoverageTargets`, `renderPersonBlock`,
`coverageOutcome.person`, per-person give-up). Every new axis we wanted to control
(polarity, word-class, the participle-regularity axis the audit surfaced) would
have meant another hand-coded rule — the "we keep discovering axes" treadmill.

Phase 2 ends that treadmill. The curriculum gains a declarative `coverageSpec` —
**which axes a diverse set should vary along, and an absolute per-value floor for
each** — and the controller becomes axis-agnostic: it measures the approved pool's
realized distribution per spec axis, water-fills each axis's deficit independently,
gives up per `(axis, value)` bucket, and renders a per-axis directive into the
generation prompt. Specs are authored by an LLM and human-reviewed (a new CLI);
they live in the curriculum like `personRotation` did, so a reviewed spec is just a
committed code/data edit.

### In scope

- **Declarative `coverageSpec`** on `GrammarPoint` (axes + per-value absolute
  floors), replacing the `personRotation: boolean` flag entirely. New curriculum
  invariant validates axis applicability + floor-key legality.
- **Generalized controller** — `decideCoverageTargets` turns the scalar `need` into
  a per-draft `CoverageTarget[]` (one value per controlled axis per draft) via
  **independent per-axis water-fill**; per-`(axis, value)` give-up, cleared by a
  `CURRICULUM_VERSION` bump (the Phase-1 mechanism, generalized).
- **Floor-driven cell target** — replaces the magic `1.5×` person multiplier with
  `target = max(base/override, maxOverAxes(Σ floors))`.
- **Generalized message + outcome** — `spec.personTargets: PersonCode[]` →
  `spec.coverageTargets: CoverageTarget[]`; `coverageOutcome` from `{ person?: … }`
  to `{ [axis]?: { [value]: {requested, approved} } }`.
- **Generalized directive** — `renderPersonBlock` → `renderCoverageBlock`, one
  directive per controlled axis on each draft (person keeps its rich per-language
  labels; polarity / wordClass / sentenceType get templated directives).
- **Axes driven this phase:** `person` (ported), `polarity`, `wordClass` — all
  already tagged by the Phase-0 validator, so **no validator / tagging-prompt
  change**.
- **LLM spec-authoring CLI** — `propose:coverage-spec`, in-repo prompt (not
  Langfuse), forced-tool-call output, emits a paste-ready `coverageSpec` snippet +
  rationale for human review and commit.
- **Migration** — port every `personRotation: true` cell to an equivalent
  `coverageSpec`; remove the flag and all references.

### Out of scope (explicitly)

- **Brand-new axes that aren't tagged yet** (e.g. participle-regularity). Driving
  those needs validator-prompt + schema changes to start tagging them — a separate
  change. This phase drives only the three already-tagged axes.
- **Joint cross-product targeting.** Give-up and measurement are always
  per-`(axis, value)`, never per combination (the doc's "per-bucket doom loop, the
  big one"). A draft may carry constraints on multiple axes, but each axis
  water-fills independently.
- **Unsupervised axis discovery (Phase 3).**
- **Non-scheduled triggers.** CLI / admin generation still pass no coverage targets
  (blind). Only the nightly scheduler does deficit targeting — unchanged from
  Phase 1.
- **Changing `decideEnqueue`'s enqueue/suppress/`need` decision.** Untouched;
  coverage targeting still layers on top of its `{enqueue, need}` output.
- **`GET /admin/pool-status` response shape.** It already surfaces the full
  `coverageDistribution` for every axis (Phase 0). No change needed; the dashboard
  keeps working as the new axes get tagged.
- **Langfuse registration of the proposal prompt.** In-repo only.

---

## Decisions locked during brainstorming

1. **Scope — the full thing**, including the LLM spec-authoring CLI (not just the
   data model + controller).
2. **Axes driven — person + polarity + wordClass.** All three are already reported
   by the validator and persisted to `coverage_tags`, so zero tagging risk.
3. **Multi-axis — independent per-axis water-fill.** Never the cross-product.
4. **Floor semantics — absolute per-value floors.** `floors: { '2pl': 2, … }`;
   omitted value = NA (not targeted); low floor = rare. Integer-actionable, composes
   with the Phase-1 water-fill and give-up.
5. **Proposal prompt — in-repo, versioned, NOT Langfuse.** It's a dev-time
   authoring CLI run rarely by a human, not a runtime Lambda path.
6. **Migration — replace `personRotation` entirely.** Single source of truth; the
   spec drives tagging-axis selection and the cell-target floor.
7. **Pool grounding in the CLI — opt-in (`--with-pool-stats`), off by default.**

---

## Component 1 — `CoverageSpec` data model (`packages/shared`)

`packages/shared/src/coverage.ts` already owns `PersonCode`, the other axis-value
unions, `COVERAGE_AXIS_VALUES`, `CoverageTags`, and `coverageAxesFor`. Add the spec
types there:

```ts
export type CoverageAxisName = 'person' | 'polarity' | 'sentenceType' | 'wordClass';

export type CoverageAxisSpec = {
  name: CoverageAxisName;
  // Absolute minimum approved-count per value. Listed values are targeted;
  // omitted values are "NA" (the controller never aims a draft at them). A low
  // floor (e.g. 2) is the "rare" case. Keys MUST be valid values for `name`.
  floors: Readonly<Partial<Record<string, number>>>;
};

export type CoverageSpec = {
  axes: readonly CoverageAxisSpec[];
};
```

`floors` is keyed by `string` (not the per-axis union) to keep `CoverageSpec` a
single non-generic type usable across all axes; **legality of each key is enforced
at the curriculum-invariant layer**, where the axis name is known, against
`COVERAGE_AXIS_VALUES[name]`.

### `GrammarPoint` change (`packages/shared/src/curriculum-types.ts`)

```diff
-  personRotation?: boolean;
+  coverageSpec?: CoverageSpec;
```

A cell "controls person" iff `coverageSpec.axes` contains a `person` axis — the new
single source of truth for everything `personRotation` keyed.

### Curriculum invariants (`packages/db/src/curriculum/index.ts`)

Replace the `personRotation only on kind:'grammar'` invariant with `coverageSpec`
invariants:

- `coverageSpec` axes are non-empty and have unique `name`s.
- Each floor value is a positive integer.
- **Floor keys are legal:** every key of `axis.floors` ∈ `COVERAGE_AXIS_VALUES[axis.name]`.
- **Axis applicability vs. `kind`:** `wordClass` only on `kind:'vocab'` points;
  `person` / `polarity` / `sentenceType` only on `kind:'grammar'` points. (This
  mirrors the Phase-0 `coverageAxesFor` exercise-type mapping.)
- A point may not list an axis that its exercise types never tag (defense against
  specs that can never be measured).

---

## Component 2 — tagging derives from the spec (`packages/shared/src/coverage.ts`, `packages/db`)

Phase 0's `coverageAxesFor(exerciseType, personRotation: boolean)` decided which
axes to **record**. Generalize its second argument from the boolean to the spec so
tagging = **monitoring axes ∪ controlled axes**:

```ts
export function coverageAxesFor(
  exerciseType: ExerciseType,
  spec: CoverageSpec | undefined,
): CoverageAxisName[]
```

- Base **monitoring** axes per exercise type are unchanged: vocab → `['wordClass']`;
  grammar cloze/translation/sentence_construction → `['polarity', 'sentenceType']`.
- Union in every `spec.axes[].name` (so a person- or wordClass-controlled cell tags
  that axis too).

`applicableCoverageTags(cell, coverage)` (in `packages/db/src/generation/coverage-tags.ts`)
now passes `cell.grammarPoint.coverageSpec` instead of the boolean. The persisted
`coverage_tags` shape is unchanged; we only widen which axes are recorded, exactly
as Phase 1 did when it turned on `person`. **No validator-prompt change** — the
validator already returns all four axes; `applicableCoverageTags` just keeps more
of them.

---

## Component 3 — generalized controller (`infra/lambda/src/generation`)

### 3a. `coverage-decision.ts` (pure) — generalized

Keep the module pure (no `@aws-sdk/*`, no Drizzle, no env). Generalize from person
to N axes.

```ts
// One draft's per-axis assignment. Sparse: only controlled axes present.
export type CoverageTarget = Partial<Record<CoverageAxisName, string>>;

// Realized/targeted tallies, generalized from Phase-1 PersonOutcome.
export type AxisOutcome = Partial<Record<string, { requested: number; approved: number }>>;
export type CoverageOutcome = Partial<Record<CoverageAxisName, AxisOutcome>>;

type CoverageDecisionInput = {
  spec: CoverageSpec;
  need: number;
  // measured approved pool, per controlled axis: { person: {'3sg': 12, …}, … }
  approvedByAxis: Partial<Record<CoverageAxisName, Partial<Record<string, number>>>>;
  // most-recent job's outcome, ONLY when its curriculumVersion matches on-disk;
  // null otherwise (clears all give-ups).
  recentOutcome: CoverageOutcome | null;
};

type CoverageDecision = {
  coverageTargets: CoverageTarget[];                 // length === need; [] ⇒ omit field
  suppressed: Partial<Record<CoverageAxisName, string[]>>; // for logging
};
```

**Algorithm — independent per-axis water-fill.** For each axis in `spec.axes`
independently:

1. `candidates =` keys of `axis.floors` (the only values we ever target; NA values
   are absent by construction).
2. **Suppress** any value `v` where `recentOutcome[axis][v]` exists with
   `requested >= GIVE_UP_MIN_ATTEMPTS && approved === 0`. `eligible = candidates \ suppressed`.
3. Seed a running count per eligible value from `approvedByAxis[axis][v] ?? 0`.
   Produce a length-`need` sequence by repeating: pick the eligible value with the
   **smallest** running count (ties broken by `COVERAGE_AXIS_VALUES[axis]` order),
   increment it. This is exactly Phase 1's water-fill, per axis.
4. If `eligible` is empty for this axis, that axis contributes nothing (its draft
   slots stay unconstrained — the generator picks naturally; cell-level
   low-yield/saturated-dedup remains the backstop).

Then **zip** the per-axis sequences into `coverageTargets`: draft `i` gets
`{ [axis]: sequence_axis[i] }` for every axis that produced a sequence. The
cross-product emerges in the drafts but is never measured or suppressed — only
per-`(axis, value)`.

**Empty result.** If `need <= 0` or every axis suppressed/empty →
`coverageTargets = []`; caller omits `spec.coverageTargets` (blind generation, no
regression).

`GIVE_UP_MIN_ATTEMPTS = 2` is unchanged and stays in `cell-targets.ts`.

### 3b. `cell-targets.ts` — floor-driven target replaces the 1.5× multiplier

```ts
export function resolveCellTarget(cell: Cell): number {
  const base = cell.grammarPoint.targetOverride
    ?? CELL_TARGET_DEFAULTS[cell.exerciseType][cell.cefrLevel]
    ?? TARGET_PER_CELL;
  const spec = cell.grammarPoint.coverageSpec;
  if (!spec) return base;
  const floorPressure = Math.max(
    0,
    ...spec.axes.map((a) => sumValues(a.floors)),  // Σ floors per axis
  );
  return Math.max(base, floorPressure);
}
```

Per-axis floor **sum** (not product) is the right minimum: one approved exercise
realizes one value on each axis, so satisfying a person axis with floors summing to
40 needs ≥40 exercises, while the same 40 simultaneously satisfy a polarity axis
whose floors sum to ≤40. Taking the max over axes guarantees headroom for the
tightest axis without multiplying axes together. `PERSON_ROTATION_TARGET_MULTIPLIER`
and `PERSON_ROTATION_RAISED_TYPES` are deleted; the ported person specs choose
floors that reproduce today's effective 1.5× target where desired (see Migration).

### 3c. `scheduler.ts` — generalized wiring

Mirrors Phase 1, generalized:

1. **Measure**: replace `loadApprovedPersonCountsPerCell` with
   `loadApprovedCoverageCountsPerCell(db)` → `cellKey → { axis → { value → count } }`,
   using the admin pool-status SQL pattern (`CROSS JOIN LATERAL jsonb_each_text(coverage_tags)`),
   filtered to approved rows. One query for all axes.
2. **Gate give-up on version**: read the recent job's `coverage_outcome`; pass it to
   `coverage-decision` only if its `curriculum_version` equals on-disk
   `CURRICULUM_VERSION_<LANG>`, else `null` (unchanged gate, now whole-`CoverageOutcome`).
3. **Decide**: for any enqueued cell whose grammar point has a `coverageSpec`, call
   `decideCoverageTargets`; attach `spec.coverageTargets` when non-empty.
4. **Log** the per-axis `suppressed` map (extend the existing
   `"coverage controller: … given up"` log line to be axis-keyed).

Cells without a `coverageSpec` emit messages exactly as today (no
`coverageTargets`).

---

## Component 4 — message contract + directive (`packages/ai`, `infra/lambda`)

### `GenerationJobMessage`

```diff
-  personTargets?: PersonCode[];      // length === count
+  coverageTargets?: CoverageTarget[]; // length === count; each a sparse {axis: value}
```

`parseGenerationJobMessage` validates, when present: array of length `count`; each
element an object whose keys ∈ `CoverageAxisName` and whose values ∈
`COVERAGE_AXIS_VALUES[key]`. Absent ⇒ blind generation (unchanged).

### `renderPersonBlock` → `renderCoverageBlock` (`generation-prompts.ts`)

```ts
function renderCoverageBlock(
  inputs: GenerationPromptInputs,
  ordinal: number,
  coverageTargets?: readonly CoverageTarget[],
): string
```

- `coverageTargets` absent or `coverageTargets[ordinal]` empty → `""` (no
  directive; the blind `personForOrdinal` fallback is **removed** — the controller
  always supplies targets when a spec controls the cell).
- Otherwise render one directive sentence per axis present in
  `coverageTargets[ordinal]`, concatenated:
  - **person** — reuse today's rich directive verbatim, mapping the `PersonCode` to
    the per-language display string via `PERSON_ROTATION_BY_LANGUAGE` ("2pl" →
    "2pl (siz)") and keeping the "use the closest natural person" escape hatch.
  - **polarity** — "The target sentence MUST be {affirmative | negative}."
  - **wordClass** — "The target word MUST be a {noun | verb | adjective | adverb}."
  - **sentenceType** — "The target sentence MUST be {declarative | interrogative |
    imperative}." (templated for forward-compat; not driven this phase unless a
    spec lists it.)

Per-axis directive text lives in a small `COVERAGE_DIRECTIVE_BY_AXIS` table beside
`PERSON_ROTATION_BY_LANGUAGE`. The directive remains in the **uncached per-draft
user prompt**; the cached system body is byte-identical, so prompt-cache hits are
preserved and **no `GENERATION_PROMPT_VERSION` bump is required** (note in PR).
`buildGenerationUserPrompt` threads `coverageTargets` (replacing the `personTargets`
+ `batchSeed`-rotation parameters). `GenerationSpec` (`generate.ts`) carries
`coverageTargets?` and passes it through `generateOneDraft`.

---

## Component 5 — generalized outcome (`packages/db`)

### Schema (`schema/generation.ts`)

The `coverage_outcome` column already exists (Phase 1) typed
`{ person?: PersonOutcome } | null`. **Widen the TypeScript `$type` to the
generalized `CoverageOutcome`** (`Partial<Record<CoverageAxisName, AxisOutcome>>`).
The JSONB column itself is unchanged → **no SQL migration**; Phase-1 rows
(`{ person: … }`) are already valid instances of the wider type.

### Tally (`run-one-cell.ts`)

Generalize the per-person tally to per-axis. For each ordinal:

- **requested**: for each axis in `coverageTargets[i]`, `requested[axis][value] += 1`.
- **approved** (inserted drafts only): for each axis in the spec, credit
  `approved[axis][realizedValue] += 1` where `realizedValue = result.coverage[axis]`
  — the **realized** value the validator reported (targeting `2pl` but realizing
  `3sg` credits `3sg`, closing the `3sg` deficit, not `2pl` — consistent with the
  `coverage_tags`-derived measurement).

Persist as `generation_jobs.coverage_outcome`; `null` when the cell had no
`coverageTargets`. `CellResult.coverageOutcome` widens to `CoverageOutcome | null`.

---

## Component 6 — LLM spec-authoring CLI (`packages/ai`)

A rarely-run, human-in-the-loop authoring tool. **The LLM proposes; a human reviews
the diff and commits** — review *is* the PR.

### Prompt — `packages/ai/src/coverage-spec-prompts.ts`

`COVERAGE_SPEC_PROPOSAL_SYSTEM_PROMPT` + `COVERAGE_SPEC_PROPOSAL_PROMPT_VERSION`
(in-repo, **not** Langfuse — add to the CLAUDE.md prompt table's "in-repo only"
understanding, not the Langfuse sync list). The prompt:

- States the task: "Given this grammar point, pick the 1–2 dimensions a diverse
  approved set should vary along, and a realistic absolute floor per value."
- Enumerates the **only** axes available (`person`, `polarity`, `sentenceType`,
  `wordClass`) and their legal values, scoped to the point's `kind`/exercise types.
- Demands the doc's discipline explicitly: coarse (1–2 axes), modest floors, mark
  values **NA** (omit) or **rare** (low floor) rather than forcing uniformity; cites
  the `var/yok` and literary `-se` cautionary cases.

### Output — forced tool call

A `PROPOSE_COVERAGE_SPEC_TOOL` (à la `VALIDATION_TOOL`) returns:
`{ axes: [{ name, floors: {value: int}, rationale, naValues: [], rareValues: [] }] }`.
A pure parser/validator (`parseCoverageSpecProposal`) checks axis legality, value
legality, integer floors, ≤2 axes — and is unit-tested with fixtures (the Claude
call itself is not tested live).

### CLI — `propose:coverage-spec` (alongside the existing `packages/ai` CLIs)

- `--grammar-point <key>` (required), `--with-pool-stats` (optional; off by
  default — when set, runs a read-only approved-distribution query for the point's
  cells and includes it as grounding context), `--max-cost-usd`.
- Loads the grammar point from `getGrammarPoint(key)`, builds the prompt, calls
  Claude, parses/validates, then **emits to stdout (and `<key>.coverage-spec.proposed.json`)**:
  a paste-ready `coverageSpec: { axes: [...] }` TS snippet + the per-value
  rationale + NA/rare notes. The human edits as needed and commits it into the
  curriculum file. The CLI never writes the curriculum.
- Registered as a workspace script (`pnpm propose:coverage-spec`) and documented in
  the CLAUDE.md command table.

---

## Component 7 — migration & release

- **Port every `personRotation: true` cell** to a `coverageSpec` with a single
  `person` axis whose floors reproduce today's intended fill. Phase 1's effective
  target was `ceil(base × 1.5)` and its floor was `ceil(target / N)` per person.
  Under the new `max(base, Σ floors)` rule, pick a per-person floor `f` such that
  `N × f` equals that prior effective target (e.g. TR cloze, base 50 → prior target
  75, 6 persons → `f = ceil(75 / 6) = 13`, Σ = 78 ≈ 75). **The planner computes the
  exact per-language `f` at implementation time** from the current `CELL_TARGET_DEFAULTS`
  and the per-language person count; the binding constraint is **no behavioral
  regression for ported person cells** (same effective target, same uniform floor).
- **Author a few new specs** to exercise the new axes: at least one `wordClass`
  vocab spec and one `polarity` grammar spec, via the proposal CLI, human-reviewed.
- **Remove `personRotation`** and every reference (`cell-targets`,
  `generation-prompts`, `coverage-tags`, curriculum data, invariants, tests).
- **Release step — `CURRICULUM_VERSION` bump.** Migrating the spec + changing the
  target arithmetic changes effective targets/control for affected cells; per the
  #275/#276 cautionary tale, bump `CURRICULUM_VERSION_ES` / `_TR` to the **merge
  date** so the scheduler clears suppression and re-evaluates. The values are
  currently `2026-06-13`; the bump must be a `YYYY-MM-DD` distinct from any
  already-run job's recorded version at merge time. **Flagged as an explicit
  release-checklist item, not hardcoded in this branch.**

---

## Data flow

```
scheduler:
  decideEnqueue(...) → {enqueue, need}
    └─ if cell.grammarPoint.coverageSpec:
         approvedByAxis = loadApprovedCoverageCountsPerCell()[cellKey]   // all axes
         recentOutcome  = recentJob.curriculumVersion === onDisk
                            ? recentJob.coverage_outcome : null
         decideCoverageTargets({ spec, need, approvedByAxis, recentOutcome })
           → coverageTargets[need]  (each {person?, polarity?, wordClass?})  (or [])
  → GenerationJobMessage{ spec.count = need, spec.coverageTargets? }

handler → runOneCell:
  per ordinal i:
    target = coverageTargets?.[i]                    // {axis: value} sparse
    renderCoverageBlock(inputs, i, coverageTargets)  // one directive per axis
    validateDraft → result.coverage (realized, all axes)
    insert exercises(coverageTags = applicableCoverageTags(cell, coverage))  // Phase 0/2
    tally: for axis in target: requested[axis][value]++
           for axis in spec (inserted): approved[axis][realized[axis]]++
  persist generation_jobs.coverage_outcome = { person?:…, polarity?:…, wordClass?:… }

next run:
  recentJob.coverage_outcome → per-(axis,value) buckets with requested≥2 & approved==0
                              → suppressed until CURRICULUM_VERSION bump
```

---

## Error handling

- `decideCoverageTargets` is pure and total: empty/partial `approvedByAxis` and
  `null` `recentOutcome` are valid (no suppression, full deficit). An axis with no
  eligible values simply drops out of the targets.
- Empty `coverageTargets` is the safe fallback everywhere — message omits the field,
  generation behaves as pre-controller.
- `coverage_outcome` stays **non-load-bearing for routing**: a malformed/absent
  tally only weakens give-up for one run; never rejects a draft or blocks a cell.
- Spec legality is enforced at **two** points: the curriculum invariant (build/test
  time, hard fail) and the message parser (runtime, reject bad `coverageTargets`).
- The proposal CLI is offline and side-effect-free on the curriculum; a bad
  proposal is caught by the human reviewer and by the curriculum invariants when
  pasted in.

---

## Testing

- **`coverage-decision.test.ts`** — generalize Phase-1 cases to N axes: independent
  per-axis water-fill (person + polarity targeted together produce correctly-zipped
  per-draft targets); per-`(axis,value)` give-up (`requested≥2 & approved==0`)
  excludes only that value of that axis; `recentOutcome=null` suppresses nothing;
  NA values (absent from `floors`) never targeted; rare value (low floor) reached
  but not over-filled; `need<=0` ⇒ `[]`; an axis with every value suppressed drops
  out while other axes still target; ES 5-person list (no `2pl`).
- **`cell-targets.test.ts`** — `resolveCellTarget` returns `max(base, Σ floors)`;
  `targetOverride` respected; no-spec cell returns base; the deleted 1.5× path gone.
- **`curriculum.test.ts`** — new `coverageSpec` invariants: illegal floor key
  rejected; `wordClass` on a grammar point rejected; `person` on a vocab point
  rejected; duplicate axis rejected; non-integer/zero floor rejected.
- **`coverage.test.ts` (shared)** — `coverageAxesFor(type, spec)` = monitoring ∪
  controlled; `applicableCoverageTags` keeps the controlled axes.
- **`job-message.test.ts`** — `coverageTargets` round-trips; rejects bad axis name,
  bad value, `length !== count`; absent ⇒ today's shape.
- **`generation-prompts.test.ts`** — `renderCoverageBlock` emits one directive per
  axis present; person mapped to display string; polarity/wordClass templates;
  `""` when no target; cached system-prompt byte-parity preserved.
- **`run-one-cell` test** — multi-axis `coverage_outcome`: `requested` by target
  value, `approved` by realized value per axis; `null` for a no-spec cell;
  realized≠requested credited to realized.
- **`coverage-spec-proposal.test.ts`** (new) — `parseCoverageSpecProposal` accepts a
  valid fixture, rejects illegal axis/value/floor and >2 axes; prompt-builder
  includes the point's legal axes/values.
- **`scheduler.test.ts`** — a spec'd cell under target with a skewed multi-axis
  distribution gets `coverageTargets` weighted to each axis's deficit; a no-spec
  cell gets none; version mismatch clears give-up; ported person cell still targets
  person exactly as Phase 1 did (regression guard).
- **No new migration** (column reused) — confirm Drizzle reports no schema diff for
  `generation_jobs`. The `coverage_tags` widening also needs no migration.
- Full `pnpm lint && pnpm typecheck && pnpm test` green before push (CLAUDE.md),
  watching the `db/dist` staleness (`pnpm build` after editing db source) and the
  `infra` parallel-test flake (`pnpm turbo run test --concurrency=1`).

---

## Files touched

- `packages/shared/src/coverage.ts` — `CoverageAxisName`, `CoverageAxisSpec`,
  `CoverageSpec`, `CoverageTarget`, `AxisOutcome`, generalized `CoverageOutcome`;
  `coverageAxesFor(type, spec)`.
- `packages/shared/src/curriculum-types.ts` — `personRotation` → `coverageSpec` on
  `GrammarPoint`.
- `packages/db/src/curriculum/{es,tr}.ts` — port person cells to `coverageSpec`;
  author the new wordClass/polarity specs.
- `packages/db/src/curriculum/index.ts` — replace the `personRotation` invariant
  with `coverageSpec` invariants. **Release: bump `CURRICULUM_VERSION_ES/_TR`.**
- `packages/db/src/generation/coverage-tags.ts` — `applicableCoverageTags` passes
  the spec.
- `packages/ai/src/generation-prompts.ts` — `renderCoverageBlock` +
  `COVERAGE_DIRECTIVE_BY_AXIS`; thread `coverageTargets` through
  `buildGenerationUserPrompt`; drop the blind-rotation fallback. `generate.ts`:
  `GenerationSpec.coverageTargets?`.
- `packages/ai/src/coverage-spec-prompts.ts` — **new** proposal prompt + version +
  tool + `parseCoverageSpecProposal`.
- `packages/ai/scripts/propose-coverage-spec.ts` (or alongside existing CLIs) —
  **new** CLI; `package.json` script `propose:coverage-spec`.
- `packages/ai/src/index.ts` — re-export new types/prompt version.
- `infra/lambda/src/generation/coverage-decision.ts` — generalized to N axes.
- `infra/lambda/src/generation/cell-targets.ts` — floor-driven `resolveCellTarget`;
  delete the 1.5× constants; keep `GIVE_UP_MIN_ATTEMPTS`.
- `infra/lambda/src/generation/scheduler.ts` —
  `loadApprovedCoverageCountsPerCell`, generalized decision call + attach
  `coverageTargets`, axis-keyed give-up log.
- `infra/lambda/src/generation/job-message.ts` — `coverageTargets` field + parse
  validation.
- `packages/db/src/schema/generation.ts` — widen `coverage_outcome` `$type` (no SQL
  migration).
- `packages/db/src/generation/run-one-cell.ts` — multi-axis tally; `CellResult`
  type.
- `CLAUDE.md` — document `propose:coverage-spec` in the command table.
- Test files alongside each.
```