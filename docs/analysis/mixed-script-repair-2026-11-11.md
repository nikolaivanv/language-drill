# Mixed-script repair — 2026-11-11

Learner-reported in prod session `ddf133d2-292c-41aa-9572-4cc84f656bd6`: the
"version we coded" for *Is your umbrella in your bag?* read `Senin şemsiyен
çantanda mı?`. Its last two letters were Cyrillic (`е` U+0435, an invisible
homoglyph, and `н` U+043D).

## Scope

A pool sweep found 85 more rows with a non-Latin letter inside a word:

| Language | auto-approved | manual-approved | flagged | rejected |
|---|---|---|---|---|
| TR | 32 | 1 | 28 | 8 |
| DE | 4 | 0 | 5 | 1 |
| ES | 3 + 1 Han | 0 | 2 | 0 |

The rate was a steady 0.06–0.34% of generated rows in every month from 2026-05 to
2026-10, so this is not a regression from a recent model switch. It reached every exercise
type and every field, including graded ones: cloze `correctAnswer` (`sütле`,
`sepеtle`, `yorgunduн`), MC `options` (`gösteriден`), conjugation `targetForm`
(`zorundасın`), and translation `referenceTranslation` / `acceptableAnswers`.

The substituted letters are the **phonetic** equivalents, not the look-alikes:
`р` stands for /r/ (not p), `у` for /u/ (not y), `с` for /s/ (not c),
`и` for /i/, `м` for /m/. So the repair transliterates by sound.

Three Greek hits are legitimate IPA (`/θ/` in ES conjugation breakdowns) and
were left alone.

## Applied on prod (`br-green-waterfall-ancrvpr5`)

1. Row `97f4a8c6-061c-520e-a9c0-ebf26d6978e7` (the reported one): reference
   `Senin şemsiyен çantanda mı?` → `Senin şemsiyen çantanda mı?`, acceptable
   `Şemsiyен çantanda mı?` → `Şemsiyen çantanda mı?`. No other fields changed.
2. The remaining 85 rows (snapshot: `mixed-script-repair-2026-11-11.before.json`):

```sql
UPDATE exercises
SET content_json = replace(
  translate(content_json::text,
    'абвгдеёзийклмнопрстуфхыэіАБВГДЕЁЗИЙКЛМНОПРСТУФХЭІ',
    'abvgdeeziyklmnoprstufhıeiABVGDEEZIYKLMNOPRSTUFHEI'),
  'y终 defendiendo', 'y finalmente defendiendo')::jsonb
WHERE content_json::text ~ '[Ѐ-ӿ぀-鿿]';
-- 85 rows; afterwards 0 rows match the pattern.
```

Before applying, every distinct affected word was listed next to its
transliteration and checked by hand. All 80 were correct once Ukrainian `і`
(`gelemedі`) was added to the map. `review_status` and `flagged_reasons` were
not touched: rows flagged for other reasons stay flagged.

## Rollback

Restore `content_json` from the snapshot (it lists `id`, `review_status`,
`content_json` per row):

```sql
UPDATE exercises e
SET content_json = r.content_json
FROM jsonb_to_recordset(:'snapshot'::jsonb) AS r(id uuid, content_json jsonb)
WHERE e.id = r.id;
```

(`psql -v snapshot="$(cat mixed-script-repair-2026-11-11.before.json)" -f …`)

## Prevention

`checkMixedScript` (`packages/ai/src/mixed-script.ts`) now runs first in
`applyDeterministicChecks` for every exercise type and rejects any draft with a
letter outside Latin/Greek (`mixed-script` reason code). It also runs in
`revalidate:cloze --deterministic-only`.

## Wider sweep: inputs and other outputs

Checked the same day for any letter outside Latin/Greek:

- **LLM inputs in the repo** (curriculum, grammar points, `constructionVariants`,
  `coverageSpec`, seed words, prompts): clean. The only hits are test fixtures and
  the `·` separator.
- **Prod tables** (every public table, whole-row scan): `vocab_lemma`
  (88k), `skill_topics`, `theory_topics`, `exercise_word_hints`, `gloss_cache`,
  `generated_reading_texts`, `read_entries`, `error_observations` and the rest
  were all clean, apart from three rows:
  - `vocab_target` `fc71fa06-faa5-4808-991e-f8c66a6e597b` example sentence
    `Akşam ailемле televizyon izlerim.` → `ailemle`. Fixed.
  - `user_exercise_history` `22c5ad98-…` and `1aec480a-…`: the conjugation
    feedback quoted the defective breakdown (`prueб-`, `duerм-`). Fixed to
    `prueb-` / `duerm-` (text only; scores untouched).
  - `exercise_flags` `2d94acdf-…`: the learner's own report of this bug.
    Left as is; it is still `open`.

Theory pages already had their own Cyrillic/Greek check (`FOREIGN_SCRIPT` in
`theory-content-checks.ts`, #805). The vocab-target proposer had none, so
`validateProposedWord` now drops a word whose display form, lemma, gloss or
example has a mixed-script hit.
