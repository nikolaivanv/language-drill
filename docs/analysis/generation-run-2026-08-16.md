# Generation Run Analysis — 2026-08-16

_Source: prod Neon branch `br-green-waterfall-ancrvpr5` (project `twilight-smoke-01114337`), `generation_jobs` + `exercises` + `usage_events`._

## TL;DR

Third run since the cron resumed (#646, 2026-08-13). **321 approved, $18.38, ~27 min**, and the run **ran out of Anthropic credits at 04:26:21 UTC** — the last 4 cells died on a `400 … credit balance is too low`. The damage to *this* run was trivial (7 requested drafts lost) because exhaustion hit at the very end; the damage two nights ago was not (08-14 lost **83 cells / 749 drafts** to the same error). Nothing alarms on either.

Three findings worth acting on:

- **The credit brake is now the single largest source of lost generation, and it is silent.** Four of the last nine scheduled runs were truncated by it (07-17: 43 cells, 07-25: 39, 08-14: 83, 08-16: 4). The same API key backs learner-facing `POST /exercises/:id/submit`, so an exhaustion during waking hours returns 502 to learners with no signal at all. Credits *were* topped up during the day — a real evaluation succeeded at **15:36:55 UTC** (the `usage_events` row is written only after the Claude call returns) — so the account is live again as of writing.
- **`sentence_construction` is now the healthiest surface in the pool, and it finally has production evidence.** 94% approval today (32/34), 96% on 08-15, 100% on 08-14 — **240 approved of 248 requested across three runs**. Both July docs closed with "the corrected SC prompts have generated **zero** production drafts"; that gap is closed, and the #613 finishing reserve is why SC gets scheduled at all now.
- **`de-b1-n-declension` was burning ~$0.8/night to approve ~1 row, and `coverage_outcome` shows exactly why.** Its `coverageSpec` floor `nominative: 3` is **unrealizable**: nominative singular is precisely the case where a weak masculine takes *no* ending, so the prompt hands over its own answer. Across all three surfaces and five runs: **145 nominative drafts requested, 3 approved (2%)**. The deficit-directed generator re-requests the missing value every night, and the give-up net can't stop it. **Fixed** — see rec #2. A sweep of `coverage_outcome` found **eight sibling floors with the same shape**, led by `es-b2-subjunctive-negated-opinion` `polarity: affirmative` at **0 of 73**.

---

## Run overview

One scheduled run, **04:00:11 → 04:26:55 UTC** (~27 min), **120 cells enqueued**.

| | Cells | Requested | Produced | Approved | Flagged | Rejected | Dedup give-up | Cost |
|---|---|---|---|---|---|---|---|---|
| `succeeded` | 116 | 527 | 603 | **321** | 125 | 80 | 16 | **$18.38** |
| `failed` | 4 | 7 | 0 | 0 | 0 | 0 | 0 | — |

Approval% below = approved / decided (approved + flagged + rejected = **526**; one draft in `tr:a2:translation:tr-a2-reported-speech` produced but never decided — a 1-row accounting edge, not a pattern). **61.0% approval.** Cost per approved exercise **$0.057** — the most expensive of the three post-resume runs.

Pool total after the run: **25,648 approved** (25,305 auto + 343 manual), 8,240 flagged, 3,982 demoted — 37,870 rows.

| Pool by language | Approved | Flagged | Demoted |
|---|---|---|---|
| ES | 10,759 | 2,967 | 1,797 |
| DE | 8,044 | 1,722 | 225 |
| TR | 6,835 | 3,551 | 1,960 |

### Per-language

| Lang | Cells | Req | Appr | Appr% | Flag | Rej | Dedup | Cost |
|---|---|---|---|---|---|---|---|---|
| de | 78 | 337 | 226 | **67%** | 73 | 38 | 8 | $11.68 |
| tr | 24 | 125 | 66 | **53%** | 33 | 25 | 5 | $4.37 |
| es | 14 | 65 | 29 | **45%** | 19 | 17 | 3 | $2.33 |

**The July fair-share complaint has resolved itself.** 07-23/07-24 both flagged ES eating 46–50 cells to request 68 drafts while DE's 50-cell cap was over-subscribed. Today ES brought only **14** cells — it genuinely has little left to do — and `selectCellsWithinCaps`' redistribution pass handed the unused slots to DE (78 cells, well above the 50 fair-share reserve, which binds only under contention). That is the selector working as designed. **No action needed on 07-23 rec #7.**

### Per level

| | de a1 | de a2 | de b1 | de b2 | es a1 | es b1 | es b2 | tr a1 | tr a2 | tr b1 | tr b2 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| cells | 28 | 15 | 20 | 15 | 5 | 5 | 4 | 12 | 9 | 1 | 2 |
| req | 105 | 52 | 115 | 65 | 25 | 22 | 18 | 59 | 46 | 5 | 15 |
| appr | 76 | 32 | 75 | 43 | 13 | 13 | **3** | 27 | 27 | 5 | 7 |

`es:b2` is the weakest level-block in the run: **3 approved of 18** (17%), with **11 flagged** — the flag, not the reject, is doing the work there.

### Post-resume trend

| Day | Cells ok/failed | Req | Approved | Appr% | Flag% | Cost | $/approved | Runtime |
|---|---|---|---|---|---|---|---|---|
| **08-16** | 116 / **4** | 527 | 321 | **61%** | **23.8%** | $18.38 | $0.057 | 27 min |
| 08-15 | 120 / 0 | 1,118 | 733 | 66% | 19.3% | $31.31 | $0.043 | 35 min |
| 08-14 | 37 / **83** | 732 | 511 | 70% | 17.1% | $17.00 | $0.033 | 18 min |
| 07-24 | 120 / 0 | 663 | 426 | 64% | 16.7% | $19.21 | $0.045 | 25 min |
| 07-23 | 120 / 0 | 863 | 541 | 63% | 15.6% | $23.08 | $0.043 | 34 min |

Requested halved overnight (1,118 → 527). That is expected: the collapse repass (#647/#649/#653) demoted ~910 rows on 08-14, creating a one-off deficit spike that two runs have now largely refilled.

**Flag rate is the number that is actually moving.** 15.6% → 16.7% → 17.1% → 19.3% → **23.8%** over five runs. Approval is drifting down (70 → 66 → 61%) almost entirely through flags, not rejects — the residual tail is disproportionately *ambiguity-prone*, not *wrong*.

---

## The credit exhaustion

All four failures carry the identical body:

```
400 {"type":"error","error":{"type":"invalid_request_error",
"message":"Your credit balance is too low to access the Anthropic API…"}}
```

| Cell | Req | Failed at |
|---|---|---|
| `tr:a2:cloze:tr-a2-spatial-postpositions` | 4 | 04:26:21 |
| `de:a2:cloze:de-a2-wissen-kennen` | 1 | 04:26:41 |
| `de:a2:translation:de-a2-akkusativ-prepositions` | 1 | 04:26:52 |
| `de:a2:sentence_construction:de-a2-praeteritum-modals` | 1 | 04:26:54 |

Four scheduled runs truncated by this error in the last month:

| Run | Failed cells | Drafts lost |
|---|---|---|
| 07-17 | 43 | — |
| 07-25 | 39 | — |
| **08-14** | **83** | **749** |
| 08-16 | 4 | 7 |

The generation side self-recovers (deficits persist, cells re-enqueue next tick), so the cost of a truncated *nightly* run is one day of latency. The uncovered risk is the **shared key**: `language-drill/ANTHROPIC_API_KEY` backs both the generation Lambda and `POST /exercises/:id/submit`. Exhaustion at 04:26 UTC is harmless; exhaustion at 19:00 UTC is a silent learner-facing outage (502), because Lambda errors live in CloudWatch, `Errors` stays at 0 for caught Hono throws, and no alarm exists on `generation_jobs.status='failed'`.

Evidence the account is healthy again: `usage_events` has exactly one row today, an `ai_evaluation` at **15:36:55 UTC** (ES B1). That row is inserted *after* the Claude call returns (`infra/lambda/src/routes/exercises.ts:739`), so it is proof of a successful call, not just an attempt.

**This is the standing "alarm on failed generation jobs" recommendation, now with a second, sharper reason to ship it.** The cheap version: a CloudWatch metric filter on the generation Lambda's failure log line → SNS (the topics already exist), plus a low-balance check. It has been carried unactioned in every run doc since 06-19.

---

## Sentence construction: fixed, seeded, and finally proven in production

| Day | SC cells | Req | Appr | Appr% | Flag | Rej |
|---|---|---|---|---|---|---|
| 08-16 | 9 | 34 | **32** | **94%** | 1 | 1 |
| 08-15 | 11 | 138 | **132** | **96%** | 3 | 3 |
| 08-14 | 4 | 76 | **76** | **100%** | 0 | 0 |
| 07-24 | **0** | — | — | — | — | — |
| 07-23 | **0** | — | — | — | — | — |

Today's per-cell detail — 8 of 10 cells clean:

| Cell | Req | Appr |
|---|---|---|
| `tr:a2:sentence_construction:tr-a2-mis-evidential` | 5 | 5 |
| `tr:a2:sentence_construction:tr-a2-aorist` | 5 | 5 |
| `tr:b1:sentence_construction:tr-b1-passive-voice` | 5 | 5 |
| `de:b1:sentence_construction:de-b1-konjunktiv-ii-past` | 5 | 5 |
| `tr:a2:sentence_construction:tr-a2-converb-temporal` | 5 | 4 (1 dedup) |
| `de:a1:sentence_construction:de-a1-questions` | 4 | 4 |
| `de:a1:sentence_construction:de-a1-modal-verbs-present` | 3 | 3 |
| `de:a1:sentence_construction:de-a1-present-regular` | 1 | 1 |
| `de:a2:sentence_construction:de-a2-weil-deshalb` | 1 | 0 (flagged) |
| `de:a2:sentence_construction:de-a2-praeteritum-modals` | 1 | — (credit failure) |

Two July storylines close here:

1. **#606/#607 are validated under real traffic.** The 07-23 and 07-24 docs both had to caveat that the corrected SC prompts had produced *zero* production drafts and that the `eval:gen` 78% → 94% claim was the only evidence. Three runs, 248 requested, 240 approved — the `eval:gen` number was, if anything, conservative. `de-a1-modal-verbs-present`, the pre-fix exhibit cell at 4/20 on 07-22, is 3/3 today.
2. **The finishing reserve (#613) is why SC runs at all.** July's diagnosis was deficit-rank starvation: nine SC cells with `need` 1–7 deferred indefinitely behind chronic DE cells at `need` 12–19. Today's SC cells requested 1–5 drafts each — exactly the profile that was being starved. Rec #6 from 07-23 shipped and works.

**Still frozen:** `tr:b2` SC sits at **14 approved / 15 flagged**, byte-identical to 07-23. `tr-b2-double-voice` is `targetOverride: 15` (#605), so it can never rise. Unchanged diagnosis: split double-voice into separate voice points, or add a second TR-B2 SC-suitable point.

Current SC pool (approved / flagged) — note the July→August drop in TR and ES is the collapse repass demoting rows, not generation regressing:

| | DE | ES | TR |
|---|---|---|---|
| A1 | 65 / 6 | — | — |
| A2 | 146 / 4 | — | 133 / 11 |
| B1 | 197 / 2 | 196 / 4 | 631 / 31 |
| B2 | 48 / 1 | 73 / 1 | **14 / 15** |

---

## Per-type yield: conjugation is the problem surface

| Type | Cells | Req | Appr | Appr% | Flag | Rej |
|---|---|---|---|---|---|---|
| `sentence_construction` | 9 | 34 | 32 | **94%** | 1 | 1 |
| `translation` | 48 | 221 | 142 | 64% | 62 | 16 |
| `cloze` | 44 | 178 | 103 | 58% | 50 | 25 |
| `vocab_recall` | 11 | 64 | 33 | 52% | 11 | 20 |
| `conjugation` | 4 | 30 | 11 | **37%** | 1 | 18 |

Conjugation across all three post-resume runs: **39 approved of 146 requested (27%), 91 rejected.** It is the only surface where *rejects* dominate flags, and it is concentrated in a handful of cells.

### `de-b1-n-declension` (conjugation) — a coverage floor the grammar cannot satisfy

| Run | Req | Prod | Appr | Rej | Dedup | Reasons | `coverage_outcome.case` (approved/requested) |
|---|---|---|---|---|---|---|---|
| 08-16 | 18 | 32 | **1** | 16 | 4 | lqr 6, spoils 7 | nom **0/13**, acc 1/5 |
| 08-15 | 21 | 42 | 3 | 16 | 7 | lqr 6, spoils 5 | nom **1/12**, acc 2/5, dat 0/2, gen 0/2 |
| 08-14 | 29 | 38 | 8 | 16 | 3 | lqr 8, spoils 7 | nom **1/13**, acc 2/7, dat 2/4, gen 3/5 |
| 07-21 | 31 | 38 | 2 | 29 | 14 | lqr 1, spoils 15 | nom **0/13**, acc 0/7, dat 2/6, gen 0/5 |
| 07-18 | 50 | — | 15 | 31 | 17 | lqr 1, spoils 13 | nom **0/13**, acc 5/13, dat 5/12, gen 5/12 |

**64 nominative drafts requested across five runs; 2 approved.** The whole approved pool confirms it, on every surface:

| Type | nominative | accusative | dative | genitive |
|---|---|---|---|---|
| conjugation | **2** | 11 | 10 | 10 |
| cloze | **1** | 12 | 12 | 12 |
| translation | **0** | 20 | 17 | 13 |

The mechanism is in the spec's own comment (`packages/db/src/curriculum/de.ts:1857`): _"-(e)n in every case except nominative singular … The small nominative floor covers the over-application trap (bare form)."_ Pedagogically that trap is real, but it is **not constructible as a generated item**: a "decline this weak masculine, nominative" prompt asks for the citation form, so the stem hands over the answer (`context-spoils-answer`, 7/5/7/15/13 across the runs) or the item drills nothing (`low-quality-reject`). The validator is right to kill them every time.

The feedback loop makes it permanent: the coverage-directed request is computed from the *approved* pool's deficit, so the unfillable axis grows a bigger deficit each night and consumes a larger share of the cell's request budget — 13 of 18 drafts today, up from 5 of 13 by share on 07-18. Cost is ~$0.77/night for ~1 approved row, plus a permanent `audit:collapse` false positive on that axis.

**Fix:** drop the `nominative` floor from `de-b1-n-declension`'s `coverageSpec`, or make `coverageSpec` surface-aware so a floor applies only where the axis value is realizable. Add a `collapse-dismissals.ts` entry so the audit stops reporting it. This is the highest-value single edit in the run.

### The same shape elsewhere — a sweep of `coverage_outcome`

`generation_jobs.coverage_outcome` records approved/requested per `(axis, value)` per run, which makes this class of defect directly measurable. Every `(cell, axis, value)` since 2026-07-01 with ≥15 requested and <15% approved:

| Cell | Axis | Value | Runs | Req | Appr | % |
|---|---|---|---|---|---|---|
| `de:b1:*:de-b1-n-declension` (3 surfaces) | case | nominative | 12 | **145** | 3 | 2% |
| `es:b2:{cloze,translation}:es-b2-subjunctive-negated-opinion` | polarity | affirmative | 5 | **73** | 0 | **0%** |
| `es:b1:{cloze,translation}:es-b1-imperative-negative-pronouns` | polarity | affirmative | 5 | 66 | 1 | 2% |
| `de:a2:{conjugation,translation}:de-a2-adjective-declension-zero` | case | genitive | 9 | 56 | 5 | 9% |
| `de:a2:conjugation:de-a2-adjective-declension-zero` | case | nominative | 5 | 35 | 4 | 11% |
| `de:a1:vocab_recall:de-a1-vocab-food-drink` | wordClass | verb / adjective | 5 | 42 | 1 | 2% |
| `tr:a1:vocab_recall:tr-a1-vocab-food-drink` | wordClass | verb / adjective | 9 | 46 | 4 | 9% |
| `es:a2:*:es-a2-present-irregular-stem-changes` | person | 1pl | 12 | 61 | 6 | 10% |
| `tr:a1:cloze:tr-a1-locative` | number | plural | 4 | 18 | 1 | 6% |

`es-b2-subjunctive-negated-opinion` at **0 of 73** is the cleanest sibling: the point *is* the negated opinion (`no creo que venga`), and an affirmative opinion takes the indicative — so an affirmative draft isn't a harder version of the point, it's a different point. `es-a2-present-irregular-stem-changes` / `1pl` is the classic boot-verb case: 1pl is exactly the person where the stem *doesn't* change (`podemos`, not `*puedemos`). The `vocab-food-drink` `wordClass: verb` floors are asking a food-and-drink lexical umbrella for verbs it barely contains.

Same signature every time — a floor naming the value where the point's marking is *absent*. None of these is caught by the give-up net, for the same reason n-declension wasn't.

Other conjugation offenders (three-run view): `de:a2:conjugation:de-a2-adjective-declension-zero` 2/18 with 14 `context-spoils` (the chronic carrier-phrase leak identified 07-23, still un-shipped); `de:a2:conjugation:de-a2-praeteritum-modals` 1/16 with 11 dedup give-ups (finite answer space — nothing to fix); `tr:b1:conjugation:tr-b1-causative-voice` 0/7, all `low-quality-reject`.

---

## Rejection reasons

| Reason | 08-16 | 08-15 | 08-14 | Rate of decided (08-16) |
|---|---|---|---|---|
| `low-quality-reject` | **44** | 85 | 41 | 8.4% |
| `context-spoils-answer` | 22 | 38 | 55 | 4.2% |
| `answer-stem-overlap` | 1 | 5 | 4 | 0.2% |
| `cultural-issue` | 0 | 1 | 1 | — |

`low-quality-reject` has overtaken `context-spoils-answer` as the #1 reason — a reversal of the six-day July pattern. Part of that is `context-spoils` genuinely falling (55 → 38 → 22), part is cell mix. Reasons sum to 67 against `rejected_count` 80; 13 rejects carry no recorded reason (the same accounting gap as prior runs — worth a look if anyone touches that writer).

### Flag codes (125 flagged rows; a row can carry several)

| Code | 08-16 | 08-15 | 08-14 |
|---|---|---|---|
| `low-quality-flag` | 114 | 194 | 117 |
| `ambiguous` | **80** | 138 | 74 |
| `grammar-point-mismatch` | 22 | 51 | 28 |
| `level-mismatch` | 10 | 29 | 25 |

`ambiguous` is 15% of decided drafts and is the driver behind the rising flag rate. It is diffuse by point — the largest single cluster is 5 — but the *validator notes* are not diffuse. Sampling flagged DE translations, the recurring shape is the **definite-article-vs-bare-abstract-noun** contrast:

> _"both 'Die Technologie verändert die Welt.' (definite article, generic reading) and 'Technologie verändert die Welt.' (zero article, mass/abstract reading) are grammatically and semantically valid German renderings…"_

> _"Ambiguity not fully resolved: both 'Das Wissen ist die Grundlage…' and 'Wissen ist die Grundlage…' … but this is precisely the contrast [the point tests]"_

That last note is the important one: on `de-b1-articles-use` / `de-a1-zero-article`, article-vs-no-article **is the grammar point**, so a prompt that admits both readings is unfixable by `acceptableAnswers` — listing both destroys the item. Top `ambiguous` points today: `tr-a2-causal-connectors` (5), `tr-a2-adversative-connectors` (4), `tr-a1-personal-pronouns` (3), `de-b1-articles-use` (3), `de-b1-subordinate-conjunctions` (3), `de-b2-adversative-connectors` (3), `de-a1-questions` (3). The connector points on both languages cluster the same way the July `context-spoils` connector problem did.

---

## Coverage-directed generation

47 of 116 succeeded cells (40%) carried a `coverage_outcome`, covering 209 of 527 requested drafts.

| | Cells | Req | Appr | Appr% |
|---|---|---|---|---|
| With `coverageSpec` | 47 | 209 | 124 | 59% |
| Without | 69 | 318 | 197 | 62% |

Axis-directed requesting is **not** costing yield in aggregate (3 points, within noise) — the damage is concentrated entirely in cells where an axis value is unrealizable, which is one cell (`de-b1-n-declension`) doing 13 of the 85 non-approvals in the coverage-spec group. The mechanism itself is working: `de:b1:translation:de-b1-n-declension` hit 9/9 with dative 2/2 and genitive 4/7, and `de:b1:sentence_construction:de-b1-konjunktiv-ii-past` filled 3pl 3/3.

---

## Weakest cells (req ≥ 4, approval < 50%)

| Cell | Req | Prod | Appr | Rej | Dedup | Dominant reason |
|---|---|---|---|---|---|---|
| `de:b1:conjugation:de-b1-n-declension` | 18 | 32 | **1** | 16 | 4 | unrealizable `nominative` floor (above) |
| `tr:b2:cloze:tr-b2-compound-past-hikaye` | 9 | 9 | 3 | 3 | 0 | `low-quality-reject` ×3 + 3 `ambiguous` |
| `es:a1:vocab_recall:es-a1-vocab-family-people` | 7 | 16 | **0** | 7 | 3 | lqr ×3, spoils ×1 — saturated + failing |
| `tr:a1:vocab_recall:tr-a1-vocab-transport-places` | 7 | 14 | 3 | 4 | 2 | dedup + lqr |
| `tr:a1:vocab_recall:tr-a1-vocab-family-people` | 7 | 16 | 3 | 2 | 2 | dedup exhaustion |
| `tr:a2:translation:tr-a2-causal-connectors` | 7 | 8 | 2 | 0 | 0 | 5 × `ambiguous` flag |
| `es:b1:cloze:es-b1-que-vs-cual` | 6 | 6 | 2 | 3 | 0 | `low-quality-reject` ×3 |
| `de:a1:cloze:de-a1-accusative` | 6 | 6 | 2 | 2 | 0 | lqr + `answer-stem-overlap` |
| `tr:a1:translation:tr-a1-personal-pronouns` | 5 | 5 | **0** | 2 | 0 | lqr ×2 + 3 `ambiguous` |
| `es:b2:translation:es-b2-comparatives-advanced` | 5 | 5 | **0** | 2 | 0 | `low-quality-reject` ×2 |
| `tr:a1:cloze:tr-a1-questions` | 4 | 4 | **0** | 3 | 0 | `low-quality-reject` ×3 |
| `es:b2:cloze:es-b2-consecutives-intensity` | 4 | 4 | **0** | 0 | 0 | all 4 flagged (`ambiguous` ×2) |
| `tr:a2:cloze:tr-a2-adversative-connectors` | 4 | 5 | **0** | 0 | 0 | all flagged, `ambiguous` ×4 |

Standing caveat: a low *daily* approval% on a topped-up cell is churn against a near-full pool, not under-service. The cells worth attention are the ones where the same reason recurs across runs — `n-declension`, the `vocab_recall` family cells (dedup-exhausted), and the TR/DE connector cluster on `ambiguous`.

---

## Recommendations

1. **Alarm on `generation_jobs.status='failed'` and on Anthropic credit exhaustion.** Four truncated runs in a month, 174 lost cells, zero notifications — and the shared key means the same failure is a silent learner-facing 502 during the day. Metric filter on the generation Lambda's failure log → existing SNS topic, plus a balance check. Carried unactioned since 06-19; it now has two independent justifications.
2. **~~Drop the `nominative` floor from `de-b1-n-declension`~~ — DONE 2026-08-16** (`fix/n-declension-nominative-floor`). Scoped up from the conjugation cell to the whole point once the sweep showed the floor is unrealizable on all three surfaces: **145 requested / 3 approved (2%)** — conjugation 2/64, translation 0/44, cloze 1/37. `CURRICULUM_VERSION_DE` bumped to `2026-08-16` — load-bearing, since the conjugation cell approved 1 row (< `LOW_YIELD_THRESHOLD`) and would otherwise be `skip-low-yield`-suppressed before the corrected spec could fire.

   Two corrections to the section above. (a) **No `collapse-dismissals.ts` entry is needed** — that ledger keys on the `answer-surface` / `stem-monotony` triaged signals; the declared-but-unrealized check reads `coverageSpec` floors directly (`computeSpecShortfall`), so removing the floor removes the report. (b) The nominative over-application trap is **not** wholly unrealizable — the one legitimate row it ever produced is a cloze with a 4-way option set (`Kardinal/Kardinalen/Kardinals/Kardinalem`). That makes it a **distractor** problem, served by the `candidateFillers` path (#638), not a coverage floor that also fires on conjugation and translation where the item is degenerate by construction.

   The two approved nominative *conjugation* rows are degenerate and still in the pool (`Student` → `der Student`, breakdown: "no -(e)n ending"). Two rows; `demote:pool` can't target by coverage tag, so they're left in place — noted here rather than hand-edited on prod.
3. **Triage the eight sibling unrealizable floors** (table above), starting with `es-b2-subjunctive-negated-opinion` `polarity: affirmative` at **0 of 73**. Same edit shape as #2 — drop the value, bump that language's `CURRICULUM_VERSION`. Then consider strengthening `suppressedFor` (`coverage-decision.ts`): it currently suppresses only on *exactly zero* approvals in the *single most recent* batch, so a value yielding a few percent is never suppressed. A trailing-window predicate (e.g. <1 approval per 10 requested over the last N batches) would have caught all nine cases without waiting for a human to read `coverage_outcome`. That is a behaviour change across every coverage-spec cell, so it wants its own PR and an `eval:gen` sanity pass — not folded into a curriculum fix.
4. **Ship the `context-spoils` carrier-phrase fix for `de-a2-adjective-declension-*` (conjugation).** 2/18 with 14 `context-spoils` on 08-14; identified 07-23 rec #2, still open. `eval:gen` on both sibling cells to read the drafts (rejects aren't persisted), then constrain the carrier phrase.
5. **Look at `ambiguous` on the connector points** — `tr-a2-causal-connectors`, `tr-a2-adversative-connectors`, `de-b2-adversative-connectors`, `de-b1-subordinate-conjunctions`. Same cluster the July `context-spoils` work targeted, now surfacing as flags rather than rejects. The July rec ("the un-blanked clause must not reveal the blanked connector") is still un-shipped and may address both.
6. **Decide policy for the DE article-vs-bare-noun ambiguity.** On `de-b1-articles-use` / `de-a1-zero-article` the ambiguity *is* the grammar point, so `acceptableAnswers` cannot cure it — the validator note says so explicitly. Either the generation prompt must force a context that disambiguates, or these blanks should not be generated on the translation surface. Related to the still-open zero-article format item from #625.
7. **Rebalance or retire the saturated `vocab_recall` family cells.** `es-a1-vocab-family-people`, `tr-a1-vocab-family-people`, `tr-a1-vocab-transport-places` all show produced ≫ approved with heavy dedup give-up — finite lexical space. `targetOverride` stops the nightly churn.
8. **`tr-b2-double-voice` remains structurally frozen at 14/15.** Unchanged since 07-23. The split into separate voice points is the only fix.
9. **Closed this run:** 07-23 rec #7 (ES over-allocation — redistribution now handles it), 07-23 rec #6 / 07-24 rec (finishing reserve — shipped as #613, SC is scheduled again), and the #606/#607 verification gap (240/248 approved in production).
