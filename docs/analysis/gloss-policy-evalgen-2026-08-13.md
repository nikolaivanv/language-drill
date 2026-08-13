# Gloss-policy `eval:gen` A/B — result (2026-08-13)

The gate for the neutral-gloss clause added in `fix/gloss-policy`
(spec: `docs/superpowers/specs/2026-08-13-gloss-generation-policy-design.md`).

**Verdict: the clause ships as written. The pre-registered failure signal did
not appear — but this run is weaker evidence than the plan assumed, and the
reason is worth recording.**

---

## What was run

```
pnpm eval:gen \
  --baseline langfuse:generate-system-prompt@production \
  --candidate repo \
  --dataset-file scripts/fixtures/cells-gloss-policy.json \
  --drafts-per-cell 5 --max-cost-usd 5 \
  --run-name gloss-policy-2026-08-13
```

Baseline sha `413b7a48` (the live Langfuse body), candidate sha `a782f0a3`
(this branch's in-repo template). 3 cells × 5 drafts × 2 arms = 30 drafts.
Cost $0.661 ($0.348 baseline / $0.313 candidate), not capped.
Artifact: `packages/ai/eval-runs/gloss-policy-2026-08-13.json` (gitignored —
this note is the durable record).

Note the flag path: `--dataset-file` resolves relative to `packages/ai`, not the
repo root, because the root script filters into that workspace.

## Result

| Metric | Baseline | Candidate | Δ |
|---|---:|---:|---:|
| approval rate | 100.0% | 100.0% | +0pp |
| auto-approved | 15 | 15 | +0 |
| flagged | 0 | 0 | +0 |
| rejected | 0 | 0 | +0 |
| parser failures | 0 | 0 | +0 |

Per cell, both arms, all three cells: 5/5 auto-approved, zero flag tags, zero
rejection reasons. `es:a2:cloze:es-a2-saber-poder-ability` — the cell the clause
targets — is 5/5 in both arms.

## What this establishes, and what it does not

**Establishes — with a real caveat about which validator ran.** `eval:gen`'s
`--baseline`/`--candidate` axis only swaps the GENERATION prompt. Validation
always goes through `validateDraft` → `buildValidationSystemPrompt`
(`packages/ai/src/validate.ts:395`) →
`getPromptWithVarsOrFallback("validate-system-prompt")`
(`validation-prompts.ts:238`), which fetches the LIVE Langfuse body — so both
arms in this run validated against `validate@2026-08-12`, the OLD validator,
without this branch's `contextSpoilsAnswer` field-list fix or the mirrored
neutral-gloss guard.

That means the new validator body was **not exercised** by this run at all.
What the run does show is narrower but still useful: neutral-gloss drafts
passed 5/5 against a validator that *lacked* the anti-rejection guard —
i.e. the harsher configuration for the specific risk the plan's decision rule
was watching for (spurious `ambiguous` flags on
`es-a2-saber-poder-ability`). That direction is reassuring precisely because
the safety net wasn't there and the drafts still passed.

What is entirely unmeasured is the opposite direction: this branch's widened
`contextSpoilsAnswer` is a HARD VETO (routes straight to
REJECTED/dropped, not flagged), so if it over-fires on the new `glossEn`
field-list entry or the neutral-gloss clause, the loss is silent — a rejected
draft leaves no flag tag to notice. The only configuration in which the new
validator body is reachable at all is the live Langfuse `production` label
after `push-prompts` runs for an environment, so a post-merge `eval:gen`
re-run against dev (once synced) is the way to close this gap.

**Does not establish:** that the clause improves anything.

- **No headroom.** The baseline was already 100% on these cells, so an
  improvement had nowhere to show. The A/B can only detect regression here.
- **n=5 per cell per arm.** A modest ambiguity rate would plausibly read as
  zero at this sample size. Absence of flags at n=5 is weak evidence of
  absence.
- **Draft text was not retained.** `eval-gen-run.ts` writes aggregate
  per-cell statistics only — no `glossEn` values — so it is *not verified*
  that candidate drafts actually adopted the neutral-gloss shape rather than
  simply continuing to produce whatever the baseline produced. The clause may
  have had no behavioural effect at all in this run and the numbers would look
  identical.

The honest summary: this run rules out the catastrophic outcome against the
OLD validator, but it does not confirm generator/validator agreement under
this branch's actual validator changes — that half is untested until a
post-merge dev run exercises the pushed `validate@2026-08-13` body. It is not
evidence that the gloss policy works. The claim in the spec — that a neutral
"can" gloss is non-ambiguous when the Spanish forces the contrast — remains
reasoned from ~12 production rows, not measured.

## Follow-up worth doing

The cheapest way to close the real question is to have the eval harness retain
draft `glossEn` values (or run a scoped `audit:gloss` over the cell after the
next generation pass) and check directly whether new `es-a2-saber-poder-ability`
drafts gloss with "can" plus in-Spanish contrast, or still reach for "know how
to". That is a measurement of the mechanism, not of the approval rate, and the
approval rate was never going to answer it.

## Gate

`pnpm lint` **7/7 clean**. `pnpm typecheck` **13/13 clean**.

`pnpm test` — **11 of 13 tasks pass. `@language-drill/lambda` and
`@language-drill/web` fail under full parallel load, and every one of those
failures passes in isolation.** Evidence, in the order gathered:

| Run | Result |
|---|---|
| full suite, from repo root | 11/13 tasks; lambda 3 files failed, web 4 files failed |
| lambda isolated (first) | 1 file / 5 tests failed — **all in `dist/lib/exercise-filters.test.js`** |
| lambda isolated, after `rm -rf infra/lambda/dist` | 2 files failed: `read.test.ts`, `exercise-flags.test.ts` @ **120,338 / 120,469 ms** |
| those 2 files alone | **47/47 pass** |
| web isolated | 4 files failed — 3 × "Test timed out in 5000ms" + 1 element-not-found |
| those 4 files alone | **75/75 pass** |

Two distinct causes, only one of them pre-existing:

1. **Self-inflicted and now fixed.** The 5 `dist/lib/exercise-filters.test.js`
   failures were *compiled* test files: running `pnpm build` in a fresh
   worktree emits `infra/lambda/dist/**/*.test.js`, which then run alongside
   their own sources against a stale snapshot. `rm -rf infra/lambda/dist`
   clears them. Anyone who runs `pnpm build` before `pnpm test` in a fresh
   worktree will hit this.

2. **Pre-existing contention**, matching PR #642's documented signature
   exactly: `read.test.ts` and `exercise-flags.test.ts` timing out at
   ~120,400 ms against the `hookTimeout: 120_000` in
   `infra/lambda/vitest.config.ts`, whose own comment documents this failure
   mode. Web's are the same class at the 5 s test timeout. **This is the third
   consecutive branch to eat a false gate failure from it** — #642 flagged it
   as a follow-up worth doing separately, and this run is further evidence
   for it. `infra` carries `fileParallelism: false` from #359 for exactly this
   problem; `infra/lambda` and `apps/web` still do not.

Nothing in either package is touched by this branch (all changes are in
`packages/ai` and `packages/db`), and every failure reproduces green in
isolation, so the branch is clean.

Note for anyone repeating this: `pnpm test -- --concurrency=1` does **not**
work in this repo — the root `test` script already passes `--concurrency=4`
and turbo rejects the duplicate argument. Piping that failure through `tail`
masks it as exit 0. Run plain `pnpm test` from the **repo root** and check the
real exit code.

---

## TR ordinal demote — applied 2026-08-13

`pnpm demote:pool --language TR --cefr A1 --type cloze
--grammar-point tr-a1-numbers-ordinals --reason pool-hygiene --apply`, run
against **production** (`br-green-waterfall-ancrvpr5`, endpoint
`ep-withered-hall-an34g3y2`) with an explicit `DATABASE_URL` override — the
local `.env` points at the **dev** branch (`ep-holy-union-anhivmbh`), so the
default invocation would have hit the wrong database.

**20 rows demoted** to `review_status='rejected'`,
`demotion_reason='pool-hygiene'`. Verified after:

| type | review_status | demotion_reason | rows |
|---|---|---|---:|
| cloze | flagged | — | 34 |
| cloze | rejected | pool-hygiene | **20** |
| translation | auto-approved | — | 20 |
| translation | flagged | — | 18 |

Zero approved cloze remain in the cell; the point keeps its 20 approved
translations. No mastery-stale reminder was printed, which is correct —
`pool-hygiene` does not revoke learner credit, so no `backfill:mastery` run is
needed.

**`demote:pool` writes no rollback artifact of its own.** The 20 row IDs and
their prior state are recorded in
`docs/analysis/tr-ordinals-demote-2026-08-13.json`, committed to the repo
rather than a gitignored directory — the same class of record that was lost
with the #642 sweep artifact. Rollback is the `UPDATE` stored in that file.

The cell stays empty until nightly pre-generation is un-paused
(`infra/bin/app.ts:54`). That was the accepted trade.

## Why the German pool was not demoted

**Open decision — not yet acted on.** The spec calls German "the remaining
live leak" (DE 1/17 digit cue vs TR 0/20) and disputes that the TR rows leak
at all, yet this branch demotes only the TR ordinal pool and leaves
`de-a1-numbers-ordinals` served as-is. That asymmetry is currently unstated
anywhere else in this branch's record; it is recorded here so it does not
read as an oversight.

The DE cell's 16 non-compliant rows are now stale relative to a directive
that this branch makes apply to them (the widened `contextSpoilsAnswer`
field list and the digit-form gloss carve-out). Demoting them the same way
the TR pool was demoted would empty a **second** cell while nightly
pre-generation is paused (`infra/bin/app.ts:54` —
`enableScheduledExerciseGeneration: false`), so there would be no refill
until the pause lifts. That trade was judged worse than leaving a
known-stale-but-served DE pool in place for now.

This is a deliberate deferral, not an omission — but it is still an open
decision, not a closed one. It should be revisited (either demote-and-wait,
or demote-and-immediately-regenerate a small batch) once nightly generation
resumes.

---

## German pool demoted after all — 2026-08-13 (supersedes the deferral above)

The deferral recorded in "Why the German pool was not demoted" is **closed**:
generation is being un-paused the same day, so the reason for holding
(a second cell sitting empty) no longer applied.

**22 rows demoted** across both types, `--reason pool-hygiene`, against
production. Two runs, since `demote:pool` takes one `--type` per invocation.

Inspecting the pool first showed the cell was worse than the digit-cue count
suggested — three overlapping defects, not one:

| Defect | Evidence |
|---|---|
| `digit-form` non-compliance | 1 of 17 cloze rows carries a digit cue; **0 of 5 translations** put the ordinal in digits in the English source ("Today is the third of May.") |
| Distributional collapse | **13 of 17** cloze rows use the frame `Heute ist der ___ [month]`; **11 of 17** answer `erste` |
| Gloss spoilage | 8 cloze rows carry a `glossEn`, most naming the ordinal outright ("Today is the first of January." → `erste`) |

Translations were included because `digit-form` governs cloze **and**
translation ("Write the number/order as DIGITS in the source text — never
spelled out in the source language"), and all five violate it.

Verified after: `de-a1-numbers-ordinals` has **zero approved rows**
(17 cloze + 5 translation now `rejected`/`pool-hygiene`; 3 pre-existing flagged
cloze untouched). Rollback IDs, split by type, in
`docs/analysis/de-ordinals-demote-2026-08-13.json`.

### Still open: TR translation

`tr-a1-numbers-ordinals` **translation** has 20 approved rows, **0/20 with
digits in the English source**, all generated 2026-05-30 → 06-08 — the same
pre-directive window as the 20 cloze rows already demoted, and the same defect.
Demoting the TR cloze but not the TR translation leaves that point half-fixed.
Not actioned: it was outside the requested scope. **Decide before generation
resumes**, or the refill will land beside 20 stale rows.
