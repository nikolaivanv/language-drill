# TR A1 vowel-harmony cloze demote — 2026-10-31

Triggered by a learner report: `Bebek ___ düştü. (çene)` → `çeneden`, gloss
"The baby fell from the chin (hit chin-first)". The suffix is right but the
sentence is not Turkish (`X-den düşmek` = fall *off* X; a body part needs the
possessive; "fell on its chin" is `çenesinin üstüne düştü`). A manual read of
the whole approved cell (20 rows, prod `br-green-waterfall-ancrvpr5`) found
6 defective rows. All were `auto-approved`, `demotion_reason` null,
`flagged_reasons` null before the write.

Applied via Neon MCP SQL (same write `demote:pool` performs), reason `quality`
(learner credit revoked by the nightly mastery rebuild).

| id | created_at | score | stem → answer | defect |
|---|---|---|---|---|
| 7a548dd0-8d36-55d4-9586-b2e8f5e61f55 | 2026-07-21 | 0.82 | `Bebek ___ düştü. (çene)` → çeneden | nonsense sentence ("fell off the chin") |
| df5a6585-5a22-5bfb-ad88-8b4783cd9546 | 2026-05-24 | 0.85 | `Ahmet her sabah sütü içiyor. O ___ çok seviyor.` → sütü | answer printed in the stem; no cue word |
| de5a63f2-d906-5e36-ac88-89aa04ea3317 | 2026-05-24 | 0.85 | `Ali her sabah sütü içiyor. O ___ çok seviyor.` → sütü | same as above (near-duplicate) |
| 7482a98e-cf6a-5d0a-8a5c-2cb6a0e31113 | 2026-06-17 | 0.82 | `Kapıda biri var. Onu ___ açtı. (kapı)` → kapıyı | ungrammatical double accusative (`Onu kapıyı açtı`) |
| 1b1c43dd-1454-5bcb-9002-4ba76be167a6 | 2026-07-12 | 0.82 | `Ahmet dün akşam maç ___ izledi. (maç)` → maçı | yields `maç maçı izledi` |
| 876732bd-5ec2-57c5-8bc6-5939f7f0fa54 | 2026-07-13 | 0.82 | `Annem masada bir fincan ___ içiyor. (kahve)` → kahveyi | `bir fincan kahveyi` is wrong; measure phrase takes bare `kahve` |

Borderline, kept: `Masada iki elma var. Ali ___ yedi.` → elmayı (definite
"the apple" with two apples present is loose but grammatical).

## Rollback

```sql
UPDATE exercises
SET review_status = 'auto-approved', demotion_reason = NULL
WHERE id IN (
  '7a548dd0-8d36-55d4-9586-b2e8f5e61f55',
  'df5a6585-5a22-5bfb-ad88-8b4783cd9546',
  'de5a63f2-d906-5e36-ac88-89aa04ea3317',
  '7482a98e-cf6a-5d0a-8a5c-2cb6a0e31113',
  '1b1c43dd-1454-5bcb-9002-4ba76be167a6',
  '876732bd-5ec2-57c5-8bc6-5939f7f0fa54'
) AND review_status = 'rejected' AND demotion_reason = 'quality';
```
