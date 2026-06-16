# Dictation Debrief Renderer — Design

_Date: 2026-06-15 · Status: designed (pending plan) · From the Phase 2 roadmap "smaller / later" list ([`2026-06-15-dictation-phase-2.md`](2026-06-15-dictation-phase-2.md))_

## Goal

On the post-session debrief (`/drill/debrief`), a dictation item currently renders
degraded — header + status chip, blank body — because the per-type renderer
dispatcher in `review-item-card.tsx` has no `dictation` branch and falls through
to `null`. Add a renderer that **replays the clip and shows the stored diff /
score / criteria** the learner saw at submit time.

The full `DictationResult` is already persisted
(`user_exercise_history.response_json.evaluation`) and returned by the debrief
endpoint; two plumbing gaps and one UI gap stand between that and a rendered
debrief.

## Scope (decided during brainstorming)

- **Include audio replay** — reuse the existing `AudioPlayer`; presign `audioUrl`
  on the debrief endpoint (the roadmap's "replays the clip + shows the stored
  diff/score").
- **Reuse, don't reinvent** — extract the presentational result body out of the
  live `DictationResults` so live + debrief share one component.
- Out of scope: presigning `GET /sessions/today` (that feeds the *live* plan, and
  `POST /sessions` already presigns it — a separate concern); any change to
  grading or the live submit flow's behavior.

## Architecture — three layers

### 1. Backend — presign `audioUrl` on debrief dictation items

`GET /sessions/:id/debrief` (`infra/lambda/src/routes/sessions.ts`, the item-mapping
around lines 630–661) currently returns `contentJson: row.content_json` raw, so
`audioUrl` is absent (it is injected at response time, never stored). Mirror what
`POST /sessions:129` already does:

- Ensure the debrief item query SELECTs `audio_s3_key`.
- For each item, when `type === 'dictation'`, set
  `contentJson: withAudioUrl(row.content_json, await presignAudioUrl(row.audio_s3_key))`;
  non-dictation items return `content_json` unchanged. Map items via `Promise.all`
  so the presign calls run concurrently.
- `presignAudioUrl` already returns `null` when the bucket env is unset or the key
  is missing, and `withAudioUrl` leaves `audioUrl` absent in that case — so a row
  whose audio synthesis hasn't completed degrades to "no clip", never an error.

### 2. Schema — preserve `DictationResult` in `evaluation`

`packages/api-client/src/schemas/debrief.ts` validates
`evaluation: EvaluationResultSchema.nullable()`. A `DictationResult` *is*
`EvaluationResult`-compatible on the common fields, so it parses — but Zod strips
the dictation-specific fields (`diff`, `differences`, `criteria`, `headline`,
`summary`, `rawCharAccuracy`, `adjustedCharAccuracy`, `wordAccuracy`,
`listeningCefr`). Widen it:

```ts
import { DictationResultSchema, EvaluationResultSchema } from "./exercise";
// ...
evaluation: z.union([DictationResultSchema, EvaluationResultSchema]).nullable(),
```

`DictationResultSchema` MUST be first: a dictation result matches it (it carries
`kind: "dictation"` + the required `diff`/`differences`/`criteria`); a plain
evaluation result fails it (missing those required arrays) and falls through to
`EvaluationResultSchema`. This mirrors the discrimination already in
`parseSubmitResult` (`exercise.ts:90`). `contentJson` stays `z.unknown()`, so the
presigned `audioUrl` flows through untouched. Update the inferred `DebriefItem`
type consumers accordingly (`evaluation` becomes the union type).

### 3. Web — renderer + shared-body extraction

- **Extract** the result body from `DictationResults` in
  `apps/web/app/(dashboard)/drill/_components/dictation-exercise.tsx` into a new
  presentational `apps/web/app/(dashboard)/drill/_components/dictation-result-body.tsx`:
  `DictationResultBody({ result }: { result: DictationResultResponse })` renders the
  diff prose (match / accepted / error segments), the per-difference cards, and the
  criteria rows — **no `FeedbackShell`, no next-button**. The live `DictationResults`
  keeps its `FeedbackShell` + score chip + next-button and renders
  `<DictationResultBody result={result} />` inside, so the two surfaces share one
  body and cannot drift.
- **`DictationBody`** (new, `drill/debrief/_components/dictation-body.tsx`) for the
  dispatcher: given `{ item }` where `item.contentJson` is `DictationContent` and
  `item.evaluation` is the (possibly null) `DictationResult`, render the
  `AudioPlayer` (`src={content.audioUrl}`, `waveform`, `durationSec`) followed by
  `<DictationResultBody result={evaluation} />`. Renders inside the existing
  `review-item-card` chrome (header + status chip already provided by the card).
- **Dispatcher:** add the branch at `review-item-card.tsx:72`:
  `: isDictationContent(content) ? <DictationBody item={item} /> : null`.

## Edge cases

- **Null / legacy `evaluation`** (rows predating dictation grading, or a submit that
  errored): `DictationBody` shows the clip player + the reference text + a "no result
  recorded" note; never crashes. (`item.evaluation === null` is already possible in
  the schema.)
- **No `audioUrl`** (audio synth not yet complete, or bucket env unset locally):
  `DictationBody` omits the `AudioPlayer` entirely (guards on `content.audioUrl`
  being a non-empty string); the diff/score body still renders.
- **Skipped dictation**: unchanged — the dispatcher's status-first `SkippedBody`
  branch already handles any skipped item before the type branches.
- **Non-dictation items**: untouched — the union still accepts `EvaluationResult`,
  and the presign is guarded on `type === 'dictation'`.

## Testing

- **api-client** (`schemas/debrief.test.ts`): a `DebriefItem` whose `evaluation` is a
  full `DictationResult` round-trips with `diff`/`differences`/`criteria` preserved;
  an `EvaluationResult` evaluation still parses; `evaluation: null` still parses.
- **Backend** (`routes/sessions.test.ts`): the debrief response presigns `audioUrl`
  on a dictation item's `contentJson` and leaves a non-dictation item's content
  unchanged; an item with a null `audio_s3_key` yields no `audioUrl` (no throw).
  Follow the existing mocked-presign test style in that file.
- **Web**:
  - `dictation-result-body.test.tsx` — given a `DictationResult`, renders the diff
    segments, difference cards, and criteria rows.
  - `review-item-card.test.tsx` — a dictation item renders `DictationBody` (player +
    diff/score/criteria present); a dictation item with `evaluation: null` shows the
    graceful "no result" body; a skipped dictation item still shows `SkippedBody`; a
    dictation item with no `audioUrl` renders the body without the player.
- Gate with `pnpm turbo run test --concurrency=1` (and the web E2E suite's existing
  debrief coverage, if any, stays green). Run lint + typecheck across packages.

## Rollout

No DB migration, no infra/CDK change, no new env var. Pure read-path + UI. Ships as a
single PR. After merge, a completed session containing a dictation item shows the full
debrief (clip replay + diff/score) instead of a blank body.
