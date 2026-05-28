# Vocabulary Review — Design (Part 2)

> Status: **design agreed (brainstorm), not yet implemented.** This is the source
> for a future `/spec-create`. Companion: `docs/reading-deep-annotation-design.md` (Part 1).
> Part 1 writes the saved card (`userVocabulary` + `card` jsonb); Part 2 consumes it.
> **Build Part 1 first** — it produces the saved-card shape this depends on.

## Positioning

Vocabulary review must obey the project's two laws — **production over recognition**
and **mastery over streaks** — or it's just Anki with extra steps. What makes it
*ours*: every review item is built from the exact sentence the word was saved in,
graded by Claude, and it moves the learner's grammar-point map, not a streak counter.

## Locked decisions

- **Review unit = lemma.** One scheduler card per `(user, language, lemma)`. Surface forms accumulate as **occurrences** `{ surface, sentence, contextualSense, whyThisForm }`. Cloze picks an occurrence at random → you review the concept `ev` but get tested on `evlerinden`, `evler`, `eve` across sessions. (This decision also settles Part 1's dedupe key.)
- **Scheduler = FSRS** (`ts-fsrs`), **not** the phase plan's SM-2. State = `stability` + `difficulty` (not SM-2's ease factor — different columns). Fewer reviews per retention, fits the "latest packages" rule and the probabilistic CEFR model. Wrap behind one `applyReview(card, rating)` seam to keep the algorithm swappable.
- **Grading = hybrid.** Cheap items (exact-match cloze, recognition) graded locally → free/instant. Production items ("use it", free recall) graded by Claude (same structured-JSON eval pipeline) → metered/rate-limited.

---

## A. Scheduling engine (the backbone)

- **Per-item SR state**: due date, interval, `stability`, `difficulty`, reps, lapses, last/next-review. New `vocabulary_review_state` table (1:1 with `userVocabulary`) or columns on it.
- **Daily queue builder**: due items + a capped intake of new items, built **per language** (polyglot — don't blend ES and TR in one queue; context-switching hurts).
- **Decay** already lives in the progress model (Ebbinghaus); the scheduler is its actuator.
- **Grade → FSRS `Rating`** (Again/Hard/Good/Easy → 1–4):
  - Local-graded: correct → `Good`, wrong → `Again`.
  - Claude-graded: eval JSON score maps onto the 4-point rating (flawless+natural → `Easy`, correct-with-minor-errors → `Good`, major errors → `Hard`, wrong/unusable → `Again`).

## B. Review item types — the production core

All generated from the **saved card snapshot / occurrences** (that's why Part 1 stores context + morphology + collocations):

- **Cloze-in-context** — blank the word in its saved source sentence; user types the correct **inflected form**. Gold for Turkish: tests morphology, not just the lemma.
- **Meaning → production** — show `contextualSense` / `definitionL2`; user produces the target word.
- **"Use it"** — produce a *fresh* sentence using the word; Claude grades correctness + naturalness. Most productive, hardest.
- **Recognition** (cheap) — word → meaning; warm-up / brand-new items only.
- **Listening** — Polly plays the word/sentence → type it (phonology).
- **Speaking** (Phase 2) — say it → Transcribe → Claude.
- Item type scales with **FSRS maturity**: new = recognition/cloze, mature = production. Vary it so the learner memorizes the *word*, not the card layout.

## C. Grading & the feedback loop

- **Cheap items** (exact-match cloze, recognition): graded locally, instant, free.
- **Production items**: Claude eval (existing structured-JSON pipeline) → correctness, naturalness, error annotations. Metered/rate-limited.
- 🔑 Review results **also update competency mastery** (vocabulary depth, grammar accuracy) **and grammar-point tracking**. Nailing the ablative in a cloze bumps the "ablative case" point on the map. Review *advances the radar* — it isn't a side activity. Error annotations from the eval drive the grammar-point updates.

## D. Session flow & UX

- Start → queue of N → one item at a time → immediate feedback → next.
- Progress shown as **mastery movement + due-count burndown** — never streaks/XP/score.
- End-of-session summary: which grammar points/competencies moved, words promoted vs lapsed, next due.
- Entry points: a dedicated **Review** surface, a due-count badge, "**review the words from this passage**" filter off a `readEntry`, and (Phase 3) due reviews feed the "app decides" playlist.

## E. Bank management / browse

- List + search saved words; filter by language, CEFR, source, **status** (new / learning / mature / leech / suspended / known).
- Word detail = re-rendered saved deep-card snapshot + SR stats + review history.
- Actions: edit, delete, suspend, **mark-known** (eject from queue), reset.
- **Leech handling**: surface chronically-failed words; offer a different item type or a mnemonic.

## F. Cross-feature integration

- Vocab review is the **per-user metered AI path** — *not* the shared pre-generated pool. Cost lives here; rate-limit it.
- Words currently under review get a distinct highlight back in Reading.
- Feeds the progress dashboard (radar, grammar map, vocabulary frequency coverage).

## Open items

- Exact `vocabulary_review_state` schema (separate table vs columns on `userVocabulary`).
- Eval-score → FSRS `Rating` mapping thresholds (tune empirically).
- Daily new-item intake cap and per-language session sizing.
- Whether phrases/idioms review with the same item types as single words (likely a reduced set — no morphology cloze).
