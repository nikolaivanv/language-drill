# Auto-save Vocabulary on Single-Word Lookup — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In reading mode, a single-word lookup auto-saves the word to the passage word bank (default-add); the user removes rather than saves.

**Architecture:** A tap on any word already fires the deep-annotation endpoint (`annotated-text.tsx` calls `onSpanSelect` for every tap; a flagged word additionally opens a skim popover that the deep card supersedes). So the whole feature is one new trigger: when the deep-span stream resolves a `type: 'word'` card, call the existing `handleSaveCard`. Backend, DB, and API-client hooks are unchanged — this is purely a frontend trigger-point change plus a footer copy rename.

**Tech Stack:** Next.js (App Router) + TypeScript, React Testing Library + Vitest (`apps/web`), Playwright (e2e).

## Global Constraints

- No backend, DB schema, or API-client hook changes. Reuse `POST /read/vocabulary` (upsert), `DELETE /read/vocabulary/:id`, and the existing `handleSaveCard` / `handleUndoCard` / `handleUnsaveVocab` handlers in `page.tsx`.
- Auto-save **only ever adds**. Removal is exclusively user-initiated (in-card `✓ saved · remove` footer, or the right-panel `×`). No lookup path removes a word.
- Auto-save is **words only**. Phrase cards keep their manual `+ save phrase` button; sentence cards remain non-savable (existing client + server guards untouched).
- Follow the existing optimistic-then-revert pattern already used by manual save; introduce no new error surface.
- Pre-push gate must pass: `pnpm lint`, `pnpm typecheck`, `pnpm test` (run from repo root, zero failures).

---

### Task 1: Rename the saved-state footer copy `✓ saved · undo` → `✓ saved · remove`

Pure string change across the three read card footers and their tests. No behavior change — safe to land on its own and stay green. Unsaved-state labels (`+ save to bank`, `+ save to vocabulary`, `+ save phrase`) are unchanged. This task must precede Task 2 so the page.test.tsx saved-state assertions already read `remove` before auto-save behavior lands.

**Files:**
- Modify: `apps/web/app/(dashboard)/read/_components/word-card-body.tsx:113` (skim word footer)
- Modify: `apps/web/app/(dashboard)/read/_components/word-card-body.tsx:356` (deep word footer)
- Modify: `apps/web/app/(dashboard)/read/_components/phrase-card-body.tsx:121` (phrase footer)
- Modify (comment tidy): `apps/web/app/(dashboard)/read/_components/annotated-view.tsx:352`
- Test: `apps/web/app/(dashboard)/read/_components/__tests__/word-card-body.test.tsx:204`
- Test: `apps/web/app/(dashboard)/read/_components/__tests__/phrase-card-body.test.tsx:92`
- Test: `apps/web/app/(dashboard)/read/_components/__tests__/word-popover.test.tsx:64,67,231`
- Test: `apps/web/app/(dashboard)/read/_components/__tests__/annotated-view.test.tsx:319`
- Test: `apps/web/app/(dashboard)/read/page.test.tsx:784,1083`

**Interfaces:**
- Consumes: nothing new.
- Produces: the saved-state button label is now the exact string `✓ saved · remove` in all three card bodies. Task 2 and Task 3 rely on this literal.

- [ ] **Step 1: Update the saved-state assertions in the component tests first (they will fail against the old source).**

In `word-card-body.test.tsx:204`, change:

```tsx
    expect(screen.getByRole('button', { name: '✓ saved · undo' })).toBeInTheDocument();
```

to:

```tsx
    expect(screen.getByRole('button', { name: '✓ saved · remove' })).toBeInTheDocument();
```

In `phrase-card-body.test.tsx:92`, change:

```tsx
      screen.getByRole('button', { name: '✓ saved · undo' }),
```

to:

```tsx
      screen.getByRole('button', { name: '✓ saved · remove' }),
```

