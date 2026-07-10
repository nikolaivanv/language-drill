# Auto-save vocabulary on single-word lookup — Design

**Date:** 2026-07-10
**Status:** Approved (pending spec review)
**Surface:** Reading mode (`apps/web/app/(dashboard)/read/`)

## Problem

In reading mode, saving a looked-up word to the vocabulary bank is a manual
button press (`+ save to vocabulary`). Learners who look a word up have already
signalled interest; making them press a second button to keep it adds friction
and loses words they'd have wanted. We want lookups to bank the word by default,
with removal as the explicit action instead of saving.

## Behavior

- When a **single-word** deep lookup resolves, the word is automatically added
  to the passage's word bank. The existing save path dual-writes to
  `user_vocabulary` (and the spaced-repetition layer), so the auto-add reuses
  that behavior unchanged.
- **One trigger covers every single-word lookup.** A tap on *any* word fires the
  deep-annotation endpoint unconditionally (`annotated-text.tsx` calls
  `onSpanSelect` for every tap; for a flagged word it *also* opens the skim
  popover, but the deep card supersedes that preview once it resolves). So
  auto-saving on the deep single-word resolve captures both flagged and
  non-flagged lookups — there is no separate skim-popover auto-bank path.
- The skim popover's manual `+ save to bank` button stays as the **fallback**
  for when a deep lookup fails or is rate-limited (no card resolves, nothing to
  auto-save).
- **Phrases and sentences are out of scope.** Phrase cards keep the manual
  `+ save phrase` button; sentence cards remain non-savable (existing client +
  server guards).
- Auto-save fires **immediately when the lookup resolves** — no dwell/visibility
  delay. Removal is always an explicit user action.
- Auto-save **only ever adds**. An already-saved word is a no-op: a re-tap of a
  saved word is a cache hit (no re-stream, so the effect never fires), and the
  `savedWordKeys` guard covers the case either way. A word the user removed and
  then re-looks-up (a fresh stream) is re-added — consistent with "added on
  lookup by default."
- The auto-saved word appears in the right-panel word bank (`WordBankRail` on
  desktop, `WordBankSheet` on mobile) and is removable via its `×` — already
  built.
- The card footer's saved state reads **"✓ saved · remove"** (renamed from the
  current "✓ saved · undo"), which toggles the word back out from within the
  card. The rename is applied uniformly to the skim word, deep word, and phrase
  footers for consistency; unsaved-state labels are unchanged.

## Current state (no backend/DB changes needed)

The infrastructure is ~90% in place. This feature changes only the *trigger*
(manual button → automatic on resolve) plus footer framing.

- **Save endpoint:** `POST /read/vocabulary` — upserts on
  `(userId, language, word)`, so re-looking-up a word never duplicates
  (`infra/lambda/src/routes/read.ts`).
- **Remove endpoint:** `DELETE /read/vocabulary/:id` — scoped to the user; also
  drops the orphaned FSRS review card when it was the last surface of the lemma.
- **Page handlers:** `handleSaveCard` / `handleUndoCard` / `handleUnsaveVocab`
  and the optimistic `patchSavedVocab` in
  `apps/web/app/(dashboard)/read/page.tsx`.
- **Right panel:** `WordBankRail` / `WordBankSheet` with per-row `×` → `onUnsave`.
- **Footer state:** `word-card-body.tsx` already renders the
  `✓ saved · undo` / `+ save` toggle driven by the `inBank` flag.

## Trigger point (single)

In `page.tsx`, the deep-span stream's state is mirrored into the reducer by an
effect keyed on `spanStreamState` (the `phase === 'complete'` branch dispatches
`DEEP_CARD_RESOLVED`). Auto-save hangs off that same completion:

- When the resolved card is `type === 'word'` and its surface is not already in
  `savedWordKeys`, invoke the existing `handleSaveCard(card, span)`. This reuses,
  unchanged:
  - lazy `read_entries` row creation on a fresh paste (so the FK can link), and
  - the flagged-vs-non-flagged bank routing already inside the handler (flagged
    words also enter the passage bank via PUT; non-flagged words save to
    vocabulary only, never the bank).
- The handler is called through a ref (`maybeAutoSaveWordRef.current`) updated
  each render, so the mirror effect stays keyed only on `spanStreamState` (fires
  once per resolve) while still reading fresh `savedWordKeys` / bank state. This
  keeps the effect's dependency array unchanged and avoids re-firing on
  unrelated renders.
- Firing once per resolve + the `savedWordKeys` guard together prevent any
  double-save.

## Correctness constraints (mostly pre-existing)

- **Idempotency:** upsert on `(userId, language, word)` — re-lookups don't
  duplicate. The client guard (only-add) prevents an auto-toggle-off.
- **Non-flagged deep words** save to vocabulary but must **not** enter the
  flagged passage bank — enforced by the existing `bankableWord` logic.
- **Sentences** stay non-savable (client + server guards untouched).
- **Auto-save only ever adds.** Removal is exclusively user-initiated (footer
  "remove" or panel `×`). No lookup path removes a word.
- **Failure handling:** follow the existing optimistic-update-then-revert
  pattern used by the manual save; a failed auto-save reverts the optimistic
  bank entry (no new error surface introduced).

## Out of scope

- Phrase and sentence auto-save.
- Any dwell/visibility delay before saving.
- Backend, schema, or API-client hook changes (existing hooks
  `useSaveVocabularyCard` / `useDeleteVocabularyCard` are reused as-is).
- Changes to the `CollectBar` "add N to vocabulary" bulk action.

## Testing

Add/adjust cases in the existing test files (no orphaned files):

- `read/page.test.tsx` (the bulk — many tests currently drive the *manual* flow
  and must migrate to the auto-save trigger):
  - Tapping a single word (deep resolve) auto-saves it: `saveVocabMutate` fires
    exactly once, the confirmation toast shows, and the footer reads
    `✓ saved · remove` — **without** any manual button click.
  - Flagged single-word tap also banks it (bank PUT fires on the tap).
  - Non-flagged single-word tap saves to vocabulary but does **not** touch the
    bank (no spurious error) — preserved from the current manual test, now
    triggered on tap.
  - Fresh-paste single-word tap lazy-POSTs the entry, then links the vocab.
  - Phrase deep resolve → **no** auto-save; footer still shows `+ save phrase`.
  - Re-tap of an already-saved word → cache hit, no re-stream, no second save
    (`spanStart` and `saveVocabMutate` each called once).
  - Removing an auto-saved word via the footer (`✓ saved · remove`) deletes the
    vocab record (and un-banks a flagged word).
- Component tests (`word-card-body.test.tsx`, `phrase-card-body.test.tsx`,
  `word-popover.test.tsx`, `word-sheet.test.tsx`, `annotated-view.test.tsx`) and
  the e2e `read.spec.ts`: migrate the saved-state label assertions from
  `✓ saved · undo` to `✓ saved · remove`; the e2e's save flow migrates from a
  manual click to the auto-save-on-tap trigger.
