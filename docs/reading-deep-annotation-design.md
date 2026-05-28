# Reading: Deep Annotation — Design (Part 1)

> Status: **Part 1 shipped** — spec at `.claude/specs/reading-deep-annotation/`
> (requirements, design, tasks). Companion: `docs/vocabulary-review-design.md`
> (Part 2). The two parts share the `userVocabulary` schema as their seam —
> Part 1 writes the saved card, Part 2 consumes it.
>
> The original brainstorm below is preserved for context; the next section
> calls out the deviations from what actually shipped.

## Implementation status (Part 1, shipped)

All five motivating pain points (coverage cap, proper-noun flags, no on-demand,
no idiom/sentence, no "why this form") are addressed by the spec under
`.claude/specs/reading-deep-annotation/`. The shipped flow follows this
brainstorm closely; the deviations worth knowing about:

- **Postgres-backed cache, not Redis.** The codebase has no Redis client.
  Durability lives on `read_entries.span_annotations` (jsonb keyed by
  `"start:end"`), seeded into the page reducer's session map on entry load
  (Req 11.3). Re-taps within a session and re-opens of saved entries are free
  without Redis (Req 11.4); unsaved text stays in client state only (Req 11.2).
- **Front-end transport for the deep endpoint = `NEXT_PUBLIC_API_URL`.**
  `POST /read/annotate-span` is served from the regular Hono API (Function URL
  is **only** for the streaming skim SSE — `NEXT_PUBLIC_ANNOTATE_STREAM_URL`).
  `useReadAnnotateSpan` posts via the shared `createAuthenticatedFetch`, so it
  goes through the standard API Gateway with Clerk JWT auth.
- **Rate limit.** ~150/day on its own `read_span_annotation` `usage_events`
  event type, independent of the 50/day `ai_evaluation` / `read_annotation`
  bucket. Tune `READ_SPAN_DAILY_LIMIT` as usage signal arrives.
- **Save-to-vocabulary dedupe key.** Part 1 keeps the existing
  `(user, language, word)` *surface-form* unique key on `user_vocabulary` and
  stores the deep-card snapshot in a new `card` jsonb column. **Lemma-keying +
  an `occurrences[]` list is deferred to Part 2**'s review-unit decision.
- **No prefetch-on-hover.** The brainstorm suggested prefetch-on-hover to hide
  latency; Part 1 does not ship it. The skim preview shown during the deep
  load (Req 3.1) covers the common flagged-word case, and the chrome stays
  mounted across the skim→deep swap so there's no remount (Req 3.3).
- **Prompt versions** (both registered in the CLAUDE.md prompt-version table
  and synced to Langfuse via `pnpm push-prompts` per the documented runbook):
  - `ANNOTATE_SYSTEM_PROMPT_VERSION = "annotate@2026-05-26"` — slimmed skim
    pass + proper-noun exclusion (Req 1, 2).
  - `READ_SPAN_PROMPT_VERSION = "read-span@2026-05-28"` — adds the Turkish
    morpheme segmentation and German case/separable-prefix guidance, with
    sentence-grounded `whyThisForm` (Req 7).

End-to-end coverage of the deep flow lives in
`apps/web/e2e/tests/authenticated/read.spec.ts` (skeleton→loaded, cache-hit
bypass, save/undo+toast, phrase/sentence selection, retry, Escape dismiss).

## Motivation

The current Reading annotate feature has five pain points:

1. The long annotate response forced a ~20-word cap that often doesn't cover enough / the right words.
2. It sometimes annotates proper nouns (person names).
3. The user can't annotate a word **on demand**.
4. No way to annotate several words (an idiom) or a whole sentence.
5. For Turkish especially, we want not just the translation but **why this word form** was used in this sentence.

## Root cause

Today's design is **eager batch annotation**:

1. Paste text → server deterministically picks candidate words (`pipeline.ts`: tokenize → drop stopwords → keep words rarer than the CEFR frequency cutoff → drop words already in vocab → **cap at the 20 rarest**, `CANDIDATE_LIMIT = 20`).
2. One Claude call (Haiku, `max_tokens: 8192`) enriches all ~20 words at once, streaming one card per word (~175 output tokens/word).
3. UI highlights exactly those words; clicking shows the pre-fetched card.

Every highlighted word costs full enrichment up front whether or not it's ever clicked. That single fact drives 4 of the 5 complaints. (Note: the prompt says "at most 40 words" but the pipeline caps at 20 — the prompt number is a dead guardrail.)

## The reframe: two tiers that converge on one card

Stop treating the eager pass as the only path to an annotation. Add an **on-demand layer**, and demote the eager pass to a cheap "highlight" hint. Both tiers render into the same popover/sheet.

```
Paste → skim pass (Haiku, cheap)  → highlights + 1-line gloss for ~50 words
Tap/select any span → deep card (Sonnet, rich) → word | phrase | sentence
                       ↑ pre-flagged words show their gloss instantly while this loads
```

