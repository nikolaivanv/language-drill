# Requirements Document

## Introduction

**Reading: Deep Annotation (Part 1)** overhauls how the Read feature annotates a pasted passage. Today the feature uses a single *eager batch* pass: the server picks the ~20 rarest unknown words and one Claude (Haiku) call enriches all of them up front, streaming a full card per word. That design forces a hard word cap, wastes tokens enriching words the user never inspects, sometimes flags proper nouns, and can't explain idioms, whole sentences, or *why a particular inflected form was used* — the last being especially valuable for Turkish and German.

This feature splits annotation into two tiers that render into the same card UI:

1. **Skim pass (automatic, cheap):** a lighter Haiku pass whose only job is to *highlight* words that are probably unknown, with a one-line gloss. Dropping per-word enrichment cost lets it cover far more words and exclude proper nouns.
2. **Deep annotation (on demand, rich):** the user taps any word — flagged or not — or selects a multi-word span or a whole sentence, and a focused Claude (Sonnet) call returns a rich card: contextual sense, target-language definition, inflection, morphology with a sentence-grounded "why this form," synonyms, collocations, and register. Word and phrase cards can be saved to the user's vocabulary as a lexical-core-plus-context snapshot.

The companion **Part 2 (Vocabulary Review)** — `docs/vocabulary-review-design.md` — consumes the saved cards and is **out of scope here**. Authoritative design inputs: `docs/reading-deep-annotation-design.md` and `docs/design-archive/design_handoff_deep_annotation/` (UI prototype + README).

## Alignment with Product Vision

- **Serves the intermediate plateau** (product.md): frictionless comprehension support on authentic, self-chosen text lets B1–C1 learners read above their level without bouncing to a dictionary — the input side of the production loop.
- **Honest, skill-based progress, no gamification:** annotation adds no streaks/XP. The standout deliverable — sentence-grounded morphology and grammar chips — feeds the grammar-point taxonomy the app tracks (and, via saved vocabulary, the Part 2 spaced-repetition loop), reinforcing "evidence-based, not time-based" progress.
- **Polyglot-first:** all behavior is per the user's currently selected target language; morphology/inflection guidance is language-specific (Turkish agglutination, German gender/case).
- **Cost-controlled AI (tech.md §7, §10):** the cheap shared-style skim pass stays on Haiku; the expensive Sonnet path is on-demand only, durably cached on saved entries (Postgres), and independently rate-limited via its own `usage_events` budget so it can't blow the existing evaluation budget.

## Requirements

### Requirement 1 — Lighter automatic skim pass with broader coverage

**User Story:** As a reader, I want the passage to lightly highlight more of the words I likely don't know, so that I can see at a glance where to focus without a hard 20-word ceiling.

#### Acceptance Criteria

