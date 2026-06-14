# Exercise Generation Pipeline — Pedagogical Assessment

_An assessment of the **implemented** generation pipeline (as of 2026-06-12) from a
pedagogical standpoint. Companion to `exercise-strategy-assessment.md`, which assessed
the strategy document; this assesses what the code actually does._

## What is actually built

- **Generation:** a nightly scheduler enumerates cells `(language × CEFR × exercise
  type × grammar point)`, tops each up to a per-cell target
  (`infra/lambda/src/generation/cell-targets.ts`), bounded by a per-cell cost cap.
  The generator prompt (`packages/ai/src/generation-prompts.ts`) is grounded in a
  hand-authored curriculum entry: grammar-point description, positive **and**
  negative examples, common learner errors, CEFR descriptors, plus a long list of
  item-construction constraints. Per-draft variation comes from topic-domain
  rotation, frequency-seeded vocabulary, and (for sentence construction) a
  deterministic keywords/situation/grammar_target mode rotation.
- **Validation:** a second Claude pass at temperature 0
  (`packages/ai/src/validation-prompts.ts`) scores quality (anchored rubric),
  ambiguity, answer-spoiling, level match, grammar-point match, and cultural issues.
  Routing: `<0.5` reject, `0.5–0.7` flag for human review, `≥0.7` + all booleans
  clean → auto-approve. Deterministic Turkish vowel-harmony/stem checks can only
  downgrade a decision.
- **Curriculum:** ~59 Turkish points (A1–B2, incl. vocab umbrellas), 23 Spanish and
  23 German (B1–B2 only), each with `prerequisiteKeys` and per-type suitability
  flags (`clozeUnsuitable`, `sentenceConstructionSuitable`).
- **Serving:** `GET /exercises` and the 5-item today-plan both draw **randomly** from
  the approved pool filtered by `(language, user-chosen difficulty, type)`. The plan
  shape is fixed: warm-up cloze, core cloze, production translation, vocab,
  cool-down cloze (`infra/lambda/src/lib/today-plan.ts`); adaptive weighting is an
  explicitly deferred parameter.
- **Vocabulary review:** a separate, genuinely adaptive loop — FSRS scheduling
  (`ts-fsrs`) with a maturity-driven item-type policy
  (`infra/lambda/src/lib/review/item-select.ts`): new → recognition warm-up,
  learning → cloze-in-context, mature → meaning→production.
- **Theory:** a weekly pipeline generates one validated theory page per grammar point.

---

## Verdict

**The item bank is pedagogically excellent; the delivery of it is not yet pedagogy.**
The generation/validation half implements item-writing discipline at a level most
commercial apps never reach — construct validity, anti-leak rules, error-informed
authoring, conservative two-stage QC. But everything downstream of the pool is
random draw at a user-chosen difficulty: no mastery model drives selection, the
curriculum's prerequisite graph is never consulted, already-seen items can be
re-served, and the most production-rich implemented type (sentence construction)
never appears in the daily plan. The strategy doc's core promise — "grading drives
what the student sees next" — exists only in the vocabulary review loop.

---

## Strengths (and the research they align with)

### 1. Construct validity discipline in item authoring — the standout

The generation prompt enforces, item by item, what psychometricians call construct
validity: each exercise must be solvable **only** by applying the targeted grammar
point, and by nothing else.

- **"Stay on target"** — a blank that incidentally obeys the rule while actually
  testing a different point (locative `-DA` in a vowel-harmony cell) is rejected.
  This keeps the per-point mastery signal clean, which is the precondition for the
  whole evidence-based tracking model.
- **Anti-ambiguity with enumeration** ("one correct fill, or enumerate them") and
  the **anti-leak/anti-spoil** rules prevent the two classic cloze failure modes:
  unfair items (multiple defensible answers scored wrong) and trivial items (answer
  derivable without engaging the grammar). Both failures corrupt the learning signal
  *and* learner trust; the prompt treats them as hard vetoes.
- **Whole-word blank rule** is linguistically exactly right: suffix-only blanks
  either display a citation stem that makes the correct fill wrong, or display the
  mutated stem and thereby leak the irregularity — and mixing conventions leaks
  *which* words are irregular. This level of reasoning about what an item silently
  teaches is rare.
- **Turkish case-forcing devices** (prior mention to force accusative definiteness,
  motion verbs to force dative/ablative) show real understanding that an item must
  make the target form *communicatively necessary*, not just permissible — the
  difference between a grammar drill and a focused production task (what SLA calls
  a "focused task," Ellis).

### 2. Error-informed authoring

