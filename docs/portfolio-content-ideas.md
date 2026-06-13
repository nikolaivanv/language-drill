# Portfolio Content Ideas — Language Drill

Topics for LinkedIn / Medium articles and videos that demonstrate **product-builder
/ hands-on PM** ability, grounded in what's actually been built and documented in
this repo.

**The lens:** the pieces that land aren't "here's my AI app" — they're stories where
the reader can *see the judgment*: a surprising metric, a fork in the road, a thing
deliberately not built, a number that forced a decision. Each topic below maps to a
specific skill and cites the real material to draw from.

---

## Tier 1 — Flagship stories (strongest narrative arcs)

### 1. "70% of my AI-generated content was getting rejected. The number was lying to me."
**The single best story in the project.** A scheduled run showed a 70% rejection rate.
Digging in: 378 rejections were actually *two unrelated problems* — 202 were duplicate
collisions (capacity/saturation), only 176 were genuine quality failures. They were
indistinguishable because the system logged one flat "rejected" bucket. The fix: add a
`rejection_reason_counts` field (migration 0012) to make invisible failure modes
visible — *then* discover that 119 of 176 quality failures came from **Turkish alone**.

- **Skill shown:** measurement → instrumentation → decision loop. "You can't manage what
  you can't measure," told as a concrete detective story.
- **Concrete material:** `docs/exercise-generation-quality-findings.md`; the
  `rejection_reason_counts` schema field; $0.087/kept exercise (≈$0.29 at 70% reject).
- **Punchline:** product maturity — the fix wasn't "tune the prompt harder."
- **Format:** long-form Medium piece.

