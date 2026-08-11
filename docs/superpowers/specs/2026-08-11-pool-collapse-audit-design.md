# Pool collapse audit — measure the failure instead of re-authoring specs

**Date:** 2026-08-11
**Status:** Approved (design); pending implementation plan
**Scope:** One read-only CLI (`pnpm audit:collapse`), two pure modules in `packages/ai/src`,
one committed ledger in `packages/db/src/curriculum`. No schema change, no migration, no
runtime path, no `CURRICULUM_VERSION` bump, no Langfuse push.

## Goal

Turn "a grammar point's declared config doesn't cover its real variation" from something
discovered by a learner (or by a hand-run SQL audit, months later) into a standing,
repeatable measurement that names the cell, the missing dimension, and the mechanism that
fixes it.

## The problem

Coverage gaps keep recurring despite three rounds of authoring discipline:

- **PR #588** (`tr-a1-imperative`) — shipped spec-less; pool converged to 100% affirmative,
  ~95% bare-stem 2sg. Found by the author practicing, weeks after the pool filled.
- **PR #631** (construction variants) — a sweep over the approved pool found **49 distinct
  points** collapsed onto one exemplar. `de-b1-um-zu-damit` was 49/50 `damit`, on a point
  whose entire content is the `um…zu` / `damit` contrast.

The failure is **distributional**: invisible at the per-item level, so neither the generator
(one draft at a time) nor the validator (one draft against the spec) can see it. This is
already the diagnosis in `docs/pool-coverage-controller.md`; its "Phase 3 — unsupervised
discovery" is the unbuilt piece, and this design is that phase, scoped down.

### Why "walk the points without a spec" is the wrong trigger

The intuitive fix — periodically enumerate spec-less grammar points and have Claude author a
spec for each — fails on both ends:

- **False positives.** ~180 of 312 grammar points correctly have no spec.
  `docs/curriculum-authoring.md` lists whole categories where "no" is the right answer
  (connectors, `ser`/`estar`, lexical points, word order). A description-driven walk
  re-proposes for them forever.
- **False negatives, which is worse.** #631's points were not spec-less. Several *had* a
  satisfied `coverageSpec` and still collapsed, because the closed `CoverageAxis` vocabulary
  (`person | number | case | wordClass | polarity | sentenceType | comparison`) cannot express
  `um…zu` vs `damit`. A satisfied spec is false reassurance. What actually found those 49
  points was a **pool sweep**, not a re-reading of descriptions.

So the trigger is evidence of collapse in the approved pool, and the LLM's job is triage —
not authoring.

## Design

### Shape

One CLI in the family of `qa:sample` / `revalidate:cloze` / `dedup:sc-pool`: author-run
against prod `DATABASE_URL`, **read-only**, writes JSON + markdown to `./audit-runs/`.
A spotlight, not a gate.

| Unit | Home | Responsibility |
|---|---|---|
| `collapse-metrics.ts` | `packages/ai/src` | **Pure.** Cell's approved rows + the point's declared config → the three signal scores. No I/O; declared config is injected, so `ai` never imports `db`. |
| `collapse-triage.ts` | `packages/ai/src` | In-repo prompt + forced tool + pure parser, plus one `triageCell()` call. Mirrors `coverage-spec-proposal.ts`. |
| `collapse-dismissals.ts` | `packages/db/src/curriculum` | Committed ledger of "this concentration is correct" judgements. Lives with the curriculum because that is what it describes. |
| `audit-collapse.ts` | `packages/ai/scripts` | SQL, orchestration, cost guard, report rendering. The only unit touching both `db` and Anthropic. |

The metrics being pure and the ledger injected is what makes a future scheduled-Lambda
wrapper a thin entrypoint rather than a rewrite. That wrapper is **not** in v1 — see Rollout.

### Signal 1 — answer-surface collapse (spec-agnostic)

Groups on the cell `(grammar_point_key, type, language, difficulty)` over
`review_status IN ('auto-approved','manual-approved')`.

| Type | Surface field | Metric |
|---|---|---|
| `cloze` | `content_json->>'correctAnswer'` | top **answer-head** share (lowercase, strip punctuation, first token) |
| `translation` | `content_json->>'referenceTranslation'` | top **leading-bigram** share |
| `conjugation` | `content_json->>'lemma'` | top **lemma** share — the collapse `conjugationSeedWords` exists to fix |
| `sentence_construction` | `content_json->>'prompt'` | top **leading-bigram** share (free production: the task framing is what collapses) |

Flagged at **≥15 approved rows and ≥65% top share** — the #631 thresholds, overridable via
`--min-rows` / `--threshold`.

This is the signal that catches a declared spec which doesn't cover the real variation,
precisely because it never consults the spec.

