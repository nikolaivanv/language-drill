# Generation Run Analysis — 2026-07-20

_Source: prod Neon branch `br-green-waterfall-ancrvpr5` (project `twilight-smoke-01114337`), `generation_jobs` + `exercises`. Scheduler constants from `infra/lambda/src/generation/scheduler.ts`._

## TL;DR

Third clean 120-cell run in a row — **all 120 succeeded, 0 failures, 2,065 approved, $56.35**. Two things stand out:

- **The starved A1 backlog cleared itself — no manual trigger needed.** Every TR + ES A1 cell that was parked behind the B1/B2 expansions on 07-19 ran today. The DE/TR B1/B2 pools have saturated enough that per-cell `need` collapsed (**requested dropped 4,940 → 2,863**), so the water-fill finally reached A1. The 07-19 decision to wait for the daily run was correct.
- **`tr-a1-gore-bence` is fixed and verified.** It produced **15 approved translations, 0 flagged**, with the full person spread the coverageSpec floors demand (1sg 5 / 2sg 3 / 3sg 3 / 1pl 2 / 2pl 2). The PR #600 `acceptableAnswers` fix cured the person-collapse: a cell that was 0-approved / all-`ambiguous` for six weeks now approves cleanly.

Quality is steady overall (**72%** of requested), but **TR slipped to 66%**, dragged by its B2 translation tail (`double-voice`, `participle-*` at ~17–50%) and a few weak first-pass A1 cloze. `context-spoils-answer` is now a **three-day** top reject reason and is overdue for the prompt fix.

---

## Run overview

One scheduled run, **04:00:17 → 05:00:14 UTC** (~60 min), **120 cells, all `succeeded`**.

| | Cells | Requested | Produced | Approved | Flagged | Rejected | Dedup give-up | Cost |
|---|---|---|---|---|---|---|---|---|
| `succeeded` | 120 | 2,863 | 3,413 | **2,065** | 388 | 406 | 133 | **$56.35** |
| `failed` | 0 | — | — | — | — | — | — | — |

Approval of requested: **72%**. The **requested count halving** (4,940 → 2,863) is the headline structural signal — cells are now **topping up** small deficits, not filling from empty. Cost fell with it ($95 → $56) even at the same 120-cell count.

### Per-language split

| Lang | Cells | Req | Appr | Appr% | Flag | Rej | Dedup | Cost |
|---|---|---|---|---|---|---|---|---|
| de | 50 | 1,506 | 1,095 | **73%** | 176 | 235 | 82 | $29.01 |
| tr | 45 | 886 | 586 | **66%** | 144 | 152 | 43 | $18.95 |
| es | 25 | 471 | 384 | **82%** | 68 | 19 | 8 | $8.39 |

DE hit the 50-cell per-language cap again; TR (45) and ES (25) offered fewer under-target cells than the cap. ES's low deficit (471 requested across 25 cells ≈ 19/cell) shows it is nearly saturated.

### Language × level × type

| Lang | Level | Type | Cells | Req | Appr | Appr% |
|---|---|---|---|---|---|---|
| de | a2 | cloze | 19 | 570 | 470 | 82% |
| de | a2 | translation | 20 | 600 | 438 | 73% |
| de | a2 | sentence_construction | 5 | 150 | 114 | 76% |
| de | a2 | conjugation | 4 | 120 | 55 | **46%** |
| de | b2 | cloze | 2 | 66 | 18 | **27%** |
| es | a1 | cloze | 6 | 120 | 100 | 83% |
| es | a1 | translation | 7 | 140 | 96 | 69% |
| es | a2 | cloze / vocab_recall | 4 | 72 | 65 | 90% |
| es | b1/b2 | cloze/translation/vocab_recall | 8 | 139 | 118 | 85% |
| tr | a1 | cloze | 7 | 130 | 75 | **58%** |
| tr | a1 | translation | 8 | 160 | 114 | 71% |
| tr | a2 | translation / vocab_recall | 5 | 90 | 79 | 88% |
| tr | b1 | cloze | 2 | 48 | 22 | **46%** |
| tr | b1 | sentence_construction / translation / vocab_recall | 9 | 170 | 137 | 81% |
| tr | b2 | translation | 9 | 173 | 86 | **50%** |
| tr | b2 | cloze / conjugation / sc / vocab_recall | 5 | 115 | 73 | 63% |

