# Cross-user base-gloss cache — design

**Date:** 2026-07-13
**Status:** Approved (brainstorming), pending implementation plan
**Branch:** `worktree-feat+base-gloss-cache`

## Problem

Every word surfaced by the Reading annotation pipeline needs a short English
gloss. Today that gloss is always produced by an LLM call:

- **Skim pass** (`packages/ai/src/annotate.ts`, `streamAnnotation`) — the quick
  highlight pass. The server pre-selects above-level candidate words, then
  Claude (Haiku) enriches every candidate with `pos` / `gloss` / `freq` / `cefr`.
- **Deep card** (`packages/ai/src/read-span.ts`, `streamSpan`) — the on-demand
  card produced when a learner taps a word. A `word` card carries a `baseGloss`
  (clean lemma dictionary meaning) alongside a `contextualSense` (sentence-
  specific meaning).

The skim `gloss` and the deep-card `baseGloss` are both, by design, the
**lemma's base dictionary meaning** — not the contextual sense. They are
therefore stable per `(language, lemma)` and safe to reuse across texts and
users. Recomputing them on every read is wasted latency and AI cost.

Crucially, the skim pipeline already hands the server the `lemma` and corpus
`rank` for every known candidate **before** Claude is called
(`infra/lambda/src/annotate-stream/pipeline.ts:204-215`). Only `pos`, `gloss`,
and `cefr` actually require the LLM. A cross-user cache keyed on
`(language, lemma)` lets the server serve cached words instantly and send only
the misses to Claude — and skip the LLM entirely when every candidate is a hit.

## Goals

- Lower time-to-first-flag on the skim pass; eliminate the LLM round-trip when a
  passage is fully cache-warm.
- Reduce AI cost (fewer/smaller Haiku calls) and, as a bonus, stop burning a
  user's daily `read_annotation` quota on fully-cached passages.
- Feed the cache from both the skim pass and the deep card so it warms quickly.

## Non-goals

- Contextual/sense disambiguation. The deep card's `contextualSense`,
  `definition`, and `morphology` are always computed fresh and are never cached.
- Eliminating the deep-card LLM call. That call is dominated by
  `contextualSense`/`definition`/`morphology`; caching `baseGloss` cannot remove
  it. The deep card is a cache **writer** in v1, not a reader.
- Multi-sense storage / per-reader-level glosses. One base gloss per lemma.

## Key decisions (from brainstorming)

1. **Scope:** one shared `(language, lemma) → base_gloss` table used by both the
   skim gloss and the deep-card `baseGloss`.
2. **Polysemy:** one gloss per lemma; accept the imperfection. The base gloss is
   defined as the lemma's dictionary meaning; the deep card's (uncached)
   `contextualSense` disambiguates for the reader. Prompt nudge: `baseGloss`
   should list the top 1–2 senses when common (e.g. `banco → "bench; bank"`),
   which makes the single cached value genuinely correct.
3. **Seeding:** backfill the cache from the existing `user_vocabulary` corpus on
   day one (see §5).

## 1. Data model

New table `gloss_cache`, one row per `(language, lemma)`
(`packages/db/src/schema/`, exported from the db package like `userVocabulary`):

| column | type | notes |
|---|---|---|
| `language` | `text` notNull | PK part |
| `lemma` | `text` notNull | PK part |
| `base_gloss` | `text` notNull | cached meaning (top 1–2 senses) |
| `pos` | `text` notNull | lemma-dominant part of speech (skim `WordFlag` needs it) |
| `cefr` | `text` (`CefrLevel`) | CEFR band (skim `WordFlag` needs it) |
| `freq_rank` | `integer` | denormalized fallback; skim hits prefer the server frequency dict |
| `source` | `text` | `'skim' \| 'deep' \| 'seed'` — provenance/observability |
| `prompt_version` | `text` | annotate/read-span prompt that minted it |
| `created_at` | `timestamptz` notNull default now | |
| `updated_at` | `timestamptz` notNull default now | |

Primary key `(language, lemma)`.