`cloze` and `translation` are the proven half — that exact metric produced #631's 53-row
sweep. `conjugation` and `sentence_construction` are an **extension**: same metric family,
but the per-type surface choice is new and unvalidated, so their findings are reported with
that caveat until a run confirms the normalization behaves. `sentence_construction` in
particular has its own over-flagging history (#606/#607), and `conjugation` is known to
collapse on lexical head *despite* satisfied person floors.

### Signal 2 — declared-but-unrealized (deterministic, no LLM)

For the 131 points with a `coverageSpec` and 31 with `constructionVariants`, the declared
floor *is* ground truth, so there are no false positives and nothing to triage.

- **`coverageSpec` floors.** Group approved rows by `coverage_tags->>axis`; report every
  declared value under its floor. Severity keys on **whether the cell is at target**: a cell
  below target self-heals once generation resumes; a cell *at* target with unmet floors is
  stuck and needs a demote. That is the retrofit trap documented in
  `docs/curriculum-authoring.md` ("the bump clears suppression, but an at-target cell has no
  deficit"), promoted from a thing you must remember into a measured quantity.
- **`constructionVariants` skew.** Group on `content_json->>'seedWord'` against the declared
  ids; report variants over their `share` quota, variants under `MIN_PER_VARIANT` (4), and
  the count of rows whose `seedWord` is **null or unrecognized**. That last number is the
  unbackfilled-legacy-row hazard #631's rollout documented at length and which nothing
  currently measures.

### Signal 3 — stem/topic monotony

Top **content-lemma share** across a cell's stems (`sentence` / source prompt), reusing
`tokenize.ts` + `normalizeWord` with a stopword drop. No embeddings — the "new restaurant
downtown has the best paella" cluster (~15 of 50 rows on `es-b1-impersonal-plural`) shows up
as one lemma dominating.

This is the weakest signal and is known to be partly superseded: #617 shipped systemic topic
steering, so some of it may already be self-correcting. It ships with a deliberately loose
threshold, in its own report section, and the first run's job is calibration. If the blunt
lemma-share proves useless, clustering is a v2 and must not hold up signals 1–3.

### Triage

One Anthropic call per cell flagged by signal 1 or signal 3 and not dismissed. Sonnet, forced
tool, **in-repo prompt — not Langfuse-registered** (a dev-time authoring aid, same posture as
`coverage-spec-proposal.ts` and `propose:book-coverage`). Version constant
`COLLAPSE_TRIAGE_PROMPT_VERSION`, bumped on prompt edits.

Input: the point's full curriculum text (`description`, `examplesPositive`,
`examplesNegative`, `commonErrors`), its declared config, the exercise type, and the observed
distribution (top 8 surfaces with counts, N approved, resolved target).

Output:

```ts
verdict: 'collapsed' | 'legitimate-concentration' | 'metric-artifact'
mechanism?: 'coverage-spec' | 'construction-variants' | 'seed-pool'
axis?: CoverageAxis              // only when mechanism === 'coverage-spec'
missingConstructions?: string[]  // short labels, when mechanism === 'construction-variants'
rationale: string                // one line
confidence: 'high' | 'medium' | 'low'
```

**`mechanism` is the load-bearing field.** A triage that could only recommend a coverage axis
would have misfiled every #631 case, because no axis in the closed vocabulary can express
`um…zu` vs `damit`. `'seed-pool'` covers the conjugation-lemma collapse, whose fix is
`conjugationSeedWords` — not a spec at all.

Three prompt rules, each from a documented failure:

1. The point's own text decides whether a value is claimed content — the
   *claimed / collapse-prone / form-relevant* test from `docs/curriculum-authoring.md`.
2. Legitimate concentration is common; **default to it under uncertainty.** The prompt names
   the false-positive classes explicitly: points where one answer *is* the point
   (`es-a2-personal-a`), and contrast points where the other member is the distractor rather
   than an answer (`es-b1-ser-location-events`, 94% `ser` and correct).
3. Never recommend an axis that a declared `constructionVariants` entry already hard-codes.
   That collision produced a self-contradictory affirmative/negative `MUST` pair on
   `es-b1-imperative-negative-pronouns` (fixed at `50a24a49`).

**Signal 2 pre-empts triage.** When a cell already declares a mechanism the pool has not
realized, that *is* the finding — no LLM call, no ambiguous verdict. Today this is the common
case, so it is also the main cost control.

Cost is roughly $0.01/cell (~$0.50 for a 50-cell run), under a `--max-cost-usd` guard.

### Dismissals ledger

```ts
export type CollapseDismissal = Readonly<{
  grammarPointKey: string;
  type: ExerciseType;
  /** Dominant surface this covers. null = dismiss the cell whatever dominates. */
  surface: string | null;
  signal: 'answer-surface' | 'stem-monotony';
  reason: string;
  dismissedOn: string; // ISO date
}>;
```

Keyed on **point + type + surface**, not on the cell. This is deliberate: dismissing
`es-a2-personal-a` for dominant surface `a` must not silently mask a *different* collapse on
that same cell later. Seeded from #631's metric-false-positive set (`es-a2-personal-a`,
`es-a2-hace-ago`, `tr-a2-enumerator-tane`, `es-b1-adjective-de-infinitive`,
`es-b1-ser-location-events`).