**DE has moved down to A2.** DE B1/B2 saturated over 07-18/07-19; today DE was ~all A2 (48 cells) plus 2 B2 cloze stragglers. **DE A1 (45 cells) is still untouched** — next in line as A2 fills.

---

## The A1 recovery — starvation resolved without intervention

On 07-19 I flagged ~20 A1 cells (TR + ES) as 0-approved and starved behind the B1/B2 expansions, and recommended either a manual trigger or a scheduler ranking change. We chose to **wait for the daily run**. Today it self-corrected:

| Cell | Req | Appr | Note |
|---|---|---|---|
| `tr:a1:translation:tr-a1-gore-bence` | 20 | **15** | **0 flagged** — #600 fix verified, full person spread |
| `tr:a1:translation:tr-a1-imperative` | 20 | 19 | Was 0-approved; now near target |
| `tr:a1:cloze:tr-a1-imperative` | 20 | 18 | |
| `tr:a1:translation:tr-a1-questions` | 20 | 17 | |
| `tr:a1:translation:tr-a1-demonstratives` | 20 | 14 | |
| `es:a1:cloze:es-a1-negation-tampoco` | 20 | 20 | 100% |
| `es:a1:cloze:es-a1-articles` | 20 | 18 | |
| `es:a1:*` (gender-agreement, gustar-basic, subject-pronouns, possessives, telling-time) | — | 12–17 ea | All recovered |

All 13 ES A1 + ~15 TR A1 cells ran. This confirms the 07-19 mechanism read: it was **deficit-ranking starvation, not suppression** — once the B1/B2 `need` dropped below A1's, A1 won the sort naturally. The durable `need/target`-fraction ranking change is now **optional**, not urgent: the water-fill self-heals once an expansion saturates, but it does impose a multi-night lag on lower levels during any future expansion. Worth keeping in the backlog for the next big curriculum push (DE A1 is the next candidate to be starved).

### `gore-bence` — closed

Live pool for `tr-a1-gore-bence` translation: **15 auto-approved** (+ 32 flagged / 20 rejected legacy rows that predate the fix and are harmless). Person distribution among approved matches the coverageSpec floors `{1sg:4, 2sg:3, 3sg:3, 1pl:3, 2pl:3}`:

| Person | 1sg | 2sg | 3sg | 1pl | 2pl |
|---|---|---|---|---|---|
| Approved | 5 | 3 | 3 | 2 | 2 |

At 15/20 it is servable and one pass from target. The six-week 1sg-`Bence` collapse is gone. **No further action.**

---

## Rejection & flag reasons

| Rejection reason | n | 07-19 | 07-18 |
|---|---|---|---|
| `context-spoils-answer` | 171 | 215 | 109 |
| `low-quality-reject` | 115 | 137 | 142 |
| `cultural-issue` | 5 | 4 | 2 |

`context-spoils-answer` remains the #1 reject reason for the **third straight day**. It stays concentrated in DE/TR connector & modal cloze (`de-b2-modal-connectors` 41% with 20 flags, `de-b2-subjective-modals` 13%, `tr-b1-when-converbs` 38% with 17 flags). This is now a confirmed trend, not first-fill noise — see rec #1.

---

## Weakest cells

