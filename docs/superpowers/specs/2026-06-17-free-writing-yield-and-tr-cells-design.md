# Free-writing yield fix + TR A1/A2 free-writing cells

**Date:** 2026-06-17
**Status:** Approved (design)

## Problem

The 2026-06-17 production free-writing generation run was clean on its face (5 ES
cells, 100% approval), but masked a stuck-pool problem from 2026-06-16:

- Four ES cells hit the **title-dedup give-up** wall and ended below the target of
  8 approved: `es-b1-fw-daily-routine` (6), `es-b1-fw-ideal-weekend` (6),
  `es-b1-fw-my-town` (3), `es-b2-fw-remote-work` (3).
- In every 06-16 row, `rejected_count == dedup_given_up_count` — i.e. **no quality
  failures**; the generator simply keeps re-emitting duplicate/near-paraphrase
  titles for narrow topics, whose distinct-title space is small.
- On 06-17 the scheduler **suppressed** those 4 cells (saturated-dedup), so they
  did not even retry. Suppression clears only on a `CURRICULUM_VERSION` bump, not a
  prompt-version bump.

The avoid-list + 8-angle per-ordinal rotation fix already shipped on 06-16
(`free-writing-generate@2026-06-16`) and was **not** enough on its own.

Separately: free-writing is ES-only in production. TR (the other actively-developed
language, at A1/A2) has no free-writing cells.

## Goals

1. Stop the narrow-topic dedup churn and un-stick the 4 ES cells.
2. Add TR A1/A2 free-writing (3 topics per level).

## Non-goals (YAGNI)

- Retry-rejection feedback loop (passing the collided title into the retry generator).
- Dedup-threshold / saturation tuning.
- Re-authoring the ES narrow topics (`my-town`, `remote-work`).
- EN/DE free-writing.

## Design

### 1. Lower the pool target 8 → 5

`infra/lambda/src/generation/cell-targets.ts`:
`CELL_TARGET_DEFAULTS[ExerciseType.FREE_WRITING]` becomes
`{ A1: 5, A2: 5, B1: 5, B2: 5 }`.

Effect once the ES version bump (§3) clears suppression:

| Cell | approved now | under target 5? | outcome |
|---|---|---|---|
| `es-b1-fw-daily-routine` | 6 | no | complete, no regen |
| `es-b1-fw-ideal-weekend` | 6 | no | complete, no regen |
| `es-b1-fw-my-town` | 3 | yes (need 2) | re-attempts under boost; pool of 3–5 acceptable |
| `es-b2-fw-remote-work` | 3 | yes (need 2) | re-attempts under boost; pool of 3–5 acceptable |
| cells at 7/8/10 | — | no | over target, untouched |

A pool of 5 distinct prompts per topic is sufficient for the product and removes the
token-burn of chasing 8 on a topic that can't yield it.

### 2. Light diversity boost (code-only — no Langfuse push)

The collision happens in the **uncached user prompt + angle list**
(`packages/ai/src/free-writing-generation-prompts.ts`), not the Langfuse-registered
`free-writing-generate-system-prompt`. So this requires **no `push-prompts` sync** —
only a `FREE_WRITING_GENERATION_PROMPT_VERSION` bump to
`free-writing-generate@2026-06-17`.

**2a. Level-aware angle pools.** The current 8 angles include B1/B2-analytical ones
("weighing two opposing positions", "the causes or reasons", "the consequences",
"a recommendation/solution") that are **too hard for A1/A2**. Split into two pools and
make selection level-aware: `freeWritingAngleForOrdinal(ordinal, cefrLevel)`.

`CONCRETE_ANGLES` (A1/A2):
- "the personal, individual side of the topic"
- "a concrete everyday scenario that brings the topic to life"
- "a specific memory or a single moment tied to the topic"
- "a typical day or routine connected to the topic"
- "describing a specific place or person central to the topic"
- "how things have changed over time around the topic"

