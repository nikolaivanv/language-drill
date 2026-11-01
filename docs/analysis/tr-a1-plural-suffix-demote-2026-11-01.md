# TR A1 plural-suffix demote + A2 split — 2026-11-01

Triggered by a learner report: `Annem beni doğurduğunda yirmi ___ vardı. (yaş)`
→ `yaşlarında`. The A1 theory page teaches bare `-lAr` and "no plural after a
numeral", then this row demands plural + possessive + locative after the numeral
`yirmi`. The sentence is also ungrammatical: approximate age is
`yirmi yaşlarındaydı` (copula), not `... yaşlarında vardı`.

Root cause: since #688 the A1 point carried two variants the A1 theory never
taught — household `-lAr` (`Ahmet'ler`, `ablamlar`) and approximation `-lAr`
(`kırk yaşlarında`, `akşamları`). The theory validator, run on an A1 page
extended to cover them, flagged level mismatch. This PR moves both, plus the
recurring-time `-lArI`, to the new `tr-a2-plural-extended-uses`.

All prod writes go to `br-green-waterfall-ancrvpr5` via Neon MCP SQL (the same
`UPDATE` `demote:pool` performs). All rows below were `auto-approved` with
`demotion_reason` null before the write.

## Step 1 — applied 2026-11-01: defects (manual read of the whole 20-row cloze cell)

| id | reason | stem → answer | defect |
|---|---|---|---|
| 128dd7b8-2be1-5a20-a80b-795c7a0d6e91 | quality | `Annem beni doğurduğunda yirmi ___ vardı. (yaş)` → yaşlarında | ungrammatical with `vardı` |
| 108dd492-3b71-5ae6-9e0b-693a899e0fff | quality | `Bu şehirde birkaç büyük ___ var.` → otogar | no cue word — learner must guess the lexeme `otogar` from the gloss |
| 118dd625-bc8e-58ab-9f0b-6ad70881722e | quality | `Cüzdanımda birkaç kart değil, sadece ___ var. (banknot)` → banknotlar | unnatural sentence; garbled gloss; bare `banknot` after `var` is also defensible |
| 0f13e27b-7813-58bb-bc84-bd270a5a96b2 | pool-hygiene | `Kuşlar ___ yuvalarına döner. (akşam)` → akşamları | sound content, moved to A2. First written as `quality`, corrected to `pool-hygiene` the same day so learners keep credit |

## Step 2 — after this PR merges and deploys: moved constructions (`pool-hygiene`)

Sound rows that drill what is now `tr-a2-plural-extended-uses`. `pool-hygiene`
keeps learners' credit. Found by `seedWord` plus a content regex over every
approved `tr-a1-plural-suffix` row.

| id | type | seedWord | content |
|---|---|---|---|
| c1595bee-2d54-5f46-b27d-7b0a0b50b5f7 | cloze | lar-on-proper-name-group | `…; ___ bana yardım edebilir. (abla)` → ablamlar |
| 1013e40e-f4bd-5f6c-b984-b850893df8e1 | cloze | lar-on-proper-name-group | `___ geldi ama Mehmet gelmedi. (Ayşe)` → Ayşe'ler |
| 9ef9b241-1a1e-5555-9490-3789e55af2a4 | translation | lar-on-proper-name-group | Aunt Fatma's family didn't come because of the rain. |
| 9df9b0ae-9901-5790-9390-35ec66779075 | translation | lar-approximation | The students study in the library in the evenings. |
| ba162fec-0281-5f16-97a1-7bbabcc68453 | translation | lar-on-proper-name-group | Mehmet and his family are not at the bus station. |
| bb16317f-839e-5cdb-98a1-7d573ba9e682 | translation | lar-approximation | My phone is usually around here somewhere. |

```sql
UPDATE exercises SET review_status = 'rejected', demotion_reason = 'pool-hygiene'
WHERE id IN (
  'c1595bee-2d54-5f46-b27d-7b0a0b50b5f7', '1013e40e-f4bd-5f6c-b984-b850893df8e1',
  '9ef9b241-1a1e-5555-9490-3789e55af2a4', '9df9b0ae-9901-5790-9390-35ec66779075',
  'ba162fec-0281-5f16-97a1-7bbabcc68453', 'bb16317f-839e-5cdb-98a1-7d573ba9e682'
) AND grammar_point_key = 'tr-a1-plural-suffix'
  AND review_status IN ('auto-approved', 'manual-approved')
RETURNING id;
```

## Rollback

```sql
UPDATE exercises
SET review_status = 'auto-approved', demotion_reason = NULL
WHERE id IN (
  '128dd7b8-2be1-5a20-a80b-795c7a0d6e91', '108dd492-3b71-5ae6-9e0b-693a899e0fff',
  '118dd625-bc8e-58ab-9f0b-6ad70881722e', '0f13e27b-7813-58bb-bc84-bd270a5a96b2',
  'c1595bee-2d54-5f46-b27d-7b0a0b50b5f7', '1013e40e-f4bd-5f6c-b984-b850893df8e1',
  '9ef9b241-1a1e-5555-9490-3789e55af2a4', '9df9b0ae-9901-5790-9390-35ec66779075',
  'ba162fec-0281-5f16-97a1-7bbabcc68453', 'bb16317f-839e-5cdb-98a1-7d573ba9e682'
) AND review_status = 'rejected';
```
