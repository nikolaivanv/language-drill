# Closing the open `qa:sample` prod findings — Design

> **STATUS (2026-08-11): closed by measurement — sections B, C not executed.**
> The plan's Task 2 gate (§A below) re-measured all four findings against prod
> at `--seed 1`; after a correction to the method (direct replay by exercise
> id, not re-sampling — see the record's "Correction" section), all four
> closed or were dismissed as crafter error. None survived, so **section B**
> (the `EVALUATION_SYSTEM_PROMPT` obligatory-determiner edit + Langfuse push)
> and **section C** (the production `jsonb_set` row repair) were **not run**:
> no prompt change shipped, no Langfuse push happened in either environment,
> no production row was written. §A and §D both executed — Task 1 archived
> the reports and gitignored the run directory; Task 12 corrected the project
> memory, including the #612 attribution, on 2026-08-12. The outcome of
> record is `docs/analysis/qa-sample-findings-2026-08-11.md` — read that
> before treating any part of this spec as pending work.

**Date:** 2026-08-11
**Branch:** `fix/qa-sample-findings-followup`
**Status:** closed 2026-08-11 — gated off by re-measurement; sections A and D both executed (Task 1 archived the reports and gitignored the run directory on 2026-08-11; Task 12 corrected the project memory, including the #612 attribution, on 2026-08-12), sections B and C (evaluator prompt fix, production row repair) gated off and not run. See `docs/analysis/qa-sample-findings-2026-08-11.md`.

---

## Background

`pnpm qa:sample` ([design](2026-07-22-qa-exercise-sampler-design.md), PR #609 / #610) was
run against **production** three times on 2026-07-22, sampling 45 approved exercises for
~$2.93 total. The reports live in `packages/ai/qa-runs/` and had never been acted on:

| Report | Scope | Sampled | Flags |
|---|---|---|---|
| `prod-smoke-es-a1.json` | ES / A1 | 5 | 1 × `false_positive` |
| `prod-tr-b1-sc.json` | TR / B1 `sentence_construction` | 20 | 1 × `low_confidence_solve` |
| `prod-es-b1-cloze.json` | ES / B1 `cloze` | 20 | 3 × `acceptable_answers_gap` |

Triage as of 2026-08-11:

- **TR SC flag — closed, no work owed.** The confidence gate fired as designed (the
  crafter's own "correct" answer, `kaçırdığı yüzünden`, is itself ungrammatical). This run
  is what established that SC over-flagging is generation-validator-side, not
  answer-evaluation-side.
- **ES `gustar` `false_positive` — open.** Crafted-wrong `No me gusta cerveza.` (missing
  obligatory `la`) scored **0.85**, above the `PASS_THRESHOLD` of 0.8. Nothing since the
  run touches obligatory-determiner omission: `prompts.ts` has changed twice (#612
  anti-anchoring, #620 cloze-options visibility), neither relevant. An ungrammatical
  answer is feeding mastery credit for `es-a1-gustar-basic`.
- **Three ES B1 `acceptable_answers_gap` flags — likely stale.** #612 landed
  2026-07-23/24, *after* the run, adding to the cloze user prompt: "When the visible
  sentence does not itself fix the tense/aspect/number, any form the sentence licenses is
  correct". That is precisely this flag class, so the flags must be re-measured before any
  fix is written.

All five flagged rows are still live in the prod pool (4 `auto-approved`, 1
`manual-approved`, `demotion_reason` NULL on every one).

### Per-row judgement of the three cloze flags

| Row | Stem | Crafted alternative | Verdict |
|---|---|---|---|
| `es-b1-deber-obligation-probability` | *Ayer rompí el vaso sin querer. `___` tener más cuidado la próxima vez.* (correct `Debería`) | `Debo` scored 0.35 | **Real defect.** Mood is unconstrained — *Debo tener más cuidado* is valid. Worse, `Debo` is listed as a **distractor** in the row's own `options`. |
| `es-b1-collective-agreement` | *La gente del barrio `___` la nueva señal de tráfico de manera diferente. (interpretar)* (correct `interpreta`) | `interpretó` scored 0.3 | **Real defect, #611 class.** No tense anchor licenses the present over the preterite, and singular `interpretó` still demonstrates the collective-agreement point. |
| `es-b1-adjective-de-infinitive` | *Esa canción es difícil `___` olvidar.* (correct `de`) | `(nothing)` scored 0 | **Crafter error, not a pool defect.** The raised-object frame requires `de`; *"Esa canción es difícil olvidar"* is not grammatical. Scoring it 0 was correct. No fix owed. |

---

## Goals

1. Establish which findings still reproduce against today's prompts, rather than fixing
   from a three-week-old report.
2. Stop the evaluator passing answers that omit a determiner the target grammar requires.
3. Repair any surviving underdetermined cloze rows without shrinking the pool while
   nightly generation is paused.
4. Make prod `qa:sample` reports durable records instead of untracked local files.

**Non-goals:** re-running broader `qa:sample` sweeps, touching the SC generation
validator, and the two systemic issues logged under "Out of scope" below.

---

## A. Re-measure first (gates B and C)

Prod credentials via Neon MCP (`get_connection_string`, project
`twilight-smoke-01114337`, branch `br-green-waterfall-ancrvpr5`) written to a scratchpad
env file, invoked as
`pnpm exec dotenv -e <file> -- pnpm --filter @language-drill/ai qa:sample …`, file deleted
afterwards. Runs are **backgrounded** (sequential sampling exceeds the 2-minute foreground
Bash timeout). `--language`/`--cefr` uppercase; note `pnpm <script> -- --flag` is broken
for `packages/ai` CLIs, so flags are passed without the `--` separator.

| Run | Command | Est. cost |
|---|---|---|
| ES A1 smoke | `qa:sample --language ES --cefr A1 --per-point 1 --limit 5 --seed 1 --max-cost-usd 0.5` | ~$0.25 |
| deber | `qa:sample --language ES --cefr B1 --type cloze --grammar-point es-b1-deber-obligation-probability --per-point 2 --seed 1 --max-cost-usd 0.5` | ~$0.30 |
| collective agreement | same, `--grammar-point es-b1-collective-agreement` | ~$0.30 |
| adjective + de + infinitive | same, `--grammar-point es-b1-adjective-de-infinitive` | ~$0.30 |

The fourth run is included only to confirm the crafter-error reading; a flag there is
expected and will be dismissed, not fixed.

**Decision rule.** A finding "survives" only when the **same reason** fires on the **same
exercise id**. Anything that clears is recorded in this spec's follow-up notes as
closed-by-#612 — never silently dropped. Reports are written with explicit
`--name` values (`prod-*-2026-08-11-seed1`) so they sit alongside the originals.

---

## B. Evaluator fix — obligatory determiners (runs if the `gustar` flag survives)

### The change

`EVALUATION_SYSTEM_PROMPT` in `packages/ai/src/prompts.ts` gains the converse of its
existing optional-elements paragraph, appended to that same paragraph so the two rules
read as one contrast (this mirrors how the Turkish `bir` example already sits inside it):

> The converse also holds: elements the target grammar REQUIRES are not in this optional
> class. A Spanish definite article before a generic or mass noun ("No me gusta la
> cerveza", not "…gusta cerveza") and a German article where the noun phrase demands one
> are obligatory; omitting one is a grammatical error — record it and lower
> grammarAccuracy and score. Do not treat an obligatory omission as a stylistic or
> dialectal variant.

No numeric score ceiling: the rubric elsewhere avoids hard caps outside exact-match, and a
cap risks over-generalizing to cases where an omission is genuinely licensed. The existing
optional list (pro-drop subject pronouns, doubled possessives, Turkish `bir`) is left
untouched.

`EVALUATION_SYSTEM_PROMPT_VERSION` bumps to `evaluate@2026-08-11` in the same commit, with
a dated comment in the existing block explaining the edit. This is a **system-prompt** edit
— the cached template changes, so it requires a Langfuse push per environment (unlike the
user-prompt-only edits of #612 / #620).

### Verification, in order

1. **New fixture** `packages/ai/scripts/fixtures/eval-obligatory-determiners.json`,
   dataset `eval-obligatory-determiners`, three items — each `expectedOutput` recording the
   observed bad baseline, per the `eval:seed` convention:
   - the real prod `gustar` row (`No me gusta cerveza.` against reference
     `No me gusta la cerveza.`), baseline 0.85 / no errors;
   - an ES generic-plural case (article-less generic subject);
   - a DE missing-article case.
   Seeded with `pnpm eval:seed --file scripts/fixtures/eval-obligatory-determiners.json`.
2. **Local A/B** — `pnpm eval --dataset eval-obligatory-determiners --candidate file:<baseline-body>`
   vs `--candidate file:<fixed-body>`. `--candidate` is injected as `systemPromptOverride`,
   so both arms run without touching Langfuse. Success = the ES `gustar` item drops below
   0.8 **and** reports a grammar error, with no regression on the other two items.
3. **Langfuse sync** — `push-prompts --dry-run` then `push-prompts` for prod and dev with
   inline `LANGFUSE_*` creds from Secrets Manager, then `bootstrap-prompts --check` (exit 0)
   per environment. The prior version is logged as the revert target. Push from this
   worktree only after rebasing on `main`, so no unrelated drifted prompt gets reverted.
4. **End-to-end confirm** — re-run the ES A1 seed-1 sample against the live prompt (~5 min
   after the push, for the Lambda module-scope cache) and confirm the `false_positive`
   clears.

### Rollback

Re-point the `production` label at the version logged by `push-prompts`, in each
environment's Langfuse dashboard. The in-repo constant is only the fallback body, so a code
revert alone would not restore behaviour.

---

## C. In-place row repair (runs only for surviving cloze flags)

For each surviving row, append the licensed alternative to
`content_json.acceptableAnswers` on prod via Neon MCP — `Debo` for the deber row,
`interpretó` for the collective-agreement row. The evaluator's exact-match rule then scores
it 1.0.

- `review_status`, `demotion_reason`, mastery, and history are untouched — this is a
  content repair, not a demotion, chosen because nightly generation is **paused in prod**
  (#615) and a demotion would leave the cell thin with nothing to refill it.
- Each write is a targeted `jsonb_set` on a single id, with the prior `content_json`
  captured in the run notes first.
- Confirmed by re-running that grammar point's seed-1 sample and observing the flag clear.
- No action on `es-b1-adjective-de-infinitive`.

---

## D. Records hygiene

1. Commit the three existing prod reports to `docs/analysis/` (unchanged content) plus the
   new seed-1 re-runs, so the records survive `git clean` and the worktree.
2. Add `packages/ai/qa-runs/` to `.gitignore` beside the existing `packages/ai/audit-runs/`
   entry, with the same "commit interesting runs to `docs/analysis/` instead" comment.
3. Correct the `qa-sample-tool` memory: it claims the directory is gitignored (it was not,
   until this change) and lists the findings as open.

No code depends on the reports' location; `qa:sample` writes to `./qa-runs/<name>.json`
relative to `packages/ai` regardless.

---

## Testing

- `eval-seed.test.ts` gains a `describe("fixtures/eval-obligatory-determiners.json")` block
  mirroring the existing `fixtures/eval-hard-morphology.json` one: the fixture parses
  through `parseSeedFixture` and covers the three reported cases (ES `gustar` mass noun, ES
  generic plural, DE missing article). Generic shape validation already exists in
  `parseSeedFixture`, so the new test asserts coverage, not schema.
- No new runtime code paths, so no new integration tests: the prompt edit is verified by
  the `pnpm eval` A/B, and the data repair by the seed-1 re-run.
- Full `pnpm lint && pnpm typecheck && pnpm test` from the repo root before push, with
  `esbuild` symlinked into root `node_modules` so the CDK synth tests can run.

## Out of scope, deliberately logged

- **Zero-article cloze answer format.** `es-b1-adjective-de-infinitive` stores
  `(nothing)` as an option label; there is no defined way for a learner to type it. Related
  to the open zero-article thread in the answer/stem-overlap work.
- **Valid answers used as distractors.** The deber row offers `Debo`, a correct answer, in
  its `options`. That is a generation-side defect and needs its own validator rule; the
  repair here only fixes scoring for the affected row.