**Why a dedicated table (not `vocab_lemma`):** `vocab_lemma` is keyed
`(language, lemma)` too and holds `rank` + `posAll`, but its `rank` is
deliberately *sense-blind seeding data* with fixed semantics. A user-facing
gloss is a different concern and does not belong there.

**Never cached:** null-lemma (unknown-to-corpus) words — there is no key; and
proper nouns — never written (the skim pass already drops them via
`isProperNounPos`).

Migration authored via the drizzle-kit generate flow. Watch for the
migration-renumber-on-merge collision (parallel branches collide on the next
`NNNN` slot — take main's `migrations/meta`, `git rm` the stale `.sql`, then
regenerate).

## 2. Serving path — skim pass (the latency win)

In `infra/lambda/src/annotate-stream/handler.ts`, after `buildCandidateList`
and the `meta` event, before the Claude call:

1. **Expose rank.** `buildCandidateList` currently strips `effectiveRank` from
   the returned candidates (`pipeline.ts:241-245`). Expose it (per-candidate)
   so cache hits can populate `WordFlag.freq` from the authoritative server
   frequency dict rather than from the cache.
2. **Batch lookup.** One query: `SELECT ... FROM gloss_cache WHERE language = ?
   AND lemma = ANY(?)` over all candidate lemmas (skip null lemmas).
3. **Hits** (candidate lemma present in cache): synthesize a `WordFlag` —
   `matchedForm` from the candidate, `gloss`/`pos`/`cefr` from cache, `freq`
   from the server rank. Emit these as `flag` events **immediately**, right
   after `meta`, before Claude is contacted.
4. **Misses** (null lemma, or lemma not in cache): the only candidates sent to
   `streamAnnotation`.
5. **All-hit short-circuit:** if there are no misses, skip Claude entirely — no
   `withLlmTrace`, no LLM latency, and (mirroring the existing empty-candidate
   path at `handler.ts:204-209`) **no `usage_events` row**. A fully-cached
   passage costs the user nothing and does not consume daily quota. Emit
   terminal `done` with the hit count.
6. **Partial:** only the misses run through Claude; `withLlmTrace` wraps just
   that call. Hits were already emitted in step 3.

Result: time-to-first-flag drops to DB-lookup latency for any passage with
hits; a fully-warm passage skips the LLM round-trip completely.

**Wire protocol:** unchanged. Cache-hit `flag` events are byte-identical to
Claude-produced ones; the client maps by `matchedForm` and cannot tell the
difference. Order to the client is irrelevant (hits first, then misses stream).

## 3. Serving path — deep card

The deep-card call is dominated by `contextualSense`/`definition`/`morphology`,
so caching `baseGloss` cannot eliminate it. In v1 the deep card is a
**writer only**: on a `word` card with a non-empty `baseGloss`, upsert one
`gloss_cache` row. **No change to the deep-card request/streaming path.**

(Future, out of scope: serve `baseGloss` from cache while Claude streams the
rest of the card — a marginal perceived-latency tweak that complicates the
streaming contract.)

## 4. Write-through

- **Skim misses:** accumulate the miss `flag`s during the stream, then do
  **one batch upsert** at stream end — not per-flag, to avoid DB round-trips
  mid-stream. Skip flags with null/empty lemma and proper nouns.
- **Deep card:** upsert one row from `card.baseGloss` when present and
  non-empty (skip older cards that predate the `baseGloss` field).
- **Best-effort:** every cache write is wrapped in try/catch and logged on
  failure; a cache-write error never fails the user's response (same posture as
  the existing `usage_events` insert at `handler.ts:310-323`).
- **Conflict policy:** last-write-wins via `onConflictDoUpdate`
  (`base_gloss`/`pos`/`cefr`/`freq_rank`/`source`/`prompt_version`/`updated_at`).
  All sources are lemma-base glosses of similar quality; `source` and
  `prompt_version` are stored so precedence can be revisited later if needed.

## 5. Seeding backfill (cold start)

A one-off CLI (dry-run by default; `--apply`, `--language`, `--limit`),
read-only over `user_vocabulary`. Registered in root `package.json` alongside
the other one-off scripts (e.g. `pnpm seed:gloss-cache`).

