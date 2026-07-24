# Generation Run Analysis — 2026-07-24

_Source: prod Neon branch `br-green-waterfall-ancrvpr5` (project `twilight-smoke-01114337`), `generation_jobs` + `exercises`._

## TL;DR

Seventh clean 120-cell run in a row — all succeeded, 0 failures, **426 approved**, **$19.21**, the cheapest and fastest run of the week (~25 min). The maturation curve holds: requested drafts fell to **663** (863 → 1,261 → 1,839 the prior three days), approval steady at **64%** (vs 63% yesterday). Pool total is **25,335 approved / 7,689 flagged** (35,401 rows).

The three things worth reading past the headline:

- **`sentence_construction` was again scheduled zero times — second straight day.** The eight under-target DE SC cells plus `tr-b2-double-voice` sit at **exactly** yesterday's approved counts (weil-deshalb 23, modal-verbs-present 15, konjunktiv-ii 49, …) — literal zero movement, because they never ran. The deficit-rank starvation described in the 07-23 doc is not self-correcting; it is now confirmed persistent. The corrected SC prompts (#606/#607) still have **zero** production drafts.
- **`context-spoils-answer` rejections fell 61 → 33**, but this is mostly **cell-mix, not a fix.** Yesterday's spike was one cell — `de-a2-adjective-declension-zero` on the *conjugation* surface (15 of 61) — which simply wasn't scheduled today. The adjective-declension family still leaks: `de-a2-adjective-declension-definite` (conjugation) threw 5 context-spoils, `-zero` (translation) 4. Today's single worst offender is `de-a2-seit-present` cloze at 6.
- **`ambiguous` is 0 rejections for a fourth straight day**, but there are **52 `ambiguous` flags** — and with SC absent, **all 52 are on cloze (39) / translation (9) / vocab (4)**. This is the *legitimate* cloze failure mode (open answer set — the blank accepts many equally-correct lexemes), not the SC-rubric mismatch that was fixed. It is diffuse across DE B1/B2 and worth a distinct look.

---

## Run overview

One scheduled run, **04:00:22 → 04:25:47 UTC** (~25 min — shortest yet), **120 cells, all `succeeded`**.

| | Cells | Requested | Produced | Approved | Flagged | Rejected | Dedup give-up | Cost |
|---|---|---|---|---|---|---|---|---|
| `succeeded` | 120 | 663 | 883 | **426** | 111 | 126 | 49 | **$19.21** |
| `failed` | 0 | — | — | — | — | — | — | — |

Approval% below = approved / requested (requested = the *decided* count: approved + flagged + rejected = 426 + 111 + 126 = 663). Cost per approved exercise ≈ **$0.045**.

### Per-language

| Lang | Cells | Req | Appr | Appr% | Flag | Rej | Dedup | Cost | Curriculum |
|---|---|---|---|---|---|---|---|---|---|
| de | 50 | 549 | 342 | **62%** | 101 | 106 | 43 | $13.83 | 2026-07-18 |
| es | 50 | 68 | 52 | **76%** | 6 | 10 | 2 | $3.52 | 2026-07-20 |
| tr | 20 | 46 | 32 | **70%** | 4 | 10 | 4 | $1.86 | 2026-07-20a |

**The ES over-allocation from yesterday got worse.** ES took **50** cells (was 46) but requested only **68 drafts** — 12 ES A2 cells asked for exactly **1 draft each** (12 req total, 12 approved), and 21 ES B1 cells asked for **25** drafts between them. DE (50 cells) absorbed **549 of the run's 663** requested (83%). The 120-cell budget is spending a third of its slots on a saturated ES pool with nothing left to generate, while DE's 50-cell cap is over-subscribed. This is the same fair-share imbalance flagged 07-23, one notch further along.

### Per-level

| | de a1 | de a2 | de b1 | de b2 | es a1 | es a2 | es b1 | es b2 | tr a1 | tr a2 | tr b1 | tr b2 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cells | 6 | 12 | 16 | 16 | 3 | 12 | 21 | 14 | 12 | 2 | 3 | 3 |
| req | 63 | 131 | 173 | 182 | 16 | 12 | 25 | 15 | 24 | 3 | 7 | 12 |
| appr | 31 | 81 | 103 | 127 | 6 | 12 | 21 | 13 | 18 | 2 | 6 | 6 |

### The maturation curve

| Day | Req | Approved | Appr% | Cost | Runtime |
|---|---|---|---|---|---|
| 07-24 | **663** | 426 | 64% | **$19.21** | **25 min** |
| 07-23 | 863 | 541 | 63% | $23.08 | 34 min |
| 07-22 | 1,261 | 797 | 63% | $31.69 | 41 min |
| 07-21 | 1,839 | 1,192 | 65% | $42.13 | — |
| 07-20 | 2,863 | 2,065 | 72% | $56.35 | — |

