# Exercise Generation Quality — Findings & Proposed Improvements

Analysis of the exercise-generation pipeline's reject/quality behavior, the
root causes behind it, and proposed fixes. Written from an investigation of the
**2026-05-24 production scheduled run** plus a design discussion that followed.

- **Date:** 2026-05-25
- **Scope:** background generation pipeline — `infra/lambda/src/generation/`,
  `packages/db/src/generation/`, `packages/ai/src/{generate,validate,generation-prompts}.ts`,
  `packages/ai/src/frequency/`.
- **Status of fixes:** all proposed unless noted. Rejection-reason persistence
  has **landed** (PR #187, `generation_jobs.rejection_reason_counts`, migration 0012).

> How to reproduce the data below: rejection **counts** live in
> `generation_jobs` (per cell: `approved/flagged/rejected/dedup_given_up`).
> Rejection **reasons** were not persisted at the time of this run, so the
> per-reason breakdown was reconstructed from **Langfuse** `validate` GENERATION
> observations (`output` = the validator `ValidationResult`) over the run window.
> Going forward, `generation_jobs.rejection_reason_counts` records this directly.

---

## The run at a glance (2026-05-24, scheduled, 04:01–04:19 UTC)

| Metric | Value |
|---|---|
| Cells processed | 37 (36 succeeded, 1 failed) |
| Requested / drafts produced | 573 / 1,244 |
| Inserted (kept) | 194 (148 auto-approved + 46 flagged) |
| **Rejected** | **378** (≈70% of produced wasted) |
| — dedup-given-up (saturation) | 202 (53% of rejections) |
| — quality vetoes | 176 (47% of rejections) |
| Cost | $16.94 (~$0.087 per kept exercise) |

**LLM-side rejection reasons** (per validator call, 1,277 calls):

| Reason | Times fired |
|---|---|
| `low quality score (<0.5)` | 175 |
| `context spoils answer` | 168 |
| `cultural issues` | 0 |

**High flag-drivers** (route to `flagged`, not `rejected`, but signal quality):
`ambiguous` 220×, `grammarPointMatch=false` 174× (14% — exercise doesn't test
the target grammar), `low quality (<0.7)` 235×. 40% of all calls scored below
the 0.7 approve floor.

**Concentration:** Turkish cloze is the epicenter — 119 of 176 quality vetoes +
131 of 202 dedup rejections. Effectively-broken cells (~0% approval):
`tr-a2-ablative-dative` (1/41), `tr-a1-translation-vowel-harmony` (0/22),
`es-b1-environment-vocab` (0/28).

---

## Issue 1 — Rejections are two different problems wearing one number

- **Symptom:** 378 "rejected" looks like a quality crisis.
- **Cause:** the count conflates **dedup-given-up** (202 — the cell is
  saturated; the generator keeps re-proposing surfaces that already exist and
  all 3 retry slots collide) with genuine **quality vetoes** (176). These need
  opposite fixes. Dedup-given-up is *not* a quality signal.
- **Solution:** always split the two when reporting. `rejection_reason_counts`
  (PR #187) now lets us do this directly instead of subtracting
  `dedup_given_up_count` from `rejected_count`.

---

## Issue 2 — Cell saturation: `TARGET_PER_CELL = 50` is unreachable for narrow cells

- **Symptom:** 202 dedup-given-up rejections, concentrated in TR translation
  cells that are already near-full (`tr-a1-plural-suffix` 47 live,
  `tr-a2-dili-past` 49, `tr-a1-vowel-harmony` 43) yet still got dozens more
  requested — producing almost pure dedup waste and burning cost.
- **Cause:** `decideEnqueue` (`scheduler-decision.ts:29`) targets **50 approved
  per cell**. A narrow A1/A2 grammar point has fewer than 50 *distinct* natural
  exercises, so the target is unattainable. Worse, saturated-dedup suppression
  (`scheduler-decision.ts:149`) is **reactive** — it only fires on the *next*
  tick after a wasteful run, so every near-full cell burns one expensive
  retry-heavy run before being suppressed.
- **Solution:**
  - Make `TARGET_PER_CELL` **per-cell** (narrow A1/A2 points target ~15–20).
  - Make saturation suppression **predictive**: skip / sharply reduce `need`
    when the live pool already approaches a realistic ceiling, instead of
    waiting for a bad run.
  - Consider a **within-run early-bail**: if dedup collisions dominate the first
    N ordinals, stop generating for that cell.

---

## Issue 3 — `context spoils answer` (168×): the answer is leaked into the visible text

- **Symptom:** joint-top rejection reason; flagged free-text repeatedly cites it
  (*"the noun 'kahve' is already visible in the parenthetical hint adjacent to
  the blank"*, *"the possessor 'annemin' is already correctly inflected"*).
- **Cause:** the generator places the answer (or a strong cue) inside the
  visible sentence / hint. Partly a generation-prompt-instruction gap; for
  Turkish it is also a **format** artifact (see Issue 7).
- **Solution:** strengthen the anti-leak rule in the generation system prompt
  (`generation-prompts.ts`) with explicit negative examples; bump
  `GENERATION_PROMPT_VERSION` and push via `pnpm push-prompts`. For Turkish,
  the whole-word-blank format change (Issue 7) removes the dominant leak vector
  (the displayed stem revealing a mutation).

---

## Issue 4 — Broadly mediocre output & off-target exercises

- **Symptom:** `low quality (<0.5)` 175× (rejections); 40% of calls below the
  0.7 approve floor; `ambiguous` 220×; `grammarPointMatch=false` 174×.
- **Cause:** `ambiguous` blanks (multiple valid fillers) and exercises that
  drift off the intended grammar point. Some cells (`tr-a2-ablative-dative`,
  `es-b1-environment-vocab`) approve ~0% — likely a bad grammar-point spec /
  curriculum prompt, not generic drift.
- **Solution:** anti-ambiguity + stay-on-target instructions in the generation
  prompt; investigate the ~0%-approval cells individually (their curriculum
  entry, not just the shared prompt).

---

## Issue 5 — A single malformed validator response fails the whole cell closed

- **Symptom:** the 1 failed job (`tr-a1-cloze-personal-suffixes`) died with
  `Invalid flaggedReasons: must be an array, got undefined`, discarding *all*
  drafts for that cell.
- **Cause:** the validator returned a tool call omitting a required field; the
  parser threw and the cell failed closed.
- **Solution:** harden validator parsing — treat a missing/invalid
  `flaggedReasons` as `[]` (or reject just that one draft) rather than nuking
  the cell.

---

## Issue 6 — Observability gap on rejection reasons *(largely resolved)*

- **Symptom:** at the time of the run, the most basic operational question —
  "why are we rejecting so much?" — required an ad-hoc Langfuse pull, because
  rejected drafts are never stored and `runOneCell` logged only aggregate
  counts. The **deterministic Turkish harmony** reject path is invisible even in
  Langfuse (it runs *after* the LLM verdict).
- **Cause:** rejected drafts are discarded; only counts persisted.
- **Solution / status:** **landed** — `generation_jobs.rejection_reason_counts`
  (PR #187, migration 0012). This is also the measurement instrument for the
  proposals below: A/B a change and watch whether `dedup-given-up` /
  `ambiguous` / `context spoils` move in the right direction.

---

## Issue 7 — Turkish cloze **format** manufactures the top quality rejections

This is the deepest finding: `ambiguous`, `context spoils answer`, and the
buffer-`y` / consonant-softening flag notes are largely **artifacts of the
cloze format itself**, not just prompt wording. Two sub-issues:

### 7a. Partial-word (suffix-only) blanks break on Turkish morphophonology

- **Symptom:** blanks are mostly suffix-only (`market___` → `e`, `iş___` →
  `ten`). The format is also **inconsistent** — one real row shows
  `…fırın___ ekmek aldım.` with answer `fırından` (stem shown *and*
  whole-word answer → would render `fırınfırından`).
- **Cause:** Turkish morphology lives at the **stem–suffix boundary**, so you
  cannot cleanly separate "stem (shown)" from "suffix (blank)":
  - Consonant softening: `kitap`+acc → `kitabı` (p→b), `köpek`+dat → `köpeğe`
    (k→ğ). Showing the citation stem makes the correct fill wrong (`kitapı`);
    showing the mutated stem (`köpeğ___`) reveals the hard part.
  - Buffer consonants: `kahve`+acc → `kahveyi` — is the blank `i` or `yi`?
  - Suffix stacking (`ev+ler+imiz+den`) makes partial blanks hopeless.
  - Evidence the team is already band-aiding this: the dedicated
    **"Buffer-consonant ambiguity"** rule at `generation-prompts.ts:176`.
- **Solution:** **blank the whole inflected word**, keep the lemma hint
  (`Annem her sabah ___ içiyor. (kahve)` → type `kahveyi`). The answer becomes
  one well-defined surface; it exercises the full real-use operation (case +
  harmony + buffer + softening); the displayed stem can't leak the mutation;
  the deterministic harmony checker + evaluator get a complete form. **Make this
  a universal rule for all languages, not Turkish-specific** — the boundary/stem
  mutation that breaks partial blanks bites every inflecting language: Spanish
  stem-changing & irregular verbs (`volver→vuelven`, `tener→tengo`,
  `buscar→busqué`) and German ablaut/umlaut (`fahren→fährt`, `Apfel→Äpfel`); a
  partial stem also leaks whether a word is irregular, and mixing partial
  (regulars) with whole-word (irregulars) blanks in one cell leaks regularity.
  Production data confirms ES (avg answer length 7.3) and DE **already** use
  whole-word blanks — **Turkish is the lone outlier** (40% of TR cloze answers
  are ≤3-char bare suffixes). So codify whole-word as the universal generation-
  prompt rule: it changes Turkish and locks-in/guards ES/DE against regression.
  Enforced in the generation prompt, not the schema. Accept that the learner now
  also produces the stem; the lemma is given and the evaluator does partial
  credit / error attribution.

### 7b. Instructions naming the case give away the selection decision

- **Symptom:** "Fill in the blank with the correct **accusative** form…" tells
  the learner the case.
- **Cause:** two separable skills are conflated — **case selection** (which case
  does the context need? — the harder, transferable, intermediate-plateau
  skill) vs **form production** (apply the allomorph). Naming the case removes
  selection.
- **Solution:** use a generic instruction ("the correct form of the word in
  parentheses") and let the **context force the case**. The `ablative-dative`
  cell already models this well (generic "correct case suffix" + motion verbs:
  `pazardan`→ablative, `eve`→dative). Wrinkle: Turkish **accusative** marks
  *definiteness*, which is subtle to force in a short sentence — so removing the
  cue requires unambiguous context or you create new `ambiguous` rejections.
  - **L1 (English) gloss** is a good disambiguation device: it pins definiteness
    for accusative (`the coffee` vs `coffee`) and maps to case for spatial cases
    (`to`/`at`/`from`), forcing meaning→case mapping while giving the evaluator
    an unambiguous target. Consider **level-gating** (gloss at A1–A2, L2-only
    context at B1+). Pure-L2 richer context is better for immersion but harder
    to generate unambiguously.

**Why this matters most:** fixing the format attacks the dominant rejection
reasons *at the source*, upstream of validator tuning or diversity seeding.

---

## Issue 8 — LLM mode-collapse on sampling → seed the generator with our own vocabulary

- **Symptom:** heavy cloze/translation duplication (the dedup-given-up half).
- **Cause:** LLMs are poor random samplers — asked for N diverse items they
  cluster on prototypical, high-frequency sentences. Current diversity signals
  are weak or dead: `priorPoolSurfaces` is a *negative* "avoid these" list and
  exists for **vocab_recall only**; `recentStems` is **dead code** (passed as
  `[]` since generation went parallel). Cloze/translation get **no** lexical
  seeding.
- **Solution:** we do the sampling, not the LLM. We already ship a **42k-entry
  frequency dictionary per language** (`packages/ai/src/frequency/{es,de,tr}.json`,
  `{lemma, rank, cefr?}`) + stopword lists + a `loadFrequency()` API.
  - Assign a **different content word per ordinal**, drawn *deterministically*
    from the cell's CEFR frequency band, excluding stopwords and words already
    in the cell. Different anchor → different sentence → different `_dedupKey`.
  - Inject the seed in the **per-draft user prompt** (`buildGenerationUserPrompt`),
    **not** the cached system prompt, to preserve prompt caching.
  - Seed **loosely** ("build around X; if it doesn't fit the grammar point
    naturally, pick a related content word of similar frequency") to avoid
    trading dedup rejections for quality rejections.
  - **Caveat:** the frequency list has **no POS tags** and `cefr` is
    unpopulated. Grammar-point cells need grammar-compatible anchors (a tense
    point wants a verb; ablative-dative wants a place noun). MVP: stopword
    filter + **rank-window banding** as a CEFR proxy + loose seeding. Later:
    enrich the source with POS/CEFR, or curate per-grammar-point seed pools.
  - **Targets duplication, not quality** — complementary to Issues 2, 3, 7.
  - Synergy: aligns generation with the planned **vocabulary frequency
    coverage** progress feature.

---

## Issue 9 — `vocab_recall` dedup is one-exercise-per-word (too restrictive)

- **Symptom:** a word can appear in only one vocab_recall exercise per cell.
- **Cause:** the dedup key for vocab_recall is the `expectedWord` itself
  (`canonicalSurface` → `content.expectedWord`), enforced by the per-cell
  `exercises_dedup_idx`. Combined with the fact that **SM-2 spaced repetition is
  not implemented** (the `spacedRepetitionCards` table exists but is unused;
  sessions draw `ORDER BY random()`), a learner effectively sees each vocab word
  **once, ever** — no repetition and no varied-context exposure, which good
  vocabulary acquisition requires. (The code even anticipates multiplicity:
  `ITEM_COUNT_BY_TYPE.vocab_recall = 6`, "a 6-card spaced set".)
- **Solution — "Option A" (agreed, implementation pending):** allow **≤ N
  exercises per word** per cell (N≈3–4) instead of ≤1. Mechanically: dedup key
  becomes `(word, cueDiscriminator)` **plus a per-word count cap** (so context
  variation can't collapse vocabulary breadth). If keying on context, key on the
  **retrieval cue (`prompt`)**, not `exampleSentence` — the example sentence
  doesn't change the recall task (it's only hint level 3). Bonus: grows the
  surface space, relieving vocab_recall dedup saturation.
- **Notes:**
  - Pool depth (a few varied cues) and SM-2 (re-exposure timing) solve
    *different halves* of repetition; they're complementary.
  - If the goal is "see the word in many contexts," **cloze/translation already
    do that** as a side effect. `vocab_recall` is the produce-from-a-cue drill,
    so a modest cap is enough — don't make it the vehicle for breadth-of-context.

---

## How dedup actually works (reference)

- Enforced by a **partial `UNIQUE` index** `exercises_dedup_idx` on
  `(language, type, difficulty, grammarPointKey, content_json->>'_dedupKey')`,
  over `reviewStatus IN ('auto-approved','manual-approved','flagged')`. Insert
  uses `onConflictDoNothing()`; a collision is the no-op that drives the retry
  loop and, after 3 collisions, `dedup-given-up`.
- `_dedupKey = canonicalSurface(content)` (`generation-prompts.ts:274`), keyed
  on **one field per type**: cloze → `sentence`, translation → `sourceText`,
  vocab_recall → `expectedWord`.
- Normalization: lowercase → NFKD → **strip diacritics** → collapse whitespace.
  So it's **surface-string** dedup (near-exact match), **not** semantic — it
  never catches paraphrases; for cloze it ignores *which* word is blanked.
- **Hypothesis worth verifying:** diacritic-stripping is **lossy for Turkish**,
  where `ç ş ğ ö ü` (and dotless `ı` via locale-naive `toLowerCase`) are
  distinct letters, not accents. Distinct Turkish surfaces can collapse to the
  same `_dedupKey` and be falsely rejected as duplicates — possibly **inflating**
  the TR dedup-given-up counts. Cheap to check by comparing pre/post-normalization
  surfaces on TR collisions.

---

## Suggested sequencing

1. **Format fixes for Turkish cloze (Issue 7)** — biggest, source-level lever on
   the dominant rejection reasons. Draft the TR-specific generation-prompt
   section (whole-word blanks + generic instructions + level-gated L1 gloss).
2. **Per-cell targets + predictive saturation suppression (Issue 2)** — kills
   most of the dedup waste and cost.
3. **Frequency-seeded generation (Issue 8)** — diversity at the source for
   cloze/translation.
4. **Option A for vocab_recall (Issue 9)** — agreed; unblocks the pedagogy.
5. **Anti-leak / anti-ambiguity prompt rules (Issues 3, 4)** and **validator
   parsing hardening (Issue 5)** — smaller, independent wins.

Measure every change against `generation_jobs.rejection_reason_counts`: success
is `dedup-given-up` and `ambiguous`/`context spoils` falling **without** a new
failure mode rising.
