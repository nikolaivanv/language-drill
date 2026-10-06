# ES B2 free-writing: social-media near-duplicate demotion (2026-10-07)

**Why.** The two ES B2 free-writing topic cells touching social media each held
10 approved prompts (2× the `free_writing` target of 5 — overshoot from before
the cap was lowered), but each cell realized only **two** distinct prompts,
reworded 2–8 times. A learner drawing from the pool kept getting the same
essay question.

**What.** 16 rows demoted with `--reason duplicate` (scores untouched), keeping
one prompt per distinct angle. Ids: `es-b2-fw-social-dedup-demote-ids-2026-10-07.txt`.

| Cell | Angle | Before | Kept |
|---|---|---|---|
| `es-b2-fw-social-media` | social media: useful tool vs distraction | 4 | `8443ad62` (has the only learner attempt) |
| `es-b2-fw-social-media` | idealized image / identity ("escaparate / espejo distorsionado") | 6 | `c8e75325` |
| `es-b2-fw-technology-relationships` | do social media / tech strengthen or weaken bonds ("¿puente o barrera?") | 8 | `92b71a59` |
| `es-b2-fw-technology-relationships` | texting/emoji impoverishes communication depth | 2 | `98b723cb` |

Both cells end at **2** approved rows, below the target of 5: when exercise
generation resumes (paused since #718), each cell will request 3 more. The
generator's dedup surface is the title, so watch these two cells for
re-generated same-angle prompts.

**Rollback** (prod, branch `br-green-waterfall-ancrvpr5`) — every row was
`auto-approved` with `demotion_reason` NULL beforehand:

```sql
UPDATE exercises
SET review_status = 'auto-approved', demotion_reason = NULL
WHERE id IN (
  'd0e75fbd-5b84-5495-a631-4e392f86f5c4','cee75c97-5dbd-501f-a831-517331c03166',
  'c9e754b8-e113-596e-a331-4962ae6a57f3','cbe757de-ded9-5de4-a131-4628ac311c51',
  'cae7564b-622f-5733-a431-4aff2d4dba22','633922ee-2fe2-5a60-ac88-b17cd223bab5',
  'cfe75e2a-da67-56d0-a531-4c9cb0a39395','cce75971-5ff6-5ba9-a231-47c52b147e80',
  '94b71d7f-65c0-55df-b0d9-e213c7c47eee','91b718c6-e6dc-53a4-a9d9-d6c8423569d9',
  '95b71f12-e26a-5c90-add9-dd3c46a7e11d','97b72238-f1fa-5d56-a3d9-cd1a3b89b6f3',
  'a31c06e9-ae2e-583b-a4a5-8b076698e4fe','90b71733-6a32-5cf3-acd9-db9fc35207aa',
  '677d4898-c28e-59fc-b627-2fc04bbea42d','96b720a5-6386-5a55-aed9-ded9c58b434c'
);
```

## Round 2 — the other ES B2 cells (same day)

Same defect everywhere: each topic cell realized one or two prompts, reworded
5–10 times. 27 rows demoted (`duplicate`), one kept per distinct question. Ids:
`es-b2-fw-round2-dedup-demote-ids-2026-10-07.txt`.

| Cell | Distinct questions | Before → kept |
|---|---|---|
| `es-b2-fw-environment` | 1 — can individual choices protect the environment vs governments/industry | 8 → `08ffb577` |
| `es-b2-fw-remote-work` | 2 — remote work vs team culture; losing the office routine vs self-discipline | 5 → `ba4e3a76`, `bb4e3c09` |
| `es-b2-fw-study-abroad` | 1 — friend choosing home vs abroad: 2 advantages each + recommendation | 10 → `0ad88d45` |
| `es-b2-fw-work-life-balance` | 1 — two strategies to protect personal time + an obstacle | 8 → `34f2a159` |
| *(no cell)* | 2026-06-14 stub seed "El teletrabajo: ¿avance o aislamiento?" (task is one line) | 1 → 0 |

After both rounds the ES B2 free-writing pool holds **9** approved prompts across
6 cells (52 before), every one a different question. Each cell is now below the
target of 5, so a resumed generation run will request 30 more; the generator
dedups on title only, which is exactly how these near-duplicates got in.

**Round 2 rollback** (prod, branch `br-green-waterfall-ancrvpr5`):

```sql
UPDATE exercises
SET review_status = 'auto-approved', demotion_reason = NULL
WHERE id IN (
  '09ffb70a-b520-577c-89e4-aca06f19b7a1', '05ffb0be-b0ad-5068-8de4-b314738c2ee5',
  'd7863762-25bb-5f20-a37b-7d8c07a30e05', '4609fca5-0332-5635-b21c-0a79ecc8cd34',
  '0a6b3e54-a594-53ca-80bd-65e63b52eea7', '07ffb3e4-b759-5306-8be4-afda7152f343',
  'e697b12f-94d0-5a1b-9a86-0b475678b272', 'dcebeaed-843e-50ed-b7ee-e031a19398cc',
  'd9ebe634-055b-5eb2-b8ee-e1ce24e9723f', 'ae1f1eec-825c-58e8-9ec1-4de4a1173129',
  '75afdcf7-a0b6-5cff-b3fe-8bd310cdeace', '6dafd05f-a99b-5b27-abfe-7eeb07e8fc46',
  'bc5bb5e2-812b-518c-a7af-3770e62de5b9', '74afdb64-1f99-5f3a-b2fe-8a3691ea889f',
  'ef40bcd4-8f53-58b6-878b-68ca1be2675b', '77afe01d-9e7c-5175-b1fe-88990e94af2c',
  '2adf7b25-b1dc-51a1-b8ea-0d5dcd5845e8', '6cafcecc-287e-5d62-aafe-7d4e89059a17',
  '70afd518-240c-564e-aefe-83c28d78115b', 'c76edda9-7e51-5f9b-bd3d-2be7f33cd216',
  'c46ed8f0-fafc-564c-ba3d-271072203445', 'c56eda83-7c18-5411-bb3d-28adf1039674',
  '2fbabe92-8d2b-50ba-a02c-62b6e2c93dc3', 'c66edc16-fd35-51d6-bc3d-2a4a74596fe7',
  'ca6ee262-f8c2-5ac2-803d-30be6fe6f8a3', '8b86d648-55a0-5fd2-a1af-b83e84cd7cd7',
  '6b5d7247-c48f-5321-908e-121d334bf91c'
);
```

## Round 3 — every other language and level (same day)

Three read-only reviewer agents (DE all levels; ES A1–B1; TR all levels + EN)
clustered each cell's prompts by distinct question under the same rule
(duplicate = a learner would write essentially the same essay; at A1/A2,
different required content counts as distinct), keeping one per question. The
two whole-cell collapses (ES B1 free-time 8→1, daily-routine 6→1) and TR A1
my-family 5→1 / DE B1 complaint 5→2 were spot-checked against the full task
text. **76 rows** demoted (): 73 across 32 cells via
, plus 3 cell-less one-line stub seeds (EN B1, TR B1,
DE B1) by guarded direct UPDATE. Per-cell clusters with the kept row and angle:
; ids: .

**Round 3 rollback** (prod, branch ):