Requested has fallen ~4.3× in four days at constant 120 cells; approval is flat at 63–64% for three days running. This is a converged pool: the residual tail is stable in composition, not still degrading. Cost has more than halved since 07-20.

---

## Sentence construction: still invisible (day 2)

SC ran **zero** cells again. The under-target SC cells are **byte-identical** to yesterday's snapshot — proof the cause is scheduling starvation, not saturation:

| Cell | Approved | Target | Need | vs 07-23 |
|---|---|---|---|---|
| `de-a1-modal-verbs-present` | 15 | 20 | 5 | unchanged |
| `de-a2-passive-present` | 28 | 30 | 2 | unchanged |
| `de-a2-perfekt-with-haben` | 25 | 30 | 5 | unchanged |
| `de-a2-praeteritum-modals` | 26 | 30 | 4 | unchanged |
| `de-a2-weil-deshalb` | 23 | 30 | 7 | unchanged |
| `de-b1-plusquamperfekt-nachdem` | 49 | 50 | 1 | unchanged |
| `de-b1-subordinate-conjunctions` | 47 | 50 | 3 | unchanged |
| `de-b2-konjunktiv-ii` | 49 | 50 | 1 | unchanged |
| `tr-b2-double-voice` | 14 | 15 (`targetOverride`) | 1 | unchanged |

`selectCellsWithinCaps` ranks strictly by `need` descending; DE's 50-cell fair-share went to cells requesting 10–19 drafts each, so every small-need SC cell (need 1–7) was deferred for a second night. **The corrected SC prompts (#606/#607) have generated zero production drafts.** The `eval:gen` 78% → 94% result remains the only evidence they work under real traffic. TR B2 stays structurally frozen at 14/15 (`targetOverride`, #605) — only the double-voice split fixes it.

This confirms the 07-23 prediction: pure `need`-descending ranking indefinitely starves near-complete cells behind chronic high-deficit ones. Recommendation #6 from yesterday (reserve slots for need ≤ 5, or add a recent-approval-rate penalty) is now two-days-validated and should be prioritized.

---

## Rejection reasons

| Reason | n (07-24) | 07-23 | 07-22 | Rate of req (07-24) |
|---|---|---|---|---|
| `low-quality-reject` | **47** | 53 | 49 | **7.1%** |
| `context-spoils-answer` | **33** | 61 | 74 | **5.0%** |
| `ambiguous` | **0** | 0 | 0 | — |
| `cultural-issue` | 0 | 1 | 1 | — |

`low-quality-reject` overtook `context-spoils-answer` as the #1 reject reason for the first time in a week — but by attrition of the latter, not a rise in the former (47 is down from 53). Both movements are within cell-mix noise.

### `context-spoils` broken out by exercise type

| Type | ctx (07-24) | of req | 07-23 rate |
|---|---|---|---|
| conjugation | 5 | **23%** (5/22) | 23% |
| vocab_recall | 5 | 6.7% (5/75) | 8.6% |
| translation | 10 | 4.2% (10/237) | 6.0% |
| cloze | 13 | 4.0% (13/329) | 4.0% |

Conjugation is again the worst *rate* (23%), driven entirely by `de-a2-adjective-declension-definite` (5 of the surface's 5). Translation improved (6.0% → 4.2%). The **adjective-declension family remains the standing defect**: `-definite` (conjugation, 5), `-zero` (translation, 4). Top individual cell today is `de-a2-seit-present` cloze at 6 context-spoils — the un-blanked clause is presumably fixing the time-span that `seit` + present is meant to test. These carrier phrases leak the answer and want an `eval:gen` read (rejected drafts aren't persisted).

---

## Flags — `ambiguous` on cloze is the real signal now

Flag tags on the 111 flagged rows persisted today (a row can carry several):

| Flag code | n |
|---|---|
| `low-quality-flag` | 108 |
| `ambiguous` | **52** |
| `grammar-point-mismatch` | 20 |
| `level-mismatch` | 9 |

The **52 `ambiguous` flags** (7.8% of req, vs 55 / 6.4% on 07-23) are — with SC absent — **entirely on cloze (39), translation (9), and vocab (4)**. Reading the `validator-note` details, these are legitimate: the cloze blank accepts many equally-correct lexemes (e.g. `de-a1-zero-article`: _"the blank accepts Obst, Brot, Käse, Fleisch, Fisch, Reis… better suited as multiple-choice than free-fill"_) or a structurally-different valid rendering isn't enumerated in `acceptableAnswers` (`de-a2-adjective-declension-zero`: `wegen schlechtem Wetter` dative alternative unlisted).

