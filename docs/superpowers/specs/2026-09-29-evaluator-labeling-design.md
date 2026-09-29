# Evaluator labeling surface — design

**Date:** 2026-09-29
**Status:** approved design, not yet implemented
**Surfaces:** `/admin/labeling` (new page), `infra/lambda/src/routes/admin-labeling.ts`
(new route), `submission_labels` (new table), `pnpm export:labels` (new CLI)

## Problem

`pnpm eval` cannot tell us whether the evaluator is *right*. It can only tell us
whether it changed.

`eval-export.ts:493` builds each dataset item with `expectedOutput: trace.output`
— the system's own prior output. Every number the harness reports (`score`
deltas, `cefr.agreementRate`, `avgDistance`, attribution rate) therefore measures
agreement with our previous self. A prompt edit that makes the evaluator
uniformly worse but stable scores as a clean run; a prompt edit that fixes a real
defect reports as a regression against the defective baseline. `pnpm eval:seed`
partially escapes this by recording the observed **bad** output as
`expectedOutput`, so movement reads as improvement — but that fixture holds 3
items.

Nothing in the repo records a human judgment about a learner-facing evaluation.
The evaluator is the only LLM surface that both blocks the UI and writes mastery
evidence, and it is the one surface with no ground truth.

### Why the existing tools do not close this

| tool | what it measures | why it is not ground truth |
|---|---|---|
| `pnpm eval` | candidate vs. recorded prior output | the baseline is the system, not a judgment |
| `pnpm qa:sample` | evaluator vs. an Opus crafter's *intended* answer label | same model family judging itself; synthetic answers, not real learner errors |
| `pnpm eval:validator` | validator vs. an 82-case labelled fixture | measures the **generation** validator, a different prompt |
| `review:flagged` | human verdict on generated **content** | labels exercises, never evaluations |

`eval:validator` is the shape to copy — a labelled fixture with recall and
false-flag rate reported separately. This design builds the labelling surface
that makes the same thing possible for `evaluate.ts`.

### Measured scope (prod, 2026-09-29)

| | count |
|---|---|
| `user_exercise_history` rows | 1,422 |
| LLM-evaluated (`evaluationSource` not `deterministic`) | 1,079 |
| deterministic-source (nothing was judged) | 343 |
| LLM-evaluated since 2026-07-01 | 513 |
| of those, dictation (separate evaluator + prompt — excluded, see below) | 8 |
| distinct users | 4 (one holds 1,378 of 1,422) |
| languages present | ES, TR only — no DE submissions yet |

Of the 513 recent rows, the pass rate (`score >= CORRECT_THRESHOLD`, 0.7) is ~82%
and ~200 carry a non-empty `errors[]`. Two consequences: uniform sampling spends
roughly five labels per failure found, and `es`/`cloze` (26 rows under the pass
mark of 38) is the standout defect concentration.

Every `response_json.evaluation` carries `score`, `feedback`, `errors[]`,
`taskAchievement`, `grammarAccuracy`, `vocabularyRange`,
`estimatedCefrEvidence`.

## Scope

**In:** the labelling surface and its storage — a keyboard-driven admin page, a
`submission_labels` table, the three endpoints behind it, and a CLI that exports
labels to a committed fixture.

**Out (Phase 2, deliberately):** rewiring `pnpm eval` to score against labels.
Building the consumer against an empty label table would be building against a
guess about the fixture contract. Phase 2 starts once ~100 labels exist and is
specced separately; this document names the fixture shape it will read so the
two halves cannot drift.

**Out (not planned):** a second annotator workflow, online/production evals,
Langfuse annotation queues, any change to `evaluate.ts` itself.

## Data model

New module `packages/db/src/schema/labeling.ts` (one purpose per schema module,
matching `exercise-flags.ts` / `gloss-cache.ts`):

```
submission_labels
  id              uuid pk default random
  submission_id   uuid not null → user_exercise_history(id) ON DELETE CASCADE
  grade_ok        boolean            -- null = unsure
  feedback_ok     boolean            -- null = unsure
  tags            jsonb not null default '[]'
  critique        text
  stratum         text not null      -- 'random' | 'targeted'
  prompt_version  text
  labeled_by      text not null
  labeled_at      timestamptz not null default now()
  UNIQUE (submission_id, labeled_by)
  INDEX (stratum, labeled_at)
```

