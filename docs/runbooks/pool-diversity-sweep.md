# Runbook — sweeping a language pool for diversity collapse

How to find and fix the failure where an approved pool is individually valid but
collectively narrow: every row passes the validator, and the cell still drills
one thing.

Distilled from three complete sweeps — ES (#674–#687), TR (#688–#693), DE
(#695–#699). Read this instead of reconstructing the method from those PRs.

**Scope.** Diversity of an *approved* pool. Not exercise correctness (that is
`revalidate:cloze` and `qa:sample`), not prompt regressions (that is
`docs/runbooks/prompt-update-and-revalidate.md`).

---

## 1. First, identify which defect you have

Three distinct failures look alike in a dashboard and need different mechanisms.
Getting this wrong wastes a whole cycle — and worse, "fixing" the wrong one can
regress work another mechanism was added to do.

| # | Defect | Looks like | Mechanism that fixes it | Tool that SEES it |
|---|---|---|---|---|
| 1 | **Construction collapse** | Point claims several constructions; pool realizes one | `constructionVariants` | `audit:constructions` |
| 2 | **Coverage-spec residue** | Spec'd axes, but only some value *combinations* exist — or a value is never requested at all | demote + regenerate; or widen the spec | a `coverage_tags` query (see §1.1) |
| 3 | **Scene monotony** | Constructions all present, but every sentence is about the same little world | frequency seeding (`seedKindFor`) + demote | `audit:collapse` stem-monotony hint |

**No single tool sees all three.** `audit:constructions` measures *which
constructions appear*, so it is structurally blind to #3 — 45 rows of one
construction over 45 different nouns read as healthy, and 30 sentences all about
the weather read as healthy too. Run the `coverage_tags` query in §1.1 and, for
`sentence_construction` cells, check seed coverage; neither is implied by a clean
`audit:constructions` run.

### 1.1 Detecting #2 — the combination diagonal

For every point with a multi-axis `coverageSpec`:

```sql
SELECT grammar_point_key, type,
       coverage_tags->>'case' AS case_v, coverage_tags->>'number' AS num_v,
       count(*)
FROM exercises
WHERE language = :lang AND review_status IN ('auto-approved','manual-approved')
  AND coverage_tags IS NOT NULL
GROUP BY 1,2,3,4 ORDER BY 1,2,5 DESC;
```

Two things to look for:

- **A diagonal.** Pre-#690, `decideCoverageTargets` zipped per-axis sequences
  index-wise and could only emit `lcm(m, n)` of `m × n` combinations — for two
  2-value axes, **2 of 4**. `de-b1-relative-pronouns` sat 99 of 100 rows on
  `dative+singular` and `genitive+plural`. **The bug is fixed** (#690); pools
  generated before it still hold the residue, so the remedy is demote +
  regenerate, not a code change.
- **An undeclared value.** `orderedFloorValues` filters to values present in
  `floors`, so a value with no floor is *never requested*, before or after #690.
  `de-a2-adjective-declension-definite` declares `number: { plural: 8 }` only and
  is therefore 100% plural — its `-e` singular ending, half the paradigm, cannot
  be generated at all.

**Always check `coverage_tags` completeness before believing a zero.** An axis
reading 0 across a whole cell is often missing *tags*, not missing content — that
mistake nearly cost 169 rows once. If tagging is < ~95%, run
`backfill:coverage-tags` first and re-measure.

### 1.2 Detecting #3 — scene monotony

Cheap proxy, no API cost:

```sql
SELECT grammar_point_key,
       lower(split_part(content_json->>'_dedupKey', ' ', 1)) AS first_word,
       count(*)
FROM exercises
WHERE language = :lang AND type = 'sentence_construction'
  AND review_status IN ('auto-approved','manual-approved')
GROUP BY 1,2 ORDER BY 1, 3 DESC;
```

A top opening word above ~40% is a strong signal. Then read 20–30 rows and look
at *content*, not structure: DE's `de-a2-dass-clauses` had ~13 of 30 sentences
about the weather with `denken/glauben/sagen` as almost the only matrix verbs.

`sentence_construction` is the usual victim: before #652 an SC cell whose point
declared no `constructionVariants` had **no diversity mechanism at all** — 31 of
33 SC cells were affected. Seed coverage is the tell: query
`content_json->>'seedWord' IS NOT NULL`; a cell at 0–30% seeded is a legacy pool.

---

## 2. Phase sequence, and the two hard gates

```
1  Audit            read-only, per-CEFR chunks
2  Triage           ← most of the judgment lives here
3  Author           curriculum edits + CURRICULUM_VERSION bump
   ─────────────── GATE A: merge AND deploy ───────────────
4  Snapshot         Neon branch
5  Label            backfill:variant-seeds
6  Capture          row ids → repo → push
   ─────────────── GATE B: capture pushed ────────────────
7  Demote           demote:pool --reason pool-hygiene
8  Verify           three-way reconciliation vs the snapshot
9  Resume + confirm re-audit AFTER the refill
```

**Gate A — deploy before demoting.** The generation Lambda runs *deployed* code.
Demoting before the fix is live frees slots that refill from the old prompt and
re-freeze the collapse. This applies to every mechanism: variant lists, seeding
routes, spec changes. Verify the actual workflow run, don't assume:

```bash
gh run list --branch main --workflow "Production Deploy" --limit 3 \
  --json headSha,conclusion,displayTitle
```

**Gate B — capture before writing.** `demote:pool` writes no rollback artifact.
The committed id list is the only fine-grained record of what was demoted. Push
it off-machine *before* applying.

**A `push-prompts` step is NOT needed** for curriculum-only changes. Variant
lists and specs are data injected into the per-draft prompt from deployed code,
not a Langfuse-hosted body. Prove it from the diff (no prompt file, no
`*_PROMPT_VERSION`) rather than running it defensively.

---

## 3. Phase 1 — audit

```bash
pnpm dotenv -e <prod-env> -o -- pnpm --filter @language-drill/ai \
  audit:constructions --language DE --cefr A1 --max-cost-usd 3 --out de-a1-<date>
```

- **Run per-CEFR, and concurrently.** A single full-language sweep hung once at
  79 minutes with no output. Per-level chunks are ~25 minutes each and
  independently recoverable; all four can run at once.
- **`--dry-run` is free here** and prints a cost estimate — unlike
  `revalidate:cloze` and `backfill:coverage-tags`, where a dry-run costs the same
  as an apply. Always dry-run first to size `--max-cost-usd`, which defaults to
  **$2** and will silently truncate a real sweep.
- **The CLI logs nothing until it finishes.** To tell "working" from "hung",
  check CPU time and sockets per PID — an API-bound run shows low CPU with 1–2
  established HTTPS connections, so low CPU alone is not a hang.
- Artifacts land in `packages/ai/audit-runs/`, which is **gitignored**. Copy the
  JSONs to `docs/analysis/run-artifacts/` — re-running costs real money.

---

## 4. Phase 2 — triage (do not skip)

Roughly **a quarter of findings should be rejected.** The audit enumerates
constructions from a point's *description* and never reads its `coverageSpec`, so
acting on it uncritically regresses work the spec was added to do.

### 4.1 The rejection taxonomy

| Reject when the flagged item is… | Test | Example |
|---|---|---|
| **A classifier artifact** | Do the two labels *co-occur* in one sentence? | `verb-bracket` vs `irregular-singular` are both true of nearly every modal sentence — the forced single label just flips per cell (12/0, 0/19, 19/0) |
| **A property, not an alternative** | Is it true of *every* row already? | `gibt-invariable` held for all 12 `es gibt` rows |
| **A contrast** | Can one draft express it? | "X vs Y" needs two exercises; a single-answer item cannot |
| **Owned by an existing axis** | Does a `coverageSpec` already control that dimension? | `kein` vs `der/ein` **is** the polarity axis |
| **Not expressible as a directive** | Can a generator be *asked* for it? | a prohibition ("never use a mass noun") |

**The complementary-collapse tell.** When two cells of the same point are each
~100% on a *different* construction, suspect the classifier before the pool. Real
collapse concentrates the *same* way across cells.

**Distrust a bare `0/24`.** It is per-cell (a construction at 0 in translation
may be 18/20 in cloze) and the audit's classifier can disagree with stored
`coverage_tags`. Check both before acting.

### 4.2 The spec-collision rule

| Spec axis | vs. sub-construction variants | Action |
|---|---|---|
| `person`, `polarity`, `sentenceType` | usually orthogonal | author alongside, keep the spec |
| `case`, `number`, `comparison` | often IS the dimension | check per point |

"Usually" is doing work in row 1 — verify orthogonality rather than assuming it.
Two real counterexamples: `de-a1-articles-nominative`'s polarity axis *is*
`kein` vs `der/ein`; `de-b1-schon-noch-erst`'s polarity axis *is* `noch nicht` vs
`schon`. Both needed a different split than the obvious one.

When a spec and variants would collide, in order of preference:

1. **Split on an orthogonal dimension instead.** `de-a1-articles-nominative`
   split on the NP's *syntactic role* (subject vs predicate complement), which is
   free to vary within either polarity.
2. **`coverageSpec.appliesTo`** (#690) scopes a spec to exercise types — the fix
   when a conjugation cell needs the axis but cloze/translation are
   variant-owned.
3. **Delete the spec** and let variants own the axis — **only if the point is not
   `conjugationSuitable`**, which requires a person/case/number axis. Justify it:
   `de-b1-schon-noch-erst`'s polarity floor could demand a *negative* row but not
   say *which*, and the pool came out `noch nicht` 13 / `nicht mehr` 0 — variants
   giving each its own quota are strictly stronger.

Record rejections in `packages/db/src/curriculum/construction-dismissals.ts` so
the audit stops re-reporting them.

---

## 5. Phase 3 — authoring

`constructionVariants: [{ id, directive, share? }]`, placed after
`examplesPositive`. Write directives as **instructions to a generator**, naming
the form and giving an example — not as descriptions of a category.

Invariants that will reject the work (all enforced by `curriculum.test.ts`):

- ≥2 variants, unique kebab-case ids, non-empty directives, positive shares
- **mutually exclusive with `selfRevealingElicitation`** — both claim the single
  seed slot
- `targetOverride` must be ≥ `variants.length × MIN_PER_VARIANT` (4)

And one that is **not** in `curriculum.test.ts` and is easy to miss:

> `infra/lambda/src/routes/admin.test.ts` asserts every cell target resolves to a
> value in a **bare array literal** — `[5, 6, 8, 10, 12, 15, 16, 20, 24, 25, 30,
> 44, 48, 50, 75]`. Since a variant list raises the target to `N × 4`, **7
> variants on an A1 cell resolves to 28, which is not in the list.** Grepping for
> "allow-list" does not find it.

Cap A1 lists at 6 (target 24) rather than widening the guard, and when trimming,
drop the constructions that were **not** starved. Verify programmatically:

```ts
resolveCellTargetFor({ exerciseType, cefrLevel, grammarPoint })
```

over every point × type, asserting membership — not by spot-checking.

Bump `CURRICULUM_VERSION_<LANG>`: it is what clears `skip-low-yield` and
target-reached suppression. A prompt-version bump does **not**.

**Beware the stale-dist trap in reverse.** After editing curriculum, a green
downstream suite is not evidence until you rebuild — a stale `@language-drill/db`
dist let a bad cell target pass the lambda suite for four batches. Sequence:

```bash
pnpm build && rm -rf infra/lambda/dist && pnpm --filter @language-drill/lambda test
```

(The `rm -rf` after the build is required: `pnpm build` emits compiled
`**/*.test.js` that vitest then collects as phantom failures.)

---

## 6. Phases 4–7 — the repass

### Snapshot

Fork a Neon branch from production. Watch the **10-branch cap** — exceeding it
fails `Neon Branch & Migrate` repo-wide, because CI needs per-PR branches.
Delete old snapshots only after extracting their pre-demotion `review_status`
into `docs/analysis/`.

### Label

```bash
pnpm dotenv -e <prod-env> -o -- pnpm --filter @language-drill/db \
  backfill:variant-seeds --language DE --apply \
  --snapshot <branch-id> --name prod-de-<date> --max-cost-usd 12
```

- **A dry-run costs the same as an apply** — classification runs before the
  write gate. Budget one pass. To prove the invocation cheaply, smoke-test one
  point with `--grammar-point` (~$0.03) first; it is safe to follow with a full
  run because `isEligible` permanently skips already-labelled rows.
- **Always `--name` the run.** The artifact is the only record of each row's
  original `seedWord` (legacy rows carry a *frequency word*, not null), and
  `packages/db/backfill-runs/` is gitignored — archive it outside.
- Check the artifact reports `appliedCount == entries`; otherwise there is a
  partial-write gap.
- It writes the artifact **before** applying, so "artifact exists" is the wrong
  wait condition. Wait on process exit.

### Size the demotion

Per cell: `need = approved − target + deficit`, where `deficit` sums each
variant's shortfall against its share-weighted quota. Allocate only from variants
**above** quota, oldest row first — matching `demote:pool`'s
`ORDER BY created_at ASC LIMIT n`.

**Wait for labelling to finish.** On a cell with zero labels the deficit computes
as maximal and the demotion strips far more than intended.

Assert over the **whole plan**, not a sample:

- every group draws only from an above-quota variant, and none is pushed below it
- no cell falls under `MIN_PER_VARIANT`
- no duplicate ids; `sum(limit)` equals the captured row count

Expect many cells to report `planned < need` — the surplus is bounded by what the
classifier labelled. That is normal; record it.

### Select

Selection is a **per-cell fact, not a default.** Check which is safe:

| Situation | Use |
|---|---|
| Rows carry a declared variant id | `--content-ilike '"seedWord": "<id>"'` |
| Selection defined by `coverage_tags` | **`--ids-file`** (#699) — `--content-ilike` reads `content_json` and cannot see those columns |
| Only over-represented groups exist in the cell | bare `--limit` is safe |
| Minority rows are interleaved by age | bare `--limit` will destroy them — use a precise filter |

Two real cases, opposite conclusions: `de-b1-relative-pronouns` had minority rows
at oldest-first positions 1, 34, 47, 50, so a bare `--limit 20` would have
destroyed an irreplaceable row; the six DE SC cells had *only* over-represented
rows and every seeded row strictly newer than every unseeded one, so a bare
`--limit` was exactly right. **Verify the ordering before choosing.**

An unanchored `ILIKE` is a real hazard: include the key name and closing quote
(`"correctAnswer": "der"`) so it cannot match `deren` or an `acceptableAnswers`
entry — and confirm the match count equals the `coverage_tags` count before
relying on it.

### Demote

**`--reason pool-hygiene`, never `quality`.** These rows are not defective, only
over-represented. `quality` and `learner-flag` are in
`NON_EVIDENCE_DEMOTION_REASONS` and silently revoke learners' credit for every
past attempt, requiring a `backfill:mastery --apply` rebuild.

If scripting many invocations, **brace every `${var}`** — zsh parses `$point:s`
as a history modifier, which once double-applied a group.

### Verify — three ways, against the snapshot

A per-invocation success log is **not** sufficient; it once looked clean while
two extra rows had been demoted. Reconcile:

```
captured N / demoted N / still-approved 0 / wrong-reason 0
pool-hygiene(now) − pool-hygiene(snapshot) = N
approved(snapshot) − approved(now)         = N
'quality' count unchanged
```

All three must land on the same N. Drop any temp table you created —
they survive across sessions on the Neon pooler and will double-count later joins.

### Resume and confirm

Nothing is verified until regeneration runs. The confirming passes are
`audit:constructions` and `audit:collapse --dry-run` **after** the refill —
and for scene monotony specifically, `audit:collapse`'s stem-monotony signal,
which is the only one that sees it.

---

## 7. Scale and cost reference

| | ES | TR | DE |
|---|---|---|---|
| Points authored | 94 | 43 | 47 |
| Audit cost | — | $4.43 | $6.08 |
| Rows labelled | 5,432 ($7.86) | 2,401 ($3.59) | 3,072 ($4.56) |
| Rows demoted | 2,598 (28%) | 1,189 (44%) | 1,710 (39%) |

Labelling runs ≈ **$0.0015/row**. The demotion is free. Budget **$10–20** for a
language end-to-end.

The demoted share tracks how completely the cells had collapsed — TR's 44% was
higher because almost everything read as surplus on the prototype.

---

## 8. Known open issues

- **The kebab-case enumeration fault.** The enumerator names constructions after
  target-language material and the validator rejects any non-ASCII letter, so
  points are silently never examined (`ı`, `İ`, `ä` — three points across two
  languages so far). Fix belongs in the tool.
- **Variants are absent from `generation_jobs.coverage_outcome`**, so a cell
  mid-retrofit reads as failing there even when the retrofit worked.
- **`packages/db`'s lint script is `eslint src/**/*.ts`** and does not cover
  `scripts/`, where these CLIs live — lint them by invoking eslint directly.
