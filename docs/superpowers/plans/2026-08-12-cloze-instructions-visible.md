# Display Cloze Instructions to the Learner — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render `content.instructions` on the cloze drill card so the learner sees the same task text the validator, evaluator, and QA solver already assume is visible.

**Architecture:** One presentational block added to `ClozePrompt` between the grammar-point eyebrow and the hero sentence. `ClozePrompt` is shared by the drill and fluency surfaces, so both inherit the change from a single edit. No prompt, validator, or backend change — this makes three existing assumptions correct rather than editing them.

**Tech Stack:** Next.js (App Router), React, TypeScript, Vitest + Testing Library, Tailwind with project design tokens.

## Global Constraints

- **Unconditional display.** No heuristic to suppress "generic" instructions. Any heuristic that misjudges a row silently recreates the bug being fixed, and the misjudged rows would be invisible.
- **Styling is exactly `t-body text-ink-soft`**, with **no label prefix**. Deliberately not the eyebrow's `t-micro text-ink-mute` (that is a passive tag; this is a functional instruction), and deliberately not the gloss's `meaning` label pattern (that label disambiguates a translation; an instruction needs no chrome).
- **Placement is between the eyebrow (`content.context`) and the hero sentence** — the load-bearing cases must be readable *before* answering.
- **Guard on non-empty**, matching the existing treatment of `context` and `glossEn`.
- **Do not modify** `packages/ai/src/validation-prompts.ts`, `packages/ai/src/qa-sample.ts`, or any prompt. This change makes their existing behavior correct.
- **Worktree discipline.** All work in `/Users/seal/dev/language-drill/.claude/worktrees/validator-alternative-enumeration` on branch `feat/validator-alternative-enumeration`. Assert the branch before every commit.
- **Never run `pnpm build` then `pnpm test`** without `rm -rf infra/lambda/dist` — the build emits 87 compiled `*.test.js` files vitest double-runs, producing 7 phantom failures.
- **Root `pnpm test` fails under parallel load** in this repo. Use `./node_modules/.bin/turbo test --concurrency=1` for a trustworthy gate.

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `apps/web/components/drill/cloze-prompt.tsx` | Pure presentation of a cloze prompt | Add the instructions block |
| `apps/web/components/drill/__tests__/cloze-prompt.test.tsx` | Component behavior | Assert rendered + guarded |
| `apps/web/app/(dashboard)/drill/debrief/_components/review-item-card.tsx` | Post-answer review of a cloze | Add instructions for parity |
| `apps/web/app/(dashboard)/drill/debrief/_components/__tests__/review-item-card.test.tsx` | Review card behavior | Assert rendered |

