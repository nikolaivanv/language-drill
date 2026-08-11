# QA sample findings — seed-1 re-measurement (2026-08-11)

Re-measures the four `qa:sample` defects flagged against prod on 2026-07-22 (three
reports: `docs/analysis/qa-run-2026-07-22-prod-smoke-es-a1.json`,
`docs/analysis/qa-run-2026-07-22-prod-es-b1-cloze.json`, plus the TR B1 SC report
which flagged nothing relevant here) to see whether PR #612's cloze prompt rule
(shipped after 2026-07-22) already closed any of them, and which of the rest still
need action. **Measurement only — no writes, no demotions, no mastery rebuilds.**

**Decision rule:** a finding **survived** iff the same `flags` reason fires on the
same `exerciseId` in the new report. If the target `exerciseId` is absent from the
new report's sampled set, the point's approved-pool rows have changed since July
and the record is **"not re-sampled"** — explicitly *not* the same as "cleared".
A finding is only "cleared" when the id *was* re-sampled and did not flag.

## Commands run (all backgrounded, prod DB + prod Anthropic key via
`/private/tmp/.../scratchpad/prod-qa.env`, each capped `--max-cost-usd 0.5`)

```bash
pnpm --filter @language-drill/ai qa:sample --language ES --cefr A1 --per-point 1 \
  --limit 5 --seed 1 --max-cost-usd 0.5 --out prod-smoke-es-a1-2026-08-11-seed1

pnpm --filter @language-drill/ai qa:sample --language ES --cefr B1 --type cloze \
  --grammar-point es-b1-deber-obligation-probability --per-point 2 --seed 1 \
  --max-cost-usd 0.5 --out prod-deber-2026-08-11-seed1

pnpm --filter @language-drill/ai qa:sample --language ES --cefr B1 --type cloze \
  --grammar-point es-b1-collective-agreement --per-point 2 --seed 1 \
  --max-cost-usd 0.5 --out prod-collective-2026-08-11-seed1

pnpm --filter @language-drill/ai qa:sample --language ES --cefr B1 --type cloze \
  --grammar-point es-b1-adjective-de-infinitive --per-point 2 --seed 1 \
  --max-cost-usd 0.5 --out prod-adj-de-inf-2026-08-11-seed1
```

All four exited 0, all four stayed well under their individual $0.50 caps
(`costCapped: false` in every report).

| Run | Report file | Exit | Cost | Sampled ids |
|---|---|---|---|---|
| ES A1 smoke (gustar) | `prod-smoke-es-a1-2026-08-11-seed1.json` | 0 | $0.2490 | `8a9dae79…`, `b5fbc236…`, `456079ab…`, `b0b4aac6…`, `09d08beb-fa80-5f79-907a-cd0541f7c874` |
| deber | `prod-deber-2026-08-11-seed1.json` | 0 | $0.1413 | `249a1125-9b53-57ad-a2d7-bd51073c792c`, `2a9a1a97-94a7-550f-acd7-cd730090c646` |
| collective | `prod-collective-2026-08-11-seed1.json` | 0 | $0.0914 | `3faa1375-e469-5431-9d6f-78edaafb4740`, `43aa19c1-d712-5ef5-a96f-8c49b852ad0c` |
| adj-de-inf | `prod-adj-de-inf-2026-08-11-seed1.json` | 0 | $0.0974 | `451a82fd-9f6a-5a73-8c62-1b9f9462d5e6`, `160484ae-90fd-5994-8e97-768895e21561` |

**Total re-measurement cost: $0.5791** (budget was ~$1.15; per-run caps $0.50 each).

## Per-flag verdicts

### 1. `gustar` — `es-a1-gustar-basic`

- Exercise id: `09d08beb-fa80-5f79-907a-cd0541f7c874`
- Original (2026-07-22, `docs/analysis/qa-run-2026-07-22-prod-smoke-es-a1.json`): **`false_positive`** —
  wrong translation `"No me gusta cerveza."` (missing definite article) scored
  **0.85** (pass band, ≥ `PASS_THRESHOLD` 0.8) against correct=1, alt=1.
- New (`prod-smoke-es-a1-2026-08-11-seed1.json`): the id **was re-sampled**
  (present in the sampled set) and this run's `flags` array is empty
  (0/5 flagged overall) — `false_positive` did **not** fire this time, meaning
  the freshly-crafted wrong-answer probe scored **below 0.8** this run.
- **Verdict: closed — did not reproduce.** Not attributable to PR #612: `gustar`
  is a **`translation`**-type exercise, and #612's fix was a **cloze**-only
  prompt rule, so this closure has a different (uninvestigated) cause.
