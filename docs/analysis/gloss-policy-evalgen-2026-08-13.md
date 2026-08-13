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

**Establishes:** the pre-registered failure mode did not occur. The plan's
decision rule was "if `ambiguous` flags rise on `es-a2-saber-poder-ability`, the
clause is wrong as written and must narrow to banning only the trigger-naming
parenthetical." No flag tags appeared in either arm. The validator's
anti-rejection guard (a neutral gloss is not `ambiguous` when the L2 sentence
forces the reading) is doing its job: the generator's new output is not being
rejected by its mirror half. That was the real risk of the two-part contract
and it is cleared.

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

The honest summary: this run rules out the catastrophic outcome and confirms
generator/validator agreement. It is not evidence that the gloss policy works.
The claim in the spec — that a neutral "can" gloss is non-ambiguous when the
Spanish forces the contrast — remains reasoned from ~12 production rows, not
measured.

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