**Consumers that inherit the change with no edit** (verify, don't modify): `apps/web/app/(dashboard)/drill/_components/cloze-exercise.tsx` and `apps/web/app/(dashboard)/fluency/_components/fluency-item.tsx`. Both pass `ClozeContent` straight through, so the timed fluency drill gains the instruction line too — intended, since the determinacy problem is identical there.

---

### Task 1: Render instructions in `ClozePrompt`

**Files:**
- Modify: `apps/web/components/drill/cloze-prompt.tsx` (the returned JSX, between the `content.context` eyebrow block and the `t-display-m` hero paragraph)
- Test: `apps/web/components/drill/__tests__/cloze-prompt.test.tsx`

**Interfaces:**
- Consumes: `ClozeContent` from `@language-drill/shared` — already has `instructions: string`, so no type change.
- Produces: no new exports. The rendered text becomes queryable by page-level tests, which Task 3 verifies.

- [ ] **Step 1: Write the failing tests**

The existing fixture at the top of the test file already sets `instructions: 'fill the gap'`. Add:

```tsx
it('renders the instructions above the sentence', () => {
  render(<Harness />);
  expect(screen.getByText('fill the gap')).toBeInTheDocument();
});

it('omits the instructions block when instructions are empty', () => {
  render(<Harness content={{ ...base, instructions: '' }} />);
  expect(screen.queryByText('fill the gap')).not.toBeInTheDocument();
});

it('places the instructions before the sentence in document order', () => {
  const { container } = render(<Harness />);
  const text = container.textContent ?? '';
  expect(text.indexOf('fill the gap')).toBeLessThan(text.indexOf('kalkar'));
});
```

The third test is the one that pins the *design decision* rather than mere presence — without it, a later refactor could move the block below the gloss and every other assertion would still pass.

- [ ] **Step 2: Run to verify they fail**

Run: `pnpm --filter @language-drill/web test -- cloze-prompt.test.tsx`
Expected: the first and third tests FAIL (text not found / indexOf returns -1); the second PASSES vacuously.

- [ ] **Step 3: Implement**

In `cloze-prompt.tsx`, insert between the eyebrow block and the hero `<p className="t-display-m">`:

```tsx
      {/* level 1.5 — the task; must be readable BEFORE answering, because for
          ~13% of the pool the constraint lives only here (e.g. "either 'de' or
          nothing"). Rendered unconditionally: a heuristic that suppressed
          "generic" instructions would silently hide a load-bearing one. */}
      {content.instructions && content.instructions.length > 0 && (
        <p className="t-body text-ink-soft">{content.instructions}</p>
      )}
```

- [ ] **Step 4: Run to verify they pass**

Run: `pnpm --filter @language-drill/web test -- cloze-prompt.test.tsx`
Expected: PASS, and every pre-existing test in the file still passes.

- [ ] **Step 5: Commit**

```bash
git branch --show-current   # must be feat/validator-alternative-enumeration
git add apps/web/components/drill/cloze-prompt.tsx apps/web/components/drill/__tests__/cloze-prompt.test.tsx
git commit -m "fix(web): show cloze instructions to the learner"
```

---

### Task 2: Debrief review-card parity

**Files:**
- Modify: `apps/web/app/(dashboard)/drill/debrief/_components/review-item-card.tsx` (the cloze branch of the body switch)
- Test: `apps/web/app/(dashboard)/drill/debrief/_components/__tests__/review-item-card.test.tsx`

**Interfaces:**
- Consumes: the same `ClozeContent.instructions` field.
- Produces: no new exports.

- [ ] **Step 1: Read the cloze branch before editing**

Run: `grep -n "splitClozeSentence" -A 25 apps/web/app/\(dashboard\)/drill/debrief/_components/review-item-card.tsx`

This card renders a *post-answer* view and does not use `ClozePrompt`, so it needs its own block. Match the surrounding markup's typography rather than copying Task 1's classes blindly — if the card renders its sentence at a smaller size than the drill hero, `t-body text-ink-soft` may be too loud; in that case use the card's own secondary-text class. State in your report which class you chose and why.

- [ ] **Step 2: Write the failing test**

The file already has a `clozeItem(overrides?)` helper (around line 41) whose
`contentJson.instructions` is `'Fill in the blank'`, and renders via
`render(<ReviewItemCard index={0} item={clozeItem()} />)`. Reuse both — do not
introduce a new fixture:

```tsx
it('shows the cloze instructions the learner saw', () => {
  render(<ReviewItemCard index={0} item={clozeItem()} />);
  expect(screen.getByText('Fill in the blank')).toBeInTheDocument();
});
```

Note `'Fill in the blank'` is a prefix of no other string in that fixture, so
`getByText` will not collide with the sentence or the evaluation text.

- [ ] **Step 3: Run to verify it fails**

Run: `pnpm --filter @language-drill/web test -- review-item-card.test.tsx`
Expected: FAIL, text not found.

- [ ] **Step 4: Implement**

Add the guarded instructions block to the cloze branch, above the sentence, mirroring Task 1's ordering.

- [ ] **Step 5: Run to verify it passes**

Run: `pnpm --filter @language-drill/web test -- review-item-card.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git branch --show-current
git add "apps/web/app/(dashboard)/drill/debrief/_components/review-item-card.tsx" "apps/web/app/(dashboard)/drill/debrief/_components/__tests__/review-item-card.test.tsx"
git commit -m "fix(web): show cloze instructions in the debrief review card"
```

---

### Task 3: Verify the consumer ripple

**Files:** none modified unless a test breaks.

`ClozePrompt` has two consumers whose test fixtures already set `instructions`, so the new text starts rendering inside their tests. Confirmed already present: `cloze-exercise.test.tsx` (1 occurrence of `instructions`) and `fluency-item.test.tsx` (2). A test that queries by text or counts elements can break on added content.

- [ ] **Step 1: Run the two consumer suites**

```bash
pnpm --filter @language-drill/web test -- cloze-exercise.test.tsx
pnpm --filter @language-drill/web test -- fluency-item.test.tsx
```
Expected: PASS. If either fails, the failure is the ripple this task exists to catch — fix the *test*, not the component, unless the failure reveals a genuine layout bug.

- [ ] **Step 2: Run the whole web suite**

Run: `pnpm --filter @language-drill/web test`
Expected: 251 files / 2665 tests passing (the pre-change baseline), plus the assertions added in Tasks 1-2.

Any *other* failing file is a text-query collision. Fix by making the query more specific (e.g. `getByRole` with a name, or scoping to a container) rather than by weakening the component.

- [ ] **Step 3: Commit only if fixes were needed**

```bash
git branch --show-current
git add -A apps/web
git commit -m "test(web): scope queries that collided with the new cloze instructions line"
```

If nothing broke, skip the commit and note that in your report.

---

### Task 4: Visual check and full gate

**Files:** none modified.

- [ ] **Step 1: Copy the env files a fresh worktree lacks**

```bash
cp /Users/seal/dev/language-drill/.env .
cp /Users/seal/dev/language-drill/apps/web/.env apps/web/.env
```

Both are gitignored. Verify with `git check-ignore .env apps/web/.env` before proceeding — if either is *not* ignored, stop and report rather than risking committing secrets.

- [ ] **Step 2: Capture the drill screen**

Run: `pnpm --filter @language-drill/web shoot --route /drill`

Output lands in `apps/web/e2e/.shots/`. Read the image and confirm: the instruction line sits between the eyebrow and the sentence; it reads as clearly secondary to the hero; a two-line instruction does not push the hero sentence off-screen or break the card's vertical rhythm.

If port 3000 has an orphaned process, kill it first. If the screenshot cannot be produced, say so explicitly in your report — do not claim visual verification you did not perform.

- [ ] **Step 3: Full gate**

```bash
rm -rf infra/lambda/dist
pnpm lint
pnpm typecheck
./node_modules/.bin/turbo test --concurrency=1
```
Expected: lint 7/7, typecheck 13/13, tests 13/13. Do not use root `pnpm test` — it fails under parallel load for reasons unrelated to this change.

- [ ] **Step 4: Report**

Report the gate results, the chosen review-card class from Task 2, whether any consumer test needed scoping in Task 3, and your reading of the screenshot. Do not push or open a PR — the branch already has an open PR (#638) and the user decides when to update it.

---

## Follow-ups (not in this plan)

- **Correct the ambiguity fixture.** The independent audit found 16 mislabelled cases; its largest group was mislabelled *only* because a cue lived in `instructions`. Those become legitimately clean once this ships, so the correction must be re-derived against this behavior, not the old behavior.
- **Spot-check display copy.** ~9,112 approved cloze rows carry instructions authored while invisible. They passed `contextSpoilsAnswer` so they are not answer-giveaways, but they have never been reviewed as display copy.
