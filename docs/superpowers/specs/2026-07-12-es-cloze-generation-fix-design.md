# ES cloze generation fix — design

**Date:** 2026-07-12
**Author:** brainstorm session (Claude + nikolaivanv)
**Status:** design approved, pending spec review → writing-plans

## Problem

The 2026-07-12 scheduled generation run (60 cells, all succeeded, 57.6% approval)
surfaced two ES cloze cells that produce **zero approved exercises** and are about
to be silenced by the scheduler:

| Cell (`cell_key`) | Approved (all-time) | Flagged | Today's rejects |
|---|---|---|---|
| `es:a1:cloze:es-a1-quantifiers-muy-mucho` | **0** | 2 | 4/4 `context-spoils-answer` |
| `es:a2:cloze:es-a2-present-irregular-stem-changes` | **0** | 20 | 2 `low-quality-reject` |

Both recorded `curriculumVersion = 2026-07-11b`, which equals the on-disk
`CURRICULUM_VERSION_ES`. With a recent job approving `< LOW_YIELD_THRESHOLD (3)`,
below target, and not target-seeded, `scheduler-decision.ts` returns
`skip-low-yield` on the next run (verified against the code, not the memory note).
So both cells will be **suppressed** — the pipeline stops attempting them — until
`CURRICULUM_VERSION_ES` is bumped. Learners get no cloze practice for these
grammar points.

These two cells are the acute symptom of two **systemic** root causes (scope
decision: fix both systemically, not just the 2 cells).

### Root cause A — the `context` field spoils the answer (61% of ALL rejects run-wide)

`context-spoils-answer` was 28/58 (61%) of the run's rejects. The generator writes
the grammar rule's *outcome/framing* into the cloze `context` field, e.g.
`"muy vs. mucho: adverb before an adjective or after a verb"`, which the validator
correctly vetoes (`contextSpoilsAnswer`, validation-prompts.ts:132). Flagged
survivors confirm the field also **misframes** the rule ("mucho after a verb" over
a blank that precedes an adjective).

