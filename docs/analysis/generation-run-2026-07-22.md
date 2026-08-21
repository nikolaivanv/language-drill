# Generation Run Analysis — 2026-07-22

_Source: prod Neon branch `br-green-waterfall-ancrvpr5` (project `twilight-smoke-01114337`), `generation_jobs` + `exercises`._

## TL;DR

Fifth clean 120-cell run in a row — all succeeded, 0 failures, **797 approved**, **$31.69**. The maturation curve continues exactly on trend: requested drafts fell again to **1,261** (from 1,839 → 2,863 the prior two days), cost fell with it, and approval held at **63%** (was 65%). The pool is now near steady-state: TR requested only **175 drafts across 41 cells** (~4/cell) and ES **93 across 29 cells** (~3/cell) — both languages are tiny top-ups now, and DE (993 req) carries essentially all the real volume.

Two clean signals:

- **The contrast-point cleanup is still holding.** `de-b2-subjective-modals`, `tr-b1-when-converbs`, `tr-b2-double-voice` **did not run again** (off-surface routing + `targetOverride` keep them out of the queue), and **`ambiguous` rejections are 0** for the second day (was ~50 a week ago).
- **Rejection reasons collapsed to three:** `context-spoils-answer` (74), `low-quality-reject` (49), `cultural-issue` (1). Everything else is gone.

On the 07-21 recommendations (revised after a deeper look — see "Correction" below):

- **`context-spoils-answer` fell to 74 in absolute terms — but that's a denominator effect, not a fix.** As a *rate of requested* it's ~5.9%, statistically flat vs the prior four days (4.4% → 6.0% → 7.4% → 5.9%). It's still the #1 reject reason. The generation-prompt fix has not landed — still valid.
- **The "batch-`targetOverride` the dedup-exhausted cells" rec was wrong and is retracted.** Those cells' pools are already at/above target (`de-b1-n-declension` 95 approved, `de-a2-adjective-declension-zero` 54, `de-a1-modal-verbs-present` 52). Low *daily* approval % is top-up churn against a full pool, not "can't reach 50" — there is no generation burn to eliminate, and `targetOverride` would change nothing.
- **The real systemic finding is a validator/exercise-type mismatch on `sentence_construction`** (surfaced by drilling into `de-a1-modal-verbs-present`) — see the new section below.

---

## Run overview

One scheduled run, **04:00:19 → 04:41:35 UTC** (~41 min), **120 cells, all `succeeded`**.

| | Cells | Requested | Produced | Approved | Flagged | Rejected | Dedup give-up | Cost |
|---|---|---|---|---|---|---|---|---|
| `succeeded` | 120 | 1,261 | 1,831 | **797** | 196 | 268 | 153 | **$31.69** |
| `failed` | 0 | — | — | — | — | — | — | — |

Approval% below = approved / requested (requested is the *decided* count: approved + flagged + rejected).

### Per-language

| Lang | Cells | Req | Appr | Appr% | Flag | Rej | Dedup | Cost |
|---|---|---|---|---|---|---|---|---|
| de | 50 | 993 | 626 | **63%** | 151 | 216 | 131 | $23.07 |
| tr | 41 | 175 | 106 | **61%** | 29 | 40 | 19 | $5.82 |
| es | 29 | 93 | 65 | **70%** | 16 | 12 | 3 | $2.80 |

TR recovered to 61% (from 54% on 07-21) and ES to 70% (from 68%) — both are small-sample now, so those swings are noise. DE at 63% is the real population signal and it's steady. Fair-share cap is doing its job (50/41/29 split).

### The maturation curve

| Day | Req | Approved | Appr% | Cost |
|---|---|---|---|---|
| 07-22 | **1,261** | 797 | 63% | **$31.69** |
| 07-21 | 1,839 | 1,192 | 65% | $42.13 |
| 07-20 | 2,863 | 2,065 | 72% | $56.35 |
| 07-19 | 4,940 | 3,719 | 75% | $95.08 |

Textbook convergence: requested and cost keep falling at a constant 120 cells; approval eases as the denominator becomes the hard residual tail. 63% at 1,261 requested is healthy steady-state, not a regression.

---

## Contrast-point cleanup: still holding

