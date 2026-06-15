# Free Writing — Getting-Unstuck Helpers: Start my paragraph (Design)

_Date: 2026-06-15 · Status: approved, ready to plan_

Scope: the **third** and final "getting-unstuck helper" from the
[Phase 2 roadmap](2026-06-15-free-writing-phase-2.md) §"Major items" #1 —
**Start my paragraph** — completing the helper trio after **Brainstorm** and
**Vocabulary boost** ([design](2026-06-15-free-writing-unstuck-helpers-design.md)).

Start my paragraph gives the learner a single target-language opening sentence
they can build on, inserted directly into the composer with one click.

Phase-1 context: [`2026-06-13-free-writing-drill-design.md`](2026-06-13-free-writing-drill-design.md).

## The scope reversal — read this first

The unstuck-helpers spec deferred this helper specifically because it was
expected to need "insert-UX plus the greenfield reduced-score bookkeeping that
touches the calibrated evaluator." **That bookkeeping is explicitly cut.** A
provided opener is **not penalized** — it becomes part of the learner's
submission and is graded as their own writing, for the sake of simplicity.

Consequences of cutting the discount (all confirmed):

- **No** submit-payload change — `SubmitAnswerSchema` (`{ answer, sessionId? }`)
  is untouched; there is no `scaffoldedOpener` field.
- **No** evaluator change — `FREE_WRITING_EVAL_SYSTEM_PROMPT` /
  `FreeWritingEvaluation` / `FREE_WRITING_EVAL_PROMPT_VERSION` are untouched.
- **No** history bookkeeping — `user_exercise_history` (`score`, `responseJson`)
  is untouched; no `rawScore`/`scaffoldFrac`.
- **No** shared-type or results-screen change.

What remains is a clean near-clone of the two shipped helpers: a new metered,
ephemeral AI endpoint plus a one-click insert UX in the composer.

## Confirmed product decisions

- **Metering:** shares the existing `writing_helper` daily-cap bucket (no
  `limits.ts` change). Its own endpoint, like the other two.
- **Opener content:** exactly **one** sentence, in the **target language**, at
  the exercise's CEFR level and register. It **orients the topic but takes no
  side and names no required element** — it gets the learner past the blank
  page and leaves the actual task (and every required element) as their own
  production.
- **Insert UX:** **one-click direct insert** — clicking the button fetches and
  **prepends** a fresh opener to the textarea immediately (no preview panel).
  Clicking **regenerate** replaces it (re-bills); **remove** strips it.
- **No scoring penalty:** the opener is graded as the learner's own writing.
- **Re-billing:** every fetch (initial click + each regenerate) calls Claude and
  records a `writing_helper` usage event. Unlike the display helpers there is no
  client cache to reuse — each insert wants a fresh sentence.

---

## Architecture overview

One new **metered, non-streaming** AI endpoint on the Hono API
(`infra/lambda`), mirroring `POST /exercises/:id/brainstorm` and re-using the
existing `runWritingHelper` gate. It is grounded in the exercise prompt
(`:id`), calls Claude with tool-use for structured output, resolves its system
prompt via `getPromptOrFallback` (Langfuse live + in-repo fallback), and
records a `writing_helper` usage event before returning. No DB storage — the
opener is ephemeral; once inserted it is just text in the learner's answer.

Data flow:

```
composer: click "start my paragraph" (or regenerate)
  → useStartMyParagraph mutation (POST /exercises/:id/start-my-paragraph)
    → runWritingHelper gate (identical to the other two helpers):
       load approved free_writing exercise (404 if missing / wrong type)
       → getEffectivePlan(userId)
       → checkGlobalCapacity({ plan, admin })       → 503 GLOBAL_CAPACITY on brake
       → daily-cap check on 'writing_helper'          → 429 RATE_LIMIT_EXCEEDED over cap
       → withLlmTrace(...) → generateStartMyParagraph  (Claude tool-use)
       → insert usage_events row (event_type 'writing_helper', kind 'start-my-paragraph')
       → return { opener }
  → Zod-parse in hook → composer prepends opener to textarea value, tracks it
```

