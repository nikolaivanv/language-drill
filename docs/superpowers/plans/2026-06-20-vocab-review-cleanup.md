# Vocab Review Number Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-item review screen's raw FSRS dump (interval / stability / state numbers) with a single human line ("next review in ~24 days · solid"), and stop surfacing `0% → 0%` no-op grammar deltas — keeping the "promoted → mature" badge and the real mastery moves.

**Architecture:** `computeMasteryDeltas` (Lambda, shared by both the per-item submit response and the session-summary response) drops deltas where `from === to`, so no-op rows disappear from both surfaces at the source. The web per-item feedback component drops the `SchedulerDeltaGrid` and renders a human line derived (via a pure helper) from `schedulerDelta.intervalTo` + `stateTo`; the raw values remain in the API/DB but are no longer shown.

**Tech Stack:** TypeScript, Hono (AWS Lambda), Next.js (App Router) + React, Vitest + Testing Library.

## Global Constraints

- The web app must NOT import `@language-drill/db`.
- Keep the existing verdict ("correct." / "close." / "not quite.") and the "promoted → {state}" badge unchanged — only the numeric `SchedulerDeltaGrid` (interval / stability / state-chips) is removed.
- The raw FSRS values stay in the API response and DB (this is presentation-only on the web) — do NOT remove `schedulerDelta` from the response schema.
- No-op grammar deltas (`from === to`) are dropped in `computeMasteryDeltas` so BOTH the per-item `masteryDeltas` and the summary `grammarDeltas` exclude them. Real moves (including downward, e.g. 0.70 → 0.68) are kept.
- Pinned human-line copy (tested verbatim) — `nextReviewLine(delta)` returns `"{timing} · {statePhrase}"`:
  - timing by `Math.round(intervalTo)`: `0` → `next review soon`; `1` → `next review tomorrow`; `n≥2` → `next review in ~{n} days`.
  - statePhrase by `stateTo`: `new` → `just getting started`; `learning` → `still learning`; `mature` → `solid`; `known` → `known cold`; `leech` → `needs work`; `suspended` → `paused`.
- The FULL gate is the real check: before finishing run `pnpm lint && pnpm typecheck && pnpm test` from the repo root, capturing real exit codes (do NOT pipe through `tail`). After `packages/*` edits run `pnpm build`; before the Lambda suite `rm -rf infra/lambda/dist`.
- Git commit trailer (every commit): `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

- **Modify** `infra/lambda/src/lib/review/evidence.ts` — `computeMasteryDeltas` filters `from === to`.
- **Modify** `infra/lambda/src/lib/review/evidence.test.ts` (or wherever it's tested) — no-op excluded, real move kept.
- **Create** `apps/web/lib/review/schedule-phrase.ts` — pure `nextReviewLine(delta)` + `statePhrase`.
- **Create** `apps/web/lib/review/__tests__/schedule-phrase.test.ts` — its tests.
- **Modify** `apps/web/app/(dashboard)/review/_components/review-feedback.tsx` — drop `SchedulerDeltaGrid` + its heading; render the human line.
- **Modify** `apps/web/app/(dashboard)/review/_components/__tests__/review-feedback.test.tsx` — replace scheduler-delta copy assertions with the human-line assertion; keep badge + "what moved" tests.

---

### Task 1: Backend — drop no-op grammar deltas at the source

**Files:**
- Modify: `infra/lambda/src/lib/review/evidence.ts` (`computeMasteryDeltas`, ~lines 186–232; the return maps each affected label to `{ grammarPoint, from, to }`)
- Modify: its test file (find it — likely `infra/lambda/src/lib/review/evidence.test.ts`)

**Interfaces:**
- Produces: `computeMasteryDeltas(...)` returns only deltas where `from !== to` (no-op rows removed). Both `POST /review/items/:stateId/submit` (`masteryDeltas`) and `GET /review/sessions/:id/summary` (`grammarDeltas`) consume it, so both are cleaned.

- [ ] **Step 1: Write the failing test**

Read `evidence.ts` + its test first to mirror the real harness (how `computeMasteryDeltas` is invoked/mocked — it takes `(db, userId, language, logIds, now)`). Add a test asserting a grammar point whose mastery is unchanged (`from === to`) is excluded, while a real move (up OR down) is kept. If the function is integration-tested against a mock db, mirror that; if there's a pure inner helper that shapes the deltas, test that. The assertion shape:

```typescript
// after computing deltas for a fixture where one point moved 0.62→0.71,
// one moved 0.70→0.68, and one was unchanged 0→0:
expect(deltas.map((d) => d.grammarPoint)).not.toContain('unchanged-point');
expect(deltas.find((d) => d.grammarPoint === 'moved-up')).toBeTruthy();
expect(deltas.find((d) => d.grammarPoint === 'moved-down')).toBeTruthy();
```

> Use the file's REAL fixture/mock setup. If `computeMasteryDeltas` is only reachable via a db mock, set the before/after mastery the way the existing tests do so one point ends with `from === to`.

- [ ] **Step 2: Run to verify failure**

Run: `rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda test evidence`
Expected: FAIL — the unchanged point is still present.

- [ ] **Step 3: Filter no-ops in `computeMasteryDeltas`**

In `evidence.ts`, where the function builds its result array of `{ grammarPoint, from, to }`, drop entries where `from === to`. The minimal change is a `.filter((d) => d.from !== d.to)` on the returned array (or skip the push when `from === to` in the building loop). Keep everything else (ordering, label resolution) unchanged.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @language-drill/lambda test evidence`
Expected: PASS.

