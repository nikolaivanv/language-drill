# Generation Run Analysis — 2026-06-19

_Source: prod Neon branch `br-green-waterfall-ancrvpr5` (project `twilight-smoke-01114337`), `generation_jobs` + `exercises`._

## Run overview

One scheduled run at **04:00 UTC**, **68 cells, all `succeeded`**, ~**$37.83** spent.

| Metric | Total |
|---|---|
| Produced | 2,028 |
| Approved | 1,011 |
| Flagged | 340 |
| Rejected | 286 |
| Dedup given up | 91 |

The run was **~95% Turkish**, dominated by the TR B1 curriculum launch.

Rejection reasons (normalized tags): `context-spoils-answer` 119, `low-quality-reject` 88, `cultural-issue` 2. No level-mismatch rejections.

---

## Expected changes — verdict

### ✅ TR B1 exercises (#369) — landed; the bulk of the run

TR B1 went from effectively empty to a full pool across 7 types / ~35 cells. `first_seen = 2026-06-19` for B1 sentence_construction, conjugation, and dictation (greenfield); cloze/translation/vocab_recall had a single stray April row each, but the entire real pool is from today.

| Type | Cells | Approved | Appr% (of produced) | Flag% |
|---|---|---|---|---|
| translation | 10 | 347 | 68% | 24% |
| sentence_construction | 7 | 267 | **73%** | 21% |
| cloze | 7 | 137 | 40% | 30% |
| conjugation | 3 | 100 | 43%* | 6% |
| vocab_recall | 5 | 30 | 51% | 3% |
| dictation | 1 | 12 | 80% | 20% |
| free_writing | 3 | 14 | 93% | 7% |

\* conjugation's "produced" is inflated (multi-form drafts); by requested-count it is 67% (100/150).

Healthy overall. **Weak spot: the voice cloze cells** — see deep-dive below.

### ✅ Less level-mismatch rejection (#338) — measurable drop

Level-mismatch surfaces as a **flag tag**, not a rejection reason. As a share of TR flag tags:

| Period | Level-related share |
|---|---|
| Late May | ~18% |
| Early–mid June | 6–11% |
| **2026-06-19** | **2.7% (50/1,868)** — lowest in window |

Confirmed.

### ✅ TR A1–A2 (and B1) free writing (#333) — landed, top quality

`tr:a2:fw` ×3 cells **first seen today**; `tr:a1:fw-my-family` first seen 6/18; `tr:b1:fw` since 6/14. Free-writing was the **highest-quality type** in the run: A1 100%, A2 93%, B1 93% approval, near-zero rejections.

### ✅ Conjugation (#331, #319) — TR healthy, ⚠️ ES broken

- TR conjugation cells (`tr-a1-dili-past`, `tr-a2-aorist`, `tr-b1-*`) **first seen today**; healthy by requested-count: a1 90% (27/30), b1 67% (100/150), a2 aorist 60% (29/48).
- **ES B1 conjugation is failing**: `es-b1-conditional` approved **3**, `es-b1-present-subjunctive` approved **10** — ~11% of requested (13/115), against ~41 rejected + 41 dedup-given-up. The Spanish conjugation generator is producing mostly unusable / near-duplicate output. Not in today's expected list, but same feature — worth an `eval:gen` A/B.

### ✅ Turkish dictation (#310) — live; B1 added today

A1/A2 dictation live since 6/16; **B1 dictation new today** (12/15, 80%).

---

## Deep-dive: TR B1 voice cloze failure

The voice cloze cells are the standout weakness of an otherwise strong B1 launch.

### Per-cell yield (cloze, of 50 produced each)

| Cell | Approved | Flagged | Rejected | Appr% |
|---|---|---|---|---|
| `tr-b1-past-continuous-iyordu` | 31 | 4 | 14 | 62% |
| `tr-b1-passive-voice` | 27 | 15 | 8 | 54% |
| `tr-b1-reflexive-voice-kendi` | 17 | 22 | 11 | 34% |
| `tr-b1-reciprocal-voice` | 16 | 19 | 15 | 32% |
| `tr-b1-obligation-periphrases` | 12 | 14 | 22 | 24% |
| `tr-b1-causative-voice` | **6** | **21** | **23** | **12%** |

