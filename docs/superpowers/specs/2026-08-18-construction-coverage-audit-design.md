# Construction-coverage audit — design

**Date:** 2026-08-18
**Status:** approved design, not yet implemented
**Tool:** `pnpm audit:constructions` (new), `packages/ai`

## Problem

`es-b1-reported-speech` declares two constructions in its description. The
approved production pool generated one:

| construction | approved rows |
|---|---|
| `dijo que` + imperfect (backshift statement) | 96 / 99 |
| reported command → `que` + present subjunctive | 1 / 99 |
| reporting verb that takes no shift | 0 / 99 |

PR #664 fixed that point by hand. The question this design answers is how many
others look the same, and how to find them without reading 312 descriptions
against 20,668 rows by hand.

### Why the existing audit cannot find them

`pnpm audit:collapse` has three signals. Two are structurally inert on a point
with no declared mechanism:

- **spec shortfall** reads `coverageSpec` floors — absent by definition here
- **variant skew** reads `constructionVariants` — absent by definition here

Only **answer-surface concentration** and **stem monotony** can fire, and both
are lexical. A cell whose 45 rows all realize one construction over 45 different
nouns looks perfectly diverse to both. `es-b1-reported-speech` was caught only
incidentally, because its reporting verb sits in the *stem* (`dijo` in 90% of
stems, 44/49) — and even then it sat unjudged in the 2026-08-14 report's
93-cell "awaiting triage" backlog.

### Measured scope (prod, 2026-08-18)

| | count |
|---|---|
| `kind: 'grammar'` points | 312 |
| no `coverageSpec` | 193 |
| no spec **and** no `constructionVariants` **and** no `elicitationSeedValues` | 157 |
| of those 157, appearing anywhere in the 2026-08-14 collapse report | 60 |
| of those 157, never flagged by any signal | **97** |
| approved cloze+translation rows, all 312 points | 20,668 across 584 cells |
| approved cloze+translation rows, the 157 bare points | 10,083 across 283 cells |

Scanning the 97 unflagged descriptions by hand shows the #664 shape repeatedly:
`de-a1-plural-formation` (five plural classes), `de-b2-passive-alternatives`
(`man` / `sich lassen` / `-bar` / `sein + zu`), `tr-a2-converbs` (four
converbs), `tr-a2-correlative-conjunctions` (four pairs),
`es-a2-periphrases-obligation-aspect` (five periphrases).

`priorPoolSurfaces` does not mitigate this. It is a negative "do not repeat
these surfaces" constraint, which 96 distinct `dijo que` sentences satisfy
completely.

## Scope

**In:** all 312 `kind: 'grammar'` points, `cloze` and `translation` cells.

The audit is deliberately **spec-blind**: having a `coverageSpec` is no
protection, as PR #631 proved — `de-b1-um-zu-damit` was 49/50 `damit` on a point
whose entire content is the `um…zu` / `damit` contrast, with every declared
floor satisfied. `coverageSpec` and construction coverage are different axis
systems. This mirrors the reasoning already recorded in `collapse-metrics.ts`,
whose signal 1 is spec-agnostic for the same reason.

**Out:**

- **`sentence_construction` cells.** `constructionVariants` drives cloze and
  translation only, and SC received its own rotation mechanism in #652.
  Including SC would produce findings whose recommended fix does not exist.
- **Writing to the pool.** Read-only, like `audit:gloss`. Per-row labelling
  against *committed* variant ids is `backfill:variant-seeds`'s job, which has
  confidence gating and rollback artifacts.

## Packaging

A standalone CLI, not a fourth signal inside `audit:collapse`:

1. **Inverted cost profile.** `audit:collapse` computes all three signals with
   pure functions and spends tokens only on flagged cells, which is what makes
   its `--dry-run` free — and a free dry-run is load-bearing, since it is how a
   run gets scoped. This tool must spend a token on every point before it knows
   whether anything is wrong.
2. **`collapse-metrics.ts` is deliberately pure**, with no I/O and no `db`
   import. A signal whose *input* requires an LLM call does not fit that seam.
3. **Different report lifecycles.** The collapse report is a standing
   inventory; this one's output is a worklist that dies once the curriculum
   edits land.

