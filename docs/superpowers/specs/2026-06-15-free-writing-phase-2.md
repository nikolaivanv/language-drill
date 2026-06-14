# Free Writing Drill — Phase 2 Roadmap

_Date: 2026-06-15 · Status: backlog (not yet specced)_

Phase 1 shipped in **PR #293** (the core grading loop: `free_writing` type, rich
Claude evaluation, the `/drill/free-writing` 5-surface flow, hand-seeded
prompts). This doc lists what was intentionally deferred, roughly prioritized.
Each item should get its own brainstorm → spec → plan before building.

Phase-1 design (context + the contracts these build on):
[`2026-06-13-free-writing-drill-design.md`](2026-06-13-free-writing-drill-design.md).

---

## Quick wins (small, do first)

- **Localize the surface chrome.** `fw-brief.tsx` / `fw-corrections.tsx` hardcode
  Spanish labels (`tema`, `registro`, `longitud`, `palabras`, severity `alta` /
  `media` / `baja`), so EN/DE/TR prompts show Spanish UI. Neutralize to the
  app's English UI language (the evaluator already returns English
  headline/summary), or localize per `content` language.
- **Back-navigation on the deep surfaces.** From `corrections`/`compare` there's
  no way back except browser-back (`results` has "write another"). Add a back
  control (the page state machine already supports the transitions).

---

## Major items

### 1. Getting-unstuck helpers (highest value)
The 3 helper buttons render **disabled** today. Build:
- **Brainstorm** — Claude returns a bullet outline (ideas, not sentences) for the
  prompt at the learner's level.
- **Vocabulary boost** — 8–10 useful words/phrases for the topic at level.
- **Start my paragraph** — an opening sentence the learner continues, with
  **reduced score weight** on the provided opener (the bookkeeping is the hard
  part — the evaluator/submit must know which span was scaffolded).

Each is a separate **metered** AI endpoint (new `usage_events` buckets, per-user
daily caps in `infra/lambda/src/usage/limits.ts`, wired through the global
capacity brake). Mobile uses the bottom-sheet pattern from the prototype's
`mwfw-flow1.jsx` `MWFwUnstuck` (segmented control).

### 2. Pre-generation + validation pipeline
Free writing is hand-seeded today and **excluded** from the generation pipeline
(see the `Exclude<ExerciseType, FREE_WRITING>` maps + the explicit throwing
`FREE_WRITING` cases in `generate.ts` / `generation-prompts.ts` /
`validation-prompts.ts`). To bulk-generate prompts per
`(language, CEFR, topic domain)`:
- A `free_writing` generation tool + prompt (re-include it in `TOOL_NAME_BY_TYPE`
  / `GENERATION_TOOL_BY_TYPE`, `parseToolInput`, `canonicalSurface`).
- A validation prompt + routing (prompts are cheap to generate; the value is in
  the evaluation, so validation can be lighter than for cloze).
- An `eval:gen`-style quality gate for generation, and an eval harness for the
  **evaluator** itself (rubric calibration per language — Phase 1 only
  eyeballed the seeded prompts).

### 3. Precise per-grammar-point progress deltas
The results screen shows a static "what this feeds" summary. Replace with the
prototype's real **progress-impact** panel: per-competency before/after mastery
deltas derived from the free text — grammar points used correctly ↑, used
incorrectly ↓, **avoided (expected at level but absent) → no change** (absence of
evidence ≠ evidence of absence). Requires the evaluator to emit grammar-point-level
signals and the Bayesian mastery update to consume them. The overall writing
score already feeds the writing radar axis (Phase 1).

### 4. Exam mode (completion)
The composer timer is **display-only** today. Add: auto-submit on expiry, a
calibrated exam-style prompt set, and the **exam-readiness panel** (DELE
Expresión Escrita / IELTS Writing predictions that exam-style prompts calibrate
directly — omitted from Phase-1 results to avoid fabricated numbers).

### 5. Live required-element detection
The composer's required-element checklist is **static**. Tick elements as the
learner types (e.g. detect ≥2 conditional sentences, contrast connectors). Needs
reliable client-side (or cheap server-side) grammar detection; final judgement
stays with the evaluator's task-achievement criterion.

### 6. Full drill hub (Surface A)
Phase 1 entry is a **featured card** on `/drill`. Build the prototype's
multi-drill picker grid (`fw-hub.jsx`): skill-filter chips, a card per drill type
(free writing featured; reading/speaking "soon"), rewiring the existing session
drills to launch from it. Touches the current `/drill` session page.

---

## Smaller follow-ups
- **Compare actions** — "save improvements to notebook" / "rewrite using these"
  (prototype buttons, omitted in Phase 1 — no handlers yet).
- **Answer length** — `EXERCISE_ANSWER_MAX_CHARS = 2000` covers ≤200-word bands.
  If exam essays >200 words are added, raise it or add a FW-specific cap.
- **Test-fixture fidelity** — already corrected the submit-route FW fixture to
  `cefr`/`note`; keep new fixtures aligned to `FreeWritingEvaluation`.

---

## Reference
- Evaluation contract (errors as exact substrings → client reconstruction):
  Phase-1 design §1–2; the reconstruction invariant lives in
  `apps/web/app/(dashboard)/drill/free-writing/_lib/reconstruct.ts`.
- Prototype assets to port from:
  `docs/superpowers/plans/2026-06-13-free-writing-prototype/` (esp. `fw-hub.jsx`,
  `mwfw-flow1.jsx` for helpers/hub). Porting gotcha: the prototype's base classes
  (`.card`/`.btn`/`.rv-h`/`.chip`) live in its `hifi/styles.css`, not the app —
  they're ported into the route's `free-writing.css`; also remap every bare
  `var(--token)` to the app's `--color-*`/`--radius-*`/`--font-*` namespace.
