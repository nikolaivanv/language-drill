# Drill from the Theory Detail Page — Design

**Date:** 2026-07-07
**Status:** Approved

## Problem

The theory library (`/theory`) shows the full grammar curriculum for the active
language across **all** CEFR levels, but offers no way to practice a point — you
can only read. The `/progress` drawer has drill buttons, but `/progress` only
covers the active level (plus a 5-point preview of the next level). So a B1
Spanish learner who notices their A2 grammar slipping has to switch their
profile level in settings just to drill an A2 point.

Goal: from a theory detail page, launch a drill targeting that grammar point —
regardless of the user's active CEFR level — when exercises for it actually
exist.

## Decisions (settled during brainstorming)

| Question | Decision |
|---|---|
| Placement | Theory **detail page only** — a "drill this point" block at the end of the article. The list stays a reading index. |
| Availability signal | **Real inventory counts** (approved exercises per type), not the static `compatibleTypes()` heuristic the /progress drawer uses. |
| Level mismatch | **Server derives difficulty from the grammar-point key** in `POST /sessions`, overriding the client value. |
| Mastery readout | **Yes** — show mastery/confidence/evidence in the block, fetched in the same request as the counts. |

## 1. Session-level fix (server)

`infra/lambda/src/routes/sessions.ts` — when `POST /sessions` receives a
`grammarPointKey`:

- Look it up with `getGrammarPoint(key)` (curriculum, `packages/db`).
- If found, **override the request `difficulty`** with the point's own CEFR
  level (encoded in the key, e.g. `es-a2-ser-vs-estar` → `A2`) before the
  exercise-pool filter runs. The session row stores the derived difficulty.
- If the key is not in the curriculum, keep today's behavior (use the client
  difficulty). Backwards compatible; no new 400s.

Side effect (intentional): fixes the latent bug where /progress "next level
preview" points created sessions filtered at the active level's pool and could
422 with `INSUFFICIENT_EXERCISES`.

Follow-through on the web drill page (`apps/web/app/(dashboard)/drill/page.tsx`):
after creating a targeted session, the displayed difficulty must come from the
**session response**, not the locally-seeded profile level, so the UI shows
"A2" when a B1-profile user drills an A2 point.

## 2. Availability endpoint (server)

The theory detail page renders static TSX topics without hitting the DB topic
endpoint, so enriching `GET /theory/:lang/:topicId` cannot work. Instead, a new
authed endpoint:

```
GET /progress/points/:grammarPointKey
```

Response:

```jsonc
{
  "grammarPointKey": "es-a2-ser-vs-estar",
  "exerciseCounts": { "cloze": 12, "translation": 8 },   // per ExerciseType
  "mastery": {                                            // or null if never practiced
    "masteryScore": 0.82,
    "confidence": 0.9,
    "evidenceCount": 10,
    "lastPracticedAt": "2026-07-07T..."
  }
}
```

- `exerciseCounts`: `GROUP BY type` over exercises filtered **exactly like
  session creation** — approved, audio-ready, `language`, `grammarPointKey`,
  `difficulty` = the point's own level — so a rendered button can never 422.
  The dedup index `(language, difficulty, type, grammarPointKey)` covers it.
- `mastery`: single indexed lookup on `user_grammar_mastery` for
  `(userId, grammarPointKey)`.
- Unknown key → 404.

## 3. Web UI

New `DrillThisPoint` component rendered at the end of the article in
`apps/web/app/(dashboard)/theory/_components/theory-detail.tsx`, visually
mirroring the lower half of
`apps/web/app/(dashboard)/progress/_components/point-detail-sheet.tsx`:

- Mastery / confidence / evidence readout when `mastery` is non-null; omitted
  for never-practiced points.
- **Mixed drill** button → `/drill?start=quick&grammarPoint=<key>`, shown when
  total exercise count > 0.
- Per-mode chips for each type with count > 0, restricted to the drawer's
  launchable set: cloze and translation →
  `/drill?start=quick&grammarPoint=<key>&exerciseType=<type>`; conjugation →
  `/drill/conjugation?grammarPoint=<key>`.
- Whole section **hidden** (not disabled) when no launchable exercises exist;
  skeleton while the query loads.
- `grammarPointKey` derived client-side from `topicId` + active language — the
  inverse of `topicIdForGrammarPointKey` (`apps/web/lib/theory-topic-map.ts`).

## 4. API client

`packages/api-client`: Zod response schema + TanStack Query hook
`usePointDrillInfo(key)`, query key `['progress', 'point', key]`.

## 5. Testing

- **Lambda** (`@language-drill/lambda`):
  - sessions: difficulty override when a curriculum key is present;
    passthrough when the key is unknown.
  - new endpoint: counts mirror the session filter (approved + audio-ready +
    point-level difficulty); mastery null vs present; auth required; unknown
    key 404.
- **Web**: `DrillThisPoint` tests in the existing theory-detail test file —
  buttons render per counts, hrefs correct, section hidden when counts empty.
- Grep the repo for tests asserting the old profile-difficulty behavior for
  targeted drills; update any found.

## Out of scope

- Changes to the /theory list rows (no drawer, no per-row availability).
- Changes to the /progress drawer.
- Exercise generation / pool coverage.
- Non-grammar theory (the theory pool is grammar-only today).
