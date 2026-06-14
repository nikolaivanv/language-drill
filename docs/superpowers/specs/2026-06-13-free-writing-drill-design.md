# Free Writing Drill — Design (Phase 1)

_Date: 2026-06-13 · Status: approved for planning_

## What this is

A new drill type, **Free Writing**: the learner gets a writing prompt with
constraints (topic, register, length band, required structures), writes a free
paragraph, and Claude grades it on IELTS-style criteria with inline error
markup and an improved version to compare against. It targets the **Writing**
macro-skill and is, per the product spec, "the richest signal source in the
app" — one paragraph touches grammar, vocabulary, discourse and pragmatics.

Design prototype: 7 surfaces (desktop + mobile web), Spanish · B2 demo content
(an argue-for/against-remote-work prompt), one opinionated direction per
surface, inline-error-markup "style 3" (struck-through original + green
correction in place). Source bundle read from Claude Design handoff
(`Free Writing.html`, `Free Writing - Mobile Web.html`, `freewrite/*`,
`mwfreewrite/*`).

## Scope

This spec is **Phase 1**: the core grading loop, end to end, with real Claude
evaluation. Explicitly deferred to **Phase 2** (called out inline below):

- The three "getting unstuck" AI helpers (Brainstorm / Vocabulary boost /
  Start my paragraph) and the reduced-score-weight bookkeeping for a provided
  opener.
- The automatic generation + validation pipeline for bulk prompt creation
  (Phase 1 seeds prompts by hand).
- Precise per-grammar-point progress deltas on the results screen.
- Live auto-ticking of the required-elements checklist as the learner types.
- The full multi-drill "hub" grid (Surface A).

### Decisions taken (from brainstorming)

| Decision | Choice |
|---|---|
| Build scope | Phased — vertical slice (core loop) first |
| Backend depth | Real evaluation; seed prompts manually; no auto gen/validation pipeline yet |
| Helpers | Deferred to Phase 2 (buttons render but disabled / "soon") |
| Entry point | Featured "Free writing — new" card → `/drill/free-writing`; no full hub rebuild |

## Surfaces in Phase 1

| Code | Surface | Phase 1 build |
|---|---|---|
| A | Drill hub | **Minimal** — a featured entry card only, not the full grid |
| B | Prompt brief | Full (topic, register, length, required elements, exam-timer toggle) |
| C | Composer | Full (textarea, live word counter, required-elements checklist shown statically) |
| D | Getting unstuck | Buttons rendered **disabled / "soon"**; panels & endpoints are Phase 2 |
| E | Grading results | Full (4 IELTS criteria + CEFR; "what this feeds" summary instead of precise deltas) |
| F | Inline error markup | Full (errors located in text, type/severity/correction, click to focus) |
| G | Compare | Full (your text beside improved version, upgrades highlighted) |

## Architecture

The existing drill (`/drill`) runs a **multi-item session** of short exercises
(cloze / translation / vocab / sentence-construction), each evaluated to a flat
generic `EvaluationResult`. Free Writing is structurally different: a **single
piece of writing** with its own multi-screen flow and a **much richer
evaluation**. It reuses the data layer (`exercises`, `user_exercise_history`)
and the metering/trace plumbing in the submit route, but adds its own
evaluation path and its own frontend route.

### 1. Shared types (`packages/shared/src/index.ts`)

Add the enum member, guard, and union entry:

```ts
export enum ExerciseType {
  // …existing…
  FREE_WRITING = "free_writing",
}

export type FreeWritingRequiredElement = {
  id: string;
  label: string;       // "Usa al menos dos oraciones condicionales"
  detail?: string;     // "si + imperfecto de subjuntivo → condicional"
};

export type FreeWritingContent = {
  type: ExerciseType.FREE_WRITING;
  instructions: string;
  title: string;       // "El teletrabajo: ¿avance o aislamiento?"
  task: string;        // the task statement shown to the learner
  domain: string;      // "opinión · argumentación"
  register: "informal" | "neutral" | "formal";
  minWords: number;
  maxWords: number;
  suggestedMinutes?: number;   // exam-mode countdown length
  requiredElements: FreeWritingRequiredElement[];
  topicHint?: string;
};

export function isFreeWritingContent(
  content: ExerciseContent,
): content is FreeWritingContent {
  return content.type === ExerciseType.FREE_WRITING;
}
```

