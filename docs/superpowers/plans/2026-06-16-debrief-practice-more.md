# Debrief "Practice More → Hub" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the debrief footer's primary CTA from "another session" (auto-starts a quick drill) to **"practice more"** that deep-links into the `/drill` **hub**, so a learner who finished today's plan chooses what to practice next (quick drill / dictation / free writing) instead of being forced into another quick drill.

**Architecture:** A one-component change. The debrief footer's primary button relabels to "practice more" and navigates to bare `/drill` (which, since Plan 2, renders the launcher hub). The coach narrative's "another short session →" link is deliberately left as a one-tap quick-restart (`/drill?start=quick`) — it's a complementary contextual nudge, not the same affordance.

**Tech Stack:** Next.js App Router + React, Vitest + Testing Library.

**Scope note:** This is **Plan 3 of 3** (final) of the multi-type-drill entry-points design. Plans 1 (free-writing block) and 2 (launcher hub + dictation-only run) are merged. This plan is intentionally small.

**Reference spec:** `docs/superpowers/specs/2026-06-16-multi-type-drill-entry-points-design.md` — §"Plan as a bounded anchor + 'practice more'".

---

## Background the engineer needs

- Since Plan 2, **bare `/drill` renders the launcher hub** (no `?start=` intent → idle → hub). `/drill?start=quick` auto-starts a quick drill.
- The debrief footer (`apps/web/app/(dashboard)/drill/debrief/_components/debrief-footer.tsx`) has three buttons: "see your progress →" (`/progress`), "done" (`/`), and a primary "another session" (currently `/drill?start=quick`). Only the primary button changes.
- The spec's post-debrief affordance is a single **"practice more" → `/drill` hub**. The coach narrative link (`whatsNextHref` in `debrief-narrative.ts`, rendered in `debrief-tab.tsx`) stays `/drill?start=quick` — **do not touch it** in this plan.
- The home AllDoneCard's "start a fresh session" (`/drill?start=quick`) also stays — out of scope; it's a home-surface quick-restart, not the debrief "practice more" affordance.

---

## File Structure

- Modify `apps/web/app/(dashboard)/drill/debrief/_components/debrief-footer.tsx` — relabel + reroute the primary button.
- Modify `apps/web/app/(dashboard)/drill/debrief/_components/__tests__/debrief-footer.test.tsx` — update the label + route assertions.

---

### Task 1: Debrief footer "practice more → hub"

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/debrief/_components/debrief-footer.tsx:42-48`
- Test: `apps/web/app/(dashboard)/drill/debrief/_components/__tests__/debrief-footer.test.tsx`

- [ ] **Step 1: Update the failing tests**

In `apps/web/app/(dashboard)/drill/debrief/_components/__tests__/debrief-footer.test.tsx`, update every assertion that references the old label/route. There are several; make these exact edits:

(1) The label test (lines ~27-30):
```tsx
  it('renders "practice more" primary button', () => {
    render(<DebriefFooter tier="high" />);
    expect(screen.getByRole('button', { name: 'practice more' })).toBeDefined();
  });
```

(2) The primary-route test (lines ~55-59) — note the heading comment says Req 6.2:
```tsx
  it('clicking "practice more" pushes /drill hub (Req 6.2)', () => {
    render(<DebriefFooter tier="high" />);
    fireEvent.click(screen.getByRole('button', { name: 'practice more' }));
    expect(pushMock).toHaveBeenCalledExactlyOnceWith('/drill');
  });