Derivation — a single `INSERT ... SELECT DISTINCT ON (language, lemma)`:

- base-gloss value = `card->>'baseGloss'` when present and non-empty; else
  `gloss` when `card IS NULL`; else the row is **skipped**. (Rationale: for
  tapped/deep rows `gloss` is the *contextual* sense, not a base gloss —
  `read.ts:721`; only `card->>'baseGloss'` is a clean base gloss there. For
  skim rows `card IS NULL` and `gloss` is the base gloss.)
- skip `pos = 'phrase'` rows (no lemma, `gloss` is `idiomaticMeaning`);
- skip any candidate value that is empty (the recently-added `baseGloss` field
  is absent/empty for older `card` snapshots);
- dedupe per `(language, lemma)`: prefer a `card->>'baseGloss'` source over a
  skim-`gloss` source, then most-recent `added_at`;
- carry `pos`, `cefr_band`, `frequency_rank` from the chosen row;
- write with `source = 'seed'`, `onConflictDoNothing` — never clobbers a fresher
  live-minted entry; safe to re-run.

## 6. Invalidation

No TTL and no auto-invalidation on prompt-version bump — lemma base glosses are
stable, and live write-through refreshes `prompt_version` naturally as words
recur. A manual purge option on the CLI (delete by `--language` or by stale
`--prompt-version`) covers the rare case a prompt change materially alters
glossing style.

## 7. Observability

The handler logs `cachedCount` / `missCount` / `claudeSkipped` alongside the
existing `candidateCount` (`handler.ts:193-199`), so hit rate and the
latency/cost win are measurable from day one.

## 8. Error handling

| Failure | Behavior |
|---|---|
| Cache lookup query fails | Log; degrade to "all candidates are misses" (send all to Claude). No user-visible failure — mirrors the vocab-query `.catch` in `pipeline.ts:154-157`. |
| Cache write (skim or deep) fails | Log; swallow. User already has their flags/card. |
| Null-lemma candidate | Always a miss; goes to Claude. |
| Proper-noun flag | Dropped by `isProperNounPos`; never written to cache. |
| All candidates are hits | Skip Claude, skip `usage_events`, emit `done`. |

## 9. Testing

Unit / integration tests (added to existing module test files, not orphaned):

- **handler / pipeline:** hit/miss split; all-hit ⇒ no Claude call **and** no
  `usage_events` row; partial ⇒ only misses sent to `streamAnnotation`; hit
  `WordFlag` shape (matchedForm + cache fields + server-rank freq) correct;
  lookup-query failure degrades to all-misses.
- **write-through:** batch upsert called once with the miss flags; write error
  swallowed (request still succeeds); null-lemma/proper-noun never written.
- **deep card:** `baseGloss` write-through on a word card; card without
  `baseGloss` (older snapshot) ⇒ no write; phrase card ⇒ no write.
- **seed CLI:** derivation rule (prefer `card->>'baseGloss'`, skim `gloss`
  fallback, skip phrase/empty), dedupe precedence, idempotent
  `onConflictDoNothing` re-run, dry-run makes no writes.
- **schema:** migration present; table count/shape test if the repo has one.

Existing `annotate-stream` tests (`handler.test.ts`, `pipeline.test.ts`,
`cross-lambda-contract.test.ts`) must continue to pass unchanged where behavior
is unchanged (empty-candidate short-circuit, error frames, soft-deadline).

## Affected files (indicative)

- `packages/db/src/schema/*.ts` — new `gloss_cache` table + export.
- `packages/db/migrations/**` — generated migration.
- `infra/lambda/src/annotate-stream/pipeline.ts` — expose `effectiveRank`.
- `infra/lambda/src/annotate-stream/handler.ts` — lookup, hit emit, miss-only
  Claude call, all-hit short-circuit, write-through, logging.
- `infra/lambda/src/routes/read.ts` — deep-card `baseGloss` write-through.
- New seed CLI under `packages/db/src/` (or `scripts/`) + `package.json` script.
