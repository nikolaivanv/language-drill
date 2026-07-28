# Exercise Topic Diversity — Design

**Date:** 2026-07-28
**Status:** Approved (design), pre-implementation
**Author:** brainstormed with nikolaivanv

## Problem

The approved exercise pool for some cells collapses onto a handful of
scenarios. The trigger case: **ES B1 `sentence_construction` /
`es-b1-conditional`** — 79 approved exercises that are, in effect, three
scenarios wearing 79 costumes.

Evidence (prod, `br-green-waterfall-ancrvpr5`, 2026-07-28):

- ~56% of prompts fall into three templates (free-time / travel / café-water).
- 30 of 79 exercises (38%) share just **six** verbatim primary model answers —
  `Si tuviera más tiempo libre, aprendería a tocar la guitarra.` appears **10
  times**, the café "glass of water" request 8 times, etc.

### Root cause (three independent gaps)

1. **SC dedup keys on the prompt string only.** `canonicalSurface`
   (`packages/ai/src/generation-prompts.ts:830`) normalizes the SC `prompt` and
   nothing else. Answer-identical clones survive because their *instructions*
   are trivially reworded ("must contain a verb" vs "must include a verb") →
   distinct dedup keys → all inserted. The unique index
   (`exercises_dedup_idx`, `packages/db/src/schema/exercises.ts:48`) never sees
   the answer.
2. **Topic is never steered.** The scheduler always sends `topicDomain: null`
   (`infra/lambda/src/generation/scheduler.ts:451`), so every batch's user
   prompt literally says `Topic domain: mixed`
   (`generation-prompts.ts:703,796`). Scenario choice is left entirely to the
   model, which free-runs to its attractor (*tiempo libre + viajar*). There is
   **no topic/scenario coverage axis** — all seven `CoverageAxis` values
   (`packages/shared/src/coverage.ts:60`) are grammatical.
3. **`topicHint` is a decorative free-text label** the model attaches after the
   fact (`packages/ai/src/generate.ts:367`), with no feedback loop into dedup,
   coverage, or future generation.

### Why cloze / translation are *not* affected

Measured across all ES B1 cells (≥20 exercises): cloze/translation surfaces are
**100% distinct** and worst-case topical concentration is **13%** (vs SC's
56%). Two structural reasons:

- Their dedup surface **is the content** (`sentence` / `sourceText`), so
  answer-clones cannot accumulate.
- Their "content" is itself a full, varied, deduped sentence rather than a thin
  "write one sentence using X" scaffold that funnels many prompts to one
  canonical answer.

So the **clone problem is SC-specific**; **topic steering** is applied to all
types as cheap, systemic insurance (see Scope decisions).

## Goals / non-goals

**Goals**

- Kill answer-clone accumulation in `sentence_construction`.
- Give every point / level / language a topic-diversity floor **with zero
  per-point authoring** (systemic-only).
- Clean up the existing collapsed pool and refill it diversely.

**Non-goals (YAGNI)**

- No per-point "scenario" coverage axis and no per-point topic authoring
  (explicitly rejected — does not scale to 130+ points × 4 languages).
- No change to cloze/translation dedup (already healthy).
- No paraphrase-level semantic dedup for cloze/translation.

## Scope decisions (locked)