1. WHEN a passage is submitted for the skim pass THEN the system SHALL emit per-word skim entries containing only highlight-level fields (matched form, part of speech, short gloss, CEFR, frequency rank) and SHALL NOT include the full example/definition fields previously returned.
2. WHEN the server builds the skim candidate list THEN it SHALL raise the candidate cap above the current 20 (target ≈ 50) while keeping the rarest-first ordering and the existing CEFR-frequency gate and known-vocabulary post-filter.
3. WHEN the slimmed candidate set is annotated THEN it SHALL not regress the latency budgets in `docs/perf/more-responsive-reading-2026-05-12.md`: time-to-first-flag ≤3s warm / ≤6s cold (p95), time-to-done ≤12s warm / ≤18s cold (p95), despite the higher candidate cap.
4. IF the candidate list is empty THEN the system SHALL complete without calling Claude (preserving today's empty-candidate shortcut).
5. WHEN the skim prompt body or its tool schema changes THEN the change SHALL bump `ANNOTATE_SYSTEM_PROMPT_VERSION` and be mirrored into Langfuse per the project prompt-sync process.

### Requirement 2 — Exclude proper nouns from the skim pass

**User Story:** As a reader, I don't want person names and place names highlighted as vocabulary, so that the highlights stay meaningful.

#### Acceptance Criteria

1. WHEN the skim pass produces candidates THEN the system SHALL exclude tokens identified as proper nouns from the highlighted set.
2. WHEN the language is Spanish or Turkish THEN the system SHALL pre-filter capitalized tokens that are not sentence-initial before the Claude call, to avoid spending tokens on them.
3. IF the language is German (where all nouns are capitalized) THEN the system SHALL NOT use capitalization as the proper-noun signal and SHALL instead rely on the model's part-of-speech judgment, dropping any entry whose part of speech is a proper noun.
4. WHEN the model returns an entry tagged as a proper noun despite instructions THEN the server SHALL drop it before streaming it to the client (defense in depth).

### Requirement 3 — On-demand annotation of any word

**User Story:** As a reader, I want to tap any word — whether or not it was highlighted — and get a rich explanation, so that I'm never blocked by a coverage gap in the skim pass.

#### Acceptance Criteria

1. WHEN the user taps a highlighted (pre-flagged) word THEN the system SHALL open the card immediately using the cached skim data as the initial content while the deep card resolves.
2. WHEN the user taps a non-highlighted word THEN the system SHALL request a deep annotation for that word in its passage context and display a loading state until it resolves.
3. WHEN the deep word annotation resolves THEN the system SHALL replace the loading/preview content with the full word card without tearing down and re-mounting the card chrome.
4. WHEN the system requests a deep word annotation THEN the request SHALL include the full passage text plus the character offsets of the tapped token, so the model can resolve the contextual sense and inflection against the real sentence.
5. WHEN the deep annotation for a span has been resolved once THEN a repeat request for the same span SHALL be served from cache without a new model call.

### Requirement 4 — On-demand annotation of a multi-word phrase

**User Story:** As a reader, I want to select an idiom or fixed expression and get it explained as a unit, so that I understand meanings that aren't deducible word-by-word.

#### Acceptance Criteria

1. WHEN the user selects a contiguous multi-word span that is shorter than a full sentence THEN the system SHALL request a phrase annotation for that span in context.
2. WHEN a phrase annotation resolves THEN the card SHALL present the citation/surface form, the idiomatic meaning, the literal word-by-word rendering, the register, an example, and (when available) synonymous expressions.
3. WHEN a selection is made by mouse drag (mousedown → mouseenter → mouseup across tokens) THEN the system SHALL map it to the smallest matching span type and open the corresponding card.

### Requirement 5 — On-demand annotation of a full sentence

**User Story:** As a reader, I want to select a whole sentence and get its translation and a structural breakdown, so that I can untangle complex syntax.

#### Acceptance Criteria

1. WHEN the user selects a span that exactly matches a detected sentence range (boundaries computed from `.`, `!`, `?`) THEN the system SHALL request a sentence annotation.
2. WHEN a sentence annotation resolves THEN the card SHALL present the sentence, its translation, a chunked breakdown (each chunk with a grammatical role tag and a one-line note), and a list of grammar topics it exemplifies.
3. WHEN the sentence card displays grammar topics THEN each topic MAY deep-link into the existing Theory section; if the Theory link target is unavailable the chip SHALL render as non-interactive text rather than a broken link.
4. WHEN a sentence card renders THEN it SHALL NOT display a "save to vocabulary" action; an "add to translation drills" action is **out of scope for Part 1** and SHALL be omitted or rendered as a disabled affordance pending a separate decision.

### Requirement 6 — Deep word card content

**User Story:** As a learner, I want a word card that shows what the word means *here* plus how to use it, so that the card supports production, not just recognition.

#### Acceptance Criteria

1. WHEN a deep word card renders THEN it SHALL always show the core fields: headword (the inflected surface form), part of speech, CEFR badge, frequency rank, contextual sense ("what it means here"), and a target-language definition labelled with the language name.
2. WHEN the word carries gender or other inflection facts THEN the card SHALL render an inflection line inline near the header (e.g. German gender + plural, Turkish root + plural), not hidden behind a toggle.
3. WHEN the word has internal morphological structure THEN the card SHALL render a morphology breakdown (see Requirement 7).
4. WHEN the deep word card renders THEN synonyms (each with a nuance/register note), collocations (each with a gloss), register, and an additional example SHALL be available as individually-expandable sections collapsed by default.
5. WHEN any optional field (inflection, morphology, synonyms, collocations, register, extra example) is absent for a given word THEN the card SHALL omit that section cleanly rather than render an empty block.
6. WHEN the target-language definition is generated THEN it SHALL be calibrated to the learner's CEFR level so it does not rely on vocabulary above their level.

### Requirement 7 — Morphology and "why this form"

**User Story:** As a Turkish (or German) learner, I want to see how an inflected word is built and why that exact form appears in this sentence, so that I learn the grammar, not just the gloss.

#### Acceptance Criteria

1. WHEN the target language is Turkish THEN a deep word card for an inflected word SHALL segment the word into morphemes, each labelled with its grammatical function, and SHALL include a one-line explanation of why this form is used in this sentence.
2. WHEN the target language is German and the word's case/number/separable-prefix form is grammatically significant THEN the card SHALL provide the equivalent breakdown and sentence-grounded justification.
3. WHEN the "why this form" explanation is produced THEN it SHALL reference the grammatical trigger in the surrounding sentence (e.g. the governing verb, preposition, or syntactic role), not a generic rule statement.

### Requirement 8 — Save to vocabulary (lexical core + context snapshot)

**User Story:** As a learner, I want to save a word or phrase with everything I just learned about it, so that it's ready for spaced-repetition review later (Part 2) and I can see where I first met it.

#### Acceptance Criteria

1. WHEN the user saves a word or phrase card THEN the system SHALL persist a lexical core (lemma, part of speech, gloss, CEFR, frequency rank, source) plus a context snapshot (surface form, contextual sense, source sentence/passage reference, and the rich card fields: definition, register, synonyms, collocations, inflection, morphology).
2. WHEN the rich card fields are persisted THEN they SHALL be stored captured-at-save-time (a snapshot) and SHALL NOT be re-derived on read, so a later prompt change cannot alter an already-saved card.
3. WHEN a word is saved THEN it SHALL be deduplicated by the existing `(user, language, word)` (surface-form) key and SHALL store the deep-card snapshot on that record. Consolidating multiple surface forms of one lemma into a single lemma-keyed record with an occurrences list is **deferred to Part 2** (the review-unit decision); Part 1 does not change the unique constraint.
4. WHEN a card is saved THEN the corresponding word/phrase in the passage SHALL switch to the "saved" highlight style and a brief confirmation toast SHALL appear.
5. WHEN the user undoes a save from the confirmation affordance THEN the system SHALL remove the just-saved vocabulary record and revert the in-passage style.
6. WHEN a save is requested THEN the persistence layer SHALL accept only word and phrase cards and SHALL reject sentence cards (the server-side counterpart of Requirement 5.4).

### Requirement 9 — Card presentation, loading, and error states

**User Story:** As a reader on any device, I want the card to appear in the right place and tell me clearly when it's loading or has failed, so that the experience feels solid.

#### Acceptance Criteria

1. WHEN the viewport width is greater than 760px THEN the card SHALL render as a popover anchored to the tapped word (~340px wide, with a pointer triangle), capped in height and scrolling internally when content overflows.
2. WHEN the viewport width is 760px or less THEN the card SHALL render as a full-width bottom sheet with a dim backdrop, dismissible by tapping the backdrop.
3. WHEN a deep annotation is in flight (cold tap) THEN the card chrome SHALL open immediately with a skeleton/shimmer state and a "looking it up" caption, and the tapped word SHALL take the active style in the passage.
4. IF a deep annotation request fails or times out THEN the card SHALL show an inline error state with a retry affordance, rather than silently closing or showing an empty card.
5. WHEN the card body is taller than the available space THEN it SHALL scroll internally and never be clipped off-screen.
6. WHEN the card is open THEN pressing Escape (desktop) or tapping outside it SHALL dismiss it, consistent with the existing word-popover behavior.

### Requirement 10 — Caching, rate limiting, and authorization for on-demand calls

**User Story:** As the operator, I want the expensive on-demand path metered and cached separately, so that it stays affordable and can't exhaust the evaluation budget.

#### Acceptance Criteria

1. WHEN a deep annotation is computed for a span THEN the result SHALL be cached so a repeat request for the same span (same passage + offsets) avoids a new model call: for saved History entries the durable cache is the entry's `spanAnnotations` (Requirement 11), and within a reading session the client SHALL retain resolved cards. (No Redis is used — the codebase has no Redis client; metering and durable caching are Postgres-backed.)
2. WHEN deep-annotation requests from one user exceed the configured per-user daily limit THEN the system SHALL return a rate-limit error, counted via a dedicated `usage_events` event type (`read_span_annotation`) on a budget separate from the existing `ai_evaluation` / `read_annotation` 50/day bucket.
3. WHEN a deep-annotation request arrives THEN it SHALL require a valid authenticated user (Clerk JWT) and SHALL reject unauthenticated requests.
4. WHEN request input is received THEN it SHALL be validated with Zod (passage length within `READ_TEXT_MAX_CHARS`, offsets within range, supported language) before any model call.
5. WHEN the deep-annotation prompt is introduced or changed THEN it SHALL have its own versioned prompt constant (`READ_SPAN_PROMPT_VERSION`), be registered/synced in Langfuse, and be added to the prompt-version table in CLAUDE.md.

### Requirement 11 — Persisted deep annotations on History entries

**User Story:** As a learner reopening a previously read text, I want the words, phrases, and sentences I looked up to still be annotated, so that a saved text is a study artifact I can return to without re-generating (or paying for) anything.

#### Acceptance Criteria

1. WHEN a deep annotation resolves for a span in a text that is a saved History entry THEN the system SHALL persist that deep card onto the entry in a `spanAnnotations` jsonb keyed by the span's `"start:end"` character offsets.
2. WHEN a deep annotation resolves for a text that is NOT a saved History entry THEN the system SHALL NOT write it to the database; it SHALL remain in client state only (there is no server-side cache for unsaved text).
3. WHEN a saved History entry is opened THEN the annotated view SHALL render its persisted `spanAnnotations` together with `flaggedWords` from a single read of the entry, with no model call.
4. WHEN the user taps a span that already has a persisted deep card on the open entry THEN the card SHALL render instantly from the stored snapshot, bypassing both the deep-annotation endpoint and the model.
5. WHEN a deep card is persisted onto an entry THEN it SHALL be stored captured-at-resolution (a snapshot), consistent with Requirement 8.2, so a later prompt change does not alter it.
6. WHEN persisting a deep card onto a saved entry THEN the write SHALL be an incremental, targeted update of that entry's `spanAnnotations` and SHALL NOT require re-saving the whole entry.
7. WHEN a deep card is persisted onto an entry THEN this SHALL be independent of save-to-vocabulary: persisting onto the entry SHALL NOT add the word to the user's vocabulary, and saving to vocabulary SHALL NOT be required for entry persistence.

## Non-Functional Requirements

### Performance
- Time-to-passage-paint SHALL remain ≤100ms (skim highlights arrive progressively; the passage is readable immediately).
- A deep on-demand annotation for a single word SHALL resolve in roughly 1–3s p95 when uncached; cached hits SHALL be effectively instant.
- The slimmed skim pass SHALL not regress time-to-first-flag or time-to-done versus the current baseline despite the higher candidate cap.

### Security
- All annotation endpoints require a valid Clerk JWT; the on-demand endpoint verifies it server-side.
- All request payloads are validated with shared Zod schemas before any DB write or model call.
- No user-pasted passage text enters the shared pre-generated content pool; deep-annotation cache entries are keyed by passage hash and are not exposed cross-user as shared content.
- The Anthropic API key is read from Secrets Manager at runtime; never in client code.

### Reliability
- A model failure on the deep path SHALL surface as a recoverable, retryable card error and SHALL NOT corrupt the passage view or the skim highlights.
- A failed/aborted deep call SHALL NOT record a usage/metering event for a call that produced no result.
- Saving to vocabulary SHALL be idempotent per `(user, language, lemma)` so repeated saves of the same lemma never create duplicates.

### Usability
- The feature introduces no streaks, XP, points, or completion counters (product.md).
- The feature reuses the existing app design tokens; it introduces no new colors, type ramps, or radii.
- The card body is identical between popover and bottom-sheet presentations; only the chrome differs.
- Highlight intensities (subtle / assertive) and the saved style are visually distinct; the saved style overrides intensity styling.
- Interactive elements (word tokens, expandable sections, save/skip, dismiss) are keyboard-accessible and screen-reader-labelled.

## Out of Scope (Part 1)

- Eager detection and range-highlighting of multi-word idioms in the skim pass (idioms are reachable only via manual selection in Part 1).
- Audio playback (the 🔊 affordance may be present but non-functional; TTS wiring is a later layer).
- The "add to translation drills" action and the full vocabulary-review/spaced-repetition loop (Part 2).
- Touch-drag selection polish beyond a basic implementation (long-press-then-drag vs tap-target is an open product decision).
