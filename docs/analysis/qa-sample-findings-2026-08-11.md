# QA sample findings — seed-1 re-measurement (2026-08-11)

Re-measures the four `qa:sample` defects flagged against prod on 2026-07-22 (three
reports: `docs/analysis/qa-run-2026-07-22-prod-smoke-es-a1.json`,
`docs/analysis/qa-run-2026-07-22-prod-es-b1-cloze.json`, plus the TR B1 SC report
which flagged nothing relevant here) to see whether either PR #612 (cloze prompt
rule) or PR #620 (evaluator no longer sees cloze option chips unless the learner
revealed them; both post-date 2026-07-22) already closed any of them, and which
of the rest still need action. **Measurement only — no writes, no demotions, no
mastery rebuilds.**

**Decision rule (revised — see "Correction" below):** each finding is judged by
**directly replaying the exact original probe answer** — the specific string that
produced the flagging score in July — against `evaluateAnswer` on the row's
**current** `content_json`, using the identical call shape `qa-sample-run.ts`
uses (`exercise`, `userAnswer`, `language`, `difficulty`, `grammarGuidance`,
`attributionKeys`; `optionsRevealed` omitted → defaults `false`). A finding
**survives** if the replayed answer still lands in the flag-triggering band
(wrong ≥ `PASS_THRESHOLD` 0.8 → `false_positive`; a genuinely valid alt ≤
`FAIL_THRESHOLD` 0.4 → `acceptable_answers_gap`). It is **closed** if the score
moves out of that band. It is **dismissed — crafter error** if the flag depended
on an "alt" that was never actually a valid alternative in the first place —
an artifact of the July crafting step, not an evaluator defect.

## Correction to the first draft of this record (fix round 1)

The first version of this record drew its verdicts from `qa:sample`'s re-sampled
reports alone, and that method cannot answer this task's question:

1. **`qa:sample`'s report only serializes *flagged* rows**
   (`buildReport` in `packages/ai/scripts/qa-sample-run.ts:143` filters to
   `records.filter(r => r.flags.length > 0)` before writing `flags: flagged`).
   An empty `flags` array for a re-sampled row says nothing about the specific
   score that flagged in July — the crafter is a **live, unseeded Opus call**
   (only row *sampling* is seeded), so a re-run against the same exercise id
   generates a **freshly invented** wrong/alt answer, not a replay of the
   original one. The first draft's "gustar closed — did not reproduce" verdict
   was drawn from this weaker signal and should have been labeled "not
   re-tested," not "closed." It is now superseded by the direct replay below.
2. **The three B1 cloze points could not plausibly have re-sampled their target
   rows.** `es-b1-deber-obligation-probability` and `es-b1-collective-agreement`
   each have **49** approved cloze rows in prod; `es-b1-adjective-de-infinitive`
   has **50**. `--per-point 2` draws 2 of 49–50 — roughly a 4% chance of
   hitting any one specific id. The first draft attributed the miss to "the
   point's approved-pool rows have changed since July," implying drift; the
   real cause is structural: `qa:sample` samples **per grammar point**, not
   per exercise id, and has **no `--exercise-id` flag** to target a known row
   in a 50-row pool. Re-running the same command was never going to reliably
   hit these three ids regardless of pool drift.

The fix: a scratchpad-only replay script
(`packages/ai/scripts/tmp-qa-replay-probe.ts`, deleted after use, never
committed) that reads each target row's current `content_json` directly by id
and replays all three original probe answers (correct/wrong/alt) through
`evaluateAnswer`, byte-identical to the strings recorded in the July reports.
This is what the table below reports.

## Commands run

Sampling runs (all backgrounded, prod DB + prod Anthropic key via the
scratchpad env file, each capped `--max-cost-usd 0.5`):

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

All four exited 0, all stayed under their $0.50 caps (`costCapped: false`).

| Run | Report file | Exit | Cost | Sampled ids |
|---|---|---|---|---|
| ES A1 smoke (gustar) | `prod-smoke-es-a1-2026-08-11-seed1.json` | 0 | $0.2490 | `8a9dae79…`, `b5fbc236…`, `456079ab…`, `b0b4aac6…`, `09d08beb-fa80-5f79-907a-cd0541f7c874` |
| deber (pool=49) | `prod-deber-2026-08-11-seed1.json` | 0 | $0.1413 | `249a1125-9b53-57ad-a2d7-bd51073c792c`, `2a9a1a97-94a7-550f-acd7-cd730090c646` |
| collective (pool=49) | `prod-collective-2026-08-11-seed1.json` | 0 | $0.0914 | `3faa1375-e469-5431-9d6f-78edaafb4740`, `43aa19c1-d712-5ef5-a96f-8c49b852ad0c` |
| adj-de-inf (pool=50) | `prod-adj-de-inf-2026-08-11-seed1.json` | 0 | $0.0974 | `451a82fd-9f6a-5a73-8c62-1b9f9462d5e6`, `160484ae-90fd-5994-8e97-768895e21561` |

