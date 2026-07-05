# Mobile Conjugation Keyboard UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** On phone-sized viewports, keep the conjugation exercise (prompt card + input) above the fold when the software keyboard opens, and pack the feature chips into two rows instead of three.

**Architecture:** Two independent client-side tweaks. (1) `ConjugationExercise` gets a focus handler that, on ≤760px viewports, re-anchors the scroll position to the exercise root once the keyboard settles (one-shot `visualViewport` resize listener + 350 ms fallback timer). (2) `ConjugationFeatureBundle`'s card variant assigns static `mobile:order-N` classes to feature chips ranked by text length, so short chips pack next to the subject badge only on mobile; DOM order (semantic) is unchanged.

**Tech Stack:** Next.js App Router client components, Tailwind v4 (`mobile:` custom variant = `@media (max-width: 760px)` in `app/globals.css`), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-05-mobile-conjugation-keyboard-ux-design.md`

## Global Constraints

- Breakpoint: use the project's canonical `MOBILE_MEDIA_QUERY` (`(max-width: 760px)`, `apps/web/lib/responsive.ts`) in JS and the `mobile:` Tailwind variant in classes. Do NOT use `sm:`/`max-sm:`.
- Tailwind JIT sees only literal class strings — order classes must come from a static lookup array, never template interpolation.
- All work happens in the worktree `/Users/seal/dev/language-drill/.claude/worktrees/mobile-conjugation-ux` on branch `worktree-mobile-conjugation-ux`. Run `git branch --show-current` before every commit and abort if it is not `worktree-mobile-conjugation-ux`.
- Tests go into the existing test files for each module — no new test files.
- UI copy in this app is lowercase (`submit`, `finish session`) — don't introduce capitalized copy.

---

### Task 1: Mobile chip packing in `ConjugationFeatureBundle`

**Files:**
- Modify: `apps/web/components/drill/conjugation-feature-bundle.tsx`
- Test: `apps/web/components/drill/__tests__/conjugation-feature-bundle.test.tsx`

**Interfaces:**
- Consumes: `ConjugationContent.features: Array<{ term: string; gloss: string }>` (already used by the component).
- Produces: no API change — `ConjugationFeatureBundleProps` unchanged. Card-variant feature-chip `div`s additionally carry one of `mobile:order-1|2|3|4`.

- [ ] **Step 1: Write the failing tests**

Append to the existing `describe('ConjugationFeatureBundle', ...)` block in `apps/web/components/drill/__tests__/conjugation-feature-bundle.test.tsx`:

```tsx
  it('card variant ranks chips shortest-first for mobile packing via mobile:order-N', () => {
    render(
      <ConjugationFeatureBundle
        content={{
          ...BASE,
          features: [
            { term: 'geçmiş zaman (-DI)', gloss: 'definite past' },
            { term: 'olumsuz', gloss: 'negative' },
          ],
          subject: { pronoun: 'onlar', gloss: 'they' },
        }}
      />,
    );
    // Chip div = parent of the term span. Shorter chip (olumsuz, 8) ranks
    // before the longer tense chip (18) on mobile; DOM order is untouched.
    expect(screen.getByText('olumsuz').parentElement).toHaveClass('mobile:order-1');
    expect(screen.getByText('geçmiş zaman (-DI)').parentElement).toHaveClass(
      'mobile:order-2',
    );
    // The subject badge carries no order class, so it stays first on mobile.
    expect(screen.getByText('onlar').parentElement?.className).not.toMatch(
      /mobile:order/,
    );
  });

  it('card variant keeps the stored order for equal-length chips (stable rank)', () => {
    render(
      <ConjugationFeatureBundle
        content={{
          ...BASE,
          features: [
            { term: 'aaaa', gloss: 'x' },
            { term: 'bbbb', gloss: 'y' },
          ],
        }}
      />,
    );
    expect(screen.getByText('aaaa').parentElement).toHaveClass('mobile:order-1');
    expect(screen.getByText('bbbb').parentElement).toHaveClass('mobile:order-2');
  });
```

Note: chip width is driven by the wider of the two lines, so the rank metric is `max(term.length, gloss.length)`: `olumsuz`(7)/`negative`(8) → 8; `geçmiş zaman (-DI)`(18)/`definite past`(13) → 18.

- [ ] **Step 2: Run tests to verify the new ones fail**

Run (from the worktree root):
```bash
pnpm --filter @language-drill/web exec vitest run components/drill/__tests__/conjugation-feature-bundle.test.tsx
```
Expected: the two new tests FAIL (missing `mobile:order-1` class); the five existing tests still pass.

- [ ] **Step 3: Implement the mobile order ranking**

In `apps/web/components/drill/conjugation-feature-bundle.tsx`, add above the component:

```tsx
// Static literal classes — Tailwind's scanner cannot see interpolated names.
// Rank 5+ (never produced by generation today) simply keeps DOM order.
const MOBILE_ORDER_CLASSES = [
  'mobile:order-1',
  'mobile:order-2',
  'mobile:order-3',
  'mobile:order-4',
] as const;

