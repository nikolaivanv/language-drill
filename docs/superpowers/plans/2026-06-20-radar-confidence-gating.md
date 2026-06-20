# Radar Confidence-Gating Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the `/progress` shape-tab radar stop drawing confident solid vertices on thin evidence: thin-evidence axes (1–4 attempts) render as hollow rings, untrained axes (0 attempts) get muted labels, and a legend entry explains it — the polygon silhouette is unchanged.

**Architecture:** A shared `evidenceTier(n)` helper (reusing the home snapshot's `THIN_EVIDENCE_THRESHOLD = 5`) classifies each axis as `untrained` / `thin` / `robust`. The custom-SVG `RadarChart` uses it to style each vertex dot (solid / hollow / omitted) and each axis label (normal / muted), and `LegendCard` gains a row explaining the markers. Web-only; no API or data-shape change (`evidenceCount` is already on every `RadarAxis`).

**Tech Stack:** TypeScript, Next.js (App Router) + React (custom inline SVG), Vitest + Testing Library.

## Global Constraints

- The web app must NOT import `@language-drill/db`.
- Reuse the existing threshold: `THIN_EVIDENCE_THRESHOLD = 5`. Tiers: `evidenceCount === 0` → `untrained`; `0 < n < 5` → `thin`; `n >= 5` → `robust`. (The home snapshot already uses `5` in `skill-row.tsx`.)
- The polygon (current + previous) geometry is UNCHANGED — only the vertex dots and axis-label styling change, plus a legend entry. Do NOT alter `currentMastery`/`previousMastery` plotting.
- The radar's `aria-label` (strongest/weakest summary, already filtering `evidenceCount > 0`) is UNCHANGED — do not touch the pinned aria-label assertion.
- Vertex treatment by tier: `robust` → solid accent dot (current behavior); `thin` → hollow ring (paper/white fill, accent stroke); `untrained` → NO dot (its point sits at center where it's meaningless and overlaps other untrained axes).
- Axis-label treatment: `untrained` → muted (ink-soft); `thin` and `robust` → normal.
- Each vertex circle and axis-label text gets a `data-tier="untrained|thin|robust"` attribute so tests can assert the treatment without depending on exact color tokens.
- The FULL gate is the real check: before finishing run `pnpm lint && pnpm typecheck && pnpm test` from the repo root, capturing real exit codes (do NOT pipe through `tail`). Web-only; no `pnpm build` needed unless a `packages/*` file is touched (none expected).
- Git commit trailer (every commit): `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## File Structure

- **Create** `apps/web/lib/progress/evidence-tier.ts` — `THIN_EVIDENCE_THRESHOLD` + `evidenceTier(n)`.
- **Create** `apps/web/lib/progress/__tests__/evidence-tier.test.ts` — its tests.
- **Modify** `apps/web/app/(dashboard)/_components/skill-row.tsx` — import the shared constant instead of a local one (DRY).
- **Modify** `apps/web/app/(dashboard)/progress/_components/radar-chart.tsx` — tier-based vertex + label rendering.
- **Modify** `apps/web/app/(dashboard)/progress/_components/__tests__/radar-chart.test.tsx` — assert vertex/label treatment by tier.
- **Modify** `apps/web/app/(dashboard)/progress/_components/shape-side-cards.tsx` — `LegendCard` gains a markers row.
- **Modify** `apps/web/app/(dashboard)/progress/_components/__tests__/shape-side-cards.test.tsx` — assert the legend entry.

---

### Task 1: Shared `evidenceTier` helper (+ DRY the home snapshot)

**Files:**
- Create: `apps/web/lib/progress/evidence-tier.ts`
- Create: `apps/web/lib/progress/__tests__/evidence-tier.test.ts`
- Modify: `apps/web/app/(dashboard)/_components/skill-row.tsx` (replace the local `const THIN_EVIDENCE_THRESHOLD = 5;` ~line 17 with an import)

**Interfaces:**
- Produces: `THIN_EVIDENCE_THRESHOLD = 5`; `type EvidenceTier = 'untrained' | 'thin' | 'robust'`; `evidenceTier(evidenceCount: number): EvidenceTier`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/lib/progress/__tests__/evidence-tier.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { evidenceTier, THIN_EVIDENCE_THRESHOLD } from '../evidence-tier';

describe('evidenceTier', () => {
  it('classifies zero evidence as untrained', () => {
    expect(evidenceTier(0)).toBe('untrained');
  });

  it('classifies 1..(threshold-1) as thin', () => {
    expect(evidenceTier(1)).toBe('thin');
    expect(evidenceTier(THIN_EVIDENCE_THRESHOLD - 1)).toBe('thin');
  });

  it('classifies >= threshold as robust', () => {
    expect(evidenceTier(THIN_EVIDENCE_THRESHOLD)).toBe('robust');
    expect(evidenceTier(50)).toBe('robust');
  });

  it('treats negative as untrained (defensive)', () => {
    expect(evidenceTier(-1)).toBe('untrained');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/web test evidence-tier`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/web/lib/progress/evidence-tier.ts`:

```typescript
/** Below this many graded attempts, an axis's mastery is "thin" — shown but flagged. */
export const THIN_EVIDENCE_THRESHOLD = 5;

export type EvidenceTier = 'untrained' | 'thin' | 'robust';

/** Classify an axis by how much evidence backs its mastery score. */
export function evidenceTier(evidenceCount: number): EvidenceTier {
  if (evidenceCount <= 0) return 'untrained';
  if (evidenceCount < THIN_EVIDENCE_THRESHOLD) return 'thin';
  return 'robust';
}
```

- [ ] **Step 4: Run to verify pass**

Run: `pnpm --filter @language-drill/web test evidence-tier`
Expected: PASS.

- [ ] **Step 5: DRY the home snapshot**

In `apps/web/app/(dashboard)/_components/skill-row.tsx`, remove the local `const THIN_EVIDENCE_THRESHOLD = 5;` (~line 17) and import the shared one:

```typescript
import { THIN_EVIDENCE_THRESHOLD } from '../../../lib/progress/evidence-tier';
```

(Match the real relative depth from `skill-row.tsx` to `apps/web/lib/progress/evidence-tier.ts`.) Leave the `thin · {evidenceCount}` rendering logic unchanged — it now reads the imported constant.

- [ ] **Step 6: Verify the home snapshot still passes + typecheck**

Run: `pnpm --filter @language-drill/web test skill-snapshot && pnpm --filter @language-drill/web typecheck`
Expected: PASS (the constant value is identical, so behavior is unchanged).

- [ ] **Step 7: Commit**

```bash
git add apps/web/lib/progress/evidence-tier.ts apps/web/lib/progress/__tests__/evidence-tier.test.ts apps/web/app/\(dashboard\)/_components/skill-row.tsx
git commit -m "$(printf 'refactor(web): shared evidenceTier helper (untrained/thin/robust)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

### Task 2: Confidence-gate the radar chart + legend

**Files:**
- Modify: `apps/web/app/(dashboard)/progress/_components/radar-chart.tsx` (vertex dots ~lines 142–157; axis-label `<text>` ~lines 92–120)
- Modify: `apps/web/app/(dashboard)/progress/_components/__tests__/radar-chart.test.tsx`
- Modify: `apps/web/app/(dashboard)/progress/_components/shape-side-cards.tsx` (`LegendCard` ~lines 41–97)
- Modify: `apps/web/app/(dashboard)/progress/_components/__tests__/shape-side-cards.test.tsx`

**Interfaces:**
- Consumes: `evidenceTier` + `THIN_EVIDENCE_THRESHOLD` (Task 1); `RadarAxis.evidenceCount`.

- [ ] **Step 1: Write failing radar tests**

Read `radar-chart.test.tsx` first for the `buildAxes` fixture (it sets `evidence` per axis). Add tests. The component will tag each vertex circle and axis label with `data-tier`. Assert: a robust axis has a solid vertex, a thin axis has a hollow vertex, an untrained axis has NO vertex circle, and an untrained axis label is muted. Use `data-tier` to target:

```typescript
it('renders vertex dots only for trained axes, hollow for thin evidence', () => {
  const { container } = render(
    <RadarChart
      language={Language.ES}
      axes={buildAxes({ grammar: { mastery: 0.8, evidence: 40 }, listening: { mastery: 0.97, evidence: 4 } })}
    />,
  );
  const robustDot = container.querySelector('circle[data-tier="robust"]');
  const thinDot = container.querySelector('circle[data-tier="thin"]');
  // robust = solid accent fill; thin = hollow (paper fill)
  expect(robustDot?.getAttribute('fill')).toContain('accent');
  expect(thinDot?.getAttribute('fill')).not.toContain('accent');
  // untrained axes (evidence 0) get no vertex dot
  expect(container.querySelector('circle[data-tier="untrained"]')).toBeNull();
});

it('mutes the labels of untrained axes', () => {
  const { container } = render(
    <RadarChart language={Language.ES} axes={buildAxes({ grammar: { mastery: 0.8, evidence: 40 } })} />,
  );
  // an untrained axis label carries data-tier="untrained"
  const untrainedLabel = container.querySelector('text[data-tier="untrained"]');
  expect(untrainedLabel).not.toBeNull();
});
```

> Adjust the `fill` assertions to match the actual tokens the component uses (e.g. `var(--color-accent)` for solid, `var(--color-paper)` for hollow). The point is robust ≠ thin fill, and untrained has no circle. Keep the existing aria-label test untouched.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm --filter @language-drill/web test radar-chart`
Expected: FAIL — no `data-tier` attributes / untrained dots still rendered.

- [ ] **Step 3: Tier-gate the radar vertices + labels**

In `radar-chart.tsx`:
1. Import: `import { evidenceTier } from '../../../../lib/progress/evidence-tier';` (match real depth).
2. **Axis labels** (the `<text>` per spoke, ~lines 92–120): compute `const tier = evidenceTier(axis.evidenceCount);` and set `data-tier={tier}` + a muted fill when `tier === 'untrained'`:

```tsx
<text
  /* ...existing x/y/anchor... */
  data-tier={tier}
  fill={tier === 'untrained' ? 'var(--color-ink-soft)' : 'var(--color-ink)'}
  /* ...existing className/font... */
>
  {axis.label}
</text>
```

(Use whatever the file's existing label color/className is for the non-untrained case — only override to muted for untrained.)

3. **Vertex dots** (~lines 142–157): render per-tier. Skip untrained; solid for robust; hollow for thin:

```tsx
{axes.map((axis, i) => {
  const tier = evidenceTier(axis.evidenceCount);
  if (tier === 'untrained') return null;
  const p = currentPoints[i]; // however the file computes each vertex point
  return (
    <circle
      key={axis.key}
      cx={p.x}
      cy={p.y}
      r={4}
      data-tier={tier}
      fill={tier === 'thin' ? 'var(--color-paper)' : 'var(--color-accent)'}
      stroke="var(--color-accent)"
      strokeWidth={tier === 'thin' ? 1.5 : 1}
    />
  );
})}
```

> Match the file's real vertex-point computation and existing circle attributes (the current code already maps 6 circles with `r={4}` + white stroke — keep its structure, just add the tier branch). The hollow look = paper fill + accent ring; solid = accent fill.

- [ ] **Step 4: Run to verify radar passes**

Run: `pnpm --filter @language-drill/web test radar-chart`
Expected: PASS (existing aria-label test still green + the new tier tests).

- [ ] **Step 5: Write the failing legend test**

In `shape-side-cards.test.tsx`, add an assertion that `LegendCard` explains the markers:

```typescript
it('legend explains the thin-evidence and not-started markers', () => {
  render(<LegendCard />);
  expect(screen.getByText(/thin evidence/i)).toBeInTheDocument();
  expect(screen.getByText(/not started/i)).toBeInTheDocument();
});
```

> Mirror the file's existing `LegendCard` render test (it currently asserts "you · now" / "you · 30 days ago").

- [ ] **Step 6: Run to verify failure**

Run: `pnpm --filter @language-drill/web test shape-side-cards`
Expected: FAIL — legend has no thin/not-started copy yet.

- [ ] **Step 7: Add the legend markers row**

In `shape-side-cards.tsx` `LegendCard` (~lines 41–97), after the existing "you · now" / "you · 30 days ago" rows, add a markers row explaining the vertex treatment. Use small inline SVG/glyphs consistent with the card's style:

```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
  <span aria-hidden className="t-mono text-[12px]">●</span>
  <span className="t-micro">solid · enough evidence</span>
</div>
<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
  <span aria-hidden className="t-mono text-[12px]">○</span>
  <span className="t-micro">thin evidence · under {THIN_EVIDENCE_THRESHOLD} attempts</span>
</div>
<div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
  <span aria-hidden className="t-micro text-ink-soft">aA</span>
  <span className="t-micro">dimmed label · not started</span>
</div>
```

Import `THIN_EVIDENCE_THRESHOLD` from `../../../lib/progress/evidence-tier` (match depth). Match the surrounding card's spacing/typography tokens; the tests assert text content (`/thin evidence/i`, `/not started/i`), not exact markup.

- [ ] **Step 8: Run to verify legend passes**

Run: `pnpm --filter @language-drill/web test shape-side-cards`
Expected: PASS (existing legend assertions + the new one).

- [ ] **Step 9: Typecheck + commit**

Run: `pnpm --filter @language-drill/web typecheck`
Then:

```bash
git add apps/web/app/\(dashboard\)/progress/_components/radar-chart.tsx apps/web/app/\(dashboard\)/progress/_components/__tests__/radar-chart.test.tsx apps/web/app/\(dashboard\)/progress/_components/shape-side-cards.tsx apps/web/app/\(dashboard\)/progress/_components/__tests__/shape-side-cards.test.tsx
git commit -m "$(printf 'feat(web): confidence-gate the progress radar (thin/untrained axes)\n\nCo-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>')"
```

---

## Final verification (whole plan)

- [ ] From repo root, real exit codes (do NOT pipe through `tail`):
  `pnpm lint; echo "lint=$?"; pnpm typecheck; echo "tc=$?"; pnpm test; echo "test=$?"`
- [ ] Confirm `lint=0 tc=0 test=0`. Report X passed / Y failed.

---

## Self-review notes

- **Spec coverage:** thin vertices hollow + untrained labels muted + legend entry (Task 2), driven by a shared, tested `evidenceTier` (Task 1) reusing the home threshold (5). Polygon geometry + aria-label untouched. This finishes the "spiderchart too abstract / over-confident" complaint that the home snapshot fix (#390) started.
- **Type consistency:** `evidenceTier(evidenceCount: number)` is the single source for the tier across the radar and (via the shared `THIN_EVIDENCE_THRESHOLD`) the home snapshot and the legend copy.
- **Testability:** `data-tier` attributes on vertices/labels let tests assert the treatment without coupling to exact color tokens.
- **No data/API change:** `evidenceCount` already ships on every `RadarAxis`.
- **Deferred (unchanged):** RadarChart aria-label strongest/weakest semantics; History tab; Phase 3 per-error attribution.
