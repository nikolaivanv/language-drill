# TR tense/copula theory repair — 2026-11-01

The learner reported that tense theory pages show a single conjugation example
(e.g. the aorist, whose suffix depends on the stem shape). A review of all 14
TR tense/copula pages found single-class formation sections and four rule errors:

| page | problem (before) |
|---|---|
| tr-a2-aorist | "monosyllabic stems … must be learned individually" — wrong: 1-syllable consonant stems take -Ar except a closed list of 13 (G&K §8.2.3.2: al, bil, bul, dur, gel, gör, kal, ol, öl, san, var, ver, vur); only *içmek* conjugated |
| tr-b1-past-continuous-iyordu | said the -DI vowel follows the stem "not the o of -yor" — backwards; after -yor it is always -du (its own table contradicted it) |
| tr-b2-participle-aorist | repeated the aorist error |
| tr-a2-past-copula | callout mislabelled *öğrenci* as consonant-final; no -tI after voiceless consonants |
| tr-a1-present-continuous | "a/e raises to ı/i" contradicted by *oynuyor*; front-vowel stems only |
| tr-a1-dili-past | only *git-*; no -dı/-du/-dü or -tı forms |
| tr-a1-personal-suffixes | only *öğretmen*; no human-only rule for 3pl -lAr |
| tr-a1-future | pitfall marked *Yarın geliyorum* wrong; no *gidecek* / *yiyecek* |
| tr-b2-compound-past-hikaye | 1sg ending given as -(y)Im; -y- example on -Iyor |
| tr-b2-compound-evidential-rivayet | -y- example on the aorist; said -(y)mIş endings match -DI's |

Each page's formation section (plus the pitfalls/examples repeating an error) was
rewritten by hand, run through the production theory validator before and after,
and written to prod (`br-green-waterfall-ancrvpr5`) as `manual-approved` via Neon
MCP SQL, guarded on the pre-edit `md5(content_json::text)`.

| page | validator before → after |
|---|---|
| tr-a1-present-continuous | 0.91 rejected (2 factual errors) → 0.92 |
| tr-a1-dili-past | 0.72 flagged → 0.88 |
| tr-a1-future | 0.62 flagged → 0.92 |
| tr-a1-personal-suffixes | 0.52 flagged → 0.88 |
| tr-a2-aorist | 0.88 → 0.91 |
| tr-a2-past-copula | 0.92 → 0.92 |
| tr-b1-past-continuous-iyordu | 0.72 rejected (1 factual error) → 0.92 |
| tr-b2-participle-aorist | 0.91 → 0.92 |
| tr-b2-compound-past-hikaye | 0.92 → 0.92 |
| tr-b2-compound-evidential-rivayet | 0.92 → 0.91 |

All "after" runs: auto-approve routing, zero factual errors.

## Rollback

Each `<key>.before.json` holds the row's id, prior `quality_score`,
`review_status` and full `content_json`. To restore one page, write its
`content_json` back with the prior status and score, e.g. via Neon MCP:

```sql
UPDATE theory_topics
SET content_json = $j$<content_json from the file>$j$::jsonb,
    review_status = '<review_status>', quality_score = <quality_score>, updated_at = now()
WHERE id = '<id>';
```
