# Free Writing — Getting-Unstuck Helpers: Brainstorm + Vocabulary boost (Design)

_Date: 2026-06-15 · Status: approved, ready to plan_

Scope: the first two of the three "getting-unstuck helpers" from the
[Phase 2 roadmap](2026-06-15-free-writing-phase-2.md) §"Major items" #1 —
**Brainstorm** and **Vocabulary boost**. The third helper, **Start my
paragraph**, is deferred to its own spec because it adds insert-UX plus the
greenfield reduced-score bookkeeping that touches the calibrated evaluator.

Phase-1 context: [`2026-06-13-free-writing-drill-design.md`](2026-06-13-free-writing-drill-design.md).
Quick-wins (shipped): [`2026-06-15-free-writing-phase-2-quick-wins-design.md`](2026-06-15-free-writing-phase-2-quick-wins-design.md).

## Confirmed product decisions

- **Metering:** one shared `writing_helper` daily-cap bucket for both helpers
  (and, later, start-my-paragraph). Each helper is still its own endpoint.
- **Brainstorm output language:** English (the app UI language) — ideas/angles,
  not target-language phrasing. Keeps target-language production the learner's
  job and avoids overlapping start-my-paragraph.
- **Re-billing:** cache per exercise (toggling the panel is free); an explicit
  "regenerate" control re-calls and re-meters.
- **Mobile bottom-sheet:** out of scope — an inline responsive panel ships now;
  the prototype's `MWFwUnstuck` modal sheet is deferred polish.

---

## Architecture overview

Two new **metered, non-streaming** AI endpoints on the Hono API
(`infra/lambda`), mirroring `POST /exercises/:id/submit`. Both are grounded in
the exercise prompt (`:id`), call Claude with tool-use for structured output,
resolve their system prompt via `getPromptOrFallback` (Langfuse live + in-repo
fallback), and record a usage event before returning. No DB storage — results
are ephemeral and cached client-side per the re-billing decision.

Data flow (identical for both helpers):

```
composer panel opens
  → useQuery (POST /exercises/:id/{brainstorm|vocab-boost}, enabled once opened)
    → Hono route: load approved exercise (404 if missing)
      → getEffectivePlan(userId)
      → checkGlobalCapacity({ plan, admin })           → 503 GLOBAL_CAPACITY on brake
      → daily-cap check on 'writing_helper'             → 429 RATE_LIMIT_EXCEEDED over cap
      → withLlmTrace(...) → generateBrainstorm | generateVocabBoost  (Claude tool-use)
      → insert usage_events row (event_type 'writing_helper')
      → return structured JSON
  → Zod-parse in hook → render panel (brainstorm groups | vocab rows)
```

---

## 1. Backend — `packages/ai`

Mirror the existing `free-writing-prompts.ts` / `free-writing-evaluate.ts`
split:

- **`writing-helper-prompts.ts`** — for each helper: a `*_SYSTEM_PROMPT`
  constant, a `*_PROMPT_VERSION` constant (`<surface>@2026-06-15`), a
  user-prompt builder, and the Claude tool schema + tool name.
- **`writing-helper.ts`** — the two generate functions, each: build user prompt
  → `getPromptOrFallback(name, fallback, version)` → `client.messages.create`
  with `model: "claude-sonnet-4-6"`, `temperature: 0`, `tool_choice` forcing the
  tool, system prompt `cache_control: ephemeral` → parse the tool input → return
  the typed result. Export request-timeout / max-retries constants if they
  diverge from the eval defaults (cheaper calls → smaller `max_tokens`).

Function shapes:

```ts
generateBrainstorm(client, { content, language, difficulty })
  : Promise<{ groups: { label: string; points: string[] }[] }>
  // 2–3 angle groups, 2–4 ENGLISH idea bullets each.

generateVocabBoost(client, { content, language, difficulty })
  : Promise<{ items: { term: string; gloss: string }[] }>
  // 8–10 TARGET-LANGUAGE terms, each with a short English gloss.
```

`index.ts` re-exports the generate functions, tool names/schemas, system
prompts, version constants, and user-prompt builders (same shape as the
free-writing eval re-exports).

**Prompt registration** (required, per the "new prompt needs manifest entry"
rule): add both prompts to the `PROMPTS` manifest in `bootstrap-prompts.ts`
(the single source for bootstrap + push + check). Add
`BRAINSTORM_PROMPT_VERSION` and `VOCAB_BOOST_PROMPT_VERSION` to the CLAUDE.md
prompt-version table. The manifest-count test increments by 2.

---

## 2. Backend — `infra/lambda`

