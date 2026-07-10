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

- When a **single-word** lookup resolves, the word is automatically added to the
  passage's word bank. The existing save path dual-writes to `user_vocabulary`
  (and the spaced-repetition layer), so the auto-add reuses that behavior
  unchanged.
- Applies to both single-word lookup paths:
  1. **Skim popover** — clicking a pre-flagged word.
  2. **Deep lookup** — a single-word tap that streams a `DeepCard` of
     `type: 'word'`.
- **Phrases and sentences are out of scope.** Phrase cards keep the manual
  `+ save` button; sentence cards remain non-savable (existing client + server
  guards).
- Auto-save fires **immediately when the lookup resolves** — no dwell/visibility
  delay. Removal is always an explicit user action.
- The auto-saved word appears in the right-panel word bank (`WordBankRail` on
  desktop, `WordBankSheet` on mobile) and is removable via its `×` — already
  built.
- The card footer for an auto-saved single word shows the existing saved state,
  **"✓ saved · remove"**, which toggles the word back out from within the card.

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

## Trigger points

1. **Deep single-word card** — in the span-annotation stream's `onResolved`
   callback in `page.tsx` (where the resolved `DeepCard` is already cached).
   When `card.type === 'word'` and the word is not already banked, invoke the
   existing `handleSaveCard(card, span)`. This reuses:
   - lazy `read_entries` row creation on a fresh paste (so the FK can link), and
   - the flagged-vs-non-flagged bank distinction already inside the handler.

2. **Skim flagged word** — on popover/sheet open, invoke the existing
   `onBankToggle(word)` exactly once, **guarded so it only ever adds** (never
   toggles off an already-saved word on reopen).

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

Add cases to the existing test files (no orphaned files):

- `read/page.test.tsx`:
  - Single-word deep resolve → save mutation fires exactly once and the word
    appears in the panel.
  - Phrase deep resolve → **no** auto-save; manual `+ save` still required.
  - Re-lookup of an already-banked word → no second save (guard holds).
  - Remove via panel `×` after an auto-save works.
- `word-card-body.test.tsx` / `word-popover.test.tsx` / `word-sheet.test.tsx`:
  - Flagged-word open → banked once; reopening the same (already-saved) word
    does not toggle it off.
  - Auto-saved single word renders the `✓ saved · remove` footer; clicking
    remove toggles it back out.