Grounding facts:
- The cloze `context` field is **internal-only** — `apps/web/.../drill/_components/cloze-exercise.tsx`
  never renders it; its test destructures `context` out and proves the component
  works without it. So neutralizing it has **zero learner-facing impact**.
  > **CORRECTION (post final-review):** this premise was wrong. `context` IS
  > learner-facing — `ClozePrompt` (`apps/web/components/drill/cloze-prompt.tsx:88-94`),
  > reached via `_components/cloze-exercise.tsx`, renders it as an eyebrow micro-tag.
  > The earlier grep inspected the wrong component. Decision unchanged (truly omit),
  > but with eyes open: new cloze cards drop the tag (it was often the spoiler);
  > stored rows still show it via the back-compat-optional `ClozeContent.context`.
  > Enforcement also required a hard `additionalProperties: false` guard on the cloze
  > tool schema **and** sweeping the `context` field-refs from the system-prompt
  > template — so `push-prompts` per env IS needed post-merge (the "code-only,
  > no push-prompts" simplification is void).
- The validator already vetoes spoilage on `context`/`instructions` and handles a
  null `context` (`content.context ? … : ""`). No validator logic change needed.

### Root cause B — register-inappropriate seedWord for low-CEFR cloze

Cloze cells receive an injected `seedWord` from the **frequency band**
(`buildSeedWords` → `seedKind: 'frequency'` → `loadFrequencyBand`, rank-windowed).
Frequency ranking is **register-blind**, so `comandante`/`tribunal` (military/legal),
`amanecer`, and `obtener` reach A1/A2 cells and blow `level-match`. This is the
[conjugation-cells-need-curated-verbs] pattern applied to plain cloze, which has
**no curated word list at all**.

## Design

### A. Omit the `context` field on cloze

Edit the cloze rules block in `GENERATION_SYSTEM_PROMPT_TEMPLATE`
(`packages/ai/src/generation-prompts.ts`) to instruct the generator to **emit no
`context` field for cloze exercises**. The field carries no learner value and is
pure spoiler surface. The validator's `contextSpoilsAnswer` veto stays as
defense-in-depth (and still catches any leak via `instructions`).

*Rejected alternative:* keep `context` and harden the anti-spoil wording — that is
exactly what is failing today.

### B. Register-aware seedWord (prompt-side soft-anchor + self-filter)

The injected content-word seed is already substitutable for grammar cells
(generation-prompts.ts ~line 753, "choose a related content word of similar
frequency instead"). Strengthen it so the generator **MUST replace a seed that is
register-specific (military / legal / medical / administrative / literary) or above
the cell's CEFR band with an everyday, level-appropriate word of similar
frequency**, and make the vocabulary-band rule explicitly apply to the injected
seed. This leans on the model's register judgment — the same model, acting as
validator, already flags these correctly — and needs **no data migration**.

*Deferred (YAGNI):* also narrowing the A1/A2 frequency rank window. Hold unless
`eval:gen` shows the prompt lever alone is insufficient.
*Rejected:* register-tagging `vocab_lemma` (heavy data migration, overkill now).

### Non-goals

- No validator logic change (its veto is already correct; `context` is null-safe).
- No output-schema change (context stays optional → no generate↔validate structural
  mirror per [generate-validate-contract-split]).
- No frequency-window or `vocab_lemma` change in this iteration.

## Mechanics

- **Version:** bump `GENERATION_PROMPT_VERSION` → `generation@2026-07-12`
  (CLAUDE.md rule). No `VALIDATION_PROMPT_VERSION` bump (non-structural change).
- **Validation gate (before merge):** `eval:gen` A/B — baseline
  `langfuse:<name>@production` vs candidate `file:<edited prompt>` — over a dataset
  built from the 2 dead cells plus a lowest-approval ES cloze sample
  (`eval:gen:export`). Ship only if approval-rate rises and `context-spoils` /
  `level-mismatch` reasons fall. Bound with `--max-cost-usd`.
  Rationale: a Langfuse prompt push only affects future runs, and the ~04:00 UTC
  scheduler converges over ~2 days; `eval:gen` A/Bs the edit now
  [verify-prompt-changes-with-eval-gen].
- **Tests:** update `generation-prompts.test.ts` expectations for the new cloze
  rules; run full `pnpm turbo run test --concurrency=1` (the real gate —
  [package-typecheck-excludes-tests]).

## Rollout — split into two PRs (decoupled risk)

**PR1 — prompt fix + eval:gen proof.**
1. Edit `GENERATION_SYSTEM_PROMPT_TEMPLATE` (A + B), bump `GENERATION_PROMPT_VERSION`.
2. `eval:gen` A/B proof attached.
3. Update tests; lint + typecheck + full test green.
4. Merge (squash). **Post-merge:** run `push-prompts` per env **from a fresh main
   checkout** ([push-prompts-stale-worktree] — a stale worktree silently reverts
   unrelated prompts), dry-run → apply for prod **and** dev; confirm
   `bootstrap-prompts --check` is clean. Runtime picks up the new body within
   ~5 min (Lambda module-scope cache TTL).

**PR2 — `CURRICULUM_VERSION_ES` bump (only after PR1's prompt is confirmed live).**
1. Bump `CURRICULUM_VERSION_ES` in `packages/db/src/curriculum/es.ts`.
2. This clears `skip-low-yield` for the 2 dead cells **and every other below-target
   suppressed ES cell**, so the next 04:00 UTC run re-attempts them on the new,
   confirmed-good prompt. Expected side effect: a larger, costlier next ES run —
   intended.
3. Sequencing guard: PR2 must not merge until PR1's prompt is verified live in
   Langfuse, or the re-enabled cells burn a cycle re-failing on the stale served
   prompt.

## Success criteria

- `eval:gen` shows a material approval-rate lift on the ES cloze sample with
  `context-spoils` and `level-mismatch` reasons down.
- After PR2 + the next 1–2 scheduled runs, both dead cells hold `approved ≥ 3`
  (clear of the low-yield floor) in the prod pool.
- Run-wide `context-spoils-answer` share of rejects drops well below the current
  61%.

## Verification data source

Prod pool lives on the Neon **prod branch** `br-green-waterfall-ancrvpr5`
(project `twilight-smoke-01114337`) — local `.env` points at the stale dev branch
([local-env-db-is-dev-branch]).
