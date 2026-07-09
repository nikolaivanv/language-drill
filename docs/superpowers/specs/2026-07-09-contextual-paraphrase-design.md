# Contextual Paraphrase — Exercise Type Design

_Spec for Exercise #10 from `docs/exercise-strategy.md`. Written 2026-07-09._

## Summary

Add **Contextual Paraphrase** as a new pre-generated, real-time-evaluated exercise
type. The learner is shown a source sentence plus a single **transformation
constraint** and must rewrite the sentence to satisfy it while preserving meaning.
Claude evaluates meaning-preservation + constraint-adherence + grammar/vocab and
returns the standard `EvaluationResult`.

It targets the intermediate-plateau deficits the app exists to break: **vocabulary
depth** (synonyms, circumlocution), **grammar range** (alternative structures for the
same meaning), and **discourse/register flexibility**.

### Decisions (locked during brainstorming)

1. **v1 constraint kinds — three single-answer kinds only:**
   - `avoid` — "Say this without using «X»" (banned word/structure → forces circumlocution)
   - `register` — "Rewrite this in {formal|informal|neutral} register"
   - `simplify` — "Rewrite this for {a child|a non-expert|casual conversation}"
   - **Deferred:** the "rewrite N ways" multi-answer range probe (needs multi-input UI
     + distinctness eval). Out of scope for v1.
2. **Anchoring — umbrella model** (like `free_writing`/`dictation`), NOT
   grammar-point-anchored. A synthetic `kind: 'paraphrase'` umbrella owns one
   generation cell per `(language, level)`. Mastery flows to competencies + whatever
   grammar-point errors the generic evaluator attributes from the level's closed key set.