- **Skim pass (eager, cheap):** only job is to *hint* which words are probably unknown. Returns `matchedForm` + minimal fields. Coverage gaps are now acceptable because the user can click anything.
- **Deep annotation (on-demand, rich):** user taps/selects any span — word, idiom, or whole sentence — and gets a focused, high-quality card for exactly that. One target per call → can afford Sonnet, morphology, "why this form."

This unifies #1, #3, #4, #5; #2 is fixed in the skim pass.

---

## Locked decisions

### 1. Slim skim pass (independently shippable — PR #1)

- Eager `submit_annotated_words` tool drops `example` and deep fields. Per-word output shrinks ~175 → ~30 tokens: `{ matchedForm, pos, gloss, cefr, freq }`.
- Raise `CANDIDATE_LIMIT` 20 → ~50 (`pipeline.ts`). 50 × ~30 ≈ 1500 tokens — *faster* than today's 20 × 175.
- **Proper nouns:** add "never emit `PROPN`" to the prompt + drop `pos === "PROPN"` server-side. For ES/TR also pre-filter capitalized-non-sentence-initial tokens before the call (saves tokens). **German can't use capitalization** (all nouns capitalized) — rely on Claude's POS there.
- Bump `ANNOTATE_SYSTEM_PROMPT_VERSION` and sync Langfuse (`push-prompts`, both envs) per CLAUDE.md.

### 2. On-demand span endpoint

