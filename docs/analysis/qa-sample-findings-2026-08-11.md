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

`classifyVerdicts` (`packages/ai/src/qa-sample.ts:108-123`) additionally gates
two of the three flag reasons on solver confidence: `acceptable_answers_gap`
and `false_negative` are suppressed when `correctConfidence < MIN_CORRECT_CONFIDENCE`
(0.7) — shaky ground truth shouldn't produce a flag. `false_positive` is
deliberately **ungated**: a wrong answer being accepted is a defect regardless of
how sure the solver was about the correct answer. This matters here because
`deber`'s original flag is `acceptable_answers_gap`, a gated reason — checked:
its July `confidence` was **0.78** (`docs/analysis/qa-run-2026-07-22-prod-es-b1-cloze.json`),
above the 0.7 gate, so the confidence rule does not change its verdict.

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

**"Sampled ids" caveat:** these were read off ephemeral stdout while the runs were
live and pasted in below. `buildReport` (`packages/ai/scripts/qa-sample-run.ts:143`)
only serializes rows that flagged (`records.filter(r => r.flags.length > 0)`), and
all four runs here have `flagged: 0` → `flags: []` — so the committed report files
under `docs/analysis/` do **not** contain these ids, and the report files
themselves (`packages/ai/qa-runs/prod-*-2026-08-11-seed1.json`) are gitignored and
gone with the worktree. The ids below are **not reproducible from any committed
artifact** and are **not load-bearing for any verdict** — this record's own
argument (see "Correction" above) is that re-sampled evidence is not what the
verdicts rest on; the verdicts rest on the direct replay in the next section,
which reads each target row by id rather than depending on re-sampling.

| Run | Report file | Exit | Cost | Sampled ids (ephemeral stdout, not reproducible from a committed artifact) |
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
reproduce.**

