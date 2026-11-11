# TR possessive suffixes — `onların` + 3sg -(s)I repair (2026-11-11)

Learner-reported (session `ddf133d2-292c-41aa-9572-4cc84f656bd6`, history
`efd62fb2-e723-4c60-a390-6ac3c4a8e397`, flag `fbf5716b-…` left **open** for admin
resolution). Cloze `Onların ___ çok güzel. (kapı)` — gloss "Their door is very
beautiful." — keyed `kapıları` only; the learner's `kapısı` scored 0.2 as an
"agreement error".

## The rule (Göksel & Kerslake)

- §14.4 ex. 112–114: when the possessor is an overt plural genitive and one thing
  is possessed, the head usually takes **3sg -(s)I** (*çocukların öğretmeni*,
  *onların arkadaşı*), to avoid ambiguity. *Çocukların öğretmenleri* is ambiguous
  and more typically means "teachers".
- §14.3.2 ex. 45: bare *biletleri* = "their ticket" or "their tickets" — without an
  overt possessor, "their" needs -lArI.
- §18.1.5: genitive pronouns (*benim*, *sizin*…) are normally omitted where a
  matching possessive suffix is present; used for contrast/emphasis.
- §14.4 ex. 115–116: informally the head may drop its suffix (*bizim ev*), mostly
  with 1st/2nd person pronouns.

So `kapısı` was the better answer to every row below (all eight glosses are
singular).

## Pool (prod, applied 2026-11-11)

All `tr-a1-possessive-suffixes` cloze rows with an overt plural genitive before a
-lArI key. Each gained `acceptableAnswers: [<3sg form>]`; `correctAnswer`,
`review_status` and `coverage_tags` unchanged. An exact match on
`acceptableAnswers` grades deterministically (score 1, no LLM call).

| id | sentence | key | added |
|---|---|---|---|
| 48d31672-7748-5788-a813-cae45a9adf65 | Onların ___ çok güzel. (kapı) | kapıları | kapısı |
| e84c0d0c-12fb-5b36-b9ee-34ca337a39c3 | Onların ___ çok güzel. (araba) | arabaları | arabası |
| 4ed31fe4-709c-54ea-b213-db0665b9098f | Onların ___ çok güzel. (oda) | odaları | odası |
| fc49edf1-2f43-55af-8df5-d9b396af48a2 | Onların ___ çok büyük. (oda) | odaları | odası |
| 744f2807-71be-5409-bdf1-4675d92a196c | Onların ___ çok berbat. (oda) | odaları | odası |
| 6e4f1e95-7cdc-5dbb-b7f1-3cc7d27e6686 | Onların ___ çok güzel. (fotoğraf) | fotoğrafları | fotoğrafı |
| b5a3215a-9d6a-5d44-b614-d6b8f6264601 | Onların ___ çok zeki. (kedi) | kedileri | kedisi |
| e64c09e6-0c4f-5898-bbee-380435b37565 | Onların ___ haritada çok küçük. (nokta) | noktaları | noktası (row is `flagged`, not served) |

Prior attempts on these rows: 5, all answered -lArI and scored 1.0 — unaffected.

## Learner record

- `user_exercise_history` `efd62fb2-…`: score 0.2 → 1, evaluation `errors` emptied,
  `correctedAnswer` removed, feedback rewritten (notes the correction). The nightly
  mastery rebuild (03:00 UTC) replays this score.
- `error_observations` `2a1c94e3-fec1-43fe-ac18-d2756b28fd2f` deleted (wrong_text
  `kapısı`, correction `kapıları`, host + error point `tr-a1-possessive-suffixes`,
  severity major, occurred 2026-11-11T16:17:02.482Z).

## Theory page

`theory_topics` `127e02e5-a684-5cc3-b89f-da5fc1f79396` (manual-approved). New
section `with-a-possessor-word` (genitive pronoun table, pronoun usually dropped,
the two "their" patterns, plural noun possessors, casual *bizim ev*), one example
(*Onların kapısı çok güzel.*), one pitfall. Also fixed three nits the validator
raised: 3sg after-consonant cell `-(s)I` → `-I`; the "body parts" bullet (English
does not omit "my eye"); *Gözüm siyah* "My eye is dark" → *Okulum yakın*.

Real validator (`validateTheoryDraft`, against the edited curriculum):
before 0.60 (pronoun/"their" coverage flagged missing) → after **0.85**, no
factual errors. md5(content_json::text): before `36848ca7a760aafe6c3995a3d7cc6fc8`,
after `08188320696288a3733f987be4dea58a`. Files: `theory-before.json`,
`theory-after.json`; quality_score 0.66 → 0.85.

## Rollback

```sql
-- exercises
UPDATE exercises SET content_json = content_json - 'acceptableAnswers'
WHERE id IN ('48d31672-7748-5788-a813-cae45a9adf65','e84c0d0c-12fb-5b36-b9ee-34ca337a39c3',
  '4ed31fe4-709c-54ea-b213-db0665b9098f','fc49edf1-2f43-55af-8df5-d9b396af48a2',
  '744f2807-71be-5409-bdf1-4675d92a196c','6e4f1e95-7cdc-5dbb-b7f1-3cc7d27e6686',
  'b5a3215a-9d6a-5d44-b614-d6b8f6264601','e64c09e6-0c4f-5898-bbee-380435b37565');
-- theory page: content_json = theory-before.json, quality_score = 0.66
-- (guard: md5(content_json::text) = '08188320696288a3733f987be4dea58a')
```

The history row's original evaluation (score 0.2, one major grammar error
`kapısı → kapıları`, correctedAnswer `kapıları`) is recorded above; restoring it
is not recommended.