- [ ] **Step 5: Verify full Lambda suite + typecheck**

Run: `pnpm --filter @language-drill/lambda typecheck && rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda test`
Expected: PASS. (Any existing review route/summary test that asserted a no-op delta was present must be updated to expect it filtered — fix those if they fail, since the no-op is intentionally gone.)

- [ ] **Step 6: Commit**

```bash
git add infra/lambda/src/lib/review/evidence.ts infra/lambda/src/lib/review/evidence.test.ts
git commit -m "$(printf 'feat(lambda): drop no-op (from===to) grammar deltas in review evidence\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

> If other review tests referenced a now-filtered no-op delta and you had to update them, stage those files too.

---

### Task 2: Web — human review line replaces the scheduler-delta grid

**Files:**
- Create: `apps/web/lib/review/schedule-phrase.ts`
- Create: `apps/web/lib/review/__tests__/schedule-phrase.test.ts`
- Modify: `apps/web/app/(dashboard)/review/_components/review-feedback.tsx` (remove `SchedulerDeltaGrid` ~lines 89–112 and its "scheduler delta" heading ~lines 156–160; render the human line)
- Modify: `apps/web/app/(dashboard)/review/_components/__tests__/review-feedback.test.tsx`

**Interfaces:**
- Consumes: `SchedulerDelta` (`{ intervalFrom, intervalTo, stabilityFrom, stabilityTo, stateFrom, stateTo }`) and `VocabReviewStatus` from `@language-drill/shared` (re-exported via `@language-drill/api-client`).
- Produces: `nextReviewLine(delta: SchedulerDelta): string` per the pinned copy in Global Constraints.

- [ ] **Step 1: Write the failing helper tests**

Create `apps/web/lib/review/__tests__/schedule-phrase.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { SchedulerDelta } from '@language-drill/api-client';
import { nextReviewLine } from '../schedule-phrase';

const delta = (over: Partial<SchedulerDelta> = {}): SchedulerDelta => ({
  intervalFrom: 0,
  intervalTo: 24,
  stabilityFrom: 2.3,
  stabilityTo: 24,
  stateFrom: 'learning',
  stateTo: 'mature',
  ...over,
});