Cost per run decays toward zero as the ledger saturates, and the file becomes the durable
record `docs/curriculum-authoring.md` already asks for ("Record the no").

`curriculum.test.ts` gains a test that every dismissal's `grammarPointKey` resolves, its
`type` is compatible with the point, and there are no duplicate keys — the book-coverage
ledger pattern.

### Report

`./audit-runs/<name>.json` (machine) + `<name>.md` (read). Interesting runs get committed to
`docs/analysis/`, matching the existing `generation-run-*.md` habit.

1. **Summary** — cells scanned / flagged / confirmed / dismissed-by-ledger /
   dismissed-by-LLM; cost.
2. **Confirmed collapsed** — ranked by severity. Each entry names the cell, N/target, top
   surface + share, mechanism, one-line rationale, and the next action
   (`author coverageSpec.person` / `author constructionVariants` / `add conjugationSeedWords`).
   When the cell is at target it carries **"demote required — will not self-heal."**
3. **Declared-but-unrealized** — deterministic; split *below target* (self-heals on resume)
   vs *at target* (stuck).
4. **Stem monotony** — separate section, calibration-phase, cannot drown the rest.
5. **Dismissed** — by ledger and by LLM, each with rationale, so the report is auditable
   rather than a filtered view that has to be trusted.

CLI filters: `--language`, `--cefr`, `--type`, `--grammar-point`, `--limit`, `--min-rows`,
`--threshold`, `--max-cost-usd`, `--dry-run` (sweep only, no triage calls).

## Verification

**Unit tests** on `collapse-metrics.ts` against fixture rows: answer-head / leading-bigram /
lemma extraction, share arithmetic, the min-rows gate, `coverageSpec` floor shortfall, variant
quota and null-`seedWord` count, monotony lemma share, stopword handling.

**Parser tests** on the triage tool output, mirroring `parseCoverageSpecProposal`: illegal
verdict, `axis` present when `mechanism !== 'coverage-spec'`, unknown axis, missing rationale.

**Dismissal-matching tests**: same point + type but a *different* dominant surface must not be
dismissed.

**Acceptance test — a live prod run that rediscovers #631.** The timing is unusually clean:
#631 merged inert, the pool repass was never run, and nightly generation is paused, so today's
prod pool still holds 49/50 `dicen que` on `es-b1-impersonal-plural` with `seedWord` null
against five declared variants. The run must:

- surface all 31 variant-bearing points under signal 2 (declared, unrealized, null `seedWord`);
- flag `de-b1-um-zu-damit`, `tr-a2-adversative-connectors`, `tr-a2-causal-connectors`;
- dismiss `es-a2-personal-a` and `es-b1-ser-location-events`.

If it cannot rediscover the thing it exists to find, it does not ship.

## Rollout

Read-only CLI. No schema change, no migration, no `CURRICULUM_VERSION` bump, no Langfuse push,
no runtime path — nothing to pause or roll back.

The first prod run is the calibration run: tune the monotony threshold, seed the dismissals
ledger from what the LLM dismisses, commit the report to `docs/analysis/`.

It pays for itself immediately and independently of generation ever resuming: **it produces
the #631 repass worklist** — 31 points with variants declared, pool unrepassed, currently an
outstanding manual task with no inventory.

## Out of scope

- **Authoring proposals.** `propose:coverage-spec` already covers that half; this design
  deliberately stops at the finding. Revisit once the report shows how often the authoring
  step is actually the bottleneck.
- **A `propose:construction-variants` CLI** (already noted as future work in the #631 design).
- **Scheduled-Lambda wrapper.** The pool is static while generation is paused, so a nightly
  run would report the same thing every night. Revisit when generation resumes and there is
  real drift to catch; the pure-module split keeps that cheap.
- **Embedding / clustering-based monotony detection** — v2 only if the lemma-share metric
  proves too blunt.
- Auto-opened PRs against the curriculum, and any DB-overlay storage of specs.

## Related

- `docs/pool-coverage-controller.md` — mechanism design; this is its "Phase 3, scoped down"
- `docs/curriculum-authoring.md` — the coverageSpec checklist and the retrofit trap
- `docs/superpowers/specs/2026-08-08-construction-variants-design.md` — #631
- `docs/pool-diversity-audit.md` — the 2026-06-13 manual audit this automates
- `packages/shared/src/coverage.ts` — the closed axis/value vocabulary
- `packages/ai/src/coverage-spec-proposal.ts` — the module shape this mirrors
