# Generation Run Analysis — 2026-07-23

_Source: prod Neon branch `br-green-waterfall-ancrvpr5` (project `twilight-smoke-01114337`), `generation_jobs` + `exercises`._

## TL;DR

Sixth clean 120-cell run in a row — all succeeded, 0 failures, **541 approved**, **$23.08**, the cheapest run of the week. The maturation curve continues on trend: requested drafts fell to **863** (1,261 → 1,839 → 2,863 the prior three days), approval held at **63%** (62.7%, vs 63% yesterday). Run time was the shortest yet (34 min).

The single most important observation is a **negative** one:

- **Zero `sentence_construction` cells were scheduled today.** The SC prompt fixes (#606 validate / #607 generate) shipped and Langfuse synced on 07-22, so today was their first nightly run — but the 07-22 `revalidate:sc-promote` pass (431 flagged SC drafts → `manual-approved`) collapsed every SC cell's `need` to 0–7. Most are now `skip-target-reached`; the nine that remain under target lost the deficit ranking to DE cells with `need` 12–19 under the 50-per-language cap (see "Why SC didn't run" below). The fix is live and untested in production, and the `eval:gen` yield claim (78% → 94%) remains unverified against real nightly traffic.
- **`ambiguous` rejections: 0 for the third straight day.** `ambiguous` *flags* are 55 (6.4% of requested) — flat vs 7.1% yesterday — but with SC absent, none of that is the SC rubric mismatch; it's the ordinary cloze/translation ambiguity signal.
- **One residual SC coverage gap:** TR B2 SC sits at **14 approved / 15 flagged** and did **not** regenerate. Its only cell, `tr-b2-double-voice`, is `targetOverride`'d (#605) and therefore permanently at target. The 07-22 doc predicted "14 → climbs"; it did not, and structurally it cannot.

---

## Run overview

One scheduled run, **04:00:18 → 04:34:11 UTC** (~34 min), **120 cells, all `succeeded`**.

| | Cells | Requested | Produced | Approved | Flagged | Rejected | Dedup give-up | Cost |
|---|---|---|---|---|---|---|---|---|
| `succeeded` | 120 | 863 | 1,167 | **541** | 135 | 183 | 73 | **$23.08** |
| `failed` | 0 | — | — | — | — | — | — | — |

Approval% below = approved / requested (requested = the *decided* count: approved + flagged + rejected).

### Per-language

| Lang | Cells | Req | Appr | Appr% | Flag | Rej | Dedup | Cost |
|---|---|---|---|---|---|---|---|---|
| de | 50 | 724 | 442 | **61%** | 120 | 158 | 62 | $17.07 |
| es | 46 | 71 | 54 | **76%** | 7 | 10 | 4 | $3.36 |
| tr | 24 | 68 | 45 | **66%** | 8 | 15 | 7 | $2.65 |

**The language mix flipped:** ES took 46 cells (was 29) and TR fell to 24 (was 41). But ES's 46 cells requested only **71 drafts total** — 38 of them at A1/A2 asking for **1–2 drafts each**. That is the scheduler scraping the bottom of a saturated ES pool: it has cell slots to spend and nothing meaningful to fill. Same picture for TR A2/B1 (10 cells, 22 drafts). DE remains the only language with real volume (724 of 863 requested, 84%).

| | de a1 | de a2 | de b1 | de b2 | es a1 | es a2 | es b1 | es b2 | tr a1 | tr a2 | tr b1 | tr b2 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| cells | 7 | 10 | 19 | 14 | 16 | 22 | 4 | 4 | 5 | 4 | 6 | 9 |
| req | 96 | 153 | 273 | 202 | 29 | 24 | 10 | 8 | 21 | 8 | 14 | 25 |
| appr | 58 | 73 | 172 | 139 | 17 | 22 | 9 | 6 | 13 | 3 | 7 | 22 |

### The maturation curve

| Day | Req | Approved | Appr% | Cost | Runtime |
|---|---|---|---|---|---|
| 07-23 | **863** | 541 | 63% | **$23.08** | 34 min |
| 07-22 | 1,261 | 797 | 63% | $31.69 | 41 min |
| 07-21 | 1,839 | 1,192 | 65% | $42.13 | — |
| 07-20 | 2,863 | 2,065 | 72% | $56.35 | — |
| 07-19 | 4,940 | 3,719 | 75% | $95.08 | — |

Requested has fallen ~5.7× in four days at constant 120 cells, and approval has **stopped decaying** (63% two days running). That's the signature of a converged pool: the residual tail is now stable in composition, not still degrading. Pool total is **24,924 approved / 7,571 flagged** (34,864 rows).

---

## Sentence construction: fixed, promoted, and now invisible

The 07-22 recommendation (recalibrate the SC validator rubric) shipped as #606 + #607, and the backlog recovery (`revalidate:sc-promote`) promoted 431 of 517 flagged SC drafts. Today's run shows the second-order effect:

| Day | SC cells run | SC req | SC appr | SC flagged |
|---|---|---|---|---|
| 07-23 | **0** | — | — | — |
| 07-22 | 5 | 51 | 22 | 28 |
| 07-21 | 3 | 42 | 24 | 13 |
| 07-20 | 9 | 229 | 166 | 33 |

Current SC pool (approved / flagged), all-time:

| | DE | ES | TR |
|---|---|---|---|
| A1 | 55 / 7 | — | — |
| A2 | 132 / 1 | — | 213 / 17 |
| B1 | 198 / 2 | 220 / 7 | 727 / 35 |
| B2 | 49 / 1 | 96 / 1 | **14 / 15** |

### Why SC didn't run — deficit-rank starvation, not target-reached

Per-cell SC targets are level-dependent (`CELL_TARGET_DEFAULTS`, `cell-targets.ts`): **A1 = 20, A2 = 30, B1/B2 = 50**. Against those, only **nine** SC cells are still under target, and every one has a tiny `need`:

| Cell | Approved | Target | Need |
|---|---|---|---|
| `de-a1-modal-verbs-present` | 15 | 20 | 5 |
| `de-a2-passive-present` | 28 | 30 | 2 |
| `de-a2-perfekt-with-haben` | 25 | 30 | 5 |
| `de-a2-praeteritum-modals` | 26 | 30 | 4 |
| `de-a2-weil-deshalb` | 23 | 30 | 7 |
| `de-b1-plusquamperfekt-nachdem` | 49 | 50 | 1 |
| `de-b1-subordinate-conjunctions` | 47 | 50 | 3 |
| `de-b2-konjunktiv-ii` | 49 | 50 | 1 |
| `tr-b2-double-voice` | 14 | **15** (`targetOverride`) | 1 |

`selectCellsWithinCaps` ranks strictly by `need` descending. DE's 50-cell fair-share went to cells requesting **12–19** drafts each, so every DE SC cell (need 1–7) was deferred. None of them tripped `skip-low-yield` or `skip-saturated-dedup` — they were simply outranked.

**This is not self-correcting in the near term.** The DE cells outranking them are the chronic tail (`de-a2-adjective-declension-zero` approved 1 of 19; `de-a2-praeteritum-modals` conjugation approved 0 of 16) — cells that *fail* to close their deficit, so their `need` stays high indefinitely and they re-win the slot every night. The only thing that dislodges them is the `LOW_YIELD_THRESHOLD = 3` suppression firing on the next tick (which several of today's 0–1-approval cells will trigger tomorrow). Until then, small-need cells are starved.

TR B2 is the permanent case: `tr-b2-double-voice` is the level's only SC point and its `targetOverride: 15` (#605) caps the pool at 15. At 14 approved it will never rise above 15 — the durable fix is the planned double-voice **split** into separate voice points, not another override tweak.

**Consequence to be explicit about:** the corrected SC prompts have generated **zero** production drafts. The 78% → 94% approval improvement measured via `eval:gen` is the only evidence they work.

### Deploy-path verification (done 2026-07-23)

Read the deployed bodies directly from prod Langfuse (project `cmp3aqkp207nkad07h6t99fi1`) rather than inferring:

| Surface | Where the fix lives | Deployed state |
|---|---|---|
| **#606** validator SC scoping | `VALIDATION_SYSTEM_PROMPT_TEMPLATE` — a **registered** body | ✅ `validate-system-prompt` **v7**, label `production`, `config.localVersion = validate@2026-07-23` (matches repo `VALIDATION_PROMPT_VERSION`). Contains the SC paragraph verbatim: _"For **sentence_construction**, `ambiguous` is about the PROMPT, not the answer space… Set `ambiguous = true` ONLY when the PROMPT itself is self-contradictory"_ |
| **#607** SC subject-vs-addressee | `renderSentenceConstructionSection()` (`generation-prompts.ts:268`) → the `{{sentenceConstructionSection}}` **variable** | ✅ Ships with the **Lambda code deploy**, not Langfuse. Merged as `68efab4`; CDK deploy runs on merge to main. No push-prompts run affects it. |
| **#611** cloze tense-determinacy | Both registered bodies | ✅ `generate-system-prompt` **v19** / `validate-system-prompt` **v7**, both re-registered today **11:28 UTC** as `@2026-07-23` — i.e. *after* this morning's 04:00 run, so it takes effect tomorrow night. |

**Correction to the framing above:** the "verify against the deployed Langfuse body" concern only ever applied to **#606**. #607 is not a registered surface at all — checking Langfuse for it would have been looking in the wrong place (cf. the standing gotcha that Langfuse registers the *template*, not the rendered body, so `{{var}}` sections ship with code). Both are confirmed live. The remaining question is purely **behavioral**, not deployment.

### Behavioral verification — `eval:gen` on four SC cells (2026-07-23)

Run `sc-verify-2026-07-23`, 5 drafts/cell/arm, both arms on the current repo source (`sha e283d49a`) — which, per the table above, is byte-identical in substance to the deployed validator. Three of the four cells were **not** in the pre-ship A/B.

| Cell | Drafts | Auto-approved | Flagged | Rejected | `ambiguous` |
|---|---|---|---|---|---|
| `de:a1:sentence_construction:de-a1-modal-verbs-present` | 10 | **10** | 0 | 0 | **0** |
| `tr:a2:sentence_construction:tr-a2-aorist` | 10 | **10** | 0 | 0 | **0** |
| `tr:b1:sentence_construction:tr-b1-causative-voice` | 10 | **10** | 0 | 0 | **0** |
| `es:b1:sentence_construction:es-b1-relative-clauses` | 10 | **10** | 0 | 0 | **0** |
| **Total** | **40** | **40 (100%)** | 0 | 0 | **0** |

Cost $0.81. Zero rejection reasons, zero flag tags of any kind.

`de-a1-modal-verbs-present` is the decisive comparison: on 07-22, pre-fix, it produced **4 approved / 15 flagged** (20%) with `ambiguous` on every flagged draft. Post-fix it is **10/10** with no flags. The three previously-unevaluated cells behave the same, so the fix generalizes beyond the cells it was tuned on.

**Caveats, stated honestly:** (a) n=40 is small and 100% is not a rate you should extrapolate — it establishes the pathological over-flagging is gone, not that the true approval rate is 1.0; (b) both arms ran the same source, so this is a 2× sample of one configuration, not an A/B; (c) the Langfuse client was authenticated against the **dev** project (prod creds were unavailable), but prompt bodies came from `repo`, and the prod validator body was separately confirmed to contain the same rule — so the validator under test matches production in substance. A byte-exact `bootstrap-prompts --check` against prod was not run.

---

## Rejection reasons

| Reason | n (07-23) | 07-22 | 07-21 | 07-20 | Rate of req (07-23) |
|---|---|---|---|---|---|
| `context-spoils-answer` | **61** | 74 | 136 | 171 | **7.1%** |
| `low-quality-reject` | 53 | 49 | 89 | 115 | 6.1% |
| `cultural-issue` | 1 | 1 | ≤1 | — | — |
| `ambiguous` | **0** | 0 | 1 | 5 | — |

`context-spoils-answer` is the #1 reject reason for a **sixth straight day**, and as a rate of requested it ticked **up** to 7.1% (was 5.9%). `low-quality-reject` also rose as a rate (3.9% → 6.1%). Both are consistent with a hardening residual tail rather than a regression.

**Correction to the 07-22 read.** That doc attributed `context-spoils-answer` to "DE connector/subordination cloze." Broken out by exercise type across five days, cloze is *not* the worst surface — translation is, consistently:

| Type | 07-23 | 07-22 | 07-21 | 07-20 | 07-19 |
|---|---|---|---|---|---|
| cloze | 4.0% | 2.8% | 5.0% | 4.5% | 3.1% |
| translation | **6.0%** | 5.0% | 6.0% | 5.2% | 4.6% |
| conjugation (07-23) | **23%** (19/83) | | | | |
| vocab_recall (07-23) | 8.6% (6/70) | | | | |

Today's spike is **conjugation**, and it is one cell: `de:a2:conjugation:de-a2-adjective-declension-zero` contributed **15 of the 19** conjugation context-spoils (and 15 of the run's 61 overall). Its sibling `de-a2-adjective-declension-indefinite` added 4. So a quarter of the run's #1 reject reason comes from the adjective-declension family on the conjugation surface — the carrier phrase evidently leaks the ending being drilled. Rejected drafts are not persisted, so this needs an `eval:gen` run on that cell to read the actual failures.

The rest of `context-spoils` is now genuinely diffuse: after the two adjective-declension cells, the largest single contributor is 6 (`de-a2-weil-deshalb` translation, `de-a1-zero-article` cloze), then a long tail of 1–3.

---

## Weakest cells (req ≥ 10)

| Cell | Req | Appr% | Flag | Rej | Dedup | Dominant reason |
|---|---|---|---|---|---|---|
| `de:a2:conjugation:de-a2-praeteritum-modals` | 16 | **0%** | 0 | 12 | **12** | Pure dedup exhaustion (52 produced → 0 new) |
| `de:a2:conjugation:de-a2-adjective-declension-zero` | 19 | **5%** | 0 | 18 | 0 | `context-spoils` ×15 — chronic (17% → 5%) |
| `de:b1:cloze:de-b1-n-declension` | 14 | **7%** | 9 | 4 | 0 | Flag-driven (`low-quality-flag`) |
| `de:a2:translation:de-a2-weil-deshalb` | 19 | **11%** | 5 | 12 | 1 | `context-spoils` ×6 — chronic (21% → 11%) |
| `de:b1:cloze:de-b1-progressive-equivalents` | 15 | 20% | 9 | 3 | 0 | Flag-driven |
| `de:a1:cloze:de-a1-zero-article` | 15 | 20% | 1 | 11 | 4 | `context-spoils` ×6 |
| `de:b1:cloze:de-b1-comparison-attributive` | 14 | 36% | 8 | 1 | 0 | Flag-driven |
| `de:b1:translation:de-b1-comparison-attributive` | 16 | 38% | 8 | 2 | 0 | Flag-driven |
| `de:b2:cloze:de-b2-modal-connectors` | 13 | 38% | 6 | 2 | 0 | Flag-driven |
| `de:a1:conjugation:de-a1-praeteritum-sein-haben` | 15 | 47% | 0 | 8 | **8** | Dedup exhaustion |

Same caveat as 07-22: low *daily* approval% on a topped-up cell is churn against a full pool, not under-service. Three distinct failure modes are visible and they want different responses:

1. **Dedup exhaustion** (`praeteritum-modals` 12/12, `praeteritum-sein-haben` 8/8) — finite answer space; nothing to fix, and `targetOverride` would only stop the (already cheap) churn.
2. **`context-spoils` chronics** (`adjective-declension-zero`, `weil-deshalb`, `zero-article`) — real prompt defects, both worse than yesterday in %.
3. **Flag-driven B1 cells** (`n-declension`, `progressive-equivalents`, both `comparison-attributive` surfaces) — near-zero rejects, 8–9 flags each. This is the same shape that turned out to be a validator rubric mismatch on SC. Worth checking whether `low-quality-flag` on comparison/declension cloze is over-strict the same way `ambiguous` was on SC.

---

## Recommendations

1. **~~Verify #606/#607~~ — DONE 2026-07-23.** Both fixes confirmed deployed (prod Langfuse `validate-system-prompt` v7 for #606; Lambda code deploy for #607, which is not a registered surface) and confirmed behaviorally: `eval:gen` on four SC cells returned **40/40 auto-approved, zero `ambiguous`**, against a pre-fix baseline of 4/20 on the same exhibit cell. See the two sections above. No further action; nothing needs forcing through the nightly path.
2. **Investigate `de-a2-adjective-declension-zero` on the conjugation surface — 15 of the run's 61 `context-spoils`.** Its sibling `-indefinite` adds 4. Run `eval:gen` on both cells to read the actual rejected drafts (they aren't persisted), then fix the carrier-phrase construction so the sentence doesn't leak the ending. Highest-yield single `context-spoils` fix available.
3. **Check whether `low-quality-flag` is over-strict on B1 declension/comparison cloze** — four cells with 8–9 flags and ~1 reject each is the SC rubric-mismatch signature. If confirmed, the same promote-only recovery pass (`revalidate:sc-promote`, generalized) applies.
4. **TR B2 sentence_construction is structurally frozen at 14 approved.** The single cell is `targetOverride`'d. Either split `tr-b2-double-voice` into separate voice points (the durable fix already identified) or add a second TR B2 SC-suitable grammar point. No user-facing emptiness, but the drill type is thin at that level.
5. **`context-spoils-answer` on connector translation/cloze — sixth day, rate now 6–7%.** Still un-shipped. Add the "the un-blanked clause must not reveal the blanked connector/modal" constraint to the cloze/translation generation prompt, mirror it in validation, bump both versions, A/B on `de-a2-weil-deshalb` / `de-a1-zero-article`.
6. **Pure `need`-descending ranking now starves small-deficit cells behind chronic high-deficit ones.** Nine SC cells (need 1–7) were deferred behind DE cells that have failed to close a need-12–19 deficit for days. Ranking by need alone rewards cells that *can't* fill. Consider a secondary term — e.g. deprioritize by recent approval *rate*, or reserve a few slots per run for near-complete cells (need ≤ 5), which close permanently for a handful of drafts. Low effort, removes a class of indefinite deferral.
7. **Consider trimming the cell budget or rebalancing the fair-share cap.** 38 ES A1/A2 cells requested 1–2 drafts each — those slots produced 39 exercises between them while DE B1/B2 (33 cells) absorbed 475 requested. The 120-cell budget is no longer the binding constraint; the fair-share split is now allocating slots to languages with nothing left to generate, while DE's 50-cell cap is over-subscribed.
8. **Billing/failure monitoring still unaddressed** — standing rec: alarm on `status='failed'` generation jobs.
