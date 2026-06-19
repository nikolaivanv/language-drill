# ES Conjugation Verb-Seeding — Design

_Date: 2026-06-19 · Status: approved, pre-implementation_

## Problem

On the 2026-06-19 generation run, the two new Spanish B1 conjugation cells collapsed:

| Cell | Requested | Produced | Approved | Rejected | Dedup-given-up |
|---|---|---|---|---|---|
| `es-b1-conditional` | 65 | 100 | 3 | 11 | 11 |
| `es-b1-present-subjunctive` | 50 | 146 | 10 | 30 | 30 |

Root cause: the conjugation generator lets the model **free-pick the verb**, and it recycles a tiny favorite set (conditional retained only `poder`, `tener`; subjunctive only 8 distinct lemmas across 11 rows). The dedup surface is `lemma::featureBundle`, so the unique `(verb × person)` space is exhausted almost immediately and most drafts collapse as duplicates — `dedup-given-up` is the largest loss bucket, not validator rejection (`rejection_reason_counts` is null for both cells).

Secondary failures (same prompt):
- **Chain-of-thought leaks into the learner-facing `instructions` field** — 4 of 11 retained subjunctive items (36%) contain abandoned drafts / "→ Actually… — Wait, let's keep it simple…".
- **Carrier sentences reference the wrong verb** (e.g. a `comer` item scaffolded with "Quiero que (yo) llegue a tiempo").

Not a regression — 6/19 was the first real run (6/18 produced 0, a transient miss).

## Goal & scope

Force verb diversity so conjugation drafts stop colliding, and tighten the prompt so instructions are clean.

**In scope:** verb-seeded conjugation generation for **Spanish only**, reusing the existing frequency-seed machinery; the bundled prompt-discipline fix.

**Out of scope (future work):** a general PoS dataset; topic classification ("draw 10 B1 travel verbs"); the syncretic-form pedagogy issue (`-ar` 1sg = 3sg present subjunctive being non-diagnostic).

> **⚠️ Temporary workaround.** The suffix + inflection-count verb detection (`verbBand`) is a deliberate stopgap, not the target architecture. It infers part-of-speech from surface morphology because the frequency files carry no PoS. **Long term we will enrich the vocabulary file with a proper `pos` field** (and ideally `topic`), at which point `verbBand` collapses to a trivial `pos === 'verb'` filter and the same data unlocks topic-conditioned selection ("draw 10 B1 travel verbs"). The heuristic should be treated as throwaway once that field lands.

## Core idea

The pipeline already seeds **cloze** and **translation** drafts with distinct CEFR-banded content-word lemmas, one per ordinal, excluding lemmas already used in the cell's pool:

`buildSeedWords` (`run-one-cell.ts`) → `pickSeeds` (`seed-picker.ts`) → `frequencyBand` (`packages/ai/src/frequency/index.ts`), with the band chosen by `cefrRankWindow(cefr)`.

Conjugation is simply not wired in (`isSeedableType` = CLOZE | TRANSLATION). We extend the same mechanism to conjugation, but seed **verbs**, and change the prompt so the model conjugates the verb it is handed instead of choosing one. Because the seeder controls the verb and the existing `coverageTargets[ordinal].person` controls the person, every draft is a deterministically-distinct `(verb, person)` pair — dedup collapse is designed out, not retried away.

## Components

### 1. Verb detection — `packages/ai/src/frequency/index.ts` (new helper)

`frequencyBand` dedupes to bare lemma strings and discards surface counts, so add a sibling helper, e.g. `verbBand(language, rankMin, rankMax): readonly string[]`:

- **Candidate filter:** lemma whose infinitive suffix matches the language. ES: `-ar` / `-er` / `-ir`. (Per-language suffix set; only ES is enabled now.)
- **Inflection check (false-positive guard):** keep the lemma only if the frequency file maps **≥ K distinct surface forms** to it beyond the trivial `{lemma, lemma+s, lemma+es}` set. Verbs have many conjugated surfaces; nouns like `lugar`→`{lugar, lugares}` and `mujer`→`{mujer, mujeres}` fail the check. `K` to be tuned against the data during implementation (start ~4 and verify against a known verb/noun sample).
- **Language gating:** a per-language config marks whether `verbBand` is enabled (ES = yes; DE/TR = no for now). Calling it for a disabled language returns empty (callers must guard).
- **Caching & determinism:** cache per `(language, rankMin, rankMax)` and sort by rank ascending with lemma tie-break, exactly like `frequencyBand`.