- **`de-b2-subjective-modals`, `tr-b1-when-converbs`, `tr-b2-double-voice` did not generate today** (query returned zero rows) — off-surface routing (#604) + `double-voice`'s `targetOverride` (#605) keep them out of the queue for the second straight day.
- **`ambiguous` rejections: 0** (the key is absent from every job's `rejection_reason_counts`) — vs ~50 a week ago, 1 on 07-21. Settled.

---

## Rejection reasons

| Reason | n (07-22) | 07-21 | 07-20 | 07-19 | Rate of req (07-22) |
|---|---|---|---|---|---|
| `context-spoils-answer` | **74** | 136 | 171 | 215 | **~5.9%** |
| `low-quality-reject` | 49 | 89 | 115 | 137 | ~3.9% |
| `cultural-issue` | 1 | ≤1 | — | — | — |
| `ambiguous` | **0** | 1 | 5 | ~50 | — |

**The absolute drop in `context-spoils-answer` is a volume artifact.** As a share of requested drafts the rate is flat: 4.4% (07-19) → 6.0% → 7.4% → **5.9%** (07-22). It remains the #1 reject reason for a **fifth straight day**, concentrated in DE connector/subordination surfaces — `de-a2-weil-deshalb` translation (21%, 15 rejects), the DE B2 `dass-equivalents`/`modal-connectors` cloze. The un-blanked clause keeps revealing the blanked connector. **The generation-prompt fix has not shipped** (git log shows no cloze-prompt change since #604), and today confirms it's still the clearest systemic quality issue left.

---

## Weakest cells (req ≥ 10)

The weak tail has **shifted from B1/B2 down into A1/A2 DE**. **Caveat (corrected):** low *daily* approval % here does **not** mean the pool is short — these points are already at/above target across their surfaces (e.g. `de-b1-n-declension` = 95 approved, `de-a2-adjective-declension-zero` = 54). The daily numbers are small top-ups churning against a saturated pool, so "weakest cell" = "lowest top-up yield today," not "under-served." Two failure modes:

**Bounded answer space (dedup ≈ rejects; the *day's* top-up saturates against already-generated content):**

| Cell | Req | Appr% | Rej | Dedup | Note |
|---|---|---|---|---|---|
| `de:a1:translation:de-a1-numbers-ordinals` | 20 | **25%** | 15 | 14 | Finite answer space |
| `de:a1:translation:de-a1-accusative` | 20 | **25%** | 13 | 13 | Dedup-exhausted |
| `de:a2:cloze:de-a2-measure-expressions` | 20 | **25%** | 13 | 13 | Dedup-exhausted |
| `de:b1:translation:de-b1-n-declension` | 21 | 43% | 11 | 11 | Chronic (dead on both surfaces all week) |
| `de:a1:cloze:de-a1-negation` | 20 | 55% | 9 | 9 | Small distinct space |

**Near-deterministic / validator-hard (dedup ≈ 0; rejects or flags dominate):**

| Cell | Req | Appr% | Rej | Flag | Note |
|---|---|---|---|---|---|
| `de:a2:conjugation:de-a2-adjective-declension-zero` | 23 | **17%** | 19 | 0 | Chronic (12% on 07-21) — near-deterministic endings |
| `de:a1:sentence_construction:de-a1-modal-verbs-present` | 20 | **20%** | 1 | **15** | **Flag-driven** — validator flags 15/20 drafts, not rejects |
| `de:a2:translation:de-a2-weil-deshalb` | 24 | **21%** | 15 | 4 | `context-spoils` (connector) — chronic (20% on 07-21) |
| `de:b2:cloze:de-b2-dass-equivalents` | 19 | 32% | 6 | 7 | Connector cloze — context-spoils + flags |
| `de:b2:cloze:de-b2-modal-connectors` | 20 | 35% | 4 | 9 | Same family |

`de-a1-modal-verbs-present` (SC, 15 flags / 1 reject) is the entry point to the real systemic issue below. `de-a2-adjective-declension-zero` and `de-b1-n-declension` re-ran because they're topped up nightly — not because `targetOverride` was "never applied" (their pools are full; no override is warranted).

---

## Correction & the real finding: SC validator over-flags `ambiguous`

Drilling into `de-a1-modal-verbs-present` (per request) reframes the whole "weak tail" story. The point is **not** short — it's well-covered on every surface except one:

| Surface | Approved | Flagged |
|---|---|---|
| translation | 19 | 1 |
| conjugation | 16 | 0 |
| cloze | 13 | 6 |
| **sentence_construction** | **4** | **15** |

Reading all 15 flagged SC drafts, there are **two distinct causes**, and the dominant one is systemic:

**1. The validator applies a single-answer/cloze ambiguity rubric to free production (dominant).** Every flagged SC draft carries `ambiguous`, and the validator's own notes concede the point — _"this is a production/sentence-construction task, so open-endedness is inherent, but the ambiguous flag is warranted…"_ — then flags anyway, repeatedly recommending _"convert to a cloze."_ For `sentence_construction`, multiple valid sentences is the definition of the task, not a defect.

Pool-wide confirmation (all-time, `flagged_reasons @> '[{"code":"ambiguous"}]'`):

| Type | Flagged | `ambiguous` | % |
|---|---|---|---|
| **sentence_construction** | 517 | **417** | **81%** |
| translation | 3,031 | 1,307 | 43% |
| cloze | 3,603 | 1,471 | 41% |
| vocab_recall | 441 | 127 | 29% |
| conjugation | 244 | 9 | **4%** |

SC (81%) vs deterministic conjugation (4%) is the rubric-mismatch signature — the validator penalizes open-endedness itself. It spans **31 grammar points across all 3 languages** (417 drafts), so this is a cross-cutting validator issue, not one bad cell. Of those 417, 65 are `ambiguous`-only (a hard floor on cleanly-recoverable), but 352 also carry `low-quality-flag` — and from the sample, `low-quality-flag` on SC is *itself* partly over-strict (nitpicking model answers for extra words / mixed modals / mixed polarity), so the true recoverable set is larger than 65. Exact yield needs an `eval:gen` measurement.

**2. A real generation bug — the "du" register-vs-subject confusion (minority, ~4/15).** Situation-mode prompts say _"reply to your friend as 'du'"_ (du = informal addressee/register) and the generator miscompiles it into **du as grammatical subject**, producing incoherent model answers (`Du musst heute Abend arbeiten.` as a reply to a party invite). One draft also leaks a `weil`-subordinate clause + `also`-coordination into A1 answers (`level-mismatch`). When the generator keeps du = register and answers in `ich`, the same surface **auto-approves** — so it's inconsistent generation, not a doomed surface.

---

## Recommendations

1. **Recalibrate the `sentence_construction` validation rubric — highest leverage, pool-wide.** Scope the `ambiguous` (and the model-answer-consistency side of `low-quality-flag`) checks to exercise type: for SC, multiple valid sentences and extra/optional words in model answers are expected, not defects. Reserve flags for a self-contradictory *prompt* or incoherent/off-target *model answers*. This recovers SC yield across 31 points / 3 languages, not just this cell. Bump `VALIDATION_PROMPT_VERSION`; measure recoverable yield with `eval:gen` on a few SC cells (`de-a1-modal-verbs-present`, and one TR/ES SC cell) before shipping. 65 `ambiguous`-only drafts are the floor; likely materially more once the `low-quality-flag` over-strictness is included.
2. **Fix the "du" register-vs-subject generation bug (real, secondary).** For situation-mode SC, keep register (`du` = informal addressee) distinct from grammatical subject person, or drop "address as du" framings for person-targeted points; constrain A1 model answers to a single main clause (no `weil`/`also`). Bump `GENERATION_PROMPT_VERSION`; mirror the ambiguity-scope change on both sides (generate↔validate contract).
3. **Fix `context-spoils-answer` on connector cloze — five-day trend, rate flat at ~6%.** Add a "the un-blanked clause must not reveal the blanked connector/modal" constraint to the cloze **generation** prompt, mirror it in **validation**, bump both versions, A/B with `eval:gen` on `de-a2-weil-deshalb` / `de-b2-dass-equivalents` / `de-b2-modal-connectors`. Still the clearest reject-side quality fix.
4. **Retracted: the 07-21 `targetOverride` rec.** The named cells' pools are already full; low daily approval is top-up churn, not under-service. No curriculum change needed.
5. **Nothing to do about the 63% approval itself** — expected maturation signature. Watch it doesn't fall below the hard-tail floor.
6. **Billing/failure monitoring still unaddressed** — standing rec: alarm on `status='failed'` generation jobs.