`grade_ok` and `feedback_ok` are separate because they fail independently and
have different fixes. A wrong grade (score, pass/fail, error attribution)
corrupts `user_grammar_mastery`; a wrong explanation misleads the learner while
leaving progress data intact. Collapsing them into one verdict would make the
resulting rate undiagnosable.

**Unique per labeler, not per submission.** Re-labelling upserts, so a
mis-keystroke is correctable, and a second annotator later needs no migration
(which is what a Cohen's-kappa check would require).

**Cascade on the submission.** `user.deleted` sweeps `user_exercise_history`;
labels must follow it out, per the right-to-erasure convention on every other
user-owned table.

**`prompt_version` is stamped server-side** from `EVALUATION_SYSTEM_PROMPT_VERSION`,
never accepted from the request body. A label recorded against an older evaluator
prompt stays identifiable as stale rather than being silently reused as ground
truth for a prompt it never saw.

**No copy of the evaluation is stored.** The label points at the submission; the
evaluation lives in `response_json`, which is only ever appended to (the
`explanation` key, `exercises.ts:917`). The export CLI freezes the evaluation
into the fixture, which is where a stable snapshot is actually needed.

### Tag vocabulary

A closed list in `packages/shared`, shared by web, lambda and the export CLI:

`invented-error`, `missed-real-error`, `wrong-point-attribution`,
`alternative-rejected`, `feedback-contradicts-score`, `feedback-wrong-rule`,
`other`

These seven are a starting guess, not a finding. Expect to add to the list after
the first ~30 labels — a tag is a string in an array, so growth is a
shared-constant edit plus the api-client Zod union, with no migration. Tags are
optional; a free-text `critique` is **required** whenever either binary is
`false`, because the critique is where the next tag comes from.

## Endpoints

New `infra/lambda/src/routes/admin-labeling.ts`, mounted from `admin.ts` with
`admin.route('/', adminLabeling)` exactly as `admin-diversity` is, so it inherits
`admin.use('/admin/*', authMiddleware, adminMiddleware)`. A separate module
because `admin.ts` is already 1,937 lines.

### `GET /admin/labeling/queue`

Query: `stratum` (required), `language`, `type`, `grammarPoint`, `nearBoundary`,
`scoreMin`, `scoreMax`, `hasErrors`, `seed`, `limit` (default 25).

Base predicate, both strata:

- `response_json->'evaluation'->>'evaluationSource' IS DISTINCT FROM 'deterministic'`
- `exercises.type` is one of the **six** types `renderLearnerView` supports:
  `cloze`, `translation`, `vocab_recall`, `sentence_construction`,
  `conjugation`, `contextual_paraphrase`
- no `submission_labels` row for this `submission_id` + caller
- `exercise_id` joins an existing exercise (for content + cell metadata)

The type restriction is load-bearing, not cosmetic. `renderLearnerView`
**throws** on any other type (`qa-sample.ts:74` — free-writing and dictation are
explicitly out of scope, "caller filters them out"), so serving a dictation row
would 500 the endpoint. It is also the right boundary on the merits: dictation is
evaluated by `dictation-eval.ts` under `DICTATION_EVAL_PROMPT_VERSION`
(`dictation@2026-06-14`) and returns a different shape entirely
(`kind`, `diff`, `wordAccuracy`, `listeningCefr`). Labelling it alongside
`EVALUATION_SYSTEM_PROMPT` output would produce one rate over two prompts.

`stratum=random` orders by `md5(id || :seed)` with `seed` defaulting to today's
date, **not** `ORDER BY random()`. A refresh must not reshuffle the queue, a
session must be resumable, and a sample we intend to quote a production rate
from must be replayable.

`stratum=targeted` applies the filters and orders near-boundary rows first, then
error-bearing rows. `nearBoundary` is defined off the constant the app actually
decides with — `score BETWEEN CORRECT_THRESHOLD - 0.2 AND CORRECT_THRESHOLD + 0.1`
(`packages/shared`, currently 0.7 → `[0.5, 0.8]`) — because a row sitting just
under the pass mark is where a grading error flips the learner's outcome and the
mastery observation. The window is a tunable heuristic, so `scoreMin` / `scoreMax`
are also exposed for aiming at a band directly rather than through it.

Each item returns: `submissionId`, `exerciseId`, `language`, `cefrLevel`,
`exerciseType`, `grammarPointKey`, `learnerView`, `referenceAnswers`,
`userAnswer`, `evaluation` (whole object), `evaluatedAt`, plus `remaining`.

`learnerView` is rendered **server-side** by `renderLearnerView`
(`packages/ai/src/qa-sample.ts`) — the same function `qa:sample` solves against,
so the label attaches to exactly what the learner saw and what the harness will
replay. `apps/web` does not depend on `@language-drill/ai` and must not start;
the Lambda already does. `referenceAnswers` is a separate field precisely because
`renderLearnerView` omits answer fields by design; the page renders it in its own
panel and never merges it into the stimulus.

A page of 25 means keyboard navigation never waits on a fetch.

### `POST /admin/labeling/:submissionId`

Body: `gradeOk`, `feedbackOk`, `tags`, `critique`, `stratum`. Upserts on
`(submission_id, labeled_by)`. The server stamps `labeledBy` from the JWT and
`promptVersion` from the constant, and rejects a body that supplies either.
Rejects a `false` binary with an empty `critique` (`400`).

### `GET /admin/labeling/stats`

Per-stratum label counts, `gradeOk` / `feedbackOk` rates per stratum, tag
histogram, count labelled today. Drives the page's progress counter and answers
"do 100 labels exist yet".

## The page

`apps/web/app/(admin)/admin/labeling/page.tsx`, following `flags/page.tsx`: client
component → `api-client` hook → route.

One submission at a time with the whole context on one screen, ordered
stimulus-first so the judgment is formed before the model's answer is visible:

1. what the learner saw (`learnerView`)
2. the learner's answer
3. the reference answer(s)
4. what Claude said — score, the four dimensions, `feedback`, `errors[]` with
   each `grammarPointKey`
5. the label controls

Keyboard: `j`/`f` grade ok/wrong, `k`/`d` feedback ok/wrong, `u` unsure both,
`1`–`9` toggle tag, `/` focus critique, `Enter` save + advance, `←`/`→` navigate.
The legend is always visible — a shortcut you have to remember is one you will
not use.

Saving is optimistic and advances immediately. A failed save toasts and re-queues
that row; a label is never silently dropped.

Header: stratum, active filters, `labelled / target`, today's count.

Components: `_components/submission-card.tsx` (presentational, takes one queue
item, no fetching) and `_components/label-bar.tsx`. The page owns queue state and
the key handler.

New hooks in `packages/api-client`: `useLabelingQueue`, `useSaveLabel`,
`useLabelingStats`, with Zod schemas alongside. The tag union lives in that
schema too — a union added in `shared` but not in `api-client` throws `ZodError`
in prod, which has happened before.

## Export CLI

`packages/ai/scripts/export-labels.ts`, run as `pnpm export:labels` (root alias →
`pnpm --filter @language-drill/ai export:labels`). It sits beside
`eval-export.ts`, which already performs this join. Read-only on the database.

Writes `packages/ai/scripts/fixtures/evaluator-labels.json`:

```jsonc
{
  "description": "Human labels on real learner submissions …",
  "exportedAt": "2026-09-29T…",
  "promptVersionsSeen": ["evaluate@2026-09-22"],
  "cases": [
    {
      "submissionId": "…",
      "stratum": "random",
      "language": "es", "cefrLevel": "B1",
      "exerciseType": "cloze", "grammarPointKey": "es.b1.…",
      "input": { "exercise": { /* content_json */ }, "userAnswer": "iba" },
      "observedEvaluation": { /* frozen at export */ },
      "label": {
        "gradeOk": false, "feedbackOk": true,
        "tags": ["alternative-rejected"],
        "critique": "…",
        "promptVersion": "evaluate@2026-09-22"
      }
    }
  ]
}
```

The evaluation is frozen at export so the fixture is stable, and `stratum` rides
through so Phase 2 reports random-stratum agreement separately from a targeted
defect hunt and can never blend the two into one quoted rate.

Flags: `--stratum`, `--language`, `--min-labels` (refuses to write below it),
`--out`. A committed file rather than a Langfuse dataset push, because every
other eval fixture in this repo is reviewable in a diff.

## Testing

**Route** (`admin-labeling.test.ts`, mocking `../db` — required under turbo):
403 for a non-admin; deterministic-source rows absent from both strata;
already-labelled rows absent; `random` order stable under one seed and different
under another; upsert overwrites instead of duplicating; `labeledBy` /
`promptVersion` in the body rejected; `false` binary with empty critique → 400.

**api-client:** schema tests for the three hooks, including every tag in the union.

**Web:** `submission-card` renders all six queue-eligible exercise types without
throwing; keyboard-handler unit tests for each binding and for save-then-advance.

**CLI:** fake-db shape test, `stratum` passthrough, refusal to write an empty or
below-`--min-labels` fixture.

**Migration:** `drizzle-kit generate` → `0042_*`, applied with `pnpm db:migrate`.

**Runtime evidence:** `pnpm --filter @language-drill/web shoot --route /admin/labeling`
(needs `dev:api` plus the API_URL override), and one real label written against
the dev branch end to end.

**Gate:** `lint` / `typecheck` / `test` package-by-package (a full `pnpm test`
gets killed on this machine), plus a web build, which the package gate misses.

## Decisions, and why

1. **Date-seeded deterministic order for `random`,** not `ORDER BY random()` — a
   sample whose rate we intend to quote has to be replayable, and a reshuffling
   queue cannot be resumed.
2. **Deterministic-source rows (343) excluded from every queue** — no LLM
   judgment was made, so there is nothing to label.
3. **Critique required when a binary is `false`** — the critique is the raw
   material for the tag list; a bare `false` is unusable three weeks later.
4. **Labels are per-labeler** — makes correction cheap now and a second
   annotator possible later without a migration.
5. **No Langfuse write in Phase 1** — the fixture is a committed file, like every
   other eval fixture here.
6. **Admin-gated, not self-service** — 1,378 of 1,422 submissions are the
   author's, and `docs/admin-panel.md`'s progress drill-down already exposes
   learner answers to an admin. No new privacy boundary; no new consent surface.
7. **Queue restricted to the six `renderLearnerView` types** — required (it
   throws otherwise) and correct (one label set, one prompt).

## Risks

**The labels are one person's.** With a single annotator there is no agreement
metric, and the labels inherit that person's blind spots. This is the accepted
trade (one domain expert, no reconciliation cost), and the schema leaves room for
a second labeler if it ever matters.

**Criteria drift.** Judgments on label 5 and label 95 will not be made by the
same standard. `prompt_version` and `labeled_at` are recorded so a drifted cohort
is at least visible; the mitigation is re-reading early labels once the tag list
stabilises, not a schema feature.

**Contamination, if a labelled case becomes a few-shot.** If any labelled
submission is later quoted in `EVALUATION_SYSTEM_PROMPT`, its label stops being a
test case, exactly as `gloss-spoilage-cases.json` records for 10 of its 21 cases.
Phase 2 adds the `heldOut` marking; Phase 1 must not put a labelled submission
into the prompt.

**513 recent rows is a small pool.** Labelling 100 consumes a fifth of it, and
ES/TR only — a DE evaluator regression is invisible until DE submissions exist.

**This covers one evaluator, not all of them.** Dictation
(`DICTATION_EVAL_PROMPT_VERSION`), free-writing (`FREE_WRITING_EVAL_PROMPT_VERSION`)
and read-span annotation each have their own prompt and output shape and stay
unlabelled by this surface. Whatever rate comes out of it describes
`EVALUATION_SYSTEM_PROMPT` only, and any report must say so.