Every curriculum point carries `commonErrors` and negative examples, injected into
both generator ("for awareness only, do not include") and validator ("the exercise
should expose these, not propagate them"). This implements the
contrastive-analysis/interference insight from the strategy doc — and the handling
is correct on both sides: the generator is warned without being allowed to model
errors, and the validator explicitly checks that model answers don't propagate them
(a real failure observed in the first sentence-construction run, then fixed).

### 3. Construct-irrelevant difficulty is controlled

The vocabulary-band rule — every content word at or below the cell's CEFR level,
only the target construction may be hard — is textbook control of
construct-irrelevant variance. A learner failing a B1 grammar item because of a C1
content word would produce a false negative in the grammar mastery signal. Few
materials, human-authored included, control this systematically.

### 4. Two-stage QC with measurement-aware routing

The validator rubric is anchored (explicit meaning for 0.5/0.65/0.8/0.9/1.0, with
"do NOT default to 0.7 as a looks-OK floor"), the routing is conservative, and the
stated rationale — "an auto-approved bad draft corrupts the learner's progress
model" — is precisely the right framing: bad items are measurement noise, not just
bad UX. The flagged-for-human-review middle band, deterministic morphology checks
that can only downgrade, and the dedup index all add independent safety layers.

### 5. Domain coverage is engineered, not assumed

The vowel-harmony cell constraint (≥3 of 4 high-vowel slots via non-plural suffixes,
plural blanked in <50% of the batch) prevents the generator from collapsing a broad
grammar point onto its easiest surface form — a content-validity failure that pure
per-item validation cannot catch, since every individual item looks fine. Catching a
*distributional* failure mode and constraining it at batch level is sophisticated.

### 6. The vocabulary review loop is the pipeline at its best

FSRS (a genuine upgrade over the SM-2 the strategy doc promised) plus the
maturity→item-type ladder — recognition for new items, cloze-in-context while
learning, meaning→production once mature — implements *increasing desirable
difficulty as retrieval strength grows*, which is exactly what retrieval-practice
research prescribes. Excluding morphology-dependent cloze for phrase cards is a
correct construct decision. This loop is what the rest of the serving layer should
eventually look like.

### 7. Empirical feedback culture

The sentence-construction pilot brake (cap targets at 25 until `eval:gen` confirms
the prompt fix), approval-rate monitoring per cell, failure-mode-driven prompt
revisions with cohort-tagged versions — the pipeline treats content quality as an
empirical question, not a one-time authoring task. That is the right epistemics for
LLM-generated teaching material.

---

## Gaps and risks

### 1. Serving is random — the adaptive engine does not exist yet (biggest gap)

Selection is `ORDER BY random()` over `(language, difficulty, type, approved)`:

- **No mastery-based targeting.** The strategy doc's growth-zone selection
  (mastery 0.3–0.7), weakness amplification, and difficulty calibration are all
  unimplemented; the today-plan's adaptive hook (`_radarSnapshot`) is a deliberate
  no-op. Per-grammar-point mastery is not tracked at all — progress aggregation
  rolls history into six radar axes, not into the per-point map the curriculum's
  granularity is designed for.
- **The prerequisite graph is dead data at serve time.** `prerequisiteKeys` is
  authored across all three curricula and consumed by nothing outside the curriculum
  package. A learner can be served `tr-a2-reported-speech` without ever having seen
  evidence on its prerequisites — exactly the failure the strategy doc's
  "prerequisites are missing" rule was written to prevent.
- **Difficulty is user-declared, not estimated.** The CEFR level comes from the
  request, so the 60–80% success-rate targeting cannot happen even in principle
  until an estimate exists.

None of this is *wrong* for a v1 — random draw from a high-quality, level-tagged
pool is a defensible cold-start — but it means the pipeline's meticulous per-point
signal hygiene currently feeds a progress display, not a learning loop. The
asymmetry is striking: enormous care that each item measures exactly one grammar
point, then no use of that measurement to decide what to serve.

### 2. No per-user exposure control

Neither the random exercise endpoint nor the today-plan sample excludes exercises
the user has already attempted (`user_exercise_history` is only used for
counting/status). With per-cell pools of 10–30 items, a daily user will see repeats
within weeks. Repeats are not pedagogically worthless — but an *unscheduled* repeat
is: re-answering a remembered item inflates the mastery signal (practice effect)
without the retention test that makes spaced repetition work. Fix is cheap (anti-join
on history, fall back to least-recently-seen when the pool is exhausted) and should
land before any mastery model does, or the model trains on contaminated evidence.

### 3. The daily plan under-uses production

The fixed shape is 3× cloze + 1 translation + 1 vocab. Cloze is the *most
constrained* production format in the catalogue, and sentence construction — the
most open production type actually implemented and generated — never appears in the
plan (it's reachable only via direct exercise fetch). For a product whose thesis is
"forced production breaks the plateau," the default daily experience is 60%
fill-in-the-blank. A one-line change (swap a core cloze slot for sentence
construction once its pilot validates) would materially raise the production load of
the default session.

### 4. Single same-family judge for validation

Generator and validator are the same model family; correlated blind spots are the
known weakness of self-review (a plausible-but-wrong Turkish form the generator
produces is more likely to also look right to the validator). Current mitigations
are real — temperature 0, anchored rubric, deterministic harmony checks, human
review of the middle band — but the deterministic checks exist only for Turkish
morphology. The strongest cheap additions: (a) spot-check auto-approved items via
the existing eval pipeline with a different judge configuration, and (b) treat
learner-side evidence as a QC backstop — an approved item where many users score
anomalously low (or where the real-time evaluator repeatedly accepts answers outside
`acceptableAnswers`) should be auto-flagged back into review. The submission data
for this already exists.

### 5. `levelMatch` is asserted, never measured

Item difficulty is an LLM boolean against CEFR descriptors at authoring time, and is
never revisited. LLMs are known to be noisy CEFR raters, and authored difficulty is
a weak proxy for empirical difficulty everywhere (this is why testing programs pilot
items). The pipeline already stores every attempt with a score — per-item observed
success rates would cost one aggregation query and could (a) demote items whose
empirical difficulty contradicts their tag and (b) eventually replace the declared
difficulty with a calibrated one. Until then, treat `levelMatch` as a sanity check,
not a measurement.

### 6. Curriculum asymmetry vs. the product thesis

Turkish is deep at A1–A2 (the author's current level) while Spanish/German run
B1–B2 only with a third the points. Perfectly rational for the primary user, but it
inverts the positioning: the intermediate-plateau persona is best served in exactly
the languages where the curriculum is thinnest, and the deepest content sits below
the plateau. Worth being deliberate about which language is the *pedagogical*
flagship when sharing the app, and about backfilling ES/DE point counts (23 points
is sparse coverage of B1–B2 grammar for either language).

### 7. Everything is single-point; nothing is cumulative

One grammar point per exercise is the right *measurement* design, but acquisition
research (and the strategy doc itself) expects integration: real production combines
points, and knowing a form in isolation doesn't transfer automatically. Today only
translation incidentally exercises non-target grammar, and no exercise deliberately
recombines previously-mastered points. The planned free-writing type will cover
this; until then, a cheap interim is a generation-side variant that requires the
target point *plus one named mastered prerequisite* (the prerequisite graph would
finally earn its keep).

---

## Summary scorecard

| Dimension | Assessment |
|---|---|
| Item construct validity (anti-ambiguity, anti-leak, on-target) | **Excellent** — psychometric-grade discipline, rare in this product category |
| Error-informed authoring (commonErrors, negative examples) | **Strong** — correct handling on both generator and validator side |
| Difficulty control within items (vocabulary band) | **Strong** — construct-irrelevant variance systematically controlled |
| QC pipeline (two-stage, routing, human review, deterministic checks) | **Strong** — conservative and measurement-aware; same-family-judge risk noted |
| Batch-level domain coverage (vowel-harmony distribution rule) | **Strong** — catches distributional failures per-item review can't |
| Vocabulary review loop (FSRS + maturity→production ladder) | **Excellent** — the model for what serving should become |
| Adaptive selection / mastery-driven serving | **Implemented (v1)** (PR #289) — `user_grammar_mastery` table + asymmetric Bayesian update on submit; today-plan biases grammar-point selection toward low/missing-evidence points and soft-deprioritizes points with unmet prerequisites (the graph is now consulted). Difficulty is still user-declared |
| Exposure control (repeat prevention) | **Implemented** (PR #289) — `freshFirstOrderBy` anti-exposure ordering (never-seen → least-recently-seen → random) on all three pool draws; never starves |
| Production load of default session | **Improved** (PR #289) — sentence construction now occupies the core slot (cloze · SC · translation · vocab · cloze); 2/5 cloze, down from 3/5 |
| Empirical difficulty calibration | **Missing** — `levelMatch` asserted once, never checked against outcomes |

## Recommended actions (priority order)

1. ~~**Per-user exposure control now**~~ — **done** (PR #289): `freshFirstOrderBy`
   ordering (never-seen → least-recently-seen → random) on `GET /exercises`,
   `POST /sessions`, and the today-plan pool sample.
2. ~~**Swap one plan slot to sentence construction**~~ — **done** (PR #289): the SC
   pilot brake was already lifted, so SC now occupies the core slot of the daily plan.
3. **Empirical item statistics** — aggregate per-exercise success rates from
   existing history; auto-flag outliers back into review. Doubles as the missing
   independent check on the validator.
4. ~~**Minimal mastery-aware serving**~~ — **done** (PR #289), beyond the v0 sketch:
   a materialized `user_grammar_mastery` table (asymmetric Bayesian update on submit,
   plus a history-replay backfill) drives today-plan grammar-point selection — gap
   bias toward low/missing-evidence points and a soft prerequisite deprioritize that
   finally consults the curriculum's `prerequisiteKeys` graph.
5. **Backfill ES/DE curricula** toward the plateau persona before widening sharing.