| Cell | Req | Appr% | Rej | Dedup | Diagnosis |
|---|---|---|---|---|---|
| `de:b2:cloze:de-b2-subjective-modals` | 32 | **13%** | 23 | 0 | Falling (36% on 07-19). Connector/modal cloze — `context-spoils`. |
| `de:a2:conjugation:de-a2-adjective-declension-zero` | 30 | **13%** | 26 | 0 | New; structural — attributive adjective endings are near-deterministic, low distinct space. |
| `tr:b2:translation:tr-b2-double-voice` | 41 | **17%** | 23 | 4 | **Third day weak** (18%→17%; SC 43%). Point-level, both surfaces. **`eval:gen` now.** |
| `tr:a1:cloze:tr-a1-personal-pronouns` | 20 | 35% | 8 | 0 | First re-pass after recovery — watch next run. |
| `tr:a1:translation:tr-a1-vowel-harmony` | 20 | 35% | 4 | 0 | Weak on both surfaces (cloze 2/10). Curriculum-difficulty candidate. |
| `tr:b2:translation:tr-b2-participle-mis` | 23 | 35% | 11 | 11 | Dedup-limited (11 give-up) + reject-heavy. |
| `tr:b1:cloze:tr-b1-when-converbs` | 29 | 38% | 1 | 0 | Degrading (74%→42%→38%). Flag-dominated ambiguity on the converb surface. |
| `de:a2:conjugation:de-a2-praeteritum-modals` | 30 | 47% | 16 | 16 | Narrow paradigm — dedup-exhausted. `targetOverride` candidate. |

Two flavors: (a) **structurally narrow** cells that will never reach 50 (`de-a2-adjective-declension-zero`, `de-a2-praeteritum-modals`, `tr-b2-participle-mis`) — `targetOverride` them; (b) **point-level quality** cells recurring across runs (`tr-b2-double-voice`, `tr-b1-when-converbs`, `de-b2-subjective-modals`) — these need prompt/curriculum work, not more passes.

---

## Daily trend

| Day | Langs | Cells (ok/fail) | Req | Approved | Appr% | Cost |
|---|---|---|---|---|---|---|
| **07-20** | de+es+tr | **120 / 0** | **2,863** | 2,065 | 72% | **$56.35** |
| 07-19 | de+es+tr | 120 / 0 | 4,940 | 3,719 | 75% | $95.08 |
| 07-18 | de only | 60 / 0 | 3,000 | 2,201 | 73% | $66.26 |
| 07-17 | es+tr | 17 / **43** | 2,160 | 661 | 82% | $16.15 (billing death) |
| 07-16 | es+tr | 60 / 0 | 284 | 237 | 83% | $9.34 |

The falling **requested/cost** at a constant 120 cells is the maturation signal: the pool is shifting from first-fill (big deficits, ~$95) toward steady-state top-ups (small deficits). Expect nightly cost to keep drifting down toward ~$30–40 as DE A2/A1 fill, barring a new curriculum expansion.

---

## Recommendations

1. **Fix `context-spoils-answer` on connector/modal cloze — three-day trend, now actionable.** DE/TR B2 connector & modal cloze leak the blank via the un-blanked clause. Add a "the rest of the sentence must not disambiguate the blanked connector/modal" constraint to the cloze **generation** prompt, mirrored in **validation** (generate↔validate contract), and bump both prompt versions. This is the single highest-yield quality fix left.
2. **`eval:gen` on `tr-b2-double-voice`.** Weak on both translation (17%) and SC (43%) for three straight days — a point-level issue (likely coverageSpec or curriculum description), not surface prompt noise. It's the clearest "not first-fill noise" signal in the run.
3. **`targetOverride` the dedup-exhausted narrow cells** — `de-a2-praeteritum-modals`, `de-a2-adjective-declension-zero`, `tr-b2-participle-mis`. They re-enqueue and burn requests every night without reaching 50. Set targets ~15–20.
4. **DE A1 (45 cells) is the next frontier** — still zero pool, next in line as DE A2 saturates. No action needed (it will fill on its own), but it's the language slice most likely to be briefly starved when it starts, same pattern as the just-resolved TR/ES A1.
5. **The `need/target`-fraction scheduler ranking is now backlog, not urgent.** Today proved the water-fill self-heals once an expansion saturates. Keep it as the durable fix for the *next* expansion's starvation lag, but it isn't blocking anything today.
6. **Billing monitoring still unaddressed** — three clean runs, but nothing structural changed since 07-17. Standing rec: alarm on `status='failed'` generation jobs.
