# Read Practice — Listen & Shadow (Audio Playback)

**Date:** 2026-07-08
**Status:** Approved design; ready for implementation plan
**Branch:** `feat/read-practice-audio-shadowing`

## Summary

Add a "Listen" control to a read-practice passage that plays the whole passage as
one AWS Polly–synthesized MP3, reusing the existing `<AudioPlayer>` (play/pause,
seek, replay, 0.75× slow). Audio is synthesized **lazily on first play** and cached
in S3, so replays are free and Polly is billed only for passages people actually
listen to.

**Purpose:** shadowing practice, ear-training for how the language sounds, and a
model to check one's own pronunciation against — all in service of the app's
active-production positioning.

## Scope

**In scope (this spec):**

- Whole-passage playback of a single MP3 per passage.
- Lazy, on-first-play synthesis with content-addressed caching + cross-user dedup.
- Reuse of the existing `<AudioPlayer>` component, with one small backward-compatible
  change (empty-waveform fallback).
- A new metered usage bucket for TTS synthesis.

**Explicitly out of scope (separate future specs):**

- Recording the learner's voice, self-compare playback, or any AI pronunciation
  scoring (that is Phase 2 speaking: MediaRecorder → Transcribe → evaluation).
- Sentence-level segmentation, per-sentence looping, or karaoke-style word/sentence
  highlighting (speech-mark sync). Whole-passage playback only.
- Pre-generating audio eagerly at passage-generation time.

## Background — current state

- **Read practice** lives at `/read` (`apps/web/app/(dashboard)/read/`). A passage is
  a single free-text blob (`text`), 60–320 words by length tier
  (`packages/shared/src/read.ts` `READING_LENGTH_WORD_TARGETS`). The client tokenizes
  it for tap-to-annotate; **no per-sentence structure is stored.**
- Content lives in two tables (`packages/db/src/schema/read.ts`): `read_entries`
  (per-user passage — generated or pasted) and `generated_reading_texts` (cross-user
  cache for generated passages, keyed by `cacheKey`, with `hitCount`). **Neither has
  any audio column today.**
- **TTS infra exists but is dictation-only:** `synthesizeToS3` + `dictationAudioKey`
  (`packages/db/src/lib/polly-synth.ts`), an async SQS synth Lambda writing
  `exercises.audio_s3_key`, `presignAudioUrl` (`infra/lambda/src/lib/audio-url.ts`,
  1-hour presigned GET), and a per-language neural voice map
  (`packages/ai/src/generate.ts:68`, currently ES/TR/DE).
- **`<AudioPlayer>`** (`apps/web/app/(dashboard)/drill/_components/audio-player.tsx`)
  is reusable: `{ src, waveform: number[], durationSec }`. It already prefers the real
  `<audio>.duration` once loaded (so `durationSec` need only be an estimate) and has
  the 0.75× slow toggle + replay. **`synthesizeToS3` does not compute a waveform** —
  that is the one gap for reading.
- Storage is a single private S3 bucket (`CONTENT_BUCKET_NAME`); no CloudFront on it —
  audio is served via short-lived presigned URLs.

## Design

### 1. Storage — content-addressed keys (free cross-user dedup)

Key the S3 object by a content hash rather than by passage row:

```
reading/<sha256(language + '|' + voiceId + '|' + normalizedText)>.mp3
```

- The same generated passage served to many users (`generated_reading_texts` already
  shares text cross-user) synthesizes **once**; identical pasted text reuses too.
- `normalizedText` = trimmed, whitespace-collapsed passage text, so trivially
  different copies still hit the same key.
- Add nullable `audio_s3_key` (text) to `read_entries`. Once a row's audio is known,
  later plays skip even the hash/HeadObject step and go straight to presign.

### 2. Backend — new endpoint on the Hono API

`POST /read/:entryId/audio` on the **main API Lambda** (returns a presigned URL, not
SSE — so it does *not* belong on the annotate-stream Lambda). Flow:

1. Load the passage `text` + `language` from the caller's `read_entries` row (404 if
   not found / not owned).
2. If `read_entries.audio_s3_key` is already set → `presignAudioUrl` → return.
3. Resolve a neural voice for the language from the shared voice map
   (`packages/ai/src/generate.ts`). **Extend the map** for any read-supported language
   it is missing (e.g. English).
4. Enforce the **Polly neural char limit (3000 chars)** — see §5.
5. Compute the content-hash key → `HeadObject`. If the object exists (another user
   already synthesized it), skip Polly. Otherwise `synthesizeToS3`
   (`packages/db/src/lib/polly-synth.ts`), counting one metered synth (§6).
6. Persist `audio_s3_key` on the `read_entries` row.
7. `presignAudioUrl(key)` → return `{ url, durationSec }`, where `durationSec` is a
   word-count-based estimate (the player self-corrects on load).

**Infra changes:**

- **Polly IAM** on the API Lambda (today only the dictation SQS Lambda has
  `polly:SynthesizeSpeech`) — grant it in the CDK stack.
- The API Lambda already has S3 read/write via `CONTENT_BUCKET_NAME`; confirm
  `s3:PutObject` + `s3:HeadObject` + `s3:GetObject` on the reading key prefix.

