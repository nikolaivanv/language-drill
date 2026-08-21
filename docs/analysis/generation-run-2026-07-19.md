# Generation Run Analysis — 2026-07-19

_Source: prod Neon branch `br-green-waterfall-ancrvpr5` (project `twilight-smoke-01114337`), `generation_jobs` + `exercises`. Scheduler constants from `infra/lambda/src/generation/scheduler.ts`; curriculum versions from `packages/db/src/curriculum/{de,es,tr}.ts`._

## TL;DR

A **clean, healthy run** — the first since the two infra changes landed. One scheduled run at 04:00 UTC, **120 cells, all `succeeded`, 0 failures, 3,719 approved, $95.08**. Two things worked exactly as designed:

- **The 2× run cap (120) + per-language fair-share cap (50/lang) from PR #601 are live.** The run split **DE 50 / TR 49 / ES 21** — German no longer monopolizes the queue. On 07-18 the run was **100% German**; today all three languages generated in the same night.
- **No billing failure.** After two outages in five days (07-13, 07-17), credit held for the full 90-minute run.

Quality is steady: **ES 87%**, **TR 74%**, **DE 73%** approval of requested. The two sub-75% languages are dominated by freshly-activated B2 book-coverage points on their first/second fill pass, exactly as expected.

**The one real problem is a starvation bug one level down from the one #601 fixed:** `tr-a1-gore-bence` — an **A1** point with a shipped fix (#600) and **zero approved content live** — still didn't run. TR's 50-cell fair share was consumed 27-of-49 by the B2 (Yedi İklim) expansion, whose per-cell deficit (50) outranks A1's (≈19) in the water-fill. The per-language cap stopped cross-_language_ starvation but not cross-_level_ starvation within a language.

---

## Run overview

One scheduled run, **04:00:16 → 05:30:52 UTC** (~90 min), **120 cells, all `succeeded`**.

| | Cells | Requested | Produced | Approved | Flagged | Rejected | Dedup give-up | Cost |
|---|---|---|---|---|---|---|---|---|
| `succeeded` | 120 | 4,940 | 5,633 | **3,719** | 715 | 497 | 159 | **$95.08** |
| `failed` | 0 | — | — | — | — | — | — | — |

Approval of requested: **75%** (3,719/4,940). In line with 07-18's 73% — both are first/second-fill runs weighted toward freshly-activated B1/B2 points, below the ES/TR steady-state (~82%).

### Per-language split — the fair-share cap working

| Lang | Cells | Req | Appr | Appr% | Flag | Rej | Dedup | Cost |
|---|---|---|---|---|---|---|---|---|
| de | 50 | 2,264 | 1,646 | **73%** | 387 | 230 | 63 | $42.43 |
| tr | 49 | 2,024 | 1,505 | **74%** | 268 | 243 | 94 | $41.65 |
| es | 21 | 652 | 568 | **87%** | 60 | 24 | 2 | $11.00 |

DE and TR both hit the **50-cell per-language cap** (`DEFAULT_MAX_CELLS_PER_LANGUAGE = 50`); ES offered only 21 under-target cells, so it took all of them. Total 120 = `DEFAULT_MAX_CELLS_PER_RUN`.

### Language × level × type

| Lang | Level | Type | Cells | Req | Appr | Appr% |
|---|---|---|---|---|---|---|
| de | a1 | vocab_recall | 1 | 30 | 25 | 83% |
| de | a2 | cloze | 8 | 240 | 184 | 77% |
| de | b1 | cloze / translation | 2 | 98 | 89 | 91% |
| de | b1 | conjugation | 1 | 35 | 4 | **11%** |
| de | b1 | sentence_construction | 1 | 31 | 20 | 65% |
| de | b2 | translation | 24 | 1,199 | 936 | 78% |
| de | b2 | cloze | 12 | 581 | 350 | **60%** |
| de | b2 | sentence_construction | 1 | 50 | 38 | 76% |
| es | a1 | cloze / translation | 2 | 50 | 47 | 94% |
| es | a2 | cloze | 3 | 90 | 59 | 66% |
| es | a2 | translation | 5 | 150 | 121 | 81% |
| es | a2/b1/b2 | vocab_recall | 8 | 212 | 205 | **97%** |
| es | b1 | cloze | 1 | 50 | 49 | 98% |
| es | b2 | translation | 2 | 100 | 87 | 87% |
| tr | a1 | cloze / conjugation / translation | 3 | 90 | 74 | 82% |
| tr | a2 | cloze | 4 | 120 | 104 | 87% |
| tr | a2 | translation | 6 | 180 | 139 | 77% |
| tr | b1 | cloze | 2 | 100 | 64 | 64% |
| tr | b1 | sentence_construction | 2 | 75 | 37 | **49%** |
| tr | b1 | translation | 3 | 150 | 125 | 83% |
| tr | b2 | translation | 17 | 850 | 634 | 75% |
| tr | b2 | cloze | 3 | 150 | 92 | **61%** |
| tr | b2 | conjugation | 2 | 100 | 78 | 78% |
| tr | b2 | sentence_construction | 1 | 50 | 22 | **44%** |
| tr | a2–b2 | vocab_recall | 6 | 191 | 161 | 84% |