- **`usage/limits.ts`:** add `'writing_helper'` to the `MeteredEventType` union
  and `BASE_DAILY_LIMITS` (`writing_helper: 50` → 500 boosted via the existing
  ×10 multiplier — same tier as `ai_evaluation`).
- **Routes:** `POST /exercises/:id/brainstorm` and
  `POST /exercises/:id/vocab-boost` in `routes/exercises.ts`. Both run the
  identical gate; extract it into one small local helper
  `runWritingHelper(c, { id, generate })` so the two routes don't duplicate the
  plan/capacity/cap/trace/record sequence. The helper:
  1. loads the approved exercise (404 if absent / not free_writing),
  2. `getEffectivePlan` + `checkGlobalCapacity` (503 on `killed`/`capped`),
  3. counts trailing-24h `writing_helper` events; `>= limitFor('writing_helper', plan)` → 429,
  4. `withLlmTrace({ feature, promptVersion }, () => generate(client, input))`,
  5. inserts the `writing_helper` usage event (metadata: exerciseId, language, difficulty, kind),
  6. returns the structured JSON.

  Routes carry the JWT authorizer like the other `POST` exercise methods;
  OPTIONS stays unauthenticated (existing CORS handling).

---

## 3. Shared / `packages/api-client`

- **Zod schemas** (`schemas/exercise.ts` or a sibling): `BrainstormSchema`
  (`{ groups: { label, points: string[] }[] }`) and `VocabBoostSchema`
  (`{ items: { term, gloss }[] }`), plus inferred response types.
- **Hooks** `useBrainstorm` / `useVocabBoost`:
  - `useQuery` keyed `['writing-helper', kind, exerciseId]`,
  - `enabled` only once the panel has been opened for that kind (lazy — no call on
    mount),
  - `staleTime: Infinity` so toggling the panel open/closed does not re-call,
  - the query fn issues the metered **POST** through the existing `fetchFn` and
    Zod-parses the response,
  - **regenerate** = `refetch()` (re-calls + re-meters). The hook exposes the
    standard `{ data, isLoading, isError, refetch }`.

---

## 4. Web — composer UI

`fw-composer.tsx`:

- **Enable** the brainstorm and vocabulary-boost buttons (remove `disabled` /
  "soon"). **Start my paragraph stays `disabled · soon`** — next spec.
- Clicking a helper button opens an inline **`.fw-helppanel`** below the button
  row, with a segmented control to switch between the two kinds once open.
  Panel states: loading, results, error + retry, and a regenerate control.
  - Brainstorm results: grouped bullet lists (label + points).
  - Vocab results: `.fw-vocab-row` rows (`term` + `gloss`).
- **Exam mode hides the entire helper area** (buttons + panel), matching the
  prototype.
- Port the prototype's `.fw-helppanel` / `.fw-vocab-row` base classes into
  `free-writing.css`, remapping bare `var(--token)` to the app's
  `--color-*` / `--radius-*` / `--font-*` namespace (per the prototype-port
  gotcha).

The composer stays presentational where practical: the data-fetching hooks live
in the composer (it already owns `value`/`onChange` and knows the exercise);
panel sub-rendering (brainstorm view, vocab view) extracted into small
components for isolation + testability.

---

## 5. Testing (TDD — tests first)

- **ai:** unit tests for `generateBrainstorm` / `generateVocabBoost` — mock the
  Claude client to return a tool-use block, assert the parsed shape and that the
  forced tool + system prompt are wired (pattern from the free-writing-evaluate
  tests).
- **lambda:** route tests for both endpoints — success inserts a `writing_helper`
  usage event and returns the payload; over-cap → 429 `RATE_LIMIT_EXCEEDED`;
  global brake → 503 `GLOBAL_CAPACITY`; missing/non-free-writing exercise → 404.
- **api-client:** schema-parse tests for `BrainstormSchema` / `VocabBoostSchema`
  (valid parses; malformed rejected).
- **web:** composer tests — brainstorm/vocab buttons enabled; clicking opens the
  panel and renders results from a mocked hook; loading + error + regenerate
  states; exam mode hides the helper area; start-my-paragraph still disabled.
- **manifest:** update the prompt-count assertion in the bootstrap-prompts test
  (+2).

Add tests to the existing files for each module; no orphaned test files.

---

## Out of scope

- **Start my paragraph** and the scaffolded-span reduced-score bookkeeping —
  its own spec (touches `FreeWritingContent`/submit payload, the evaluator
  prompt + recalibration, response schema, and stored history).
- The mobile bottom-sheet (`MWFwUnstuck`) modal polish.
- Persisting helper output to the DB (results are ephemeral + metered).
- Other roadmap items (pre-gen pipeline, progress deltas, exam mode completion,
  live element detection, drill hub).