- Caveat: `qa:sample`'s solver step is a live Claude call, not a stored fixture —
  the "wrong" probe answer crafted this run is not guaranteed to be byte-identical
  to July's `"No me gusta cerveza."` (a different plausible learner error could
  have been crafted instead). The id/evaluator pairing is identical; the specific
  wrong-answer string may not be. Also: the tool's JSON report only serializes
  **flagged** records (see `buildReport` in `packages/ai/scripts/qa-sample-run.ts`),
  so the exact new score for this exercise's three probes is not recoverable from
  the report — only the band (not-pass) is inferable from the absence of a flag.

### 2. `deber` — `es-b1-deber-obligation-probability`

- Exercise id: `1c8afa03-50f9-566b-9adc-f8578e7b606a`
- Original: **`acceptable_answers_gap`** — alt `"Debo"` scored **0.35** (fail band)
  against correct=1, wrong=0.15.
- New (`prod-deber-2026-08-11-seed1.json`): the id was **not** among this run's
  sampled rows (`249a1125…`, `2a9a1a97…` sampled instead; pool=49).
- **Verdict: not re-sampled.** The point's approved-pool composition has shifted
  since July enough that seed 1 no longer selects this row from a 49-row pool.
  0/2 flagged on the two rows that *were* sampled, but that says nothing about
  whether `1c8afa03…` itself still has the gap.

### 3. `collective` — `es-b1-collective-agreement`

- Exercise id: `ca70d729-2619-5421-8c5f-16cdd77d4e60`
- Original: **`acceptable_answers_gap`** — alt `"interpretó"` scored **0.3** (fail band)
  against correct=1, wrong=0.3.
- New (`prod-collective-2026-08-11-seed1.json`): the id was **not** among this
  run's sampled rows (`3faa1375…`, `43aa19c1…` sampled instead; pool=49).
- **Verdict: not re-sampled.** 0/2 flagged on the two rows sampled, but again
  uninformative about `ca70d729…` specifically.

### 4. `adj-de-inf` — `es-b1-adjective-de-infinitive`

- Exercise id: `42183fad-caa9-5d8d-b95f-c04104ca2f74`
- Original: **`acceptable_answers_gap`** — alt `"(nothing)"` scored **0** (fail band)
  against correct=1, wrong=0. This one was flagged in the plan as the probable
  **crafter-error** case: the crafted "alt" was literally "(nothing)" for a blank
  whose task explicitly allows leaving it empty as one of two legal options
  (`de` / nothing) — i.e. the gap may be an artifact of how the crafter reported
  a null alt, not a real evaluator defect.
- New (`prod-adj-de-inf-2026-08-11-seed1.json`): the id was **not** among this
  run's sampled rows (`451a82fd…`, `160484ae…` sampled instead; pool=50). 0/2
  flagged on the two rows sampled — no new instance of the "(nothing)"-alt
  artifact turned up on other rows either, which is mildly consistent with (but
  does not prove) the crafter-error reading.
- **Verdict: not re-sampled.** This run was meant only to sanity-check the
  crafter-error interpretation per the plan; since the original id itself wasn't
  drawn, that interpretation is neither confirmed nor refuted by this run.

## Summary table

| Exercise id | Point | Original reason (score) | New result | Verdict |
|---|---|---|---|---|
| `09d08beb-fa80-5f79-907a-cd0541f7c874` | `es-a1-gustar-basic` | `false_positive` (wrong=0.85) | re-sampled, 0 flags (wrong-band no longer pass) | **closed — did not reproduce** (not #612; translation type) |
| `1c8afa03-50f9-566b-9adc-f8578e7b606a` | `es-b1-deber-obligation-probability` | `acceptable_answers_gap` (alt=0.35) | id absent from sample | **not re-sampled** |
| `ca70d729-2619-5421-8c5f-16cdd77d4e60` | `es-b1-collective-agreement` | `acceptable_answers_gap` (alt=0.3) | id absent from sample | **not re-sampled** |
| `42183fad-caa9-5d8d-b95f-c04104ca2f74` | `es-b1-adjective-de-infinitive` | `acceptable_answers_gap` (alt=0) | id absent from sample | **not re-sampled** |

## Gate outcome for Tasks 3–11

- **`gustar` cleared → Tasks 3–10 (evaluator fix) are out of scope; skip them.**
  The finding did not reproduce at seed 1, and its closure predates/postdates
  #612 independently (different exercise type), so there is nothing here for an
  evaluator-prompt fix to act on right now.
- **Task 11 (cloze repair):** none of the three cloze flags are confirmed
  `survived`, but per the explicit "not re-sampled ≠ cleared" rule, none of them
  are confirmed closed either — all three are **unresolved**. The conservative,
  rigorous reading is to **not** skip Task 11 on the strength of this run: treat
  all three original ids as still-open pending a re-sample (e.g. a different seed,
  a larger `--limit`, or a direct per-id lookup) rather than as fixed. Task 11
  should proceed planning to re-verify these three ids specifically before
  deciding whether repair work is needed.

## Cost

Total re-measurement spend: **$0.5791** across 4 backgrounded runs (budget ~$1.15).
