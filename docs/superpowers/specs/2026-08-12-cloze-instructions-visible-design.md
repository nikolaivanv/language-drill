# Display cloze `instructions` to the learner

**Date:** 2026-08-12
**Status:** approved, pending implementation
**Surface:** `apps/web/components/drill/cloze-prompt.tsx` (+ debrief review card)
**Related:** `docs/findings/2026-08-12-validator-alternative-enumeration-experiment.md`

---

## Problem

`content.instructions` is **never rendered for cloze**. `cloze-prompt.tsx` renders
`context`, `sentence`, and `glossEn` only; a repo-wide search finds `instructions`
rendered by exactly two components — `sentence-construction-exercise.tsx` and
`contextual-paraphrase-exercise.tsx`.

Three other surfaces assume the opposite:

| Surface | Assumes instructions are visible | Consequence today |
|---|---|---|
| `buildClozeValidationUserPrompt` | Renders `**Instructions:**` to the validator | The validator judges determinacy using text the learner never sees |
| The validator's `contextSpoilsAnswer` dimension | Treats `instructions` as a spoiler surface | Only coherent if the learner can read them |
| `qa-sample`'s `renderLearnerView` | Pushes `instructions` for CLOZE | Its "EXACTLY what a learner sees" contract is false for cloze |

The result is an information asymmetry: any disambiguating constraint that lives in
`instructions` makes an item look determinate to the validator while remaining
genuinely under-determined on screen. This is the same defect PR #612 fixed for the
**evaluator**, still present in the **validator**.

### Scale

Measured across the 9,112 auto-approved cloze rows in production:

| | Rows | Share |
|---|---|---|
| `instructions` carry a load-bearing constraint (enumerate a closed set, or name a tense/form) | 2,117 | 23% |
| …with **no** equivalent cue in `sentence` | **1,227** | **13.5%** |
| …also with no `options` at all | 51 | 0.6% |

The 1,227 figure is the operative one. `options` do not rescue the rest: `showOptions`
defaults to `false` (`cloze-exercise.tsx:54`) behind a "show answer options" toggle, so
the default typed-answer experience shows none of them — the same UI-visibility trap as
#612/#620.

These are regex proxies, so 1,227 is an estimate of the right order, not a census.

Worked example (`es-b1-adjective-de-infinitive`):

- `instructions`: *"Fill in the blank with either "de" or nothing (leave the space empty)."*
- `sentence`: `Las instrucciones de este juego son difíciles ___ entender.`
- stored answer: `de`

The instruction *is* the task — it defines a binary answer space. Without it a learner may
reasonably write `para`; with it, the validator sees a clean two-way choice and approves.

Note ~42% of approved cloze already put their cue inside `sentence`, exactly as
`generation-prompts.ts`'s Turkish case-cloze rule requires. Those rows are unaffected.

## Goal

Render `content.instructions` on the cloze drill card, so that what the learner sees
matches what the validator, the evaluator, and the QA solver all already assume.

## Non-goals

- Changing the validator, `renderLearnerView`, or any prompt. This change makes their
  existing behavior correct; it does not require editing them.
- Rewriting existing `instructions` copy. ~9k rows were authored while invisible; they
  passed `contextSpoilsAnswer` (a hard veto) so they are not answer-giveaways, but they
  have never been reviewed as display copy. Spot-check after shipping, don't gate on it.
- Suppressing "generic" instructions. See Decisions.
- Correcting the ambiguity fixture. That follows from this change (see Consequences).

## Design

### Placement

A task line between the grammar-point eyebrow and the hero sentence:

```
  ●  Adjectives + de + infinitive        ← eyebrow (context)
     Fill in the blank with either "de"
     or nothing (leave it empty).        ← NEW: instructions
  Las instrucciones de este juego
  son difíciles [___] entender.          ← hero sentence
  meaning  The instructions for this
           game are hard to understand.  ← gloss
```

Above the sentence, because the load-bearing cases must be read *before* answering —
"either `de` or nothing" is useless after the fact.

### Styling

`t-body text-ink-soft` — legible enough to be read before answering, clearly subordinate
to the `t-display-m` hero. Deliberately *not* `t-micro text-ink-mute` (the eyebrow's
treatment): the eyebrow is a passive tag, this is a functional instruction.

No label prefix. The gloss's `meaning` micro-label exists to disambiguate a
target-language sentence from its English translation; the instruction is
self-evidently an instruction and needs no chrome.

### Guard

Render only when `content.instructions` is non-empty, matching the existing treatment of
`context` and `glossEn`.

### Decisions

**Unconditional display.** No heuristic to suppress boilerplate. ~40%+ of instructions
are generic ("Fill in the blank with the correct form of the verb in parentheses") and
adding a muted English line to those cards is a real cost — but any heuristic that
misjudges a row silently recreates the exact bug this change fixes, and the misjudged
rows would be invisible. A predictable card beats a conditionally-correct one.

**Debrief parity.** `review-item-card.tsx` renders cloze post-answer in the debrief. Add
instructions there too: the debrief's purpose is to show the learner what they saw.

## Consequences

**The three assuming surfaces become correct with no edit.** The validator's
`**Instructions:**` line stops being an asymmetry; `contextSpoilsAnswer` becomes
coherent; `renderLearnerView`'s "EXACTLY what a learner sees" contract becomes true for
cloze.

**The ambiguity fixture's biggest systematic problem dissolves.** The independent audit
of `validator-ambiguity-cases.json` found 16 mislabelled cases, of which the largest
group depends on a parenthetical cue sitting in `instructions` — labelled `clean` on the
assumption the cue counts, while production hid it. Once instructions are visible those
cases are legitimately clean. **This change must land before the fixture corrections**,
or those corrections will be made against behavior that is about to change.

**A blind-solver pre-pass becomes well-defined.** Any future blind solver built on
`renderLearnerView` inherits a learner view that is finally accurate for cloze.

## Testing

- **Component:** `cloze-prompt.test.tsx` already carries `instructions: 'fill the gap'` in
  its fixture but never asserts it renders. Add the positive assertion, plus the
  empty/absent guard case.
- **Ripple:** grep the whole web app for tests that render a cloze and assert on text
  content or element counts — an added rendered line breaks text queries and counts.
  Precedent: renaming or adding to a component has repeatedly broken page-level tests in
  this repo that render it indirectly.
- **Debrief:** assert the review card shows instructions for a cloze item.
- **Visual:** `pnpm --filter @language-drill/web shoot --route /drill` to confirm the
  card's vertical rhythm survives a two-line instruction above the hero. A fresh worktree
  needs `/.env` and `apps/web/.env` copied first.
- **Gate:** `pnpm lint`, `pnpm typecheck`, and the full suite via
  `turbo test --concurrency=1` (root `pnpm test` fails under parallel load in this repo).

## Risks

| Risk | Assessment |
|---|---|
| ~9k rows of never-reviewed display copy suddenly visible | They passed `contextSpoilsAnswer`, so not giveaways. Sampled a dozen: serviceable. Spot-check post-ship. |
| Card grows taller; two-line instructions push the hero down | Visual check via `shoot` before merge. |
| An English line on every card dilutes a target-language surface | Accepted, and mitigated by muted styling. The alternative (conditional display) is worse. |
| Page-level tests break on the added text | Expected; the grep above is part of the work, not a surprise. |

## Rollout

Pure frontend change, no migration, no prompt sync, no Langfuse push. Ships with the
normal Vercel deploy. Reverting is a one-block removal.