### 2. Seeder — `run-one-cell.ts` + `seed-picker.ts`

- Make `CONJUGATION` seedable **for ES only** — guard on `cell.language === ES` so DE/TR conjugation stays unseeded (current behavior, zero regression risk).
- Add a conjugation seed picker that draws from `verbBand` (banded by `cefrRankWindow(cell.cefrLevel)`), per-ordinal, deterministic on `batchSeed`, coordinated with `coverageTargets[ordinal].person`.
- **Exclusion granularity (approved decision):** the dedup surface is `lemma+featureBundle`, so the same verb *should* legitimately recur across different persons. Prior-seed exclusion is therefore keyed to **`(lemma, person)`**, not verb alone. `fetchPriorSeeds` for a conjugation cell returns the set of prior `(lemma, person)` pairs already in the pool; the picker avoids re-proposing a `(verb, person)` pair but may reuse a verb for a different person. This keeps the verb bank from being burned 5× too fast and matches the real dedup key.
- Band-exhaustion fallback mirrors the existing picker (widen / allow `null` seed so the ordinal is unseeded rather than failing).

### 3. Prompt — `packages/ai/src/generation-prompts.ts` (bump `GENERATION_PROMPT_VERSION` → `generate@2026-06-19`)

- In `buildGenerationUserPrompt`, when `exerciseType === CONJUGATION`, render the seed as a directive to **conjugate that specific verb** ("Conjugate this verb: `<lemma>`"), rather than the cloze/translation framing of "include this content word in the sentence".
- In `buildConjugationSpecificsBlock`, add rules:
  1. **Use the verb you are given; do not choose your own.**
  2. **`instructions` must contain only the directive to the learner** — no reasoning, no abandoned drafts, no meta-text ("Actually…", "Wait…", "→").
  3. Any example/carrier sentence must use the **target verb**.
- Update the in-repo `*_SYSTEM_PROMPT` fallback to match, and update the two version-assertion tests in `generation-prompts.test.ts`.

## Data flow

```
runOneCell  (ES conjugation cell)
  └─ fetchPriorSeeds → prior (lemma, person) pairs
  └─ buildSeedWords → verbBand picker, coordinated with coverageTargets[ordinal].person
       └─ spec.seedWords[ordinal] = <verb lemma>
  └─ buildGenerationUserPrompt → "Conjugate <verb> for <person>"
       └─ model returns that exact drill; dedup key (lemma+featureBundle) unique by construction
```

## Testing

- **`verbBand`** (unit): `hablar`/`comer`/`vivir` classified as verbs; `lugar`, `mujer`, `mar`, `ayer`, `azúcar` excluded; correct banding by rank window; cached/deterministic; ES-only (disabled language → empty).
- **Seeder** (unit): conjugation seeded for ES, not for DE/TR; `(lemma, person)` exclusion lets a verb recur across persons but not within the same person; deterministic on `batchSeed`; graceful band exhaustion.
- **Prompt** (unit): conjugation user prompt embeds the seed verb as a conjugate-this directive; specifics block carries the no-meta-text and use-the-given-verb rules; `GENERATION_PROMPT_VERSION` bumped and matches the `generate@YYYY-MM-DD` format assertion.
- **End-to-end gate:** build an ES-conjugation cell dataset via `pnpm eval:gen:export` and run `pnpm eval:gen` (baseline = `repo`/current, candidate = the change) comparing **approval rate** and **dedup-given-up** before vs after — *before* relying on the scheduler.

## Deployment

- The prompt body is served from **Langfuse** at runtime; the version bump alone does not change behavior. After merge, run `push-prompts` for **both** prod and dev (per `CLAUDE.md` Prompt Editing).
- Both ES cells re-run on the next ~04:00 UTC tick. `es-b1-conditional` approved exactly 3 — at the edge of the `<3` skip-low-yield threshold but not below it; `present-subjunctive` is at 10. The seeder change lives in `@language-drill/db` (code), independent of curriculum-version / prompt suppression, so no `CURRICULUM_VERSION` bump is required to re-trigger.

## Risks

- **Band size:** if the ES B1 verb band is small relative to `15 floors × 5 persons`, exhaustion forces unseeded ordinals (degrades to current behavior, not a failure). Verify band size during implementation; widen the rank window for conjugation if needed.
- **`K` tuning:** too high drops real low-frequency verbs; too low readmits nouns. Validate against a labeled sample.
- **Langfuse sync forgotten:** would leave the old free-pick prompt live despite the version bump — the deployment step is mandatory, not optional.