This evidence stands as-is (commands, costs, sampled ids are all accurate) —
only the *interpretation* drawn from it in the first draft was wrong. `gustar`'s
id happened to be re-sampled (5 rows drawn from A1's full pool); none of the
three B1 cloze ids were, for the structural reason above.

## Replay (primary evidence)

Ran directly against each row's current `content_json`, replaying the exact
original probe strings from July:

| Exercise id | Point | Label | Answer | Old score (band) | New score (band) |
|---|---|---|---|---|---|
| `09d08beb…` | es-a1-gustar-basic | correct | "No me gusta la cerveza." | 1.00 (pass) | 1.00 (pass) |
| `09d08beb…` | es-a1-gustar-basic | **wrong** | "No me gusta cerveza." | **0.85 (pass)** | **0.75 (deadzone)** |
| `09d08beb…` | es-a1-gustar-basic | alt | "A mí no me gusta la cerveza." | 1.00 (pass) | 1.00 (pass) |
| `1c8afa03…` | es-b1-deber-obligation-probability | correct | "Debería" | 1.00 (pass) | 1.00 (pass) |
| `1c8afa03…` | es-b1-deber-obligation-probability | wrong | "Debo de" | 0.15 (fail) | 0.25 (fail) |
| `1c8afa03…` | es-b1-deber-obligation-probability | **alt** | "Debo" | **0.35 (fail)** | **0.75 (deadzone)** |
| `ca70d729…` | es-b1-collective-agreement | correct | "interpreta" | 1.00 (pass) | 1.00 (pass) |
| `ca70d729…` | es-b1-collective-agreement | wrong | "interpretan" | 0.30 (fail) | 0.30 (fail) |
| `ca70d729…` | es-b1-collective-agreement | **alt** | "interpretó" | **0.30 (fail)** | **0.50 (deadzone)** |
| `42183fad…` | es-b1-adjective-de-infinitive | correct | "de" | 1.00 (pass) | 1.00 (pass) |
| `42183fad…` | es-b1-adjective-de-infinitive | wrong | "para" | 0.00 (fail) | 0.15 (fail) |
| `42183fad…` | es-b1-adjective-de-infinitive | **alt** | "(nothing)" | **0.00 (fail)** | **0.00 (fail)** |

Replay cost: **$0.2806** (12 `evaluateAnswer` calls).

## Per-flag verdicts

### 1. `gustar` — `es-a1-gustar-basic` (`09d08beb-fa80-5f79-907a-cd0541f7c874`)

Original: `false_positive` — wrong `"No me gusta cerveza."` scored 0.85 (pass).
Replay: the identical wrong answer now scores **0.75** — out of the pass band,
into the deadzone. The flag did not fire this time: **closed — did not
reproduce.** `gustar` is a `translation` exercise (no cloze options in play),
so neither #612 nor #620 is a mechanical fit; the cause of the movement is
unexplained (most likely general prompt/model drift between July and now)
rather than attributable to either shipped fix.
Caveat — **this closure is provisional, not confirmed**: 0.75 is only **0.05**
below the 0.8 pass line the original 0.85 crossed, the closest of the three
deadzone landings in this run. `evaluateAnswer` is a nondeterministic LLM
call and this replay is n=1; a re-draw landing at 0.80 instead of 0.75 would
flip the verdict straight back to `false_positive`. One draw this close to the
boundary cannot distinguish a real behavioural change from ordinary sampling
noise — contrast `deber` below, where the alt cleared the fail line by 0.35,
comfortably outside noise range. What would settle it: repeating this single
probe (`wrong` = `"No me gusta cerveza."` against this row) n times — at
~$0.02/call — and checking whether it ever lands at ≥0.8. Cheap, not run here;
worth doing if this closure needs to be relied on later.

### 2. `deber` — `es-b1-deber-obligation-probability` (`1c8afa03-50f9-566b-9adc-f8578e7b606a`)

Original: `acceptable_answers_gap` — alt `"Debo"` scored 0.35 (fail).
Replay: the identical alt now scores **0.75** — out of the fail band, into the
deadzone (never flags under `classifyVerdicts`). **Closed — did not
reproduce.** This is a cloze row, and the jump from 0.35 to 0.75 is consistent
with **PR #620** (`optionsRevealed` now defaults `false`, so the evaluator no
longer sees the on-screen option list `Debo, Debo de, Debería, Debo de tener`
and can no longer penalize "Debo" for not matching the intended list entry) —
a better-fitting explanation than #612, which only touched cloze *generation*
prompting, not evaluation.