### 2. "The bug wasn't in my prompt. It was in the exercise format."
*(Strong standalone, or the second act of #1.)* The Turkish failures traced to a
**format** flaw, not an AI-quality flaw. Partial-word cloze blanks (`köpek` + `___` → `e`)
break on Turkish consonant mutation: the "correct" answer `köpeğe` looks wrong because the
stem softens (`ğ` not `k`). Rather than patch the prompt, the format was redesigned
universally: blank the whole inflected word, give the lemma as a hint
(`Annem her sabah ___ içiyor. (kahve)` → learner types `kahveyi`). One change killed the
dominant failure reason at the source.

- **Skill shown:** domain insight driving a product decision — understanding the
  linguistics deeply enough to recognize a structural problem.
- **Concrete material:** `docs/exercise-generation-quality-findings.md`.
- **Punchline:** "Format beats prompt" — memorable, quotable thesis.
- **Format:** Medium piece, or paired with #1.

### 3. "I built an AI content factory for $170. Here's the unit economics."
The cost architecture: pre-generate a reusable pool (one-time ≈$170 seed) instead of
generating per-user (which explodes cost). Prompt caching (~80% input savings via
`cache_control: ephemeral`), Anthropic Batch API (50% discount, 24h turnaround for
overnight refills), $0.087/kept exercise, ~$40/qtr steady-state replenishment,
demote-only revalidation with a dollar-capped budget (`--max-cost-usd`).

- **Skill shown:** owner-level thinking — cost treated as a first-class product parameter.
- **Concrete material:** `docs/exercise-generation-plan.md`,
  `docs/runbooks/prompt-update-and-revalidate.md`, `docs/theory-generation-plan.md`
  (~$170 exercise seed, ~$17 for 240 theory pages, ~$4.77 to revalidate 900 cloze rows).
- **Punchline:** very few "AI product" posts talk honest unit economics.
- **Format:** Medium piece with a cost diagram.

### 4. "My AI quietly stopped doing half its job — and nothing in my pipeline could see it."
*(New flagship arc — the diversity / coverage-controller cluster, PRs #272/#273/#277/#279.)*
An audit of the live pool found the generator had silently collapsed each grammar point
onto its *easiest surface form*. Turkish tense cells were **100% third-person singular**
(the unmarked, suffix-light form) — so the "add personal endings" half of the grammar
point was literally never tested; the aorist's irregular 1sg/1pl negatives had **zero**
coverage. Spanish `es-b2-compound-tenses`: **47 of 50** answers were the bare auxiliary,
irregular participles (*hecho, visto, escrito*) **never produced** — the cell had silently
narrowed from "compound tenses" to "auxiliary selection." The kicker: this means
**mastery credit was overstating what the learner actually demonstrated** — a content bug
that had become a product-integrity bug. The conceptual key: diversity is a property of a
*set*, invisible to both QC stations — the generator only sees one draft, the validator
only scores one draft. The arc then escalates: point fix (rotate person per draft) →
systematic audit (it's a *class* of bug, 7 flavors) → design a closed-loop coverage
controller (statistical process control over the pool) → **and then deliberately ship only
Phase 0 (measurement), arguing against building the clever controller until the data
proves it's needed.**

- **Skill shown:** distributional thinking; recognizing a measurement-integrity failure;
  and the engineering maturity to design a system and then *not* build it ("80% of the
  value at 20% of the risk").
- **Concrete material:** `docs/pool-diversity-audit.md` (the skew tables, the 6-axis
  taxonomy), `docs/pool-coverage-controller.md` (the SPC framing, "the hard part is the
  coverage *spec*, not the mechanism," the per-bucket doom-loop risk), PR #279's
  measurement-only Phase 0 (`coverage_tags` jsonb, `GET /admin/pool-status`).
- **Punchline:** "You can't measure quality you can't see — and a *set* has properties no
  single item does." Plus the restraint beat: the smartest move was the one not built yet.
- **Format:** long-form Medium piece; pairs naturally as a sequel to #1 (same theme:
  invisible failure modes), or stands alone.

### 5. "I let 36 AI agents rewrite my Turkish grammar curriculum — then rejected a third of their work."
*(New — PR #220, the book-grounded grammar audit.)* All 40 Turkish A1/A2 grammar points
were audited against a single authoritative reference grammar (Göksel & Kerslake's
*Turkish: A Comprehensive Grammar*) used as a correctness oracle: 4 points hand-audited as
proof-of-concept, then **36 points via a 36-agent fan-out** — one agent per point, each
reading its mapped book sections and returning a structured, cited diff. Every proposal was
**editor-vetted before applying.** It caught a flat factual error in shipped content (the
opinion form was listed as *"onca"* — corrected to *"ona göre"*) and pedagogically
meaningful imprecision (accusative marks **definiteness**, not "definite or specific"). But
the real story is the **rejection list**: ~5 agent proposals were thrown out on the
merits — one "negative" example (`*Gelmeyen adam`) was actually a *correct* form; another
duplicated content from a different point. The architectural kicker: this one data file
feeds **three** AI surfaces (generation, validation, theory prompts), so the fix upgraded
all three with no Langfuse prompt-body sync needed.

- **Skill shown:** human-in-the-loop AI orchestration — using agents for breadth, an
  authoritative source for ground truth, and human judgment as the final gate. The
  rejection list is the proof of judgment.
- **Concrete material:** PR #220 (the body lists representative fixes and rejected
  proposals), `packages/db/src/curriculum/tr.ts`, the `CURRICULUM_VERSION_TR` bump that
  clears scheduler suppression so the pool repopulates against the corrected context.
- **Punchline:** "AI scaled the audit; rejecting its work is where the value was."
- **Format:** Medium piece, or a building-in-public video showing the fan-out.

---

## Tier 2 — Product-identity / opinion pieces (high LinkedIn engagement)

### 6. "I built a language app with no streaks, no XP, and no gamification. On purpose."
The positioning thesis: target the *intermediate plateau* ("what you do between italki
sessions"), measure **demonstrated ability vs. CEFR**, not activity. The "what we
deliberately don't build" list — streaks, XP, multiple-choice-first design, delta learning
(learn Italian via Spanish), social features, accent reduction — *is* the content. Saying
no with conviction.

- **Skill shown:** scope discipline and positioning clarity.
- **Concrete material:** `CLAUDE.md` positioning section; `docs/progress-tracking.md`;
  `docs/web-implementation-plan.md` (explicit scope cuts).
- **Punchline:** the scope-cut list is *proof* of product discipline.
- **Format:** punchy LinkedIn post; can point to the long-form #7.

### 7. "How do you measure 'I'm getting better at Spanish'? I borrowed the math from IELTS."
The core differentiator: a 3-layer skill taxonomy (macro-skills → enabling competencies →
granular grammar/vocab points) + a Bayesian / Item-Response-Theory mastery model. CEFR is
shown as a *probability distribution with confidence* ("65% B1 ± half a level, based on 47
exercises"), harder exercises give stronger signal, recency-weighted, knowledge decays
(Ebbinghaus). Exam readiness (DELE/IELTS/Goethe/YDS) is *derived*, not targeted.

- **Skill shown:** depth — grounding the metric in real psychometrics instead of a vanity
  score.
- **Concrete material:** `docs/progress-tracking.md`.
- **Format:** Medium piece with a radar-chart / mastery-map visual.

### 8. "When I tell the learner the answer: the bug that was hiding in plain sight."
*(New — the case-selection-vs-form-production insight, centered on the Turkish accusative.)*
The instruction "Fill in the blank with the correct **accusative** form…" *gives away the
answer* — it conflates two separable skills: **case selection** (which case does this
context need? — the hard, transferable, intermediate-plateau skill) and **form production**
(apply the allomorph). Naming the case removes the harder half entirely. The deeper wrinkle:
Turkish accusative marks **definiteness**, and both `kahve içiyor` ("drinks coffee") and
`kahveyi içiyor` ("drinks *the* coffee") are grammatical — so removing the cue creates
*new* ambiguity unless the context forces definiteness. The fix evolved: first reach for an
English gloss ("the coffee" vs "coffee"), then **reverse course** and make *structural
in-sentence forcing* the preferred device — prior mention forces the case the way real
language does: *"Denizde büyük bir dalga vardı. Çocuklar ___ gördü. (dalga)" → dalgayı*
("There was a big wave. The children saw ___."). The immersion-correct solution beat the
crutch.

- **Skill shown:** linguistic depth driving a pedagogy decision; recognizing that the
  *instruction itself* was leaking the answer, and choosing the harder-but-right fix.
- **Concrete material:** `docs/exercise-generation-quality-findings.md` §7b;
  `packages/ai/src/generation-prompts.ts` (the accusative rule + `dalgayı` worked example);
  the anti-spoil constraint (forcing device lives in context, never in instructions).
- **Punchline:** "If the instruction names the answer, you're testing the wrong skill."
- **Format:** Medium piece; strong domain-credibility signal, pairs with #2.

---

## Tier 3 — Process / "how I work" pieces (great for video / building-in-public)

### 9. "Running an experiment I expected to fail: should I seed AI generation with human sentences?"
The Tatoeba seeding experiment, framed properly: explicit **kill criteria**, success
thresholds (≥5pp pass-rate lift *or* ≥25% drop in a specific failure category, at
≤baseline cost), a manual 50-sentence quality gate before including Turkish, and "null
results are a valid outcome." Plus the licensing reasoning (chose CC-BY 2.0 FR; rejected
CC-BY-NC-SA sources because copyleft/NC conflicts with a commercial tier).

- **Skill shown:** hypothesis-driven product work and the discipline to *not* ship.
- **Concrete material:** `docs/tatoeba-seeding-experiment.md`, `docs/data-sources.md`.
- **Format:** Medium piece or short video.

### 10. "Shipping prompt changes in 5 minutes without a deploy" — building an AI quality flywheel
The AI quality system: generator→validator→router loop (generation temp 0.7 for
productivity, validation temp 0.0 for strictness), deterministic routing thresholds, the
`signFlips` eval metric (the only one that captures "would this answer be routed
differently?"), Langfuse observability across all four call sites, and a prompt registry
that lets you move a `production` label and go live in <5 min (with in-repo fallback if
Langfuse is down).

- **Skill shown:** operational velocity as a product feature; safe iteration on AI systems.
- **Concrete material:** `docs/llm-observability.md`,
  `docs/runbooks/prompt-update-and-revalidate.md`, `docs/exercise-generation-plan.md`.
- **Format:** Medium piece or screen-recorded video walkthrough.

### 11. "How one person ships a portfolio-quality product: spec-driven solo development"
A meta piece on the actual process: spec-per-feature structure (requirements → design →
atomic tasks), phased roadmap with a named critical path, runbooks for risky operations,
and *honest tech-debt logging* (root causes, costs, remediation paths). On-trend for the
"AI-assisted product builder" identity.

- **Skill shown:** repeatable process, prioritization, shipping vs. perfecting.
- **Concrete material:** `.claude/specs/*` (39 specs), `docs/web-implementation-plan.md`,
  `docs/tech-debt.md`.
- **Format:** video or Medium "how I work" piece.

### 12. "Two eval gates, one harness — and the one metric that average quality scores hide."
*(New — the eval framework, deeper than #10's flywheel angle.)* AI quality has two
*different* surfaces that need *different* gates: `pnpm eval` checks the answer-**evaluation**
prompt against a Langfuse dataset of real graded traces; `pnpm eval:gen` checks the
**generation** prompt by generating N drafts per cell across a baseline/candidate arm,
validating and routing each, and reporting approval-rate / rejection-reason deltas. The
insight worth the whole piece: **`signFlips`** — the count of items where candidate and
baseline land on *opposite sides of the 0.5 routing boundary*. Average-delta and p95 latency
can both look fine while the actual *decision* flips; signFlips is the only decision-grade
signal. Add the harness discipline: refuses to touch prod Langfuse without `--allow-prod`,
a cell-boundary `--max-cost-usd` cap that stops *before* the next cell, per-cell fault
isolation, non-zero exit on incomplete comparison so CI fails closed. Plus a real gotcha:
prompt versions are date-only, so same-day edits collapse into one Langfuse cohort — which
is *why* you A/B with eval:gen arms instead of waiting for the scheduler to converge.

- **Skill shown:** building the test infrastructure for non-deterministic systems; knowing
  which metric is decision-grade vs. noise.
- **Concrete material:** `packages/ai/scripts/eval-gen-run.ts`, `eval-run.ts`;
  `docs/llm-observability.md` §7a (the `EvalRunSummary` shape, the diff-metric decision
  table, the 5-min cache TTL); the `verify-prompt-changes-with-eval-gen` workflow.
- **Punchline:** "Your average quality went up 0.01 and your routing flipped on 30% of
  items. Which number do you ship on?"
- **Format:** Medium piece for an AI-engineering audience.

### 13. "Make it cheaper *and* faster: redesigning a feature most users never use."
*(New — deep annotation, PRs #208/#223.)* The reading feature eagerly enriched the ~20
rarest words in any text up front (~175 tokens each), clicked or not — and that one design
fact drove 4 of 5 user complaints. The redesign split it into two tiers that converge on
one card: a **skim pass** demoted to a cheap hint layer (Haiku, per-word output trimmed
~175→~30 tokens) with the cap *raised* 20→50, and a **deep card** generated **on demand**
when you actually tap a word/phrase/sentence (Sonnet, rich, with morphology). The
counterintuitive result: raising the candidate cap while cutting per-word tokens made the
skim pass **both cheaper and faster** — coverage went up, cost went down. The follow-up
(#223) moved the deep card off API Gateway (which buffers the whole ~8–13s response) onto a
streaming Function URL so fields paint progressively — **without changing the contract**
(streamed fields are preview-only; the terminal event carries the same validated card).
Bonus pragmatism: the design brainstorm assumed Redis, but the codebase had no Redis
client, so durability lives in a Postgres jsonb column instead.

- **Skill shown:** spotting that one architectural assumption drove most of the pain;
  optimizing two axes at once; "use what's already there."
- **Concrete material:** `docs/reading-deep-annotation-design.md` (with a "what actually
  shipped" deviations section), `infra/lambda/src/annotate-stream/pipeline.ts`
  (`CANDIDATE_LIMIT`), the Haiku-swap eval gate (`0` sign-flips, documented in
  `.claude/specs/llm-latency-optimizations/`).
- **Punchline:** "The eager pass wasn't expensive because it was big. It was expensive
  because it guessed."
- **Format:** Medium piece or video.

### 14. "A cell that made 144 drafts to keep 8: the case for smaller targets."
*(New — vocab umbrellas, PR #262; the tightest unit-economics micro-story.)* A single broad
`everyday-vocab` cell exhausts its realistic distinct-word surface fast, so chasing a 60–75
target just burns tokens on duplicate collisions. Prod evidence: one Turkish vocab cell
produced **144 drafts → 8 approved → 28 dedup-give-ups — a 6% yield.** The diagnosis: "the
bottleneck is surface exhaustion, not validation." Two complementary levers: **cap the
vocab target at 10**, and **split one broad umbrella into 10 themed ones** (family-people,
food-drink, weather-clothing…). The reframe: "lower per-cell target × more cells = breadth
without token waste." Coverage goes *up* while spend goes *down*.

- **Skill shown:** reframing a resource problem (raise the target → burn tokens) into a
  structural one (add narrower cells); scoping the fix to where the evidence is (TR only).
- **Concrete material:** PR #262 (the 144→8 prod-evidence line), `cell-targets.ts`
  (the `VOCAB_RECALL: { A1:10, … }` block with its inline rationale comment).
- **Punchline:** "More coverage for less money by aiming lower." Great companion to #3.
- **Format:** short LinkedIn post or a section of the unit-economics piece.

---

## Tier 4 — Auditing my own product (honest self-critique — rare and credible)

*These come from `docs/exercise-strategy-assessment.md`,
`docs/generation-pipeline-pedagogical-assessment.md`, and `docs/audit-2026-06-12.md` —
where the project was assessed against SLA research and engineering best practice. Writing
publicly about what your own product gets wrong is unusual and signals real maturity.*

### 15. "My item bank is psychometric-grade. My delivery of it isn't pedagogy yet."
The sharpest self-assessment in the project: *"The item bank is pedagogically excellent;
the delivery of it is not yet pedagogy."* Enormous care goes into making each item measure
exactly one grammar point (construct validity, distributional batch controls,
whole-word-blank reasoning) — and then everything downstream is a **random draw at a
user-chosen difficulty**: no mastery model drives selection, the authored prerequisite
graph (`prerequisiteKeys`) is consumed by nothing, and already-seen items can be re-served
(inflating the mastery signal without a real retention test). The same gap shows up in the
engineering audit as `ORDER BY random()` on pool selection — fine at hundreds of rows, a
cliff at tens of thousands. Two angles, one line of code: the best-built part of the system
feeds a deliberately dumb serving layer.

- **Skill shown:** the discipline to audit your own work and name the asymmetry; knowing
  that data hygiene (stop re-serving items) must land *before* the smart adaptive layer, or
  the model trains on contaminated evidence.
- **Concrete material:** `docs/generation-pipeline-pedagogical-assessment.md`
  (the thesis + the dead prerequisite graph + the exposure-control bug),
  `docs/audit-2026-06-12.md` §2.2 (`ORDER BY random()`).
- **Punchline:** "I spent the effort measuring each item perfectly, then didn't use the
  measurement to decide what to show next."
- **Format:** Medium piece — honest "here's my v1's biggest gap and why I sequenced it
  that way."

### 16. "I removed every streak and XP bar. That created a retention problem exactly where my product is supposed to help."
The anti-gamification stance has a sharp consequence: with no streaks/XP, motivation rests
entirely on **visible competence growth** — which makes the progress dashboard load-bearing
*precisely at the plateau*, the moment mastery genuinely stalls and the app exists to break.
If progress isn't visibly moving, users churn at exactly the hard part. The honest fix isn't
to add streaks back — it's to surface *effort-based* facts ("147 sentences produced this
month") that move even in weeks when mastery doesn't.

- **Skill shown:** following a principled product decision to its uncomfortable second-order
  consequence — and refusing the easy walk-back.
- **Concrete material:** `docs/exercise-strategy-assessment.md` (the motivation-tightrope
  section, grounded in self-determination theory).
- **Punchline:** "Saying no to gamification was right. Pretending it had no cost would be
  wrong."
- **Format:** opinion LinkedIn post; a natural sequel to #6.

### 17. "My whole progress model trusts an LLM's scores as ground truth. That's the hidden foundation risk."
The entire CEFR-mastery model consumes Claude's per-dimension scores as if they were
noise-free measurement — but LLM graders have run-to-run variance, length-leniency bias,
and severity drift across prompt versions. The unsettling part: **a `promptVersion` bump can
silently re-calibrate every user's mastery** by shifting the score *population*. The eval
infra (`pnpm eval`, signFlips, Langfuse cohorting) exists — but it was built to gate prompt
changes, and was never connected to the progress model's validity. A related thread: the
app claims to estimate four macro-skills (Listening/Reading/Writing/Speaking) while only
*generating evidence for Writing* — the other three are extrapolations.

- **Skill shown:** identifying the load-bearing assumption nobody questions; connecting an
  existing tool (eval harness) to an unaddressed risk (measurement drift).
- **Concrete material:** `docs/exercise-strategy-assessment.md` (LLM-as-grader section,
  the four-skills extrapolation), `docs/llm-observability.md` (the eval/cohorting infra).
- **Punchline:** "The most sophisticated thing in my app is built on the one input I never
  validated."
- **Format:** Medium piece for an AI-product audience — "what 'LLM-as-judge' quietly
  assumes."

### 18. "The single highest-leverage thing I could add to my AI app was a 15-line billing alarm."
The product has sophisticated *app-level* cost brakes (`AI_KILL_SWITCH`,
`AI_GLOBAL_DAILY_CAP`) — but no AWS-level cost visibility, and "the kill switch can't stop a
runaway Lambda loop." The audit's verdict: for a solo-operated AI product, the billing
alarm is the highest-leverage operational addition, and it's ~15 lines of CDK. Pair it with
the audit's *right-sizing* judgments: prompt injection into the evaluator is real but
bounded ("a malicious answer can at most flatter its own score — an accepted risk for a
self-assessment product"), and the metering race that can overshoot the daily cap is left as
a *documented, accepted* imprecision rather than over-engineered away. The meta-story: this
audit was itself run as **five parallel read-only agents with an adversarial verification
pass** — findings the verification couldn't confirm were dropped.

- **Skill shown:** operational maturity — knowing the cheap high-leverage fix, and
  right-sizing risk instead of cargo-culting every security finding; plus LLM-orchestrated
  auditing with a verification gate.
- **Concrete material:** `docs/audit-2026-06-12.md` (the billing-alarm recommendation, the
  prompt-injection right-sizing, the metering-race accepted-imprecision, the methodology
  note).
- **Punchline:** "The fanciest cost controls in the app couldn't catch the dumbest failure:
  a loop I never see the bill for."
- **Format:** LinkedIn post or short "lessons from auditing my own infra" piece.

---

## Recommended sequencing

1. **Flagship (Medium):** combine **#1 + #2** — the rejection-rate detective story →
   format redesign. Most complete arc, uniquely yours, pull exact numbers and the Turkish
   example straight from the docs.
2. **Flagship sequel (Medium):** **#4** "stopped doing half its job" — the diversity /
   coverage-controller arc. Same theme as #1 (invisible failure modes), one tier up in
   sophistication, with the rare "designed it, then chose not to build it" restraint beat.
3. **Engagement (LinkedIn):** **#6** "no streaks" — short, punchy, points back to the
   flagship and to #7; then **#16** as its uncomfortable sequel.
4. **Distinctive / un-mined (Medium or video):** **#5** "36 agents + a book" — the
   strongest human-in-the-loop AI story; nothing else in the portfolio covers it.
5. **Credibility (Medium):** **#8** "naming the answer is the bug" and **#15** "item bank
   vs. delivery" — the two pieces that most prove domain depth and self-honesty.
6. **Companion (video):** **#11** spec-driven solo dev, optionally paired with **#12**
   (the eval harness) for an AI-engineering audience.

Then mine Tier 1 #3 (unit economics, with #14 as a tight companion) and Tier 2 #7 (the
mastery model) as the depth follow-ups. Tier 4 (#15–#18) is a distinct, credible flavor —
"I audited my own product" — best released *after* the build stories establish what was
built.
