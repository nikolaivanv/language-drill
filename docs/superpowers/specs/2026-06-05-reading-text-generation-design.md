# Reading Text Generation — Design

**Date:** 2026-06-05
**Status:** Approved (pending implementation plan)

## Problem

The Reading feature is copy-paste only. Users (starting with the author) struggle
to find level-appropriate texts online — especially A1/A2 Turkish, which is scarce.
The current workaround is leaving the app to generate text in Gemini/Claude, then
pasting it back. This creates a cold-start problem: an empty textarea does nothing
until the user supplies good, level-calibrated text, which is the hard part.

The app already knows the user's per-language CEFR estimate and their known
vocabulary — context a browser LLM lacks. Generating calibrated-to-your-level text
in-app is therefore something the app can do better than the manual workaround, and
it is squarely on-positioning (CEFR-as-spine, active production, "between italki
sessions").

**Out of scope:** URL extraction / link import. Copy-paste already covers manual
text; server-side scraping (paywalls, JS rendering, readability, ToS) is high-cost,
low-value for now. May revisit later as a client-side Readability pass.

## Decisions (locked during brainstorming)

1. Build the **text generator only**, no URL import.
2. **Cold-start = prompt chips + caching** (hybrid). Chips onboard and scaffold the
   generator; generated texts are cached and reused across users, so popular
   chip+level combos become instant and free. The pool builds itself from real
   usage — no separate scheduled pre-generation Lambda.
3. **Level = auto from the user's CEFR estimate, with manual override.** Language =
   the user's selected study language, with a switcher.
4. **Controls = topic + length** (short / medium / long). Genre is folded into chip
   text and the prompt, not a separate widget.
5. **Quality control = lightweight deterministic check**, reusing the existing
   frequency/CEFR tokenizer. Regenerate once if too hard; store the difficulty score.
6. **Metering = a new `text_generation` bucket.** Cache hits do not meter; only real
   LLM generations count.
7. **Generation model = Sonnet** (quality-sensitive, low-resource languages drift on
   Haiku).
8. Endpoint is **non-streaming** for v1; the UI shows a **loader** during generation.

## User experience

The Reading `EmptyView` becomes a launchpad with three paths:

- **Prompt chips** — a row of tappable suggestions seeded per language (e.g. "A short
  café dialogue", "News: a city festival", "A short story about a cat"). Genre lives
  in the chip text, not a separate control.
- **Generate your own** — a topic box plus a length toggle (short / medium / long).
- **Paste** — the existing textarea, unchanged.

A small auto-filled **level control** ("Level: A2 ▾") defaults from the user's tracked
estimate for the current language and is editable. A **language switcher** sits
alongside, defaulting to the selected study language.

Flow: tap a chip or type a topic → **Generate** → a **loader** shows while the request
is in flight → the text appears and flows straight into the existing annotate pipeline
(`AnnotatedView`). A generated passage behaves exactly like a pasted one: same
skim/deep annotation, same "Save" path into `read_entries`.

## Generation + validation pipeline (`packages/ai`)

- New `READING_GENERATION_SYSTEM_PROMPT` + `READING_GENERATION_PROMPT_VERSION`
  constant, following the prompt-versioning convention in CLAUDE.md, re-exported from
  `packages/ai/src/index.ts` and registered in Langfuse via `bootstrap-prompts`.
- **Model: Sonnet** (`claude-sonnet-4-6`). Annotation stays on Haiku; generation
  earns Sonnet because level-appropriate generation in lower-resource languages (e.g.
  Turkish at A1/A2) is where Haiku drifts. Tunable.
- **Deterministic level check:** after generation, tokenize the text through the
  existing frequency/CEFR pre-filter (the frequency logic in `buildCandidateList` in
  the annotate Lambda) and compute the fraction of words above the target level.
  - If it exceeds a threshold → **regenerate once** with a "simpler/stricter" nudge.
  - Final lexical-difficulty score is stored on the text.
  - This requires lifting the frequency-scoring helper into a **shared module** that
    both the annotate Lambda and the generator import, rather than duplicating it.
- If the regen still runs hard, return it anyway with a soft "runs a bit above
  {level}" note — never block reading.

## Caching

- New shared table **`generated_reading_texts`**: `cacheKey` (unique), `language`,
  `cefr`, `length`, `prompt`, `text`, `difficultyScore`, `createdAt`, `hitCount`.
- **Cache key** = hash of `(language, cefr, length, normalizedPrompt)`, where
  normalization is lowercase + trim + collapse internal whitespace. Chips carry
  canonical prompt strings → reliable hits across users; freeform prompts hit on
  near-exact matches.
- Request flow: compute key → `SELECT` →
  - **hit** → return cached text, do not meter, increment `hitCount`.
  - **miss** → generate → validate → insert → return, meter once.

## Backend endpoint (`infra/lambda` Hono API)

- **`POST /read/generate`**, non-streaming. Request: `{ topic, length, cefr, language }`.
  Response: `{ text, cefr, difficultyScore, fromCache }`.
- Auth, `AI_KILL_SWITCH`, and `AI_GLOBAL_DAILY_CAP` checks identical to the other AI
  endpoints (admin/boosted unaffected per existing rules).
- Streaming is a possible future enhancement but not worth the complexity for v1;
  cache hits are instant regardless.

## Metering

- New **`text_generation`** bucket in `infra/lambda/src/usage/limits.ts`.
  Placeholder limits: free 20/day, boosted 200/day (tune later).
- **Meters only on cache miss** (a real LLM call). Cache hits are free, making the
  cache strictly user-beneficial.
- Respects the global cost brakes like every other AI bucket.

## Data model

- **New:** `generated_reading_texts` (shared cache) + a Drizzle migration.
- **`read_entries`:** unchanged, except an optional `source` enum
  (`'paste' | 'generated'`) so saved generated texts are distinguishable later.
  (Optional — drop if we want zero churn there.)

## Error handling

| Case | Behavior |
|---|---|
| Generation API failure | `502` (matches `POST /exercises/:id/submit`) |
| Daily limit hit | `429` |
| Kill switch / global cap | same as other AI endpoints (admin/boosted unaffected) |
| Regen still too hard | return text + soft level note, do not block |

## Testing

- **Unit:** cache-key normalization; difficulty-threshold + regen-trigger logic;
  metering-only-on-miss.
- **Integration:** `/read/generate` cache hit vs miss; `text_generation` bucket
  increments correctly (only on miss).
- **Frontend:** `GenerateView` (chip tap, topic+length submit, level override,
  language switch); loader shown during generation; generated text lands in
  `AnnotatedView`.

## Open implementation notes

- Confirm the exact home of the shared frequency helper (likely `packages/ai` or
  `packages/shared`) during planning so both the annotate Lambda and the generator
  import one source.
- Seed chip prompt strings per language alongside the generation prompt.
