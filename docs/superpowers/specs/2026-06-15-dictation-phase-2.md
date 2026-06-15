# Dictation Drill — Phase 2 Roadmap

_Date: 2026-06-15 · Status: backlog (not yet specced)_

Phase 1 (slice 1) shipped in **PR #295** (the core listening loop: the
`dictation` exercise type, deterministic char/word-diff + Claude "forgiveness"
grading, Polly→private-S3 audio with presigned playback, the in-flow player +
diff-results UI, and the `listening` radar axis lit up — all on **hand-seeded**
clips). This doc lists what was intentionally deferred, roughly prioritized.
Each item should get its own brainstorm → spec → plan before building.

Phase-1 design + the contracts these build on:
[`2026-06-13-dictation-exercise-design.md`](2026-06-13-dictation-exercise-design.md).
Implementation plan: [`../plans/2026-06-14-dictation-exercise-slice-1.md`](../plans/2026-06-14-dictation-exercise-slice-1.md).

---

## Already done since slice 1 shipped

- **~~Register the dictation eval prompt in Langfuse.~~** Done in **PR #297** +
  synced to prod and dev (`dictation-eval-system-prompt`, surface
  `dictation-eval`). Was originally listed under "Slice 2 — scale-out"; the
  runtime now fetches it from Langfuse (was serving the in-repo fallback).

---

## The headline item

### 1. Batch generation pipeline for dictation content (the big one)

Slice 1 hand-seeds ~6 Spanish clips via `pnpm db:seed:dictation` (clip text
authored in-repo, audio synthesized once at seed time). **Dictation is the only
exercise type not produced by the background generation pipeline.** Phase 2
wires it in so the pool fills and refreshes automatically like cloze /
translation / vocab / sentence-construction:

- **Text generation** — a `DICTATION_GENERATION_PROMPT` (+ version) that drafts
  natural connected-speech clips per `(language, CEFR, …)` cell; a
  `DICTATION_VALIDATION_PROMPT` checking length, vocabulary band, naturalness,
  and listenability (no tongue-twisters / ambiguous segmentation). Route via the
  existing `routeValidationResult` / `validateAndInsertWithRetry` machinery.
- **Audio generation as a background job** — move Polly synthesis out of the
  seed script into a dedicated **SQS-fed audio-synth Lambda** (new CDK
  construct + queue), triggered after a dictation row is approved: synthesize →
  upload to S3 → set `audioS3Key`. The presigned-GET serving path from slice 1
  is unchanged.
- **Coverage controller / scheduler** — register dictation cells so the
  scheduler refills under-target cells. Note the slice-1 exhaustiveness stubs
  that currently **reject** dictation on the generation path
  (`generate.ts`, `generation-prompts.ts`, `validation-prompts.ts`,
  `cell-targets.ts` has `[DICTATION]: {}`) must be replaced with real handling,
  and the curriculum/cell enumeration (`packages/db/src/generation/cells.ts`
  `compatibleTypes()`) must include dictation.
- **`eval:gen` coverage** — extend the generation-quality gate to dictation so
  prompt changes can be A/B'd before the scheduler converges.

This is a substantial, multi-package effort — its own milestone.

---

## Major items

### 2. Partial / gap-fill variant (slice 3)
Listen-and-fill: most of the line is given, the learner types only the missing
words. Needs its own grading (gap-level exact match + forgiveness), a gapped
prose input UI, and the scaffolded entry point. The prototype's `DictPartial`
screen is the visual reference; `DictationContent` would grow a `gaps` shape (or
a sibling content type).

### 3. Persisted phonology sub-competency model
Today the finer breakdown (phoneme discrimination, word-boundary / sinalefa,
connected-speech tracking, silent-letter spelling) is **descriptive result
content only** — dictation rolls up to the single `listening` radar axis. Phase
2 could persist these as real tracked sub-competencies (storage + Bayesian
update + dashboard surfacing). This is its own design project (the progress
model currently has six fixed axes, no sub-competency storage).

### 4. Getting-unstuck helpers
Slice 1 has no hint ladder. The strategy doc's listening helpers:
- **Replay** with a tracked, level-gated count (fewer replays → stronger signal).
- **Slow down** (0.75× exists on the player, but isn't a scored hint yet).
- **Show transcript** — reveals the text (exercise becomes reading; score weight
  adjusted). The prototype's "can't make it out" reveal.
Each affects the progress signal weight (see the hint-scoring model), so the
submit/eval path must know which aids were used.

### 5. Standalone hub + setup/brief surfaces
The prototype's A (drill hub) and B (setup: accent, full-vs-partial mode chooser,
slow-start) screens were collapsed into the in-pane flow for slice 1. If a
richer pre-drill configuration is wanted, build them as real surfaces.

---

## Smaller / later

- **Real waveform envelopes.** The player's bars are a decorative static
  envelope (`waveform` in content) with a real playhead. Compute a true
  amplitude envelope from the MP3 at generation time if the visual fidelity
  matters.
- **Replay/slow-mode score weighting.** Replays and 0.75× are displayed but do
  not down-weight the score yet (pairs with item 4).
- **Bespoke dictation debrief renderer.** A dictation item currently renders
  degraded-but-fine in `/drill/debrief` (header + status chip, blank body — the
  dispatcher falls through to `null`, no crash). Add a renderer that replays the
  clip + shows the stored diff/score. Also requires presigning `audioUrl` on the
  debrief (and `GET /sessions/today`) responses, which slice 1 left out of scope.
- **More languages + bigger pool.** Slice 1 seeds Spanish only (B1/B2). Add EN /
  DE / TR clips and more levels — largely subsumed by item 1 once generation
  exists.
- **CloudFront signed URLs.** Slice 1 serves audio via presigned S3 GET (1 h
  TTL). Move to CloudFront signed URLs if/when CDN delivery is wanted.
- **Localize the player chrome.** Some learner-facing strings are Spanish-only
  (e.g. the textarea placeholder `escribe la frase tal y como la oyes…`),
  mirroring the same gap flagged in the free-writing Phase 2 doc.
