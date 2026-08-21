# Generation Run Analysis — 2026-08-17

_Source: prod Neon branch `br-green-waterfall-ancrvpr5` (project `twilight-smoke-01114337`), `generation_jobs` + `exercises` + `usage_events`._

## TL;DR

Fourth run since the cron resumed (#646). **120 cells, zero failures, 225 approved, $18.20, ~31 min.** Credits held — no repeat of the 08-14 / 08-16 exhaustion.

But approval fell again, to **52.1%**, and this time it is **rejects, not flags**, doing it: reject rate 15.2% → **27.1%** while flag rate actually *improved* (23.8% → 20.8%). Cost per approved row is the worst of the post-resume series, **$0.081**.

Three findings:

- **Yesterday's n-declension fix (#655) worked, and the evidence is unambiguous.** `de:b1:conjugation:de-b1-n-declension` went **1/18 → 7/17**, the `nominative` bucket is gone from `coverage_outcome` entirely, and cost fell from ~$0.77/night for 1 row to $0.60 for 7. `curriculum_version` on the cell reads `2026-08-16`, so the bump cleared `skip-low-yield` as intended. Rec #2 from 08-16: **closed, verified in production.**
- **`context-spoils-answer` on `conjugation` is a validator bug, not a generator bug — and it had been eating ~20% of every conjugation draft for a month. FIXED in #656.** The validator user prompt labelled the draft's `breakdown` field "Breakdown shown to the learner", but `breakdown` is **post-answer feedback** (`conjugation-exercise.tsx:177` — inside `FeedbackShell`, gated on `submission.kind === 'evaluated'`). Since the breakdown's whole job is to decompose the answer, the **hard veto** fired on most drafts. **The exact carve-out that fixes this already existed for `vocab_recall`** (`validation-prompts.ts:367`) and was never ported. Since 07-18: **202 spoils on 984 conjugation drafts requested (20.5%)** vs 3.5–4.5% on every other surface. Paired probe: **7/16 → 0/16** spoiled, with instruction-spoiled controls still vetoed **16/16**.
- **Two cells are structurally saturated and burning the run's whole dedup budget.** `de-a1-praeteritum-sein-haben` produced 28 drafts for 7 slots and gave up on **all 7**; `de-a2-praeteritum-modals` produced 48 for 15 and gave up on 11. Together, 18 of the run's 40 dedup give-ups. Präteritum of *sein*/*haben* is a 12-form closed set — there is nothing left to generate.

---

## Run overview

One scheduled run, **04:00:10 → 04:30:45 UTC** (~31 min), **120 cells enqueued, 120 succeeded, 0 failed.**

| | Cells | Requested | Produced | Approved | Flagged | Rejected | Dedup give-up | Cost |
|---|---|---|---|---|---|---|---|---|
| `succeeded` | 120 | 435 | 582 | **225** | 90 | 117 | 40 | **$18.20** |

Approval% below = approved / decided (approved + flagged + rejected = **432**; 3 produced drafts never decided — the same small accounting edge as prior runs). **52.1% approval, 20.8% flagged, 27.1% rejected.** Of the 117 rejects, **40 are dedup give-ups** (search-space exhaustion, not a quality veto); excluding them, quality approval is **57.4%**.

Cost per approved exercise **$0.081** — up from $0.057, $0.043, $0.033 on the three preceding runs.

Draft churn is also up: **582 produced for 435 slots (1.34×)**, vs 1.14× yesterday. Conjugation alone produced 140 for 74 slots (1.9×).

Pool total after the run: **25,873 approved** (25,530 auto + 343 manual), 8,330 flagged, 3,982 demoted — 38,185 rows.

| Pool by language | Approved | Flagged | Demoted |
|---|---|---|---|
| ES | 10,799 | 2,984 | 1,797 |
| DE | 8,195 | 1,769 | 225 |
| TR | 6,869 | 3,577 | 1,960 |

Per-language approved deltas (+151 DE / +40 ES / +34 TR) match the run's approvals exactly, and `demoted` is byte-identical to 08-16 — **no demotions ran today**, so every pool movement here is generation.

### Per-language

| Lang | Cells | Req | Prod | Appr | Appr% | Flag | Rej | Dedup | Cost |
|---|---|---|---|---|---|---|---|---|---|
| de | 78 | 285 | 378 | 151 | **53.5%** | 47 | 84 | 28 | $11.81 |
| es | 20 | 67 | 89 | 40 | **59.7%** | 17 | 10 | 4 | $2.83 |
| tr | 22 | 83 | 115 | 34 | **41.0%** | 26 | 23 | 8 | $3.57 |

ES held its 08-16 shape (a small allocation, cleanly served) and improved: **zero rejects at A2, B1 and B2 combined** — 25 approved of 34 requested across those three levels, everything else flagged rather than killed. The DE/TR redistribution from 08-16 persists; the July fair-share complaint remains closed.

### Per level

| | de a1 | de a2 | de b1 | de b2 | es a1 | es a2 | es b1 | es b2 | tr a1 | tr a2 | tr b1 | tr b2 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cells | 27 | 23 | 12 | 16 | 9 | 3 | 4 | 4 | 9 | 7 | 2 | 4 |
| req | 74 | 96 | 66 | 49 | 33 | 9 | 13 | 12 | 34 | 25 | 6 | 18 |
| appr | 34 | 40 | 40 | **37** | 15 | 8 | 10 | 7 | 12 | 16 | 1 | 5 |
| rej | 31 | 36 | 15 | **2** | 10 | 0 | 0 | 0 | 13 | 3 | 2 | 5 |

`de:b2` is the standout: **37 approved of 49, only 2 rejected.** The weak blocks are `de:a1` (34/74, 31 rejects) and `de:a2` (40/96, 36 rejects) — and both are dominated by the two conjugation/zero-article cells analysed below, not by a broad A-level problem.

### Post-resume trend

| Day | Cells ok/failed | Req | Approved | Appr% | Flag% | Rej% | Cost | $/approved | Runtime |
|---|---|---|---|---|---|---|---|---|---|
| **08-17** | **120 / 0** | 435 | 225 | **52.1%** | 20.8% | **27.1%** | $18.20 | **$0.081** | 31 min |
| 08-16 | 116 / 4 | 527 | 321 | 61.0% | 23.8% | 15.2% | $18.38 | $0.057 | 27 min |
| 08-15 | 120 / 0 | 1,118 | 733 | 65.8% | 19.4% | 14.8% | $31.31 | $0.043 | 35 min |
| 08-14 | 37 / 83 | 732 | 511 | 69.9% | 17.1% | 13.0% | $17.00 | $0.033 | 18 min |
| 07-24 | 120 / 0 | 663 | 426 | 64.3% | 16.7% | 19.0% | $19.21 | $0.045 | 25 min |

**The story changed direction.** For four runs the narrative was "approval drifting down through *flags*"; today flags improved by 3 points and **rejects nearly doubled**. That is not a broad regression — 61 of the 117 rejects come from four cells (`de-a2-adjective-declension-zero` 15, `de-a2-praeteritum-modals` 11, `de-a1-zero-article` 10, `de-b1-n-declension` 10, `de-a1-praeteritum-sein-haben` 7 — 43 across five). As the deficit shrinks toward zero, the residual request pool concentrates in exactly the cells that cannot be served, so the run-level rate is increasingly a readout of a handful of broken cells rather than of generation quality.

### Credit health

No `failed` jobs, no `credit balance is too low` errors. `usage_events` carries 4 `ai_evaluation` rows since 08-16 (15:36 → 21:19 UTC on 08-16, none yet today at time of writing), each written only after the Claude call returns — so the account is live.

The 08-16 recommendation stands unchanged and unactioned: there is still **no alarm** on `generation_jobs.status='failed'` and no balance check, and the same key backs learner-facing `POST /exercises/:id/submit`. Today's clean run is luck, not coverage.

---

## The conjugation `context-spoils-answer` veto is a UI-visibility bug in the validator

| Type | Spoils since 07-18 | Requested | Rate |
|---|---|---|---|
| **conjugation** | **202** | **984** | **20.5%** |
| `sentence_construction` | 78 | 1,098 | 7.1% |
| `vocab_recall` | 84 | 1,853 | 4.5% |
| `translation` | 361 | 8,490 | 4.3% |
| `cloze` | 255 | 7,272 | 3.5% |

Conjugation is **5× the next surface**. Today it was 18 of the run's 40 spoils on 74 requested drafts.

### The mechanism — measured, not inferred

> **Correction (2026-08-17, post-investigation).** This section originally blamed `exampleSentences`. A paired probe refuted that: masking `targetForm` out of the examples made the veto *worse* (5/12 → 8/12). The actual trigger is **`breakdown`**. Fixed and verified in **#656**; numbers below are measured.

Three files disagree about whether `breakdown` and `exampleSentences` are learner-visible:

1. **`apps/web/.../conjugation-exercise.tsx:177-186`** — both are rendered **only after submission**, inside `FeedbackShell`, gated on `submission.kind === 'evaluated'`. The learner never sees either while answering.

2. **`packages/ai/src/validation-prompts.ts:510`** — the validator user prompt asserted the opposite, in the label itself:
   ```
   **Breakdown shown to the learner:** ${content.breakdown}
   ```

3. **`packages/ai/src/generation-prompts.ts:396`** — separately, the generator is *required* to put the answer in the examples: _"`exampleSentences` (1–2) must use `targetForm` **verbatim**"_.

`contextSpoilsAnswer` is defined at `validation-prompts.ts:216` over `instructions`, `context`, or `glossEn` — it names neither field. But the judge read the label, and `breakdown`'s whole job is to decompose the answer ("frisch + -e (strong feminine accusative singular ending)"), so the **hard veto** (line 173) fired on nearly every draft. All five baseline vetoes quoted the label verbatim:

> _"The **breakdown shown to the learner** explicitly states '-er (strong dative singular feminine ending)' … a learner can read the breakdown and write 'frischer Luft' without engaging with the declension logic at all."_

**Isolation** (16 drafts, one note per arm): baseline **9/16** spoiled → breakdown-note **1/16** → examples-note 5/16. The breakdown does the damage; the examples contribute secondarily.

**Verification** (16 different drafts, identical drafts through both arms):

| | `validate@2026-08-13a` | `validate@2026-08-17` |
|---|---|---|
| real drafts spoiled | 7/16 | **0/16** |
| instruction-spoiled controls | 16/16 | **16/16** |

The control arm is the load-bearing one — drafts mutated so the *instructions* hand over the answer are still vetoed 16/16, so the carve-out re-scopes the dimension rather than blinding it.

**Production result** (post-merge CLI run on the real cell, same day):

| Run | Approved | `context-spoils` | Spoils / requested |
|---|---|---|---|
| 08-14 scheduled | 2/18 | 14 | 78% |
| 08-17 scheduled (pre-fix) | 1/16 | 14 | 88% |
| **08-17 CLI (post-fix)** | **6/15** | 6 | **40%** |

Approval **6% → 40%**; the spoils rate halves but does **not** go to zero. The probe's 0/16 was measured on a narrower, easier draft population (heavily repeated `kaltem Wasser` / `frischer Luft`) than a real batch produces — treat 40% as the honest production figure and the residual as open (see rec #1a).

**The fix already existed for a sibling surface** — `validation-prompts.ts:367`, the vocab_recall note ("_the exampleSentence is a post-answer usage illustration … NOT contextSpoilsAnswer_") — and had never been ported. Same class as the **#612 → #620** defect: a prompt asserting a UI visibility that is false.

### Why `de-a2-adjective-declension-zero` is the worst-hit cell

| Run | Req | Appr | Rej | `context-spoils` |
|---|---|---|---|---|
| 08-17 | 16 | **1** | 15 | **14** |
| 08-14 | 18 | 2 | 15 | 14 |
| 07-23 | 19 | 1 | 18 | 15 |
| 07-22 | 23 | 4 | 19 | 19 |
| 07-21 | 26 | 3 | 23 | 23 |
| 07-20 | 30 | 4 | 26 | 25 |
| **Total** | **152** | **15 (10%)** | **131** | **110** |

Its siblings are fine — `-definite` 20/30 and 3/4, `-indefinite` 17/30 and 8/13. The difference is the target form. Zero-article strong declension surfaces almost exclusively in genitive NPs after `trotz` / `wegen` / `während`, so a natural example sentence is a near-minimal frame around the answer:

> targetForm: **`guten Grundes`** · exampleSentences: _"Trotz **guten Grundes** blieb er zu Hause."_ / _"Sie zog um, trotz **guten Grundes** dagegen."_

The definite/indefinite targets ("den neuen Tisch") sit in ordinary sentences with far more surrounding material, so the answer is less conspicuous and the judge fires less often. Note the three most recent rows of this cell all contain the target verbatim in their examples and **two of them were approved** — the veto is not even consistent, which means the ~15 rows already in the pool were approved by coin-flip, not by a different draft shape.

**Fix:** port the vocab_recall carve-out into `buildConjugationValidationUserPrompt` / the conjugation scoring note, naming both `exampleSentences` and `breakdown` as post-answer, and bump `VALIDATION_PROMPT_VERSION`. Caveat from memory: **`eval:gen` cannot A/B a validator change** — it always uses the live Langfuse validation body — so this needs the merge + `push-prompts` sync, then a read of the next night's `rejection_reason_counts`. Nothing needs demoting: the rejected drafts were never stored.

---

## `de-b1-n-declension`: the 08-16 fix, verified

| Run | Req | Prod | Appr | Rej | Dedup | Cost | `coverage_outcome.case` |
|---|---|---|---|---|---|---|---|
| **08-17** | 17 | 26 | **7** | 10 | 3 | **$0.60** | acc 3/5, gen 3/6, dat 1/6 — **no `nominative` bucket** |
| 08-16 | 18 | 32 | **1** | 16 | 4 | $0.77 | nom **0/13**, acc 1/5 |
| 08-15 | 21 | 42 | 3 | 16 | 7 | — | nom **1/12**, acc 2/5, dat 0/2, gen 0/2 |
| 08-14 | 29 | 38 | 8 | 16 | 3 | — | nom **1/13**, acc 2/7, dat 2/4, gen 3/5 |

`curriculum_version` on today's job reads **`2026-08-16`** — the `CURRICULUM_VERSION_DE` bump propagated and cleared the `skip-low-yield` suppression the 1-row 08-16 result would otherwise have triggered. The unrealizable axis is gone from the request plan, approval went **6% → 41%**, and the drafts that used to be spent on nominative now land on cases that can actually be marked.

Residual: the two degenerate approved nominative conjugation rows noted on 08-16 are still in the pool (`demote:pool` can't target by coverage tag). One flagged draft today carries a validator note worth acting on separately — the generator picked **`Bär`** as a weak masculine, which Duden treats as borderline (des Bärs/Bären). Worth adding the canonical exemplar list (`Junge, Kollege, Student, Herr, Mensch, Nachbar`) as a seed constraint rather than letting the generator choose.

The lifetime sweep row is unchanged at **145 requested / 3 approved** — today contributed zero, which is the point.

---

## The unrealizable-floor sweep, refreshed

Every `(point, axis, value)` since 2026-07-01 with ≥15 requested and <15% approved. Four entries are **new** since 08-16:

| Point | Axis | Value | Runs | Req | Appr | % |
|---|---|---|---|---|---|---|
| `de:b1:*:de-b1-n-declension` | case | nominative | 12 | 145 | 3 | 2.1% — **fixed, frozen** |
| `es:b2:*:es-b2-subjunctive-negated-opinion` | polarity | affirmative | 5 | 73 | 0 | **0.0%** |
| `es:b1:*:es-b1-imperative-negative-pronouns` | polarity | affirmative | 5 | 66 | 1 | 1.5% |
| `es:a2:*:es-a2-present-irregular-stem-changes` | person | 1pl | 12 | 61 | 6 | 9.8% |
| `tr:a1:*:tr-a1-locative` | number | plural | 8 | 32 | 3 | 9.4% |
| **`tr:b1:*:tr-b1-causative-voice`** | polarity | affirmative | 5 | 29 | 3 | 10.3% |
| `de:a1:*:de-a1-vocab-food-drink` | wordClass | verb | 4 | 25 | 1 | 4.0% |
| `tr:a1:*:tr-a1-vocab-food-drink` | wordClass | adjective | 5 | 23 | 3 | 13.0% |
| `tr:a1:*:tr-a1-vocab-food-drink` | wordClass | verb | 4 | 23 | 1 | 4.3% |
| **`es:a1:*:es-a1-present-yo-go`** | person | **3sg** | 3 | 21 | 0 | **0.0%** |
| `de:a1:*:de-a1-vocab-food-drink` | wordClass | adjective | 3 | 20 | 0 | **0.0%** |
| **`es:a1:*:es-a1-present-yo-go`** | person | **3pl** | 3 | 18 | 0 | **0.0%** |
| **`tr:a1:*:tr-a1-vowel-harmony`** | case | locative | 7 | 17 | 2 | 11.8% |

`es-a1-present-yo-go` is the cleanest new case and the same signature as n-declension: *yo-go* verbs (`tengo`, `salgo`, `pongo`) are irregular **only in 1sg** — 3sg and 3pl are perfectly regular, so a draft targeting them drills nothing. **39 requested across 3sg + 3pl, 0 approved, ever.**

`de-a2-adjective-declension-zero`'s `case` floors have dropped off this list (genitive is now 13/73 = 17.8% lifetime) — its problem is the spoils veto above, not an unrealizable axis.

The 08-16 rec #3 point stands and gets stronger with four new entries: `suppressedFor` in `coverage-decision.ts` suppresses only on *exactly zero* approvals in the *single most recent* batch, so a value yielding a few percent is never suppressed and a value that got one lucky approval un-suppresses itself. A trailing-window predicate (<1 approval per 10 requested over the last N batches) would have caught all thirteen without a human reading `coverage_outcome`.

---

## Dedup exhaustion: two cells that should stop being scheduled

40 dedup give-ups this run; 18 from two DE Präteritum conjugation cells.

| Cell | Req | Prod | Appr | Dedup | History |
|---|---|---|---|---|---|
| `de:a2:conjugation:de-a2-praeteritum-modals` | 15 | **48** | 1 | 11 | chronic |
| `de:a1:conjugation:de-a1-praeteritum-sein-haben` | 7 | **28** | **0** | **7 (all)** | 0/7 (08-17), 1/8 (08-15), 0/8 (07-25), 7/15 (07-23) |
| `tr:a1:vocab_recall:tr-a1-vocab-transport-places` | 6 | 21 | **0** | 5 | recurring |
| `de:a1:vocab_recall:de-a1-vocab-family-people` | 7 | 17 | 4 | 3 | recurring |
| `es:a1:vocab_recall:es-a1-vocab-family-people` | 7 | 13 | 1 | 2 | recurring |

`de-a1-praeteritum-sein-haben` is the clearest: the answer space is the 12 Präteritum forms of *sein* and *haben*. It produced **28 drafts to fill 7 slots and every single one collided** with the dedup index. It has approved **1 row across its last four runs** (7 on 07-23, then 0/0/1/0) while burning ~$0.55/night. `targetOverride` on this cell (and on `de-a2-praeteritum-modals`, and the three saturated `vocab_recall` umbrella cells carried since 08-16) stops the churn outright — this is the cheapest recommendation in the doc.

---

## Rejection reasons

| Reason | 08-17 | 08-16 | 08-15 | Rate of decided (08-17) |
|---|---|---|---|---|
| `low-quality-reject` | **43** | 44 | 85 | 10.0% |
| `context-spoils-answer` | **40** | 22 | 38 | 9.3% |
| `answer-stem-overlap` | 1 | 1 | 5 | 0.2% |
| `cultural-issue` | 0 | 0 | 1 | — |

`context-spoils-answer` **nearly doubled** (22 → 40) on a smaller run. By surface: conjugation 18, cloze 12, translation 6, vocab_recall 4. Two DE cells supply 23 of the 40 — `de-a2-adjective-declension-zero` (14, the validator bug above) and `de-a1-zero-article` (9, a genuinely different problem, below).

Reasons sum to 84 against `rejected_count` 117; 40 of those rejects are dedup give-ups which by contract contribute no reason, leaving **~7 rejects with no recorded reason** — the smallest such gap in the series, and consistent with the documented `dedupGivenUpCount` contract rather than a new accounting hole.

### `de-a1-zero-article` (cloze) — chronic, and *not* the validator bug

| Run | Req | Appr | Rej | `context-spoils` |
|---|---|---|---|---|
| 08-17 | 11 | 1 | 10 | **9** |
| 08-15 | 13 | 2 | 11 | 10 |
| 08-14 | 17 | 4 | 13 | 12 |
| 07-24 | 12 | 2 | 7 | 2 |
| 07-23 | 15 | 3 | 11 | 6 |
| 07-22 | 20 | 5 | 11 | 5 |
| **Total** | **88** | **17 (19%)** | **63** | **44** |

Cloze has no `exampleSentences`, so this is the `glossEn` path. The surviving approved rows are almost all profession-after-`sein` frames whose gloss carries the English indefinite article the German point drops:

> _"Mein Vater ist ___ und reist viel."_ — gloss: _"My father is **a pilot** and travels a lot."_

The gloss names the answer outright. This is the **`audit:gloss` spoilage class**, and it is the same point family (`de-a1-zero-article` / `de-b1-articles-use`) that 08-16 rec #6 flagged as unfixable by `acceptableAnswers`. Worth handling together with that rec — but on the *generation policy* side (which frames may be blanked), not by widening acceptable answers.

### Flag codes (90 flagged rows; a row can carry several)

| Code | 08-17 | 08-16 | 08-15 |
|---|---|---|---|
| `low-quality-flag` | 77 | 114 | 194 |
| `ambiguous` | **61** | 80 | 138 |
| `grammar-point-mismatch` | 13 | 22 | 51 |
| `level-mismatch` | 12 | 29 | 25 |

`ambiguous` is 14.1% of decided drafts (down from 15.2%), but **its composition shifted decisively to `vocab_recall`**: 26 of 61, ahead of cloze (21) and translation (14) — a reversal of the DE-connector/article pattern that dominated 08-16.

And unlike the connector cluster, this one has a single, crisp mechanism. Every sampled `validator-note` is the **definition-picks-out-two-headwords** failure:

> _"the definition ('flat surface and legs, often found in a kitchen or office…') describes BOTH 'der Tisch' and 'der Schreibtisch' with roughly equal validity … the acceptableAnswers listing of 'der Tisch' acknowledges the ambiguity but does not cure it for a vocab_recall exercise whose job is to elicit exactly one headword."_

> _"the description fits 'die Ebene' at least as well as 'die Wiese' … the hint leans toward 'die Wiese', while the main prompt leans toward 'die Ebene', creating internal inconsistency."_

> _"the prompt's definition ('place of employment/professional institution') fits 'işyeri' at least as well as — arguably better than — 'işletme'."_

Top `ambiguous` points: `tr-a2-vocab-city-shopping` (4), `es-a1-vocab-city-places` (3), `tr-b2-vocab-work-professional` (3). This is directly actionable in the vocab_recall generation prompt: the definition must contain at least one **discriminating** feature against the nearest neighbour in the same umbrella, and `hints` must not pull toward a different headword than the prompt. Note the validator explicitly says listing the near-synonym in `acceptableAnswers` does **not** cure it — so the fix is generation-side.

---

## Coverage-directed generation

56 of 120 cells (47%) carried a `coverage_outcome`, covering 210 of 435 requested drafts.

| | Cells | Req | Appr | Flag | Rej | Appr% of decided |
|---|---|---|---|---|---|---|
| With `coverageSpec` | 56 | 210 | 108 | 28 | 71 | **52.2%** |
| Without | 64 | 225 | 117 | 62 | 46 | **52.0%** |

**Axis-directed requesting costs nothing in aggregate** — the two groups are within 0.2 points, the same conclusion as 08-16. What differs is the *shape* of the losses: the spec group fails through rejects (71 vs 46), the non-spec group through flags (62 vs 28). That is expected — conjugation, where all 74 drafts carry a spec, is a hard-veto surface.

Strip the three broken conjugation cells (the validator bug + the two saturated Präteritum cells) out of the spec group and it runs **94 approved of 136 decided — 69.1%**, comfortably the best block in the run. The mechanism works where the axis is realizable: `de:b1:conjugation:de-b1-n-declension` filled accusative 3/5 and genitive 3/6 the night the dead axis was removed.

---

## Weakest cells (req ≥ 4, approval < 50%)

| Cell | Req | Prod | Appr | Rej | Dedup | Dominant reason |
|---|---|---|---|---|---|---|
| `de:b1:conjugation:de-b1-n-declension` | 17 | 26 | 7 | 10 | 3 | recovering — 1→7 after #655 |
| `de:a2:conjugation:de-a2-adjective-declension-zero` | 16 | 16 | **1** | 15 | 0 | **14 × validator spoils bug** |
| `de:a2:conjugation:de-a2-praeteritum-modals` | 15 | 48 | **1** | 11 | 11 | dedup exhaustion |
| `de:a1:cloze:de-a1-zero-article` | 11 | 14 | **1** | 10 | 1 | 9 × `context-spoils` (gloss) |
| `de:a2:translation:de-a2-weil-deshalb` | 9 | 9 | 3 | 4 | 0 | lqr ×3 |
| `de:a1:conjugation:de-a1-praeteritum-sein-haben` | 7 | 28 | **0** | 7 | **7** | closed answer space |
| `es:a1:vocab_recall:es-a1-vocab-family-people` | 7 | 13 | 1 | 5 | 2 | saturated + failing |
| `tr:b2:cloze:tr-b2-compound-past-hikaye` | 6 | 6 | **0** | 4 | 0 | lqr ×4, spoils ×2 |
| `tr:a1:vocab_recall:tr-a1-vocab-transport-places` | 6 | 21 | **0** | 5 | 5 | dedup exhaustion |
| `de:b1:translation:de-b1-articles-use` | 6 | 7 | 1 | 1 | 0 | 4 flagged — the article ambiguity |
| `tr:a2:vocab_recall:tr-a2-vocab-city-shopping` | 6 | 8 | 2 | 0 | 0 | 4 × `ambiguous` (definition) |
| `es:a1:vocab_recall:es-a1-vocab-city-places` | 5 | 8 | 1 | 1 | 0 | 3 × `ambiguous` (definition) |
| `de:a1:cloze:de-a1-accusative` | 4 | 4 | 1 | 2 | 0 | lqr ×2 |

Standing caveat: a low *daily* approval% on a topped-up cell is churn against a near-full pool, not under-service. What is different today is that the top four cells are all **repeat offenders with a named mechanism**, and between them they account for 46 of 117 rejects.

---

## Sentence construction

Two cells, **6 requested, 6 approved, 100%** — `de:b1:sentence_construction:de-b1-um-zu-damit` (3/3) and `es:b1:sentence_construction:es-b1-conditional` (3/3).

Post-resume cumulative: **246 approved of 254 requested (96.9%) across four runs.** SC is now the healthiest surface in the pool by a wide margin — 1,509 approved against only 75 flagged (4.7%), versus 30% flagged on cloze and 23% on translation. Nothing to act on; the #606/#607 + #613 storyline is closed.

`tr:b2` SC remains structurally frozen at 14 approved / 15 flagged (`tr-b2-double-voice`, `targetOverride: 15`), unchanged since 07-23.

---

## Recommendations

1. **~~Port the vocab_recall post-answer carve-out to the conjugation validator prompt~~ — DONE 2026-08-17 (#656).** `breakdown` and `exampleSentences` are rendered only after submission (`conjugation-exercise.tsx:177-186`), so the validator was vetoing drafts for a leak that does not exist. Verified 7/16 → 0/16 with the veto intact on instruction-spoiled controls (16/16).

   Two corrections to the section above, both from the probe. (a) The trigger is **`breakdown`**, not `exampleSentences` — masking the target out of the examples made the veto *worse* (5/12 → 8/12), while the breakdown note alone took 9/16 → 1/16. The prompt's own label ("Breakdown shown to the learner") was the proximate cause, so the label was changed too, not just the note. (b) This is **USER-prompt-only**, so it ships with the **code deploy** and needs **no `push-prompts` run** — the cached system template is untouched. `VALIDATION_PROMPT_VERSION` was bumped anyway for trace cohorting.

   Nothing to re-promote: rejected drafts are never stored.

1a. **Residual `context-spoils` on the fixed cell — still open.** The production run left 6 spoils on 15 drafts (40%). The carve-out deliberately keeps the veto live on `Instructions` / `Feature bundle`, so some of these are probably *correct* vetoes: zero-article strong declension in the **nominative** is the case where the adjective carries the marker the article normally would, and the instructions must name gender+case to state the task at all — the same "the floor names the value where the marking is degenerate" shape as `de-b1-n-declension` (rec #4). Next step is to read actual rejected drafts via a probe (they are never persisted), not to widen the note further.

1b. **A prompt fix cannot un-stick a low-yield cell.** `decideEnqueue` suppresses on the most recent job's `approvedCount < LOW_YIELD_THRESHOLD (3)` and clears **only** on a `CURRICULUM_VERSION_<LANG>` mismatch — it never reads `VALIDATION_PROMPT_VERSION`. #656 changed no curriculum, so this cell (1 approved on 08-17, `curriculum_version` matching disk at `2026-08-16`) would have stayed `skip-low-yield` **forever**, and the fix would have shipped inert on the very cell it was written for. Cleared by a manual CLI run (6 approved ≥ 3 → the new most-recent job is no longer low-yield); `loadMostRecentSucceededJobPerCell` has no trigger filter, so a `trigger='cli'` job counts. **54 of 78 DE cells that ran on 08-17 approved <3** and are suppressed until the next DE curriculum bump — mostly near-target and benign, but `de-a1-zero-article` (1/11) and `de-b1-articles-use` (1/6) are genuinely stuck. Worth considering whether a prompt-version mismatch should also clear suppression.

1c. **The CLI could not target any conjugation cell** — `generate-exercises-resolve-cells.ts` kept a stale duplicate of the kind→type map, predating `conjugation` entirely. Fixed in **#657**; it now delegates to the enumerator's own `compatibleTypes`.
2. **`targetOverride` the saturated cells.** `de-a1-praeteritum-sein-haben` (0 approved, 28 produced, 7/7 dedup give-ups; 1 approved across its last four runs) and `de-a2-praeteritum-modals` (1/15, 48 produced, 11 give-ups) are closed answer spaces. Add the three `vocab_recall` umbrella cells carried from 08-16 (`es-a1-vocab-family-people`, `tr-a1-vocab-family-people`, `tr-a1-vocab-transport-places`). Cheapest fix in the doc; recovers ~18 wasted slots and ~$1.50/night.
3. **Fix vocab_recall definition specificity in the generation prompt.** `ambiguous` is now 26/61 on vocab_recall with a single named mechanism — the definition picks out two headwords from the same umbrella (`Tisch`/`Schreibtisch`, `Wiese`/`Ebene`, `işletme`/`işyeri`), and `hints` sometimes pull toward the *other* one. Require a discriminating feature against the nearest umbrella neighbour and internal prompt/hint consistency. The validator states explicitly that listing the neighbour in `acceptableAnswers` does not cure it, so this must be generation-side. A/B with `eval:gen` before merge.
4. **Triage the unrealizable floors, now thirteen.** Start with the two 0% newcomers: `es-a1-present-yo-go` `person: 3sg` **0/21** and `3pl` **0/18** (yo-go verbs are irregular only in 1sg), alongside the standing `es-b2-subjunctive-negated-opinion` `polarity: affirmative` **0/73**. Same edit shape as #655 — drop the value, bump that language's `CURRICULUM_VERSION`. Then do the `suppressedFor` trailing-window change in `coverage-decision.ts` as its own PR; the current exactly-zero-in-the-latest-batch predicate cannot catch any of these.
5. **Alarm on `generation_jobs.status='failed'` and on Anthropic credit exhaustion.** Carried unactioned since 06-19. Today was clean, but 174 cells were lost to silent credit exhaustion in the last month and the same key backs learner-facing `POST /exercises/:id/submit`. Metric filter on the generation Lambda's failure log → existing SNS topic, plus a balance check.
6. **Handle the DE zero-article gloss policy** (`de-a1-zero-article` cloze, 17/88 lifetime with 44 spoils; `de-b1-articles-use` translation, 4 of 7 drafts flagged). The gloss states the answer ("is **a pilot**") because faithful English *must* supply the article German drops — same structural bind as the ordinals case in the `audit:gloss` work. This is a generation-policy decision about which frames may be blanked, not an `acceptableAnswers` widening. Merge with 08-16 rec #6.
7. **Constrain `de-b1-n-declension`'s exemplar nouns.** The fix is working (1→7), but a flagged draft today used `Bär`, which Duden treats as a borderline weak masculine. Seed from the canonical list already in the point's description (`Junge, Kollege, Student, Herr, Mensch, Nachbar`) instead of letting the generator pick.
8. **Closed this run:** 08-16 rec #2 (n-declension `nominative` floor — shipped as #655, verified 1/18 → 7/17 with the axis gone from `coverage_outcome` and the `CURRICULUM_VERSION_DE` bump confirmed on the job row). 08-16 rec #4 is **superseded by rec #1** — the `de-a2-adjective-declension-zero` failure is not a carrier-phrase leak to be constrained, it is a validator prompt that asserts a false UI visibility.
