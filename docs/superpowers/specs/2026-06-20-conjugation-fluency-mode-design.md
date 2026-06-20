# Conjugation in Fluency Mode — Design

**Date:** 2026-06-20
**Status:** Approved (pending spec review)

## Problem

Conjugation drill is a deterministically-graded exercise type (ES/DE/TR) that drills
morphological form production in isolation. Fluency mode is the timed-recall surface that
re-serves *mastered* items fast and tracks automaticity (latency) separately from
acquisition (accuracy).

Conjugation is **already wired as fluency-eligible everywhere user-facing**:

- `FLUENCY_ELIGIBLE_TYPES` (`packages/shared/src/fluency.ts`) includes `conjugation`.
- `gradeFluencyAnswer()` grades conjugation (`targetForm` ∪ `acceptableForms`).
- `isFluencyEligibleType()` accepts conjugation.
- `FluencyItem` renders a conjugation branch via `ConjugationPromptCard`
  (`apps/web/app/(dashboard)/fluency/_components/fluency-item.tsx:115`).
- `promptLabelFor()` formats conjugation for the debrief
  (`fluency-metrics.ts:63`).

But it never appears, because of **two backend gaps** in
`infra/lambda/src/routes/fluency.ts`:

1. **Session eligibility SQL (line 78)** hardcodes `e.type IN (CLOZE, VOCAB_RECALL)`.
   Mastered conjugation items are filtered out before they can enter a session.
2. **`POST /fluency/attempts` correctAnswer resolution (lines 172–178)** only handles
   cloze/vocab and falls through to `''` for anything else — so a conjugation "not quite"
   verdict would show a blank correct answer. (Today this branch is marked "unreachable"
   precisely because gap #1 keeps conjugation out.)

In addition, the product decision is to support **conjugation-only fluency sessions** (not
just mixing conjugation into the existing per-language pool), reachable both from an
in-place toggle on the fluency page and a deep-link from the conjugation drill page.

## Goals

- Mastered conjugation items appear in fluency sessions (mixed pool).
- A user can run a **conjugation-only** fluency session.
- The conjugation "not quite" verdict shows the correct form.
- Entry points: an in-place mode toggle on `/fluency` **and** a deep-link from
  `/drill/conjugation`.

## Non-Goals

- No change to how conjugation is graded, generated, validated, or how it feeds the
  grammar mastery axis. Fluency remains a separate signal (does not feed the radar).
- No change to the fluency stats / debrief metrics model.
- Conjugation fluency is **not** added to adaptive rotation (`today-plan`) — consistent
  with the original fluency spec.
- No new DB schema (the `types` filter is request-time only; `fluency_attempts` already
  stores everything needed).

## Design

### 1. Backend — `infra/lambda/src/routes/fluency.ts`

**Drive the eligible-type list from the shared constant.** Replace the hardcoded
`e.type IN (${ExerciseType.CLOZE}, ${ExerciseType.VOCAB_RECALL})` with a list derived from
`FLUENCY_ELIGIBLE_TYPES`, intersected with the request's optional `types` filter. This
both fixes gap #1 (conjugation now included by default) and adds the conjugation-only path
in one place. Inline the values safely into the raw SQL (parameterized `IN` list), since
this query uses `db.execute(sql\`…\`)` with `DISTINCT ON` and cannot use the Drizzle helper.

**Add an optional `types` filter to `SessionBodySchema`:**

```ts
types: z.array(z.enum([...])).nonempty().optional()
```

validated to a non-empty **subset of `FLUENCY_ELIGIBLE_TYPES`**. Omitted ⇒ all eligible
types (current mixed behavior, unchanged). `['conjugation']` ⇒ conjugation-only.

**Fix correctAnswer resolution (gap #2):** add a conjugation branch resolving to
`content.targetForm`, and drop the now-incorrect "unreachable" comment.

The `INSUFFICIENT_FLUENCY_POOL` (409) path is unchanged — if a `types` filter yields fewer
than `MIN_FLUENCY_POOL` mastered items, the same 409 surfaces (now meaning "not enough
mastered *conjugation* items" when filtered). The web page already renders a friendly
message for this.

### 2. API client — `packages/api-client/src/schemas/fluency.ts` + `useFluency.ts`

Add optional `types` to `FluencySessionRequestSchema` (same enum/subset constraint as the
backend). The `useFluencySession` hook already forwards the request body verbatim, so no
hook signature change is needed — the new field flows through.

### 3. Web — entry points

**`/fluency/page.tsx`:**

- Read a `?type=conjugation` search param. When present, pass `types: ['conjugation']` to
  the session mutation; the debrief "restart" preserves the same filter. No param ⇒
  unchanged mixed session.
- Render an in-place **mode toggle** (chips: `all · conjugation`) above the runner. Switching
  a chip restarts the session with the corresponding `types` filter and updates the URL
  query param (shallow) so the state is shareable/refresh-stable. The page heading and the
  "master a few more items first" empty-state copy adapt to the active mode (e.g.
  "not enough mastered conjugations yet").

**`/drill/conjugation` page:** add a "drill these fast →" link to `/fluency?type=conjugation`,
styled like the existing `FluencyPromo` affordance.

### Data flow

```
[/drill/conjugation "drill fast" link]   [/fluency toggle: all | conjugation]
                 \                              /
                  → /fluency?type=conjugation ←
                            │
              useFluencySession({ language, types? })
                            │
              POST /fluency/session  ── SQL: type IN (eligible ∩ types)
                            │            + most-recent score ≥ 0.8, approved, this language
                            ▼
                 composeFluencySession → shuffled items (or 409 if < MIN_FLUENCY_POOL)
                            │
                       FluencyRunner / FluencyItem (conjugation branch already exists)
                            │
              POST /fluency/attempts → gradeFluencyAnswer + record latency
                            │            correctAnswer = targetForm (for conjugation)
                            ▼
                       FluencyDebrief (promptLabelFor already handles conjugation)
```

## Testing

- **`infra/lambda/src/routes/fluency.test.ts`** — session returns conjugation items by
  default; `types: ['conjugation']` filters to conjugation only and excludes cloze/vocab;
  invalid/empty/non-eligible `types` → 400; conjugation attempt returns
  `correctAnswer === targetForm`.
- **`packages/api-client/src/schemas/fluency.test.ts`** — `types` accepts an eligible
  subset, rejects empty array and non-eligible types.
- **Web** — page test for the toggle (switching restarts the session with the right
  `types`; `?type=conjugation` initializes the toggle and is preserved on restart). Touch
  the existing `fluency.spec.ts` e2e only if the toggle changes the rendered structure the
  smoke test asserts on.

## Risks / Edge cases

- **Empty conjugation pool is the common early state** — most users won't have ≥
  `MIN_FLUENCY_POOL` mastered conjugation items yet. The conjugation-only mode must show
  the friendly "master more first" copy (not an error), same as the mixed mode's 409 path.
- **Diacritic sensitivity** — conjugation grading is already diacritic-sensitive,
  case-insensitive via `normalizeFluencyAnswer`; no change.
- **SQL injection surface** — the `types` values are validated against a fixed enum before
  reaching the raw SQL `IN` list; never interpolate raw user strings.
