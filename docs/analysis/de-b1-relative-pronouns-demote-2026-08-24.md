# `de-b1-relative-pronouns` zip-residue demotion — run record, 2026-08-24

The demotion the DE variant repass (#696) structurally could not reach. This
point declares **no `constructionVariants`** — its diversity mechanism is the
`coverageSpec` — so `backfill:variant-seeds` never labelled it and the repass's
`--content-ilike '"seedWord": …'` handle did not exist for it.

## What was wrong

Its spec is a literal 2×2:

```ts
coverageSpec: {
  axes: [
    { name: 'case',   floors: { dative: 8, genitive: 6 } },
    { name: 'number', floors: { singular: 8, plural: 5 } },
  ],
}
```

The pre-#690 `decideCoverageTargets` water-filled each axis into its own
sequence and zipped them index-wise, which can only ever emit `lcm(m, n)` of the
`m × n` combinations — for two 2-value axes, **2 of 4**. The pool matched that
prediction exactly:

| cell | dative+sg | genitive+pl | everything else |
|---|---|---|---|
| cloze | 23 | 23 | 4 |
| translation | 25 | 25 | **0** |

99 of 100 rows on two combinations. `denen` (dative plural) and `dessen`
(genitive singular) — the two forms this B1 point exists to teach — were never
generated. Nominative and accusative are correctly absent: the A2 sibling
`de-a2-relative-clauses-nom-acc` owns those, which is why the spec declares only
dative and genitive.

Verified **not** a tagging gap first: `coverage_tags` are 99–100% complete on
this point ([[audit-zero-realized-may-be-tagging-gap]] is the trap that check
exists for).

**The zip bug itself is fixed** (#690, `c47a5ff0`) — the controller now
enumerates the cartesian product and tie-breaks on least-used combination. This
pool is residue generated under the old code, which nothing has cleared because
pre-generation is paused. The remedy is therefore demote + regenerate, not a code
change.

## Sizing

Target 50 per cell, four declared combinations → quota 12.5 each.
`need = approved − target + deficit`:

| cell | approved | deficit | need | demoted |
|---|---|---|---|---|
| cloze | 50 | 23 | 23 | **20** (surplus-bounded) |
| translation | 50 | 25 | 25 | **24** (surplus-bounded) |

## Selection — why it differs per cell

`demote:pool` filters only on `content_json`, but `case` and `number` live in the
separate `coverage_tags` column, so the combination is not directly expressible.
Each cell needed its own handle.

**cloze — `--content-ilike` on `correctAnswer`.** Verified against
`coverage_tags` by dry-run before use:

| pattern | matches | coverage_tags says |
|---|---|---|
| `"correctAnswer": "deren"` | 23 | genitive+plural 23 |
| `"correctAnswer": "dem"` | 18 | dative+singular (dem) |
| `"correctAnswer": "der"` | 5 | dative+singular (der) |

Two properties make this safe, and both were checked rather than assumed: the
closing quote stops `der` matching `deren`, and including the key name stops the
unanchored ILIKE matching an `acceptableAnswers` entry.

**The precision was required, not cosmetic.** Cloze's four minority rows sit at
oldest-first positions **1, 34, 47 and 50** — so a bare `--limit 20`, which is
what the repass used everywhere else, would have destroyed the untagged row at
position 1. Only one of the four is reachable by a limit-20 sweep, but that one
is irreplaceable while generation is paused.

**translation — no filter needed.** Only the two dominant combinations exist
there, so oldest-first cannot touch a minority row. Confirmed the oldest 24 split
11/13 rather than skewing to one combination.

## Result

**44 rows demoted** (cloze 10 + 10, translation 24), `--reason pool-hygiene`
throughout — never `quality`, so learners keep credit and no `backfill:mastery`
rebuild is needed.

```
captured 44 / demoted 44 / still-approved 0
DE pool-hygiene 1918 -> 1962  (+44, exactly the capture)
DE demotion_reason 'quality'  17 before, 17 after — unchanged
```

Surviving distribution — **every minority row intact**:

| cell | dative+sg | genitive+pl | dative+pl | genitive+sg | acc+sg | untagged | total | free slots |
|---|---|---|---|---|---|---|---|---|
| cloze | 13 | 13 | 1 | 1 | 1 | 1 | 30 | 20 |
| translation | 14 | 12 | 0 | 0 | 0 | 0 | 26 | 24 |

44 slots of headroom. Post-#690 the per-axis counts are now near-balanced
(case dative 27 / genitive 26; number singular 28 / plural 26), so the per-axis
deficit signal is flat and the **combination** tie-break — the thing #690 added —
is what will steer the refill toward `dative+plural` and `genitive+singular`.

## What is NOT done

1. **Nothing refills this yet** — pre-generation is still paused (#672). Until it
   resumes this cell is simply smaller, like the rest of the DE pool.
2. **No outcome is verified.** The confirming check is that
   `dative+plural` and `genitive+singular` become non-trivial after the refill;
   that is unmeasurable now.
3. **The other RISK-axis DE points are untouched** — eleven of them, four needing
   `coverageSpec.appliesTo`. Any that turn out to carry the same diagonal will
   need this same treatment, and `demote:pool` still cannot express a
   coverage-tag filter. If more than one or two need it, teaching that CLI an
   `--ids-file` (as `revalidate:cloze` already has) is the better move than
   finding a per-cell content handle each time.
