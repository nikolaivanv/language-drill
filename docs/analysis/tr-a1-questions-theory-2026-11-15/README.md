# tr-a1-questions theory page — missing question patterns (2026-11-15)

**Report:** practising TR A1 question formation served exercises on patterns the
theory page never taught: either/or questions (`Otobüse ___ biniyorsun, yoksa trene mi?`)
and `acaba` (`___ bu çanta çok pahalı mı?`).

**Cause:** the curriculum entry (`packages/db/src/curriculum/tr.ts`, `tr-a1-questions`)
gained `examplesPositive` and `constructionVariants` for either/or questions, focus
mI and acaba after the page was generated (2026-06-08). The exercise pool followed
the curriculum: of 40 approved rows, 2 drill yoksa, 4 drill acaba and 5 drill focus mI
(`Boğazın mı ağrıyor?`, `Bugün mü sınavınız var?`, `Siz de bu yemeği mi beğendiniz?`).
The page was never regenerated. The 2026-11-01 audit repaired its facts, not its scope.

**Change (prod row `91c40594-84d7-5222-9962-461e21463727`, edited in place):**

- what is it: one added passage introducing either/or questions and acaba.
- when to use it: three new items: focus questions, either/or questions, acaba.
- formation:
  - explains the -y- buffer in miyim/miyiz;
  - the WH table goes from 6 to 11 words: adds nereye, nereden, neden/niye/niçin, hangi and ne kadar, and adds an example for each word;
  - adds a "where mI goes decides where the person ending goes" table, with every mI vowel shown after a focused word;
  - adds a paragraph on how either/or questions are put together.
- examples: 7 new (either/or ×3, focus ×2, acaba ×2).
- pitfalls: 3 new (an ending on focus mI, a missing second mI, mI dropped after acaba).
  The rule-of-thumb callout is rewritten. The old version said mI takes the ending
  "in all other tenses", which is wrong for focus mI and for the -(y)DI compounds.
- subtitle: `mı + WH-words` → `mı, WH-words, either/or questions and acaba`.

Grounded in Göksel & Kerslake §19.1.2 (alternative questions), §19.1.3–19.1.4 (mI
positions and focus), §19.2 / §19.2.1.3 (WH-phrases; nere- inflection), §19.5.2 (acaba).

**Validation (production theory validator, Sonnet 5.5 + adaptive thinking, prompt `theory-validate@2026-11-01b`):**

| page | status | score | factual errors |
|---|---|---|---|
| before | rejected | 0.62 | 1 (callout's "all other tenses" rule) |
| first draft | rejected | 0.66 | 1 ("nere- always takes a case ending") |
| final (`after.json`) | auto-approved | 0.82 | 0 |

The first draft's factual error and over-absolute claims are fixed in the final
version: "only" in the person-ending rule (the aorist, future and -mIş work the same way), and
"acaba never makes a question by itself". The only flags left are about density at A1.

**Write:** `review_status = 'manual-approved'`, `flagged_reasons = NULL`,
`quality_score = 0.82`. The guard was the old subtitle plus the old callout phrase,
and the write returned the row. New `md5(content_json::text)` = `953f9ac6195bae01666c8d8e15092855`.

**Files:** `before.json` (prod content before the edit, transcribed from a read-only
SELECT; **the rollback artifact**), `build_after.py` (the deterministic edit),
`after.json` (content written).

**Rollback:**

```sql
UPDATE theory_topics SET content_json = $j$<before.json>$j$::jsonb, quality_score = 0.66, updated_at = now()
WHERE id = '91c40594-84d7-5222-9962-461e21463727' AND md5(content_json::text) = '953f9ac6195bae01666c8d8e15092855'
RETURNING grammar_point_key;
```