```

(3) The mobile tap-target loop (line ~99) — replace `'another session'` with `'practice more'`:
```tsx
    for (const name of [/see your progress/, 'done', 'practice more']) {
```

(4) The three tier-prop tests (lines ~106-122) — update the button name and the expected route in each:
```tsx
  it('accepts tier="high" without throwing or changing route targets', () => {
    render(<DebriefFooter tier="high" />);
    fireEvent.click(screen.getByRole('button', { name: 'practice more' }));
    expect(pushMock).toHaveBeenCalledWith('/drill');
  });

  it('accepts tier="mid" without throwing or changing route targets', () => {
    render(<DebriefFooter tier="mid" />);
    fireEvent.click(screen.getByRole('button', { name: 'practice more' }));
    expect(pushMock).toHaveBeenCalledWith('/drill');
  });

  it('accepts tier="low" without throwing or changing route targets', () => {
    render(<DebriefFooter tier="low" />);
    fireEvent.click(screen.getByRole('button', { name: 'practice more' }));
    expect(pushMock).toHaveBeenCalledWith('/drill');
  });
```

Leave the "see your progress" (`/progress`) and "done" (`/`) tests, and the "renders exactly three buttons" test, unchanged.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @language-drill/web test -- debrief-footer`
Expected: FAIL — the component still renders "another session" routing to `/drill?start=quick`, so the updated label/route assertions fail.

- [ ] **Step 3: Update the component**

In `apps/web/app/(dashboard)/drill/debrief/_components/debrief-footer.tsx`, change the primary button (lines ~42-48) to:
```tsx
        <Button
          variant="primary"
          className="mobile:min-h-[44px] mobile:flex-1"
          onClick={() => router.push('/drill')}
        >
          practice more
        </Button>
```

Also update the component's inline comment that names the CTA. Change the comment at lines ~23-25:
```tsx
    // Desktop: a right-aligned action row at the end of the page. Mobile
    // (≤760px): a sticky bottom action bar — the primary "practice more" CTA
    // (the /drill hub) plus the two secondary actions, each ≥44px tall (Req 7.5, 11.1).
```

Do not change the "see your progress" or "done" buttons, the `tier` prop, or the layout classes.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter @language-drill/web test -- debrief-footer`
Expected: PASS — all debrief-footer tests green.

Also typecheck: `pnpm --filter @language-drill/web typecheck` — zero errors.

- [ ] **Step 5: Commit**

```bash
git add "apps/web/app/(dashboard)/drill/debrief/_components/debrief-footer.tsx" "apps/web/app/(dashboard)/drill/debrief/_components/__tests__/debrief-footer.test.tsx"
git commit -m "feat(debrief): primary CTA becomes 'practice more' → /drill hub"
```

---

### Task 2: Full-suite verification

**Files:** none (verification only).

- [ ] **Step 1: Lint**

Run: `pnpm lint`
Expected: zero errors.

- [ ] **Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: zero errors (11/11 packages).

- [ ] **Step 3: Remove any stale lambda build artifact, then run the full suite single-threaded**

Run: `rm -rf infra/lambda/dist && pnpm turbo run test --concurrency=1`
Expected: all packages green. (Stale compiled tests under `infra/lambda/dist/**/*.test.js` can produce phantom failures in a full run; removing the untracked artifact first avoids it.)

- [ ] **Step 4: Final commit (if any fixups were needed)**

```bash
git add -A
git commit -m "chore(debrief-practice-more): lint/typecheck fixups" || echo "nothing to commit"
```

---

## Self-Review

**Spec coverage:**
- Spec "a 'practice more' affordance deep-links into the `/drill` hub" (post-debrief) → Task 1 (footer primary → "practice more" → bare `/drill`). ✓
- User decision "footer → hub; coach stays quick-restart" → Task 1 changes only the footer; the coach `whatsNextHref` is explicitly untouched. ✓
- Spec boundary "on-demand blocks aren't added back into the today plan" → already true (the hub launches independent sessions; nothing in this plan touches plan composition). ✓

**Out of scope (intentional):** the coach narrative "another short session →" (`/drill?start=quick`) and the home AllDoneCard "start a fresh session" (`/drill?start=quick`) both stay as one-tap quick-restarts — not the debrief "practice more" affordance.

**Placeholder scan:** none — every step has full code.

**Type consistency:** the only literals are the button label `'practice more'` and the route `'/drill'`, used identically in the component (Task 1 Step 3) and every test assertion (Task 1 Step 1).