// A chip's rendered width tracks its wider line (term vs gloss).
function chipWidthProxy(f: { term: string; gloss: string }): number {
  return Math.max(f.term.length, f.gloss.length);
}
```

Inside the component, before the card-variant `return` (after the `inline` early return), compute the per-index class:

```tsx
  // Mobile-only packing: rank chips shortest-first so short chips share the
  // subject badge's row instead of each long chip forcing its own row. DOM
  // order stays semantic (stored feature order) for wide viewports.
  const mobileOrderClass = new Map<number, string>(
    features
      .map((f, i) => ({ i, w: chipWidthProxy(f) }))
      .sort((a, b) => a.w - b.w || a.i - b.i)
      .map((e, rank) => [e.i, MOBILE_ORDER_CLASSES[rank] ?? '']),
  );
```

Then thread it into the chip `div` (the `features.map` in the card-variant JSX). The current chip:

```tsx
      {features.map((f) => (
        <div
          key={`${f.term}|${f.gloss}`}
          className="flex flex-col justify-center rounded-lg border border-rule bg-paper-2 px-s-3 py-[5px]"
        >
```

becomes:

```tsx
      {features.map((f, i) => (
        <div
          key={`${f.term}|${f.gloss}`}
          className={`flex flex-col justify-center rounded-lg border border-rule bg-paper-2 px-s-3 py-[5px] ${mobileOrderClass.get(i) ?? ''}`.trim()}
        >
```

- [ ] **Step 4: Run the test file to verify all pass**

Run:
```bash
pnpm --filter @language-drill/web exec vitest run components/drill/__tests__/conjugation-feature-bundle.test.tsx
```
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # must print worktree-mobile-conjugation-ux
git add apps/web/components/drill/conjugation-feature-bundle.tsx \
        apps/web/components/drill/__tests__/conjugation-feature-bundle.test.tsx
git commit -m "feat(drill): pack conjugation chips shortest-first on mobile"
```

---

### Task 2: Keyboard-open scroll anchoring in `ConjugationExercise`

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/_components/conjugation-exercise.tsx`
- Test: `apps/web/app/(dashboard)/drill/_components/__tests__/conjugation-exercise.test.tsx`

**Interfaces:**
- Consumes: `MOBILE_MEDIA_QUERY` from `apps/web/lib/responsive.ts` (`(max-width: 760px)`).
- Produces: no API change — `ConjugationExerciseProps` unchanged. Behavior: on phone viewports, focusing the answer input re-anchors scroll to the exercise root (`scrollIntoView({ block: 'start' })`) once the keyboard settles.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/app/(dashboard)/drill/_components/__tests__/conjugation-exercise.test.tsx` (new `describe` block at the end; `afterEach` is imported alongside the existing vitest imports):

```tsx
describe('ConjugationExercise — mobile keyboard scroll anchoring', () => {
  const scrollIntoView = vi.fn();
  let vvListeners: Array<{ type: string; fn: () => void }>;
  const visualViewport = {
    addEventListener: (type: string, fn: () => void) =>
      vvListeners.push({ type, fn }),
    removeEventListener: (type: string, fn: () => void) => {
      vvListeners = vvListeners.filter((l) => l.fn !== fn);
    },
  };

  function stubMobileViewport(matches: boolean) {
    vi.stubGlobal(
      'matchMedia',
      vi.fn().mockReturnValue({ matches } as MediaQueryList),
    );
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vvListeners = [];
    scrollIntoView.mockClear();
    Element.prototype.scrollIntoView = scrollIntoView;
    Object.defineProperty(window, 'visualViewport', {
      value: visualViewport,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('scrolls the exercise to the top when the keyboard opens (viewport resize)', () => {
    stubMobileViewport(true);
    renderConj({ submission: { kind: 'idle' } });
    scrollIntoView.mockClear(); // discard any mount-autofocus invocation
    fireEvent.focus(screen.getByRole('textbox'));
    const resize = vvListeners.find((l) => l.type === 'resize');
    expect(resize).toBeDefined();
    resize!.fn();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    // The resize consumed the one-shot: the fallback timer must not re-fire.
    scrollIntoView.mockClear();
    vi.advanceTimersByTime(1000);
    expect(scrollIntoView).not.toHaveBeenCalled();
    // And the listener was removed.
    expect(vvListeners.find((l) => l.type === 'resize')).toBeUndefined();
  });

  it('falls back to a timer when no viewport resize arrives (keyboard already open)', () => {
    stubMobileViewport(true);
    renderConj({ submission: { kind: 'idle' } });
    scrollIntoView.mockClear();
    fireEvent.focus(screen.getByRole('textbox'));
    vi.advanceTimersByTime(350);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start' });
    expect(vvListeners.find((l) => l.type === 'resize')).toBeUndefined();
  });

  it('does nothing on desktop-sized viewports', () => {
    stubMobileViewport(false);
    renderConj({ submission: { kind: 'idle' } });
    scrollIntoView.mockClear();
    fireEvent.focus(screen.getByRole('textbox'));
    expect(vvListeners).toHaveLength(0);
    vi.advanceTimersByTime(1000);
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
```

Also extend the vitest import at the top of the file to include `afterEach`:

```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
```

- [ ] **Step 2: Run the test file to verify the new tests fail**

Run:
```bash
pnpm --filter @language-drill/web exec vitest run 'app/(dashboard)/drill/_components/__tests__/conjugation-exercise.test.tsx'
```
Expected: the three new tests FAIL (no resize listener registered / `scrollIntoView` never called); the existing five tests still pass.

- [ ] **Step 3: Implement the focus handler**

In `apps/web/app/(dashboard)/drill/_components/conjugation-exercise.tsx`:

Add the import:

```tsx
import { MOBILE_MEDIA_QUERY } from '../../../../lib/responsive';
```

Inside the component, next to the existing `inputRef`:

```tsx
  const rootRef = React.useRef<HTMLDivElement | null>(null);
  // Pending keyboard-scroll cleanup (timer + visualViewport listener). Reset on
  // every focus; flushed on unmount.
  const scrollArmRef = React.useRef<() => void>(() => {});
  React.useEffect(() => () => scrollArmRef.current(), []);

  // On a phone, the browser's scroll-focused-input-into-view leaves the prompt
  // card cut off above the fold and pulls "finish session" into view. Once the
  // keyboard settles (visualViewport resize — fires after the browser's own
  // scroll), re-anchor the exercise top to the viewport top. The timer covers
  // the keyboard-already-open case (auto-focus on the next item: focus fires,
  // no resize does).
  function handleAnswerFocus() {
    if (typeof window.matchMedia !== 'function') return;
    if (!window.matchMedia(MOBILE_MEDIA_QUERY).matches) return;
    scrollArmRef.current();
    const vv = window.visualViewport ?? null;
    const fire = () => {
      scrollArmRef.current();
      rootRef.current?.scrollIntoView({ block: 'start' });
    };
    const timer = window.setTimeout(fire, 350);
    vv?.addEventListener('resize', fire);
    scrollArmRef.current = () => {
      window.clearTimeout(timer);
      vv?.removeEventListener('resize', fire);
      scrollArmRef.current = () => {};
    };
  }
```

Wire the ref + a scroll margin onto the root `div` (currently `<div className="flex flex-col gap-s-4">`):

```tsx
    <div ref={rootRef} className="flex flex-col gap-s-4 scroll-mt-s-2">
```

and the handler onto the `Input`:

```tsx
        <Input
          ref={inputRef}
          onFocus={handleAnswerFocus}
          value={answer}
          ...
```

(`scroll-mt-s-2` = 8px `scroll-margin-top` from the `--spacing-s-2` token, so the card isn't glued to the viewport edge.)

- [ ] **Step 4: Run the test file to verify all pass**

Run:
```bash
pnpm --filter @language-drill/web exec vitest run 'app/(dashboard)/drill/_components/__tests__/conjugation-exercise.test.tsx'
```
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # must print worktree-mobile-conjugation-ux
git add 'apps/web/app/(dashboard)/drill/_components/conjugation-exercise.tsx' \
        'apps/web/app/(dashboard)/drill/_components/__tests__/conjugation-exercise.test.tsx'
git commit -m "feat(drill): anchor conjugation exercise above the mobile keyboard"
```

---

### Task 3: Full gates + visual verification

**Files:**
- No source changes expected — verification only. Screenshots land in `apps/web/e2e/.shots/` (gitignored).

**Interfaces:**
- Consumes: the changes from Tasks 1–2.
- Produces: green `lint` / `typecheck` / `test` across the monorepo; mobile screenshots of `/drill/conjugation` for eyeball review.

- [ ] **Step 1: Clear stale compiled Lambda tests, then run the full gate**

```bash
rm -rf infra/lambda/dist
pnpm lint && pnpm typecheck && pnpm test
```
Expected: zero failures in all three. (The `rm` prevents phantom failures from stale `infra/lambda/dist/**/*.test.js`.)

- [ ] **Step 2: Visual check on a mobile viewport**

```bash
pnpm --filter @language-drill/web shoot --route /drill/conjugation --viewport mobile
```
Expected: screenshot in `apps/web/e2e/.shots/` showing the chip rows. Verify: chips fit two rows when one feature chip is long (subject badge + short chip share a row). Read the screenshot and confirm; note that the keyboard-scroll behavior itself cannot be captured headlessly (no software keyboard) — the unit tests plus a manual device check cover it.

- [ ] **Step 3: Report**

Summarize: gate results (X passed / Y failed), screenshot findings, and that the fold behavior needs a quick real-device confirmation by the user after deploy/preview.
