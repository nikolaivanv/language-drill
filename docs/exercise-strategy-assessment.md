# Exercise Strategy — Pedagogical Validity Assessment

_An assessment of `docs/exercise-strategy.md` against second-language-acquisition (SLA)
and learning-science research. Written 2026-06-12._

## Verdict

The strategy is **fundamentally sound for its stated audience** (intermediate-plateau
learners who already get input and instruction elsewhere). The core bets — forced
production, evaluation-as-learning-moment, evidence-based mastery tracking, interleaved
sessions, honest hint weighting — are all well supported by research. The catalogue is
unusually coherent: each exercise type maps to a named competency, and the signal-strength
hierarchy (free production > elicited production > recognition) matches how SLA
researchers actually rank evidence of acquisition.

The main weaknesses are not in what the document includes but in what it omits or
defers: **input and fluency work are structurally underweighted**, the listening
macro-skill arrives very late relative to its role in the CEFR estimate, and the entire
progress model leans on **LLM grading as if it were noise-free measurement**. None of
these invalidate the approach; all three deserve explicit mitigation.

---

## What the research supports

### 1. Production over recognition — the central bet is correct

The "production test" design filter is the strongest part of the document.

- **Output hypothesis (Swain).** Producing language forces syntactic processing that
  comprehension alone does not — learners can understand input via lexical/contextual
  shortcuts and never process grammar. Forced production exposes the gap. This is
  precisely the plateau mechanism the doc describes ("can understand but freeze when
  producing").
- **Retrieval practice / testing effect (Roediger & Karpicke).** Effortful recall beats
  re-exposure for retention, and free recall beats cued recall beats recognition. The
  doc's signal hierarchy — free writing > sentence construction > cloze > error
  correction (partially recognition, explicitly down-weighted) — mirrors this exactly.
- **Generation effect & desirable difficulties (Bjork).** Typing an answer into a free
  text field is a desirable difficulty relative to tapping an option. Using multiple
  choice only as scaffolding, with reduced score weight, is the right treatment.

### 2. The adaptive engine matches learning science

- **60–80% target success rate.** Close to the empirically derived optimum
  (the "85% rule," Wilson et al. 2019, finds ~15% error rate optimal for learning).
  Targeting 60–80% is slightly harder than that optimum, which is defensible for
  retrieval practice (harder retrieval → stronger retention) but worth tuning against
  observed drop-off — sustained 60% success is discouraging for some learners.
- **Interleaving.** "Mix exercise types within a session ... test transfer" is
  well-supported (interleaving beats blocking for grammar learning; Rohrer, Pan).
  The session rule "3+ right in a row on a point → move on" implements this cheaply.
- **Spacing and decay.** Recency-weighted mastery with Ebbinghaus-style decay plus
  SM-2 scheduling is standard and effective for vocabulary. (Caveat: SM-2 is validated
  for discrete item recall; applying it to *grammar points* is a reasonable
  extrapolation, not established practice — the Bayesian mastery layer compensates.)
- **Zone of proximal development targeting** (mastery 0.3–0.7 selection band) is a
  sensible operationalization, and the prerequisite-surfacing rule for <0.3 prevents
  the classic adaptive-system failure of drilling learners on things they lack the
  foundation for.

### 3. Hint design is unusually honest

The progressive-disclosure hint ladder with *score-weight reduction but never mastery
punishment* is exactly right:

- Hint-assisted success is weaker evidence, not negative evidence — this matches
  measurement logic and avoids punishing help-seeking, which research on
  help-avoidance in ITS systems (Aleven et al.) identifies as a real failure mode.
- "Show answer" always visible + reveal schedules a near-term review: converts a failed
  production attempt into a future retrieval opportunity instead of a dead end.
- The doc consistently notices when a hint *changes the construct being measured*
  (cloze + multiple-choice pills "reduces the exercise to recognition") and adjusts
  the signal weight. Most commercial apps do not do this.

### 4. Specific exercise types with strong evidence behind them

- **Task-Based Role-Play (#13)** is the best-evidenced addition: task-based language
  teaching (Long, Ellis, Skehan) has decades of support, and goal-completion under
  communicative pressure is the closest proxy for real competence in the catalogue.
  Weighting *task achievement* heavily is correct TBLT practice. The decision to meter
  live generation rather than fake it with branch trees is also pedagogically right —
  scripted trees destroy the negotiation-of-meaning that makes tasks work.
- **Translation (#2), L1→L2.** Translation was unfashionable for decades but has been
  rehabilitated for intermediate+ learners (Cook, *Translation in Language Teaching*).
  As a production elicitation device with meaning-based (not exact-match) grading, it's
  sound — and it's one of the few formats that can *force* a specific structure.
- **Contextual Paraphrase (#10)** directly trains circumlocution and lexical access
  flexibility — a hallmark plateau deficit. "Rewrite three ways" is a genuine range
  probe that almost nothing on the market tests.
- **Picture Description (#12)** is correctly justified: zero brainstorming load means
  all cognitive budget goes to language (cognitive load theory), and the
  information-gap variant is a classic, well-evidenced task type.
- **Vocabulary from own encounters (word bank).** Context-bound, self-relevant
  vocabulary with the source sentence stored aligns with the involvement load
  hypothesis (Laufer & Hulstijn) and beats generic frequency-list drilling. Layering
  it *on top of* frequency-band tracking (rather than replacing it) is the right call.
- **"Absence of evidence, not evidence of absence"** for unused grammar in free
  writing is methodologically correct and a subtle point most systems get wrong.

---

## Gaps and risks

### 1. Input is structurally underweighted (most significant gap)

Nation's **four strands** framework — the most widely used balance heuristic in
language pedagogy — allocates roughly equal time to (a) meaning-focused **input**,
(b) meaning-focused **output**, (c) language-focused learning, and (d) **fluency
development**. The catalogue is ~90% strands (b) and (c):

- **Listening** arrives in Phase 5, after ten text-production exercise types.
- **Reading** is never a first-class exercise; Layer 3 ("paste a text") is a vocabulary
  capture device, not comprehension practice. (The `read/annotate` endpoints in the
  app partially cover this, but the strategy doc doesn't integrate them.)

The positioning ("what you do between italki sessions" — input and interaction happen
elsewhere) is a legitimate defense, and production *is* the plateau bottleneck. But
the doc should state this division of labor explicitly as an assumption, because it
has consequences: the CEFR estimate claims to cover four macro-skills while the app
only generates evidence for Writing (and later Speaking). Until Phase 5, **Listening
and Reading estimates are extrapolations from production data** and should be displayed
with much wider confidence intervals or marked "no direct evidence."

### 2. No fluency-development strand at all

Every exercise targets the 60–80% difficulty band — i.e., everything is *hard*.
Fluency development requires the opposite: high-speed, high-accuracy work with
**already-known** material (timed retrieval, 4/3/2-style repeated production, speed
pressure on mastered items). For plateau learners, slow-but-accurate production is
the defining symptom; accuracy drills alone don't fix it. Cheap fix within the
existing architecture: a "fluency mode" that re-serves mastered (>0.8) items with a
timer and tracks response latency as a first-class metric. The doc tracks latency
nowhere except speaking fluency ratios.

### 3. LLM evaluation is treated as noise-free measurement

The entire progress model — Bayesian mastery updates, CEFR distribution, adaptive
selection — consumes Claude's scores as ground truth. Known issues:

- LLM graders show run-to-run variance, severity drift across prompt versions, and
  systematic biases (length leniency, harshness on valid-but-unusual phrasings).
- A `promptVersion` bump (which the project does correctly track) can shift the
  *population* of scores and silently re-calibrate everyone's mastery.

Mitigations worth adding to the doc: model per-evaluation noise in the Bayesian
update (the confidence machinery exists; feed it grader-reliability priors), anchor
score calibration with the existing Langfuse eval pipeline per prompt version, and
treat single-evaluation swings as low-information by design. The infrastructure
(`pnpm eval`, datasets, prompt versioning) already exists — the strategy doc just
never connects it to the progress model's validity.

### 4. Error Correction (#5): mixed evidence, plus an exposure concern

- The written-corrective-feedback literature is genuinely contested (Truscott's
  critiques vs. Ferris; later meta-analyses find moderate positive effects for
  *focused* feedback). The doc's design — realistic L1-interference errors, two-part
  identify+fix scoring, down-weighted mastery signal — lands on the defensible side.
- One unaddressed risk: deliberately exposing learners to incorrect forms can
  reinforce them if the correction step fails (errors are visually salient; the fix
  may not be). Mitigation: always end the exercise by displaying the fully corrected
  sentence prominently, and avoid this type for forms the learner hasn't yet
  encountered correctly. The "no errors" trap design is good (guards against
  hypercorrection).

### 5. Pronunciation via Transcribe confidence is a weak proxy

The doc already hedges ("as a proxy"), correctly. ASR confidence conflates accent,
audio quality, vocabulary rarity, and disfluency. Fine as a coarse trend signal;
should never drive specific phonology feedback ("your /θ/ is wrong") because the
data cannot support that resolution. The content-70/delivery-30 weighting sensibly
limits the damage.

### 6. Smaller calibration notes

- **"B2 requires ~4K active words"** — receptive-vocabulary research (Nation, Milton)
  puts B2 around 3.5–4.5K word *families* receptively; *active* vocabulary runs
  meaningfully lower. The threshold is fine as an internal heuristic but shouldn't be
  surfaced to users as a hard requirement.
- **Grammar avoidance at C1+.** "Avoided structures → no change" is right at B1, but
  at C1/C2 systematic avoidance across many samples *is* evidence (avoidance behavior
  is a recognized learner strategy). A long-horizon "expected but never observed"
  signal could eventually feed the estimate — low priority.
- **Dictation (#7)** is stronger than the doc sells it: it's one of the best-evidenced
  integrative listening exercises (forces parsing of connected speech, not gist-guessing).
  Worth prioritizing within Phase 5.
- **Session-end "win"** and no-streaks/no-XP: motivation design rests entirely on
  visible competence growth (self-determination theory's competence need). That's a
  coherent intrinsic-motivation bet for the target persona, but it makes the progress
  dashboard load-bearing for retention — progress must be *visibly* moving even in
  weeks where mastery genuinely plateaus, or users churn at the exact plateau the app
  exists to break. Consider surfacing effort-independent evidence ("147 sentences
  produced this month") which is factual, not gamified.

### 7. Sequencing critique

Phases 1–4 are eleven consecutive text-based exercise types before any audio. For a
"polyglot at varying levels" persona this is fine; for the broader plateau persona,
speaking is the #1 stated pain ("freeze when they need to produce it" — usually
*aloud*), and it arrives in Phase 6. The technical justification (Transcribe pipeline
complexity) is real, but consider pulling the **read-aloud** speaking sub-type forward:
it needs no evaluation sophistication (reference text is known), exercises the
production-under-pressure muscle, and would let the app touch its core promise earlier.

---

## Summary scorecard

| Dimension | Assessment |
|---|---|
| Core thesis (production-first for plateau learners) | **Strong** — output hypothesis, retrieval practice, generation effect all align |
| Exercise catalogue coverage of competencies | **Strong** — coherent mapping, correct signal-weight hierarchy |
| Adaptive difficulty & session design | **Strong** — near-optimal success-rate target, interleaving, ZPD selection |
| Hint/scaffolding design | **Strong** — honest signal weighting, no help-avoidance traps |
| Vocabulary model | **Strong** — context-bound personal bank + frequency tracking |
| Input (listening/reading) balance | **Weak** — defensible given positioning, but assumption must be explicit; CEFR claims outrun evidence until Phase 5 |
| Fluency development | **Missing** — no speed/automaticity work on mastered material |
| Measurement validity (LLM-as-grader) | **Under-addressed** — noise/drift not modeled in the Bayesian layer despite existing eval infra |
| Implementation sequencing | **Reasonable** — consider pulling read-aloud speaking forward |

## Recommended actions (in priority order)

1. **Model grader noise.** Feed per-prompt-version reliability (from the Langfuse eval
   pipeline) into the Bayesian update as evidence weight; widen CEFR confidence
   intervals for macro-skills with no direct evidence.
2. **Add a fluency mode.** Timed re-serving of >0.8-mastery items; track response
   latency as a progress metric. Low build cost, fills the missing fourth strand.
3. **State the input assumption.** One paragraph in the strategy doc: "input and
   interaction happen outside the app; we measure but do not train Listening/Reading
   until Phase 5" — and reflect that honestly in the dashboard.
4. **Pull read-aloud forward** from Phase 6 as a minimal speaking entry point.
5. **Error-correction guardrail:** always close with the prominent corrected form;
   restrict to grammar points with prior correct exposure.