---

## 1. Backend — `packages/ai`

Extend the existing helper files (no new files), mirroring the brainstorm /
vocab-boost additions:

- **`writing-helper-prompts.ts`:**
  - `START_MY_PARAGRAPH_SYSTEM_PROMPT` — instructs Claude to return exactly one
    target-language opening sentence at the given CEFR level and register that
    orients the topic, takes no side / states no thesis, and names none of the
    required elements. It is a runway, not a head-start on the task.
  - `START_MY_PARAGRAPH_PROMPT_VERSION = "free-writing-start-my-paragraph@2026-06-15"`.
  - A user-prompt builder embedding the same context block the other helpers use
    (target language, CEFR, register, length band, required elements — required
    elements are listed so the model knows what to *avoid* naming).
  - The Claude tool schema + name: `submit_opener` → `{ opener: string }`.
- **`writing-helper.ts`:**
  - `generateStartMyParagraph(client, { content, language, difficulty }): Promise<{ opener: string }>`
    via the existing `runHelperTool` runner (forced `tool_choice`,
    `temperature: 0`, `model: "claude-sonnet-4-6"`, ephemeral-cached system
    prompt, small `max_tokens`).
  - A forgiving parser: a non-string / missing `opener` yields `{ opener: "" }`
    (the route still returns 200; the UI treats empty as "couldn't add an
    opener — try again"). Keep the same discipline as `parseBrainstorm` /
    `parseVocabBoost`.
- **`index.ts`** re-exports the generate function, tool name/schema, system
  prompt, version constant, and user-prompt builder (same shape as the other
  helper re-exports).

**Prompt registration** (per the "new prompt needs manifest entry" rule): add
the prompt to the `PROMPTS` manifest in `bootstrap-prompts.ts` (single source
for bootstrap + push + check). Add `START_MY_PARAGRAPH_PROMPT_VERSION` to the
CLAUDE.md prompt-version table. The manifest-count test increments by 1.

---

## 2. Backend — `infra/lambda`

- **`usage/limits.ts`:** no change — reuses the existing `writing_helper`
  bucket added for brainstorm / vocab-boost.
- **`observability.ts`:** add `'free-writing-start-my-paragraph'` to the
  `LlmFeature` union.
- **Routes (`routes/exercises.ts`):** one new route
  `POST /exercises/:id/start-my-paragraph` delegating to the existing
  `runWritingHelper(c, { feature: 'free-writing-start-my-paragraph',
  promptVersion: START_MY_PARAGRAPH_PROMPT_VERSION, generate:
  generateStartMyParagraph, kind: 'start-my-paragraph' })`. No change to the
  gate helper beyond passing the new feature/generate. Carries the JWT
  authorizer like the other `POST` exercise methods; OPTIONS stays
  unauthenticated.
- **No change** to `/submit`, `SubmitAnswerSchema`, the evaluator, mastery
  updates, or history.

---

## 3. Shared / `packages/api-client`

- **Zod schema** (alongside `BrainstormSchema` / `VocabBoostSchema`):
  `StartMyParagraphSchema = z.object({ opener: z.string() })`, plus the inferred
  `StartMyParagraphResponse` type.
- **Hook `useStartMyParagraph({ exerciseId, fetchFn })`** — a **`useMutation`**,
  not a `useQuery`. Rationale: the result is a side-effecting insert into the
  composer, not displayed data, and each click/regenerate must produce a fresh
  opener (no cache reuse). The mutation `POST`s through the existing `fetchFn`,
  Zod-parses the response, and exposes the standard
  `{ mutateAsync, isPending, isError, reset }`. This is a deliberate, documented
  divergence from the query-based display helpers.

---

## 4. Web — composer UI

`fw-unstuck.tsx`:

- **Enable** the third button (remove `disabled` / "soon").
- **New props:** `value: string` and `onChange: (next: string) => void`, passed
  through from `fw-composer.tsx` (which already owns `value`/`onChange`). This
  keeps all three helpers cohesive inside `FwUnstuck`; the start-my-paragraph
  button needs to mutate the textarea, so the boundary moves `value`/`onChange`
  into the component rather than lifting the button up into the composer.
- **State:** `insertedOpener: string | null` tracks the opener currently
  prepended to `value`.
  - **Click** → `mutateAsync()` → on success **with a non-empty** `opener`,
    prepend `opener + "\n\n"` to `value` via `onChange`, set `insertedOpener`.
    A 200 with an empty `opener` (forgiving parser fallback) is treated as the
    error case below — nothing is inserted.
  - **Regenerate** → if `insertedOpener` is still a prefix of `value`, strip it
    first; prepend the new opener; update `insertedOpener` (re-bills).
  - **Remove** → strip the `insertedOpener` prefix (if still present) from
    `value`, clear `insertedOpener`.
  - If the learner has hand-edited the opener away (no longer a prefix),
    regenerate/remove simply prepend / no-op the strip — never corrupt the
    learner's text.
- **Status surface:** a compact inline **chip** under the button row (no preview
  panel, per the one-click decision):
  - loading → `thinking…` (button disabled while `isPending`),
  - error (mutation rejected **or** returned an empty `opener`) →
    `couldn't add an opener — try again` (retry re-runs the mutation),
  - inserted → `opener added · regenerate · remove`.
- **Reword** the hint line (currently `fw-unstuck.tsx:85–87`, falsely promising
  "a provided opener counts less toward your score") to:
  **"helpers give you a nudge — the ideas and words are yours to shape."**
- **Exam mode** continues to hide the entire helper area (buttons + chip),
  unchanged.

`fw-composer.tsx`: pass `value` and `onChange` into `<FwUnstuck>` (it already
holds both).

Keep the brainstorm/vocab panel rendering as-is; the start-my-paragraph chip is
a sibling of that panel within `FwUnstuck`.

---

## 5. Testing (TDD — tests first)

- **ai:** unit test for `generateStartMyParagraph` — mock the Claude client to
  return a `submit_opener` tool-use block; assert the parsed `{ opener }` shape,
  the forgiving parser (missing/non-string → `{ opener: "" }`), and that the
  forced tool + cached system prompt are wired (pattern from the existing helper
  tests).
- **lambda:** route test for `POST /exercises/:id/start-my-paragraph` — success
  inserts a `writing_helper` usage event and returns `{ opener }`; over-cap →
  429 `RATE_LIMIT_EXCEEDED`; global brake → 503 `GLOBAL_CAPACITY`;
  missing / non-free-writing exercise → 404.
- **api-client:** schema-parse test for `StartMyParagraphSchema` (valid parse;
  malformed rejected).
- **web:** composer tests — start-my-paragraph button enabled; clicking prepends
  the opener from a mocked mutation; regenerate **replaces** (not appends) the
  opener; remove strips it and clears state; `isPending` / `isError` states
  render; exam mode hides the helper area; the reworded hint copy is asserted
  and the old "counts less toward your score" string is gone.
- **manifest:** update the prompt-count assertion in the bootstrap-prompts test
  (+1).

Add tests to the existing files for each module; no orphaned test files.

---

## Out of scope

- The reduced-score / scaffolded-span bookkeeping (cut — see "scope reversal").
- The mobile bottom-sheet (`MWFwUnstuck`) modal polish.
- Persisting helper output to the DB (the opener is ephemeral + metered; once
  inserted it lives only as part of the learner's answer text).
- A preview-before-insert panel (one-click insert was chosen instead).
- Other roadmap items (pre-gen pipeline, progress deltas, exam mode completion,
  live element detection, drill hub).
