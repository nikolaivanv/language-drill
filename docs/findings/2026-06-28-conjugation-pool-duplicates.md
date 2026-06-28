# Finding: conjugation pool holds ~50–60% duplicate-content rows (TR)

**Date:** 2026-06-28
**Status:** reported, not yet remediated (serve-time fix shipped separately)
**Surfaced by:** repeated/low-variety conjugation practice (TR A1 personal copula)

## Symptom

During TR A1 personal-copula (`tr-a1-personal-suffixes`) practice: the same
exercise appeared twice in a row, and the vocabulary felt limited to four words
(hazır, mutlu, yorgun, öğrenci).

## Root cause

Two independent causes (the second is the data-quality one this doc reports):

1. **Draw mechanism (fixed separately):** `GET /exercises` drew one row per
   `next` with `freshFirstOrderBy(userId), random() LIMIT 1` — de-duping only by
   exercise *id*, with no in-session exclusion. Addressed by `GET /exercises/set`
   (distinct-by-content set; see `docs/superpowers/plans/2026-06-28-conjugation-no-repeat-set.md`).

2. **Pool data (this finding):** the pool stores many **exact-duplicate content
   rows** — same `grammar_point_key + lemma + targetForm + pronoun` under several
   distinct UUIDs. Because each duplicate is a separate id, the draw treats them
   as different exercises and serves the same prompt back-to-back; id-level
   de-duping cannot stop it. Low lemma diversity compounds the "limited
   vocabulary" perception.

## Evidence (prod, branch `br-green-waterfall-ancrvpr5`)

Redundant duplicate rows per pool (a "redundant" row is the 2nd+ row sharing a
`grammar_point_key + lemma + targetForm + pronoun` signature):

| Pool | Approved rows | Distinct contents | Redundant duplicates |
|---|---|---|---|
| TR A1 conjugation | 144 | 56 | **88 (61%)** |
| TR B1 conjugation | 218 | 105 | 113 (52%) |
| TR A2 conjugation | 77 | 62 | 15 (19%) |
| ES B1 conjugation | 110 | 99 | 11 (10%) |

Worst offenders in `tr-a1-personal-suffixes` (30 rows → ~15 distinct):

- `öğrenci → öğrencisin (sen)` — **5** distinct UUIDs
- `hazır → hazırız (biz)` — 4
- `öğrenci → öğrenciyim (ben)` — 4
- `hazır → hazırsınız (siz)` — 3
- `yorgun → yorgun (o)` — 3

Only ~7 distinct lemmas appear, dominated by öğrenci/hazır/yorgun/mutlu — the
four the learner noticed.

### Reproduction query

```sql
SELECT language, difficulty,
  count(*) AS total_rows,
  count(*) FILTER (WHERE dup_rank > 1) AS redundant_duplicate_rows,
  count(DISTINCT sig) AS distinct_contents
FROM (
  SELECT id, language, difficulty,
    (grammar_point_key || '|' ||
     coalesce(content_json->>'lemma','') || '|' ||
     coalesce(content_json->>'targetForm','') || '|' ||
     coalesce(content_json->'subject'->>'pronoun','')) AS sig,
    row_number() OVER (
      PARTITION BY language, difficulty, grammar_point_key,
        content_json->>'lemma', content_json->>'targetForm',
        content_json->'subject'->>'pronoun'
      ORDER BY id) AS dup_rank
  FROM exercises
  WHERE type='conjugation' AND review_status IN ('auto-approved','manual-approved')
) t
GROUP BY 1,2 ORDER BY redundant_duplicate_rows DESC;
```

## Blast radius

The duplicates affect **every** surface that draws from the shared pool — the
quick drill (`POST /sessions` sample) and fluency, not just the conjugation
warm-up. The conjugation `GET /exercises/set` fix de-dupes by content **at serve
time**, so it neutralizes in-session repeats there regardless of the underlying
data. Quick drill / fluency remain exposed until the data is cleaned.

## Recommended remediation (separate work)

1. **De-dupe the pool** — keep one row per content signature
   (`grammar_point_key + lemma + targetForm + pronoun`), demote the rest. Verify
   on a throwaway Neon branch first; production data change.
2. **Generation-side uniqueness guard** — reject/skip a generated conjugation
   draft whose content signature already exists in the approved pool, so the
   duplicates don't re-accrue. (Mirror the existing dedup intent in
   generation/validation.)
3. **Lemma diversity** — the deeper "limited vocabulary" cause is low distinct
   lemma coverage for some grammar points (only ~7 for `tr-a1-personal-suffixes`).
   Raise the coverage-spec lemma floor / regenerate with a wider lemma set. This
   is a content/coverage task, not a dedup task.