**Files:**

- `packages/ai/src/construction-coverage.ts` — pure: prompts, tool schemas,
  parsers, verdict logic, sampling. No `db` import (`ai` must not import `db`).
- `packages/ai/src/construction-coverage.test.ts`
- `packages/ai/scripts/audit-constructions.ts` — CLI: the only unit touching
  both `db` and Anthropic.
- `packages/ai/scripts/audit-constructions.test.ts`
- `packages/ai/scripts/fixtures/construction-coverage-cases.json`
- `packages/db/src/curriculum/construction-dismissals.ts` — new ledger

## Pipeline

### Stage 0 — load (SQL, read-only)

Approved (`auto-approved` / `manual-approved`) `cloze` + `translation` rows for
the filtered points, grouped into cells keyed `(grammarPointKey, type)`.

Cells below `--min-rows` (default 8) are **skipped and counted**, never flagged —
a thin cell would otherwise produce a "0 realized" finding that is really just
an empty pool.

**Sampling is deterministic and spread.** Rows are ordered by a hash of
`(seed, row id)` and the first `--sample-per-cell` (default 24) are taken.
Ordering by `created_at` would be wrong: consecutive rows come from the same
generation batch and share a prompt version, so a head-of-list sample measures
one batch's habits rather than the cell's. Cells at or under the cap are read
whole.

### Stage 1 — enumerate (1 call per point)

Input: key, name, description, `examplesPositive`, `examplesNegative`,
`commonErrors`, CEFR, language. **Not** the pool — stage 1 must enumerate what
the point *claims* before seeing what was built, or it will rationalize the
existing distribution as complete, which is the exact blindness that let 96/99
look fine.

```ts
export type ClaimedConstruction = {
  /** kebab-case; reused as the proposed variant id in stage 3. */
  id: string;
  /** e.g. "reported command → que + present subjunctive" */
  label: string;
  mustRepresent: boolean;
  rationale: string;
};

export type PointEnumeration = {
  grammarPointKey: string;
  constructions: ClaimedConstruction[];
  mechanism: 'construction-variants' | 'coverage-spec' | 'none';
};
```

`mustRepresent` requires **all three**:

1. **Distinct form** — realizing it makes the learner produce a materially
   different structure, not merely a different word. `de-b1-hin-her`'s
   `hinein/herein/hinaus/heraus` is one contrast with lexical variants and
   fails; `es-b1-reported-speech`'s statement-vs-command split passes.
2. **Actually claimed** — the description or `examplesPositive` asserts it,
   rather than mentioning it in passing.
3. **Cell-realizable** — one cloze or translation item can exercise it.
   Discourse-level phenomena fail.

This mirrors the 3-part axis test already in `docs/curriculum-authoring.md` so
authors read one rule, not two similar ones.

`mechanism` separates the two fixes: `es-a1-noun-plural`'s five plural classes
are unrealized **axis values** (`coverage-spec`), while
`es-b1-reported-speech`'s two constructions are sub-constructions
(`construction-variants`). Conflating them would produce ~100 bad variant lists.

### Stage 2 — classify (batched per cell)

Runs **only** where stage 1 returned ≥2 `mustRepresent` constructions; a
single-construction point costs one call total. ~20 sampled rows per call, the
point's construction list as the cached system block (the batching shape
`backfill:variant-seeds` already uses).

Each row resolves to one construction `id`, or `none`, or `unclear`. The
classifier sees only the labels, **not** the enumerator's `rationale`, so it
classifies what a row *is* rather than what the enumerator hoped to find.

Row content shown: cloze → `sourceText` + `correctAnswer`; translation →
`sourceText` + `referenceTranslation`.

### Stage 3 — verdict (pure, no LLM)

Per cell, counts per construction id.

- **Finding:** a `mustRepresent` construction at **0**, or at **≤5%** of
  classified rows, and not covered by the dismissals ledger.

  At the default sample of 24 this means *0 or 1 row* (1/24 = 4.2% qualifies,
  2/24 = 8.3% does not). The cliff is sharp on small samples and that is
  intended — the defect being hunted is near-total absence, not mild skew.
  Mild skew on a *declared* mechanism is already `audit:collapse`'s
  variant-skew signal.
