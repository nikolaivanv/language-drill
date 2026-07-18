# Generation Run Analysis — 2026-07-18

_Source: prod Neon branch `br-green-waterfall-ancrvpr5` (project `twilight-smoke-01114337`), `generation_jobs` + `exercises`. Curriculum denominators from `packages/db/src/curriculum/{de,es,tr}.ts` (grammar-point enumeration via `compatibleTypes`)._

## TL;DR

The billing outage is **over** — credit was restored and the **04:00 UTC run completed all 60 cells cleanly, $66.26 spent, 2,201 approved** (the large recovery run predicted on 07-17). No failures.

But the run was **100% German B1/B2** — the scheduler correctly water-filled the emptiest cells, and after the DE book-coverage expansion those are the emptiest in the whole curriculum. This means:

- **The TR/ES translation refill did _not_ run today.** The PR #600 `gore-bence` cleanup is still waiting on a nightly regen that keeps getting out-prioritized by German.
- DE B1/B2 went from ~empty to ~23 B1 points + 12 B2 points with pool, but **at only ~73% first-pass approval, most DE cells are still below their 50-target** and will re-enqueue tomorrow.

**Pool completeness (grammar-drill cells): ~35% at target, ~30% started-but-thin, ~35% never generated**, plus **English is entirely unauthored** (no `en.ts` curriculum at all).

---

## Run overview

One scheduled run at **04:00 UTC**, **60 cells, all `succeeded`**, 04:00:16 → 04:51:00.

| | Cells | Requested | Produced | Approved | Flagged | Rejected | Dedup give-up | Cost |
|---|---|---|---|---|---|---|---|---|
| `succeeded` | 60 | 3,000 | 3,525 | **2,201** | 422 | 373 | 131 | **$66.26** |
| `failed` | 0 | — | — | — | — | — | — | — |

Approval of requested: **73%** (2,201/3,000). This is a first-fill run of freshly-activated German points, so 73% is respectable but below the ES/TR steady-state (~82%).

### Everything was German

| Lang | Level | Type | Cells | Req | Appr | Appr% | Flag | Rej |
|---|---|---|---|---|---|---|---|---|
| de | b1 | cloze | 21 | 1,050 | 786 | 75% | 161 | 101 |
| de | b1 | translation | 22 | 1,100 | 831 | 76% | 116 | 152 |
| de | b1 | sentence_construction | 4 | 200 | 138 | 69% | 39 | 22 |
| de | b1 | conjugation | 2 | 100 | 51 | 51% | 17 | 32 |
| de | b2 | cloze | 11 | 550 | 395 | 72% | 89 | 66 |

### Rejection reasons

| Reason | n |
|---|---|
| `low-quality-reject` | 142 |
| `context-spoils-answer` (cloze answer leaked by context) | 109 |
| `cultural-issue` | 2 |

`context-spoils-answer` at 109 is high — expected when cloze cells for connector/subordination points (`dass-equivalents`, `subordinate-conjunctions`, `causal-connectors`) are generated for the first time; the other clause half often leaks the blank.

### Weakest DE cells (first-pass)

| Cell | Appr% | Rej | Dedup give-up | Note |
|---|---|---|---|---|
| `de:b1:translation:de-b1-articles-use` | **26%** | 32 | **30** | Tiny distinct space — dedup-exhausted, won't reach 50 |
| `de:b1:conjugation:de-b1-n-declension` | 30% | 31 | 17 | Narrow paradigm — dedup-limited |
| `de:b2:cloze:de-b2-dass-equivalents` | 36% | 22 | 0 | `context-spoils` dominated |
| `de:b1:sentence_construction:de-b1-um-zu-damit` | 38% | 21 | 0 | |
| `de:b1:cloze:de-b1-subordinate-conjunctions` | 40% | 25 flag | 5 | Flag-heavy, not reject-heavy |

`de-b1-articles-use` and `de-b1-n-declension` are structurally narrow (dedup give-up ≥ reject) — candidates for a `targetOverride` down from 50 rather than a prompt fix.

---

## Why the run was all German — and why TR/ES got starved

The scheduler (`infra/lambda/src/generation/scheduler.ts`) enumerates **every** curriculum cell, sorts under-target cells by `need = target − approved` **descending**, and enqueues the top **60** (`DEFAULT_MAX_CELLS_PER_RUN`). There is **no language/level enrollment gate** — it's pure water-fill by deficit.

Two facts combine to make German monopolize the run:

1. **DE B1/B2 book-coverage points were recently activated with ~zero pool.** Empty B1/B2 cloze/translation cells carry the maximum deficit: **`need = 50`** (target `B1/B2 = 50`, `A1 = 20`, `A2 = 30` — `cell-targets.ts`).
2. There are **≥60 empty DE B1/B2 cells**, so they fill all 60 slots before the sort ever reaches a TR/ES top-up cell (which has `need < 50` because it's already partly filled).

So the ES/TR pools — including the PR #600 translation refill — are **deferred every night until DE B1/B2 is saturated**. That will take multiple nights, because each 50-target cell only yields ~37 approved per pass (73% × 50), so every DE cell needs a **second** pass to top up.

### Daily rotation, last 6 days

| Day | Langs run | Cells (ok/fail) | Approved | Cost |
|---|---|---|---|---|
| 07-18 | **de only** | 60 / 0 | 2,201 | $66.26 |
| 07-17 | es + tr | 17 / **43** | 661 | $16.15 (billing death) |
| 07-16 | es + tr | 60 / 0 | 237 | $9.34 |
| 07-15 | es + tr | 60 / 0 | 129 | $8.46 |
| 07-14 | es + tr | 60 / 0 | 159 | $11.24 |
| 07-13 | es + tr | 6 / **54** | 23 | $2.05 (billing death) |

07-18 is the first all-German day — the DE curriculum expansion flipped the deficit ranking overnight.

---

## What part of the pool is yet to be generated

Grammar-drill cells only (cloze + translation + sentence_construction + conjugation). Denominators from curriculum; fill from `exercises` (approved). Level targets: A1=20, A2=30, B1/B2=50 (ignores per-point `coverageSpec` floors / `targetOverride`, so deficits are lower bounds).

### Coverage matrix

| Lang | Level | Enum. cells | Started | At target | Started deficit | Status |
|---|---|---|---|---|---|---|
| **DE** | A1 | 45 | **0** | 0 | — | **Never generated** |
| **DE** | A2 | 70 | 2 | 0 | 58 | **~Empty** |
| DE | B1 | 58 | 51 | 1 | **742** | Started today, needs top-up + 7 empty |
| DE | B2 | 51 | 13 | 0 | 253 | **Cloze only** — all 27 translation + 1 SC cells empty |
| **ES** | A1 | 49 | 37 | 24 | 64 | 12 cells not started |
| ES | A2 | 74 | 67 | 33 | 138 | Healthiest mid-tier |
| ES | B1 | 60 | 59 | 37 | 59 | ~Complete |
| ES | B2 | 65 | 63 | 42 | 43 | **Most complete block** |
| TR | A1 | 61 | 46 | 37 | 67 | 15 cells not started |
| TR | A2 | 51 | 47 | 32 | 183 | Top-up backlog |
| TR | B1 | 38 | 32 | 23 | 94 | 6 cells not started |
| **TR** | B2 | 23 | **0** | 0 | — | **Never generated** |

**Top-line (645 enumerated grammar-drill cells):** ~229 at target (**35%**), ~188 started-but-below (**29%**), ~228 never started (**35%**).

### The gaps, in priority order

1. **English — entirely unauthored.** No `en.ts` curriculum exists; the only EN rows in `exercises` are the 36 seed placeholders. This is a **content-authoring** gap, not a generation backlog — nothing will generate until the curriculum is written.
2. **DE A1 (45 cells) + A2 (~68 cells) — zero pool, and structurally last in line.** Because their targets are 20/30 (< B1/B2's 50), they can only start generating **after** DE B1/B2 saturates. Left alone, German lower levels may wait a week+.
3. **DE B2 translation + sentence_construction — never generated** (only cloze has run). ~28 empty cells.
4. **TR B2 (23 cells) — zero pool.** 16 grammar points + 1 vocab-heavy; no exercises at all.
5. **DE B1/B2 top-up.** Today's cells sit at ~37/50; a second pass tomorrow (if DE keeps winning the sort) lands them near target. Deficit ~1,000.
6. **TR/ES top-ups (deficit ~650 total)** — including the **PR #600 translation refill**, which is blocked behind German.
7. **DE vocab_recall — fully wired, just starved (NOT unbuilt).** PRs #593/#594 shipped the curriculum half (20 DE umbrellas) and the data half is seeded in prod (**521 approved `vocab_target` rows across all 20 umbrellas**). The 20 vocab_recall cells enumerate with coverage-aware `need ≈ 26` each (uncovered approved targets) — above DE A1 grammar, below DE B1/B2 grammar (need 50), so they defer in the same water-fill starvation. Owed ≈ one exercise per approved target (~500), not 200. DE has no dictation / free-writing / paraphrase curriculum kinds, so those aren't owed.

### Rough remaining volume

At 73% first-pass yield and ~$1/cell, clearing the **German** backlog alone (A1+A2+B1-topup+B2-translation ≈ 220 cells × ~1.5 passes) is **~$300–350 over ~6 nights** at 60 cells/night. TR B2 + TR/ES top-ups add ~$100 more.

---

## Recommendations

1. **Decide whether German should monopolize the queue for a week.** The water-fill is working as designed, but it silently parked every TR/ES top-up — including a shipped fix (#600) — behind the DE expansion. Options:
   - **Do nothing** — DE fills first, TR/ES resume once DE B1/B2 saturates (~2–3 more nights). Simplest; the #600 refill just waits.
   - **Raise `SCHEDULER_MAX_CELLS_PER_RUN`** temporarily (e.g. 100–120) so DE and the TR/ES top-ups both run — at higher nightly spend (~$70–100).
   - **Split the nightly run by language** (a per-language sub-cap) so no single curriculum expansion can starve the others. This is the durable fix and worth a small scheduler change.
2. **`targetOverride` the dedup-exhausted DE cells** — `de-b1-articles-use` (30 dedup give-up), `de-b1-n-declension`. They will never reach 50; a 20–25 target stops them re-enqueuing forever and burning requests.
3. **Watch `context-spoils-answer` on DE cloze** — 109 rejects concentrated in connector/subordination points. If it persists on the second pass, the DE cloze generation prompt needs a "don't let the other clause reveal the blank" reinforcement (mirror in validation per the generate↔validate contract).
4. **Author an EN curriculum** if English is meant to ship — it is currently a learning-language option with no content behind it.
5. **Billing monitoring still unaddressed** — today succeeded only because credit was topped up by hand. The 07-17 recommendation stands: alarm on `status='failed'` generation jobs; nothing pages when a run dies.