In `word-popover.test.tsx`, change the three occurrences (the `it(...)` title on line 64, and the `getByRole` names on 67 and 231) from `✓ saved · undo` to `✓ saved · remove`:

```tsx
  it('shows the "✓ saved · remove" accent button when inBank is true', () => {
```
```tsx
    const button = screen.getByRole('button', { name: /✓ saved · remove/i });
```
```tsx
      screen.getByRole('button', { name: /✓ saved · remove/i }),
```

In `annotated-view.test.tsx:319`, change:

```tsx
    fireEvent.click(screen.getByRole('button', { name: /✓ saved · undo/i }));
```

to:

```tsx
    fireEvent.click(screen.getByRole('button', { name: /✓ saved · remove/i }));
```

In `page.test.tsx:784` and `page.test.tsx:1083`, change both `✓ saved · undo` → `✓ saved · remove`:

```tsx
    fireEvent.click(screen.getByRole('button', { name: /✓ saved · remove/i }));
```
```tsx
      screen.getByRole('button', { name: /✓ saved · remove/i }),
```

- [ ] **Step 2: Run the affected tests to verify they now fail (source still says `undo`).**

Run: `pnpm --filter @language-drill/web test -- word-card-body word-popover phrase-card-body annotated-view.test page.test`
Expected: FAIL — assertions look for `✓ saved · remove`, source still renders `✓ saved · undo`.

- [ ] **Step 3: Rename the source labels.**

In `word-card-body.tsx:113`, change:

```tsx
          {inBank ? '✓ saved · undo' : '+ save to bank'}
```

to:

```tsx
          {inBank ? '✓ saved · remove' : '+ save to bank'}
```

In `word-card-body.tsx:356`, change:

```tsx
          {inBank ? '✓ saved · undo' : '+ save to vocabulary'}
```

to:

```tsx
          {inBank ? '✓ saved · remove' : '+ save to vocabulary'}
```

In `phrase-card-body.tsx:121`, change:

```tsx
          {inBank ? '✓ saved · undo' : '+ save phrase'}
```

to:

```tsx
          {inBank ? '✓ saved · remove' : '+ save phrase'}
```

In `annotated-view.tsx:352`, update the stale comment reference:

```tsx
  // card footer's "✓ saved · remove" state (Req 8.4).
```

- [ ] **Step 4: Run the tests to verify they pass.**

Run: `pnpm --filter @language-drill/web test -- word-card-body word-popover phrase-card-body annotated-view.test page.test`
Expected: PASS.

- [ ] **Step 5: Commit.**

```bash
git add "apps/web/app/(dashboard)/read/_components/word-card-body.tsx" \
  "apps/web/app/(dashboard)/read/_components/phrase-card-body.tsx" \
  "apps/web/app/(dashboard)/read/_components/annotated-view.tsx" \
  "apps/web/app/(dashboard)/read/_components/__tests__/word-card-body.test.tsx" \
  "apps/web/app/(dashboard)/read/_components/__tests__/phrase-card-body.test.tsx" \
  "apps/web/app/(dashboard)/read/_components/__tests__/word-popover.test.tsx" \
  "apps/web/app/(dashboard)/read/_components/__tests__/annotated-view.test.tsx" \
  "apps/web/app/(dashboard)/read/page.test.tsx"
git commit -m "feat(read): rename saved footer to '✓ saved · remove'"
```

---

### Task 2: Auto-save a resolved single-word deep card

Add the one trigger and migrate `page.test.tsx` from the manual-click flow to the auto-save-on-tap flow.

