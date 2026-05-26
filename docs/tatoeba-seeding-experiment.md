# Experiment: Tatoeba sentence-seeding for cloze/translation generation

**Status:** proposal / draft (uncommitted). Not a spec yet — run `/spec-create` if it graduates.
**Author:** scoping note, 2026-05-26.
**Decision it informs:** Should the generation pipeline seed cloze/translation drafts with
*attested human-written sentences* (Tatoeba) instead of (or in addition to) *frequency-dictionary
words*? Adopt only if it measurably improves quality-per-dollar.

---

## 1. Hypothesis

Handing the generator an attested, natural base sentence to **adapt** — rather than a single seed
word to **invent around** — reduces the unnatural / ambiguous / answer-spoiling drafts that the
validator currently vetoes. Concretely, we expect a sentence-seeded batch to show, vs. the
word-seeded baseline shipped in R5:

- higher **validator pass rate** (approved + flagged) / produced,
- lower `contextSpoilsAnswer` and `ambiguous` shares in `rejectionReasonCounts`,
- equal-or-lower `dedupGivenUpCount` (attested sentences are more varied than model inventions),
- comparable or lower cost (shorter completions when the model adapts rather than composes).

**Null result is a valid, cheap outcome.** If the deltas are within noise — or Tatoeba TR quality is
too low — we keep word-seeding and close the question.

## 2. Scope

**In:**
- One generation arm change: an optional `sentenceSeed` per ordinal, injected exactly where R5
  injects `seedWords` (uncached user prompt; system prompt / cache prefix untouched).
- A bundled, filtered Tatoeba subset per language (mirrors the bundled frequency dicts).
- An A/B over a handful of cells, compared on the metrics this spec already records.

**Out (explicitly):**
- Shipping Tatoeba sentences verbatim as exercises (recognition-style; off-thesis).
- COERLL / LORO ingestion (CC-BY-**NC-SA** blocks the commercial tier + copyleft conflicts with the
  proprietary pool — reference material only).
