# Generation Run Analysis — 2026-07-21

_Source: prod Neon branch `br-green-waterfall-ancrvpr5` (project `twilight-smoke-01114337`), `generation_jobs` + `exercises`._

## TL;DR

Fourth clean 120-cell run in a row — all succeeded, 0 failures, 1,192 approved, **$42.13**. The pool is now **deeply mature**: requested drafts fell again to **1,839** (from 2,863 → 4,940 over the prior two days), most cells topping up single-digit deficits.

Two things worth calling out:

- **The contrast-point cleanup (PRs #604/#605 + the demote) landed exactly as intended.** The three fixed points (`de-b2-subjective-modals`, `tr-b1-when-converbs`, `tr-b2-double-voice`) **did not run** — no off-surface cloze/SC regeneration, and `double-voice` translation sits at target. And the run-wide **`ambiguous` flag count collapsed to 1** (it was ~50 a week ago, 5 on 07-20) — direct evidence the contrast-point restrictions cleared the ambiguity load.
- **Approval slipped to 65% (TR 54%), but this is a composition effect, not a regression.** As the easy cells saturate, each run is increasingly the *hard residual tail* — dedup-exhausted narrow-morphology cells and connector cloze. `vocab_recall` still runs 77–92%; the drag is concentrated and identifiable.

The one systemic quality issue is now a **four-day trend**: `context-spoils-answer` is the #1 reject reason again (136), concentrated in DE connector cloze. It's overdue for the generation-prompt fix.

---

## Run overview

One scheduled run, **04:00:17 → 04:49:38 UTC** (~50 min), **120 cells, all `succeeded`**.

| | Cells | Requested | Produced | Approved | Flagged | Rejected | Dedup give-up | Cost |
|---|---|---|---|---|---|---|---|---|
| `succeeded` | 120 | 1,839 | 2,358 | **1,192** | 286 | 358 | 142 | **$42.13** |
| `failed` | 0 | — | — | — | — | — | — | — |

### Per-language

| Lang | Cells | Req | Appr | Appr% | Flag | Rej | Dedup | Cost |
|---|---|---|---|---|---|---|---|---|
| de | 50 | 1,327 | 897 | **68%** | 194 | 236 | 88 | $27.75 |
| tr | 47 | 373 | 201 | **54%** | 67 | 102 | 48 | $10.90 |
| es | 23 | 139 | 94 | **68%** | 25 | 20 | 6 | $3.48 |

TR (373 req / 47 cells ≈ 8/cell) and ES (139 / 23 ≈ 6/cell) are down to tiny top-ups — their pools are nearly saturated, so their approval numbers are dominated by small-sample noise and the hardest remaining cells. DE still carries the bulk of real volume (A2/A1 fill + B1/B2 top-ups).

### The maturation curve

| Day | Req | Approved | Appr% | Cost |
|---|---|---|---|---|
| 07-21 | **1,839** | 1,192 | 65% | **$42.13** |
| 07-20 | 2,863 | 2,065 | 72% | $56.35 |
| 07-19 | 4,940 | 3,719 | 75% | $95.08 |
| 07-18 | 3,000 | 2,201 | 73% | $66.26 |

Requested and cost keep falling at a constant 120 cells — the pool is converging on steady-state top-ups. Approval falls with it because the denominator is now the difficult tail, not because generation got worse.

---

## The contrast-point cleanup worked

Confirmation that this week's work landed:

- **`de-b2-subjective-modals`, `tr-b1-when-converbs`, `tr-b2-double-voice` did not generate today** — the `clozeUnsuitable` / `sentenceConstructionSuitable:false` flags (#604) route them off their bad surfaces, and `double-voice` translation (16 approved) is at its `targetOverride` of 15 (#605), so nothing re-enqueues. The 88-row demote left them serving only from valid surfaces.
- **`ambiguous` rejections run-wide: 1** (vs 50 on 07-17, 5 on 07-20). The contrast points were the dominant source of ambiguity; removing their bad surfaces cleared it.

---

## Rejection reasons

| Reason | n | 07-20 | 07-19 |
|---|---|---|---|
| `context-spoils-answer` | **136** | 171 | 215 |
| `low-quality-reject` | 89 | 115 | 137 |
| `seed-target-mismatch` | 8 | — | — |
| `ambiguous` | **1** | — | — |
| others (cultural, vowel-harmony, malformed) | ≤1 each | — | — |

`context-spoils-answer` remains #1 for the **fourth straight day**, concentrated in DE B2 connector/subordination cloze (`de-b2-causal-connectors` 46%, `de-b2-temporal-connectors` 54%, `de-b2-genitive-prepositions` 48%, `de-b2-word-formation` 56%) plus `de-a2-weil-deshalb` translation (20%). The un-blanked clause keeps revealing the connector. This is the clearest remaining systemic fix.

---

## Weakest cells — the dedup-exhausted residual

Every one of these is **structurally narrow** (dedup give-up ≥ rejects, or a tiny distinct-answer space), re-appears run after run, and **none is `targetOverride`'d yet**:

| Cell | Req | Appr% | Rej | Dedup | Note |
|---|---|---|---|---|---|
| `de:b1:conjugation:de-b1-n-declension` | 31 | **6%** | 29 | 14 | Narrow paradigm — chronic (6→30% range all week) |
| `de:a2:conjugation:de-a2-adjective-declension-zero` | 26 | **12%** | 23 | 0 | Near-deterministic endings, low distinct space |
| `de:b1:translation:de-b1-articles-use` | 37 | **19%** | 23 | 22 | Dedup-exhausted (22 give-up); chronic since 07-18 |
| `de:b1:translation:de-b1-n-declension` | 27 | 22% | 16 | 6 | Same point, other surface — both dead |
| `de:b1:translation:de-b1-two-way-prepositions` | 21 | 38% | 10 | 10 | Dedup-limited |
| `tr:b2:translation:tr-b2-participle-mis` | 15 | 40% | 7 | 7 | Dedup-limited |
| `de:b1:translation:de-b1-adjective-case-government` | 25 | 44% | 8 | 7 | Dedup-limited |

`de-b1-n-declension` is dead on **both** its surfaces (conjugation 6%, translation 22%) — the n-declension paradigm is just too small to reach 50. These are the exact `targetOverride` pattern from `double-voice`, generalized.

---

## Recommendations

1. **Batch-`targetOverride` the chronic dedup-exhausted cells (~15–20).** `de-b1-n-declension` (both cells), `de-a2-adjective-declension-zero`, `de-b1-articles-use`, `de-b1-two-way-prepositions`, `tr-b2-participle-mis`. They will never reach 50; each re-enqueues nightly and burns generation on dedup/reject. This is mechanical, low-risk, and the same call already made for `double-voice`/`de-b1-articles-use` (07-18). One curriculum PR + `CURRICULUM_VERSION` bump clears the recurring waste.
2. **Fix `context-spoils-answer` on connector cloze — now a four-day trend.** Add a "the un-blanked clause must not reveal the blanked connector/modal" constraint to the cloze **generation** prompt, mirrored in **validation** (generate↔validate contract), and bump both versions. Verify with `eval:gen` on `de-b2-causal-connectors` / `de-b2-temporal-connectors` before shipping (as with `double-voice`). This is the highest-value quality fix left.
3. **Nothing to do about the falling approval % itself** — it's the expected maturation signature (easy cells saturated → hard tail dominates). Watch that it doesn't fall *below* the hard-tail floor, but 65% at 120 cells with a shrinking request count is healthy convergence.
4. **The contrast-point cleanup is done — no follow-up.** Off-surface regen is gone, `ambiguous` is ~0, the demoted rows stay demoted. Consider the `double-voice` split (into single-construction sub-points) only if you want that point to carry a real pool; otherwise it's settled at its cap.
5. **Billing monitoring still unaddressed** — four clean runs, but nothing structural changed since 07-17. Standing rec: alarm on `status='failed'` generation jobs.