### 3. Frontend

- New mutation hook `useReadAudio(entryId)` in `packages/api-client` (TanStack Query),
  hitting `POST /read/:entryId/audio`.
- In `AnnotatedView` (the passage view under `apps/web/app/(dashboard)/read/`), add a
  **"Listen"** button. On click: show a brief "preparing audio…" state → on success
  mount `<AudioPlayer src={url} waveform={[]} durationSec={estimate} />`.
- **One shared-component change:** when `waveform.length === 0`, `<AudioPlayer>`
  renders a plain continuous progress-bar track instead of amplitude bars. This is
  backward-compatible — dictation always passes a non-empty waveform; reading passes
  `[]`. (Chosen over server-side waveform extraction, which would add an MP3-decode
  dependency for a purely decorative element on whole-passage playback.)

### 4. Voice selection

Reuse the per-language neural voice map from `packages/ai/src/generate.ts`. Reading
supports ES/DE/TR as target languages only (no EN reading-practice surface, so no
English voice is needed — see resolved open question 3 below). Voice is deterministic
per language so the content hash is stable: ES→Lucia, DE→Vicki, TR→Burcu.

### 5. Long-passage guard (Polly neural 3000-char cap)

Generated passages (≤320 words ≈ ~2000 chars) stay under the limit. Pasted passages
are unbounded. **MVP behavior:** if `normalizedText` exceeds the neural char limit,
the endpoint returns a typed "too long to narrate" response and the UI shows the
Listen control in a disabled state with an explanatory tooltip. (Chunk-and-concat
across multiple Polly calls is deferred to a follow-up — noted, not built now.)

### 6. Cost control — metered `read_tts` bucket

Add a `read_tts` usage bucket following the existing `usage_events` pattern
(`infra/lambda/src/usage/limits.ts`). **Only actual synths are counted** — cache hits
(HeadObject found, or `audio_s3_key` already set) and replays are free. Suggested
limits: generous free/boosted (Polly is cheap and results are cached) — exact numbers
set during implementation. Whether the global AI kill-switch / daily cap
(`infra/lambda/src/usage/global-capacity.ts`) also gates this bucket is an open
question for review; default recommendation is to leave TTS outside the Claude-cost
brakes.

## Data flow

```
User clicks "Listen"
  → POST /read/:entryId/audio
      → load read_entries row (owned by caller)
      → audio_s3_key set? ──yes──► presignAudioUrl ─────────────┐
              │no                                               │
              ▼                                                 │
        resolve voice; char-limit guard                         │
              ▼                                                 │
        hash key → HeadObject                                   │
              ├─ exists ──► (skip Polly) ──────────┐            │
              └─ missing ─► synthesizeToS3 (Polly)  │            │
                           + count read_tts synth   │            │
                                     ▼              ▼            │
                           persist audio_s3_key on row          │
                                     ▼                          │
                              presignAudioUrl ──────────────────┤
                                                                ▼
                                          { url, durationSec }
  → mount <AudioPlayer src={url} waveform={[]} durationSec={est} />
```

## Testing

- **Unit:** content-hash key derivation + `normalizedText` normalization; HeadObject
  skip-synth path vs. synth path; voice resolution (incl. newly added language);
  char-limit guard boundary.
- **Endpoint:** `POST /read/:entryId/audio` with mocked Polly + S3 — cache-hit,
  fresh-synth, over-limit, and not-owned/404 cases; asserts `read_tts` counted only on
  fresh synth.
- **Component:** Listen button → "preparing" state → `<AudioPlayer>` mount; empty-
  waveform progress-bar fallback renders and seeks.
- Add to existing test files per module; follow existing conventions.

## Open questions (for spec review)

1. **Resolved.** `read_tts` free/boosted limit numbers: **50/day free, 500/day
   boosted** — same shape as the other metered AI buckets (`ai_evaluation`,
   `read_annotation`, `read_span_annotation`) in `infra/lambda/src/usage/limits.ts`.
2. **Resolved.** The global AI kill-switch / daily cap (`AI_KILL_SWITCH`,
   `AI_GLOBAL_DAILY_CAP` in `infra/lambda/src/usage/global-capacity.ts`) does **not**
   gate `read_tts` — TTS stays outside the Claude-cost brakes, per the recommendation
   above (Polly is cheap and results are content-hash cached, so it doesn't need the
   same emergency brake as Claude spend).
3. **Resolved — moot.** No English voice is needed: read practice only supports
   ES/DE/TR as target languages (there is no EN reading-practice surface), so
   §4's "add English" note does not apply. The reading voice map is ES→Lucia,
   DE→Vicki, TR→Burcu (all Amazon Polly neural voices), matching the existing
   per-language voice map in `packages/ai/src/generate.ts`.

## Rollout / ripple notes

- New DB column → forward-only Drizzle migration (`read_entries.audio_s3_key`).
- New usage bucket → touches `infra/lambda/src/usage/limits.ts` and the `usage_events`
  event-type union; grep for exhaustive maps over event types.
- CDK change (Polly IAM on API Lambda) → CFN snapshot test may need updating.
```