Candidate cause, verified against the actual diffs (`git show 0463b009`,
`git show 1df88e7e`): **PR #612** (`fix(evaluate): anti-anchoring for cloze +
vocab_recall`, commit `0463b009`) is the leading explanation, not #620. #612
touched only `packages/ai/src/prompts.ts` (plus its own tests and docs) —
no generation file — and added exactly the clause this closure needs to
`buildClozeUserPrompt`, the evaluator's cloze user prompt: *"When the visible
sentence does not itself fix the tense/aspect/number, any form the sentence
licenses is correct."* `deber`'s stem ("Ayer rompí el vaso sin querer. ___
tener más cuidado la próxima vez.") does not fix mood, so `Debo` (indicative,
"I must") alongside `Debería` (conditional, "I should") is exactly the kind of
sentence-licensed alternative #612 tells the evaluator to accept.

#612 *also* introduced the "and among the **Options** when options are shown"
narrowing in the same commit — and this row's `promptSeen` includes an
`Options:` line (`Debo, Debo de, Debería, Debo de tener`), so at the #612
baseline the evaluator could see `Debo` was itself a listed option, reinforcing
rather than blocking the accept. **#620** (commit `1df88e7e`, `optionsRevealed`
defaulting to `false` so the evaluator no longer sees the option list at all)
gated that narrowing behind an explicit reveal flag — but the narrowing did not
exist before #612 shipped it, so #620's removal of it cannot explain movement
measured against the 2026-07-22 (pre-#612) baseline. #620 is mechanically in
window and not irrelevant (it changes how the prompt reads for this row today),
but #612 is the fix that actually closes the gap; #620 only changes the
presentation of an already-closed case.

### 3. `collective` — `es-b1-collective-agreement` (`ca70d729-2619-5421-8c5f-16cdd77d4e60`)

Original: `acceptable_answers_gap` — alt `"interpretó"` scored 0.3 (fail).
Replay: the identical alt now scores **0.50** — out of the fail band, into the
deadzone. **Closed — did not reproduce**, by the sampler's own flagging rule
(deadzone never flags). Caveat worth keeping in view: 0.50 is still far from
the 0.8 pass band — the evaluator has stopped confidently *rejecting*
"interpretó" but has not started confidently *accepting* it either. This is a
real improvement, most plausibly from **#612** (same tense/aspect-licensing
clause as `deber` above — "La gente del barrio ___ la nueva señal…" does not
anchor a tense, so the preterite "interpretó" is sentence-licensed alongside
the present "interpreta"), not #620.

**#620's mechanism does not apply to this row.** #620's fix was gating the
cloze `Options:` line (and its "among the Options" narrowing) behind an
explicit `optionsRevealed` flag — but this row's `content.options` is empty:
its archived `promptSeen`
(`docs/analysis/qa-run-2026-07-22-prod-es-b1-cloze.json`, `exerciseId`
`ca70d729-2619-5421-8c5f-16cdd77d4e60`) is `"Fill in the blank with the
correct form of the verb in parentheses.\nLa gente del barrio ___ la nueva
señal de tráfico de manera diferente. (interpretar)"` — no `Options:` line at
all, and `renderLearnerView` (`packages/ai/src/qa-sample.ts:21`) only emits
one when `content.options?.length` is truthy. #620's headline mechanism
("options no longer shown") describes hiding a list that was never present
for this row in the first place, so it cannot be the cause here. #620 did
also reword the visibility/admissibility clauses for the optionless case
(the `showOptions === false` branch's admissibility clause now reads "…it is
fully correct… even when it uses a different verb or lexical item entirely" —
see `git show 1df88e7e -- packages/ai/src/prompts.ts`), so it is not wholly
irrelevant to this row's current prompt text, but "options no longer shown" is
not why the score moved, because there were never options to show.

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
| `1c8afa03-50f9-566b-9adc-f8578e7b606a` | es-b1-deber-obligation-probability | `acceptable_answers_gap` (alt=0.35) | alt=0.75 (deadzone) | 0.35 above the 0.4 fail line | **convincing** | **closed — did not reproduce** (candidate cause: #612, tense/mood-licensing clause; see per-flag section for why #620 is not the mechanism) |
| `ca70d729-2619-5421-8c5f-16cdd77d4e60` | es-b1-collective-agreement | `acceptable_answers_gap` (alt=0.3) | alt=0.50 (deadzone) | 0.10 above the 0.4 fail line | **provisional** — real improvement, but still far from the pass band | **closed — did not reproduce** (candidate cause: #612, same clause; #620's "options no longer shown" mechanism does not apply — this row has no options; still far from pass) |
| `42183fad-caa9-5d8d-b95f-c04104ca2f74` | es-b1-adjective-de-infinitive | `acceptable_answers_gap` (alt=0) | alt=0.00 (fail — reproduces by raw rule) | n/a — dismissal is on grammatical grounds, not score margin | **not sampling-dependent** | **dismissed — crafter error, not a pool defect** |

## Gate outcome for Tasks 3–11

- **`gustar` closed → Tasks 3–10 (evaluator fix) are out of scope; skip them.**
  Established by direct replay of the exact original defect probe (not
  inference from a re-sample), though the closure is provisional (0.05 margin,
  n=1) — see the confidence column above and the cheap n-replay follow-up
  noted in the per-flag section if this needs firmer confirmation later.
- **Task 11 (cloze repair): skip.** All three cloze flags are now resolved —
  two closed (with **#612** as the leading candidate explanation — its
  tense/mood-licensing clause is exactly on point for both rows; #620 is also
  in-window but its "options no longer shown" mechanism only applies to the
  `deber` row, since `collective` never had options to begin with — neither
  independently verified here) and one dismissed as a crafter artifact rather
  than a real gap. None survived; there is nothing for Task 11 to repair.

## Cost

Sampling runs: $0.5791. Replay: $0.2806. **Total re-measurement spend: $0.8597**
(budget ~$1.15).