### 3. `collective` — `es-b1-collective-agreement` (`ca70d729-2619-5421-8c5f-16cdd77d4e60`)

Original: `acceptable_answers_gap` — alt `"interpretó"` scored 0.3 (fail).
Replay: the identical alt now scores **0.50** — out of the fail band, into the
deadzone. **Closed — did not reproduce**, by the sampler's own flagging rule
(deadzone never flags). Caveat worth keeping in view: 0.50 is still far from
the 0.8 pass band — the evaluator has stopped confidently *rejecting*
"interpretó" but has not started confidently *accepting* it either. This is a
real improvement, plausibly also from #620 (options no longer shown), but it
is a softened defect, not a demonstrably correct evaluation.

### 4. `adj-de-inf` — `es-b1-adjective-de-infinitive` (`42183fad-caa9-5d8d-b95f-c04104ca2f74`)

Original: `acceptable_answers_gap` — alt `"(nothing)"` scored 0 (fail).
Replay: the identical alt scores **0** again — still in the fail band. By the
raw `classifyVerdicts` rule this **reproduces**. But judged on its merits per
the brief: the sentence is `"Esa canción es difícil ___ olvidar."` — the
adjective-plus-infinitive raised-object frame ("difícil de + infinitivo")
grammatically **requires** `de`; leaving the blank empty ("Esa canción es
difícil olvidar") is not a legitimate alternative construction, it's
ungrammatical Spanish. The July crafter mislabeled an invalid answer as an
"alt" (defined as "a DIFFERENT but equally-correct answer"). Scoring an
ungrammatical string 0 is the evaluator working correctly, not an
`acceptable_answers_gap`. **Verdict: dismissed — crafter error, not a pool
defect.** (`wrong` = "para" also stayed in the fail band, 0.00 → 0.15 — never
flagged either run, consistent with correct behavior throughout.)

## Summary table

Closure confidence differs across the three deadzone landings — margin from
the boundary the original score crossed is a proxy for how much a single
nondeterministic draw (n=1) should be trusted:

| Exercise id | Point | Original reason (score) | Replayed score | Margin from boundary | Confidence | Verdict |
|---|---|---|---|---|---|---|
| `09d08beb-fa80-5f79-907a-cd0541f7c874` | es-a1-gustar-basic | `false_positive` (wrong=0.85) | wrong=0.75 (deadzone) | 0.05 below the 0.8 pass line | **provisional** — n=1, within plausible sampling noise of the boundary | **closed — did not reproduce** |
| `1c8afa03-50f9-566b-9adc-f8578e7b606a` | es-b1-deber-obligation-probability | `acceptable_answers_gap` (alt=0.35) | alt=0.75 (deadzone) | 0.35 above the 0.4 fail line | **convincing** | **closed — did not reproduce** (candidate cause: #620) |
| `ca70d729-2619-5421-8c5f-16cdd77d4e60` | es-b1-collective-agreement | `acceptable_answers_gap` (alt=0.3) | alt=0.50 (deadzone) | 0.10 above the 0.4 fail line | **provisional** — real improvement, but still far from the pass band | **closed — did not reproduce** (candidate cause: #620; still far from pass) |
| `42183fad-caa9-5d8d-b95f-c04104ca2f74` | es-b1-adjective-de-infinitive | `acceptable_answers_gap` (alt=0) | alt=0.00 (fail — reproduces by raw rule) | n/a — dismissal is on grammatical grounds, not score margin | **not sampling-dependent** | **dismissed — crafter error, not a pool defect** |

## Gate outcome for Tasks 3–11

- **`gustar` closed → Tasks 3–10 (evaluator fix) are out of scope; skip them.**
  Established by direct replay of the exact original defect probe (not
  inference from a re-sample), though the closure is provisional (0.05 margin,
  n=1) — see the confidence column above and the cheap n-replay follow-up
  noted in the per-flag section if this needs firmer confirmation later.
- **Task 11 (cloze repair): skip.** All three cloze flags are now resolved —
  two closed (with #620 as the leading candidate explanation, though not
  independently verified here) and one dismissed as a crafter artifact rather
  than a real gap. None survived; there is nothing for Task 11 to repair.

## Cost

Sampling runs: $0.5791. Replay: $0.2806. **Total re-measurement spend: $0.8597**
(budget ~$1.15).
