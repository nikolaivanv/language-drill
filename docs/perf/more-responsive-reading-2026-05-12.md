# more-responsive-reading — NFR perf verification

**Spec:** `.claude/specs/more-responsive-reading/`
**Task:** 45 (Manual)
**Run date:** 2026-05-12 (replace if measured on a different day)
**Stack:** `LanguageDrillStack-dev`
**Vercel preview URL:** _fill in_
**Anthropic model:** `claude-sonnet-4-5` (per `packages/ai/src/annotate.ts`)

---

## Targets (from spec §NFR Performance)

| Metric | Warm p95 | Cold p95 |
| --- | --- | --- |
| Time-to-passage-paint | ≤ 100 ms | ≤ 100 ms (client-only) |
| Time-to-first-flag | ≤ 3 s | ≤ 6 s |
| Time-to-done | ≤ 12 s | ≤ 18 s |

Additional invariants (no numeric budget — pass/fail):
- Empty-candidate passage emits `meta` + `done` only, no Anthropic SDK call, no `usage_events` row.
- All-vocab passage behaves identically to empty-candidate.

---

## How to measure each metric

- **Time-to-passage-paint** — Chrome DevTools → Performance panel → record around the `annotate →` click. Measure from `click` to the first paint that shows the raw passage. (Pure client-side; no network involved.)
- **Time-to-first-flag** — DevTools → Network panel → find the SSE response → look at the timeline. The first byte of the first `event: flag` frame is the target. Alternatively, instrument the page hook to `console.timeStamp` on the first FLAG dispatch.
- **Time-to-done** — Same SSE row. Compare `event: done` first byte to the request-send time.
- **CloudWatch verification** (empty/all-vocab cases) — Console → CloudWatch → Log groups → `/aws/lambda/LanguageDrillStack-dev-AnnotateStreamHandler*`. Filter for the request ID from the response headers. Confirm absence of any `streamAnnotation` / Anthropic SDK log line.
- **`usage_events` verification** — `pnpm db:studio` against the dev DB, or `psql` with `SELECT * FROM usage_events WHERE user_id = '<your dev clerk id>' ORDER BY created_at DESC LIMIT 5;` — confirm no `event_type = 'read_annotation'` row appears for the empty/all-vocab attempt.

---

## Fixture passages

Use these (or paste equivalents). All Spanish.

### 1500-char passage (warm + cold cases)

> _paste your 1500-char ES fixture here so it's reproducible. Suggestion: a public-domain literature snippet (Borges, García Márquez, Cervantes). Confirm length is ~1500 chars._

### Empty-candidate passage (only A1 closed-class words)

> el la una uno y o que de en con por para sin sobre como yo tú él ella nosotros vosotros ellos ser estar tener hacer ir venir dar ver saber poder querer.

(Stopwords + auxiliaries. Should produce zero candidates after pre-filter.)

### All-vocab passage

> _paste a passage where every above-A1 lemma is already saved in your dev user's `user_vocabulary`. To seed: save a few B1+ words from a prior session, then construct a passage using only those._

---

## Results

### Cold case (≥10 min Lambda idle)

Cold-recycle confirmed by: _e.g. "waited 12 minutes; CloudWatch shows INIT_START log line"_

| Metric | Target | Measured | Pass? |
| --- | --- | --- | --- |
| Time-to-passage-paint | ≤ 100 ms | _ms_ | ☐ |
| Time-to-first-flag | ≤ 6 s | _ms_ | ☐ |
| Time-to-done | ≤ 18 s | _ms_ | ☐ |

Notes: _Neon WebSocket handshake duration, candidate count, flagged count, any anomalies._

### Warm case (immediate re-paste)

| Metric | Target | Measured | Pass? |
| --- | --- | --- | --- |
| Time-to-passage-paint | ≤ 100 ms | _ms_ | ☐ |
| Time-to-first-flag | ≤ 3 s | _ms_ | ☐ |
| Time-to-done | ≤ 12 s | _ms_ | ☐ |

Notes: _candidate count, flagged count, any anomalies._

### Empty-candidate case

| Expectation | Observed | Pass? |
| --- | --- | --- |
| Browser receives `meta` + `done`, `flaggedCount: 0` | _yes/no_ | ☐ |
| No Anthropic SDK call in CloudWatch | _yes/no_ | ☐ |
| No `usage_events` row inserted | _yes/no_ | ☐ |

### All-vocab case

| Expectation | Observed | Pass? |
| --- | --- | --- |
| Browser receives `meta` + `done`, `flaggedCount: 0` | _yes/no_ | ☐ |
| No Anthropic SDK call in CloudWatch | _yes/no_ | ☐ |
| No `usage_events` row inserted | _yes/no_ | ☐ |

---

## Outcome

Overall result: ☐ Pass / ☐ Fail

If any row failed: file a follow-up issue, link it here, and leave task 45 unchecked in `tasks.md` until the regression is resolved.

Follow-up issues:
- _none yet_
