# Dictation Exercise — Design (Slice 1)

_Date: 2026-06-13. Status: approved, pending spec review → implementation plan._

## Summary

Add **Dictation** — the first Listening-macro-skill exercise — as a new pool
exercise type that flows through the existing linear drill session. The learner
hears a short clip of native, connected speech, types what they hear, and is
graded by **deterministic character/word diff + a Claude "forgiveness" pass**
that distinguishes genuine listening errors from differences the ear can't
resolve (homophones, b/v, tildes, punctuation). Updates the (currently reserved)
**`listening`** progress axis.

This is **Slice 1: a self-contained vertical slice** — the full dictation
*experience* on a small set of hand-seeded clips, with Polly audio synthesized
at seed time. It deliberately defers the batch generation pipeline, the
partial/gap variant, and the standalone hub/setup screens to a follow-up.

Reference: `docs/exercise-strategy.md` §7 (Listening Comprehension → Dictation),
and the Claude Design prototype (`Dictation.html`, `Dictation - Mobile Web.html`).
The prototype is a **visual/information-design reference**, not a structural one:
its "paper" aesthetic, `Coach`/`CEFRBadge`/`CriterionRow` vocabulary, and
multi-surface hub/setup flow are adapted into the real app's existing components
and single-pane drill flow.

## Goals / Non-goals

**Goals**
- New `ExerciseType.DICTATION`, end-to-end: content model, seeded content +
  audio, audio player UI, transcription input, grading, results UI, progress.
- Establish the **Polly TTS + private-S3 audio-serving** plumbing (presigned
  GET) that the later batch pipeline reuses.
- Light up the reserved `listening` radar axis with real evidence.
- One responsive component set (desktop + mobile), matching the app's tokens.

**Non-goals (this slice)**
- Background/batch generation, validation, and coverage-controller wiring for
  dictation content (text + audio). Content is hand-seeded.
