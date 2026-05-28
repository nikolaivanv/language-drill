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

---

## Tier 2 — Product-identity / opinion pieces (high LinkedIn engagement)

### 4. "I built a language app with no streaks, no XP, and no gamification. On purpose."
The positioning thesis: target the *intermediate plateau* ("what you do between italki
sessions"), measure **demonstrated ability vs. CEFR**, not activity. The "what we
deliberately don't build" list — streaks, XP, multiple-choice-first design, delta learning
(learn Italian via Spanish), social features, accent reduction — *is* the content. Saying
no with conviction.

- **Skill shown:** scope discipline and positioning clarity.
- **Concrete material:** `CLAUDE.md` positioning section; `docs/progress-tracking.md`;
  `docs/web-implementation-plan.md` (explicit scope cuts).
- **Punchline:** the scope-cut list is *proof* of product discipline.
- **Format:** punchy LinkedIn post; can point to the long-form #5.

### 5. "How do you measure 'I'm getting better at Spanish'? I borrowed the math from IELTS."
The core differentiator: a 3-layer skill taxonomy (macro-skills → enabling competencies →
granular grammar/vocab points) + a Bayesian / Item-Response-Theory mastery model. CEFR is
shown as a *probability distribution with confidence* ("65% B1 ± half a level, based on 47
exercises"), harder exercises give stronger signal, recency-weighted, knowledge decays
(Ebbinghaus). Exam readiness (DELE/IELTS/Goethe/YDS) is *derived*, not targeted.

- **Skill shown:** depth — grounding the metric in real psychometrics instead of a vanity
  score.
- **Concrete material:** `docs/progress-tracking.md`.
- **Format:** Medium piece with a radar-chart / mastery-map visual.

---

## Tier 3 — Process / "how I work" pieces (great for video / building-in-public)

### 6. "Running an experiment I expected to fail: should I seed AI generation with human sentences?"
The Tatoeba seeding experiment, framed properly: explicit **kill criteria**, success
thresholds (≥5pp pass-rate lift *or* ≥25% drop in a specific failure category, at
≤baseline cost), a manual 50-sentence quality gate before including Turkish, and "null
results are a valid outcome." Plus the licensing reasoning (chose CC-BY 2.0 FR; rejected
CC-BY-NC-SA sources because copyleft/NC conflicts with a commercial tier).

- **Skill shown:** hypothesis-driven product work and the discipline to *not* ship.
- **Concrete material:** `docs/tatoeba-seeding-experiment.md`, `docs/data-sources.md`.
- **Format:** Medium piece or short video.

### 7. "Shipping prompt changes in 5 minutes without a deploy" — building an AI quality flywheel
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

### 8. "How one person ships a portfolio-quality product: spec-driven solo development"
A meta piece on the actual process: spec-per-feature structure (requirements → design →
atomic tasks), phased roadmap with a named critical path, runbooks for risky operations,
and *honest tech-debt logging* (root causes, costs, remediation paths). On-trend for the
"AI-assisted product builder" identity.

- **Skill shown:** repeatable process, prioritization, shipping vs. perfecting.
- **Concrete material:** `.claude/specs/*` (39 specs), `docs/web-implementation-plan.md`,
  `docs/tech-debt.md`.
- **Format:** video or Medium "how I work" piece.

---

## Recommended sequencing

1. **Flagship (Medium):** combine **#1 + #2** — the rejection-rate detective story →
   format redesign. Most complete arc, uniquely yours, pull exact numbers and the Turkish
   example straight from the docs.
2. **Engagement (LinkedIn):** **#4** "no streaks" — short, punchy, points back to the
   flagship and to #5.
3. **Companion (video):** **#8** spec-driven solo dev, if also doing video.

Then mine Tier 1 #3 (unit economics) and Tier 2 #5 (the mastery model) as the depth follow-ups.
