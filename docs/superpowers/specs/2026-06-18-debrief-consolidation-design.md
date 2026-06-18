# Debrief page consolidation

**Date:** 2026-06-18
**Status:** Approved, ready for implementation plan
**Supersedes parts of:** `2026-06-16-debrief-skill-movements-design.md` (the skill-movements
panel stays; the coach card and what's-next callout it sat alongside are removed here)

## Problem

The post-session debrief tab stacks five elements that say "how'd you do" three
times in three registers, while the one differentiated, valuable signal — which
specific skills moved and how confidently — is buried as a plain list in the middle.

Current stack (top to bottom):

| Block | Content | Source |
|---|---|---|
| Header | `nice work.` · *you got 4 of 5 · accuracy 80%* | `debrief-header.tsx` |
| Coach card | *Solid session.* / "solid turkish run — 4 of 5 stuck." / "that pattern is landing — see what moved on the progress page." | templated by accuracy tier |
| Skills you moved | Personal (copular) suffixes — ▼ Slipped · high confidence / 4 held steady | real per-grammar-point data |
| What's next | see what moved → | tier-driven link |
| Footer | see your progress → · done · practice more | fixed |

Concrete defects:

1. **Score stated twice** — header *and* coach card both say "4 of 5".
2. **"Go look at your progress" appears three times** — coach card body, what's-next
   callout, and footer all route to `/progress`.
3. **Coach card is templated filler** — its second paragraph is keyed only to
   accuracy tier, so it restates the score and gestures vaguely at progress.
4. **Contradiction bug** — the coach line is computed from accuracy tier while the
   skills panel is computed from skill movements. They can disagree: the screenshot
   shows the coach saying *"that pattern is landing"* (positive) directly above
   **▼ Slipped**. Different inputs, no shared source of truth.

## Principle

**One source of truth per fact.** Score lives in the header. Skill movement is the
body and the *only* progress narrative, so it cannot contradict itself. Actions live
in the footer. Nothing is said twice.

## Design

### 1. Header — unchanged
`nice work.` (tier title) + `you got X of Y · accuracy Z% [· N skipped]`. Sole owner
of the score. No change to `debrief-header.tsx`.

### 2. Debrief tab body — replaced
The three stacked blocks (coach card, skills panel, what's-next callout) collapse to a
single **"what moved"** panel, promoted to hero. `debrief-tab.tsx` becomes essentially
a thin wrapper that renders the rewritten panel.

```
WHAT MOVED
────────────────────────────────
▲▲ Subject pronouns              strong gain · we're confident
▼  Personal (copular) suffixes   slipped · we're confident

4 skills held steady
```

Panel rules (rewrite of `skill-movements-panel.tsx`):

- **Eyebrow:** `what moved` (rendered uppercase by `.t-micro`).
- **Sort movers positive-first:** `strong-gain` → `gain` → `new` → `slip`. Ends on
  what to work on next. Within a band, preserve incoming order (stable).
- **Per row:** directional glyph + grammar-point label as the primary element, then a
  quieter secondary detail: `<band phrase> · <confidence phrase>`.
  - Band phrases: `strong-gain` → "strong gain", `gain` → "gained",
    `new` → "new — first evidence", `slip` → "slipped".
  - Confidence phrases (reworded from "high/low confidence"):
    `high` → "we're confident", `low` → "early signal".
  - Colors keep existing tokens: gains `text-emerald-600`, slip `text-rose-600`,
    new `text-ink-soft`.
- **Steady footnote:** `N skills held steady` (was "N held steady" — add "skills").

### 3. Empty / all-steady state — new
With the coach card gone, a session where nothing moved must not render a blank tab.
Two sub-cases, both calm and non-blank:

- **All steady** (`movements` present, every band `steady`):
  ```
  WHAT MOVED
  ────────────────────────────────
  Nothing shifted much this round — N skills held steady.
  That's normal; another short session adds signal.
  ```
- **No movement recorded** (`movements` empty — no graded grammar points this round):
  ```
  WHAT MOVED
  ────────────────────────────────
  No skill movement recorded this round.
  ```

The panel **no longer returns `null`** — it always renders the eyebrow plus one of:
movers list, all-steady message, or no-movement message.

### 4. What's-next callout — deleted
Fully redundant with the footer's "see your progress →". Removed from `debrief-tab.tsx`.

### 5. Footer — unchanged
`see your progress →` · `done` · `practice more`. Single action zone, single progress
link. No change to `debrief-footer.tsx`. (Note: the footer's static two-path coverage
— progress vs. practice more — replaces the deleted callout's tier-adaptive routing.
Losing the tier adaptivity is acceptable.)

## Dead code removed

Verified by grep on 2026-06-18:

- **`apps/web/lib/drill/debrief-narrative.ts`** + **`__tests__/debrief-narrative.test.ts`**
  — used only by `debrief-tab.tsx` and its own test; all output was coach paragraphs
  and what's-next copy being cut.
- **`coach-messages.ts` `sessionComplete` branch** — the `CoachContext` `sessionComplete`
  variant and `sessionCompleteMessage()` are used only by the debrief tab. Remove the
  variant, the function, and the `coachMessage — sessionComplete` test block in
  `__tests__/coach-messages.test.ts`. The live drill (`drill/page.tsx`) keeps
  `coachMessage` for `idle`/`evaluated` — those stay.

Stays: `accuracy-tier.ts` (header title via `TIER_TITLE` still uses it).

## Files touched

| File | Change |
|---|---|
| `apps/web/app/(dashboard)/drill/debrief/_components/skill-movements-panel.tsx` | Rewrite: hero treatment, sort, reworded band/confidence phrases, empty + all-steady states, no more `null` |
| `apps/web/app/(dashboard)/drill/debrief/_components/skill-movements-panel.test.tsx` | Update: empty/all-steady now render messages (was `null`); assert sort order + reworded phrases |
| `apps/web/app/(dashboard)/drill/debrief/_components/debrief-tab.tsx` | Strip coach card + what's-next callout; render panel only; drop `debriefNarrative`/`coachMessage`/`accuracyTier` imports |
| `apps/web/app/(dashboard)/drill/debrief/_components/__tests__/debrief-tab.test.tsx` | Remove coach-line assertion; assert no coach card / no what's-next callout; panel renders |
| `apps/web/lib/drill/debrief-narrative.ts` | Delete |
| `apps/web/lib/drill/__tests__/debrief-narrative.test.ts` | Delete |
| `apps/web/lib/drill/coach-messages.ts` | Remove `sessionComplete` variant + `sessionCompleteMessage` |
| `apps/web/lib/drill/__tests__/coach-messages.test.ts` | Remove `sessionComplete` describe block |

No backend, schema, or API changes. `DebriefResponse` / `SkillMovement` types unchanged.

## Testing

- `skill-movements-panel.test.tsx`: movers render with new phrasing; sort order
  positive-first; all-steady renders the steady message (not null); empty renders the
  no-movement message; steady footnote pluralization.
- `debrief-tab.test.tsx`: no coach card, no what's-next callout; panel present.
- Full suite: `pnpm lint && pnpm typecheck && pnpm test` green (coach-messages and
  debrief-narrative deletions must not orphan imports).

## Out of scope

- Per-skill deep links into `/progress` and plain-language per-skill glosses
  (considered; deferred — no backend deep-link routing today).
- Review tab, header, and footer visual treatment — unchanged.