`FULL_ANGLES` (B1/B2) — **unchanged from today's 8**, so B1/B2 (all current ES cells)
behavior is identical and there is no regression risk for ES:
- "the personal, individual side of the topic"
- "the social or collective side of the topic"
- "a concrete everyday scenario that brings the topic to life"
- "weighing two clearly opposing positions"
- "the causes or reasons behind it"
- "the consequences or effects"
- "a direct comparison between two options or situations"
- "a recommendation, a solution, or advice"

**2b. Sharper user-prompt instruction** in `buildFreeWritingGenerationUserPrompt`:
explicitly tell the model to commit to one **concrete sub-facet** of the topic and
avoid near-paraphrases of the topic name.

The system-prompt template body is **not** edited, so no Langfuse sync is needed; the
version bump tags the cohort for the behavior change.

### 3. Curriculum version bumps

- `packages/db/src/curriculum/es.ts`: `CURRICULUM_VERSION_ES` `2026-06-15b` → `2026-06-17`
  (clears saturated-dedup suppression on the 4 ES cells so they re-evaluate under
  target=5 + boost).
- `packages/db/src/curriculum/tr.ts`: `CURRICULUM_VERSION_TR` `2026-06-16b` → `2026-06-17`
  (curriculum changed — new cells added).

### 4. TR A1/A2 free-writing cells

**4a. A1/A2 word-bands.** `FREE_WRITING_LENGTH_BY_CEFR` currently has only B1/B2 and
`freeWritingLengthFor()` throws for A1/A2. Add:
- **A1**: `{ minWords: 30, maxWords: 60, suggestedMinutes: 10 }`
- **A2**: `{ minWords: 60, maxWords: 100, suggestedMinutes: 15 }`

**4b. Six new `kind: 'free-writing'` entries** in `packages/db/src/curriculum/tr.ts`
(placed after the dictation umbrellas). Authored content:

```ts
// Free-writing topic umbrellas — kind: 'free-writing' (Phase 2 generation)
{
  key: 'tr-a1-fw-my-day',
  kind: 'free-writing',
  name: 'Bir günüm',
  description:
    'An informal prompt to describe a typical day using simple present-tense routine verbs and times of day.',
  cefrLevel: A1,
  language: TR,
  examplesPositive: [
    'Asks what they do in the morning, afternoon, and evening.',
    'Requires at least one time expression (e.g. saat yedide).',
  ],
  examplesNegative: ['*Write an essay about the meaning of daily life.'],
  commonErrors: [
    'Listing verbs with no times or sequence.',
    'Drifting into past-tense storytelling instead of a typical day.',
  ],
  freeWriting: { register: 'informal' },
},
{
  key: 'tr-a1-fw-my-family',
  kind: 'free-writing',
  name: 'Ailem',
  description:
    'An informal prompt to introduce family members, who they are, and one simple detail about each.',
  cefrLevel: A1,
  language: TR,
  examplesPositive: [
    'Asks for at least two family members and their jobs or ages.',
    'Requires one sentence about something a family member likes.',
  ],
  examplesNegative: ['*Discuss the role of family in society.'],
  commonErrors: [
    'Naming people with no detail at all.',
    'Possessive-suffix errors (annem vs. *anne benim).',
  ],
  freeWriting: { register: 'informal' },
},
{
  key: 'tr-a1-fw-my-weekend',
  kind: 'free-writing',
  name: 'Hafta sonum',
  description:
    'An informal prompt to describe what the learner usually does on the weekend, with simple activities and places.',
  cefrLevel: A1,
  language: TR,
  examplesPositive: [
    'Asks for two or three weekend activities.',
    'Requires saying who they do one activity with.',
  ],
  examplesNegative: ['*Compare weekends and weekdays in detail.'],
  commonErrors: [
    'A single activity with no places or people.',
    'Mixing in complex past-tense narration.',
  ],
  freeWriting: { register: 'informal' },
},
{
  key: 'tr-a2-fw-a-trip',
  kind: 'free-writing',
  name: 'Unutamadığım bir gezi',
  description:
    'A neutral prompt to narrate a memorable trip: where, when, and one thing that happened, using past tense.',
  cefrLevel: A2,
  language: TR,
  examplesPositive: [
    'Asks where and when the trip was, plus one memorable event.',
    'Requires a closing sentence on how they felt about it.',
  ],
  examplesNegative: ['*Describe travelling in general.'],
  commonErrors: [
    'Generic travel description with no specific trip.',
    'Staying in present tense instead of narrating the past.',
  ],
  freeWriting: { register: 'neutral' },
},
{
  key: 'tr-a2-fw-free-time',
  kind: 'free-writing',
  name: 'Boş zamanlarım',
  description:
    'A neutral prompt to describe free-time activities and hobbies, how often, and why the learner enjoys them.',
  cefrLevel: A2,
  language: TR,
  examplesPositive: [
    'Asks for two hobbies and how often they do them.',
    'Requires one reason why they like one of the hobbies.',
  ],
  examplesNegative: ['*List every hobby that exists.'],
  commonErrors: [
    'Frequency adverbs missing or misplaced.',
    'Listing hobbies with no reason or detail.',
  ],
  freeWriting: { register: 'neutral' },
},
{
  key: 'tr-a2-fw-my-city',
  kind: 'free-writing',
  name: 'Yaşadığım şehir',
  description:
    'A neutral prompt to describe the city the learner lives in: what it is like and one thing they like or would change.',
  cefrLevel: A2,
  language: TR,
  examplesPositive: [
    'Asks what the city is like and names one place in it.',
    'Requires one thing they like and one they would change.',
  ],
  examplesNegative: ['*Write a tourist guide to a famous city.'],
  commonErrors: [
    'Listing places with no description.',
    'Locative/ablative case errors with place names.',
  ],
  freeWriting: { register: 'neutral' },
},
```