- **Approach:** systemic-only. No per-point authoring.
- **Sequencing:** land the generation fixes first, then run the pool cleanup and
  resume generation **together**, so the pool refills with diverse content
  instead of sitting shrunken. (Generation is currently paused in prod — PR
  #615.)
- **Topic steering (Component A):** applies to **all exercise types**.
- **Answer-aware dedup (Component B) and the cleanup (Component D):**
  **`sentence_construction` only.**

## Design

### Component A — controlled topic vocabulary + deficit-driven steering (all types)

**A1. Topic vocabulary.** Introduce one global, grammar-agnostic vocabulary of
~16 neutral everyday **domains** in `packages/shared` (e.g. `travel`, `food`,
`home`, `work`, `health`, `shopping`, `weather`, `education`, `family`, `money`,
`transport`, `technology`, `nature`, `media`, `sport`, `holidays`). Domains, not
scenarios — broad enough that any grammar point can be expressed in any domain.
Exported as a typed constant + a `TopicDomain` union alongside the coverage
types.

**A2. Deficit-driven assignment.** Mirror the existing coverage water-fill
(`infra/lambda/src/generation/coverage-decision.ts:decideCoverageTargets`):
per cell, compute the approved-pool distribution over `topicHint` (grouped from
`content_json->>'topicHint'`, legacy free-text values that don't match the
vocabulary count as `other`), then greedily assign each of the `need` drafts to
the domain currently **least represented** in that cell's pool. Produces a
per-draft `topicTarget[ordinal]`. This is a real feedback loop → the pool cannot
re-collapse. Attach to the `GenerationJobMessage` parallel to `coverageTargets`.

**A3. Injection (soft nudge).** Replace the hardcoded `topicDomain ?? "mixed"`
with the assigned per-draft domain in the `Topic domain:` directive. The
constraint is **soft**: the prompt instructs the model to prefer the assigned
domain but permits deviation when a point genuinely doesn't fit it, and requires
the model to record the **actual** `topicHint` from the vocabulary. Soft to
protect yield on the large cloze/translation pools.

**A4. Measurement fidelity.** Constrain the generation tool schema / prompt so
`topicHint` is drawn from the vocabulary (plus `other`) going forward, so A2's
deficit measurement is meaningful. Legacy free-text hints self-correct over
time as new rows dominate.

### Component B — answer-aware SC dedup (SC only)

Change `canonicalSurface` (`generation-prompts.ts:817`) for the
`SENTENCE_CONSTRUCTION` branch to key on the **normalized primary model answer**
(`normaliseSurface(content.modelAnswers[0])`) instead of the prompt. Two
exercises eliciting the same target sentence now collide regardless of
instruction rewording. All other types keep their existing keys. The unique
index and insert path are unchanged (still reads `_dedupKey`).

**Tradeoff (accepted):** two genuinely different prompts that happen to share a
primary answer will now collide and one will be dropped — desirable, since a
learner seeing the same target sentence twice is the redundancy we're removing.

### Component C — explicit diversity rule (prompt)

Add to the SC section of the generation prompt: honor the assigned
`Topic domain`, vary the scenario, and do not default to "free time / travel."
Feed **recent `topicHint`s** into the avoid-list alongside the existing recent
stems. Bump `GENERATION_PROMPT_VERSION` (`generation-prompts.ts:230`) to
`generate@2026-07-28` and mirror to Langfuse in **both** environments per
`docs/runbooks/prompt-update-and-revalidate.md` (`push-prompts` from fresh
`main` — see `push-prompts-stale-worktree` caution).

### Component D — pool-wide cleanup CLI (SC only; runs with the resume)

A CLI sibling of `revalidate:cloze` (registered in `package.json`) that, across
**all** SC cells / languages / levels:

1. Recomputes the new (answer-aware) dedup key for every approved/flagged SC
   row.
2. Groups by `(language, type, difficulty, grammar_point_key, newKey)` and
   **demotes all but one** of each collision group — keep the highest
   `quality_score`, tie-break oldest `created_at`. Demotion = set
   `review_status` to a non-approved state consistent with existing demotion
   scripts.
3. **Backfills** `_dedupKey` on the surviving rows to the new key so future
   inserts dedup correctly against them.

Dry-run by default; `--apply` to write. Supports `--language`, `--cefr`,
`--limit` for scoping. After `--apply`, delete the
`enableScheduledExerciseGeneration: false` flag in `infra/bin/app.ts` and CDK
deploy to resume (see memory `exercise-generation-paused-prod`).

## Data flow (after change)

```
scheduler (per cell)
  ├─ decideCoverageTargets  → coverageTargets[ordinal]   (grammatical axes)
  └─ decideTopicTargets     → topicTargets[ordinal]      (NEW: global domain water-fill)
        │
        └─ GenerationJobMessage { coverageTargets, topicTargets, topicDomain:null(removed) }
              → handler → run-one-cell
                    └─ per ordinal: renderCoverageBlock + Topic domain: <assigned>
                          → model emits exercise + topicHint ∈ vocabulary
                          → canonicalSurface (SC: modelAnswers[0]) → _dedupKey
                          → onConflictDoNothing against exercises_dedup_idx
```

## Testing

TDD, adding to each package's existing test file (no orphan files):

- **A (`decideTopicTargets`)**: given an approved-pool topic histogram and
  `need=N`, asserts drafts are assigned to the least-represented domains; empty
  pool spreads evenly; unknown legacy hints bucket as `other`.
- **A (vocabulary)**: `TopicDomain` union ↔ constant list stay in sync (mirror
  the coverage-values pattern).
- **B (`canonicalSurface`)**: SC now keys on `modelAnswers[0]`; two SC contents
  with different prompts but identical primary answer produce the same key;
  cloze/translation keys unchanged.
- **C**: prompt-render test asserts the assigned `Topic domain` line and the
  recent-`topicHint` avoid-list appear; `GENERATION_PROMPT_VERSION` bumped.
- **D (cleanup grouping)**: collision groups demote all-but-one by
  quality/age; survivors get the new `_dedupKey`; non-colliding rows untouched;
  dry-run writes nothing.

Full gate before push: `pnpm lint && pnpm typecheck && pnpm test` (watch the
lambda/db stale-`dist` and turbo-mock-db gotchas from memory).

## Rollout

1. Land A + B + C (code + tests).
2. Sync prompt to Langfuse (both envs); confirm `--check` is clean.
3. Run cleanup `--apply` across all languages/levels (SC).
4. Delete pause flag + CDK deploy to resume generation.
5. Verify the next nightly run: SC stops producing answer-clones; `topicHint`
   distribution spreads across the vocabulary for SC/cloze/translation; watch
   cloze/translation approval-rate/yield for regression from the soft topic
   nudge.

## Risks

- **Yield regression on cloze/translation** from the soft topic nudge — they are
  currently healthy. Mitigation: nudge is soft (deviation permitted); monitored
  at step 5; can scope A back to SC if regression appears.
- **Legacy free-text `topicHint`s** dilute A2's deficit measurement initially —
  self-corrects; acceptable.
- **Prompt-sync footguns** — push from fresh `main`; verify both envs
  (memories: `push-prompts-stale-worktree`, `langfuse-registers-template-not-rendered-body`).
- **Coverage-axis ripple avoided** — topic is deliberately NOT a `CoverageAxis`,
  so the `adding-coverage-axis-ripple` sites are untouched.
