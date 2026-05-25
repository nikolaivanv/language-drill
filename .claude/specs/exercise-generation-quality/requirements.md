# Requirements Document

## Introduction

The `generation-quality-fixes` spec (R1–R8, merged as `81fb20d`) made the exercise-generation
pipeline's validator vetoes fire, added top-up-to-`TARGET_PER_CELL=50` scheduling with
saturated-dedup/low-yield suppression, hardened the malformed-*generator*-draft retry path, and
propagated `exerciseId` to Langfuse. Analysis of the **2026-05-24 production scheduled run** —
which ran *with all of those fixes live* — shows the pipeline still wastes ~70% of generated
drafts. Of 1,244 drafts produced for 573 requested, only 194 were kept; **378 were rejected**
(per-ordinal), splitting into **202 dedup-given-up** (cell saturation) and **176 quality vetoes**.
Separately, across the **1,277 validator calls** in the run (calls exceed ordinals because of
retries, and one draft can trip several checks), the dominant *rejection* triggers were
`context spoils answer` (168 calls) and `low quality (<0.5)` (175), while the dominant *flag*
drivers (flags route to `flagged`, not `rejected`) were `ambiguous` (220) and
`grammarPointMatch=false` (174). Turkish cloze is the epicenter. (Per-call hit counts are larger
than the 176 rejected ordinals precisely because they are counted per validator call and a single
draft triggers multiple reasons — these are not contradictory figures.)

This spec is the **follow-up** that attacks the *causes* the prior spec's validator-side vetoes
only *catch*. It is scoped to five areas, documented in
`docs/exercise-generation-quality-findings.md`:

1. **Cloze format redesign (Issues 7a, 7b)** — make **whole-word blanks** the universal rule for all
   languages (the blank is the entire inflected word, never a suffix/stem fragment). Boundary
   mutation makes partial blanks self-spoiling in every inflecting language — Turkish softening/
   buffers, Spanish stem-changing/irregular verbs (`volver→vuelven`), German ablaut/umlaut — and a
   partial stem also leaks whether a word is irregular. Data shows ES/DE *already* use whole-word
   blanks; **Turkish is the outlier** (40% bare-suffix answers), so this changes Turkish and
   locks-in/guards ES/DE. Plus, for Turkish **case** clozes specifically: replace case-naming
   instructions with **generic instructions + context-forced case selection** and an optional
   **level-gated L1 (English) gloss** disambiguation device. Supersedes the buffer-consonant
   band-aid rule.
2. **Per-cell generation targets + predictive saturation suppression (Issue 2)** — replace the flat
   `TARGET_PER_CELL = 50` with a per-cell target and make saturation suppression *predictive*
   (and add a within-run early-bail) instead of costing a wasted run before it triggers.
3. **Frequency-dictionary-seeded generation for cloze/translation (Issue 8)** — stop relying on the
   LLM to randomly sample diverse sentences; seed each draft with a different content word drawn
   deterministically from the bundled per-language frequency dictionary, injected in the per-draft
   user prompt to preserve prompt caching.
4. **`vocab_recall` per-word cap ("Option A", Issue 9)** — allow up to N exercises per target word
   (varied cues) instead of exactly one, so the same word can be drilled in multiple contexts.