- `vocab_recall` (constrained at the word level; lexical/sentence seeds fight its dedup — same
  reasoning as R5's `buildSeedWords` gate).
- Any change to the validator or the CEFR spine.

## 3. Design — the `sentenceSeed` extension

Smallest change that reuses the R5 seam end to end.

1. **`GenerationSpec`** (`packages/ai/src/generate.ts`): add
   `sentenceSeeds?: readonly (string | null)[]` alongside the existing
   `seedWords?: readonly (string | null)[]`. Same per-ordinal shape, same `null` = unseeded.
2. **`buildGenerationUserPrompt`** (`packages/ai/src/generation-prompts.ts`): when the ordinal's
   `sentenceSeed` is non-null, append a loose instruction — *"Adapt this attested sentence into the
   exercise (keep it natural; you may trim/retarget it to drill {{grammarPointName}}; do not copy it
   verbatim if it doesn't fit): «…»"*. Mutually exclusive with the word-seed line per ordinal
   (one seed kind at a time). System prompt stays byte-identical → cache prefix still hits (guard
   this in the prompt test, as R5 did).
3. **Seed source** (`packages/db/src/generation/seed-picker.ts` or a sibling
   `sentence-seed-picker.ts`): `pickSentenceSeeds({language, cefrLevel, batchSeed, count, exclude})`
   → deterministic per-ordinal pick from the bundled Tatoeba subset (§4), filtered to the band that
   `cefrRankWindow` implies and excluding sentences already used in the cell (reuse the
   `content_json.seedWord` precedent — persist `content_json.sentenceSeedId`).
4. **Wiring** (`run-one-cell.ts`): mirror `buildSeedWords` — only cloze/translation cells get
   sentence seeds; vocab does not. Add `seedKind: 'word' | 'sentence' | 'none'` to the per-ordinal
   Langfuse trace context (extends the R5.7 `seedWord`/`seedRank` metadata) so the two arms cohort
   cleanly in Langfuse.
5. **Persistence** (`validate-and-insert.ts`): write the writer-only `sentenceSeedId` next to
   `_dedupKey` / `seedWord`, for the cross-run exclude set + post-hoc analysis.

> The A/B is selected by which picker `run-one-cell` calls for the cell — no prompt-version bump,
> no schema migration (JSONB fields are additive).

## 4. Tatoeba subset (ingestion + filter)

- **Source:** Tatoeba weekly export (`sentences.csv`, `links.csv`, `tags.csv`,
  `sentences_with_audio.csv`). License **CC-BY 2.0 FR** — attribution required, commercial OK, no
  share-alike. Ship an `ATTRIBUTION.md` / about-page credit; we transform rather than serve verbatim,
  so the burden is light.
- **Build step:** a `packages/ai/scripts/build-tatoeba.ts` (mirrors `build-frequency.ts`) that emits
  a compact per-language file (`tatoeba.<lang>.json`) of vetted candidate sentences. Filters:
  - language ∈ {en, es, de, tr}; length 4–14 tokens (drillable, not run-ons);
  - drop sentences with rare proper nouns / URLs / numerals-heavy;
  - prefer sentences whose content words sit in our frequency band for the level (reuse
    `frequencyBand`/`lookup`) → gives a cheap level proxy without a per-sentence classifier;
  - for **translation** arm: keep only sentences with an en↔target link (the human reference
    translation is the payoff).
- **Size:** cap per language (e.g. ≤ 20–50k after filtering) so it bundles like the frequency dict.
- **TR caveat:** Turkish coverage is thinner and noisier. Build the TR file, eyeball 50 sampled
  sentences for naturalness **before** including TR in the A/B. If they're poor, TR is out of this
  experiment (and the answer for TR is "no").

## 5. Eval method

Generation quality is captured by the **validator verdicts**, not the eval-prompt tooling, so the
A/B compares `generation_jobs` aggregates between two arms over the same cells.

- **Arms:** for a fixed set of ~6 cells (ES + DE cloze where quality is already decent; add a
  translation cell), generate two batches with identical `(count, batchSeed)`:
  - **A — word-seeded** (current R5 baseline),
  - **B — sentence-seeded** (this proposal).
- **Primary metrics** (per arm, summed across cells), all already recorded:
  - validator pass rate = `(approved + flagged) / producedCount`;
  - `rejectionReasonCounts` distribution — watch `context spoils answer`, `ambiguous`,
    `grammarPointMatch=false`;
  - `dedupGivenUpCount`;
  - `costUsdEstimate` per kept exercise.
- **Secondary:** blind human naturalness rating on 30 sampled stems per arm (1–5), graded without
  knowing the arm.
- **Cohorting:** filter Langfuse traces by the new `seedKind` tag; the per-job rows already carry
  the counts (`infra/lambda/src/generation/log.ts` `summarizeResult`).
- **Translation sub-arm (simpler):** build a translation exercise directly from a Tatoeba
  source↔reference pair (skip generating `referenceTranslation`); measure whether the human
  reference improves the *evaluator's* grounding on a held-out answer set via `pnpm eval`.

### Success / kill criteria

- **Adopt** if B lifts validator pass rate by **≥ 5 pts absolute** OR cuts
  `contextSpoilsAnswer + ambiguous` share by **≥ 25% relative**, at ≤ baseline cost, with naturalness
  not worse.
- **Kill** if deltas are within noise, cost rises materially, or the bundled-data maintenance
  outweighs the gain.
- **TR** judged separately on its own subset quality.

## 6. Effort / cost

- Build step + bundled subset: ~½ day.
- `sentenceSeeds` plumbing (5 touch points above, all mirroring R5): ~½ day.
- A/B run + analysis: a few hours (the pipeline + metrics already exist).
- Generation spend for the A/B: small (single-digit dollars at these cell counts).

## 7. Risks

- **Moat check:** we can already generate infinite content; this is only worth it if it raises
  quality-per-dollar. Frame strictly as a quality experiment, not content acquisition.
- **TR — our problem child — is where Tatoeba is weakest.** The resource helps most where we need it
  least (EN/ES). Don't assume it rescues TR; gate TR on the §4 spot-check.
- **Level drift:** the frequency-band proxy is coarse; a sentence can sit above level on grammar even
  if its words are in-band. Mitigated by the generator adapting + the existing `levelMatch` veto.
- **Attribution hygiene:** track the corpus + license in `ATTRIBUTION.md`; prefer transform over
  verbatim. No data-leak concern feeding third-party text to the Claude API (no training on API data).
