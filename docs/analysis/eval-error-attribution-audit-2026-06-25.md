# Answer-evaluator error attribution & recall audit — 2026-06-25

Manual audit of production answer evaluations logged **after PR #410** (Curriculum
Map — Phase 1, merged 2026-06-20T20:08Z), which first surfaced per-point grammar
mastery + `error_observations` to the UI. Two questions:

1. **Attribution correctness** — when the evaluator attributes an error to a grammar
   point, is it the right point?
2. **Recall** — how often does the evaluator miss a real error entirely?

**Data source:** prod Neon branch `br-green-waterfall-ancrvpr5` (project
`twilight-smoke-01114337`), tables `user_exercise_history` + `error_observations`
joined to `exercises`. Window: `evaluated_at >= 2026-06-20T20:08:33Z`.

> ⚠️ **Sample is tiny.** 60 evaluations, **2 users, Turkish only, A1/A2 only**
> (cloze / dictation / translation / vocab_recall / conjugation). Findings are
> directional — point estimates have wide intervals and say nothing about
> ES/DE/EN or B1+. Treat as "order of magnitude + failure-mode catalogue," not
> a precise metric.

---

## How attribution works (code path)

- `POST /exercises/:id/submit` (`infra/lambda/src/routes/exercises.ts`) resolves the
  exercise's grammar point and builds `attributionKeys` = curriculum grammar points
  **at or below** the exercise's CEFR level (`grammarPointsAtOrBelow`).
- The Claude tool schema constrains each error's optional `grammarPointKey` to that
  **closed set** (`packages/ai/src/evaluate.ts`); `parseEvaluationResult` re-filters,
  dropping any out-of-set key to `null`.
- The prompt (`packages/ai/src/prompts.ts:59`) tells the model to attribute **at most
  one** point per error and to **omit** the key for vocabulary/spelling slips.
- Result lands in `error_observations.error_grammar_point_key`, alongside the
  denormalized `host_grammar_point_key` (the exercise's own point). The PR #410
  curriculum map reads these rows; **absence of an attributed error is treated as a
  mastery signal.**

---

## Part 1 — Attribution correctness

22 error observations from 21 error-bearing answers.

| | count |
|---|---|
| Total observations | 22 |
| Grammar errors (all attributed) | 14 — **0 left null** |
| Non-grammar (vocab/spelling/pragmatics/dictation) | 8 — **all correctly null** |
| attr == host point | 13 |
| attr ≠ host point | 1 (and it's correct) |

**~93% of grammar attributions are correct or defensible; zero clearly wrong.**

- **~11 unambiguously correct** — e.g. `anneim→anneyim` → personal-suffixes;
  `uyumiyor→uyumuyorum` → present-continuous; `koydı→koydu` → dili-past (vowel
  harmony); `odası→odanız` → possessive-suffixes; `Ben gibi→benim gibi` → gibi-kadar.
- **Standout cross-attribution (attr ≠ host, correct):** in an **imperative**
  exercise (`Resimi bakar!`), the case error `Resimi→Resime` was attributed to
  `tr-a1-ablative-dative`, **not** the host `imperative` — because *bakmak* takes
  dative. The model is not lazily echoing the host point.
- **Type discrimination is good:** `bekliyorum→biliyorum` was typed **vocabulary**
  (null), not forced onto the exercise's accusative point.
- **3 borderline-but-defensible:**
  - `ona→onu` (pronoun direct object) → personal-pronouns. Could be accusative;
    pronoun choice is reasonable.
  - `geldiler→gelmediler` → dili-past. Real error is missing **negation**; no
    separate A1 negation point in scope, so folding into past tense is the only
    option in the closed set.
  - `köpegi→köpeği` → accusative-definite-object. Actual deviation is the **k→ğ
    consonant softening** (a stem-change); attribution to the accusative form is
    defensible but imperfect.

**Verdict:** the closed-set + post-filter design works. Attribution is the
*healthy* half of the pipeline.

---

## Part 2 — Recall (missed errors)

Ground-truth grading of **all 60** evaluations (not just error-bearing ones).
**4 answers had a missed error.**

| Answer | Missed error | Mechanism | Host point? |
|---|---|---|---|
| `Masada bir kitab var.` (dictation, **score 1.0**) | `kitab`→`kitap` (final devoicing) | **Rationalized away** — feedback called it "natural phonetic assimilation" (linguistically wrong; standard form is *kitap*) | n/a (dictation) |
| `Ben bakıcım.` ("I am a nurse", **score 0.6**) | `bakıcı`→`hemşire` (wrong profession) | **Recognized in prose feedback but not itemized** in the `errors` array → no `error_observation` created | vocab |
| `Senin adı bekliyorum.` ("I know your name", score 0) | `adı`→`adını` (accusative) | Caught the vocab error, **missed the accusative** (second error) | **yes** — accusative-definite-object |
| `…burunu görüyorum.` ("my friend's nose", score 0.85) | `burunu`→`burnu` (vowel-drop stem change) | Caught the pragmatics note, **missed the stem change** | **yes** — stem-changes |

Everything else verified clean: all 22 itemized errors are genuine (**precision ≈
100%** on this sample), all score-1 answers truly correct, and one near-miss
(`görüyorum` vs habitual `görürüm`) was **correctly** treated as an acceptable
variant — not a false positive.

### Rates
- **Error-level:** 4 missed / (22 caught + 4 missed) = **~15%**
- **Answer-level:** 4 / 23 error-bearing answers = **~17%**
- Order of magnitude: **~1 in 6 errors slips through.** Wide CI (~5–35%) given n.

### Two failure mechanisms
1. **One-error-stop.** When a translation contains two errors, the evaluator
   itemizes one and the second survives (`adı→adını`, `burunu→burnu`).
2. **Feedback-not-itemized.** The error is described in `feedback` prose but never
   written to the `errors` array (`bakıcı`), so it never becomes an
   `error_observation` regardless of how good the prose is.
   (Plus a dictation-leniency variant where a non-standard form is actively
   justified rather than flagged — `kitab`.)

### Why this matters for the curriculum map (PR #410)
**3 of the 4 misses are on the exercise's own host grammar point** — the worst place
to miss. The map reads *absence of an attributed error* as success, so a missed
host-point error is silently scored as mastery of the very point being drilled.

---

## Recommendations

- **Prompt:** add an explicit instruction to itemize **every** error in the `errors`
  array (not just the most salient), and to mirror any error mentioned in `feedback`
  as a structured entry. Bump `EVALUATION_SYSTEM_PROMPT_VERSION` per CLAUDE.md and
  push to Langfuse (in-repo edit alone won't change runtime behavior).
- **Dictation:** tighten leniency on final-consonant devoicing — don't justify
  non-standard orthography as "phonetic assimilation."
- **Validate before shipping a prompt change** with `pnpm eval` against a Langfuse
  dataset of known-error answers (a Langfuse push only affects future runs; the
  ~04:00 UTC scheduler converges over ~2 days).
- **Widen coverage** before trusting any rate: this audit is TR A1/A2 / 2 users only.

---

*Queries and per-answer judgements were performed read-only against the prod branch;
no data was modified.*