5. **Generator-side anti-leak / anti-ambiguity prompt rules + validator-parse hardening
   (Issues 3, 4, 5)** — reduce *production* of spoiled/ambiguous drafts (the generator side, vs the
   prior spec's validator catch), and ensure a single malformed *validator* response can no longer
   fail a whole cell closed.

**Success metric (cross-cutting):** measured against `generation_jobs.rejection_reason_counts`
(the per-reason map landed in PR #187): on comparable post-change scheduled runs, the
`dedup-given-up` and `context spoils` / `ambiguous` shares of total rejections fall, **without** a
material rise in any other failure mode (`low quality`, `grammarPointMatch=false`, parser failures).
This metric is a **directional review aid, not a hard gate** — a reviewer SHALL NOT block on a
marginal (single-run, within-noise) regression in one reason while the headline waste rate
improves; cohort comparisons use multiple runs. Langfuse `validate`/`generate` traces remain
cohortable by `promptVersion`.

## Alignment with Product Vision

These changes serve the product's core thesis (`product.md`): **active production over passive
recognition** and **honest skill-based progress**.

- **Whole-word Turkish blanks (R1)** make the learner produce the *complete* real-use form
  (case + harmony + buffer + consonant softening), not a decontextualized suffix fragment — the
  authentic production skill the app is built around.
- **Context-forced case selection + L1 gloss (R2)** trains *case selection* — the
  intermediate-plateau skill ("you know the rule but make errors anyway") — instead of handing the
  learner the answer in the instruction.
- **Exercises must actually drill their declared grammar point (R7)** for skill-based progress to
  be honest; `grammarPointMatch=false` at 14% says they often don't.
- **Per-cell targets, predictive suppression, and frequency seeding (R3, R4, R5)** serve the
  **cost-controlled pre-generation** constraint (`tech.md` §1, §7) by ending the dedup death-spiral
  that burns Claude spend for zero new pool variety.
- **The polyglot angle**: Turkish-specific morphophonology handling (R1) is exactly the
  per-language depth a polyglot-first app must get right where one-language-assumption apps don't.

No structure.md exists in steering; file organization follows the monorepo layout in `tech.md` §4
(`packages/{ai,db,shared}`, `infra/lambda`).

## Requirements

### Requirement 1 — Cloze uses whole-word blanks (all languages)

**User Story:** As a learner in any language, I want the blank to be the entire inflected word (not a
suffix or stem fragment), so that I practice producing the real form and the exercise can't leak the
answer — or whether the word is irregular — through a partially-shown stem.

> **Grounding:** production data shows whole-word blanks are *already the de facto convention for
> ES (524 rows, avg `correctAnswer` length 7.3) and DE*, while **Turkish is the outlier** — 40% of
> its 179 cloze answers are ≤3 chars because it blanks bare suffixes (`ev___`→`e`, `iş___`→`ten`).
> This requirement makes whole-word the **explicit universal rule**: it *changes* Turkish and
> *locks in / prevents regression of* the existing ES/DE behavior. The driver is general, not
> Turkish-specific — boundary mutation bites every inflecting language: Spanish stem-changing and
> irregular verbs (`volver→vuelven`, `tener→tengo`, `buscar→busqué`), German ablaut/umlaut
> (`fahren→fährt`, `geben→gibt`, `Apfel→Äpfel`). A suffix-only blank either shows the citation stem
> (making the correct fill wrong: `vol___`+`vemos`≠`volvemos`-for-stressed-forms) or shows the
> mutated stem (revealing the irregularity). And mixing partial blanks (for regulars) with
> whole-word blanks (for irregulars) in one cell itself leaks which verbs are irregular — so the
> rule must be uniform.

#### Acceptance Criteria

1. WHEN the generator produces a `cloze` exercise for **any** `language` THEN the `___` blank in
   `sentence` SHALL stand for the **whole inflected word**, and `correctAnswer` SHALL be that
   complete surface form (e.g. `kahveyi`, `vuelven`, `fährt`) — never a bare suffix/inflection
   fragment (`yi`, `en`, `t`) and never a stem-with-attached-blank (`kahve___`, `vol___`).
2. WHEN a cloze blanks a word whose citation form is not otherwise recoverable from context THEN the
   generator SHALL show the **lemma/citation form** as a parenthetical hint adjacent to the sentence
   (e.g. `Annem her sabah ___ içiyor. (kahve)`; `Mi jefe dijo que nos ___ un aumento. (dar)` — the
   latter pattern already appears in the ES pool), so the task is *inflect this word*, not *recall
   which word*.
3. WHEN a cloze stem undergoes a boundary/stem mutation under the target inflection — Turkish
   consonant softening / buffer consonants (`kitap→kitabı`, `kahve→kahveyi`); Spanish
   stem-change/irregular/orthographic shifts (`volver→vuelven`, `tener→tengo`, `buscar→busqué`);
   German ablaut/umlaut (`fahren→fährt`, `Apfel→Äpfel`) — THEN the displayed text SHALL NOT reveal
   the mutated stem; the learner SHALL produce the mutation as part of the whole-word answer.
4. WHEN the universal whole-word convention ships THEN the prior **"Buffer-consonant ambiguity"**
   rule in `GENERATION_SYSTEM_PROMPT_TEMPLATE` (`packages/ai/src/generation-prompts.ts:176`) SHALL
   be removed or replaced, because whole-word blanks make the buffer boundary moot (no
   `correctAnswer: "um"` vs `"yum"` ambiguity). The predecessor spec's TR-cloze conventions that
   this renders **moot for newly-generated cloze** SHALL be noted as superseded — specifically
   `generation-quality-fixes` R7's stem-embedded-buffer / dual-`acceptableAnswers` convention and
   its `"Ben çok mutlu___" → "um"` example — so a future reader does not try to honor both
   conventions at once. (Existing stored rows in the old convention remain servable per the
   Backward-compatibility NFR.)
5. WHEN the deterministic Turkish harmony gate (`checkTurkishCloze` in `packages/ai/src/`, applied
   via `applyDeterministicChecks` in `packages/db/src/generation/deterministic-checks.ts`)
   evaluates a whole-word TR cloze THEN it SHALL operate on the full `correctAnswer` surface and
   SHALL NOT regress (no new false `wrong-harmony`/`non-word-stem` verdicts introduced by the
   format change).
6. WHEN this rule ships THEN the implementation/migration effort SHALL be understood to be
   concentrated in **Turkish** (ES/DE already comply, so most ES/DE rows need no change); existing
   ES/DE rows that already use whole-word blanks SHALL require no rewrite, and the rule's value for
   ES/DE is preventing future partial-blank regressions (incl. the irregular-verb leak).
7. WHEN `GENERATION_SYSTEM_PROMPT_TEMPLATE` changes for this requirement THEN
   `GENERATION_PROMPT_VERSION` in `packages/ai/src/generation-prompts.ts` SHALL be bumped to
   `generate@YYYY-MM-DD` and pushed to Langfuse per the Uniform prompt-publish rule (NFR §
   Observability).

### Requirement 2 — Generic instructions, context-forced case selection, optional L1 gloss

**User Story:** As a Turkish learner past A2, I want the exercise to make *me* decide which case the
sentence needs (from context), so that I practice case selection — not just suffix mechanics handed
to me by the instruction.

#### Acceptance Criteria

1. WHEN the generator writes `instructions` for a TR **case** cloze (accusative, dative, locative,
   ablative, genitive) THEN it SHALL use a generic form ("Fill in the blank with the correct form
   of the word in parentheses") that names neither the specific case nor the suffix — relying on
   the sentence context to force the choice.
2. WHEN a TR case cloze is generated THEN the surrounding sentence SHALL constrain exactly one case
   as correct (e.g. motion-from → ablative, motion-to → dative), so removing the case cue does not
   create an `ambiguous` veto.
3. WHEN the target case is **accusative** (which marks *definiteness*, hard to force in a short
   L2-only sentence) THEN the exercise SHALL include a disambiguation device — either an explicit
   definiteness-forcing context OR an L1 (English) gloss — so the validator's `ambiguous` /
   `contextSpoilsAnswer` checks pass.
4. WHEN an L1 gloss is included THEN it SHALL be **level-gated**: present for CEFR A1–A2, omitted by
   default for B1+ (where richer L2 context is expected to disambiguate).
5. WHEN an L1 gloss is included THEN it SHALL disambiguate meaning/case **without** stating the rule
   outcome or the required form — i.e. it must satisfy the existing "Spoiled blank" rule (the gloss
   `"I drink the coffee"` is allowed; `"use the accusative -yi"` is not).
6. WHEN this changes the generator prompt and/or `ClozeContent` shape THEN `GENERATION_PROMPT_VERSION`
   SHALL be bumped and any new content field SHALL be optional and ignored by existing runtime
   consumers (type guards discriminate on `type`).

### Requirement 3 — Per-cell generation targets replace the flat `TARGET_PER_CELL = 50`

**User Story:** As the pipeline maintainer, I want narrow grammar cells to target a realistic number
of distinct exercises, so that the scheduler stops grinding unreachable targets into dedup waste.

#### Acceptance Criteria

1. WHEN the scheduler decides whether to enqueue a cell THEN the per-cell target SHALL be derived
   from a **configurable target function** rather than the single global `TARGET_PER_CELL = 50`
   constant. The configuration *granularity* (per-cell vs per-(exercise-type, CEFR) vs a curriculum
   field) is a design-phase decision; this AC requires only that the target is no longer one global
   constant and that a narrow cell can resolve to a smaller target than a broad one.
2. WHEN a narrow A1/A2 grammar point is configured THEN its target SHALL be set to a realistic
   distinct-exercise ceiling (e.g. ~15–20) rather than 50.
3. WHEN `decideEnqueue` computes `need` THEN it SHALL use the cell's configured target
   (`target - approvedInPool`), preserving the existing per-cell cost-cap behavior.
4. WHEN a cell's `approvedInPool` already meets or exceeds its configured target THEN the scheduler
   SHALL skip it (`skip-target-reached`), as today.
5. WHEN the target configuration is added THEN existing `scheduler-decision.test.ts` cases SHALL be
   updated and new cases SHALL assert per-cell target resolution, including the narrow-cell path.

### Requirement 4 — Predictive saturation suppression and within-run early-bail

**User Story:** As the pipeline maintainer, I want a saturated cell to be skipped *before* it burns a
wasteful retry-heavy run, so that I don't pay for a full bad run before suppression kicks in.

#### Acceptance Criteria

1. WHEN the scheduler evaluates a cell whose live approved pool is at/near its realistic ceiling
   THEN it SHALL suppress (or sharply reduce `need` for) that cell **on the same tick**, without
   requiring a prior wasteful run's `dedup_given_up_count` to trigger it.
2. WHEN a generation job is running a cell and dedup collisions dominate the first N ordinals
   (configurable threshold) THEN `runOneCell` SHALL **early-bail** the remaining ordinals for that
   cell, recording the bail in the audit row / structured log, rather than exhausting all retry
   budget.
3. WHEN an early-bail occurs THEN the `generation_jobs` row SHALL still close as `succeeded` with
   accurate counts (inserted/approved/flagged/rejected/dedup-given-up) and the early-bail SHALL be
   distinguishable in logs from a normal completion.
4. WHEN predictive suppression is added THEN it SHALL preserve the existing
   curriculum-version-mismatch-clears-suppression behavior (`generation-quality-fixes` R6.4 — the
   scheduler compares the cell's recorded `generation_jobs.curriculum_version` against the on-disk
   `CURRICULUM_VERSION_<LANG>` constant, and a mismatch clears all suppression) so a curriculum edit
   still forces a fresh attempt.
5. WHEN the suppression/early-bail logic is added THEN it SHALL keep the scheduler's enumeration
   query index-only (no new per-cell SQL round-trips that break the single-aggregate design).

### Requirement 5 — Frequency-dictionary-seeded generation for cloze and translation

**User Story:** As the pipeline maintainer, I want each cloze/translation draft anchored on a
different content word from our frequency list, so that the generator produces lexically diverse
sentences instead of mode-collapsing onto duplicates.

#### Acceptance Criteria

1. WHEN a `cloze` or `translation` cell is generated THEN each ordinal SHALL be assigned a
   **distinct content-word seed** drawn deterministically (a pure function of cell + batchSeed +
   ordinal) from the bundled frequency dictionary (`packages/ai/src/frequency/{es,de,tr}.json`).
2. WHEN seeds are selected THEN closed-class words SHALL be excluded using the existing stopword
   lists (`stopwords-{es,de,tr}.json`), and the candidate pool SHALL be restricted to a
   **CEFR→rank-band mapping** (rank as a band proxy, since the `cefr` field is currently
   unpopulated). A coarse mapping SHALL exist and be applied — starting point, tunable in design:
   A1 ≈ ranks 1–1000, A2 ≈ 1000–2500, B1 ≈ 2500–5000, B2 ≈ 5000–10000. The AC is satisfied when a
   single such mapping is defined in one place and used by the seed picker; the exact boundaries are
   a design-phase decision.
3. WHEN seeds are selected THEN words already used in the cell's live pool SHALL be excluded from
   the candidate set (a positive "build around X" driver that does not re-propose existing anchors).
4. WHEN a seed is passed to the generator THEN it SHALL be injected in the **per-draft user prompt**
   (`buildGenerationUserPrompt`), NOT the cached system prompt, so the Anthropic cache prefix stays
   byte-identical across the batch (prompt-caching cost saving preserved).
5. WHEN the seed instruction is rendered THEN it SHALL be a **loose** constraint ("build the
   sentence around this word; if it does not fit the grammar point naturally, choose a related
   content word of similar frequency"), so seeding does not trade dedup rejections for quality
   rejections.
6. IF the frequency dictionary has no eligible seed for a given (language, rank window) THEN
   generation SHALL fall back to the current unseeded behavior for that ordinal (no hard failure).
7. WHEN seeding changes the user prompt THEN `GENERATION_PROMPT_VERSION` SHALL be bumped (the
   per-draft message is part of the prompt surface even though it is not cached) and the seed used
   SHALL be recorded as a **named Langfuse trace-metadata key** (`seedWord`, plus `seedRank`) on the
   per-ordinal `generate` trace — not an ad-hoc field — so seeded vs unseeded runs can be queried
   reproducibly (mirroring the predecessor spec's `exerciseId` metadata rigor).

### Requirement 6 — `vocab_recall` allows up to N exercises per word (Option A)

**User Story:** As a learner, I want to encounter the same vocabulary word in several different
exercises/cues, so that I build the word through varied retrieval rather than seeing it exactly
once.

#### Acceptance Criteria

1. WHEN `vocab_recall` exercises are deduplicated THEN the rule SHALL allow **up to N (configurable,
   N≈3–4) approved exercises per `expectedWord` per cell**, instead of exactly one.
2. WHEN more than one exercise exists for the same word THEN they SHALL differ on the **retrieval
   cue** (`prompt`), not merely on `exampleSentence` (the example sentence does not change the
   recall task; it is only hint level 3).
3. WHEN the dedup index is changed to permit N-per-word THEN it SHALL still block exact-duplicate
   `(word, cue)` pairs, and a per-word **count cap** SHALL prevent a single word from exceeding N
   (so context variation cannot collapse vocabulary breadth within the cell).
4. WHEN the dedup index migration runs THEN it SHALL be forward-only and SHALL NOT orphan or
   invalidate existing approved/flagged `vocab_recall` rows.
5. WHEN `fetchPriorVocabRecallSurfaces` feeds the generator THEN it SHALL provide words that have
   **reached the cap** as the "avoid" set, while under-cap words MAY be re-proposed with a *new*
   cue — so the cell fills toward `N × distinctWords` rather than `1 × distinctWords`.
6. WHEN per-cell targets (R3) are computed for `vocab_recall` cells THEN they SHALL account for the
   enlarged surface space (`N × distinctWords`).

### Requirement 7 — Generator-side anti-leak and anti-ambiguity rules

**User Story:** As a learner, I want exercises that don't leak their answer in the visible text and
that test exactly the grammar point claimed, so that I'm actually producing, not pattern-matching.

#### Acceptance Criteria

1. WHEN `GENERATION_SYSTEM_PROMPT_TEMPLATE` is rebuilt THEN it SHALL include explicit
   **anti-answer-leak** guidance with concrete negative examples (e.g. the target lemma or a strong
   cue appearing in the visible sentence/hint adjacent to the blank), targeting the
   `context spoils answer` failure mode (168 validator hits on 2026-05-24).
2. WHEN the prompt is rebuilt THEN it SHALL include explicit **stay-on-target** guidance instructing
   the generator that the blank must require the cell's declared grammar point — addressing
   `grammarPointMatch=false` (174 hits).
3. WHEN the prompt is rebuilt THEN it SHALL strengthen the **single-correct-fill** guidance to
   reduce `ambiguous` drafts (220 hits), consistent with the existing `acceptableAnswers` rule.
4. WHEN these prompt rules change THEN `GENERATION_PROMPT_VERSION` SHALL be bumped and the change
   pushed to Langfuse.
5. WHEN the change ships THEN the validator (`VALIDATION_SYSTEM_PROMPT_TEMPLATE`) SHALL remain the
   safety net (these are generator-side *reductions*, not replacements for the existing vetoes); no
   weakening of the validator's `contextSpoilsAnswer` / `ambiguous` checks.

### Requirement 8 — A malformed validator response cannot fail a whole cell closed

**User Story:** As the pipeline maintainer, I want one malformed validator tool-call to cost at most
one draft, so that a single bad response can't discard every ordinal in a cell. (This extends
`generation-quality-fixes` R5, which isolated malformed *generator* drafts via the `RetryOutcome`
discriminated union, to the *validator* response path it did not cover.)

#### Acceptance Criteria

1. WHEN the validator returns a tool call missing or malforming a required field (e.g.
   `flaggedReasons` absent — the exact failure that killed
   `tr-a1-cloze-personal-suffixes` on 2026-05-24 with `Invalid flaggedReasons: must be an array,
   got undefined`) THEN parsing SHALL NOT throw an unhandled error that aborts the cell.
2. WHEN `flaggedReasons` (or `culturalIssues`) is absent or not an array THEN the parser SHALL treat
   it as an empty array, OR the single offending draft SHALL be routed to `rejected`
   (parser-failed) — but in neither case SHALL the remaining ordinals in the cell be lost.
3. WHEN a per-ordinal validator-parse failure occurs THEN it SHALL be counted and surfaced
   (analogous to the existing `parserFailedCount` for generator drafts) so it is visible in the
   structured log / audit row, not silently swallowed.
4. WHEN every ordinal in a cell legitimately fails THEN the cell MAY still fail closed (current
   behavior preserved); the requirement is only that a *single* malformed validator response is
   isolated to its ordinal.
5. WHEN this hardening is added THEN existing tests (`validate-and-insert.test.ts`,
   `run-one-cell.test.ts`) SHALL be extended to cover the malformed-validator-response scenario.

## Non-Functional Requirements

### Performance
- **Prompt caching preserved (tech.md §7):** all newly-injected per-draft data (frequency seeds,
  per-ordinal gloss decisions) SHALL live in the user prompt, leaving the cached system prompt
  byte-identical across a batch so the ~80% prompt-token cache saving holds.
- **Scheduler stays index-only:** new target/suppression logic SHALL NOT add per-cell SQL
  round-trips; it reuses the existing single enumeration aggregate plus the most-recent-job lookup.

### Reliability
- **Cell isolation:** no single draft, validator response, or seed lookup failure SHALL abort a
  cell or the run (extends the prior spec's per-ordinal isolation to the validator path).
- **Forward-only migrations (tech.md §5):** the `vocab_recall` dedup-index change is forward-only
  and non-orphaning for existing rows.
- **Backward compatibility:** existing stored exercises (old partial-blank TR cloze; one-per-word
  vocab) remain valid and servable; format changes apply to **newly generated** content only. No
  destructive rewrite of the live pool is in scope; a separate re-pass over the existing pool, if
  desired, follows the `docs/runbooks/prompt-update-and-revalidate.md` runbook (via
  `pnpm revalidate:cloze`) and is **out of scope here**.

### Observability / Measurability
- Every change SHALL be measurable via `generation_jobs.rejection_reason_counts` and Langfuse
  cohorting by `promptVersion`.
- **Uniform prompt-publish rule (applies to every prompt-editing AC: R1.7, R2.6, R5.7, R7.4):** any
  edit to a `*_SYSTEM_PROMPT_TEMPLATE` SHALL (a) bump the matching `*_PROMPT_VERSION` to
  `<surface>@YYYY-MM-DD` AND (b) be **pushed to Langfuse** via `pnpm push-prompts`, because the
  runtime serves the Langfuse body and a repo-only bump is a no-op (per CLAUDE.md). Bumping the
  constant alone does not satisfy these ACs.
- The frequency seed used per ordinal SHALL be recorded as named trace metadata (`seedWord`,
  `seedRank`) to allow A/B comparison of seeded vs unseeded generation.

### Cost
- The net effect SHALL reduce wasted drafts (dedup-given-up + quality rejections) per kept exercise;
  the existing per-cell `SCHEDULER_PER_CELL_COST_CAP_USD` cap remains in force.

### Usability (learner-facing)
- Whole-word blanks and (optional, level-gated) L1 glosses SHALL render correctly in the existing
  cloze UI (`apps/web/.../cloze` renderer); the lemma hint and gloss SHALL be visually distinct from
  the sentence and SHALL NOT themselves spoil the answer.