(Exact `A1`/`A2`/`TR` symbol references follow whatever aliases `tr.ts` already uses
for the other entries.)

## Tests

- `packages/db/src/curriculum/curriculum.test.ts`
  - Add a TR free-writing assertion: 3 A1 + 3 A2 entries, each with
    `freeWriting.register` defined.
  - Update the TR per-language counts test (currently asserts dictation = 2, etc.) to
    include the new free-writing count.
- `packages/ai/src/free-writing-generation-prompts.test.ts`
  - A1/A2 now valid in `freeWritingLengthFor` — replace the "throws for A1/A2"
    expectation with band assertions for A1 (30–60) and A2 (60–100).
  - Update the angle-rotation test for the level-aware pools (A1/A2 → concrete pool;
    B1/B2 → full 8-angle pool, ordinal rotation preserved).
- `cell-targets` test (wherever `CELL_TARGET_DEFAULTS` is asserted): A1/A2 entries +
  B1/B2 = 5.

## Verification

1. `pnpm eval:gen` A/B of `repo` (baseline) vs the boosted prompt
   (`candidate`) on a dataset containing a TR A1 cell and a narrow ES cell
   (`es-b1-fw-my-town`), to confirm the boost improves distinct-title yield without
   hurting approval rate. (A Langfuse push isn't involved; the boost is code-only, so
   `repo` already reflects the candidate after the edit — A/B via `file:`/git stash or
   compare run-over-run.)
2. Full gate: `pnpm lint && pnpm typecheck && pnpm test` (run tests with
   `pnpm turbo run test --concurrency=1` to avoid the known infra parallel flake).
3. The scheduled ~04:00 UTC run converges over ~2 days after the version bumps land;
   confirm the 4 ES cells and 6 TR cells in the next run via the Neon prod branch.

## Affected files

| File | Change |
|---|---|
| `infra/lambda/src/generation/cell-targets.ts` | FW target → `{A1:5,A2:5,B1:5,B2:5}` |
| `packages/ai/src/free-writing-generation-prompts.ts` | level-aware angle pools; sharper user prompt; A1/A2 length bands; version bump |
| `packages/db/src/curriculum/es.ts` | `CURRICULUM_VERSION_ES` → `2026-06-17` |
| `packages/db/src/curriculum/tr.ts` | `CURRICULUM_VERSION_TR` → `2026-06-17`; 6 FW entries |
| `packages/db/src/curriculum/curriculum.test.ts` | TR FW assertions + counts |
| `packages/ai/src/free-writing-generation-prompts.test.ts` | A1/A2 bands + angle pools |
| cell-targets test | A1/A2 + B1/B2=5 |