describe('nextReviewLine', () => {
  it('formats a multi-day interval with the mature phrase', () => {
    expect(nextReviewLine(delta())).toBe('next review in ~24 days · solid');
  });

  it('says "soon" for a same-day (0) interval', () => {
    expect(nextReviewLine(delta({ intervalTo: 0, stateTo: 'learning' }))).toBe('next review soon · still learning');
  });

  it('says "tomorrow" for a 1-day interval', () => {
    expect(nextReviewLine(delta({ intervalTo: 1, stateTo: 'learning' }))).toBe('next review tomorrow · still learning');
  });

  it('rounds a fractional interval', () => {
    expect(nextReviewLine(delta({ intervalTo: 23.6, stateTo: 'mature' }))).toBe('next review in ~24 days · solid');
  });

  it('maps each lifecycle state to its phrase', () => {
    expect(nextReviewLine(delta({ intervalTo: 5, stateTo: 'new' }))).toBe('next review in ~5 days · just getting started');
    expect(nextReviewLine(delta({ intervalTo: 5, stateTo: 'known' }))).toBe('next review in ~5 days · known cold');
    expect(nextReviewLine(delta({ intervalTo: 5, stateTo: 'leech' }))).toBe('next review in ~5 days · needs work');
    expect(nextReviewLine(delta({ intervalTo: 5, stateTo: 'suspended' }))).toBe('next review in ~5 days · paused');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/web test schedule-phrase`
Expected: FAIL — `Cannot find module '../schedule-phrase'`.

- [ ] **Step 3: Implement the helper**

Create `apps/web/lib/review/schedule-phrase.ts`:

```typescript
import type { SchedulerDelta, VocabReviewStatus } from '@language-drill/api-client';

const STATE_PHRASE: Record<VocabReviewStatus, string> = {
  new: 'just getting started',
  learning: 'still learning',
  mature: 'solid',
  known: 'known cold',
  leech: 'needs work',
  suspended: 'paused',
};

function timing(intervalToDays: number): string {
  const n = Math.round(intervalToDays);
  if (n <= 0) return 'next review soon';
  if (n === 1) return 'next review tomorrow';
  return `next review in ~${n} days`;
}

/** A single human line replacing the raw FSRS interval/stability/state dump. */
export function nextReviewLine(delta: SchedulerDelta): string {
  return `${timing(delta.intervalTo)} · ${STATE_PHRASE[delta.stateTo]}`;
}
```

> Confirm `VocabReviewStatus` / `SchedulerDelta` are exported from `@language-drill/api-client`; if not, import from `@language-drill/shared` (the Explore found both there). The `Record<VocabReviewStatus, string>` must cover every enum member or typecheck fails — good, that's the exhaustiveness guard.

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @language-drill/web test schedule-phrase`
Expected: PASS (all assertions).

- [ ] **Step 5: Update the component test (RED for the component change)**

In `review-feedback.test.tsx`: remove/replace the "scheduler delta" suite assertions that pin `4d`, `8d`, `4.2`, `7.1` (the raw numbers are gone). Replace with an assertion that the human line renders, and keep the promoted-badge test and the "what moved" tests. For the `correctResult` fixture (`intervalTo: 8`, `stateTo: 'mature'`):

```typescript
it('renders the human next-review line instead of raw FSRS numbers', () => {
  render(<ReviewFeedback result={correctResult} {/* ...other required props */} />);
  expect(screen.getByText('next review in ~8 days · solid')).toBeInTheDocument();
  expect(screen.queryByText('stability')).not.toBeInTheDocument();
  expect(screen.queryByText(/scheduler delta/i)).not.toBeInTheDocument();
});
```

> Mirror the file's real `render(<ReviewFeedback .../>)` prop setup. Keep the "promoted to mature" badge test and the "no promotion chip on lapse" test as-is (the badge is unchanged). Keep the "what moved" tests (DeltaPill still renders real moves).

- [ ] **Step 6: Run to verify failure**

Run: `pnpm --filter @language-drill/web test review-feedback`
Expected: FAIL — the human line isn't rendered yet (and/or the removed-copy assertions fail because the grid is still there).

- [ ] **Step 7: Swap the grid for the human line in the component**

In `review-feedback.tsx`:
1. Import `nextReviewLine` from `../../../../lib/review/schedule-phrase` (match the real relative depth).
2. Delete the `SchedulerDeltaGrid` sub-component (~lines 89–112) and its usage + the "scheduler delta" section heading (~lines 156–160).
3. In its place, render the human line, e.g.:

```tsx
<p className="t-body text-ink-2">{nextReviewLine(result.schedulerDelta)}</p>
```

Keep the verdict + promoted badge (~lines 134–141), the corrected form (~lines 143–154), and the "also moved" section (~lines 162–177) exactly as they are. Remove any now-unused imports (e.g. the `round` helper if only the grid used it, the `Chip` if only the state-chips used it — verify with the file before deleting).

- [ ] **Step 8: Run to verify pass**

Run: `pnpm --filter @language-drill/web test review-feedback`
Expected: PASS.

- [ ] **Step 9: Typecheck + commit**

Run: `pnpm --filter @language-drill/web typecheck`
Then:

```bash
git add apps/web/lib/review/schedule-phrase.ts apps/web/lib/review/__tests__/schedule-phrase.test.ts apps/web/app/\(dashboard\)/review/_components/review-feedback.tsx apps/web/app/\(dashboard\)/review/_components/__tests__/review-feedback.test.tsx
git commit -m "$(printf 'feat(web): human next-review line replaces FSRS scheduler grid\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Final verification (whole plan)

- [ ] From repo root, real exit codes (do NOT pipe through `tail`):
  `pnpm lint; echo "lint=$?"; pnpm typecheck; echo "tc=$?"; rm -rf infra/lambda/dist; pnpm test; echo "test=$?"`
- [ ] Confirm `lint=0 tc=0 test=0`. Report X passed / Y failed.
- [ ] Grep that the raw FSRS copy is gone from the per-item screen: `grep -rn "scheduler delta\|stability" apps/web/app/\(dashboard\)/review/_components/review-feedback.tsx` → expect no matches.

---

## Self-review notes

- **Spec coverage:** raw FSRS grid removed + human line (Task 2); no-op deltas dropped at the source so both per-item and summary are clean (Task 1). The promoted badge and real mastery moves are preserved.
- **Type consistency:** `nextReviewLine(delta: SchedulerDelta)` reads `intervalTo` (number) + `stateTo` (`VocabReviewStatus`); the `Record<VocabReviewStatus, string>` is exhaustive (compile-time guard). The backend filter is `from !== to` on `MasteryDelta` (`from`/`to` are `[0,1]` numbers).
- **Presentation-only on web:** `schedulerDelta` stays in the API/DB; only its on-screen rendering changes. The no-op filter is the one behavioral (response-content) change, intentional and shared.
- **Deferred (unchanged):** the summary screen's `GrammarDeltaBar` styling (it just receives fewer deltas now); any LLM-narrated review coaching; `/progress` radar confidence-gating; History tab.