**Files:**
- Modify: `apps/web/app/(dashboard)/read/page.tsx` (add ref ~line 210, assign ref ~line 847, hook the mirror effect's `complete` branch ~line 371)
- Test: `apps/web/app/(dashboard)/read/page.test.tsx`

**Interfaces:**
- Consumes: the existing `handleSaveCard(card: DeepCard, span: DeepSpan): void`, the `savedWordKeys: Set<string>` memo, the `spanStreamState` mirror effect, and the `openDeepSpanRef` pattern — all already in `page.tsx`. `DeepCard` and `DeepSpan` are already imported (used by `handleSaveCard`).
- Produces: no new exported symbols. Behavior: a resolved `type: 'word'` deep card auto-saves once per resolve.

- [ ] **Step 1: Write the failing test — a single-word tap auto-saves without any manual click.**

Add this test to `page.test.tsx` inside the `describe('ReadPage — deep annotation flow ...')` block (right after the `saveAldea` helper's tests, near line 1122). It reuses the existing `DEEP_ALDEA`, `VOCAB_ID`, `ENTRY_ID`, `ENTRIES_3`, `FULL_ENTRY`, `stubSpanCompleteOnStart`, `setVocabMutations`, `saveVocabMutate`, `renderPage` harness:

```tsx
  it('auto-saves a resolved single-word card on tap — no manual click (default-add)', () => {
    setEntries(ENTRIES_3);
    setEntry(FULL_ENTRY);
    stubSpanCompleteOnStart(DEEP_ALDEA);
    setVocabMutations({
      saveImpl: (_vars, opts) => opts?.onSuccess?.({ id: VOCAB_ID }),
    });
    renderPage();

    // A single tap resolves the deep word card AND banks it — no save button.
    fireEvent.click(screen.getByRole('button', { name: 'aldea' }));

    expect(saveVocabMutate).toHaveBeenCalledTimes(1);
    expect(saveVocabMutate).toHaveBeenCalledWith(
      expect.objectContaining({ card: DEEP_ALDEA, sourceReadEntryId: ENTRY_ID }),
      expect.any(Object),
    );
    // Footer already shows the saved state; the manual save label is absent.
    expect(
      screen.getByRole('button', { name: /✓ saved · remove/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /\+ save to vocabulary/i }),
    ).not.toBeInTheDocument();
  });
```

- [ ] **Step 2: Run it to verify it fails.**

Run: `pnpm --filter @language-drill/web test -- page.test -t "auto-saves a resolved single-word card on tap"`
Expected: FAIL — `saveVocabMutate` was called 0 times (auto-save not implemented); the footer still shows `+ save to vocabulary`.

- [ ] **Step 3: Add the auto-save ref declaration in `page.tsx`.**

Immediately after the `openDeepSpanRef` declaration (currently ends at `page.tsx:210`), add:

```tsx
  // Latest "auto-save this resolved single word unless it's already saved"
  // closure, invoked by the deep-stream mirror effect on resolve. Held in a ref
  // so that effect stays keyed only on `spanStreamState` (fires once per
  // resolve) while still calling the current handler with fresh bank/saved
  // state. Default-add on lookup: a looked-up word lands in the bank; the user
  // removes rather than saves.
  const maybeAutoSaveWordRef = useRef<(card: DeepCard, span: DeepSpan) => void>(
    () => {},
  );
```

- [ ] **Step 4: Assign the ref each render, after `savedWordKeys` is computed.**

Immediately after the `savedWordKeys` `useMemo` block (currently ends at `page.tsx:846`, just before `handleUnsaveVocab`), add:

```tsx
  // Default-add on lookup: auto-save a resolved single-word deep card to the
  // word bank. Words only — phrases/sentences keep their manual save button.
  // Only ever ADDS: an already-saved word (still shown saved, or a re-tap) is a
  // no-op, so a passive lookup never toggles a word back out. Reuses
  // handleSaveCard, so flagged-vs-non-flagged bank routing and lazy entry
  // creation are unchanged.
  maybeAutoSaveWordRef.current = (card, span) => {
    if (card.type !== 'word') return;
    if (savedWordKeys.has(card.surface.toLowerCase())) return;
    handleSaveCard(card, span);
  };
```

- [ ] **Step 5: Fire the auto-save from the mirror effect's `complete` branch.**

In the `spanStreamState` mirror effect (`page.tsx:364-381`), change the `complete` branch from:

```tsx
    } else if (spanStreamState.phase === 'complete') {
      dispatch({ type: 'DEEP_CARD_RESOLVED', span, card: spanStreamState.card });
    } else if (spanStreamState.phase === 'error') {
```

to:

```tsx
    } else if (spanStreamState.phase === 'complete') {
      dispatch({ type: 'DEEP_CARD_RESOLVED', span, card: spanStreamState.card });
      // Default-add: bank the word the moment its lookup resolves.
      maybeAutoSaveWordRef.current(spanStreamState.card, span);
    } else if (spanStreamState.phase === 'error') {
```

The effect's dependency array stays `[spanStreamState]` — `maybeAutoSaveWordRef` is a stable ref, so no dep change and no lint violation.

- [ ] **Step 6: Run the new test to verify it passes.**

Run: `pnpm --filter @language-drill/web test -- page.test -t "auto-saves a resolved single-word card on tap"`
Expected: PASS.

- [ ] **Step 7: Migrate the `saveAldea` helper and the non-flagged / fresh-paste tests off the manual click.**

Auto-save now fires on tap, so the resolved word card never shows `+ save to vocabulary` — the second click in these tests targets a button that no longer exists. Drop it.

In the `saveAldea` helper (`page.test.tsx:1055-1068`), remove the manual save click. Change:

```tsx
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'aldea' }));
    fireEvent.click(
      screen.getByRole('button', { name: /\+ save to vocabulary/i }),
    );
  }
```

to:

```tsx
    renderPage();
    // Tapping the word auto-saves it (default-add); no manual save click.
    fireEvent.click(screen.getByRole('button', { name: 'aldea' }));
  }
```

In the non-flagged `grande` test (`page.test.tsx:1150-1153`), remove the manual click. Change:

```tsx
    fireEvent.click(screen.getByRole('button', { name: 'grande' }));
    fireEvent.click(
      screen.getByRole('button', { name: /\+ save to vocabulary/i }),
    );
```

to:

```tsx
    fireEvent.click(screen.getByRole('button', { name: 'grande' }));
```

In the fresh-paste test (`page.test.tsx:1182-1183`), remove the manual click. Change:

```tsx
    fireEvent.click(screen.getByRole('button', { name: 'aldea' }));
    fireEvent.click(screen.getByRole('button', { name: /\+ save to vocabulary/i }));
```

to:

```tsx
    fireEvent.click(screen.getByRole('button', { name: 'aldea' }));
```

- [ ] **Step 8: Add the guard, phrase-exclusion, and remove-affordance tests.**

Add these three tests to the `describe('ReadPage — deep annotation flow ...')` block, after the Step-1 test. They reuse the existing harness (`stubSpanCompleteOnStart`, `setVocabMutations`, `saveVocabMutate`, `deleteVocabMutate`, `spanStart`, `DEEP_ALDEA`, `VOCAB_ID`, `ENTRY_ID`):

```tsx
  it('does not double-save when an already-saved word is re-tapped (cache hit)', () => {
    setEntries(ENTRIES_3);
    setEntry(FULL_ENTRY);
    stubSpanCompleteOnStart(DEEP_ALDEA);
    setVocabMutations({
      saveImpl: (_vars, opts) => opts?.onSuccess?.({ id: VOCAB_ID }),
    });
    renderPage();

    // First tap: streams, resolves, auto-saves once.
    fireEvent.click(screen.getByRole('button', { name: 'aldea' }));
    expect(spanStart).toHaveBeenCalledTimes(1);
    expect(saveVocabMutate).toHaveBeenCalledTimes(1);

    // Re-tap the same span: served from the session cache, no new stream, so the
    // resolve effect never re-fires and the word is not saved again.
    fireEvent.click(screen.getByRole('button', { name: 'aldea' }));
    expect(spanStart).toHaveBeenCalledTimes(1);
    expect(saveVocabMutate).toHaveBeenCalledTimes(1);
  });

  it('does NOT auto-save a resolved phrase card (words only)', () => {
    // Phrase-card shape mirrors `validPhraseCard` in packages/shared/src/read.test.ts.
    const DEEP_PHRASE_CARD: DeepCard = {
      type: 'phrase',
      surface: 'aldea grande',
      literal: 'village big',
      idiomaticMeaning: 'a large village',
      register: 'neutral, everyday',
    };
    setEntries(ENTRIES_3);
    setEntry(FULL_ENTRY);
    // Tapping 'aldea' fires the stream; stub it to resolve as a PHRASE card.
    stubSpanCompleteOnStart(DEEP_PHRASE_CARD);
    setVocabMutations({
      saveImpl: (_vars, opts) => opts?.onSuccess?.({ id: VOCAB_ID }),
    });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'aldea' }));

    // No auto-save; the manual phrase-save affordance is still present.
    expect(saveVocabMutate).not.toHaveBeenCalled();
    expect(
      screen.getByRole('button', { name: /\+ save phrase/i }),
    ).toBeInTheDocument();
  });

  it('removes an auto-saved word from within the card via "✓ saved · remove"', () => {
    setEntries(ENTRIES_3);
    setEntry(FULL_ENTRY);
    stubSpanCompleteOnStart(DEEP_ALDEA);
    setVocabMutations({
      saveImpl: (_vars, opts) => opts?.onSuccess?.({ id: VOCAB_ID }),
      deleteImpl: (_vars, opts) => opts?.onSuccess?.({ id: VOCAB_ID }),
    });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'aldea' }));
    fireEvent.click(screen.getByRole('button', { name: /✓ saved · remove/i }));

    expect(deleteVocabMutate).toHaveBeenCalledWith(VOCAB_ID, expect.any(Object));
    // Footer reverts to the manual-save label after removal.
    expect(
      screen.getByRole('button', { name: /\+ save to vocabulary/i }),
    ).toBeInTheDocument();
  });
```

> Note: `DeepCard` is already imported in `page.test.tsx` (line 5, from `@language-drill/shared`). The phrase shape above matches `DeepPhraseCard` (`type`, `surface`, `literal`, `idiomaticMeaning`, `register`) — verified against `packages/shared/src/read.test.ts`. `optionalMeaning`/`synonyms`/`collocations` are optional and omitted.

- [ ] **Step 9: Run the full read page test file.**

Run: `pnpm --filter @language-drill/web test -- page.test`
Expected: PASS (all existing deep-flow, lazy-save, popover, and the new auto-save tests green). If the "repeat tap ... renders from cache" test (currently ~line 1021) or the loading-preview test (~line 995) fail, re-read them — they must stay green because they never stub a completed word resolve for an unsaved word, so auto-save is a transparent no-op there.

- [ ] **Step 10: Run the read component + page suite and typecheck.**

Run: `pnpm --filter @language-drill/web test -- read` and `pnpm --filter @language-drill/web exec tsc --noEmit`
Expected: PASS, no type errors.

- [ ] **Step 11: Commit.**

```bash
git add "apps/web/app/(dashboard)/read/page.tsx" \
  "apps/web/app/(dashboard)/read/page.test.tsx"
git commit -m "feat(read): auto-save single-word lookups to the word bank"
```

---

### Task 3: Migrate the e2e read spec to the auto-save flow

The e2e word-save tests click the manual save button, which auto-save removes. Drop those clicks and rename the saved-state label. Sentence and phrase e2e tests are unaffected (auto-save is words-only) but their saved-label assertions, if any, still need the rename.

**Files:**
- Test: `apps/web/e2e/tests/authenticated/read.spec.ts`

**Interfaces:**
- Consumes: the `✓ saved · remove` label from Task 1 and the auto-save-on-tap behavior from Task 2.
- Produces: nothing.

- [ ] **Step 1: Migrate the flagged-word save test (`read.spec.ts:324-353`).**

Remove the manual save click and rename the saved label. Change:

```tsx
  // Tap → deep word card resolves.
  await page.getByRole('button', { name: 'aldea' }).click();
  await expect(page.getByText('pueblo pequeño')).toBeVisible();

  // Save → confirmation toast + footer flips to the saved state.
  await page
    .getByRole('button', { name: /\+ save to vocabulary/i })
    .click();
  // A word-card save persists to BOTH vocabulary and the passage word bank, so
  // two toasts share role="status" (VocabSaveToast + the entry SaveToast).
  // Scope to the vocabulary confirmation so the locator stays unambiguous.
  const toast = page.getByRole('status').filter({ hasText: /saved.*to vocabulary/i });
  await expect(toast).toBeVisible();
  await expect(
    page.getByRole('button', { name: /✓ saved · undo/i }),
  ).toBeVisible();
```

to:

```tsx
  // Tap → deep word card resolves AND auto-saves (default-add), so the
  // confirmation toast + saved footer appear with no manual click.
  await page.getByRole('button', { name: 'aldea' }).click();
  await expect(page.getByText('pueblo pequeño')).toBeVisible();

  // A word-card save persists to BOTH vocabulary and the passage word bank, so
  // two toasts share role="status" (VocabSaveToast + the entry SaveToast).
  // Scope to the vocabulary confirmation so the locator stays unambiguous.
  const toast = page.getByRole('status').filter({ hasText: /saved.*to vocabulary/i });
  await expect(toast).toBeVisible();
  await expect(
    page.getByRole('button', { name: /✓ saved · remove/i }),
  ).toBeVisible();
```

The undo-from-toast block that follows (`read.spec.ts:347-352`) is unchanged — the toast's own `undo` button and the reverted `+ save to vocabulary` label still apply.

- [ ] **Step 2: Migrate the on-demand (non-flagged) save test (`read.spec.ts:385-388`).**

Remove the manual save click. Change:

```tsx
  // Tap the UNFLAGGED word ("tranquila") and save its deep card.
  await page.getByRole('button', { name: 'tranquila' }).click();
  await expect(page.getByText('tranquilo/a')).toBeVisible();
  await page.getByRole('button', { name: /\+ save to vocabulary/i }).click();
```

to:

```tsx
  // Tap the UNFLAGGED word ("tranquila") — it auto-saves its deep card.
  await page.getByRole('button', { name: 'tranquila' }).click();
  await expect(page.getByText('tranquilo/a')).toBeVisible();
```

- [ ] **Step 3: Sweep the rest of the spec for the renamed label.**

Run: `grep -n "saved · undo" apps/web/e2e/tests/authenticated/read.spec.ts`
For any remaining match, change `✓ saved · undo` → `✓ saved · remove`. (The sentence test at `read.spec.ts:404` asserts *no* `save to vocabulary` button and needs no change — a sentence never auto-saves. The phrase test at `read.spec.ts:435` keeps its manual `+ save phrase` flow; only rename a saved-state label if it asserts one.)

- [ ] **Step 4: Commit.**

```bash
git add apps/web/e2e/tests/authenticated/read.spec.ts
git commit -m "test(read): migrate e2e read spec to auto-save-on-tap flow"
```

---

## Final verification (after all tasks)

- [ ] Run the full pre-push gate from the repo root:

```bash
pnpm lint
pnpm typecheck
pnpm test
```

Expected: zero failures. Report `X passed, Y failed` per the Testing conventions. Do not push if anything fails.

- [ ] Optional runtime check (see the `verify` skill): with `pnpm dev` running, open a passage in reading mode, tap a word, and confirm it appears in the right-panel word bank without a save click, and that the panel `×` and the in-card `✓ saved · remove` both remove it.