The **rich evaluation** is a new type, kept separate from the flat
`EvaluationResult` (which stays as-is for the other drills):

```ts
export type FreeWritingSeverity = "high" | "med" | "low";

export type FreeWritingCriterion = {
  id: "task" | "coherence" | "lexis" | "grammar";
  label: string;       // "Task achievement", …
  score: number;       // 0..1
  cefr: string;        // per-criterion CEFR estimate, e.g. "B2", "B1+"
  note: string;
};

export type FreeWritingError = {
  n: number;                    // 1-based stable index
  severity: FreeWritingSeverity;
  type: string;                 // category label, e.g. "Modo verbal"
  original: string;             // EXACT substring of the learner's text
  correction: string;
  where?: string;               // human locus, e.g. "oración condicional · §3"
  note: string;
};

export type FreeWritingEvaluation = {
  overallScore: number;         // 0..1 — stored in user_exercise_history.score
  overallCefr: string;
  headline: string;
  summary: string;
  criteria: FreeWritingCriterion[];   // exactly 4, in task/coherence/lexis/grammar order
  errors: FreeWritingError[];
  goodSpans: string[];          // EXACT substrings to highlight as done-well
  improved: {
    text: string;               // full improved paragraph(s), freshly written
    upgrades?: string[];        // EXACT substrings within `text` to highlight green
  };
  wordCount: number;
  improvedWordCount: number;
};
```

