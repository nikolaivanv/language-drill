# Hear the corrected sentence — design

Date: 2026-11-08 · Status: approved in chat, pending plan

## Why

The author is learning Turkish at A1 with little exposure to spoken Turkish and
is unsure how written words are pronounced. Hearing the **correct** sentence
right after answering reinforces pronunciation and should make the correct
forms stick faster. Built for every language with a reading voice (ES/DE/TR);
Turkish is the motivating case.

## What the learner gets

After a **cloze**, **translation**, or **sentence construction** exercise is
graded, the result card shows the correct sentence with a play button. They
can play and replay it as often as they like.

What gets spoken (decided by the user):

| Type | Spoken sentence |
|---|---|
| Cloze | The **whole** sentence, blank filled with the learner's word if it was accepted, otherwise the corrected word. Never just the answer word. |
| Translation | The learner's **own** sentence, corrected if it had errors (not the reference translation). |
| Sentence construction | The learner's **own** sentence, corrected if it had errors (not a model answer). |

- **On demand only.** Nothing is pre-voiced. Audio is synthesized the first
  time someone presses play and cached after that.
- **Press to play**, no autoplay (my call; the user did not ask for autoplay).
- Seeking and slow mode are nice-to-haves: include them if the existing drill
  `AudioPlayer` gives them cheaply; drop them otherwise. Sentences are short.

## Goals / non-goals / anti-goals

- Goal: hear a correct, natural rendering of *what I meant to say* in the
  target language, replayable.
- Non-goals: pre-generating audio for the pool; accent/pronunciation scoring;
  voicing dictation, vocab recall, conjugation, paraphrase, or free writing;
  English (no voice — no button).