- **Transport:** `POST /read/annotate-span` on the **Hono API** (regular API Gateway, **non-streaming**) — not the streaming Function URL. A single Sonnet call returns ~1–3s; non-streaming keeps infra simple. (Stream just the sentence breakdown later if needed.)
- **Model:** `claude-sonnet-4-6` for this endpoint; Haiku stays on the skim pass.
- **Request:** `{ language, text /* full passage ≤2000 chars for context */, start, end /* char offsets of selection */ }`. Offsets-in-context (not just the substring) let Claude resolve "why this form" against the real sentence.
- **Caching:** Redis key `span:{lang}:{sha(passage)}:{start}:{end}`, TTL ~30d. Re-clicks and re-opens are free.
- **Rate limit:** *separate* counter from the 50/day eval budget — propose ~150/day token-bucket. (Sonnet isn't free; tune.)
- **New prompt:** `read-span-prompts.ts` with its own `READ_SPAN_PROMPT_VERSION`, registered in Langfuse via `bootstrap-prompts`, added to the CLAUDE.md prompt-version table.

### 3. Deep card field schema (response = discriminated union by span type)

Span type inferred from selection (1 token → word, multi-token within one sentence → phrase, crosses sentence boundary → sentence); Claude confirms/corrects.

```ts
type DeepWordCard = {
  type: "word";
  // ── core (always rendered) ──
  surface: string;            // form as it appears in the passage
  lemma: string;
  pos: string;
  contextualSense: string;    // "what it means HERE" — leads the card
  definitionL2: string;       // target-language def, calibrated to learner CEFR
  cefr: CefrLevel;
  freq: number;
  inflection?: Inflection;    // rendered inline in the header (gender is one token)
  morphology?: Morphology;    // TR always; DE cases / separable verbs
  // ── expandable (collapsed by default) ──
  synonyms?: { word: string; note: string }[];   // note = register/nuance tag
  collocations?: { phrase: string; gloss: string }[];
  register?: string;          // formal / colloquial / slang / dated
  example?: string;           // one fresh example (passage sentence already visible)
};

type Morphology = {
  root: string; rootGloss: string;
  segments: { morph: string; function: string }[];  // ev + -ler + -i + -n + -den
  whyThisForm: string;                                // grounded in THIS sentence
};

type Inflection = { forms: { label: string; value: string }[] };
//  DE noun → [{gender, "das"}, {plural, "Häuser"}]
//  DE verb → [{principal parts, "gehen–ging–gegangen"}, {auxiliary, "sein"}]
//  ES noun → [{gender, "f"}];  verb → [{irregularity, "stem-change o→ue"}]

type DeepPhraseCard = {
  type: "phrase";
  surface: string;
  literal: string;            // word-for-word
  idiomaticMeaning: string;   // what it actually means
  register: string;
  example: string;
  synonyms?: { phrase: string; note: string }[];
};

type DeepSentenceCard = {
  type: "sentence";
  surface: string;
  translation: string;
  breakdown: { chunk: string; role: string; note: string }[];  // chunked structure
  grammarNotes: string[];     // the points it exemplifies → feeds grammar-point tracking
};
```

**Field-set decisions (locked):**
- Core fields: contextual sense, POS, target-language definition, morphology/why-this-form, example, freq + CEFR.
- Extras included: inflection block, synonyms (w/ nuance tags), collocations, register/connotation.
- Density: **core shown + extras collapsed.** *Deviation:* `inflection` rendered inline in the header (German gender is a single token that belongs next to the headword), not behind a toggle.
- `definitionL2` pinned to the learner's CEFR band so it doesn't recurse into unknown vocabulary (worth an eval check).

### 4. Turkish morphology card

`morphology` is an optional field on the `word` response, populated for TR (and useful for DE cases / separable verbs). Rendered as the `evlerinden → ev + -ler + -i + -n + -den` breakdown plus a one-line justification grounded in the sentence (e.g. "ablative; motion away from the noun"). The prompt gets a dedicated TR section. This is the #5 feature and feeds grammar-point mastery tracking.

### 5. Save-to-vocabulary storage

Saving a word stores a **lexical core + a context snapshot**, captured **once at save time** (don't re-derive — stability across prompt changes + saves the Sonnet cost). Mirrors the existing `readEntries.flaggedWords` denormalization.

- **Queryable scalars stay columns** (you filter/dedupe on these): `word`, `lemma`, `pos`, `gloss`, `exampleSentence`, `frequencyRank`, `cefrBand`, `source`, `sourceReadEntryId`, `language`, `userId`, `addedAt`.
- **Rich/nested fields go in one new `card` jsonb** (never queried directly):
  ```ts
  card: jsonb {
    contextualSense, definitionL2, register,
    synonyms: [...], collocations: [...],
    inflection: {...}, morphology: {...},
    cardType: "word" | "phrase",
  }
  ```
- One forward-only Drizzle migration adds `card`; existing rows get `card = null`.
- **Lexical vs contextual split:** lexical fields (lemma, definition, synonyms, collocations, register, inflection, freq, cefr) drive review; contextual fields (surface form, contextualSense, source sentence, `morphology.whyThisForm`) are the encoding cue. Keep both — don't collapse `contextualSense` into `gloss`.
- **Phrases/idioms are savable** (`cardType: "phrase"`, the multi-word string in `word`). **Whole-sentence cards are NOT savable** (not a review unit — no save button).
- **Dedupe key = lemma** (see Part 2): one record per `(user, language, lemma)`; surface forms accumulate as occurrences. This is decided by the review design, not here.

---

## Frontend / UX

- **Selection:** tap word = word card; drag-select / long-press-extend = span (phrase or sentence). Small floating "Explain" affordance on an active desktop selection.
- **Reuse** `WordPopover` (desktop) / `WordSheet` (mobile) — add a loading skeleton + three body layouts for `word | phrase | sentence`.
- **Instant + rich:** pre-flagged words render their skim gloss immediately, then swap in the fetched card. Prefetch-on-hover for un-flagged words (desktop) hides latency.
- **New hook:** `useReadAnnotateSpan` (plain TanStack `useMutation`, not SSE) alongside the existing `useReadAnnotateStream`.

## Persistence

> Updated: deep-card persistence onto History entries is **in Part 1** (was deferred). History is the durable home for deep cards; it avoids re-spending Sonnet on reopened texts.

- **Redis** stays the fast cost/latency cache for deep cards (keyed by `(lang, passage-hash, offsets)`, ~30d TTL), independent of whether the text is saved.
- **Saved History entries get a durable copy.** Add a `spanAnnotations` jsonb on `readEntries`, keyed by `"start:end"` offsets → the word|phrase|sentence deep card. This handles all span types uniformly (the word-keyed `flaggedWords` map can't hold phrases/sentences) and renders the reopened annotated text from a single SELECT — no model call, no Redis-TTL dependence.
- **Incremental write-back:** when a deep card resolves for a text that is already a saved entry, PATCH it into that entry's `spanAnnotations`. Reopened texts capture new lookups automatically without re-saving.
- **Unsaved reads stay ephemeral** (Redis + client state only); nothing is written to the DB until/unless the text is a saved entry.
- **Independent of save-to-vocabulary:** persisting a card onto the entry (so the text stays annotated) is separate from adding the word to the vocab deck (`userVocabulary`). Either can happen without the other.
- Single-word cards may still also merge into `readEntries.flaggedWords` for the highlight layer, but the authoritative deep-card store is `spanAnnotations`.

## Suggested PR sequence

1. **Slim skim pass + PROPN drop** — self-contained, ships value immediately, no new endpoint.
2. **`/read/annotate-span` (word + phrase + sentence) on Sonnet** + cache + rate limit + frontend selection/popover + `card` jsonb migration.
3. **Turkish morphology** layered onto the word response.
4. *(Later)* Eager multi-word/idiom detection + range highlighting in the tokenizer (hardest piece; deferred).

## Open items

- **Audio (Polly) 🔊** — header slot designed in; wired as a layer-2 PR (lazy `read/tts?lemma=` or reuse existing Polly path). Not v1-blocking.
- On-demand rate-limit number (~150/day) needs validation against Sonnet cost.

## Relevant existing files

- Prompt/tool/parser: `packages/ai/src/annotate.ts` (`ANNOTATE_SYSTEM_PROMPT_VERSION`, `ANNOTATE_TOOL`).
- Candidate pipeline: `infra/lambda/src/annotate-stream/pipeline.ts` (`CANDIDATE_LIMIT`), handler/sse in same dir.
- Web UI: `apps/web/app/(dashboard)/read/_components/` (`annotated-view.tsx`, `annotated-text.tsx`, `word-popover.tsx`, `word-card-body.tsx`).
- API client: `packages/api-client/src/hooks/useReadAnnotateStream.ts`, `packages/api-client/src/schemas/read.ts`.
- DB: `packages/db/src/schema/read.ts` (`readEntries`, `userVocabulary`).