(`past-continuous` and `passive` are the healthier comparison points; causative is the floor.)

### Substantive flag reason (`code` field), flagged voice clozes

`low-quality-flag` is the route tag (~1 per flagged item); `ambiguous` is the substantive reason and dominates:

| Cell | `ambiguous` / flagged |
|---|---|
| `tr-b1-reflexive-voice-kendi` | 19 / 22 |
| `tr-b1-causative-voice` | 15 / 21 |
| `tr-b1-reciprocal-voice` | 13 / 19 |
| `tr-b1-passive-voice` | 10 / 15 |

`level-mismatch` appears **0–1 times per cell** — level is not the problem.

### Root causes (from `validator-note` details, verbatim)

1. **Under-constrained blanks (the #1 issue).** The blank conflates the target voice morpheme with free inflectional choices — tense, polarity, person — that the sentence context does not pin down, so several surface forms are all valid answers:
   - _"the blank is wide open — the learner must supply the causative stem, tense, polarity, and person/number all at once, but the sentence context does not constrain polarity. 'içirdiler' (affirmative past 3pl) is equal[ly valid]…"_
   - _"'yaşatmadık' (definite past, 1pl negative), but the sentence provides no temporal context forcing past tense. 'Yaşatmıyoruz' … and 'yaşatmayız' (aorist)…"_

2. **Stem hint already embeds the voice morpheme**, so the blank no longer tests forming the voice:
   - _"'tamir ettir-' — the causative suffix -DIr has already been applied … the blank only requires … the past tense personal ending, not to form the causative."_
   - _"Stem hint 'kısal-' is already the causative stem … not the base verb."_

3. **Allomorph ambiguity** — causative `-t` vs `-DIr` selection left genuinely ambiguous (e.g. `düzenle-` → `düzenlet-`).

4. **Rare vocabulary** (minor) — legal/administrative compounds like `tescil etmek`, `tamir` push individual items above B1, but this is a small slice (1–5 tags/cell).

### Why this is structural, not random

Turkish voice is agglutinative: the voice morpheme sits **between** the stem and a stack of mandatory inflection (negation, tense/aspect, person). A single-blank cloze that swallows the whole word inevitably exposes free inflectional choices the surrounding sentence rarely constrains → the validator (correctly) flags multiple valid answers. The healthier types confirm the diagnosis:
- **sentence_construction (73%)** and **translation (68%)** give the learner the full target meaning, so voice is exercised without the ambiguity trap.
- **cloze (40%, voice cells far lower)** is the wrong surface for productive voice morphology.

### Recommendations

1. **Constrain the cloze frame for voice cells.** Pin tense/polarity/person in the carrier sentence (explicit time adverbials, given polarity) so the only open variable is the voice morpheme — or pre-supply the inflectional tail and blank only the voice slot.
2. **Reject stem hints that already contain the voice suffix** at generation time (deterministic check: the hint must be the base verb, not the derived stem).
3. **Consider de-emphasizing cloze for voice grammar points** and leaning on sentence_construction / translation, which already clear 68–73%.
4. **Re-run after a generation-prompt pass** via `eval:gen` against a failure-prone cell dataset (`pnpm eval:gen:export` seeded from these cells) before the next scheduler converges. Note: a prompt-only fix to a suppressed low-yield cell needs a `CURRICULUM_VERSION` bump or manual trigger to re-run.

---

## Deep-dive: ES B1 conjugation failure

| Cell | Req | Produced | Approved | Rejected | Dedup-given-up | Appr% (of req) |
|---|---|---|---|---|---|---|
| `es-b1-conditional` | 65 | 100 | **3** | 11 | 11 | 5% |
| `es-b1-present-subjunctive` | 50 | 146 | 10 | 30 | 30 | 20% |

**Not a regression — first real run.** Both cells ran 6/18 with `produced=0` (transient infra miss), so 6/19 is the inaugural generation and it failed out of the gate. `rejection_reason_counts` is `null` for both — the losses are not normal validator rejections.

### Primary cause: dedup collapse from low lemma diversity

The dedup key is `lemma::featureBundle` (e.g. `tener::condicional simple 1.ª persona del singular (yo)`). The `coverage_outcome` requests a spread across 5 person slots (~10–14 each), but the model recycles a tiny verb set:

- **conditional**: only **2 distinct lemmas** across 3 retained — `poder`, `tener`.
- **present-subjunctive**: **8 distinct lemmas** across 11 retained — `comer, dormir, estudiar, hablar, llegar, tener, venir, volver`.

With so few favorite verbs, the unique `(lemma × person)` space is exhausted almost immediately; the model regenerates the same combinations, which collapse on the dedup key. That is why `produced` (100 / 146) dwarfs everything downstream and **dedup-given-up is the largest bucket** (11 / 30). Approval is starved not by validator strictness but by lack of distinct input.

### Secondary cause: chain-of-thought leaking into `instructions`

**4 of 11** retained subjunctive items (36%) leak reasoning into the learner-facing `instructions` field. The flagged item is the worst case:

> _"A friend asks if you want them to come early. Complete your reply: 'No, no quiero que ___ (venir) tarde.' → Actually, you say: 'Quiero que llegues temprano…' — Wait, let's keep it simple: given the trigger phrase 'Es importante que yo', type the correct present-subjunctive form."_

Validator note: _"Instructions are severely garbled and self-contradictory … introduce a 'venir/tarde' scenario, then abandon it mid-sentence with 'Actually, you say…', then abandon that too with 'Wait, let's keep it simple'."_ Several auto-approved items also reference the **wrong verb** in their carrier sentence (e.g. a `comer` item scaffolded with "Quiero que (yo) llegue a tiempo"; a `dormir` item hinting "querer (yo)").

### Tertiary cause: non-diagnostic target forms

The flagged `hablar` item targets `hable` — 1sg present-subjunctive of an `-ar` verb, which is **identical to the 3sg** (syncretism), so the feature bundle doesn't uniquely expose the learner error it claims to test. Even some approved items are low pedagogical value.

### Contrast with TR conjugation (which succeeded today)

TR conjugation cleared a1 90% / b1 67% — same exercise type, healthy yield. ES conjugation lacks both the verb diversity and the output discipline TR got, and there is no deterministic post-check (TR benefits from vowel-harmony/allomorph validation) to catch the garbled instructions.

### Recommendations

1. **Force lemma diversity** in the generation spec — inject a prior-lemma avoid-list (the same pattern free-writing uses for title dedup and per-ordinal angle rotation) and/or supply a curriculum verb bank so the model draws from a wide pool rather than 2–8 favorites.
2. **Right-size the request** — per-person requested counts (~10–14) exceed the achievable distinct-lemma supply; lower them or broaden the verb bank so dedup-given-up stops dominating.
3. **Tighten output discipline** — the generation prompt must forbid reasoning/meta-text in `instructions` and require the carrier sentence to reference the target lemma. Bump `GENERATION_PROMPT_VERSION` with the fix.
4. **Exclude syncretic person/form combos** (e.g. `-ar` 1sg = 3sg present subjunctive) from the coverage spec so target forms stay diagnostic.
5. **Validate with `eval:gen`** before the next scheduler run. Note `es-b1-conditional` approved exactly 3 — at the edge of the skip-low-yield threshold; if it dips below, a prompt-only fix won't re-trigger without a `CURRICULUM_VERSION` bump or manual trigger.

---

## Other items worth attention

1. **TR B1 voice cloze** — the cloze surface is wrong for productive voice morphology (see deep-dive).
2. **ES B1 conjugation** — dedup collapse + instruction-leak on its first run (see deep-dive).