- **Judge-health gate:** if `none` + `unclear` exceeds 33% of a cell's
  classified rows, the cell reports as `enumeration-suspect` and produces **no
  finding**. The honest reading of a high `none` rate is that stage 1
  enumerated the wrong constructions, not that the pool is collapsed. Without
  this gate a bad stage-1 call manufactures a confident-looking finding out of
  every row it failed to understand.

### Stage 4 — propose (1 call per confirmed point)

Fires on confirmed findings only. Emits a paste-ready `constructionVariants`
list (ids, directives, shares) or a `coverageSpec` fragment (axis + floors),
per the point's `mechanism`. Every proposed line is annotated with its measured
realized count, so a reviewer can see it is proposing a variant the pool has 0
of.

Kept separate from stage 1 deliberately: enumerating constructions in order to
*count* them is a different job from authoring a directive a generator must
obey, and one prompt doing both would do each poorly.

## Prompts

All three live in-repo and are **not** registered in Langfuse, following
`collapse-triage` and `gloss-spoilage` — both carry a version constant but no
`bootstrap-prompts` manifest entry, because an author-run audit has no runtime
fetch path.

`CONSTRUCTION_COVERAGE_PROMPT_VERSION = 'construction-coverage@2026-08-18'`,
stamped into every report header.

**Model:** all stages default to `claude-sonnet-4-6`, matching the sibling
audits. `--enumeration-model` runs stage 1 elsewhere (e.g. Opus). Which is
correct is not guessed here — the fixture check decides it, run both ways
before the first full sweep.

## Precision controls

The precedent is a warning: the 2026-08-14 collapse run flagged **151 cells and
confirmed 0** — ~58 triaged with no confirmations, 5 ledger-dismissed, 93 never
triaged. A sweep that returns 150 unactionable rows becomes another stale
backlog.

Precision is therefore **front-loaded into stage 1** rather than left to
post-hoc triage. The structural reason: by triage time the only evidence left
is a distribution, and a distribution cannot say whether the missing thing
*mattered*. That judgment needs the description in front of it.

Three layers:

1. The `mustRepresent` 3-part test (stage 1)
2. The severity floor — 0 or ≤5% (stage 3)
3. The dismissals ledger

### Dismissals ledger

**New file**, `packages/db/src/curriculum/construction-dismissals.ts`, keyed
`(grammarPointKey, type, constructionId)` — *not* an extension of
`COLLAPSE_DISMISSALS`, which is keyed on a dominant **surface**. A dismissal
here records that a construction is legitimately rare (a reporting verb taking
no shift is genuinely uncommon in natural Spanish). Overloading `surface: null`
to mean "some construction" would make both ledgers harder to read.

Same conventions as the collapse ledger: lives beside the curriculum because it
describes a grammar point's pedagogy rather than the tool; non-empty `reason`;
`dismissedOn` ISO date shown in the report so a stale dismissal is visible
rather than silently permanent.

### Fixture check

`--check-fixture` runs hand-labelled points, 3 draws each, majority verdict,
scored as in `audit:gloss`.

**Non-contamination is mechanically enforced.** A unit test asserts the
fixture's point keys are disjoint from the keys appearing in the stage-1
prompt's few-shot examples. Building a judge's fixture from its own examples
measures memorisation, not judgment; a comment saying so is easy to violate
when someone later adds an example. Since `es-b1-reported-speech` is the
canonical illustration of the defect, it belongs in the *prompt*, and the
fixture uses different hand-labelled points.

**Acceptance test:** the tool must produce the #664 finding when run against
`es-b1-reported-speech` at its pre-#664 state, and stay silent on points known
to be fine. This gates the first full sweep.

That pre-#664 state is **not reachable from a live query** — #664 added
`constructionVariants` to the point and #665's retrofit demoted rows, so the
approved pool now reflects the fix. The acceptance case must therefore embed a
**recorded snapshot** of the rows (and the pre-#664 description, which had no
variants) in the fixture JSON, not read them from the database. A fixture that
queries live data would silently start passing for the wrong reason once the
pool changes again.

## CLI surface

`pnpm audit:constructions` — read-only, author-run. A spotlight, not a gate.