**vocab_recall is flowing now.** 07-18 flagged it as "fully wired, just starved"; today 15 vocab_recall cells generated across all three languages at **83–98%** — the highest-approval type in the run. The per-language cap gave the lower-deficit vocab cells room to run.

---

## Rejection & flag reasons

| Rejection reason | n |
|---|---|
| `context-spoils-answer` (cloze answer leaked by context) | 215 |
| `low-quality-reject` | 137 |
| `cultural-issue` | 4 |
| `vowel-harmony-allomorph` | 1 |

`context-spoils-answer` at 215 is the dominant reject reason and it is **concentrated in B2 connector/subordination cloze** — `de-b2-modal-connectors`, `de-b2-temporal-connectors`, `de-b2-dass-equivalents`, `tr-b2-compound-past-hikaye`. This is the same signature 07-18 called out on DE cloze (109 then); it grew because more connector cloze cells ran. On a cloze for a connector/subordinator, the un-blanked clause half routinely reveals the answer. **This is now a two-day trend and warrants a prompt fix**, not just watching (see rec #3).

---

## Weakest cells

| Cell | Req | Appr% | Rej | Dedup | Diagnosis |
|---|---|---|---|---|---|
| `de:b1:conjugation:de-b1-n-declension` | 35 | **11%** | 30 | 24 | Structurally narrow — dedup-exhausted. Was 30% on 07-18, now 11%. **`targetOverride` candidate — will never reach 50.** |
| `tr:b2:translation:tr-b2-double-voice` | 50 | **18%** | 27 | 1 | New B2 point; also 44% in SC form. Both surfaces weak → point-level issue, not surface-specific. |
| `de:b2:cloze:de-b2-modal-connectors` | 50 | 32% | 0 | 0 | All loss is flags (`context-spoils`), 0 rejects. |
| `tr:b2:cloze:tr-b2-compound-past-hikaye` | 50 | 36% | 9 | 0 | New B2, flag-heavy. |
| `de:b2:cloze:de-b2-subjective-modals` | 50 | 36% | 9 | 0 | Flag-heavy. |
| `tr:b1:cloze:tr-b1-when-converbs` | 50 | 42% | 2 | 0 | Recurring — 74% cloze on 07-17; ambiguity persists on the converb surface. |
| `tr:b1:sentence_construction:tr-b1-reason-digi-icin` | 25 | 44% | 4 | 0 | **Third weak showing** — flagged on 07-17 (50%). Now a confirmed trend; `eval:gen` warranted (see rec #4). |

`de-b1-n-declension` and `tr-b2-double-voice` are the two structural outliers. The rest are first/second-pass connector/modal cells whose flag rate should fall as the pool matures — except the two recurring TR points below B2.

---

## The starvation bug: `tr-a1-gore-bence` is still empty

The PR #600 `acceptableAnswers` fix for `tr-a1-gore-bence` (person-collapse) shipped, `CURRICULUM_VERSION_TR` was bumped to `2026-07-18` (today's 49 TR jobs all carry it), and the 7 stale cloze rows were demoted. **Yet the cell still has zero approved content and did not run today.**

Current live state of `tr-a1-gore-bence`:

| Type | flagged | rejected | **auto-approved** |
|---|---|---|---|
| cloze | 42 | 7 | **0** |
| translation | 32 | 20 | **0** |

Last successful generation job for this cell: **2026-06-15** — 34 days ago. It was not `skip-low-yield`-suppressed (the version bump cleared that, and other TR cells re-enqueued fine). It lost the **water-fill deficit race** inside TR's own fair share:

- TR's 50 slots split **A1=3, A2=11, B1=8, B2=27**. All three A1 slots went to `tr-a1-future`.
- A1 target is 20 → `gore-bence` deficit ≈ **19**. B2 target is 50 → a fresh Yedi İklim B2 cell deficit ≈ **50**. The scheduler sorts under-target cells by `need = target − approved` **descending**, so every empty B2 cell outranks every A1 top-up.

This is the **[scheduler water-fill starves lower targets]** pattern, now visible _within_ a language. PR #601's per-language cap fixed cross-language starvation (DE vs TR/ES) but the same mechanism operates one level down: a B2 curriculum expansion monopolizes its language's fair share and parks A1/A2 top-ups — including a shipped fix for a point that is **completely empty at A1**, the level most likely to be hit by a beginner.

Every night the TR B2 backlog stays non-empty, `gore-bence` waits. At ~27 B2 cells/night needing ~1.5 passes each, that is several more nights minimum.

---

## Daily trend

| Day | Langs | Cells (ok/fail) | Approved | Cost | Note |
|---|---|---|---|---|---|
| **07-19** | **de+es+tr** | **120 / 0** | **3,719** | **$95.08** | First run under 120-cap + fair-share; all 3 langs |
| 07-18 | de only | 60 / 0 | 2,201 | $66.26 | 100% German (pre-fair-share) |
| 07-17 | es+tr | 17 / **43** | 661 | $16.15 | Billing death (credit exhausted) |
| 07-16 | es+tr | 60 / 0 | 237 | $9.34 | |
| 07-15 | es+tr | 60 / 0 | 129 | $8.46 | |
| 07-14 | es+tr | 60 / 0 | 159 | $11.24 | |
| 07-13 | es+tr | 6 / **54** | 23 | $2.05 | Billing death (spend cap) |

The 120-cap roughly doubled nightly throughput and cost as intended (~$95 vs the ~$66 all-German 60-cell run). At this burn, budget **~$90–100/night** while the DE B2 + TR B2 expansions clear.

---

## Recommendations

1. **Fix cross-level starvation so `gore-bence` (and other empty A1/A2 points) can't be parked behind a B2 expansion indefinitely.** The per-language cap didn't reach this. Options, cheapest first:
   - **One-off manual trigger** for the handful of empty low-level cells (`aws lambda invoke` with an explicit cell list) — unblocks `gore-bence` tonight without a code change.
   - **A small floor in the scheduler**: reserve a few slots per language for the highest-deficit A1/A2 cells, or rank by `need / target` (fraction of target unmet) instead of absolute `need`, so an empty A1 cell (100% unmet) isn't outranked by a half-full B2 cell. This is the durable fix — same shape as the `[scheduler-waterfill-starves-lower-targets]` memory.
2. **`targetOverride` the dedup-exhausted DE cell.** `de-b1-n-declension` (11%, 24 dedup give-up, 30 reject) is structurally narrow and will never reach 50 — it re-enqueues and burns requests every night. Drop its target to ~15–20. (Same call as 07-18's `de-b1-articles-use`.)
3. **Fix `context-spoils-answer` on connector/subordination cloze — now a two-day trend (109 → 215).** The DE/TR B2 connector cloze cells leak the blank via the un-blanked clause. Add a "the rest of the sentence must not reveal the blanked connector" reinforcement to the cloze generation prompt, **mirrored in the validation prompt** (generate↔validate contract), and bump both prompt versions.
4. **`eval:gen` on `tr-b1-reason-digi-icin` (SC) and `tr-b2-double-voice`.** `reason-digi-icin` SC is now weak three showings running (50% → 44%); one run was "not yet a trend," three is. `double-voice` fails on both translation (18%) and SC (44%) — a point-level fix, likely a coverageSpec or curriculum-description problem, not a surface prompt.
5. **Billing monitoring still unaddressed.** Today succeeded on credit that held; nothing structural changed since 07-17. The standing rec holds: emit a CloudWatch metric on `status='failed'` generation jobs and alarm when a run's failure count exceeds a threshold. Two of the last seven runs died silently to billing.
6. **No action needed on throughput or the fair-share cap — they are working.** The 120-cap + 50/lang split is doing exactly what 07-18 recommended (option: "split the nightly run by language"). Leave it.