- **Anti-goal:** speaking a sentence that is still wrong. A missing button is
  better than a confidently voiced error. This rules out reconstructing the
  corrected sentence by splicing per-error `text → correction` spans into the
  answer in code (spans don't match verbatim, overlap, and word-order fixes
  don't splice). The user explicitly chose the grader-change approach instead.

## How

### 1. Grader returns the full corrected answer (decided by the user)

The evaluator today returns only per-error span fixes (`errors[].correction`);
no full corrected sentence exists anywhere.

- Add `correctedAnswer: string` to the `submit_evaluation` tool
  (`packages/ai/src/evaluate.ts`, `buildEvaluationTool`) and to
  `EvaluationResult` (`packages/shared/src/index.ts`, **optional** — history
  rows written before this change lack it) and its Zod mirror in
  `packages/api-client`.
- Meaning: the learner's answer with **every** listed error fixed, kept as
  close to their wording and structure as possible. If there are no errors and
  the task is fully achieved, it is the learner's answer verbatim. For cloze,
  it is the corrected **fill for the blank** only, not the sentence.
- **Task misses get rewritten too (decided by the user).** When the answer is
  grammatical but does not do the task — different meaning from the source,
  part of the source untranslated, required keywords / target structure /
  register ignored, or written in the wrong language — `correctedAnswer` is the
  learner's sentence rewritten so it fully does the task, still staying as
  close to their wording as the task allows. The user accepts that it may then
  no longer feel like "their" sentence; a correct sentence matters more.
- Add the matching rule to `EVALUATION_SYSTEM_PROMPT` (`prompts.ts`), bump
  `EVALUATION_SYSTEM_PROMPT_VERSION` to `evaluate@2026-11-08` (or the merge
  date), and after merge push to Langfuse prod + dev per CLAUDE.md
  (`push-prompts`). The field must sit **after** `errors` in the tool schema so
  the model writes it with its error list already committed (`reasoning` stays
  first).
- The tool is used for all `evaluateAnswer` types (incl. vocab recall,
  contextual paraphrase). The field is harmless there; only the three types
  above consume it. Strict-tool shaping (`shapeToolRequest`) applies — follow
  whatever `required` convention the other fields use, and run
  `pnpm verify:model-requests --surfaces` before merging.
- Free-writing and dictation graders are separate surfaces and are untouched.

### 2. Which text gets spoken (server-side)

Derived on the server from the stored submission, never from client-sent text
(so the TTS endpoint cannot be used to voice arbitrary strings):

- **Cloze** = `content.sentence` with its `___` blank replaced by the fill:
  - deterministic exact-match submission (`evaluationSource: 'deterministic'`)
    → the learner's answer;
  - LLM-graded → `evaluation.correctedAnswer`;
  - missing `correctedAnswer` (old row / model omitted it) → `content.correctAnswer`.
  - A sentence without `___` → no audio.
  - My call: for the deterministic path, voice the **matched accepted form**
    (`correctAnswer` or the matching `acceptableAnswers` entry), not the raw
    typed string. The exact-match grader (`packages/shared/src/fluency.ts`)
    forgives case, trailing punctuation and dotless `I` for `İ`; spliced in
    literally, a Turkish `I` would be voiced as ı. Same word, correct spelling.
- **Translation / sentence construction** = `evaluation.correctedAnswer`.
  Missing → no audio (do not fall back to the reference — that would contradict
  "my own sentence"; hiding the button is the safe failure).
- My call — server-side sanity checks on `correctedAnswer` (all types), since
  the prompt alone should not be the only guard:
  - empty / whitespace → no audio;
  - `correctedAnswer` equals the learner's answer (after normalization) while
    either `errors` is non-empty or `taskAchievement` < 0.7 → no audio (the
    model claimed a problem but fixed nothing; threshold is my call);
  - otherwise voice `correctedAnswer`.
- Trim + collapse whitespace (`normalizePassageText`).

The submit response also carries this text as `spokenText` (null when no audio
is possible) so the UI can render it and decide whether to show the button.
My call: show the sentence next to the play button — it is what you hear, and
for translation/SC it is the first place the full corrected sentence appears.

### 3. Audio endpoint

`POST /exercises/:id/submissions/:submissionId/audio` (mirrors the existing
`/explain` sub-route shape). Modeled exactly on reading audio
(`infra/lambda/src/lib/read-audio-service.ts`, `POST /read/:entryId/audio`):

- Ownership enforced by loading the history row for `(submissionId, userId)`;
  unknown / cross-user → 404.
- Voice: `READING_VOICE_BY_LANGUAGE` (TR = Burcu, ES = Lucia, DE = Vicki).
  Non-ES/DE/TR → 404.
- **Content-addressed** key over `(language, voice, text)` like
  `readingAudioKey`, under a separate prefix (e.g. `phrase/<sha256>.mp3`) so
  identical sentences are synthesized once across all users.
- HeadObject hit → free. True miss → check a daily cap, synthesize with
  `synthesizeToS3`, record usage.
- Returns a presigned URL (`presignAudioUrl`) + estimated duration.
- New usage bucket (e.g. `phrase_tts`) in `infra/lambda/src/usage/limits.ts`,
  boosted = 10× like every bucket. My call on the number: 100/day free. Like
  `read_tts`, it is outside the global Claude cost brake.
- No new DB column needed: the key is derivable from the text, so a cache hit is
  one HeadObject. (Builder may persist it if that is simpler; not required.)
- Make sure the Lambda role already has Polly + bucket access for this route
  (reading audio runs in the same API Lambda — verify, don't assume).

### 4. UI

In `cloze-exercise.tsx`, `translation-exercise.tsx`,
`sentence-construction-exercise.tsx`, inside the evaluated `FeedbackShell`:
a compact row with the spoken sentence and a play button, shown only when
`spokenText` is non-null. First press calls the audio mutation (new hook in
`packages/api-client`, like `useReadAudio`), then plays; later presses replay
from the cached URL without another request. Loading, rate-limited, and error
states are quiet inline text, never a blocking error card. Reuse the drill
`AudioPlayer` if it fits a compact row (it expects a waveform — a flat or
synthetic one is fine); otherwise a minimal play/replay button.

Revisits of past results (debrief / history views) are **not** in scope.

## Verification

- Unit tests next to the existing ones: spoken-text derivation per type and
  fallback; the audio service's hit/miss/rate-limit/not-found branches
  (copy the reading-audio tests); tool schema/parse of `correctedAnswer`.
- Prompt: `pnpm eval` on the existing evaluation dataset to confirm scores do
  not move and `correctedAnswer` is present and correct; spot-check TR A1 cases,
  including task misses (partial translation, wrong meaning, English answer,
  missing SC keyword) to confirm they come back rewritten, not echoed.
- UI: `shoot` the three result cards; play one real clip on the dev stack.

## Left to the builder

Exact prompt wording; component structure; whether to reuse `AudioPlayer` or
a slimmer control; error copy; test layout within existing files.