3. **Diversity is a hard requirement** (prior duplication pain in dictation/free_writing).
   Four layered mechanisms — see [§4](#4-diversity-mechanisms-hard-requirement).
4. **CEFR range B1–C2**, all four languages (EN/ES/TR/DE). Target is one umbrella per
   `(language, level)` — up to ~16 cells, but the exact set matches whichever levels
   each language's curriculum already carries umbrella kinds for (see open question 3),
   not a forced flat 4×4.
5. **`_dedupKey` = normalized `sourceText`** — a given source sentence appears at most
   once per cell, regardless of constraint kind.
6. **No new `EvaluationResult` type** — the generic evaluator's shape fits;
   constraint-adherence + meaning-preservation fold into `taskAchievement`.

## Non-goals

- "Rewrite N ways" multi-paraphrase variant (future follow-up).
- Grammar-point-anchored paraphrase / `paraphraseSuitable` flag.
- Any spoken/audio variant.
- Changes to the mastery Bayesian update math (paraphrase reuses the generic
  competency roll-up + detected-grammar-point path unchanged).

---

## 1. Data model — `packages/shared/src/index.ts`

New enum member:

```ts
export enum ExerciseType {
  // …existing 7…
  CONTEXTUAL_PARAPHRASE = "contextual_paraphrase",
}
```

New content type (flat idiom, mirroring `SentenceConstructionContent`'s
`promptMode` + optional fields):

```ts
export type ContextualParaphraseContent = {
  type: ExerciseType.CONTEXTUAL_PARAPHRASE;
  instructions: string;
  /** The sentence the learner must rewrite. */
  sourceText: string;
  /** Which transformation is required. Drives rendering + eval framing. */
  constraintKind: "avoid" | "register" | "simplify";
  /** avoid: words/structures that must NOT appear in the answer (≥1 when kind==="avoid"). */
  bannedTerms?: string[];
  /** register: the register the rewrite must adopt (required when kind==="register"). */
  targetRegister?: "informal" | "neutral" | "formal";
  /** simplify: the audience to simplify for (required when kind==="simplify"). */
  audience?: string;
  /** Rendered task shown to the learner, e.g. "Say this without using «gustar»". */
  constraintLabel: string;
  /** 2–3 model paraphrases that satisfy the constraint + preserve meaning.
   *  Used by the validator and the level-3 reveal hint. */
  referenceParaphrases: string[];
  topicHint?: string;
};
```

- Add to the `ExerciseContent` union.
- Add `isContextualParaphraseContent` type guard.
- **Writer-only fields persisted into `content_json`** (never in the TS type, set by
  the generation pipeline like other types do): `_dedupKey` (normalized `sourceText`)
  and `seedWord` (the scenario seed used, for cross-run exclude). These follow the
  existing convention — see how `run-one-cell.ts` persists `seedWord` / `_dedupKey`.
- **`packages/shared/src/index.test.ts`** — bump the `ExerciseType` "has exactly N
  values" count assertion (7 → 8). (Typecheck-invisible; only the test catches it.)

### Evaluation shape

Reuse `EvaluationResult` verbatim. Field mapping for the evaluator prompt:
- `taskAchievement` ← meaning preserved AND constraint satisfied (both required for a
  high score; violating the constraint caps it low even if the sentence is otherwise good).
- `grammarAccuracy` ← grammatical correctness of the rewrite.
- `vocabularyRange` ← CEFR of lexis reached for (esp. rewards circumlocution on `avoid`).
- `errors[]` ← each with `grammarPointKey` attributed from the level's closed key set
  (same as the generic evaluator already does).

---

## 2. Curriculum anchoring — `packages/shared/src/curriculum-types.ts` + `packages/db/src/curriculum/{en,es,tr,de}.ts`

### `GrammarPoint` changes

- Extend the `kind` union: `'grammar' | 'vocab' | 'dictation' | 'free-writing' | 'paraphrase'`.
- New optional config field, REQUIRED iff `kind === 'paraphrase'`:

  ```ts
  /** Paraphrase umbrella config. Present iff kind === 'paraphrase'.
   *  `seeds` is the per-ordinal scenario-seed rotation pool (the diversity
   *  backbone) — analogous to conjugationSeedWords / elicitationSeedValues. */
  paraphrase?: { seeds: readonly string[] };
  ```

- Update the `kind` doc comment block (lines ~30–50) to describe `'paraphrase'`.

### Umbrellas

- One `kind: 'paraphrase'` umbrella per `(language, level)` for B1, B2 (and C1/C2 if the
  curriculum carries those levels for the language; match whatever levels
  `free-writing`/`dictation` umbrellas already exist for). Key format:
  `<lang>-<level>-paraphrase`, e.g. `es-b1-paraphrase`.
- Each umbrella carries `name`/`description`/`examplesPositive`/`examplesNegative`/
  `commonErrors` (framing for the generation prompt, like the free-writing umbrellas)
  and a `paraphrase.seeds` pool sized comfortably above the cell target (so
  per-ordinal seed rotation doesn't exhaust — see §4). Seeds are short scenario/topic
  cues in English, e.g. `"a complaint to a landlord"`, `"describing a childhood memory"`,
  `"asking a colleague for a deadline extension"`.

### `compatibleTypes()` (in curriculum-types.ts)

- `kind: 'paraphrase'` → `[ExerciseType.CONTEXTUAL_PARAPHRASE]` only (exactly one type,
  like dictation/free-writing umbrellas).

### `enumerateCurriculumCells`

- Emit a `CONTEXTUAL_PARAPHRASE` cell for each `kind: 'paraphrase'` umbrella.

### Curriculum invariants (`assertCurriculumInvariants`)

- `paraphrase` present iff `kind === 'paraphrase'`; `paraphrase.seeds` non-empty.
- `kind: 'paraphrase'` entries carry no `coverageSpec`/`sentenceConstructionSuitable`/
  `conjugationSuitable`/etc. (same shape-guard as other umbrella kinds).
- Bump `CURRICULUM_VERSION` (required so the scheduler picks up the new cells — a
  prompt-only bump would not; see the scheduler/curriculum-bump note in project memory).

### Count tests

- `packages/db/src/curriculum/curriculum.test.ts` (and any per-language count floors)
  need floor bumps for the added umbrellas. Surface via the full serial test run.

---

## 3. Generation / Validation / Evaluation — `packages/ai/src`

### 3a. Generation (`generation-prompts.ts`, `generate.ts`)

- **Tool wiring** in `generate.ts`: add entries to `TOOL_NAME_BY_TYPE`,
  `GENERATION_TOOL_BY_TYPE`, and a `parseToolInput` case for
  `CONTEXTUAL_PARAPHRASE`. Define the generation tool JSON schema (source sentence,
  constraintKind, bannedTerms/targetRegister/audience, constraintLabel,
  referenceParaphrases).
- **Prompt section** in `generation-prompts.ts` (a rendered type-specific section, like
  the sentence_construction section at ~line 244 — ships with the CODE deploy, not a
  Langfuse template edit):
  - Meaning must be **preservable** under the constraint.
  - `avoid`: the banned term(s) must actually occur in `sourceText`; the answer must
    express the same idea without them (circumlocution / synonymy).
  - `register`: source and target register must genuinely differ; the rewrite changes
    register without changing propositional content.
  - `simplify`: audience-appropriate simplification, meaning intact.
  - Produce 2–3 `referenceParaphrases` that each satisfy the constraint.
  - Safe/neutral topics, vocabulary-band, anti-leak rules (adapt the shared rules the
    SC section already inherits).
- **Constraint-kind rotation:** choose `constraintKind` by ordinal, cycling
  `avoid → register → simplify` (mirror `SENTENCE_CONSTRUCTION_MODES` /
  `sentenceConstructionModeForOrdinal`).
- Bump `GENERATION_PROMPT_VERSION` → `generate@2026-07-09`.

### 3b. Validation (`validation-prompts.ts`)

- `buildValidationUserPrompt` case for `CONTEXTUAL_PARAPHRASE`. **Must mirror the
  generation contract** (generate↔validate split is a known silent-failure trap):
  - Constraint well-formed: `avoid` banned terms present in source; `register`
    from/target differ; `audience` sensible.
  - Meaning is preservable and the `referenceParaphrases` actually satisfy the
    constraint AND preserve meaning.
  - Source sentence natural; the task is not trivially degenerate (e.g. banned word has
    no reasonable synonym at this level).
- Bump `VALIDATION_PROMPT_VERSION` → `validate@2026-07-09`.

### 3c. Evaluation (`prompts.ts`)

- `buildUserPrompt` case for `CONTEXTUAL_PARAPHRASE` (user-side, ships with CODE
  deploy). Instruct the evaluator on the `taskAchievement` mapping above (meaning +
  constraint), grammar/vocab/naturalness, and grammar-point attribution from the
  level's key set.
- Bump `EVALUATION_SYSTEM_PROMPT_VERSION` only if the shared SYSTEM prompt body
  changes; a pure `buildUserPrompt` addition may not require it (confirm during impl).

### 3d. Prompt sync note

Per project convention: version bumps drive the fallback cohort tag, but the runtime
serves the Langfuse body. Type-specific **rendered** sections (generation section, eval
`buildUserPrompt` case, validation `buildValidationUserPrompt` case) ship with the CODE
deploy, not `push-prompts`. Any edit to a `*_TEMPLATE` string still needs
`push-prompts` per environment. Flag which is which in the implementation plan.

---

## 4. Diversity mechanisms (hard requirement)

Four layers, defense-in-depth against the pool collapse seen in dictation/free_writing:

1. **Hard uniqueness — `_dedupKey`.** The generation pipeline computes
   `_dedupKey = normalize(sourceText)` and persists it into `content_json`. The
   existing `exercises_dedup_idx` (partial-unique over
   `(language, type, difficulty, grammarPointKey, content_json->>'_dedupKey')`)
   then blocks any repeated source sentence in a cell at INSERT time. **No schema
   change / migration** — the index already keys off `_dedupKey`.
2. **Prior-surface avoid-list.** New `fetchPriorParaphraseSurfaces(db, cell)` (in
   `packages/db/src/generation/run-one-cell.ts`, alongside
   `fetchPriorFreeWritingTitles`) returns distinct `sourceText`s already
   approved/flagged in the cell, deterministically ordered + capped at
   `MAX_PRIOR_POOL_SURFACES`, fed into the generation prompt as "do not reuse these
   sentences." Wire it into the `priorPoolSurfaces` branch in `run-one-cell.ts`
   (the same place free_writing/vocab branch today).
3. **Constraint-kind rotation.** Ordinal-driven cycling across the three constraint
   kinds (§3a) spreads the pool so it isn't 90% one kind.
4. **Scenario-seed rotation.** Per-ordinal seed pick from the umbrella's
   `paraphrase.seeds` via the existing seed-picker, persisted as
   `content_json.seedWord`, with the generic cross-run exclude
   (`fetchPriorSeeds`, already type-agnostic). This forces each draft around a
   **distinct scenario**, which is the exact mechanism that fixed the identity-space
   collapse for conjugation / self-revealing targets. Requires classifying the
   paraphrase cell's `seedKind` in the seed-picker path (reuse the
   `elicitation-values`-style curated-pool branch: seeds come from
   `paraphrase.seeds`, not the frequency band).

**Verification:** validate the generate↔validate contract + the diversity spread with
`pnpm eval:gen` before trusting a scheduler run (route drafts through real validation;
inspect distinct-sourceText and constraint-kind distribution).

---

## 5. Lambda ripple — `infra/lambda/src`

Typecheck surfaces the typed `Record<ExerciseType,…>` / exhaustive-switch sites;
several **runtime allowlists are `Set<string>`/regex and typecheck GREEN while silently
rejecting the new type** — update by hand:

- **`generation/job-message.ts`** — `VALID_EXERCISE_TYPES` Set. **Miss this and every
  enqueued paraphrase job fails to parse → scheduler generates nothing, silently.**
- **`packages/db/src/lib/cell-key.ts`** — `CELL_KEY_REGEX` type segment.
- `generation/cell-targets.ts` — `CELL_TARGET_DEFAULTS` (a real per-`(type,level)`
  target; set a sane distinct-exercise target for paraphrase).
- `lib/today-plan.ts` — `ESTIMATED_MINUTES_BY_TYPE`, `ITEM_COUNT_BY_TYPE` (real values;
  any pool type can be drawn into a session).
- `lib/progress-aggregation.ts` — `axisForExerciseType` (map paraphrase to the
  vocabulary / grammar-range competency axis).
- Session selection (`lib/session-selection.ts` / `lib/exercise-set.ts`) — ensure the
  type is drawable into drills.
- Test allowlists enumerating the old type set (`routes/admin.test.ts`,
  `packages/db/src/generation/cells.test.ts`, etc.) — surface only under the full
  serial run.

**Enumerate all sites at once:** right after editing the enum,
`pnpm turbo run typecheck --continue 2>&1 | grep "error TS"`, then
`rg "sentence_construction.*dictation|cloze.*translation.*vocab"` for the
typecheck-invisible allowlists.

---

## 6. Web ripple — `apps/web`

- **New drill component** `app/(dashboard)/drill/_components/contextual-paraphrase-exercise.tsx`,
  modeled on the translation / sentence-construction components:
  - Source sentence shown prominently; `constraintLabel` as the task; for `avoid`,
    banned terms highlighted (and reminded: "must not appear"); single multiline
    answer field.
  - **Hint ladder** (progressive disclosure, per the hint-system design):
    - L1 (structural, 80% weight): "What structure could I use?" — suggest an
      alternative grammatical route, not words.
    - L2 (content, 50% weight): "Show me a synonym for «X»" — one alternative
      word for a banned term (avoid kind) / one register cue.
    - L3 (reveal, 0% weight + schedule spaced review): reveal ONE
      `referenceParaphrase`.
  - Result view via the existing eval-result surface + a "show another way" affordance
    listing the remaining `referenceParaphrases`.
- Wire into the drill session renderer's type switch.
- `lib/drill/coach-messages.ts` — `idleMessage`/`evaluatedMessage` switch cases.
- `app/(dashboard)/_lib/timeline-labels.ts` — `TYPE_LABELS` entry ("Paraphrase").
- Debrief `app/(dashboard)/drill/debrief/_components/review-item-card.tsx` — render the
  paraphrase item (source + constraint + answer).
- Grep the whole app for any hardcoded exercise-type list / label before finishing
  (label/route changes break integration + page tests that render the component).

---

## 7. Testing & the real gate

- Unit: `generate.test.ts`, `generation-prompts.test.ts`, `validation-prompts.test.ts`,
  `evaluate.test.ts` (paraphrase cases); `curriculum.test.ts` (umbrella/invariant +
  counts); `cell-targets.test.ts`, `today-plan.test.ts`, `cell-key` tests; the new
  component test; `index.test.ts` count bump; `coverage`/`fluency` tests if the new
  type touches those maps (paraphrase is NOT fluency-eligible — free-form, LLM-graded).
- **Real gate (typecheck alone is insufficient):**
  `pnpm turbo run test --concurrency=1` from the worktree root — the runtime
  allowlists and `*.test.ts` count assertions only fail here. Then the standard
  `pnpm lint && pnpm typecheck && pnpm test` pre-push suite.
- **Quality gate:** `pnpm eval:gen` on a paraphrase cell dataset to confirm the
  generate↔validate contract holds (approval rate) and the diversity spread is real
  before relying on the ~04:00 UTC scheduler.

---

## 7b. Doc-status refresh — `docs/exercise-strategy.md` (final task, post-implementation)

After the feature lands, correct the stale `**Status:**` lines in the exercise
catalogue (several already-shipped types still read "Not yet implemented"). Verify each
against the `ExerciseType` enum / generation pipeline before editing — do not mark
anything done that isn't actually wired:

- **#4 Sentence Construction** → `Implemented` (`SENTENCE_CONSTRUCTION` live, generated).
- **#6 Paragraph / Free Writing** → `Implemented` (`FREE_WRITING` live, generated + evaluated).
- **#7 Listening Comprehension** → `Partially implemented` — the **Dictation** sub-type
  is live (`DICTATION`, hand-seeded + Polly audio); comprehension-questions and
  gap-fill-from-audio sub-types are **not** yet built. State this explicitly; do NOT
  mark the whole type done.
- **#14 Conjugation / Inflection Drill** → `Implemented` (`CONJUGATION` live,
  deterministic-first grading), keeping the "scaffolding / remediation sub-mode" framing.
