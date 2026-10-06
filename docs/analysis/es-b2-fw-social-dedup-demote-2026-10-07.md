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