| Flag | Meaning |
|---|---|
| `--language` / `--cefr` / `--grammar-point` / `--type` | Cell filters |
| `--max-points N` | Caps **points** |
| `--min-rows` (8) | Thin cells skipped, not flagged |
| `--sample-per-cell` (24) | Per-cell sample cap |
| `--seed` | Reproducible sampling |
| `--max-cost-usd` / `--concurrency` | Standard |
| `--enumeration-model` | Stage 1 model override |
| `--out` / `--dry-run` / `--check-fixture` / `--help` | Standard |

**No `--limit` alias.** `--limit` already means *rows* in `revalidate:cloze` and
`backfill:coverage-tags`, and *cells* in `backfill:variant-seeds`. A third
meaning would deepen an existing trap.

**`--dry-run` costs nothing** — it prints points, cells, rows that would be
sampled, and an estimate, making **no** API calls. This must be stated
explicitly in the CLAUDE.md row, because that table documents the opposite for
`revalidate:cloze` and `backfill:coverage-tags`, where a dry-run costs the same
as an apply.

**Cost cap.** When `--max-cost-usd` trips, the run stops and writes a
**partial** report labelled as such, listing what went unexamined. A truncated
sweep that reads as complete turns a coverage gap invisible.

## Reporting

`./audit-runs/<name>.json` + `.md`, with prompt version and seed in the header.

1. **Summary** — points enumerated, single-construction (stage 2 skipped),
   cells classified, rows sampled, findings, `enumeration-suspect`, dismissed,
   thin-skipped, cost
2. **Findings, ranked** — 0-realized first, then by shortfall weighted by cell
   size. Each shows the cell, the missing construction, `realized 1/24
   sampled`, the cell's full distribution, and the mechanism.
3. **Proposed snippets** — separate section, paste-ready, **never written to a
   file**
4. **Enumeration-suspect cells**
5. **Dismissed** (reason + date)
6. **Skipped thin cells**

Counts always print the sample denominator (`2/24 sampled`, never a bare
`2/50`) so a sampled count is not misread as a census.

Ranking is load-bearing. With a plausible 40–80 findings and a real retrofit
tail per fix, the top of the list is what gets worked.

## Cost estimate

| Stage | Calls | Est. |
|---|---|---|
| 1 — enumerate | 312 | ~$5 |
| 2 — classify | ~11.7k rows @ ~20/batch | ~$13 |
| 4 — propose | one per confirmed finding | ~$1 |

These are **upper bounds**. Stage 2 runs only for points with ≥2
`mustRepresent` constructions, so every single-construction point drops out
after one call — the true stage-2 cost depends on how many points stage 1
judges multi-construction, which is the thing the sweep is measuring and cannot
be known in advance.

~$19 for a full sweep. A census (every row, 20,668) would be ~$30; sampling was
chosen because the extra precision is throwaway — the proposed construction ids
do not exist in the curriculum yet, and `backfill:variant-seeds` re-classifies
against the committed ids afterwards.

## What this does not do

The sweep produces a **worklist, not a fix**. Every fix still lands through the
existing retrofit path, with its recorded gotchas:

- `demote:pool --reason pool-hygiene`, never `quality` (which revokes learners'
  credit for past attempts)
- `backfill:variant-seeds` **before** demotion — legacy rows carry no
  `seedWord`, so `pickVariantSeeds` reads them as zero coverage and would
  spread new drafts evenly, making the skew worse
- at-target cells generate nothing until `demote:pool` creates headroom
- the generation change is a template edit, so `push-prompts` must run per
  environment or the merged code keeps serving the old body

## Testing

Unit tests over the pure module: sampling determinism under a fixed seed,
verdict thresholds at the 0 and 5% boundaries, the judge-health cutoff,
dismissal matching, markdown rendering, and the fixture-disjointness assertion.
Plus the `--check-fixture` mode itself.

Gate run package-by-package (`lint`, `typecheck`, `test`) — a root `pnpm test`
gets killed on this machine partway through.

## Docs

- New row in the CLAUDE.md command table, stating the free `--dry-run`
- Cross-reference from `docs/curriculum-authoring.md`, so the authoring
  checklist points at the detector for the failure it warns about
