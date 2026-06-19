# Conjugation feature-bundle legibility — design

**Date:** 2026-06-19
**Branch:** `feat/conjugation-follow-ups`
**Status:** Approved (brainstorming) — ready for implementation plan

## Problem

The conjugation drill names the target cell with a single dense string in the
target language's grammar notation, e.g.:

> geçmiş zaman (-DI) · olumlu · 3. tekil şahıs (o)

This is hard to parse quickly. Three distinct issues (all confirmed by the user):

1. **Metalanguage** — the grammar terms are in the target language (Turkish here),
   which the learner must decode.
2. **Flat formatting** — three independent dimensions (tense, polarity, person)
   are mashed into one dot-string with no visual separation.
3. **Buried pronoun** — the actionable "who" (`o`) — the thing you conjugate for —
   sits at the end, not prominent.

The problem compounds with **fluency mode** (timed rapid drills). Fluency mode
currently handles only cloze and vocab (`fluency-item.tsx` `promptText` returns
`''` for other types); introducing conjugation there means the prompt must be
parseable at a glance under time pressure.

## Decisions (from brainstorming)

- **Label language:** target term **+** English subgloss (e.g. `geçmiş zaman`
  with `past` beneath). Serves both reading speed and learning the metalanguage.
- **Layout:** **A — pronoun badge + chip row.** A bold accent pronoun badge
  (`o` / he·she·it) anchors the eye first; tense/polarity follow as quiet chips,
  each showing the target term with a muted English subgloss.
- **Pool migration:** **regenerate** the conjugation pool so every row carries the
  new structured data.

## Design

### 1. Data model — `ConjugationContent` (`packages/shared/src/index.ts`)

Additive and backward-compatible. `featureBundle` **stays** — it remains the
canonical "name the cell" string used by the validation prompt and the
`lemma + featureBundle` generation dedup key, both untouched. Two new
**optional** fields:

```ts
/**
 * Ordered grammar dimensions, each as target-language term + short English
 * gloss. Excludes person/number (that lives in `subject`).
 * e.g. [{ term: "geçmiş zaman", gloss: "past" }, { term: "olumlu", gloss: "affirmative" }]
 */
features?: Array<{ term: string; gloss: string }>;

/**
 * Person/number cue, surfaced prominently. `pronoun` is the representative
 * target-language pronoun; `gloss` is its English.
 * e.g. { pronoun: "o", gloss: "he / she / it" }
 */
subject?: { pronoun: string; gloss: string };
```

Optional so existing pool rows (which only have `featureBundle`) still type-check
and render via fallback. No new `ExerciseType` member, so no exhaustive-switch /
`Record<ExerciseType, …>` ripple across packages.

### 2. Generation (`packages/ai/src/generate.ts` + `generation-prompts.ts`)

- Extend `CONJUGATION_GENERATION_TOOL` input schema with `features` and
  `subject`, marked **required in the tool** so every newly generated conjugation
  exercise has them (the type stays optional for old rows).
- The existing `featureBundle` field is retained and still required.
- Parser (`generate.ts`, the conjugation `requireString`/assembly path) reads and
  validates `features` (non-empty array of `{term, gloss}`) and `subject`
  (`{pronoun, gloss}`) for conjugation content.
- Prompt guidance (`generation-prompts.ts`):
  - `features` carries tense/mood and polarity **where the language has it**
    (TR has polarity; ES/DE typically don't), in the target language's
    conventional notation, each with a 1–2 word English gloss. Person/number is
    **not** in `features`.
  - `subject` carries the representative target-language pronoun for the cell's
    person/number plus its English gloss.
  - `featureBundle` continues to name the full cell as today (unchanged role).
- Bump `GENERATION_PROMPT_VERSION` to `<surface>@2026-06-19` per CLAUDE.md.
- `VALIDATION_PROMPT_VERSION` is **not** bumped — the validation prompt reads
  `featureBundle`, which is unchanged.

### 3. Rendering — Layout A

- `apps/web/app/(dashboard)/drill/_components/conjugation-exercise.tsx`:
  - When `subject` **and** `features` are present, render the prompt card as:
    an accent **pronoun badge** (`pronoun` large, `gloss` beneath), followed by a
    chip row — one chip per `feature` (`term` with a muted English `gloss`
    subline).
  - When absent, render today's flat `featureBundle` string (fallback).
  - Extract the badge + chip-row markup into a small presentational helper so
    fluency mode can reuse the identical treatment later.
- `apps/web/app/(dashboard)/drill/debrief/_components/review-item-card.tsx`:
  the conjugation review line (currently `lemma (gloss) — featureBundle`) renders
  the same compact structured presentation when present, flat `featureBundle`
  otherwise.

### 4. Pool migration

Regenerate (user's choice). Sequence:

1. Merge code (schema + generation + UI + fallback).
2. Push the updated generation prompt to Langfuse (prod **and** dev) per
   `docs/runbooks/prompt-update-and-revalidate.md` / the CLAUDE.md push-prompts
   flow.
3. Demote the existing approved conjugation exercises and re-run generation so the
   repopulated pool carries `features` + `subject` (same pattern as the theory-pool
   regen).

The flat-string fallback means nothing breaks in the window between deploy and
regeneration — old rows simply show today's presentation until replaced.

### 5. Testing

- **`shared`:** type compiles with the new optional fields.
- **`ai`:** the conjugation generation tool/schema includes `features` + `subject`;
  the parser requires and validates them for conjugation; a generated fixture
  round-trips through parse → `ConjugationContent`.
- **`web`:**
  - conjugation-exercise renders the pronoun badge + feature chips (with English
    subglosses) when structured data is present;
  - conjugation-exercise falls back to the flat `featureBundle` string when
    `features`/`subject` are absent;
  - debrief review-item-card renders the structured line when present and the flat
    line otherwise.

## Out of scope

- Wiring conjugation into fluency mode (separate work — tracked under the
  `feat-fluency-drill-improvements` worktree). This design only makes the shared
  presentation reusable for it.
- Deterministic code-side bilingual grammar tables (considered as approach B;
  deferred — the LLM-authored glosses are sufficient and far lighter).
