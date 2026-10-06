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
whole-cell collapses (ES B1 free-time 8→1, daily-routine 6→1, TR A1 my-family
5→1) and DE B1 complaint 5→2 were spot-checked against the full task text.

**76 rows** demoted (`duplicate`): 73 across 32 cells via
`demote:pool --ids-file`, plus 3 cell-less one-line stub seeds (EN B1, TR B1,
DE B1) by guarded direct `UPDATE` writing the same two columns the CLI writes.
Per-cell clusters with the kept row and angle:
`fw-round3-dedup-proposals-2026-10-07.json`; ids:
`fw-round3-dedup-demote-ids-2026-10-07.txt`.

**Round 3 rollback** (prod, branch `br-green-waterfall-ancrvpr5`):

```sql
UPDATE exercises
SET review_status = 'auto-approved', demotion_reason = NULL
WHERE id IN (
  '0d35724c-d6d5-5af4-8dfd-09a8c389a9b5', 'fa509dba-56ae-5f9e-ab3f-c082f93e2b57',
  'dbd937b6-c7f8-5642-8677-4bfe3f3fdf8b', 'c87bd12a-4bcc-565e-a70e-28a22bc864c7',
  'bba60abd-5f47-5f61-806e-9fbdc1e10d50', 'cd036e23-2813-54bf-a6ce-5063fbdfd53e',
  '1f600757-8b31-5553-b0b1-60cf32f60e1a', '21600a7d-88f8-59c9-aeb1-5d9530bcd278',
  '12fca054-d5da-55a6-bbe4-499a8013387b', '0ccde13d-745b-5f19-a60d-c42586272560',
  '0bcddfaa-f33e-5154-a50d-c2880743c331', '8cea93be-b26f-5a68-908d-97e40874b115',
  '0f0cdc6a-a2da-574c-9f41-df10054098b1', 'a0891727-002b-530b-8b25-22d7201ad982',
  '8bea922b-35c5-53b7-938d-9cbb89914ee6', '8dea9551-338b-582d-918d-998187581344',
  'fb25212d-c2a5-520d-80d4-4b51396ae0ec', 'f8251c74-43c2-5fd2-81d4-4ceebcc0ba5f',
  'f9251e07-c4df-5d97-82d4-4e8b3ba41c8e', 'f7251ae1-c718-5921-bcd4-44dd34f869a8',
  'f2251302-38a4-5620-87d4-569cb1a29035', 'f665a905-4480-5f0f-a7a0-fa533c63334a',
  '70d72bb7-d240-527f-aa4b-2fd3d37ee5de', 'df5af0fa-9366-5b40-bbcd-a30cb8a4a50d',
  '4ddeb63d-c417-5b55-8a6e-2ff99dca643c', '3719a21a-09a5-5b7a-ba0f-b886252ff54b',
  '3619a087-8888-5db5-b90f-b6e9a1da1bd8', '35199ef4-076c-5ff0-b80f-b54c22f6b9a9',
  '33199bce-0e18-528e-b60f-b21229a26c8f', '32199a3b-8cfb-54c9-b50f-b075a64c931c',
  '9f432dcf-95a6-53cf-8b5b-7103beb7216e', 'c995de6a-ad4a-522a-ac6e-5eb6beed984b',
  'eb90ed05-b6ad-5e15-ad6e-6029bb12c21c', '3095136e-3d48-5e54-b15f-6b386317cd29',
  'bf96e52b-28e7-5c93-9fdc-f7ff7df20dfa', 'cbe4b7b2-3681-5a1c-ba2c-d1d0021bb089',
  'dae752ef-e70b-5edb-a8aa-5e971cf5f15a', '4d81fb7c-4df1-5c68-a89a-2c14a05a8e61',
  '8ecf821b-0ecd-500f-a9df-cf83928a7e9e', '8fcf83ae-8b77-56c0-a6df-caac116de0cd',
  'c7c0b60f-3ae5-5131-8c5b-7ecdb1b10b74', 'c9c0b935-3d1e-5cbb-8e5b-8207b3ea4716',
  '39bee5e5-0b2a-538b-9bfc-0d571a2ca416', '38bee452-8a0d-55c6-9afc-0bba9b4941e7',
  'c2344db4-b67e-518e-8ccd-4d028e3160a3', 'c3344f47-379a-5f53-8dcd-4e9f0d14c2d2',
  'ff3818ed-96a5-5581-a32d-000d2ba10e88', 'fd3815c7-98de-510b-a52d-03472dda4a2a',
  'd4d21ba3-f8c5-5d69-bba0-bb15d437b394', 'd6d21ec9-fafe-58f3-bda0-be4fd670ef36',
  '5ebe2aa0-8087-59c2-8ca0-f2de8e46c71f', '20a6685a-c022-585e-a1a1-63026720b7b7',
  '1fa666c7-3f05-5a99-a0a1-6165e3cade44', '44d6e79a-8663-5fb4-8819-a27835ce77f1',
  'a28e799b-5fdd-52b5-bd75-c0e901c0f5b0', 'a68e7fe7-6450-59c9-b975-ba7506336cf4',
  'c1650b06-4b71-5374-959b-c5385aa1d2f9', 'c583bc74-1f34-5eea-a8a4-b186c088563f',
  'b2b88b27-04d6-5d75-af67-11c968d12ea8', 'b3a0f3b9-b2e3-5b85-a055-65b9bcf700e4',
  'a0e2e363-1034-5b9d-9b4a-6e71f1a75dd8', '40e81833-78ae-5991-84b1-0f6d4b4b8d44',
  '54078c21-2d35-59db-b534-ff27a4267dfe', '3d4907bf-796c-5b5b-abc5-8807a9f9735a',
  '6ec5b9e3-edd6-5679-b3ac-1fe500943294', '6dc5b850-6cba-58b4-b2ac-1e4881b0d065',
  '5d48b5a6-1e87-568e-824d-7b524f1e5407', 'a1676871-83f3-5451-bac4-5e7da99083c8',
  '47c87ae6-5f31-5fdc-8765-b6b0f3dcc899', 'f0ec48e4-d66d-5cf0-91f2-c42c9e323ef1',
  'f3ec4d9d-59c2-563f-94f2-c9031f4edcc2', '0232d79f-65d3-5131-8dde-acedc356107c',
  '2a0ebd28-415b-5af4-b72b-c72881de3e9d', 'e3acaed3-efac-5429-a10f-d6359a7f43cc',
  'bf972890-f9ce-55e0-9ad5-a08c63643dc9', 'abe72f3e-6ade-52ac-9328-d9f057893899'
);
```