- The partial / gap-fill variant.
- Standalone drill-hub and setup/brief surfaces (the prototype's A & B screens).
- A persisted phonology sub-competency model (phonology/word-boundary/
  connected-speech remain *descriptive* result content, not stored axes).
- CloudFront signed URLs (presigned S3 GET is sufficient for the slice).
- Replay/slow-mode score down-weighting (displayed, not yet scored).

## Architecture decisions

### Decisions made by the user
- **Scope:** vertical slice on seeded clips.
- **Player model:** whole-clip, single submit (fits the existing
  submit→result contract; no per-sentence multi-step flow).
- **Audio source:** real AWS Polly synthesis inside the seed script
  (no SQS/background fan-out yet).

### Decisions made in design (approved)
1. **Decorative waveform, real playhead.** Render static decorative bars with a
   real playhead/progress driven by the `<audio>` element's `currentTime`/
   `duration`. A true amplitude envelope (MP3 decode) is deferred.
2. **Score = adjusted character accuracy** (forgiveness applied), clamped [0,1].
   This is what writes to `userExerciseHistory.score` and rolls up via the
   existing weighted-average aggregator.
3. **Listening-axis-only progress.** Map dictation → `listening`. The finer
   phonology / word-boundary / connected-speech breakdown is *descriptive*
   result content from the Claude pass, not new persisted competencies.
4. **Grading = code-diff-then-Claude** (not Claude-produces-whole-diff): a
   deterministic alignment in code yields exact raw accuracy + the differing
   segments; Claude only classifies each difference as accepted vs. error.
   Deterministic, cheap, reproducible.
5. **Reuse the `ai_evaluation` usage bucket** for the forgiveness call (no new
   `dictation` bucket this slice).

## Data model & content

New discriminated-union member in `packages/shared/src/index.ts`:

```ts
export type DictationContent = {
  type: ExerciseType.DICTATION;
  title: string;            // e.g. "El tiempo lo cura todo"
  blurb?: string;           // short brief shown on the clip card
  referenceText: string;    // the full transcription target (grading reference)
  sentences: string[];      // per-sentence reference, for display/segmentation
  accent: string;           // e.g. "español peninsular · centro"
  voiceId: string;          // Polly voice used to synthesize (e.g. "Lucia")
  domain?: string;
  register?: string;
  tested: string[];         // "what this tests" chips
  durationSec: number;
  waveform: number[];       // decorative envelope (0..1), ~52 bars
};
```

- Audio lives in S3; `exercises.audioS3Key` (column already exists, currently
  unused) is populated at seed time. No DB migration required — `type` is free
  text and `contentJson` is jsonb.
- Add `isDictationContent()` guard and register the type in the union.

### Seeding — `pnpm db:seed:dictation`

New **idempotent** seed script (mirrors `db:seed:exercises`):
1. Holds ~6 hand-authored / Claude-drafted clips. Primarily **Spanish B2**
   (matches the prototype's connected-speech focus); include a couple at **B1**
   to exercise difficulty weighting.
2. For each clip: call **AWS Polly** (neural voice per language) to synthesize
   the MP3, upload to S3 under a stable key (e.g.
   `dictation/{exerciseId}.mp3`), store `audioS3Key`.
3. Idempotent on a stable natural key (skip if the exercise + audio already
   exist); safe to re-run.

Requires AWS creds + `polly:SynthesizeSpeech` and `s3:PutObject` for the
runner. (CDK IAM change is limited to the audio-serving presign on the API;
synthesis runs from the seed script, not Lambda, in this slice.)

## Audio serving

- `GET /exercises`, `GET /exercises/:id`, and the session exercise mapping
  (`infra/lambda/src/routes/sessions.ts`) return a **presigned S3 GET URL**
  derived from `audioS3Key` (the bucket is private; key is never exposed raw).
- A small presign helper in the Lambda layer; URL TTL comfortably exceeds a
  drill session.
- Frontend `DictationContent` is augmented at response time with `audioUrl`
  (presigned), not the raw key.

## Grading pipeline (submit path)

`POST /exercises/:id/submit` is generic today; dictation grading branches on
exercise type:

1. **Deterministic diff (code).** Align `referenceText` vs. typed answer.
   Produce `rawCharAccuracy`, `wordAccuracy`, and an ordered list of differing
   segments (got/expected, char span). Normalization is conservative
   (case + surrounding whitespace), with diacritics preserved so the
   forgiveness pass can rule on them.
2. **Claude forgiveness pass (one metered call, `ai_evaluation` bucket).**
   Inputs: reference, answer, and the diff segments. For each difference,
   Claude returns `{ kind: 'accepted' | 'error', category, severity?, note }`
   where `accepted` = the ear can't resolve it (homophone, b/v, tilde,
   punctuation, contraction, ñ) and `error` = a genuine listening/spelling
   miss (word boundary, h-muda, mishearing). Also returns `headline` +
   `summary` + per-criterion CEFR notes.
3. **Adjust.** `adjustedCharAccuracy` excludes accepted differences.
   `score = adjustedCharAccuracy` (clamped). Persist to `userExerciseHistory`
   exactly as other types do (`score`, `responseJson`).

New prompt: `DICTATION_EVAL_SYSTEM_PROMPT` + `DICTATION_EVAL_PROMPT_VERSION`
(`dictation@2026-06-13`) in `packages/ai/src/`, re-exported from the package
index. In-repo fallback serves this slice (Langfuse bootstrap is a follow-up).

## Result contract & UI

New result type returned by the dictation submit branch (keeps a top-level
`score` so storage/aggregation are untouched):

```ts
export type DictationResult = {
  score: number;                 // = adjustedCharAccuracy
  rawCharAccuracy: number;
  adjustedCharAccuracy: number;
  wordAccuracy: number;
  headline: string;
  summary: string;
  diff: DictationDiffSegment[];  // for the inline diff prose
  differences: DictationDifference[]; // accepted/error + category + note
  criteria: { id: string; label: string; score: number; cefr: string; note: string }[];
};
```

Frontend touch points:
- `apps/web/.../drill/_components/exercise-pane.tsx` — dispatch
  `isDictationContent` → `<DictationExercise>`.
- **New** `dictation-exercise.tsx` (responsive), composed of:
  - **Clip brief card** — title, accent, tested-tags chips.
  - **Audio player** — play/pause, replay, 0.75× slow (`audio.playbackRate`),
    decorative waveform + real playhead, elapsed/total. New small
    `audio-player.tsx` component.
  - **Type box** — one textarea + existing `AccentPicker` (ES/DE/TR), single
    "check" submit.
  - **Results** — reuse `FeedbackShell` for verdict tier/headline, with a
    dictation body: character-diff prose (struck original → correction for
    errors; dotted underline for accepted), per-difference list with
    forgiveness notes, adjusted-vs-raw accuracy, accuracy-criteria rows.
- `apps/web/lib/drill/coach-messages.ts` — idle + evaluated copy for dictation.
- `apps/web/lib/drill/verdict-tier.ts` — dictation verdict mapping (or reuse).

Verdict tiers reuse the existing sage/yellow/terracotta scheme on `score`.

## Progress wiring

- `infra/lambda/src/lib/progress-aggregation.ts`:
  `axisForExerciseType(DICTATION) → 'listening'`.
- No schema change; mastery is computed dynamically from `userExerciseHistory`.
- This is the first exercise to populate the `listening` radar axis.

## Exercise-type registration touch points

1. `packages/shared/src/index.ts` — enum + `DictationContent` + union + guard.
2. `packages/ai/src/prompts.ts` (or a new `dictation-prompts.ts`) —
   `DICTATION_EVAL_SYSTEM_PROMPT` + version; index re-export.
3. Backend submit branch — deterministic diff module + forgiveness call +
   `DictationResult` assembly (`infra/lambda/src/routes/exercises.ts` + a new
   `lib/dictation/diff.ts`).
4. `infra/lambda/src/routes/exercises.ts` + `sessions.ts` — presigned `audioUrl`
   in exercise responses.
5. `infra/lambda/src/lib/progress-aggregation.ts` — `listening` mapping.
6. `apps/web/.../drill/_components/exercise-pane.tsx` — dispatch.
7. `apps/web/.../drill/_components/dictation-exercise.tsx` + `audio-player.tsx`
   — **new**.
8. `apps/web/lib/drill/coach-messages.ts`, `verdict-tier.ts` — dictation copy.
9. `packages/db/scripts/seed-dictation.ts` + `package.json` script — **new**.
10. CDK: `polly:SynthesizeSpeech` for the seed runner path is local creds;
    API Lambda gets S3 `GetObject`/presign on the audio bucket if not already
    present.

## Testing

- **Unit (pure):** the deterministic diff/accuracy function — table-driven:
  exact match, case/whitespace normalization, diacritic-preserving alignment,
  word-boundary splits (`lo cura` vs `locura`), partial-word edits.
- **Unit:** forgiveness merge — accepted differences excluded from adjusted
  accuracy; `score` equals adjusted accuracy.
- **Unit:** presign helper returns a URL for a key; omits when key is null.
- **Component/E2E:** dictation pane renders the player, accepts a transcription,
  submits, and shows the diff result (following existing Vitest/Playwright
  patterns; authenticated project).
- **Seed:** idempotency (re-run is a no-op; no duplicate audio uploads).

All of `pnpm lint && pnpm typecheck && pnpm test` green before push.

## Follow-up slices (explicitly out of scope here)

- **Slice 2 — scale-out:** wire dictation content (text + audio) into the
  background batch generation/validation + coverage controller; SQS audio-synth
  Lambda; bootstrap the dictation eval prompt into Langfuse.
- **Slice 3 — partial/gap variant:** listen-and-fill, with its own grading and
  the scaffolded entry UI.
- **Later:** real waveform envelopes; replay/slow-mode score weighting; a
  persisted phonology sub-competency model; CloudFront signed audio URLs.
