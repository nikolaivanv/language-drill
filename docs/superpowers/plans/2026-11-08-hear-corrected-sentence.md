# Hear the Corrected Sentence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After a cloze, translation or sentence-construction answer is graded, the learner can play (and replay) the correct full sentence — their own sentence, corrected — synthesized on demand by Polly.

**Architecture:** The answer evaluator gains a `correctedAnswer` field. A pure server function derives the sentence to speak from the stored submission (never from client text). A new sub-route `POST /exercises/:id/submissions/:submissionId/audio` resolves content-addressed Polly audio exactly like reading audio, metered by a new `phrase_tts` bucket. The submit response carries `spokenText`; the three result cards render it with a press-to-play control.

**Tech Stack:** Hono on Lambda, Drizzle/Neon, AWS Polly + S3, Anthropic tool use, Zod + TanStack Query, Next.js App Router, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-08-hear-corrected-sentence-design.md`

## Global Constraints

- Work in a worktree at `.claude/worktrees/feat-hear-corrected-sentence/` branched from fresh `origin/main` (not the current `data/tr-demonstratives-buraya-repair` branch). Copy `.env` in; `pnpm install && pnpm build` before tests. Commit the spec + this plan as the first commit.
- Voices: `READING_VOICE_BY_LANGUAGE` only (TR Burcu, ES Lucia, DE Vicki). Anything else → no audio.
- Spoken text is derived server-side from the stored `user_exercise_history` row + exercise. The audio route never accepts text from the client.
- No audio rather than wrong audio (the spec's anti-goal). Every "can't be sure" branch returns `null`.
- `correctedAnswer` is **optional** on `EvaluationResult` (old rows lack it); the parser must never throw on it.
- Prompt edit ⇒ bump `EVALUATION_SYSTEM_PROMPT_VERSION` to `evaluate@2026-11-08` (or merge date) in the same commit; after merge run `push-prompts` for prod and dev (CLAUDE.md "Prompt Editing").
- Usage bucket `phrase_tts`: 100/day free, 1000 boosted (`BOOST_MULTIPLIER`). Only true cache misses are metered. Outside the global Claude cost brake (no `checkGlobalCapacity`).
- S3 key prefix `phrase/`, content-addressed over `(language, voiceId, normalizedText)`.
- No CDK change: the API Lambda already has bucket-wide `grantRead`/`grantPut` and `polly:SynthesizeSpeech` (`infra/lib/stack.ts:110-119`).
- UI: press to play, no autoplay; replay must not re-request.
- Pre-push: `pnpm lint && pnpm typecheck && pnpm test` from repo root, zero failures.

## Review Focus

1. **Turkish dotless-I on a deterministic cloze hit** (learner types `Istanbul'a` for `İstanbul'a`): expect the stored accepted form to be voiced, never the typed string. → Task 2 test `cloze deterministic voices the matched accepted form`.
2. **Model echoes the learner's answer while reporting errors / low task score** (e.g. English answer, untranslated half): expect no audio. → Task 2 tests `echo with errors → null`, `echo with taskAchievement 0.5 → null`.
3. **Translation exercise whose target language is EN** (source TR → target EN): expect no audio, since there's no EN voice. → Task 2 test `translation into EN → null`.
4. **Another user's submissionId, or a submissionId for a different exercise id**: expect 404, no synth, no metering. → Task 3 tests `cross-user → 404`, `mismatched exercise → 404`.
5. **Learner presses play repeatedly / two learners got the same sentence right**: expect one synth total and one metered event; replays are free. → Task 3 test `HeadObject hit → no synth, no usage row`; Task 5 test `second click replays without a second mutate`.

---

### Task 1: Evaluator returns `correctedAnswer`

**Files:**
- Modify: `packages/shared/src/index.ts` (`EvaluationResult`, ~line 449)
- Modify: `packages/ai/src/evaluate.ts` (`buildEvaluationTool` ~line 77–116; `parseEvaluationResult` ~206–290)
- Modify: `packages/ai/src/prompts.ts` (rule list ~line 112; `EVALUATION_SYSTEM_PROMPT_VERSION` line 99)
- Test: `packages/ai/src/evaluate.test.ts`

**Interfaces:**
- Produces: `EvaluationResult.correctedAnswer?: string`; tool property `correctedAnswer` placed **after** `errors` in `properties` and added to `required`.

- [ ] **Step 1: Write failing tests** in `evaluate.test.ts`:
  - `buildEvaluationTool puts correctedAnswer after errors and requires it`: `Object.keys(props).indexOf('correctedAnswer') === Object.keys(props).indexOf('errors') + 1`; `required` contains `'correctedAnswer'`; `Object.keys(props)[0] === 'reasoning'`.
  - `parseEvaluationResult keeps a string correctedAnswer`: valid fixture + `correctedAnswer: 'Eve gidiyorum.'` → result has it.
  - `parseEvaluationResult drops a non-string correctedAnswer without throwing`: `correctedAnswer: 42` → result `correctedAnswer` is `undefined`.
  - `parseEvaluationResult tolerates a missing correctedAnswer`.
- [ ] **Step 2: Run** `pnpm --filter @language-drill/ai test -- evaluate.test` → the 4 new tests FAIL.
- [ ] **Step 3: Implement.** Add the optional field to `EvaluationResult` with a doc comment pointing at the spec. Add the tool property with description: "The learner's full answer with every listed error fixed, kept as close to their wording as possible. If the answer does not accomplish the task (different meaning, part of the source untranslated, required keywords/structure/register missing, wrong language), rewrite it so it fully does, still staying as close to their wording as the task allows. If there are no errors and the task is achieved, repeat the answer verbatim. For a cloze: only the corrected word(s) for the blank." Parser: copy when `typeof === 'string'`, else omit.
- [ ] **Step 4: Prompt.** In `prompts.ts` insert a new numbered rule after **Errors** ("**Corrected Answer**: …" — same meaning as the tool description, plus: do not list a task miss as fixed unless `correctedAnswer` actually fixes it), renumber the following item, bump version to `evaluate@2026-11-08`. Run `pnpm --filter @language-drill/ai test` — any snapshot/fixture tests that pin the prompt or required list are updated deliberately, not blindly.
- [ ] **Step 5: Run** `pnpm --filter @language-drill/ai test` → PASS; `pnpm verify:model-requests --surfaces` → evaluation surface PASS (real calls, a few cents).
- [ ] **Step 6: Commit** `feat(ai): evaluator returns the full corrected answer`.

### Task 2: Derive the sentence to speak

**Files:**
- Modify: `packages/shared/src/fluency.ts` — add `matchedClozeForm`
- Modify: `packages/db/src/lib/reading-audio.ts` — add `phraseAudioKey`
- Create: `infra/lambda/src/lib/spoken-text.ts`
- Test: `packages/shared/src/fluency.test.ts` (existing), `packages/db/src/lib/reading-audio.test.ts` (existing, create only if absent), `infra/lambda/src/lib/spoken-text.test.ts`

**Interfaces:**
- Produces:
  - `matchedClozeForm(content: ClozeContent, answer: string): string | null` — the accepted form (`correctAnswer` or an `acceptableAnswers` entry, as stored) that `answer` matches under the existing dual-locale fold; `null` if none. Reuse `matchesAccepted`.
  - `phraseAudioKey(language: string, voiceId: string, normalizedText: string): string` → `phrase/<sha256 hex>.mp3`, hash input identical in shape to `readingAudioKey`. Export from `@language-drill/db` alongside it.
  - `spokenTextFor(input: { exerciseLanguage: string; content: ExerciseContent; userAnswer: string; evaluation: EvaluationResult }): { text: string; language: ReadingAudioLanguage } | null`

- [ ] **Step 1: Write failing tests.**
  - fluency: `matchedClozeForm returns the stored İ form for a dotless-I answer` (`correctAnswer: "İstanbul'a"`, answer `"Istanbul'a."` → `"İstanbul'a"`); `returns the acceptableAnswers entry it matched`; `returns null on a miss`.
  - reading-audio: `phraseAudioKey is content-addressed under phrase/` (same inputs → same key, matches `/^phrase\/[0-9a-f]{64}\.mp3$/`, differs from `readingAudioKey` for the same inputs).
  - spoken-text (TR cloze `sentence: "Yarın ___ gidiyorum."`, `correctAnswer: "okula"`):
    - `cloze deterministic voices the matched accepted form` — `evaluationSource: 'deterministic'`, userAnswer `"OKULA"` → `{ text: 'Yarın okula gidiyorum.', language: 'TR' }`.
    - `cloze llm uses correctedAnswer` — userAnswer `"okulda"`, `correctedAnswer: "okula"`, one error → `'Yarın okula gidiyorum.'`.
    - `cloze llm without correctedAnswer falls back to correctAnswer`.
    - `cloze with no blank → null`; `cloze with two blanks → null`.
    - `translation uses correctedAnswer in the target language` (target TR) → that text.
    - `translation into EN → null`.
    - `sentence_construction without correctedAnswer → null`.
    - `errors empty → learner answer as typed` (normalized whitespace), even if `correctedAnswer` differs.
    - `echo with errors → null` (correctedAnswer === userAnswer, errors non-empty).
    - `echo with taskAchievement 0.5 → null` (no errors).
    - `empty correctedAnswer → null`.
    - `longer than POLLY_NEURAL_MAX_CHARS → null`.
    - `unsupported type (vocab_recall) → null`.
- [ ] **Step 2: Run** the three test files → FAIL.
- [ ] **Step 3: Implement.** Rules for `spokenTextFor`, in order:
  1. Voice language: `content.targetLanguage` for translation, else `exerciseLanguage`; not a key of `READING_VOICE_BY_LANGUAGE` → `null`. Types other than cloze/translation/sentence_construction → `null`.
  2. `pick(evaluation, userAnswer)` for the LLM path: `errors.length === 0 && taskAchievement >= 0.7` → `userAnswer`; else trimmed `correctedAnswer`; empty/missing → `undefined`; equal to `userAnswer` after `normalizePassageText` while `errors.length > 0 || taskAchievement < 0.7` → `null` (echo). Export the `0.7` as `SPOKEN_TASK_ACHIEVEMENT_FLOOR`.
  3. Cloze: count `/_{3,}/g` matches; ≠ 1 → `null`. Fill = deterministic ? `matchedClozeForm(...) ?? content.correctAnswer` : `pick(...)` where `undefined` → `content.correctAnswer` and `null` → return `null`. Replace the blank with the fill.
  4. Translation / SC: `pick(...)`; `undefined` or `null` → `null`.
  5. `normalizePassageText`; empty or `> POLLY_NEURAL_MAX_CHARS` → `null`.
  
  The deterministic `errors.length === 0` branch of step 2 is what voices "as typed" — for cloze, step 3 overrides it with the matched form.
- [ ] **Step 4: Run** tests → PASS. `pnpm --filter @language-drill/shared --filter @language-drill/db build` so lambda sees the new exports.
- [ ] **Step 5: Commit** `feat: derive the corrected sentence to voice`.

### Task 3: Phrase audio endpoint + `spokenText` on submit

**Files:**
- Modify: `infra/lambda/src/usage/limits.ts` (+ `limits.test.ts`)
- Create: `infra/lambda/src/lib/phrase-audio-service.ts` (+ `phrase-audio-service.test.ts`)
- Modify: `infra/lambda/src/routes/exercises.ts` — submit returns (lines ~495, ~551, ~LLM branch ~735) and the new route next to `/explain` (~803)
- Test: `infra/lambda/src/routes/exercises.test.ts` (existing route tests; follow the read audio tests in `routes/read.test.ts:900-1000` for the mocking pattern)

**Interfaces:**
- Consumes: `spokenTextFor`, `phraseAudioKey` (Task 2); `headObjectExists`, `synthesizeReadingAudio` (`lib/reading-audio-synth.ts`); `presignAudioUrl`; `estimateDurationSec`.
- Produces:
  - `MeteredEventType` gains `'phrase_tts'`; `BASE_DAILY_LIMITS.phrase_tts = 100`.
  - `resolvePhraseAudio(submissionId: string, userId: string, deps: PhraseAudioDeps): Promise<PhraseAudioResult>` with
    `PhraseAudioDeps = { loadSpoken(submissionId, userId): Promise<{ text: string; language: ReadingAudioLanguage } | null>; countRecentTts(userId): Promise<number>; limit(): number; headObjectExists(key): Promise<boolean>; synthesize(args: { text; key; voiceId; languageCode }): Promise<void>; recordTtsUsage(userId, submissionId): Promise<void>; presign(key): Promise<string | null> }`
    and `PhraseAudioResult = { kind: 'ok'; audioUrl: string | null; durationSec: number } | { kind: 'not_found' } | { kind: 'rate_limited' }`.
  - HTTP: `POST /exercises/:id/submissions/:submissionId/audio` → 200 `{ audioUrl: string | null, durationSec: number }`; 404 `{ code: 'AUDIO_NOT_AVAILABLE' }` (with `Cache-Control: no-store`); 429 `{ code: 'RATE_LIMIT_EXCEEDED' }`.
  - Submit JSON for evaluated (non-dictation, non-free-writing) results gains `spokenText: string | null`.

- [ ] **Step 1: Failing tests.**
  - limits: `meters phrase_tts at 100 free / 1000 boosted`.
  - service (mirror `read-audio-service.test.ts`): `not_found when loadSpoken returns null` (no synth, no usage); `HeadObject hit → no synth, no usage row, presigned url`; `miss under cap → synth with the voice for the language + one usage row`; `miss at cap → rate_limited, no synth`; key passed to synth equals `phraseAudioKey(language, voiceId, text)`.
  - route: `cross-user → 404`; `mismatched exercise → 404` (submission belongs to another exercise id); `malformed uuid → 404`; `ok → 200 with audioUrl` (usage insert has `eventType: 'phrase_tts'`, metadata `{ submissionId }`); `submit (deterministic cloze) returns spokenText`; `submit (translation llm) returns spokenText from correctedAnswer`.
- [ ] **Step 2: Run** `pnpm --filter @language-drill/lambda test -- limits phrase-audio exercises` → FAIL.
- [ ] **Step 3: Implement** the bucket, the service (same shape as `resolveReadAudio`, minus `persistKey`/`too_long` — length is already gated in `spokenTextFor`), and the route: validate both ids as UUIDs; `loadSpoken` selects the history row by `(id = submissionId, userId, exerciseId = :id)` joined to the exercise, then calls `spokenTextFor` with `responseJson.userAnswer` / `responseJson.evaluation`. Wire deps exactly like `routes/read.ts:452-498` with the bucket literal swapped. In the submit route, add `spokenText: spokenTextFor(...)?.text ?? null` to the conjugation-free evaluated responses (deterministic cloze/vocab branch and the LLM `evaluateAnswer` branch; not dictation, not free-writing).
- [ ] **Step 4: Run** tests → PASS.
- [ ] **Step 5: Commit** `feat(api): on-demand audio for the corrected sentence`.

### Task 4: API client

**Files:**
- Modify: `packages/api-client/src/schemas/exercise.ts` (`EvaluationResultSchema`)
- Create: `packages/api-client/src/hooks/usePhraseAudio.ts`
- Modify: `packages/api-client/src/index.ts` (exports)
- Test: `packages/api-client/src/hooks/useExercise.test.ts` (schema cases), `packages/api-client/src/schemas/exercise.test.ts` if it exists

**Interfaces:**
- Produces: `EvaluationResultSchema` gains `correctedAnswer: z.string().optional()`, `spokenText: z.string().nullable().optional()`; `PhraseAudioResponseSchema = z.object({ audioUrl: z.string().url().nullable(), durationSec: z.number() })`; `usePhraseAudio({ fetchFn }) → useMutation<PhraseAudioResponse, Error, { exerciseId: string; submissionId: string }>` POSTing to `/exercises/${exerciseId}/submissions/${submissionId}/audio`. A 429 surfaces as an `Error` whose message contains `RATE_LIMIT_EXCEEDED` (follow how `useReadAudio` / `fetchFn` already surface non-2xx — do not invent a new error type).

- [ ] **Step 1: Failing tests:** schema parses a result with `spokenText: null`, with `spokenText: 'x'`, and without the field (old shape); `PhraseAudioResponseSchema` rejects a non-URL `audioUrl`.
- [ ] **Step 2: Run** `pnpm --filter @language-drill/api-client test` → FAIL.
- [ ] **Step 3: Implement** schema fields, response schema, hook (copy `useReadAudio`), exports.
- [ ] **Step 4: Run** tests → PASS; `pnpm --filter @language-drill/api-client build`.
- [ ] **Step 5: Commit** `feat(api-client): phrase audio hook`.

### Task 5: Result-card UI

**Files:**
- Create: `apps/web/app/(dashboard)/drill/_components/spoken-sentence.tsx`
- Modify: `cloze-exercise.tsx`, `translation-exercise.tsx`, `sentence-construction-exercise.tsx` (same dir) — inside the `submission.kind === 'evaluated'` `FeedbackShell`
- Modify: `exercise-pane.tsx` only if `exerciseId` / `fetchFn` don't already reach all three components
- Test: `apps/web/app/(dashboard)/drill/_components/__tests__/spoken-sentence.test.tsx` (new component → new file), plus one render case each in the three existing exercise tests

**Interfaces:**
- Consumes: `usePhraseAudio` (Task 4); `submission.result.spokenText`, `submission.result.submissionId`.
- Produces: `SpokenSentence({ text, exerciseId, submissionId, fetchFn }: { text: string; exerciseId: string; submissionId: string; fetchFn: AuthenticatedFetch })`. Parents render it only when `spokenText`, `submissionId`, `exerciseId` and `fetchFn` are all present.

- [ ] **Step 1: Failing tests** (`spoken-sentence.test.tsx`, mock the hook like `read/page.test.tsx` mocks `useReadAudio`):
  - `shows the sentence and a play button, no request before click`.
  - `first click calls mutate with exerciseId + submissionId`.
  - `second click replays without a second mutate` (after data resolves).
  - `pending shows 'preparing audio…'`; `error shows a quiet retry chip`; `429 shows 'daily audio limit reached'` inline (no error card).
  - Each exercise test: `renders SpokenSentence when spokenText is present` and `omits it when spokenText is null`.
- [ ] **Step 2: Run** `pnpm --filter @language-drill/web test -- spoken-sentence cloze-exercise translation-exercise sentence-construction-exercise` → FAIL.
- [ ] **Step 3: Implement.** Follow `read/_components/passage-audio.tsx`: chip button with the speaker glyph → mutate → on data render the drill `AudioPlayer` (`waveform={[]}`), which gives replay, seek and slow mode; do not pass `floating`. Sentence text above the control in the body face (`t-body`), labelled "hear it" with the `t-micro text-ink-mute` eyebrow style used by "the version we coded". In translation, place it above that reference card.
- [ ] **Step 4: Run** tests → PASS.
- [ ] **Step 5: Commit** `feat(web): play the corrected sentence on result cards`.

### Task 6: Verify, ship, sync prompt

- [ ] **Step 1:** `pnpm lint && pnpm typecheck && pnpm test` from the worktree root → zero failures.
- [ ] **Step 2:** `pnpm eval` on the existing evaluation dataset, baseline vs candidate prompt (see `pnpm eval` in CLAUDE.md). Pass = mean score Δ within ±0.03 and `correctedAnswer` present on ≥ 98% of items. Then hand-check ~10 TR A1 submissions on the dev stack, including a partial translation, an English answer, a wrong-meaning translation and an SC missing a keyword: each must come back **rewritten**, not echoed. Record results in the PR body.
- [ ] **Step 3:** Runtime check with `/verify`: `pnpm dev`, submit one TR cloze (exact), one TR cloze (wrong), one translation; press play on each, confirm audio plays and a second press makes no network request; `shoot` the three result cards.
- [ ] **Step 4:** Push branch, open PR (squash-merge per memory), body summarizes spec + eval numbers.
- [ ] **Step 5 (after merge):** sync the evaluation prompt to Langfuse prod and dev per CLAUDE.md (`push-prompts --dry-run`, `push-prompts`, `bootstrap-prompts --check` → exit 0), from fresh `main`.