**Why errors-as-spans, not Claude-segmented prose.** The prototype models the
annotated text as a pre-segmented paragraph array. Asking Claude to faithfully
re-segment the learner's entire text (so segments concatenate back to the
original) is fragile and token-heavy. Instead Claude returns **exact substrings**
(`error.original`, `goodSpans`, `improved.upgrades`) and the **client
reconstructs** the annotated view by locating each span in the original text. A
span that can't be located simply drops its highlight — the text still renders
intact. This is the primary technical risk and the main unit-test target
(reconstruction must never corrupt or drop the learner's words).

### 2. Evaluation (`packages/ai`)

New module `free-writing-evaluate.ts` (mirrors `evaluate.ts`):

- `FREE_WRITING_EVAL_TOOL` (Anthropic tool) whose `input_schema` matches
  `FreeWritingEvaluation`.
- `FREE_WRITING_EVAL_SYSTEM_PROMPT` + `FREE_WRITING_EVAL_PROMPT_VERSION`
  (`free-writing-eval@2026-06-13`), registered in the prompts registry /
  Langfuse exactly like the existing prompts (fallback constant in repo; bump
  the version constant on edits per CLAUDE.md). Add the version constant to the
  CLAUDE.md prompt-version table.
- `evaluateFreeWriting(client, { content, userAnswer, language, difficulty })`
  → `FreeWritingEvaluation`. IELTS rubric adapted per language; instructs Claude
  to return exact substrings for errors/good/upgrades and to honour the four
  fixed criteria.
- Parser `parseFreeWritingEvaluation()` validates the tool output (clamps
  scores to [0,1], enforces 4 criteria, coerces severities, drops malformed
  errors) the way `parseEvaluationResult` does.

### 3. Submit route (`infra/lambda/src/routes/exercises.ts`)

`POST /exercises/:id/submit` **branches on `exercise.type`**:

- `free_writing` → `evaluateFreeWriting(...)` inside the same `withLlmTrace`
  wrapper (feature tag `free-writing-eval`, `promptVersion`
  `FREE_WRITING_EVAL_PROMPT_VERSION`).
- Reuses the existing metering (`ai_evaluation` bucket), global-capacity brake,
  session-linkage validation, and history insert.
- Stores `result.overallScore` in `userExerciseHistory.score`; stores the full
  `FreeWritingEvaluation` in `responseJson.evaluation` (shape:
  `{ userAnswer, evaluation }`, same envelope as today).
- Returns the `FreeWritingEvaluation` JSON.

No new route, no new table, no new usage bucket.

### 4. Progress impact

- `axisForExerciseType(ExerciseType.FREE_WRITING)` → `'writing'`
  (`infra/lambda/src/lib/progress-aggregation.ts`). The overall score then
  flows into the radar/heatmap through the existing aggregation — **real**
  Writing-axis impact.
- **Phase 1 results screen** shows the four criteria + a "what this feeds"
  chip summary (Writing CEFR, grammar radar, vocab depth, pragmatics, exam
  readiness). The precise per-grammar-point up/down deltas in the mock require
  per-competency Bayesian updates derived from free text — **Phase 2**. Phase 1
  does not fabricate deltas.

### 5. Frontend (`apps/web`)

New route `apps/web/app/(dashboard)/drill/free-writing/` with a client state
machine: `brief → composer → grading → results ⟷ corrections ⟷ compare`. The
exam-mode countdown is pure client state. Components under
`free-writing/_components/`:

- `fw-brief.tsx`, `fw-composer.tsx`, `fw-results.tsx`, `fw-corrections.tsx`,
  `fw-compare.tsx`.
- Shared presentational helpers ported from the prototype's `fw-shared.jsx`:
  `MarkedProse`, `ImprovedProse`, `CriterionRow`, `ReqRow`, `WordCounter`,
  `CEFRBadge`, `SevTag`, plus the `FwIcon` set (mapped onto the app's existing
  icon/token conventions where one already exists).
- `MarkedProse` consumes `FreeWritingEvaluation` and **reconstructs** the
  annotated paragraphs from `errors` + `goodSpans` against the original text
  (see §1). `ImprovedProse` renders `improved.text` with `upgrades` highlighted.
- The prototype's `freewrite.css` classes map onto the app's existing CSS
  variables (`--accent`, `--ink`, `--ok`, `--paper-*`, `--rule`, `--r-md`, …);
  reuse the real tokens rather than copying literal hex.
- Mobile web uses the app's responsive shell + existing bottom-sheet pattern;
  surfaces stack as in `mwfreewrite/*` (the "unstuck" sheet is Phase 2).
- Helper buttons render **disabled with a "soon" affordance**.
- Required-elements checklist renders **statically** from
  `content.requiredElements` (no live detection in Phase 1).

api-client (`packages/api-client`): add `useSubmitFreeWriting` returning a typed
`FreeWritingEvaluation` (the endpoint is shared with the generic submit but the
response shape differs by type).

Entry point: a featured "Free writing — new" card (dashboard and/or top of
`/drill`) linking to `/drill/free-writing`.

### 6. Seed data (`packages/db/scripts/seed-exercises.ts`)

Add ~4–6 hand-written `free_writing` prompts across languages/levels, including
the design's ES·B2 remote-work prompt. Each carries the full constraint set
(title, task, domain, register, min/max words, suggestedMinutes,
requiredElements). Deterministic keys / UUIDs as for existing seeds; auto-
approved review status.

## Testing

- **`packages/shared`**: `isFreeWritingContent` guard.
- **`packages/ai`**: `FREE_WRITING_EVAL_TOOL` schema shape; `evaluateFreeWriting`
  happy path + parser robustness (score clamping, 4-criteria enforcement,
  malformed-error dropping) with a mocked Anthropic client.
- **`apps/web`**: `MarkedProse` reconstruction — **the critical test**: every
  test asserts the rendered text still concatenates to the learner's original
  regardless of how many spans match / mismatch; overlapping spans; a span not
  found; an empty error list; multi-paragraph input. Component tests for
  `WordCounter` (under/ok/over states), `CriterionRow`, the brief→…→compare
  state machine transitions.
- **`infra/lambda`**: submit route branch for `free_writing` (correct evaluator
  called, `overallScore` persisted to `score`, full evaluation in
  `responseJson`, `ai_evaluation` metered) with a mocked evaluator.
- Per repo convention, add to the existing test file for each module; run
  `pnpm lint && pnpm typecheck && pnpm test` green before pushing.

## Risks

1. **Span reconstruction** (§1) — the main one. Mitigated by the
   errors-as-substrings contract + exhaustive `MarkedProse` tests that
   guarantee the original text is never corrupted.
2. **Structured-output reliability** — a large tool schema; mitigated by a
   defensive parser and `temperature: 0`.
3. **Rubric calibration per language** — IELTS-style criteria adapted to
   ES/EN/DE/TR; seeded prompts let us eyeball-calibrate before any bulk
   generation. Real calibration is a Phase 2 eval concern.

## Out of scope (Phase 2+)

Getting-unstuck helpers + score-weight bookkeeping · auto generation/validation
pipeline + eval gates · precise per-grammar-point progress deltas · live
required-element detection · full drill-hub grid · speaking/listening parity.