Spread of the 52 (top cells): `de-b1-comparison-attributive` cloze 4, `de-a2-adjective-declension-zero` translation 4, `de-a1-zero-article` cloze 3, `de-b1-progressive-equivalents` cloze 3, `de-b2-temporal-connectors` translation 3, `de-b2-zustandspassiv` cloze 3, `de-b1-es-expressions` cloze 3 — then a long DE B1/B2 tail. This is **distinct** from the SC over-flag that #606 fixed: it is the open-answer-set problem, and the fix is either (a) tighten the carrier sentence to force one lexeme, or (b) widen `acceptableAnswers`. Worth an `eval:gen` pass on `de-a1-zero-article` / `de-b1-comparison-attributive` to decide which.

---

## Weakest cells (req ≥ 10)

| Cell | Req | Appr% | Flag | Rej | Dedup | Dominant reason |
|---|---|---|---|---|---|---|
| `de:b1:translation:de-b1-n-declension` | 12 | **0%** | 1 | 11 | 2 | `low-quality-reject` ×9 |
| `de:a1:cloze:de-a1-zero-article` | 12 | 17% | 3 | 7 | 5 | `context-spoils` ×2 + dedup |
| `de:a1:conjugation:de-a1-present-regular` | 10 | 30% | 4 | 3 | 1 | `low-quality-reject` ×2 |
| `de:a2:conjugation:de-a2-adjective-declension-definite` | 10 | 30% | 1 | 6 | 0 | `context-spoils` ×5 |
| `de:a2:translation:de-a2-adjective-declension-zero` | 12 | 33% | 4 | 4 | 0 | `context-spoils` ×4 |
| `de:a2:cloze:de-a2-seit-present` | 12 | 33% | 1 | 7 | 0 | `context-spoils` ×6 |
| `de:b1:translation:de-b1-comparison-attributive` | 10 | 40% | 4 | 2 | 2 | Flag-driven |
| `de:b2:translation:de-b2-zustandspassiv` | 10 | 40% | 1 | 5 | 5 | Dedup + reject |
| `de:b1:cloze:de-b1-progressive-equivalents` | 12 | 42% | 4 | 3 | 0 | `low-quality` ×3 + flag |
| `de:b2:cloze:de-b2-genitive-prepositions` | 12 | 42% | 4 | 3 | 0 | `low-quality` ×3 + flag |

Same caveat as prior days: low *daily* approval% on a topped-up cell is churn against a full pool, not under-service. `de-b1-n-declension` translation at 0% (9 of 11 rejected `low-quality`) is the one true outlier and echoes the same family's cloze surface flagged 07-23 — the n-declension point looks genuinely hard to generate cleanly on both surfaces. The B1/B2 flag-driven cells (`comparison-attributive`, `progressive-equivalents`, `genitive-prepositions`) are the same `ambiguous`/`low-quality-flag` cluster discussed above.

---

## Recommendations

1. **Fix the deficit-rank starvation — now two-days-confirmed.** Nine SC cells (need 1–7) have been deferred two nights running with zero movement, behind chronic DE cells that *can't* close a 10–19 deficit. Add a secondary ranking term: reserve a few slots per run for near-complete cells (need ≤ 5) — they close permanently for a handful of drafts — or penalize by recent approval *rate* so cells that keep failing stop re-winning the slot. This is the single highest-leverage scheduler change; without it the corrected SC prompts never see production traffic.
2. **Rebalance the language fair-share cap.** ES took 50 of 120 cells to request 68 drafts (12 cells at 1 draft each); DE absorbed 549 requested against a 50-cell cap. The 120-cell budget is no longer binding — the split is handing slots to a saturated pool. Either lower the per-language floor when a language's cells are near-saturated, or let DE's cap flex up when ES/TR have nothing to fill.
3. **Fix the adjective-declension carrier phrases (standing item, 3rd day).** `de-a2-adjective-declension-definite` (conjugation, 23% context-spoils) and `-zero` (translation) leak the ending being drilled. `eval:gen` on both, then constrain the carrier so the sentence doesn't reveal the target ending. Add `de-a2-seit-present` (6 context-spoils today) to the same batch — the time-span phrase is spoiling the tense.
4. **Decide the cloze `ambiguous`-flag policy.** 39 of 52 `ambiguous` flags are open-answer-set cloze (many valid lexemes) or unlisted-valid-alternative translation. This is legitimate validator behavior, so it won't clear with a rubric tweak like SC did — it needs either tighter carrier sentences (force one lexeme) or wider `acceptableAnswers`. `eval:gen` on `de-a1-zero-article` / `de-b1-comparison-attributive` to pick the lever.
5. **Split `tr-b2-double-voice`** into separate voice points (already-identified durable fix) — it is structurally frozen at 14/15 and is the only TR B2 SC point.
6. **Billing/failure monitoring still unaddressed** — standing rec: alarm on `status='failed'` generation jobs (7 clean runs is luck, not coverage).