- **#10 Contextual Paraphrase** → `Implemented` (this feature).

Keep each section's existing prose; only the `**Status:**` line changes (plus a short
parenthetical for #7's partial state). Consider also reflecting these in the
"Implementation Order" section if it reads as inconsistent after the edits.

## 8. Rollout / ordering notes

- This is additive: no existing exercise, cell, or stored row changes.
- After merge, the scheduler picks up the 16 new cells on the next run (guaranteed by
  the `CURRICULUM_VERSION` bump). Type-specific rendered prompt sections ship with the
  CDK/code deploy; verify no `*_TEMPLATE` push is required.
- Pool fills over subsequent scheduler runs; the type is drawable into sessions as soon
  as approved rows exist.

## Open questions for the plan

- Exact `CELL_TARGET_DEFAULTS` value for paraphrase (distinct-exercise ceiling per
  `(type, level)`), and seed-pool sizing to comfortably exceed it.
- Whether the eval `buildUserPrompt` change alone (no SYSTEM change) still warrants an
  `EVALUATION_SYSTEM_PROMPT_VERSION` bump — resolve by reading how SC/free_writing
  handled it.
- Which CEFR levels each language's curriculum actually carries for umbrella kinds
  (match existing free-writing/dictation umbrella coverage rather than assuming a flat
  B1–C2 × 4).
